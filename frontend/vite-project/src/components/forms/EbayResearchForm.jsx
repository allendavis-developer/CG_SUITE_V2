import React, { useState } from 'react';
import { Button, Icon } from '../ui/components';

// --- Mock API calls ---
const fetchFilterOptions = async () => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        conditions: ["New", "Open Box", "Pre-owned"],
        listingTypes: ["Sold Listings", "Active Listings"],
      });
    }, 500);
  });
};

const fetchListings = async (searchTerm, filters) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve([
        { title: "Apple iPhone 15 Pro - 256GB - Natural Titanium", condition: "Pre-owned", price: 899, shipping: 12.5, status: "Sold" },
        { title: "iPhone 15 Pro 256GB Blue Titanium - Excellent Condition", condition: "Open Box", price: 945, shipping: 0, status: "Sold" },
        { title: "Apple iPhone 15 Pro - 256GB - White Titanium", condition: "Pre-owned", price: 872, shipping: 9.99, status: "Sold" },
        { title: "Brand New Sealed Apple iPhone 15 Pro 256GB Black", condition: "New", price: 1049, shipping: 0, status: "Sold" },
      ]);
    }, 700);
  });
};

// --- Component ---
export default function EbayResearchForm({ onComplete }) {
  const [searchTerm, setSearchTerm] = useState("iPhone 15 Pro");
  const [step, setStep] = useState(1); // 1=search, 2=filters, 3=results
  const [filterOptions, setFilterOptions] = useState(null);
  const [listings, setListings] = useState(null);
  const [loading, setLoading] = useState(false);

  // Selected filters
  const [selectedFilters, setSelectedFilters] = useState({
    basic: ["Completed & Sold", "Used", "UK Only"], // always shown defaults
    condition: [],
    listingType: "Sold Listings",
    freeShipping: false,
    priceRange: { min: "", max: "" },
  });

  // --- Handle step transitions ---
  const handleNext = async () => {
    if (step === 1) {
      setLoading(true);
      const filters = await fetchFilterOptions();
      setFilterOptions(filters);

      // Initialize conditions if empty
      setSelectedFilters(prev => ({
        ...prev,
        condition: prev.condition.length ? prev.condition : filters.conditions,
      }));

      setStep(2);
      setLoading(false);
    } else if (step === 2) {
      setLoading(true);
      const results = await fetchListings(searchTerm, selectedFilters);
      setListings(results);
      setStep(3);
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setSelectedFilters(prev => ({
      ...prev,
      [key]: value,
    }));
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
              {/* --- Basic Filters (always show) --- */}
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
                          handleFilterChange("basic", newBasic);
                        }}
                      />
                      <span>{filter}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* --- API filters --- */}
              {filterOptions && (
                <>
                  <div>
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Condition</h3>
                    <div className="space-y-2">
                      {filterOptions.conditions.map((cond) => (
                        <label key={cond} className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                            checked={selectedFilters.condition.includes(cond)}
                            onChange={(e) => {
                              const newConditions = e.target.checked
                                ? [...selectedFilters.condition, cond]
                                : selectedFilters.condition.filter(c => c !== cond);
                              handleFilterChange("condition", newConditions);
                            }}
                          />
                          <span>{cond}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Price Range</h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Min"
                        className="w-full p-2 border rounded text-xs focus:ring-blue-900"
                        value={selectedFilters.priceRange.min}
                        onChange={(e) => handleFilterChange("priceRange", { ...selectedFilters.priceRange, min: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Max"
                        className="w-full p-2 border rounded text-xs focus:ring-blue-900"
                        value={selectedFilters.priceRange.max}
                        onChange={(e) => handleFilterChange("priceRange", { ...selectedFilters.priceRange, max: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Listing Type</h3>
                    <div className="space-y-2">
                      {filterOptions.listingTypes.map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name="listing-type"
                            className="text-blue-900 focus:ring-blue-900"
                            checked={selectedFilters.listingType === type}
                            onChange={() => handleFilterChange("listingType", type)}
                          />
                          <span>{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Shipping</h3>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                        checked={selectedFilters.freeShipping}
                        onChange={(e) => handleFilterChange("freeShipping", e.target.checked)}
                      />
                      <span>Free Shipping</span>
                    </label>
                  </div>
                </>
              )}
            </aside>
          )}

          {/* Listings */}
          {step === 3 && listings && (
            <main className="flex-1 overflow-y-auto bg-gray-100 p-6">
              <div className="grid grid-cols-2 gap-4">
                {listings.map((item, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4 hover:shadow-md transition-shadow">
                    <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-500">
                      Image
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
