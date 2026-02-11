import { useState, useEffect, useMemo, useCallback } from 'react';

// Flag to control pagination: set to true to fetch only first page, false to fetch all pages
const FETCH_ONLY_FIRST_PAGE = true;

const BASIC_FILTER_OPTIONS = [
  "Used",
  "UK Only",
  "Sold items",
  "Completed items",
];

// Cash Converters category path to URL mapping
// Maps category path segments (e.g., "phones", "games") to Cash Converters category identifiers
// For now, empty - will be populated with Cash Converters specific mappings later
const CASH_CONVERTERS_CATEGORY_MAP = {};

function parseSoldDate(soldStr) {
  if (!soldStr) return null;
  const datePart = soldStr.replace(/^Sold\s+/, '').trim();
  const parsed = new Date(datePart);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Determines the appropriate rounding increment based on the value
 * Returns a "nice number" that scales appropriately for cheap vs expensive items
 * @param {number} value - The value to determine rounding for
 * @returns {number} The rounding increment (e.g., 0.5, 1, 2, 5, 10, 50, 100)
 */
function getRoundingIncrement(value) {
  if (value < 5) return 0.5;      // For very cheap items (< £5): round to 50p
  if (value < 20) return 1;       // For cheap items (< £20): round to £1
  if (value < 50) return 2;       // For low items (< £50): round to £2
  if (value < 200) return 5;      // For medium items (< £200): round to £5
  if (value < 500) return 10;     // For higher items (< £500): round to £10
  if (value < 2000) return 50;    // For expensive items (< £2000): round to £50
  return 100;                     // For very expensive items (>= £2000): round to £100
}

/**
 * Rounds a value to the nearest increment
 * @param {number} value - The value to round
 * @param {number} increment - The rounding increment
 * @returns {number} The rounded value
 */
function roundToNearest(value, increment) {
  return Math.round(value / increment) * increment;
}

function calculateBuyOffers(sellPrice) {
  if (!sellPrice || sellPrice <= 0) return [];

  const margins = [0.6, 0.5, 0.4];
  const roundingIncrement = getRoundingIncrement(sellPrice);

  return margins.map(margin => ({
    margin,
    price: roundToNearest(sellPrice * (1 - margin), roundingIncrement)
  }));
}

/**
 * Finds the most specific Cash Converters category by checking path items from right-to-left
 * @param {Array} path - e.g., ["Electronics", "Mobile Phones", "Smartphones"]
 */
function resolveCashConvertersCategory(path) {
  if (!path || !Array.isArray(path)) return null;

  // Search from most specific (end of array) to most general (start)
  for (let i = path.length - 1; i >= 0; i--) {
    const segment = path[i].toLowerCase();
    if (CASH_CONVERTERS_CATEGORY_MAP[segment]) {
      console.log("Successfully found a mapping for this category on Cash Converters, data is better");
      return CASH_CONVERTERS_CATEGORY_MAP[segment];
    }
  }
  console.log("Could not find a mapping for this category at all ", path);
  
  return null;
}

/**
 * Build Cash Converters public search results URL for scraping
 * Format: https://www.cashconverters.co.uk/search-results?Sort=default&page=1&query=xbox%20series%20x&f[category][0]=all&f[locations][0]=all&f[Model Name][0]=Xbox Series X
 * 
 * @param {string} searchTerm - Search query
 * @param {Object} apiFilters - Selected API filters in format: { "Filter Name": ["Value1", "Value2"] }
 * @param {Array} categoryPath - Category path array
 * @param {boolean} behaveAsGeneric - Whether to ignore category mapping
 */
function buildCashConvertersScrapeUrl(searchTerm, apiFilters, categoryPath, behaveAsGeneric = false) {
  // If behaveAsGeneric is true, ignore category mapping
  const categoryId = behaveAsGeneric ? null : resolveCashConvertersCategory(categoryPath);
  
  // Build public-facing search results page URL (for scraping)
  const baseUrl = "https://www.cashconverters.co.uk/search-results";
  
  const params = {
    Sort: "default",
    page: "1",
    query: searchTerm // Will be URL encoded when building query string
  };
  
  // Add category filter: use specific category ID if found, otherwise use "all"
  params["f[category][0]"] = categoryId || "all";
  params["f[locations][0]"] = "all";
  
  // Add selected API filters
  // Format: f[FilterName][0]=FilterValue, f[FilterName][1]=FilterValue2, etc.
  if (apiFilters && typeof apiFilters === 'object') {
    Object.entries(apiFilters).forEach(([filterName, filterValues]) => {
      if (Array.isArray(filterValues) && filterValues.length > 0) {
        // Add each selected filter value with index [0], [1], etc.
        filterValues.forEach((value, index) => {
          // URL encode the filter name and value
          const encodedKey = `f[${filterName}][${index}]`;
          params[encodedKey] = value; // Value will be URL encoded when building query string
        });
      }
    });
  }
  
  // Build query string with proper URL encoding
  const queryString = Object.entries(params)
    .map(([key, val]) => {
      // URL encode both key and value
      const encodedKey = encodeURIComponent(key);
      const encodedVal = encodeURIComponent(val);
      return `${encodedKey}=${encodedVal}`;
    })
    .join("&");

  return `${baseUrl}?${queryString}`;
}

/**
 * Fetch Cash Converters results page by page via Django backend proxy, invoking callback for each page
 * @param {string} searchResultsUrl - The public search results URL
 * @param {Function} onPageFetched - Callback invoked with results after each page loads
 */
async function fetchCashConvertersResultsStreaming(searchResultsUrl, onPageFetched) {
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      // Call Django backend proxy endpoint with fetch_only_first_page flag
      const backendUrl = `/api/cashconverters/results/?url=${encodeURIComponent(searchResultsUrl)}&page=${page}&fetch_only_first_page=${FETCH_ONLY_FIRST_PAGE}`;
      
      const response = await fetch(backendUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch results");
      }

      const results = data.results || [];

      if (results.length === 0) {
        hasMore = false;
      } else {
        console.log(`Page ${page} fetched:`, results.length, "items");
        
        // Invoke callback with new results
        onPageFetched(results);
        
        // Stop after first page if flag is set
        if (FETCH_ONLY_FIRST_PAGE) {
          hasMore = false;
        } else {
          page++;
        }
      }
    } catch (err) {
      console.error("Failed to fetch CashConverters API page:", page, err);
      hasMore = false;
    }
  }

  console.log("Cash Converters pages fetched", FETCH_ONLY_FIRST_PAGE ? "(first page only)" : "(all pages)");
}

function calculateStats(listingsData) {
  if (!listingsData || listingsData.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 };
  }

  // Normalise prices to numeric values and drop anything invalid to avoid NaN stats
  const prices = listingsData
    .map(item => {
      if (!item) return null;
      const raw = item.price;
      if (raw == null) return null;
      const numeric = typeof raw === 'string'
        ? parseFloat(raw.replace(/[^0-9.]/g, ''))
        : raw;
      return Number.isFinite(numeric) ? numeric : null;
    })
    .filter(p => p != null);

  if (prices.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 };
  }

  const sum = prices.reduce((acc, price) => acc + price, 0);
  const averageRaw = sum / prices.length;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const medianRaw = sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];

  // Determine rounding increment based on median value for consistency
  const roundingIncrement = getRoundingIncrement(medianRaw);

  // Round intelligently to market-friendly pricing using the determined increment
  const average = roundToNearest(averageRaw, roundingIncrement);
  const median = roundToNearest(medianRaw, roundingIncrement);

  // Undercut slightly but stay on the same rounding grid
  const suggestedPrice = Math.max(
    roundToNearest(median - roundingIncrement, roundingIncrement),
    0
  );

  return {
    average,
    median,
    suggestedPrice,
    roundingIncrement
  };
}

/**
 * Hook for Cash Converters research data management
 * 
 * For now, uses eBay scraping/data structure - can be replaced with Cash Converters specific logic later.
 * 
 * @param {Object} category - Category object with path array
 * @param {Object} savedState - Previously saved state to restore
 * @returns {Object} Research data and handlers
 */
export function useCashConvertersResearch(category, savedState = null) {
  // Initialize state from savedState if available
  const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || "");
  const [filterOptions, setFilterOptions] = useState(savedState?.filterOptions || []);
  const [listings, setListings] = useState(savedState?.listings || null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(savedState?.stats || { average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 });
  
  // Track the last search term that was actually searched
  const [lastSearchedTerm, setLastSearchedTerm] = useState(savedState?.lastSearchedTerm || "");
  
  // Drill-down history: stack of price ranges
  const [drillHistory, setDrillHistory] = useState(savedState?.drillHistory || []);
  
  // Behave as generic mode - when true, ignore category mapping
  const [behaveAsGeneric, setBehaveAsGeneric] = useState(savedState?.behaveAsGeneric || false);
  
  // Histogram visibility
  const [showHistogram, setShowHistogram] = useState(savedState?.showHistogram ?? false);
  
  // Manual offer from negotiation page
  const [manualOffer, setManualOffer] = useState(savedState?.manualOffer || "");

  const [selectedFilters, setSelectedFilters] = useState(savedState?.selectedFilters || {
    basic: ["Completed & Sold", "Used", "UK Only"],
    apiFilters: {},
  });

  // --- Fetch Cash Converters filters ---
  const fetchFilters = useCallback(async (term) => {
    try {
      // Build URL with category path if available
      let url = `/api/cashconverters/filters/?q=${encodeURIComponent(term)}`;
      if (category?.path && Array.isArray(category.path)) {
        category.path.forEach(pathSegment => {
          url += `&category_path=${encodeURIComponent(pathSegment)}`;
        });
      }
      
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch filters');
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch filters');
      }

      // Cash Converters filters are already in the correct format from the API
      // Just clean out basic filter options if needed
      const cleanedFilters = (data.filters || [])
        .map(filter => {
          if (filter.type !== "checkbox" || !filter.options) return filter;

          const cleanedOptions = filter.options.filter(
            option => !BASIC_FILTER_OPTIONS.includes(option.label)
          );

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
        .filter(Boolean);

      setFilterOptions(cleanedFilters);
    } catch (err) {
      console.error('Error fetching Cash Converters filters:', err);
      setFilterOptions([]);
    }
  }, [category?.path]);

  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) return;
    
    const termChanged = searchTerm.trim() !== lastSearchedTerm;
    
    // If search term changed, reset filters and fetch everything fresh
    if (termChanged) {
      setListings(null);
      setStats({ average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 });
      setFilterOptions([]);
      setSelectedFilters(prev => ({
        ...prev,
        apiFilters: {}
      }));
      setLastSearchedTerm(searchTerm.trim());
      setDrillHistory([]);
    }
    
    setLoading(true);
    
    try {
      // Build public search results URL for scraping (different from API URL used for filters)
      const scrapeUrl = buildCashConvertersScrapeUrl(
        searchTerm,
        selectedFilters.apiFilters,
        category?.path,
        behaveAsGeneric
      );

      console.log("CashConverters scrape URL:", scrapeUrl);
      
      // Initialize empty results array
      let accumulatedResults = [];
      
      // Start fetching filters (don't wait for it)
      if (termChanged) {
        fetchFilters(searchTerm);
      }
      
      // Fetch listings page by page, updating state as each page arrives
      await fetchCashConvertersResultsStreaming(scrapeUrl, (pageResults) => {
        accumulatedResults = [...accumulatedResults, ...pageResults];
        setListings([...accumulatedResults]);
        setStats(calculateStats(accumulatedResults));
      });

      console.log("CashConverters API complete:", accumulatedResults.length, "total items");

    } catch (err) {
      console.error("Cash Converters search error:", err);
      alert("Cash Converters fetching failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, lastSearchedTerm, selectedFilters, category?.path, behaveAsGeneric, fetchFilters]);

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
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  }, []);

  const handleZoomOut = useCallback(() => {
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  // Get current price range (latest in history, or null for full view)
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  
  // Filter listings based on current drill level
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

  // Calculate stats based on displayed listings
  const displayedStats = useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) {
      return stats;
    }
    return calculateStats(displayedListings);
  }, [displayedListings, stats]);

  // Calculate buy offers from displayed stats
  const buyOffers = useMemo(() => {
    return calculateBuyOffers(displayedStats.suggestedPrice);
  }, [displayedStats.suggestedPrice]);

  // Helper to get current complete state for saving
  const getCurrentState = useCallback(() => {
    return {
      searchTerm,
      filterOptions,
      listings: listings ?? [],
      stats: displayedStats,
      buyOffers,          
      lastSearchedTerm,
      drillHistory,
      behaveAsGeneric,
      selectedFilters,
      showHistogram,
      manualOffer
    };
  }, [searchTerm, filterOptions, listings, displayedStats, buyOffers, lastSearchedTerm, drillHistory, behaveAsGeneric, selectedFilters, showHistogram, manualOffer]);

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
    behaveAsGeneric,
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
    setBehaveAsGeneric,
    setManualOffer,
    
    // Utilities
    getCurrentState,
    handleNavigateToDrillLevel,
  };
}
