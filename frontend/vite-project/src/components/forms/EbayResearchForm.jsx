import React, { useState } from 'react';
import { Button, Icon } from '../ui/components';

// --- Mock listings ---
const mockListings = [
  { title: "Apple iPhone 15 Pro - 256GB - Natural Titanium", condition: "Pre-owned", price: 899, shipping: 12.5, status: "Sold" },
  { title: "iPhone 15 Pro 256GB Blue Titanium - Excellent Condition", condition: "Open Box", price: 945, shipping: 0, status: "Sold" },
  { title: "Apple iPhone 15 Pro - 256GB - White Titanium", condition: "Pre-owned", price: 872, shipping: 9.99, status: "Sold" },
  { title: "Brand New Sealed Apple iPhone 15 Pro 256GB Black", condition: "New", price: 1049, shipping: 0, status: "Sold" },
];

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


function buildEbayUrl(searchTerm, filters) {
  const baseUrl = "https://www.ebay.co.uk/sch/i.html";

  const params = {
    _nkw: searchTerm.replace(/ /g, "+"),
    _sacat: "0",
    _from: "R40"
  };

  Object.entries(filters || {}).forEach(([filterName, value]) => {
    if (Array.isArray(value)) {
      const doubleEncodedKey = encodeURIComponent(encodeURIComponent(filterName));
      const doubleEncodedValue = value
        .map(v => encodeURIComponent(encodeURIComponent(v)))
        .join("|");
      params[doubleEncodedKey] = doubleEncodedValue;
    } else if (typeof value === "object") {
      const doubleEncodedKey = encodeURIComponent(encodeURIComponent(filterName));
      if (value.min) params[`${doubleEncodedKey}_min`] = encodeURIComponent(encodeURIComponent(value.min));
      if (value.max) params[`${doubleEncodedKey}_max`] = encodeURIComponent(encodeURIComponent(value.max));
    } else {
      const doubleEncodedKey = encodeURIComponent(encodeURIComponent(filterName));
      params[doubleEncodedKey] = encodeURIComponent(encodeURIComponent(value));
    }
  });

  const queryString = Object.entries(params)
    .map(([key, val]) => `${key}=${val}`)
    .join("&");

  return `${baseUrl}?${queryString}`;
}



export default function EbayResearchForm({ onComplete }) {
  const [searchTerm, setSearchTerm] = useState("iPhone 15 Pro");
  const [step, setStep] = useState(1); // 1=search, 2=filters, 3=results
  const [filterOptions, setFilterOptions] = useState([]); // API filters
  const [listings, setListings] = useState(null);
  const [loading, setLoading] = useState(false);

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
      setFilterOptions(data.filters || []);
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
      // update counts / options but keep selectedFilters.apiFilters
      setFilterOptions(data.filters || []);
    } catch (err) {
      console.error('Error refreshing filters:', err);
    }
  };

  const handleNext = async () => {
    if (step === 1) {
      setLoading(true);
      await fetchEbayFilters(searchTerm);
      setStep(2);
      setLoading(false);
    } else if (step === 2) {
      setLoading(true);

      try {
        // Build eBay URL from search term and API filters
        const ebayUrl = buildEbayUrl(searchTerm, selectedFilters.apiFilters);

        // Get top-level basic filters
        const ebayFilterSold = selectedFilters.basic.includes("Completed & Sold");
        const ebayFilterUKOnly = selectedFilters.basic.includes("UK Only");
        const ebayFilterUsed = selectedFilters.basic.includes("Used");

        // Call the extension to scrape real eBay listings
        const response = await sendExtensionMessage({
          action: "scrape",
          data: {
            directUrl: ebayUrl,
            competitors: ["eBay"],
            ebayFilterSold,
            ebayFilterUKOnly,
            ebayFilterUsed,
            apiFilters: selectedFilters.apiFilters
          }
        });

        if (response.success) {
          console.log(response.results);
          setListings(response.results); // Replace mockListings
          setStep(3);                    // Move to results step
        } else {
          alert("Scraping failed: " + (response.error || "Unknown error"));
        }

      } catch (err) {
        console.error("Scraping error:", err);
        alert("Error running scraper: " + err.message);
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
                {loading ? "Loading..." : (step === 1 || step === 2 ? "Next" : "Search")}
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
              <div className="grid grid-cols-2 gap-4">
                {listings.map((item, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 hover:shadow-md transition-shadow">
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
                        <p className="text-[11px] text-gray-500 mt-1">Condition: <span className="text-text-main font-medium">{item.condition}</span></p>
                        <p className="text-[11px] text-green-600 font-bold mt-1">{item.status}</p>
                      </div>
                      <div className="flex items-end justify-between mt-2">
                        <div>
                          <p className="text-lg font-extrabold text-gray-900 leading-none">${item.price}</p>
                          <p className="text-[10px] text-gray-500 mt-1">{item.shipping > 0 ? `+ $${item.shipping} shipping` : "Free Shipping"}</p>
                        </div>
                        <Button variant="secondary" size="sm">Select Price</Button>
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
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Market Avg (256GB)</span>
              <span className="text-lg font-extrabold text-blue-900">$916.25</span>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Suggested Buy-in</span>
              <span className="text-lg font-extrabold text-green-600">$641.38</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="md" onClick={() => onComplete?.()}>Cancel</Button>
            {step === 3 && (
              <Button variant="primary" size="md" onClick={() => onComplete?.({ searchTerm, selectedFilters, listings })}>
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
