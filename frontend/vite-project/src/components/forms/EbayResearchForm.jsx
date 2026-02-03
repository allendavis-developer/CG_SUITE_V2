import React, { useState } from 'react';
import { Button, Icon } from '../ui/components';
import { scrapeEbay } from '@/services/extensionClient';

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
  
  /* Custom scrollbar for histogram */
  .histogram-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  
  .histogram-scrollbar::-webkit-scrollbar-track {
    background: #f1f5f9;
    border-radius: 4px;
  }
  
  .histogram-scrollbar::-webkit-scrollbar-thumb {
    background: #1e3a8a;
    border-radius: 4px;
    transition: background 0.2s;
  }
  
  .histogram-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #1e40af;
  }
`;

// Inject styles into document
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = fadeInUpAnimation;
  document.head.appendChild(styleElement);
}

const BASIC_FILTER_OPTIONS = [
  "Used",
  "UK Only",
  "Sold items",
  "Completed items",
];


const EBAY_CATEGORY_MAP = {
  "phones": "9355",
  "games": "139973",
  "tablets": "58058",
  "laptops": "175672",
  "gaming consoles": "139971",
  "guitars & basses": "3858",
};

function parseSoldDate(soldStr) {
  if (!soldStr) return null;
  const datePart = soldStr.replace(/^Sold\s+/, '').trim(); // "1 Feb 2026"
  const parsed = new Date(datePart);
  return isNaN(parsed) ? null : parsed;
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
    <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm transition-all duration-500 flex flex-col">
      {/* Header Section */}
      <div className="p-4 border-b border-gray-200">
        <div className="mb-4">
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
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-bold hover:bg-blue-800 transition-all transform hover:scale-105 shadow-md w-full justify-center mb-4"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Zoom Out
          </button>
        )}
        
        <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
          <label className="text-[10px] font-bold text-blue-900 uppercase">
            Buckets: {bucketCount}
          </label>
          <input 
            type="range" 
            min="5" 
            max="20" 
            value={bucketCount}
            onChange={(e) => setBucketCount(parseInt(e.target.value))}
            className="w-full h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-900"
          />
        </div>
      </div>
      
      {/* Chart Area - Vertical */}
      <div className="flex-1 flex flex-col gap-1.5 p-4 overflow-y-auto histogram-scrollbar">
        {buckets.slice().reverse().map((bucket, i) => {
          const reverseIndex = buckets.length - 1 - i;
          const widthPct = maxFreq > 0 ? (bucket.count / maxFreq) * 100 : 0;
          
          return (
            <div 
              key={reverseIndex} 
              className={`flex items-center gap-2 relative group transition-all duration-500 ${
                bucket.count > 0 ? 'cursor-pointer' : ''
              }`}
              onClick={() => bucket.count > 0 && onBucketSelect(bucket.rangeStart, bucket.rangeEnd)}
              style={{
                transform: `scale(${bucket.count > 0 ? 1 : 0.95})`,
                opacity: bucket.count > 0 ? 1 : 0.3
              }}
            >
              {/* The Bar */}
              <div className="flex-1 flex items-center justify-end">
                {/* Frequency Label (Left of bar) */}
                {bucket.count > 0 && (
                  <span 
                    className="text-[10px] font-black text-blue-900 mr-2 transition-all duration-300 group-hover:scale-125"
                  >
                    {bucket.count}
                  </span>
                )}
                
                <div 
                  className={`h-6 transition-all duration-500 ${
                    bucket.count > 0 
                      ? 'bg-yellow-400 group-hover:bg-blue-900 group-hover:shadow-lg shadow-sm'
                      : 'bg-gray-50'
                  }`}
                  style={{ 
                    width: bucket.count > 0 ? `${Math.max(widthPct, 4)}%` : '2px',
                    transform: 'scaleX(1)',
                    transformOrigin: 'right'
                  }}
                />
              </div>
              
              {/* Price Range Label (Right side) - Expanded width */}
              <div className="text-blue-900 font-bold text-[10px] whitespace-nowrap w-28 text-left pl-2">
                £{bucket.rangeStart.toFixed(0)} - £{bucket.rangeEnd.toFixed(0)}
              </div>
              
              {/* Tooltip on Hover */}
              {bucket.count > 0 && (
                <div className="absolute right-full mr-4 hidden group-hover:flex items-center z-10">
                  <div className="bg-blue-900 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                    £{bucket.rangeStart.toFixed(0)} - £{bucket.rangeEnd.toFixed(0)}
                    <div className="text-[9px] text-yellow-400 font-bold mt-0.5">🔍 Click to drill down</div>
                  </div>
                  <div className="w-2 h-2 bg-blue-900 rotate-45 -mr-1"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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

function buildEbayUrl(searchTerm, filters, categoryPath, behaveAsEbay = false) {
  // If behaveAsEbay is true, ignore category mapping
  const categoryId = behaveAsEbay ? null : resolveEbayCategory(categoryPath);
  
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


export default function EbayResearchForm({ onComplete, category, mode = "modal", savedState = null }) {
  // Initialize state from savedState if available
  const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || "");
  const [filterOptions, setFilterOptions] = useState(savedState?.filterOptions || []); // API filters
  const [listings, setListings] = useState(savedState?.listings || null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(savedState?.stats || { average: 0, median: 0, suggestedPrice: 0 });
  
  // Track the last search term that was actually searched
  const [lastSearchedTerm, setLastSearchedTerm] = useState(savedState?.lastSearchedTerm || "");
  
  // Drill-down history: stack of price ranges
  const [drillHistory, setDrillHistory] = useState(savedState?.drillHistory || []);
  
  // Behave like eBay mode - when true, ignore category mapping
  const [behaveAsEbay, setBehaveAsEbay] = useState(savedState?.behaveAsEbay || false);
  
  // Histogram visibility
  const [showHistogram, setShowHistogram] = useState(savedState?.showHistogram ?? true);

  const [selectedFilters, setSelectedFilters] = useState(savedState?.selectedFilters || {
    basic: ["Completed & Sold", "Used", "UK Only"],
    apiFilters: {}, // eBay API filters
  });

  // --- Fetch eBay filters (initial) ---
  const fetchEbayFilters = async (term) => {
    try {
      const res = await fetch(`/api/ebay/filters/?q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error('Failed to fetch filters');
      const data = await res.json();

          console.log(
            data.filters.map(f => ({
              name: f.name,
              options: f.options?.map(o => o.label)
            }))
          );

      const cleanedFilters = (data.filters || [])
        .map(filter => {
          if (filter.type !== "checkbox" || !filter.options) return filter;

          const cleanedOptions = filter.options.filter(
            option => !BASIC_FILTER_OPTIONS.includes(option.label)
          );

          // 🔥 If a filter has no options left, drop it entirely
          if (cleanedOptions.length === 0) return null;

          return {
            ...filter,
            options: cleanedOptions.sort((a, b) => {
              const countA = a.count || 0;
              const countB = b.count || 0;
              return countB - countA;
            })
          };
        })
        .filter(Boolean); // remove nulls


      setFilterOptions(cleanedFilters);
    } catch (err) {
      console.error('Error fetching eBay filters:', err);
      setFilterOptions([]);
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

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    
    const termChanged = searchTerm.trim() !== lastSearchedTerm;
    
    // If search term changed, reset filters and fetch everything fresh
    if (termChanged) {
      setListings(null);
      setStats({ average: 0, median: 0, suggestedPrice: 0 });
      setFilterOptions([]);
      setSelectedFilters(prev => ({
        ...prev,
        apiFilters: {} // Reset API filters when searching new term
      }));
      setLastSearchedTerm(searchTerm.trim());
      setDrillHistory([]);
    }
    
    setLoading(true);
    
    try {
      // Fetch filters and listings in parallel
      const ebayUrl = buildEbayUrl(searchTerm, selectedFilters.apiFilters, category?.path, behaveAsEbay);
      
      const [_, scrapeResult] = await Promise.all([
        termChanged ? fetchEbayFilters(searchTerm) : Promise.resolve(),
        scrapeEbay({
          directUrl: ebayUrl,
          ebayFilterSold: selectedFilters.basic.includes("Completed & Sold"),
          ebayFilterUKOnly: selectedFilters.basic.includes("UK Only"),
          ebayFilterUsed: selectedFilters.basic.includes("Used"),
          apiFilters: selectedFilters.apiFilters,
        }),
      ]);

      if (scrapeResult.success) {
        const sortedByDate = [...scrapeResult.results].sort((a, b) => {
          const dateA = parseSoldDate(a.sold);
          const dateB = parseSoldDate(b.sold);
          return dateB - dateA;
        });

        setListings(sortedByDate);
        setStats(calculateStats(scrapeResult.results));
      } else {
        alert("Scraping failed: " + (scrapeResult.error || "Unknown error"));
      }

    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
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

  // Calculate stats based on displayed listings (filtered by current drill level)
  const displayedStats = React.useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) {
      return stats; // Fallback to overall stats if no filtered listings
    }
    return calculateStats(displayedListings);
  }, [displayedListings, stats]);

  // Helper to get current complete state for saving
  const getCurrentState = () => ({
    searchTerm,
    filterOptions,
    listings,
    stats,
    lastSearchedTerm,
    drillHistory,
    behaveAsEbay,
    selectedFilters,
    showHistogram
  });

  // Wrapper classes based on mode
  // TODO: Why do we have ebay research modal if we do this
  const wrapperClasses = mode === "modal"
    ? "fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm"
    : "";

  const containerClasses = mode === "modal"
    ? "bg-white w-full h-full flex flex-col overflow-hidden"
    : "bg-white w-full h-full flex flex-col overflow-hidden";

  // Stats component for reuse
  const StatsDisplay = () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Average</span>
        <span className="text-lg font-extrabold text-blue-900">£{displayedStats.average}</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Median</span>
        <span className="text-lg font-extrabold text-blue-900">£{displayedStats.median}</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Suggested Sale Price</span>
        <span className="text-lg font-extrabold text-green-600">£{displayedStats.suggestedPrice}</span>
      </div>
    </div>
  );

  const content = (
    <>
      {/* Header - Only show in modal mode */}
      {mode === "modal" && (
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
          <button className="text-white/60 hover:text-white transition-colors p-1" onClick={() => onComplete?.(getCurrentState())}>
            <Icon name="close" />
          </button>
        </header>
      )}

      {/* Stats at top - Only show in page mode when we have results */}
      {mode === "page" && listings && (
        <div className="px-6 py-4 border-b border-gray-200 bg-white">
          <StatsDisplay />
        </div>
      )}

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
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={handleSearch} disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </Button>
          </div>
        </div>
        
        <div className="mt-3 flex items-center gap-4">
          {/* Behave like eBay checkbox */}
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
              checked={behaveAsEbay}
              onChange={(e) => setBehaveAsEbay(e.target.checked)}
            />
            <span>Behave like eBay</span>
            <span className="text-[10px] text-gray-500">(ignore category-based search)</span>
          </label>
          
          {/* Show Histogram toggle */}
          {listings && (
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                checked={showHistogram}
                onChange={(e) => setShowHistogram(e.target.checked)}
              />
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">bar_chart</span>
                Show Price Distribution
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar filters */}
        {filterOptions.length > 0 && (
          <aside className="w-64 border-r border-gray-200 overflow-y-auto bg-white p-4 space-y-6 histogram-scrollbar">
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
            {filterOptions.map((filter) => (
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
            
            {/* Apply Filters Button */}
            <div className="pt-4 border-t border-gray-200">
              <Button 
                variant="primary" 
                size="md" 
                onClick={handleSearch} 
                disabled={loading}
                className="w-full"
              >
                {loading ? "Applying..." : "Apply Filters"}
              </Button>
            </div>
          </aside>
        )}

        {/* Listings */}
        {listings && (
          <main className="flex-1 overflow-y-auto bg-gray-100 flex">
            {/* Listings Column */}
            <div className="flex-1 overflow-y-auto p-6 histogram-scrollbar">
              {/* Breadcrumb Navigation */}
              {showHistogram && drillHistory.length > 0 && (
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

              <div className={`grid ${showHistogram ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                {displayedListings && displayedListings.map((item, idx) => (
                  <a
                    key={`${item.title}-${idx}`}
                    href={item.url}                // ✅ link to eBay
                    target="_blank"                // open in new tab
                    rel="noopener noreferrer"      // security best practice
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
                  </a>
                ))}
              </div>
            </div>

            {/* --- HISTOGRAM COMPONENT (Right Side) --- */}
            {showHistogram && (
              <aside className="w-80 border-l border-gray-200 overflow-hidden">
                <PriceHistogram 
                  listings={displayedListings} 
                  onBucketSelect={handleDrillDown}
                  priceRange={currentPriceRange}
                  onGoBack={handleZoomOut}
                  drillLevel={drillHistory.length}
                />
              </aside>
            )}
            {/* ------------------------------- */}
          </main>
        )}
      </div>

      {/* Footer - Only show in modal mode */}
      {mode === "modal" && (
        <footer className="px-6 py-4 border-t border-gray-200 bg-white flex justify-between items-center shrink-0">
          <StatsDisplay />
          <div className="flex gap-3">
            <Button variant="outline" size="md" onClick={() => onComplete?.(getCurrentState())}>Cancel</Button>
            {listings && (
              <Button variant="primary" size="md" onClick={() => onComplete?.(getCurrentState())}>
                <Icon name="save" className="text-sm" />
                Apply Research Data
              </Button>
            )}
          </div>
        </footer>
      )}
    </>
  );

  return mode === "modal" ? (
    <div className={wrapperClasses}>
      <div className={containerClasses}>
        {content}
      </div>
    </div>
  ) : (
    <div className={containerClasses}>
      {content}
    </div>
  );
}