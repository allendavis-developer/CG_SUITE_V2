import { useState, useEffect, useMemo, useCallback } from 'react';
import { scrapeEbay } from '@/services/extensionClient';

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

function roundToNearestFive(value) {
  return Math.round(value / 5) * 5;
}

function calculateBuyOffers(sellPrice) {
  if (!sellPrice || sellPrice <= 0) return [];

  const margins = [0.6, 0.5, 0.4];

  return margins.map(margin => ({
    margin,
    price: roundToNearestFive(sellPrice * (1 - margin))
  }));
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
      console.log("Successfully found a mapping for this category on eBay, data is better");
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

function calculateStats(listingsData) {
  if (!listingsData || listingsData.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0 };
  }

  const prices = listingsData.map(item => item.price).filter(p => p != null);
  if (prices.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0 };
  }

  const sum = prices.reduce((acc, price) => acc + price, 0);
  const averageRaw = sum / prices.length;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const medianRaw = sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];

  // Round intelligently to market-friendly pricing
  const average = roundToNearestFive(averageRaw);
  const median = roundToNearestFive(medianRaw);

  // Undercut slightly but stay on £5 grid
  const suggestedPrice = Math.max(
    roundToNearestFive(median - 5),
    0
  );

  return {
    average,
    median,
    suggestedPrice
  };
}

/**
 * Hook for eBay research data management
 * 
 * Handles all eBay-specific logic:
 * - Category mapping
 * - URL building
 * - Filter fetching
 * - Scraping
 * - Stats calculation
 * - State management
 * 
 * @param {Object} category - Category object with path array
 * @param {Object} savedState - Previously saved state to restore
 * @returns {Object} Research data and handlers
 */
export function useEbayResearch(category, savedState = null) {
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
  const [showHistogram, setShowHistogram] = useState(savedState?.showHistogram ?? false);
  
  // Manual offer from negotiation page
  const [manualOffer, setManualOffer] = useState(savedState?.manualOffer || "");

  const [selectedFilters, setSelectedFilters] = useState(savedState?.selectedFilters || {
    basic: ["Completed & Sold", "Used", "UK Only"],
    apiFilters: {}, // eBay API filters
  });

  // --- Fetch eBay filters (initial) ---
  const fetchEbayFilters = useCallback(async (term) => {
    try {
      // Build URL with category path if available
      let url = `/api/ebay/filters/?q=${encodeURIComponent(term)}`;
      if (category?.path && Array.isArray(category.path)) {
        category.path.forEach(pathSegment => {
          url += `&category_path=${encodeURIComponent(pathSegment)}`;
        });
      }
      
      const res = await fetch(url);
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
  }, [category?.path]);

  const handleSearch = useCallback(async () => {
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
  }, [searchTerm, lastSearchedTerm, selectedFilters, category?.path, behaveAsEbay, fetchEbayFilters]);

  const handleApiFilterChange = useCallback((filterName, value, type, rangeKey) => {
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
  }, []);

  const handleBasicFilterChange = useCallback((filter, checked) => {
    const newBasic = checked
      ? [...selectedFilters.basic, filter]
      : selectedFilters.basic.filter(f => f !== filter);
    setSelectedFilters(prev => ({ ...prev, basic: newBasic }));
  }, [selectedFilters.basic]);

  const handleDrillDown = useCallback((rangeStart, rangeEnd) => {
    // Add current range to history and drill down
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  }, []);

  const handleZoomOut = useCallback(() => {
    // Remove the last drill level
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    // Navigate to a specific drill level (0 = all prices, 1 = first drill, etc.)
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  // Get current price range (latest in history, or null for full view)
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  
  // Filter listings based on current drill level - PROPERLY MEMOIZED
  const displayedListings = useMemo(() => {
    if (!listings) return null;
    if (!currentPriceRange) return listings;

    return listings.filter(item => {
      const price = typeof item.price === 'string' 
        ? parseFloat(item.price.replace(/[^0-9.]/g, '')) 
        : item.price;
      return price >= currentPriceRange.min && price <= currentPriceRange.max;
    });
  }, [listings, currentPriceRange]);

  // Calculate stats based on displayed listings (filtered by current drill level) - PROPERLY MEMOIZED
  const displayedStats = useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) {
      return stats; // Fallback to overall stats if no filtered listings
    }
    return calculateStats(displayedListings);
  }, [displayedListings, stats]);

  // Calculate buy offers from displayed stats
  const buyOffers = useMemo(() => {
    return calculateBuyOffers(displayedStats.suggestedPrice);
  }, [displayedStats.suggestedPrice]);

  // Helper to get current complete state for saving - MEMOIZED
  const getCurrentState = useCallback(() => {
    return {
      searchTerm,
      filterOptions,
      listings: listings ?? [],
      stats: displayedStats,
      buyOffers,          
      lastSearchedTerm,
      drillHistory,
      behaveAsEbay,
      selectedFilters,
      showHistogram,
      manualOffer
    };
  }, [searchTerm, filterOptions, listings, displayedStats, buyOffers, lastSearchedTerm, drillHistory, behaveAsEbay, selectedFilters, showHistogram, manualOffer]);

  return {
    // State
    searchTerm,
    filterOptions,
    listings,
    displayedListings,
    stats,
    displayedStats,
    loading,
    selectedFilters,
    showHistogram,
    drillHistory,
    behaveAsEbay,
    buyOffers,
    manualOffer,
    
    // Handlers
    setSearchTerm,
    handleSearch,
    handleBasicFilterChange,
    handleApiFilterChange,
    setShowHistogram,
    handleDrillDown,
    handleZoomOut,
    setBehaveAsEbay,
    setManualOffer,
    
    // Utilities
    getCurrentState,
    handleNavigateToDrillLevel,
  };
}
