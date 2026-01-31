import React, { useState } from 'react';
import { Button, Icon } from '../ui/components';

// Add animation styles
const fadeInUpAnimation = `
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// Inject styles into document
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = fadeInUpAnimation;
  document.head.appendChild(styleElement);
}

// --- Mock listings ---
const mockListings = [
  { title: "Apple iPhone 15 Pro - 256GB - Natural Titanium", condition: "Pre-owned", price: 899, shipping: 12.5, status: "Sold" },
  { title: "iPhone 15 Pro 256GB Blue Titanium - Excellent Condition", condition: "Open Box", price: 945, shipping: 0, status: "Sold" },
  { title: "Apple iPhone 15 Pro - 256GB - White Titanium", condition: "Pre-owned", price: 872, shipping: 9.99, status: "Sold" },
  { title: "Brand New Sealed Apple iPhone 15 Pro 256GB Black", condition: "New", price: 1049, shipping: 0, status: "Sold" },
];

const EBAY_CATEGORY_MAP = {
  "phones": "9355",
  "games": "139973",
  "tablets": "58058",
  "laptops": "175672",
  "gaming consoles": "139971",
};

// Helper function to send messages to extension via bridge
function sendExtensionMessage(message) {
    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substr(2, 9);
        
        // Listen for response
        const responseHandler = (event) => {
            if (event.data.type === 'EXTENSION_RESPONSE' && event.data.requestId === requestId) {
                window.removeEventListener('message', responseHandler);
                
                if (event.data.error) {
                    reject(new Error(event.data.error));
                } else {
                    resolve(event.data.response);
                }
            }
        };
        
        window.addEventListener('message', responseHandler);
        
        // Send message to bridge
        window.postMessage({
            type: 'EXTENSION_MESSAGE',
            requestId: requestId,
            message: message
        }, '*');
        
        // Timeout after 60 seconds
        setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            reject(new Error('Extension communication timeout'));
        }, 60000);
    });
}


function PriceHistogram({ listings, onBucketSelect, priceRange, onGoBack, drillLevel }) {
  const [bucketCount, setBucketCount] = useState(10);

  if (!listings || listings.length === 0) return null;

  const prices = listings
    .map(l => (typeof l.price === 'string' ? parseFloat(l.price.replace(/[^0-9.]/g, '')) : l.price))
    .filter(p => !isNaN(p) && p > 0);

  if (prices.length === 0) return null;

  // Use priceRange if drilling down, otherwise use full range
  const min = priceRange ? priceRange.min : Math.min(...prices);
  const max = priceRange ? priceRange.max : Math.max(...prices);
  const totalRange = max - min;
  const rawStep = totalRange / bucketCount;

  const buckets = Array(bucketCount).fill(0).map((_, i) => ({
    count: 0,
    rangeStart: min + (i * rawStep),
    rangeEnd: min + ((i + 1) * rawStep)
  }));

  prices.forEach(price => {
    // Only count prices within current range
    if (priceRange && (price < priceRange.min || price > priceRange.max)) return;
    
    let index = Math.floor((price - min) / rawStep);
    if (index >= bucketCount) index = bucketCount - 1;
    if (index < 0) index = 0;
    buckets[index].count++;
  });

  const maxFreq = Math.max(...buckets.map(b => b.count));

  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 mb-10 shadow-sm transition-all duration-500">
      <div className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
              Market Price Density {drillLevel > 0 && `(Level ${drillLevel})`}
            </h3>
            <p className="text-[10px] text-gray-500 mt-1">
              {priceRange ? (
                <>
                  Drilling into <span className="font-bold text-blue-900">£{priceRange.min.toFixed(0)} - £{priceRange.max.toFixed(0)}</span> range
                  {' '}(<span className="font-bold text-blue-900">{prices.filter(p => p >= priceRange.min && p <= priceRange.max).length}</span> listings)
                </>
              ) : (
                <>
                  Showing distribution across <span className="font-bold text-blue-900">{prices.length}</span> listings
                </>
              )}
            </p>
          </div>
          
          {drillLevel > 0 && (
            <button
              onClick={onGoBack}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-bold hover:bg-blue-800 transition-all transform hover:scale-105 shadow-md"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Zoom Out
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-4 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
          <label className="text-[10px] font-bold text-blue-900 uppercase">
            Buckets: {bucketCount}
          </label>
          <input 
            type="range" 
            min="5" 
            max="20" 
            value={bucketCount}
            onChange={(e) => setBucketCount(parseInt(e.target.value))}
            className="w-24 h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-900"
          />
        </div>
      </div>
      
      {/* Chart Area */}
      <div className="flex items-end gap-1.5 h-44 px-2 border-b border-gray-100">
        {buckets.map((bucket, i) => {
          const heightPct = maxFreq > 0 ? (bucket.count / maxFreq) * 100 : 0;
          
          return (
            <div 
              key={i} 
              className={`flex-1 flex flex-col items-center h-full justify-end relative group transition-all duration-500 ${
                bucket.count > 0 ? 'cursor-pointer' : ''
              }`}
              onClick={() => bucket.count > 0 && onBucketSelect(bucket.rangeStart, bucket.rangeEnd)}
              style={{
                transform: `scale(${bucket.count > 0 ? 1 : 0.95})`,
                opacity: bucket.count > 0 ? 1 : 0.3
              }}
            >
              
              {/* --- Frequency Label (On Top) --- */}
              {bucket.count > 0 && (
                <span 
                  className="absolute text-[10px] font-black text-blue-900 mb-1 transition-all duration-300 group-hover:scale-125"
                  style={{ bottom: `${heightPct}%` }}
                >
                  {bucket.count}
                </span>
              )}

              {/* The Bar */}
              <div 
                className={`w-full transition-all duration-500 rounded-t-sm ${
                  bucket.count > 0 
                    ? 'bg-yellow-400 group-hover:bg-blue-900 group-hover:shadow-lg shadow-sm'
                    : 'bg-gray-50'
                }`}
                style={{ 
                  height: bucket.count > 0 ? `${Math.max(heightPct, 4)}%` : '2px',
                  transform: 'scaleY(1)',
                  transformOrigin: 'bottom'
                }}
              />

              {/* Price Range Labels */}
              <div className="absolute -bottom-8 flex flex-col items-center w-full">
                <div className="text-blue-900/50 font-bold text-[8px] whitespace-nowrap">
                  £{bucket.rangeStart.toFixed(0)}
                </div>
              </div>
              
              {/* Tooltip on Hover */}
              {bucket.count > 0 && (
                <div className="absolute bottom-full mb-6 hidden group-hover:flex flex-col items-center z-10">
                  <div className="bg-blue-900 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                    £{bucket.rangeStart.toFixed(0)} - £{bucket.rangeEnd.toFixed(0)}
                    <div className="text-[9px] text-yellow-400 font-bold mt-0.5">🔍 Click to drill down</div>
                  </div>
                  <div className="w-2 h-2 bg-blue-900 rotate-45 -mt-1"></div>
                </div>
              )}

            </div>
          );
        })}
      </div>
      <div className="h-10"></div>
    </div>
  );

}

/**
 * Finds the most specific eBay ID by checking path items from right-to-left
 * @param {Array} path - e.g., ["Electronics", "Mobile Phones", "Smartphones"]
 */
function resolveEbayCategory(path) {
  if (!path || !Array.isArray(path)) return null;

  // Search from most specific (end of array) to most general (start)
  for (let i = path.length - 1; i >= 0; i--) {
    const segment = path[i].toLowerCase();
    if (EBAY_CATEGORY_MAP[segment]) {
      console.log("Succesfully found a mapping for this category on eBay, data is better");
      return EBAY_CATEGORY_MAP[segment];
    }
  }
  console.log("Could not find a mapping for this category at all ", path);
  
  return null;
}

function buildEbayUrl(searchTerm, filters, categoryPath) {
  const categoryId = resolveEbayCategory(categoryPath);
  
  // Base URL: use the category path if ID exists, otherwise generic search
  let url = categoryId 
    ? `https://www.ebay.co.uk/sch/${categoryId}/i.html` 
    : "https://www.ebay.co.uk/sch/i.html";

  const params = {
    _nkw: searchTerm.replace(/ /g, "+"),
    _from: "R40"
  };

  // If we aren't using a specific category path, search site-wide
  if (!categoryId) {
    params._sacat = "0";
  }

  // Double-encode API filters for eBay's URL parser
  Object.entries(filters || {}).forEach(([filterName, value]) => {
    const encodedKey = encodeURIComponent(encodeURIComponent(filterName));
    
    if (Array.isArray(value)) {
      params[encodedKey] = value
        .map(v => encodeURIComponent(encodeURIComponent(v)))
        .join("|");
    } else if (typeof value === "object") {
      if (value.min) params[`${encodedKey}_min`] = encodeURIComponent(encodeURIComponent(value.min));
      if (value.max) params[`${encodedKey}_max`] = encodeURIComponent(encodeURIComponent(value.max));
    } else {
      params[encodedKey] = encodeURIComponent(encodeURIComponent(value));
    }
  });

  const queryString = Object.entries(params)
    .map(([key, val]) => `${key}=${val}`)
    .join("&");

  return `${url}?${queryString}`;
}


export default function EbayResearchForm({ onComplete, category }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [step, setStep] = useState(1); // 1=search, 2=filters, 3=results
  const [filterOptions, setFilterOptions] = useState([]); // API filters
  const [listings, setListings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ average: 0, median: 0, suggestedPrice: 0 });
  
  // Track the last search term that was actually searched
  const [lastSearchedTerm, setLastSearchedTerm] = useState("");
  
  // Drill-down history: stack of price ranges
  const [drillHistory, setDrillHistory] = useState([]);

  const [selectedFilters, setSelectedFilters] = useState({
    basic: ["Completed & Sold", "Used", "UK Only"],
    apiFilters: {}, // eBay API filters
  });

  // --- Fetch eBay filters (initial) ---
  const fetchEbayFilters = async (term) => {
    try {
      const res = await fetch(`/api/ebay/filters/?q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error('Failed to fetch filters');
      const data = await res.json();
      
      // Sort each filter's options by count (highest first)
      const sortedFilters = (data.filters || []).map(filter => {
        if (filter.type === 'checkbox' && filter.options) {
          return {
            ...filter,
            options: [...filter.options].sort((a, b) => {
              const countA = a.count || 0;
              const countB = b.count || 0;
              return countB - countA; // Descending order
            })
          };
        }
        return filter;
      });
      
      setFilterOptions(sortedFilters);
    } catch (err) {
      console.error('Error fetching eBay filters:', err);
      setFilterOptions([]);
    }
  };

  // --- Refresh filters from URL (like refreshFilters in JS version) ---
  const refreshFiltersFromUrl = async (url) => {
    try {
      const res = await fetch(`/api/ebay/filters/?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error('Failed to refresh filters');
      const data = await res.json();
      
      // Sort each filter's options by count (highest first)
      const sortedFilters = (data.filters || []).map(filter => {
        if (filter.type === 'checkbox' && filter.options) {
          return {
            ...filter,
            options: [...filter.options].sort((a, b) => {
              const countA = a.count || 0;
              const countB = b.count || 0;
              return countB - countA; // Descending order
            })
          };
        }
        return filter;
      });
      
      // update counts / options but keep selectedFilters.apiFilters
      setFilterOptions(sortedFilters);
    } catch (err) {
      console.error('Error refreshing filters:', err);
    }
  };

  const calculateStats = (listingsData) => {
    if (!listingsData || listingsData.length === 0) {
      return { average: 0, median: 0, suggestedPrice: 0 };
    }

    const prices = listingsData.map(item => item.price).filter(p => p != null);
    
    if (prices.length === 0) {
      return { average: 0, median: 0, suggestedPrice: 0 };
    }

    // Calculate average
    const sum = prices.reduce((acc, price) => acc + price, 0);
    const average = sum / prices.length;

    // Calculate median
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sortedPrices.length / 2);
    const median = sortedPrices.length % 2 === 0
      ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
      : sortedPrices[mid];

    // Calculate suggested price: £1 below if median is odd, £2 below if even
    const medianRounded = Math.round(median);
    const adjustment = medianRounded % 2 === 0 ? 2 : 1;
    const suggestedPrice = median - adjustment;

    return {
      average: average.toFixed(2),
      median: median.toFixed(2),
      suggestedPrice: suggestedPrice.toFixed(2)
    };
  };

  const handleNext = async () => {
    if (!searchTerm.trim()) return;
    
    // Check if the search term has actually changed
    const termChanged = searchTerm.trim() !== lastSearchedTerm;
    
    // Step 1: Initial search - need to fetch filters
    if (step === 1) {
      if (termChanged) {
        // Reset everything when the search term changes
        setListings(null);
        setStats({ average: 0, median: 0, suggestedPrice: 0 });
        setFilterOptions([]);
        setSelectedFilters(prev => ({
          ...prev,
          apiFilters: {} // Wipe the technical filters, keep basic ones like "UK Only"
        }));
        setLastSearchedTerm(searchTerm.trim());
      }
      
      setLoading(true);
      try {
        // Fetch filters for this search term
        await fetchEbayFilters(searchTerm);
        setStep(2);
      } catch (err) {
        console.error('Error fetching filters:', err);
      } finally {
        setLoading(false);
      }
    }
    // Step 3: User wants to re-search with updated filters
    else if (step === 3) {
      if (termChanged) {
        // If term changed, reset and go back to step 2 to get new filters
        setListings(null);
        setStats({ average: 0, median: 0, suggestedPrice: 0 });
        setFilterOptions([]);
        setSelectedFilters(prev => ({
          ...prev,
          apiFilters: {}
        }));
        setLastSearchedTerm(searchTerm.trim());
        
        setLoading(true);
        try {
          await fetchEbayFilters(searchTerm);
          setStep(2);
        } catch (err) {
          console.error('Error fetching filters:', err);
        } finally {
          setLoading(false);
        }
      } else {
        // Same term, just updating filters - go straight to scraping
        setLoading(true);
        try {
          const ebayUrl = buildEbayUrl(searchTerm, selectedFilters.apiFilters, category?.path);

          const response = await sendExtensionMessage({
            action: "scrape",
            data: {
              directUrl: ebayUrl,
              competitors: ["eBay"],
              ebayFilterSold: selectedFilters.basic.includes("Completed & Sold"),
              ebayFilterUKOnly: selectedFilters.basic.includes("UK Only"),
              ebayFilterUsed: selectedFilters.basic.includes("Used"),
              apiFilters: selectedFilters.apiFilters
            }
          });

          if (response.success) {
            setListings([...response.results].sort((a, b) => a.price - b.price));
            setStats(calculateStats(response.results));
            // Stay on step 3
          } else {
            alert("Scraping failed: " + (response.error || "Unknown error"));
          }
        } catch (err) {
          console.error("Scraping error:", err);
        } finally {
          setLoading(false);
        }
      }
    }
    // Step 2: Apply filters and scrape
    else if (step === 2) {
      setLoading(true);
      try {
        const ebayUrl = buildEbayUrl(searchTerm, selectedFilters.apiFilters, category?.path);

        const response = await sendExtensionMessage({
          action: "scrape",
          data: {
            directUrl: ebayUrl,
            competitors: ["eBay"],
            ebayFilterSold: selectedFilters.basic.includes("Completed & Sold"),
            ebayFilterUKOnly: selectedFilters.basic.includes("UK Only"),
            ebayFilterUsed: selectedFilters.basic.includes("Used"),
            apiFilters: selectedFilters.apiFilters
          }
        });

        if (response.success) {
          setListings([...response.results].sort((a, b) => a.price - b.price));
          setStats(calculateStats(response.results));
          setStep(3);
        } else {
          alert("Scraping failed: " + (response.error || "Unknown error"));
        }
      } catch (err) {
        console.error("Scraping error:", err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleApiFilterChange = (filterName, value, type, rangeKey) => {
    setSelectedFilters(prev => {
      const newFilters = { ...prev.apiFilters };
      if (type === 'checkbox') {
        if (!Array.isArray(newFilters[filterName])) newFilters[filterName] = [];
        if (value.checked) {
          newFilters[filterName].push(value.label);
        } else {
          newFilters[filterName] = newFilters[filterName].filter(v => v !== value.label);
          if (newFilters[filterName].length === 0) delete newFilters[filterName];
        }
      } else if (type === 'range') {
        if (!newFilters[filterName]) newFilters[filterName] = {};
        newFilters[filterName][rangeKey] = value;
      }
      return { ...prev, apiFilters: newFilters };
    });
  };

  const handleDrillDown = (rangeStart, rangeEnd) => {
    // Add current range to history and drill down
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  };

  const handleZoomOut = () => {
    // Remove the last drill level
    setDrillHistory(prev => prev.slice(0, -1));
  };

  // Get current price range (latest in history, or null for full view)
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  
  // Filter listings based on current drill level
  const displayedListings = React.useMemo(() => {
    if (!listings) return null;
    if (!currentPriceRange) return listings;

    return listings.filter(item => {
      const price = typeof item.price === 'string' 
        ? parseFloat(item.price.replace(/[^0-9.]/g, '')) 
        : item.price;
      return price >= currentPriceRange.min && price <= currentPriceRange.max;
    });
  }, [listings, currentPriceRange]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6">
      <div className="bg-white w-full max-w-6xl h-full max-h-[850px] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-blue-200">
        {/* Header */}
        <header className="bg-blue-900 px-6 py-4 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-1.5 rounded">
              <Icon name="search_insights" className="text-yellow-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold">eBay Market Research</h2>
              <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                Real-time valuation lookup
              </p>
            </div>
          </div>
          <button className="text-white/60 hover:text-white transition-colors p-1" onClick={() => onComplete?.()}>
            <Icon name="close" />
          </button>
        </header>

        {/* Search Input */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-100/50">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">search</span>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-200 focus:border-blue-900 outline-none shadow-sm"
              placeholder="Search eBay listings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={handleNext} disabled={loading}>
                {loading ? "Loading..." : (step === 1 ? "Next" : "Search")}
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar filters */}
          {step >= 2 && (
            <aside className="w-64 border-r border-gray-200 overflow-y-auto bg-white p-4 space-y-6">
              {/* Basic Filters */}
              <div>
                <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Basic Filters</h3>
                <div className="space-y-2">
                  {["Completed & Sold", "Used", "UK Only"].map((filter) => (
                    <label key={filter} className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                        checked={selectedFilters.basic.includes(filter)}
                        onChange={(e) => {
                          const newBasic = e.target.checked
                            ? [...selectedFilters.basic, filter]
                            : selectedFilters.basic.filter(f => f !== filter);
                          setSelectedFilters(prev => ({ ...prev, basic: newBasic }));
                        }}
                      />
                      <span>{filter}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* API Filters */}
              {filterOptions.length > 0 && filterOptions.map((filter) => (
                <div key={filter.name} className="pt-4 border-t border-gray-200">
                  <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">{filter.name}</h3>
                  <div className="space-y-2">
                    {filter.type === "checkbox" && filter.options.map(option => (
                      <label key={option.label} className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                          checked={selectedFilters.apiFilters[filter.name]?.includes(option.label) || false}
                          onChange={(e) => handleApiFilterChange(filter.name, { label: option.label, checked: e.target.checked }, 'checkbox')}
                        />
                        <span>{option.label} {option.count ? `(${option.count})` : ""}</span>
                      </label>
                    ))}

                    {filter.type === "range" && (
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          className="w-full p-2 border rounded text-xs focus:ring-blue-900"
                          value={selectedFilters.apiFilters[filter.name]?.min || ""}
                          onChange={(e) => handleApiFilterChange(filter.name, e.target.value, 'range', 'min')}
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          className="w-full p-2 border rounded text-xs focus:ring-blue-900"
                          value={selectedFilters.apiFilters[filter.name]?.max || ""}
                          onChange={(e) => handleApiFilterChange(filter.name, e.target.value, 'range', 'max')}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </aside>
          )}

          {/* Listings */}
          {step === 3 && listings && (
            <main className="flex-1 overflow-y-auto bg-gray-100 p-6">

              {/* Breadcrumb Navigation */}
              {drillHistory.length > 0 && (
                <div className="mb-4 flex items-center gap-2 text-xs font-medium">
                  <button 
                    onClick={() => setDrillHistory([])}
                    className="text-blue-900 hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">home</span>
                    All Prices
                  </button>
                  {drillHistory.map((range, idx) => (
                    <React.Fragment key={idx}>
                      <span className="text-gray-400">/</span>
                      <button 
                        onClick={() => setDrillHistory(drillHistory.slice(0, idx + 1))}
                        className={`${
                          idx === drillHistory.length - 1 
                            ? 'text-gray-900 font-bold' 
                            : 'text-blue-900 hover:underline'
                        }`}
                      >
                        £{range.min.toFixed(0)} - £{range.max.toFixed(0)}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* --- HISTOGRAM COMPONENT --- */}
              <div className="animate-histogram-slide">
                <PriceHistogram 
                  listings={listings} 
                  onBucketSelect={handleDrillDown}
                  priceRange={currentPriceRange}
                  onGoBack={handleZoomOut}
                  drillLevel={drillHistory.length}
                />
              </div>
              {/* ------------------------------- */}

              <div className="grid grid-cols-2 gap-4">
                {displayedListings && displayedListings.map((item, idx) => (
                  <div 
                    key={`${item.title}-${idx}`} 
                    className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 hover:shadow-md transition-all duration-300"
                    style={{ 
                      animationDelay: `${idx * 20}ms`,
                      opacity: 0,
                      animation: 'fadeInUp 0.4s ease-out forwards'
                    }}
                  >
                    <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden rounded-lg">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.title || "eBay listing"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-xs text-gray-500">No image</span>
                      )}
                    </div>
                    <div className="flex flex-col justify-between flex-1">
                      <div>
                        <h4 className="text-sm font-bold text-blue-900 line-clamp-2 leading-tight cursor-pointer hover:underline">{item.title}</h4>
                        {item.sold && (
                          <p className="text-[11px] text-green-600 font-bold mt-1">{item.sold}</p>
                        )}
                      </div>
                      <div className="flex items-end justify-between mt-2">
                        <div>
                          <p className="text-lg font-extrabold text-gray-900 leading-none">£{item.price}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </main>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-gray-200 bg-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Average</span>
              <span className="text-lg font-extrabold text-blue-900">£{stats.average}</span>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Median</span>
              <span className="text-lg font-extrabold text-blue-900">£{stats.median}</span>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Suggested Sale Price</span>
              <span className="text-lg font-extrabold text-green-600">£{stats.suggestedPrice}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="md" onClick={() => onComplete?.()}>Cancel</Button>
            {step === 3 && (
              <Button variant="primary" size="md" onClick={() => onComplete?.({ searchTerm, selectedFilters, listings, stats })}>
                <Icon name="save" className="text-sm" />
                Apply Research Data
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}