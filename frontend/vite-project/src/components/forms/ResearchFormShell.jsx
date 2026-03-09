import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button, Icon, HorizontalOfferCard, CustomDropdown } from '../ui/components';

// Add animation styles - MOVED OUTSIDE COMPONENT, RUNS ONCE
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

// Inject styles into document - RUNS ONCE ON MODULE LOAD
let stylesInjected = false;
if (typeof document !== 'undefined' && !stylesInjected) {
  const styleElement = document.createElement('style');
  styleElement.textContent = fadeInUpAnimation;
  document.head.appendChild(styleElement);
  stylesInjected = true;
}

// MEMOIZED HISTOGRAM COMPONENT
const PriceHistogram = React.memo(function PriceHistogram({ listings, onBucketSelect, priceRange, onGoBack, drillLevel, readOnly }) {
  const [bucketCount, setBucketCount] = useState(10);

  // MEMOIZE PRICE EXTRACTION
  const prices = useMemo(() => {
    if (!listings || listings.length === 0) return [];
    return listings
      .map(l => (typeof l.price === 'string' ? parseFloat(l.price.replace(/[^0-9.]/g, '')) : l.price))
      .filter(p => !isNaN(p) && p > 0);
  }, [listings]);

  // MEMOIZE MIN/MAX CALCULATION
  const { min, max } = useMemo(() => {
    if (prices.length === 0) return { min: 0, max: 0 };
    const calculatedMin = priceRange ? priceRange.min : Math.min(...prices);
    const calculatedMax = priceRange ? priceRange.max : Math.max(...prices);
    return { min: calculatedMin, max: calculatedMax };
  }, [prices, priceRange]);

  // MEMOIZE BUCKETS CALCULATION
  const { buckets, maxFreq } = useMemo(() => {
    if (prices.length === 0 || min === max) {
      return { buckets: [], maxFreq: 0 };
    }

    const totalRange = max - min;
    const rawStep = totalRange / bucketCount;

    const newBuckets = Array(bucketCount).fill(0).map((_, i) => ({
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
      newBuckets[index].count++;
    });

    const calculatedMaxFreq = Math.max(...newBuckets.map(b => b.count));

    return { buckets: newBuckets, maxFreq: calculatedMaxFreq };
  }, [prices, min, max, bucketCount, priceRange]);

  // MEMOIZE FILTERED PRICES COUNT
  const filteredPricesCount = useMemo(() => {
    if (!priceRange) return prices.length;
    return prices.filter(p => p >= priceRange.min && p <= priceRange.max).length;
  }, [prices, priceRange]);

  if (!listings || listings.length === 0) return null;
  if (prices.length === 0) return null;

  if (min === max) {
    return (
      <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">
          Market Price Density
        </h3>
        <p className="text-[10px] text-gray-500">
          Not enough price variation to build a distribution.
        </p>
      </div>
    );
  }

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
                Drilling into <span className="font-bold text-blue-900">£{priceRange.min.toFixed(2)} - £{priceRange.max.toFixed(2)}</span> range
                {' '}(<span className="font-bold text-blue-900">{filteredPricesCount}</span> listings)
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
            disabled={false} 
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
            disabled={false} 
          />
        </div>
      </div>
      
      {/* Chart Area - Fixed height with flex distribution */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden" style={{
        gap: bucketCount <= 10 ? '6px' : bucketCount <= 15 ? '4px' : '2px'
      }}>
        {buckets.slice().reverse().map((bucket, i) => {
          const reverseIndex = buckets.length - 1 - i;
          const widthPct = maxFreq > 0 ? (bucket.count / maxFreq) * 100 : 0;
          
          return (
            <div 
              key={reverseIndex} 
              className={`flex flex-1 items-center gap-2 relative group transition-all duration-500 ${
                bucket.count > 0 ? 'cursor-pointer' : ''
              }`}
              onClick={() => bucket.count > 0 && onBucketSelect(bucket.rangeStart, bucket.rangeEnd)}
              style={{
                transform: `scale(${bucket.count > 0 ? 1 : 0.95})`,
                opacity: bucket.count > 0 ? 1 : 0.3,
                minHeight: '8px'
              }}
            >
              {/* The Bar */}
              <div className="flex-1 flex items-center justify-end h-full">
                {/* Frequency Label (Left of bar) */}
                {bucket.count > 0 && (
                  <span 
                    className="text-[10px] font-black text-blue-900 mr-2 transition-all duration-300 group-hover:scale-125"
                  >
                    {bucket.count}
                  </span>
                )}
                
                <div 
                  className={`h-full transition-all duration-500 ${
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
                £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
              </div>
              
              {/* Tooltip on Hover */}
              {bucket.count > 0 && (
                <div className="absolute right-full mr-4 hidden group-hover:flex items-center z-10">
                  <div className="bg-blue-900 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                    £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
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
});

/**
 * Generic Research Form Shell Component
 * 
 * This component provides the UI structure for research forms (eBay, Cash Converters, etc.)
 * It handles all presentation logic while delegating data fetching to provider-specific hooks.
 * 
 * @param {Object} props
 * @param {string} props.searchTerm - Current search term
 * @param {Function} props.onSearchTermChange - Handler for search term changes
 * @param {Function} props.onSearch - Handler for search action
 * @param {Array} props.listings - All listings data
 * @param {Array} props.displayedListings - Filtered listings (by drill-down)
 * @param {Object} props.stats - Overall stats {average, median, suggestedPrice}
 * @param {Object} props.displayedStats - Stats for displayed listings
 * @param {Array} props.filterOptions - API-provided filter options
 * @param {Object} props.selectedFilters - {basic: [], apiFilters: {}}
 * @param {Function} props.onBasicFilterChange - Handler for basic filter changes
 * @param {Function} props.onApiFilterChange - Handler for API filter changes
 * @param {boolean} props.loading - Loading state
 * @param {boolean} props.showHistogram - Whether to show histogram
 * @param {Function} props.onShowHistogramChange - Handler for histogram toggle
 * @param {Array} props.drillHistory - Array of price ranges for drill-down
 * @param {Function} props.onDrillDown - Handler for drill-down
 * @param {Function} props.onZoomOut - Handler for zoom out (removes last level)
 * @param {Function} props.onNavigateToDrillLevel - Handler for navigating to specific drill level
 * @param {Function} props.onComplete - Handler for completion
 * @param {string} props.mode - "modal" or "page"
 * @param {boolean} props.readOnly - Read-only mode
 * @param {Array} props.basicFilterOptions - Options for basic filters (e.g., ["Completed & Sold", "Used", "UK Only"])
 * @param {string} props.searchPlaceholder - Placeholder for search input
 * @param {string} props.headerTitle - Title for modal header
 * @param {string} props.headerSubtitle - Subtitle for modal header
 * @param {string} props.headerIcon - Icon name for modal header
 * @param {Array} props.buyOffers - Calculated buy offers [{price, margin}, ...]
 * @param {React.ReactNode} props.customControls - Custom controls to render in search area (e.g., "Behave like eBay" checkbox)
 * @param {boolean} props.allowHistogramToggle - Whether to show the histogram toggle checkbox (default: true)
 * @param {boolean} props.hideSearchAndFilters - When true, hide search input and filters sidebar (e.g. extension-sourced data); only histogram toggle bar is shown
 * @param {Function} props.onRefineSearch - When set (e.g. extension flow), shows "Refine search" button; called when user wants to go back to the listing site to refine
 * @param {Function} props.onCancelRefine - When set, shows a "Cancel" button while refineLoading is true; closes the listing tab without leaving the cards view
 * @param {string} props.refineError - Optional error message to show after a failed refine (e.g. extension timeout)
 * @param {boolean} props.refineLoading - When true, Refine search button is disabled (refine in progress)
 * @param {Function} props.onResetSearch - Optional handler to reset the current research/search state (clear drill-down, exclusions, etc.)
 */
export default function ResearchFormShell({
  searchTerm,
  onSearchTermChange,
  onSearch,
  listings,
  displayedListings,
  stats,
  displayedStats,
  filterOptions,
  selectedFilters,
  onBasicFilterChange,
  onApiFilterChange,
  loading,
  showHistogram,
  onShowHistogramChange,
  drillHistory,
  onDrillDown,
  onZoomOut,
  onNavigateToDrillLevel,
  onComplete,
  onCompleteWithSelection = null, // Optional callback that receives (getState, selectedOfferIndex)
  mode = "modal",
  readOnly = false,
  basicFilterOptions = ["Completed & Sold", "Used", "UK Only"],
  searchPlaceholder = "Search listings...",
  headerTitle = "Market Research",
  headerSubtitle = "Real-time valuation lookup",
  headerIcon = "search_insights",
  buyOffers = [],
  customControls = null,
  allowHistogramToggle = true,
  manualOffer = "",
  onManualOfferChange = null,
  showManualOffer = false,
  hideSearchAndFilters = false,
  onRefineSearch = null,
  onCancelRefine = null,
  refineError = null,
  refineLoading = false,
  onToggleExclude = null,
  onClearAllExclusions = null,
  onAddNewItem = null, // When set, replaces Add to Cart with "Add new item" button (e.g. when viewing saved research)
  onAddToCartWithOffer = null, // When set (e.g. eBay page), clicking an offer adds with that offer; 4th "Add to Cart" adds with no offer. Called with (offerIndex) where offerIndex is 0, 1, 2, or null.
  onResetSearch = null,
}) {
  // Get current price range (latest in history, or null for full view)
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  
  // State for selected offer when opened from negotiation page
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(null); // null, 0, 1, 2, or 'manual'

  // Toggle: hide excluded listings from grid
  const [showOnlyRelevant, setShowOnlyRelevant] = useState(false);

  // Sort order: 'default' | 'low_to_high' | 'high_to_low'
  const [sortOrder, setSortOrder] = useState('low_to_high');

  const sortOptions = useMemo(
    () => ([
      { value: 'default', label: 'Default order' },
      { value: 'low_to_high', label: 'Low to high' },
      { value: 'high_to_low', label: 'High to low' },
    ]),
    []
  );

  const sortOptionLabels = useMemo(
    () => sortOptions.map(o => o.label),
    [sortOptions]
  );

  const currentSortLabel = useMemo(
    () => (sortOptions.find(o => o.value === sortOrder)?.label || 'Default order'),
    [sortOrder, sortOptions]
  );

  // Multi-select range for exclude: first two clicks act as a range select
  const [firstExcludeClickIndex, setFirstExcludeClickIndex] = useState(null);
  const [firstExcludeTargetExcluded, setFirstExcludeTargetExcluded] = useState(null);
  const [hasInitialRangeSelection, setHasInitialRangeSelection] = useState(false);

  // Reset multi-select when zero items are excluded so next two clicks work as range
  const excludedCount = displayedListings ? displayedListings.filter(l => l.excluded).length : 0;
  useEffect(() => {
    if (excludedCount === 0) {
      setHasInitialRangeSelection(false);
      setFirstExcludeClickIndex(null);
      setFirstExcludeTargetExcluded(null);
    }
  }, [excludedCount]);
  
  // Ref to maintain input focus
  const manualInputRef = useRef(null);
  
  // Maintain focus when manual offer is selected
  useEffect(() => {
    if (selectedOfferIndex === 'manual' && manualInputRef.current && document.activeElement !== manualInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        manualInputRef.current?.focus();
      }, 0);
    }
  }, [selectedOfferIndex]);

  const parsePrice = useCallback((item) => {
    if (!item || item.price == null) return NaN;
    const p = item.price;
    if (typeof p === 'number') return isNaN(p) ? NaN : p;
    return parseFloat(String(p).replace(/[^0-9.]/g, '')) || NaN;
  }, []);

  const sortedListings = useMemo(() => {
    const list = displayedListings || [];
    const withIdx = list.map((item, i) => ({ item, origIdx: i }));
    if (sortOrder === 'default') return withIdx;
    return [...withIdx].sort((a, b) => {
      const pa = parsePrice(a.item);
      const pb = parsePrice(b.item);
      if (sortOrder === 'low_to_high') return (pa || 0) - (pb || 0);
      if (sortOrder === 'high_to_low') return (pb || 0) - (pa || 0);
      return a.origIdx - b.origIdx;
    });
  }, [displayedListings, sortOrder, parsePrice]);

  // Format stat value for display (2 decimal places)
  const formatStat = useCallback((val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }, []);

  // Working out for stats tooltips (from non-excluded listings only)
  const statsWorkingOut = useMemo(() => {
    const included = displayedListings ? displayedListings.filter(l => !l.excluded) : [];
    const prices = included.map(l => parsePrice(l)).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) return null;
    const sum = prices.reduce((a, b) => a + b, 0);
    const count = prices.length;
    const averageRaw = sum / count;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(count / 2);
    const medianRaw = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return { sum, count, averageRaw, medianRaw };
  }, [displayedListings, parsePrice]);

  // MEMOIZED STATS DISPLAY COMPONENT
  const StatsDisplay = useMemo(() => {
    const wo = statsWorkingOut;

    const tooltipAbove = mode === "modal";
    const StatWithTooltip = ({ label, value, valueClass, tooltipContent }) => (
      <div className="relative group cursor-help">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
            {label}
          </span>
          <span className={`text-lg font-extrabold ${valueClass}`}>£{formatStat(value)}</span>
        </div>
        {tooltipContent && (
          <div
            className={`absolute left-0 hidden group-hover:block z-50 w-64 pointer-events-none ${tooltipAbove ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
            role="tooltip"
          >
            {tooltipAbove ? (
              <>
                <div className="py-2.5 px-3 rounded-lg bg-gray-800 text-gray-100 text-xs shadow-xl border border-gray-600">
                  {tooltipContent}
                </div>
                <div className="absolute left-4 -bottom-1.5 w-0 h-0 border-[6px] border-transparent border-t-gray-800" aria-hidden="true" />
              </>
            ) : (
              <>
                <div className="absolute left-4 -top-1.5 w-0 h-0 border-[6px] border-transparent border-b-gray-800" aria-hidden="true" />
                <div className="py-2.5 px-3 rounded-lg bg-gray-800 text-gray-100 text-xs shadow-xl border border-gray-600">
                  {tooltipContent}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );

    return () => (
      <div className="flex items-center gap-6">
        <StatWithTooltip
          label="Average"
          value={displayedStats.average}
          valueClass="text-blue-900"
          tooltipContent={wo && (
            <>
              <div className="font-semibold text-gray-200 mb-1">Average</div>
              <div>Sum of {wo.count} prices (£{wo.sum.toFixed(2)}) ÷ {wo.count} = £{wo.averageRaw.toFixed(2)}</div>
            </>
          )}
        />
        <div className="w-px h-8 bg-gray-200" />
        <StatWithTooltip
          label="Median"
          value={displayedStats.median}
          valueClass="text-blue-900"
          tooltipContent={wo && (
            <>
              <div className="font-semibold text-gray-200 mb-1">Median</div>
              <div>Middle value of {wo.count} sorted prices = £{wo.medianRaw.toFixed(2)}</div>
            </>
          )}
        />
        <div className="w-px h-8 bg-gray-200" />
        <StatWithTooltip
          label="Suggested Sale Price"
          value={displayedStats.suggestedPrice}
          valueClass="text-green-600"
          tooltipContent={wo && (
            <>
              <div className="font-semibold text-gray-200 mb-1">Suggested Sale Price</div>
              <div>Median (£{wo.medianRaw.toFixed(2)}) − £1 = £{formatStat(displayedStats.suggestedPrice)}</div>
              <div className="mt-1 text-gray-300">£1 below median</div>
            </>
          )}
        />
      </div>
    );
  }, [displayedStats, formatStat, statsWorkingOut, mode]);

  // Manual offer change handler - memoized to prevent input re-creation
  const handleManualOfferChange = useCallback((e) => {
    const value = e.target.value;
    onManualOfferChange?.(value);
  }, [onManualOfferChange]);

  // Handler for clicking on an offer card (when opened from negotiation page)
  const handleOfferClick = useCallback((price, index) => {
    if (showManualOffer) {
      setSelectedOfferIndex(index);
      // Don't update manual offer input - only select the offer visually
    }
  }, [showManualOffer]);

  // Handler for clicking on manual offer card
  const handleManualOfferCardClick = useCallback(() => {
    if (showManualOffer && !readOnly) {
      setSelectedOfferIndex('manual');
    }
  }, [showManualOffer, readOnly]);

  // Handler for completing/closing modal - pass selected offer
  const handleComplete = useCallback(() => {
    // Only update manual offer if manual offer card was selected
    if (showManualOffer && selectedOfferIndex === 'manual' && manualOffer) {
      if (onManualOfferChange) {
        onManualOfferChange(manualOffer);
      }
    }
    
    // If onCompleteWithSelection is provided, use it to pass selectedOfferIndex
    if (onCompleteWithSelection) {
      onCompleteWithSelection(selectedOfferIndex);
    } else {
      // Fallback to regular onComplete
      onComplete?.();
    }
  }, [showManualOffer, selectedOfferIndex, manualOffer, onManualOfferChange, onComplete, onCompleteWithSelection]);

  // Calculate margin for manual offer
  const manualOfferMargin = useMemo(() => {
    if (!displayedStats?.suggestedPrice || !manualOffer) return null;
    const cleanManual = parseFloat(manualOffer.replace(/[£,]/g, ''));
    if (isNaN(cleanManual) || cleanManual <= 0) return null;
    const salePrice = displayedStats.suggestedPrice;
    if (salePrice <= 0) return null;
    return Math.round(((salePrice - cleanManual) / salePrice) * 100);
  }, [displayedStats, manualOffer]);

  // Handle clicking the exclude toggle on a listing card.
  // First two clicks behave like a range select (apply to everything in between).
  // Uses sortedIdx (index in sortedListings) so the range matches the visible sort order.
  const handleExcludeClick = useCallback((sortedIdx) => {
    if (!onToggleExclude || !sortedListings || !sortedListings[sortedIdx]) return;

    const { item: clicked, origIdx } = sortedListings[sortedIdx];

    const id = clicked._id ?? clicked.id ?? `${clicked.url ?? clicked.title ?? 'listing'}-${origIdx}`;

    // If clicking the same item that set the anchor, treat as a plain toggle and reset
    // (avoids the range-branch no-op that made un-excluding require multiple clicks).
    if (firstExcludeClickIndex === sortedIdx) {
      onToggleExclude(id);
      setFirstExcludeClickIndex(null);
      setFirstExcludeTargetExcluded(null);
      return;
    }

    // If we've already done the initial range, or no anchor is set, treat as single toggle.
    if (hasInitialRangeSelection || firstExcludeClickIndex === null) {
      const shouldExclude = !clicked.excluded;
      onToggleExclude(id);

      if (!hasInitialRangeSelection) {
        setFirstExcludeClickIndex(sortedIdx);
        setFirstExcludeTargetExcluded(shouldExclude);
      }
      return;
    }

    // Second click in the initial sequence: apply to range between anchor and this index (in sorted order).
    const anchor = firstExcludeClickIndex;
    const start = Math.min(anchor, sortedIdx);
    const end = Math.max(anchor, sortedIdx);

    for (let i = start; i <= end; i++) {
      const entry = sortedListings[i];
      if (!entry) continue;
      const { item, origIdx } = entry;
      const currentlyExcluded = !!item.excluded;

      // Only toggle items that don't already match the target state.
      if (currentlyExcluded !== firstExcludeTargetExcluded) {
        const id = item._id ?? item.id ?? `${item.url ?? item.title ?? 'listing'}-${origIdx}`;
        onToggleExclude(id);
      }
    }

    setHasInitialRangeSelection(true);
    setFirstExcludeClickIndex(null);
    setFirstExcludeTargetExcluded(null);
  }, [
    sortedListings,
    onToggleExclude,
    firstExcludeClickIndex,
    firstExcludeTargetExcluded,
    hasInitialRangeSelection,
  ]);

  const handleClearAllExclusions = useCallback(() => {
    if (onClearAllExclusions) {
      onClearAllExclusions();
    } else if (onToggleExclude && displayedListings) {
      displayedListings.forEach((item, i) => {
        if (item.excluded) {
          const id = item._id ?? item.id ?? `${item.url ?? item.title ?? 'listing'}-${i}`;
          onToggleExclude(id);
        }
      });
    }
    setHasInitialRangeSelection(false);
    setFirstExcludeClickIndex(null);
    setFirstExcludeTargetExcluded(null);
  }, [displayedListings, onToggleExclude, onClearAllExclusions]);

  // MEMOIZED BUY OFFERS DISPLAY with manual offer card and optional "Add to Cart" per-offer flow
  const BuyOffersDisplay = useMemo(() => {
    if (!buyOffers.length && !showManualOffer) return null;

    const offerLabels = ["1st Cash Offer", "2nd Cash Offer", "3rd Cash Offer"];
    const useAddWithOfferFlow = Boolean(onAddToCartWithOffer && !readOnly);

    return (
      <div className="flex flex-wrap items-center gap-4">
        {buyOffers.map(({ price }, idx) => (
          <HorizontalOfferCard
            key={idx}
            title={offerLabels[idx] || `${idx + 1}th Offer`}
            price={`£${formatStat(price)}`}
            margin={Math.round([0.6, 0.5, 0.4][idx] * 100)}
            isHighlighted={showManualOffer && selectedOfferIndex === idx}
            onClick={
              useAddWithOfferFlow
                ? () => onAddToCartWithOffer(idx)
                : showManualOffer && !readOnly
                  ? () => handleOfferClick(price, idx)
                  : undefined
            }
          />
        ))}
        {useAddWithOfferFlow && (
          <div
            onClick={() => onAddToCartWithOffer(null)}
            className="flex items-center justify-center px-4 py-2 rounded-lg bg-white cursor-pointer border-2 border-blue-900/40 hover:border-blue-900 hover:shadow-md transition-all duration-150 ease-out"
          >
            <Icon name="add_shopping_cart" className="text-blue-900 text-lg mr-2" />
            <span className="text-blue-900 font-extrabold text-sm uppercase">Add to Cart</span>
          </div>
        )}
        
        {/* Manual Offer Card - styled like the other offers, with inline input */}
        {showManualOffer && onManualOfferChange && (
          <div
            onClick={handleManualOfferCardClick}
            className={`
              flex items-center justify-between px-3 py-2 rounded-lg bg-white cursor-text relative
              border transition-all duration-150 ease-out
              ${
                selectedOfferIndex === 'manual'
                  ? `
                    border-blue-900
                    ring-1 ring-blue-900
                    shadow-md
                    scale-[1.02]
                  `
                  : `
                    border-blue-900/30
                    hover:border-blue-900
                    hover:shadow-sm
                  `
              }
            `}
          >
            {/* Left accent bar */}
            <div
              className={`absolute top-0 left-0 h-full w-1 rounded-l ${
                selectedOfferIndex === 'manual' ? 'bg-yellow-500' : 'bg-yellow-500/60'
              }`}
            />

            {/* Content row with inline input */}
            <div className="flex items-center gap-2 flex-1 ml-2 text-blue-900 font-extrabold text-sm uppercase">
              <span className="truncate">Manual Offer</span>
              <span className="text-gray-400">/</span>
              <input
                ref={manualInputRef}
                type="text"
                key="manual-offer-input"
                className="bg-transparent border-none outline-none text-blue-900 font-extrabold text-sm w-24"
                placeholder="£0.00"
                value={manualOffer}
                onChange={(e) => {
                  // Prevent the card click handler from immediately re-firing
                  e.stopPropagation();
                  handleManualOfferChange(e);
                  // Ensure it stays selected when typing
                  if (!readOnly && showManualOffer && selectedOfferIndex !== 'manual') {
                    setSelectedOfferIndex('manual');
                  }
                }}
                onFocus={() => {
                  if (!readOnly && showManualOffer) {
                    setSelectedOfferIndex('manual');
                  }
                }}
                disabled={readOnly}
                readOnly={readOnly}
              />
            </div>

            {/* Right Side: Margin Badge */}
            {manualOfferMargin !== null && (
              <div className="flex items-center justify-center bg-gradient-to-br from-yellow-400 to-yellow-500 text-blue-900 text-[10px] font-black uppercase px-2.5 py-1 rounded-full">
                {manualOfferMargin}%
              </div>
            )}
          </div>
        )}
      </div>
    );
  }, [buyOffers, showManualOffer, selectedOfferIndex, manualOffer, manualOfferMargin, onManualOfferChange, readOnly, handleOfferClick, handleManualOfferCardClick, handleManualOfferChange, onAddToCartWithOffer, formatStat]);

  const content = (
    <>
      {/* Header - Only show in modal mode */}
      {mode === "modal" && (
        <header className="bg-blue-900 px-6 py-4 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-1.5 rounded">
              <Icon name={headerIcon} className="text-yellow-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{headerTitle}</h2>
              <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                {headerSubtitle}
              </p>
            </div>
          </div>
          <button className="text-white/60 hover:text-white transition-colors p-1" onClick={handleComplete}>
            <Icon name="close" />
          </button>
        </header>
      )}

      {/* Stats at top - Only show in page mode when we have results */}
      {mode === "page" && listings && (
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <StatsDisplay />
            {BuyOffersDisplay}
          </div>
          {onAddNewItem && (
            <Button
              variant="primary"
              size="md"
              onClick={onAddNewItem}
              className="shrink-0 mt-2 md:mt-0"
            >
              <Icon name="add_circle" className="text-sm" />
              Add new item
            </Button>
          )}
          {/* When onAddToCartWithOffer is provided, the only Add to Cart control lives inline with the offers. */}
          {!onAddNewItem && !onAddToCartWithOffer && (
            <Button
              variant="primary"
              size="md"
              onClick={readOnly ? undefined : handleComplete}
              className="shrink-0 mt-2 md:mt-0"
              disabled={readOnly}
            >
              <Icon name="add_shopping_cart" className="text-sm" />
              Add to Cart
            </Button>
          )}
        </div>
      )}

      {/* Search Input - hidden when hideSearchAndFilters (e.g. extension-sourced data) */}
      {!hideSearchAndFilters && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-100/50">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">search</span>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-blue-200 focus:border-blue-900 outline-none shadow-sm"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={readOnly ? undefined : (e) => onSearchTermChange(e.target.value)}
              onKeyDown={readOnly ? undefined : (e) => e.key === 'Enter' && onSearch()}
              readOnly={readOnly}
              disabled={readOnly}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {!readOnly && (
                <Button variant="primary" size="sm" onClick={onSearch} disabled={loading}>
                  {loading ? "Searching..." : "Search"}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            {customControls}
            {listings && allowHistogramToggle && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                  checked={showHistogram}
                  onChange={readOnly ? undefined : (e) => onShowHistogramChange(e.target.checked)}
                  disabled={readOnly}
                />
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">bar_chart</span>
                  Show Price Distribution
                </span>
              </label>
            )}
            {displayedListings && displayedListings.length > 0 && (
              <CustomDropdown
                label="Sort"
                value={currentSortLabel}
                options={sortOptionLabels}
                onChange={(label) => {
                  const found = sortOptions.find(o => o.label === label);
                  if (found) setSortOrder(found.value);
                }}
                labelPosition="left"
              />
            )}
            {displayedListings && (onToggleExclude || displayedListings.some(l => l.excluded)) && (() => {
              const excludedCount = displayedListings.filter(l => l.excluded).length;
              return (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-gray-600">filter_list</span>
                    <span className="text-xs font-medium text-gray-700">Show only relevant</span>
                    <button
                      type="button"
                      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                      style={{ backgroundColor: showOnlyRelevant ? '#1e3a8a' : '#d1d5db' }}
                      onClick={() => setShowOnlyRelevant(prev => !prev)}
                      aria-pressed={showOnlyRelevant}
                    >
                      <span
                        className={`absolute top-1/2 left-0.5 h-4 w-4 -translate-y-1/2 bg-white rounded-full shadow-sm transition-transform duration-150 ${
                          showOnlyRelevant ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  {excludedCount > 0 && (onToggleExclude || onClearAllExclusions) && !readOnly && (
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                      onClick={handleClearAllExclusions}
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              );
            })()}
            {onResetSearch && listings && !readOnly && (
              <button
                type="button"
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                onClick={onResetSearch}
              >
                Reset search
              </button>
            )}
          </div>
        </div>
      )}

      {/* When hideSearchAndFilters: only histogram toggle bar + optional Refine search (no search, no left filters) */}
      {hideSearchAndFilters && listings && (
        <div className="px-6 py-3 border-b border-gray-200 bg-gray-100/50 flex flex-col gap-2">
          <div className="flex items-center gap-4 flex-wrap">
            {customControls}
            {(onRefineSearch || onResetSearch) && !readOnly && (
              <div className="flex items-center gap-2">
                {onRefineSearch && (
                  <Button variant="outline" size="sm" onClick={onRefineSearch} disabled={refineLoading}>
                    {refineLoading ? 'Refining…' : 'Refine search'}
                  </Button>
                )}
                {refineLoading && onCancelRefine && (
                  <button
                    type="button"
                    onClick={onCancelRefine}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-red-300 text-red-500 hover:text-white hover:bg-red-500 hover:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
                    title="Cancel refine and close tab"
                    aria-label="Cancel refine and close tab"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
                {onResetSearch && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onResetSearch}
                  >
                    Reset search
                  </Button>
                )}
              </div>
            )}
            {allowHistogramToggle && (
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                checked={showHistogram}
                onChange={readOnly ? undefined : (e) => onShowHistogramChange(e.target.checked)}
                disabled={readOnly}
              />
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">bar_chart</span>
                Show Price Distribution
              </span>
            </label>
            )}
            {displayedListings && displayedListings.length > 0 && (
              <CustomDropdown
                label="Sort"
                value={currentSortLabel}
                options={sortOptionLabels}
                onChange={(label) => {
                  const found = sortOptions.find(o => o.label === label);
                  if (found) setSortOrder(found.value);
                }}
                labelPosition="left"
              />
            )}
            {/* Show only relevant toggle — visible whenever there are excluded listings or exclusion is available */}
            {displayedListings && (onToggleExclude || displayedListings.some(l => l.excluded)) && (() => {
              const excludedCount = displayedListings.filter(l => l.excluded).length;
              return (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-gray-600">filter_list</span>
                    <span className="text-xs font-medium text-gray-700">Show only relevant</span>
                    <button
                      type="button"
                      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                      style={{ backgroundColor: showOnlyRelevant ? '#1e3a8a' : '#d1d5db' }}
                      onClick={() => setShowOnlyRelevant(prev => !prev)}
                      aria-pressed={showOnlyRelevant}
                    >
                      <span
                        className={`absolute top-1/2 left-0.5 h-4 w-4 -translate-y-1/2 bg-white rounded-full shadow-sm transition-transform duration-150 ${
                          showOnlyRelevant ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  {excludedCount > 0 && (onToggleExclude || onClearAllExclusions) && !readOnly && (
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                      onClick={handleClearAllExclusions}
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          {refineError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded">{refineError}</p>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`flex ${mode === "page" ? "h-[calc(100vh-200px)]" : "flex-1"} overflow-hidden`}>
        {/* Sidebar filters */}
        {filterOptions.length > 0 && (
          <aside className="w-64 border-r border-gray-200 overflow-y-auto bg-white p-4 space-y-6 histogram-scrollbar">
            {/* Basic Filters */}
            <div>
              <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Basic Filters</h3>
              <div className="space-y-2">
                {basicFilterOptions.map((filter) => (
                  <label key={filter} className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
                      checked={selectedFilters.basic.includes(filter)}
                      onChange={readOnly ? undefined : (e) => onBasicFilterChange(filter, e.target.checked)}
                      disabled={readOnly}
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
                        onChange={readOnly ? undefined : (e) => onApiFilterChange(filter.name, { label: option.label, checked: e.target.checked }, 'checkbox')}
                        disabled={readOnly}
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
                        onChange={readOnly ? undefined : (e) => onApiFilterChange(filter.name, e.target.value, 'range', 'min')}
                        disabled={readOnly}
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        className="w-full p-2 border rounded text-xs focus:ring-blue-900"
                        value={selectedFilters.apiFilters[filter.name]?.max || ""}
                        onChange={readOnly ? undefined : (e) => onApiFilterChange(filter.name, e.target.value, 'range', 'max')}
                        disabled={readOnly}
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
                onClick={readOnly ? undefined : onSearch} 
                disabled={readOnly || loading}
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
              {/* Records / Excluded banner */}
              {displayedListings && displayedListings.length > 0 && (
                <div className="mb-4 flex flex-col items-center gap-1.5 py-2.5 px-4 rounded-lg bg-gray-200/80 text-gray-700 border border-gray-300/60">
                  <div className="flex items-center justify-center gap-6">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Records</span>
                      <span className="text-lg font-semibold tabular-nums">{displayedListings.length}</span>
                    </div>
                    <div className="w-px h-5 bg-gray-400 rounded-full" aria-hidden="true" />
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Excluded</span>
                      <span className="text-lg font-semibold tabular-nums">{displayedListings.filter(l => l.excluded).length}</span>
                    </div>
                    {drillHistory.length > 0 && (
                      <>
                        <div className="w-px h-5 bg-gray-400 rounded-full" aria-hidden="true" />
                        <div className="text-xs text-gray-500">
                          from <span className="font-semibold text-gray-700">{listings.length}</span> total
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <span className="material-symbols-outlined text-[14px] text-gray-500">info</span>
                    <span>Use the <strong className="font-semibold">Exclude</strong> button on a listing (or two listings to select a range) to remove it from calculations.</span>
                  </div>
                </div>
              )}

              {/* Breadcrumb Navigation */}
              {showHistogram && drillHistory.length > 0 && (
                <div className="mb-4 flex items-center gap-2 text-xs font-medium">
                  <button 
                    onClick={() => onNavigateToDrillLevel && onNavigateToDrillLevel(0)}
                    className="text-blue-900 hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">home</span>
                    All Prices
                  </button>
                  {drillHistory.map((range, idx) => (
                    <React.Fragment key={idx}>
                      <span className="text-gray-400">/</span>
                      <button 
                        onClick={() => onNavigateToDrillLevel && onNavigateToDrillLevel(idx + 1)}
                        className={`${
                          idx === drillHistory.length - 1 
                            ? 'text-gray-900 font-bold' 
                            : 'text-blue-900 hover:underline'
                        }`}
                      >
                        £{range.min.toFixed(2)} - £{range.max.toFixed(2)}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div className={`grid ${showHistogram ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                {sortedListings && sortedListings
                  .map((entry, sortedIdx) => ({ ...entry, sortedIdx }))
                  .filter(({ item }) => !showOnlyRelevant || !item.excluded)
                  .map(({ item, origIdx, sortedIdx }, displayIdx) => (
                  <div
                    key={`${item._id || item.title}-${origIdx}`}
                    className={`relative group ${item.excluded ? 'opacity-60' : ''}`}
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex gap-4 rounded-xl border p-4 hover:shadow-md transition-all duration-300 ${
                        item.excluded
                          ? 'bg-orange-50/60 border-orange-300'
                          : 'bg-white border-gray-200'
                      }`}
                      style={{ 
                        animationDelay: `${displayIdx * 20}ms`,
                        opacity: 0,
                        animation: 'fadeInUp 0.4s ease-out forwards'
                      }}
                    >
                      <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.title || "listing"}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs text-gray-500">No image</span>
                        )}
                      </div>
                      <div className="flex flex-col justify-between flex-1 min-w-0">
                        <div>
                          <h4 className="text-sm font-bold text-blue-900 line-clamp-2 leading-tight cursor-pointer hover:underline">{item.title}</h4>
                          {item.shop && (
                            <p className="text-[11px] text-gray-500 mt-0.5">Shop: {item.shop}</p>
                          )}
                          {item.sold && (
                            <p className="text-[11px] text-green-600 font-bold mt-1">{item.sold}</p>
                          )}
                          {item.sellerInfo && (
                            <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                              <span className="font-medium text-gray-500">Seller:</span> {item.sellerInfo}
                            </p>
                          )}
                        </div>
                        <div className="flex items-end justify-between mt-2">
                          <p className="text-lg font-extrabold text-gray-900 leading-none">£{item.price}</p>
                          {item.itemId && (
                            <span className="text-[9px] text-gray-400 font-mono tabular-nums">#{item.itemId}</span>
                          )}
                        </div>
                      </div>
                    </a>

                    {/* Excluded badge */}
                    {item.excluded && (
                      <div className="absolute top-2 left-3 z-10 pointer-events-none">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 tracking-wider border border-orange-200">
                          Excluded
                        </span>
                      </div>
                    )}

                    {/* Exclude / re-include toggle button */}
                    {onToggleExclude && !readOnly && (
                      <button
                        className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all duration-150 ${
                          item.excluded
                            ? 'bg-orange-500 text-white shadow-sm hover:bg-orange-600'
                            : 'bg-white text-gray-600 border border-gray-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-300'
                        }`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleExcludeClick(sortedIdx);
                        }}
                        title={item.excluded ? 'Re-include this listing in stats' : 'Exclude this listing from stats'}
                        aria-label={item.excluded ? 'Re-include listing in stats' : 'Exclude listing from stats'}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {item.excluded ? 'undo' : 'block'}
                        </span>
                        <span>{item.excluded ? 'Excluded' : 'Exclude'}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* --- HISTOGRAM COMPONENT (Right Side) --- */}
            {showHistogram && (
              <aside className="w-80 border-l border-gray-200 overflow-hidden">
                <PriceHistogram 
                  listings={displayedListings ? displayedListings.filter(l => !l.excluded) : displayedListings} 
                  onBucketSelect={onDrillDown}
                  priceRange={currentPriceRange}
                  onGoBack={onZoomOut}
                  drillLevel={drillHistory.length}
                  readOnly={readOnly}
                />
              </aside>
            )}
          </main>
        )}
      </div>

      {/* Footer - Only show in modal mode */}
      {mode === "modal" && (
        <footer className="px-6 py-4 border-t border-gray-200 bg-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-6 flex-wrap">
            <StatsDisplay />
            {BuyOffersDisplay}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="md" onClick={readOnly ? undefined : handleComplete} disabled={readOnly}>Cancel</Button>
            {listings && (
              <Button 
                variant="primary" 
                size="md" 
                onClick={handleComplete} 
                disabled={loading && !readOnly}
              >
                OK
              </Button>
            )}
          </div>
        </footer>
      )}
    </>
  );

  // Wrapper classes based on mode
  const wrapperClasses = mode === "modal"
    ? "fixed inset-0 z-[100] flex items-start justify-center bg-black/40"
    : "";

  const containerClasses = mode === "modal"
    ? "bg-white w-full h-full flex flex-col overflow-hidden"
    : "bg-white w-full h-full flex flex-col overflow-hidden";

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
