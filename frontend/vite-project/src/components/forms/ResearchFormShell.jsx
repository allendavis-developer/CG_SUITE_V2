import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button, Icon, HorizontalOfferCard } from '../ui/components';

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
                Drilling into <span className="font-bold text-blue-900">£{priceRange.min.toFixed(0)} - £{priceRange.max.toFixed(0)}</span> range
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
  showManualOffer = false
}) {
  // Get current price range (latest in history, or null for full view)
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  
  // State for selected offer when opened from negotiation page
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(null); // null, 0, 1, 2, or 'manual'
  
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

  // MEMOIZED STATS DISPLAY COMPONENT
  const StatsDisplay = useMemo(() => () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          Average
          <span
            title="Rounded to nearest £5 for realistic market pricing"
            className="text-[9px] text-blue-900 bg-blue-100 px-1.5 py-0.5 rounded"
          >
            £5
          </span>
        </span>
        <span className="text-lg font-extrabold text-blue-900">£{displayedStats.average}</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          Median
          <span
            title="Rounded to nearest £5 for realistic market pricing"
            className="text-[9px] text-blue-900 bg-blue-100 px-1.5 py-0.5 rounded"
          >
            £5
          </span>
        </span>
        <span className="text-lg font-extrabold text-blue-900">£{displayedStats.median}</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      <div className="flex flex-col">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          Suggested Sale Price
          <span
            title="Rounded to nearest £5 for realistic market pricing"
            className="text-[9px] text-blue-900 bg-blue-100 px-1.5 py-0.5 rounded"
          >
            £5
          </span>
        </span>
        <span className="text-lg font-extrabold text-green-600">£{displayedStats.suggestedPrice}</span>
      </div>
    </div>
  ), [displayedStats]);

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

  // MEMOIZED BUY OFFERS DISPLAY with manual offer card
  const BuyOffersDisplay = useMemo(() => {
    if (!buyOffers.length && !showManualOffer) return null;

    const offerLabels = ["1st Cash Offer", "2nd Cash Offer", "3rd Cash Offer"];

    return (
      <div className="flex flex-wrap items-center gap-4">
        {buyOffers.map(({ price }, idx) => (
          <HorizontalOfferCard
            key={idx}
            title={offerLabels[idx] || `${idx + 1}th Offer`}
            price={`£${price}`}
            margin={Math.round([0.6, 0.5, 0.4][idx] * 100)}
            isHighlighted={showManualOffer && selectedOfferIndex === idx}
            onClick={showManualOffer && !readOnly ? () => handleOfferClick(price, idx) : undefined}
          />
        ))}
        
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
  }, [buyOffers, showManualOffer, selectedOfferIndex, manualOffer, manualOfferMargin, onManualOfferChange, readOnly, handleOfferClick, handleManualOfferCardClick, handleManualOfferChange]);

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
        </div>
      )}

      {/* Search Input */}
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
        
        <div className="mt-3 flex items-center gap-4">
          {/* Custom controls (e.g., "Behave like eBay" checkbox) */}
          {customControls}
          
          {/* Show Histogram toggle */}
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
        </div>
      </div>

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
                        £{range.min.toFixed(0)} - £{range.max.toFixed(0)}
                      </button>
                    </React.Fragment>
                  ))}

                  {displayedListings && (
                    <div className="mb-4 flex items-center gap-4">
                      <div className="px-4 py-2 rounded-xl bg-blue-900 text-white shadow-md flex items-center gap-3">
                        <span className="material-symbols-outlined text-yellow-400 text-lg">
                          inventory_2
                        </span>

                        <div className="leading-tight">
                          <div className="text-[10px] uppercase tracking-wider text-blue-200">
                            Listings in view
                          </div>
                          <div className="text-2xl font-extrabold">
                            {displayedListings.length}
                          </div>
                        </div>
                      </div>

                      {drillHistory.length > 0 && (
                        <div className="text-xs text-gray-500">
                          from <span className="font-bold text-gray-900">{listings.length}</span> total
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={`grid ${showHistogram ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                {displayedListings && displayedListings.map((item, idx) => (
                  <a
                    key={`${item.title}-${idx}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
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
                          alt={item.title || "listing"}
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
                {readOnly ? "OK" : <><Icon name="save" className="text-sm" /> Apply Research Data</>}
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
