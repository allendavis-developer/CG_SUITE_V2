import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button, Icon, CustomDropdown } from '../ui/components';
import { toVoucherOfferPrice } from '@/utils/helpers';

/** Resolve badge % for eBay / Cash Converters offers (new: pctOfSale; legacy saved: margin 0–1). */
function displayPctOfSaleForOffer(offer, suggestedPrice) {
  if (offer?.pctOfSale != null) return Math.round(Number(offer.pctOfSale));
  if (offer?.margin != null) return Math.round((1 - Number(offer.margin)) * 100);
  const sp = Number(suggestedPrice);
  if (sp > 0 && offer?.price != null) {
    const p = Number(offer.price);
    if (Number.isFinite(p) && p > 0) return Math.round((p / sp) * 100);
  }
  return null;
}

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

// MEMOIZED LISTING CARD - prevents re-renders when parent updates
const ListingCard = React.memo(function ListingCard({ item, origIdx, sortedIdx, displayIdx, onExcludeClick, onExcludeContextMenu, showExcludeButton, readOnly, isPivot }) {
  const handleExcludeClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExcludeClick?.(sortedIdx);
  };
  const handleExcludeContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExcludeContextMenu?.(e, sortedIdx);
  };
  const animDelay = Math.min(displayIdx * 8, 80);
  return (
    <div className={`relative group ${item.excluded ? 'opacity-60' : ''}`} onContextMenu={handleExcludeContextMenu}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex gap-4 rounded-xl border p-4 hover:shadow-md transition-all duration-200 ${
          item.excluded ? 'bg-orange-50/60 border-orange-300' : 'bg-white border-gray-200'
        }`}
        style={animDelay > 0 ? { animationDelay: `${animDelay}ms`, opacity: 0, animation: 'fadeInUp 0.25s ease-out forwards' } : undefined}
      >
        <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
          {item.image ? (
            <img src={item.image} alt={item.title || "listing"} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <span className="text-xs text-gray-500">No image</span>
          )}
        </div>
        <div className="flex flex-col justify-between flex-1 min-w-0">
          <div>
            <h4 className="text-sm font-bold text-blue-900 line-clamp-2 leading-tight cursor-pointer hover:underline">{item.title}</h4>
            {item.shop && <p className="text-[11px] text-gray-500 mt-0.5">Shop: {item.shop}</p>}
            {item.sold && <p className="text-[11px] text-green-600 font-bold mt-1">{item.sold}</p>}
            {item.sellerInfo && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                <span className="font-medium text-gray-500">Seller:</span> {item.sellerInfo}
              </p>
            )}
          </div>
          <div className="flex items-end justify-between mt-2">
            <p className="text-lg font-extrabold text-gray-900 leading-none">£{item.price}</p>
            {item.itemId && <span className="text-[9px] text-gray-400 font-mono tabular-nums">#{item.itemId}</span>}
          </div>
        </div>
      </a>
      {item.excluded && (
        <div className="absolute top-2 left-3 z-10 pointer-events-none">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 tracking-wider border border-orange-200">Excluded</span>
        </div>
      )}
      {showExcludeButton && (
        <button
          className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all duration-150 ${
            isPivot ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-300' : item.excluded ? 'bg-orange-500 text-white shadow-sm hover:bg-orange-600' : 'bg-white text-gray-600 border border-gray-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-300'
          }`}
          onClick={handleExcludeClick}
          title={isPivot ? 'Click to exclude · Click another item to select range' : item.excluded ? 'Click to re-include' : 'Click to set pivot'}
          aria-label={item.excluded ? 'Re-include listing in stats' : 'Exclude listing from stats'}
        >
          <span className="material-symbols-outlined text-[14px]">{isPivot ? 'swap_vert' : item.excluded ? 'undo' : 'block'}</span>
          <span>{isPivot ? 'Pivot' : item.excluded ? 'Excluded' : 'Exclude'}</span>
        </button>
      )}
    </div>
  );
});

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
 * @param {Array} props.buyOffers - Calculated buy offers [{ price, pctOfSale? }, ...]
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
  showInlineOfferAction = true, // When false, keep interactive offers but hide inline add-action button
  onResetSearch = null,
  enableRightClickManualOffer = false, // When true (eBay page mode), right-click on offer opens manual-offer dialog
  addActionLabel = "Add to Cart",
  disableAddAction = false,
  hideOfferCards = false, // When true (e.g. repricing), hide the three offer cards and only show the single add action
  useVoucherOffers = false, // When true (store credit), display voucher prices instead of cash
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

  // Pivot state for range exclude selection (single-click sets pivot, second click completes range)
  const [rightClickPivotIdx, setRightClickPivotIdx] = useState(null);
  // The action to apply when the range is completed: true = exclude, false = un-exclude
  const [rightClickPivotAction, setRightClickPivotAction] = useState(null);

  // Context menu state for right-click "exclude all before / after"
  const [excludeContextMenu, setExcludeContextMenu] = useState(null); // { x, y, sortedIdx } | null
  const excludeContextMenuRef = useRef(null);
  
  // Ref to maintain input focus
  const manualInputRef = useRef(null);

  // Right-click manual offer dialog (eBay page mode only)
  const [manualOfferDialog, setManualOfferDialog] = useState(null); // { x, y, value, baseIndex } | null
  const manualOfferDialogRef = useRef(null);
  const manualOfferInputRef = useRef(null);
  const manualOfferDidFocusRef = useRef(false);

  const openManualOfferDialog = useCallback((e, idx, initialValue) => {
    e.preventDefault();
    e.stopPropagation();
    const dialogWidth = 288; // w-72
    const x = (e.clientX + dialogWidth > window.innerWidth)
      ? e.clientX - dialogWidth
      : e.clientX;
    setManualOfferDialog({ x, y: e.clientY, value: initialValue, baseIndex: idx });
    manualOfferDidFocusRef.current = false;
  }, []);

  const closeManualOfferDialog = useCallback(() => setManualOfferDialog(null), []);

  const applyManualOfferDialog = useCallback(() => {
    if (!manualOfferDialog) return;
    const raw = String(manualOfferDialog.value || '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed <= 0) {
      closeManualOfferDialog();
      return;
    }
    if (onAddToCartWithOffer) {
      onAddToCartWithOffer({ type: 'manual', amount: parsed, baseIndex: manualOfferDialog.baseIndex });
    } else if (onCompleteWithSelection) {
      onCompleteWithSelection('manual', parsed.toFixed(2));
    }
    closeManualOfferDialog();
  }, [manualOfferDialog, onAddToCartWithOffer, onCompleteWithSelection, closeManualOfferDialog]);

  useEffect(() => {
    if (!manualOfferDialog) return;
    const handleClickOutside = (e) => {
      if (manualOfferDialogRef.current && !manualOfferDialogRef.current.contains(e.target)) closeManualOfferDialog();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') closeManualOfferDialog();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [manualOfferDialog, closeManualOfferDialog]);

  useEffect(() => {
    if (!manualOfferDialog || manualOfferDidFocusRef.current || !manualOfferInputRef.current) return;
    manualOfferInputRef.current.focus();
    manualOfferInputRef.current.select();
    manualOfferDidFocusRef.current = true;
  }, [manualOfferDialog]);
  
  // Close exclude context menu on click-outside or Escape
  useEffect(() => {
    if (!excludeContextMenu) return;
    const handleClickOutside = (e) => {
      if (excludeContextMenuRef.current && !excludeContextMenuRef.current.contains(e.target)) setExcludeContextMenu(null);
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setExcludeContextMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [excludeContextMenu]);

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

  // Pre-compute filtered display list (avoids map+filter+map on every render)
  const displayListings = useMemo(() => {
    if (!sortedListings) return [];
    return sortedListings
      .map((entry, sortedIdx) => ({ ...entry, sortedIdx }))
      .filter(({ item }) => !showOnlyRelevant || !item.excluded);
  }, [sortedListings, showOnlyRelevant]);

  // Memoize for histogram to avoid new array on every render
  const histogramListings = useMemo(
    () => (displayedListings ? displayedListings.filter(l => !l.excluded) : displayedListings),
    [displayedListings]
  );

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
        <div className="flex items-center gap-2">
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
      </div>
    );
  }, [displayedStats, formatStat, statsWorkingOut, mode]);

  // Manual offer change handler - memoized to prevent input re-creation
  const handleManualOfferChange = useCallback((e) => {
    const value = e.target.value;
    onManualOfferChange?.(value);
  }, [onManualOfferChange]);

  // Handler for clicking on an offer card (when opened from negotiation page)
  // Auto-closes the modal and passes the displayed price directly to avoid stale-closure issues.
  const handleOfferClick = useCallback((price, index) => {
    if (showManualOffer && !readOnly) {
      const priceStr = Number(price).toFixed(2);
      if (onCompleteWithSelection) {
        onCompleteWithSelection(index, priceStr);
      } else {
        onManualOfferChange?.(priceStr);
        setSelectedOfferIndex(index);
      }
    }
  }, [showManualOffer, readOnly, onCompleteWithSelection, onManualOfferChange]);

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

  // % of suggested sale for manual offer (buy price / sale price)
  const manualOfferPctOfSale = useMemo(() => {
    if (!displayedStats?.suggestedPrice || !manualOffer) return null;
    const cleanManual = parseFloat(manualOffer.replace(/[£,]/g, ''));
    if (isNaN(cleanManual) || cleanManual <= 0) return null;
    const salePrice = displayedStats.suggestedPrice;
    if (salePrice <= 0) return null;
    return Math.round((cleanManual / salePrice) * 100);
  }, [displayedStats, manualOffer]);

  // Single-click handler: three-state cycle — unexcluded → pivot → excluded → unexcluded.
  const handleExcludeClick = useCallback((sortedIdx) => {
    if (!onToggleExclude || !sortedListings || !sortedListings[sortedIdx]) return;

    const { item: clicked, origIdx } = sortedListings[sortedIdx];
    const id = clicked._id ?? clicked.id ?? `${clicked.url ?? clicked.title ?? 'listing'}-${origIdx}`;

    // Excluded → unexclude
    if (clicked.excluded) {
      onToggleExclude(id);
      setRightClickPivotIdx(null);
      setRightClickPivotAction(null);
      return;
    }

    // Pivot → exclude (and clear pivot)
    if (rightClickPivotIdx === sortedIdx) {
      onToggleExclude(id);
      setRightClickPivotIdx(null);
      setRightClickPivotAction(null);
      return;
    }

    // Another item clicked while a pivot exists — complete range selection
    if (rightClickPivotIdx !== null) {
      const start = Math.min(rightClickPivotIdx, sortedIdx);
      const end = Math.max(rightClickPivotIdx, sortedIdx);
      for (let i = start; i <= end; i++) {
        const entry = sortedListings[i];
        if (!entry) continue;
        const { item: rangeItem, origIdx: rangeOrigIdx } = entry;
        const currentlyExcluded = !!rangeItem.excluded;
        if (currentlyExcluded !== rightClickPivotAction) {
          const rangeId = rangeItem._id ?? rangeItem.id ?? `${rangeItem.url ?? rangeItem.title ?? 'listing'}-${rangeOrigIdx}`;
          onToggleExclude(rangeId);
        }
      }
      setRightClickPivotIdx(null);
      setRightClickPivotAction(null);
      return;
    }

    // Unexcluded, no pivot — set as pivot
    setRightClickPivotIdx(sortedIdx);
    setRightClickPivotAction(true);
  }, [sortedListings, onToggleExclude, rightClickPivotIdx, rightClickPivotAction]);

  // Right-click handler: show context menu with "exclude all before" / "exclude all after".
  const handleExcludeContextMenu = useCallback((e, sortedIdx) => {
    if (!onToggleExclude || !sortedListings || !sortedListings[sortedIdx]) return;
    setExcludeContextMenu({ x: e.clientX, y: e.clientY, sortedIdx });
  }, [sortedListings, onToggleExclude]);

  // Context menu actions
  const handleExcludeAllBefore = useCallback(() => {
    if (!excludeContextMenu || !onToggleExclude || !sortedListings) return;
    const targetIdx = excludeContextMenu.sortedIdx;
    for (let i = 0; i < targetIdx; i++) {
      const entry = sortedListings[i];
      if (!entry) continue;
      const { item, origIdx } = entry;
      if (!item.excluded) {
        const id = item._id ?? item.id ?? `${item.url ?? item.title ?? 'listing'}-${origIdx}`;
        onToggleExclude(id);
      }
    }
    setExcludeContextMenu(null);
    setRightClickPivotIdx(null);
    setRightClickPivotAction(null);
  }, [excludeContextMenu, sortedListings, onToggleExclude]);

  const handleExcludeAllAfter = useCallback(() => {
    if (!excludeContextMenu || !onToggleExclude || !sortedListings) return;
    const targetIdx = excludeContextMenu.sortedIdx;
    for (let i = targetIdx + 1; i < sortedListings.length; i++) {
      const entry = sortedListings[i];
      if (!entry) continue;
      const { item, origIdx } = entry;
      if (!item.excluded) {
        const id = item._id ?? item.id ?? `${item.url ?? item.title ?? 'listing'}-${origIdx}`;
        onToggleExclude(id);
      }
    }
    setExcludeContextMenu(null);
    setRightClickPivotIdx(null);
    setRightClickPivotAction(null);
  }, [excludeContextMenu, sortedListings, onToggleExclude]);

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
    setRightClickPivotIdx(null);
    setRightClickPivotAction(null);
    setExcludeContextMenu(null);
  }, [displayedListings, onToggleExclude, onClearAllExclusions]);

  // MEMOIZED BUY OFFERS DISPLAY - inline stat-style layout, same row as stats
  const BuyOffersDisplay = useMemo(() => {
    const useAddWithOfferFlow = Boolean(onAddToCartWithOffer && !readOnly);
    if (hideOfferCards && !useAddWithOfferFlow) return null;
    if (!hideOfferCards && !buyOffers.length && !showManualOffer) return null;

    const offerLabels = useVoucherOffers
      ? ["1st Voucher Offer", "2nd Voucher Offer", "3rd Voucher Offer"]
      : ["1st Cash Offer", "2nd Cash Offer", "3rd Cash Offer"];
    const showRightClickManual = !hideOfferCards && (
      (enableRightClickManualOffer && useAddWithOfferFlow) ||
      (showManualOffer && Boolean(onCompleteWithSelection) && !readOnly)
    );
    const offersAreInteractive = useAddWithOfferFlow || (showManualOffer && !readOnly);

    return (
      <React.Fragment>
        {/* Leading separator from preceding stats */}
        <div className="w-px h-8 bg-gray-200" />
        <div className="flex items-center gap-6 flex-wrap">
          {!hideOfferCards && buyOffers.map((offer, idx) => {
            const { price: rawPrice } = offer;
            const price = useVoucherOffers ? toVoucherOfferPrice(rawPrice) : rawPrice;
            const pctOfSale = displayPctOfSaleForOffer(offer, displayedStats?.suggestedPrice);
            const isSelected = showManualOffer && selectedOfferIndex === idx;

            const inner = (
              <>
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">
                  {offerLabels[idx]}
                </span>
                <span className={`text-lg font-extrabold leading-tight ${isSelected ? 'text-blue-900' : 'text-blue-900'}`}>
                  £{formatStat(price)}
                </span>
                {pctOfSale != null && (
                  <span className="text-[10px] font-bold text-yellow-600">{pctOfSale}% sale</span>
                )}
              </>
            );

            return (
              <React.Fragment key={idx}>
                {idx > 0 && <div className="w-px h-8 bg-gray-200" />}
                {offersAreInteractive ? (
                  <div
                    onContextMenu={showRightClickManual ? (e) => {
                      const basePrice = Number(price);
                      openManualOfferDialog(e, idx, Number.isFinite(basePrice) && basePrice > 0 ? basePrice.toFixed(2) : '');
                    } : undefined}
                  >
                    <button
                      type="button"
                      className={`flex flex-col text-left cursor-pointer transition-opacity hover:opacity-75 focus:outline-none rounded ${
                        isSelected ? 'ring-2 ring-blue-900 p-0.5' : ''
                      }`}
                      onClick={
                        useAddWithOfferFlow
                          ? () => onAddToCartWithOffer(idx)
                          : (showManualOffer && !readOnly ? () => handleOfferClick(price, idx) : undefined)
                      }
                    >
                      {inner}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col">{inner}</div>
                )}
              </React.Fragment>
            );
          })}

          {useAddWithOfferFlow && showInlineOfferAction && (
            <>
              {buyOffers.length > 0 && <div className="w-px h-8 bg-gray-200" />}
              <button
                type="button"
                onClick={() => onAddToCartWithOffer(null)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-blue-900 font-extrabold text-xs uppercase shadow-sm transition-all ${
                  disableAddAction
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-yellow-500 hover:bg-yellow-400 cursor-pointer'
                }`}
                disabled={disableAddAction}
              >
                <Icon name={addActionLabel === 'Add to Reprice List' ? 'sell' : 'add_shopping_cart'} className="text-sm" />
                {addActionLabel}
              </button>
            </>
          )}

          {/* Manual Offer - inline stat style with bottom-border input */}
          {!hideOfferCards && showManualOffer && onManualOfferChange && (
            <>
              {(buyOffers.length > 0 || useAddWithOfferFlow) && <div className="w-px h-8 bg-gray-200" />}
              <div className="flex flex-col cursor-text" onClick={handleManualOfferCardClick}>
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">
                  Manual Offer
                </span>
                <div className="flex items-center">
                  <span className="text-lg font-extrabold text-blue-900 leading-tight">£</span>
                  <input
                    ref={manualInputRef}
                    type="text"
                    key="manual-offer-input"
                    className={`text-lg font-extrabold text-blue-900 bg-transparent outline-none w-20 border-b-2 ml-0.5 transition-colors leading-tight ${
                      selectedOfferIndex === 'manual' ? 'border-blue-900' : 'border-transparent focus:border-blue-200'
                    }`}
                    placeholder="0.00"
                    value={manualOffer}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleManualOfferChange(e);
                      if (!readOnly && showManualOffer && selectedOfferIndex !== 'manual') {
                        setSelectedOfferIndex('manual');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleComplete(); }
                    }}
                    onFocus={() => {
                      if (!readOnly && showManualOffer) setSelectedOfferIndex('manual');
                    }}
                    disabled={readOnly}
                    readOnly={readOnly}
                  />
                </div>
                {manualOfferPctOfSale !== null && (
                  <span className="text-[10px] font-bold text-yellow-600">{manualOfferPctOfSale}% sale</span>
                )}
              </div>
            </>
          )}
        </div>
      </React.Fragment>
    );
  }, [buyOffers, showManualOffer, selectedOfferIndex, manualOffer, manualOfferPctOfSale, onManualOfferChange, readOnly, handleOfferClick, handleManualOfferCardClick, handleManualOfferChange, onAddToCartWithOffer, formatStat, enableRightClickManualOffer, openManualOfferDialog, hideOfferCards, addActionLabel, disableAddAction, useVoucherOffers, displayedStats?.suggestedPrice, showInlineOfferAction]);

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

      {/* Stats at top when no histogram is shown (both page and modal modes) */}
      {!showHistogram && listings && (
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <StatsDisplay />
            {BuyOffersDisplay}
          </div>
          {mode === "page" && onAddNewItem && (
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
          {mode === "page" && !onAddNewItem && !onAddToCartWithOffer && (
            <Button
              variant="primary"
              size="md"
              onClick={readOnly ? undefined : handleComplete}
              className="shrink-0 mt-2 md:mt-0"
              disabled={readOnly || disableAddAction}
            >
              <Icon name="add_shopping_cart" className="text-sm" />
              {addActionLabel}
            </Button>
          )}
          {mode === "modal" && (
            <div className="flex gap-3 shrink-0 ml-auto">
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
                  if (found) {
                    setSortOrder(found.value);
                    setRightClickPivotIdx(null);
                    setRightClickPivotAction(null);
                  }
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
                  if (found) {
                    setSortOrder(found.value);
                    setRightClickPivotIdx(null);
                    setRightClickPivotAction(null);
                  }
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
      <div className={`flex ${mode === "page" ? "flex-1 min-h-0" : "flex-1"} overflow-hidden`}>
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
          <main className="flex-1 min-h-0 overflow-hidden bg-gray-100 flex">
            {/* Listings column: frozen stats strip + scrollable grid (matches buyer freeze-pane pattern) */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              <div
                className={`flex-1 min-h-0 overflow-y-auto histogram-scrollbar ${
                  displayedListings && displayedListings.length > 0 ? 'px-6 pb-6' : 'p-6'
                }`}
              >
              {displayedListings && displayedListings.length > 0 && (
                <div className="sticky top-0 z-20 -mx-6 px-6 pb-3 bg-gray-100 border-b border-gray-200 shadow-sm">
                  <div className="flex flex-col items-center gap-1.5 py-2.5 px-4 rounded-lg bg-gray-200/80 text-gray-700 border border-gray-300/60">
                    <div className="flex items-center justify-center gap-6 flex-wrap">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Records</span>
                        <span className="text-lg font-semibold tabular-nums">{displayedListings.length}</span>
                      </div>
                      <div className="w-px h-5 bg-gray-400 rounded-full" aria-hidden="true" />
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Displayed</span>
                        <span className="text-lg font-semibold tabular-nums text-blue-900">{displayListings.length}</span>
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
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-600 text-center max-w-3xl">
                      <span className="material-symbols-outlined text-[14px] text-gray-500 shrink-0">info</span>
                      <span><strong className="font-semibold">Click</strong> unexcluded to set pivot · <strong className="font-semibold">Click pivot</strong> to exclude · <strong className="font-semibold">Click excluded</strong> to re-include · <strong className="font-semibold">Click pivot then another</strong> to exclude range · <strong className="font-semibold">Right-click</strong> for before/after.</span>
                    </div>
                  </div>
                </div>
              )}

              <div className={displayedListings && displayedListings.length > 0 ? 'pt-4' : undefined}>
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
                {displayListings.map(({ item, origIdx, sortedIdx }, displayIdx) => (
                  <ListingCard
                    key={`${item._id || item.title}-${origIdx}`}
                    item={item}
                    origIdx={origIdx}
                    sortedIdx={sortedIdx}
                    displayIdx={displayIdx}
                    onExcludeClick={handleExcludeClick}
                    onExcludeContextMenu={handleExcludeContextMenu}
                    showExcludeButton={Boolean(onToggleExclude && !readOnly)}
                    readOnly={readOnly}
                    isPivot={rightClickPivotIdx === sortedIdx}
                  />
                ))}
              </div>
              </div>
              </div>
            </div>

            {/* --- HISTOGRAM COMPONENT (Right Side) --- */}
            {showHistogram && (
              <aside className="w-80 border-l border-gray-200 overflow-hidden flex flex-col shrink-0">
                {/* Stats + offers + actions panel above the histogram */}
                {listings && (
                  <div className="p-4 border-b border-gray-200 bg-white shrink-0 overflow-y-auto" style={{ maxHeight: '55%' }}>
                    {/* Stats */}
                    {displayedStats && (
                      <div className="grid grid-cols-3 gap-x-3 mb-3 pb-3 border-b border-gray-100">
                        {[
                          { label: 'Average',   value: displayedStats.average,        cls: 'text-blue-900'  },
                          { label: 'Median',    value: displayedStats.median,          cls: 'text-blue-900'  },
                          { label: 'Suggested', value: displayedStats.suggestedPrice,  cls: 'text-green-600' },
                        ].map(({ label, value, cls }) => (
                          <div key={label} className="flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 leading-none mb-0.5">{label}</span>
                            <span className={`text-sm font-extrabold leading-tight ${cls}`}>£{formatStat(value)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Offer cards — left-click to add, right-click for manual amount */}
                    {!hideOfferCards && buyOffers.length > 0 && (() => {
                      const offerLabels = useVoucherOffers
                        ? ['1st Voucher', '2nd Voucher', '3rd Voucher']
                        : ['1st Cash', '2nd Cash', '3rd Cash'];
                      return (
                        <div className="flex gap-1.5 mb-3">
                          {buyOffers.map((offer, idx) => {
                            const price = useVoucherOffers ? toVoucherOfferPrice(offer.price) : offer.price;
                            const pctOfSale = displayPctOfSaleForOffer(offer, displayedStats?.suggestedPrice);
                            return (
                              <button
                                key={idx}
                                type="button"
                                className="flex flex-col text-left px-2.5 py-2 rounded-lg bg-blue-50 border border-blue-100 hover:bg-blue-100 active:bg-blue-200 transition-colors flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                onClick={
                                  onAddToCartWithOffer
                                    ? () => onAddToCartWithOffer(idx)
                                    : (showManualOffer && !readOnly ? () => handleOfferClick(price, idx) : undefined)
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  const basePrice = Number(price);
                                  openManualOfferDialog(e, idx, Number.isFinite(basePrice) && basePrice > 0 ? basePrice.toFixed(2) : '');
                                }}
                                title="Left-click to select · Right-click for custom amount"
                              >
                                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-0.5">{offerLabels[idx]}</span>
                                <span className="text-sm font-extrabold text-blue-900 leading-tight">£{formatStat(price)}</span>
                                {pctOfSale != null && <span className="text-[10px] font-bold text-yellow-600 leading-none mt-0.5">{pctOfSale}%</span>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2">
                      {onAddNewItem && (
                        <Button variant="primary" size="sm" onClick={onAddNewItem} className="w-full">
                          <Icon name="add_circle" className="text-sm" />
                          Add new item
                        </Button>
                      )}
                      {!onAddNewItem && !onAddToCartWithOffer && mode !== "modal" && (
                        <Button variant="primary" size="sm" onClick={readOnly ? undefined : handleComplete} disabled={readOnly || disableAddAction} className="w-full">
                          <Icon name="add_shopping_cart" className="text-sm" />
                          {addActionLabel}
                        </Button>
                      )}
                      {mode === "modal" && (
                        <div className="flex gap-2 mt-1">
                          <Button variant="outline" size="sm" onClick={readOnly ? undefined : handleComplete} disabled={readOnly} className="flex-1">Cancel</Button>
                          <Button variant="primary" size="sm" onClick={handleComplete} disabled={loading && !readOnly} className="flex-1">OK</Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Histogram fills remaining space */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PriceHistogram
                    listings={histogramListings}
                    onBucketSelect={onDrillDown}
                    priceRange={currentPriceRange}
                    onGoBack={onZoomOut}
                    drillLevel={drillHistory.length}
                    readOnly={readOnly}
                  />
                </div>
              </aside>
            )}
          </main>
        )}
      </div>

    </>
  );

  // Wrapper classes based on mode
  const wrapperClasses = mode === "modal"
    ? "fixed inset-0 z-[100] flex items-start justify-center bg-black/40"
    : "";

  const containerClasses = mode === "modal"
    ? "bg-white w-full h-full flex flex-col overflow-hidden"
    : "bg-white w-full h-full flex flex-col overflow-hidden";

  const excludeContextMenuEl = excludeContextMenu && (
    <div
      ref={excludeContextMenuRef}
      className="fixed z-[120] bg-white rounded-lg border border-gray-200 shadow-xl min-w-[200px]"
      style={{
        left: Math.min(excludeContextMenu.x, window.innerWidth - 220),
        top: Math.min(excludeContextMenu.y, window.innerHeight - 100),
      }}
      role="menu"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Exclude</span>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          onClick={() => setExcludeContextMenu(null)}
          aria-label="Close menu"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
      <div className="py-1">
        <button
          type="button"
          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-900 flex items-center gap-2.5 transition-colors"
          onClick={handleExcludeAllBefore}
          role="menuitem"
        >
          <span className="material-symbols-outlined text-[16px]">vertical_align_top</span>
          Exclude all before this
        </button>
        <button
          type="button"
          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-900 flex items-center gap-2.5 transition-colors"
          onClick={handleExcludeAllAfter}
          role="menuitem"
        >
          <span className="material-symbols-outlined text-[16px]">vertical_align_bottom</span>
          Exclude all after this
        </button>
      </div>
    </div>
  );

  const manualOfferDialogEl = manualOfferDialog && (
    <div
      ref={manualOfferDialogRef}
      className="fixed z-[110] w-72 bg-white rounded-lg border border-gray-200 shadow-xl p-3"
      style={{ left: manualOfferDialog.x, top: manualOfferDialog.y }}
      role="dialog"
      aria-label="Set manual offer and add to cart"
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-2">
        Custom offer for this item
      </p>
      <p className="text-[11px] text-gray-500 mb-3">
        Type a per-item offer amount and press Enter or click Okay to add to cart with this manual offer.
      </p>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-blue-900">£</span>
          <input
            ref={manualOfferInputRef}
            type="number"
            min="0"
            step="0.01"
            className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-900"
            placeholder="0.00"
            value={manualOfferDialog.value}
            onChange={(e) => {
              const val = e.target.value;
              setManualOfferDialog((prev) => (prev ? { ...prev, value: val } : prev));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyManualOfferDialog();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 shrink-0"
          onClick={applyManualOfferDialog}
        >
          Okay
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="px-3 py-1.5 text-xs font-semibold text-gray-500 rounded-lg hover:bg-gray-50"
          onClick={closeManualOfferDialog}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return mode === "modal" ? (
    <div className={wrapperClasses}>
      <div className={containerClasses}>
        {content}
        {manualOfferDialogEl}
        {excludeContextMenuEl}
      </div>
    </div>
  ) : (
    <div className={containerClasses}>
      {content}
      {manualOfferDialogEl}
      {excludeContextMenuEl}
    </div>
  );
}
