import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, cancelListingTab } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { Icon, Button } from '../ui/components';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';

/**
 * eBay Research Form – multi-step flow:
 * 1. User clicks "Get data" → extension opens ebay.co.uk in a new tab.
 * 2. User lands on a listings page; extension shows "Have you got the data yet?" [Yes].
 * 3. User clicks Yes → data appears in ResearchFormShell with histogram, buy offers, modal/page mode (no left filters).
 */
function ensureListingIds(items) {
  return items.map((item, idx) =>
    item._id ? item : { ...item, _id: `ebay-${Date.now()}-${idx}` }
  );
}

function EbayResearchForm({
  onComplete,
  category,
  mode = 'modal',
  savedState = null,
  initialHistogramState = null,
  readOnly = false,
  showManualOffer = false,
  referenceData = null,
  ourSalePrice = null,
  initialSearchQuery = null,
  marketComparisonContext = null,
  resetDrillOnOpen = false,
  onAddNewItem = null,
  onOfferSelect = null,
  addActionLabel = 'Add to Cart',
  hideOfferCards = false,
  useVoucherOffers = false,
}) {
  const categoryId = category?.id ?? null;
  const ebayOfferMargins = useEbayOfferMargins(categoryId);
  useEffect(() => {
    if (categoryId) useAppStore.getState().loadEbayOfferMargins(categoryId);
  }, [categoryId]);
  const [step, setStep] = useState(savedState?.listings?.length ? 'cards' : 'get-data');
  const [listings, setListings] = useState(() => ensureListingIds(savedState?.listings ?? []));
  const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm ?? '');
  const [listingPageUrl, setListingPageUrl] = useState(savedState?.listingPageUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // When the user clicks Cancel or Reset while a listing tab is open, we set this
  // ref so that the still-awaiting handleRefineSearch/handleGetData promise is
  // ignored when it eventually resolves (avoids calling onComplete or showing errors).
  const userCancelledRef = useRef(false);
  const [drillHistory, setDrillHistory] = useState(resetDrillOnOpen ? [] : (savedState?.drillHistory ?? []));
  const [showHistogram, setShowHistogram] = useState(
    savedState?.showHistogram ?? (initialHistogramState !== null ? initialHistogramState : mode === 'modal')
  );
  const [manualOffer, setManualOffer] = useState(savedState?.manualOffer ?? '');

  useEffect(() => {
    if (initialHistogramState !== null) setShowHistogram(initialHistogramState);
    else if (savedState?.showHistogram !== undefined) setShowHistogram(savedState.showHistogram);
    else if (mode === 'modal' && step === 'cards') setShowHistogram(true);
  }, [initialHistogramState, savedState?.showHistogram, mode, step]);

  const handleGetData = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    const searchQueryToSend = initialSearchQuery || undefined;
    if (typeof console !== 'undefined') {
      console.log('[CG Suite] Get data clicked, initialSearchQuery:', initialSearchQuery, '-> sending:', searchQueryToSend);
    }
    try {
      const result = await getDataFromListingPage('eBay', searchQueryToSend, marketComparisonContext);
      if (userCancelledRef.current) return; // user hit Cancel/Reset — ignore result
      if (result?.success && Array.isArray(result.results)) {
        setListings(ensureListingIds(result.results));
        setSearchTerm((result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : '');
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setStep('cards');
      } else if (result?.cancelled) {
        if (mode === 'modal') {
          onComplete?.({ cancel: true });
        }
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked Yes.");
      }
    } catch (err) {
      if (!userCancelledRef.current) {
        setError(err?.message || 'Extension communication failed. Is the Chrome extension installed and the tab open?');
      }
    } finally {
      setLoading(false);
    }
  }, [initialSearchQuery, marketComparisonContext, mode, onComplete]);

  const handleRefineSearch = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromRefine('eBay', listingPageUrl, marketComparisonContext);
      if (userCancelledRef.current) return; // user hit Cancel/Reset — ignore result
      if (result?.success && Array.isArray(result.results)) {
        setListings(ensureListingIds(result.results));
        setSearchTerm((result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : '');
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setError(null);
      } else if (result?.cancelled) {
        if (mode === 'modal') {
          onComplete?.({ cancel: true });
        }
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked the button.");
      }
    } catch (err) {
      if (!userCancelledRef.current) {
        setError(err?.message || 'Extension communication failed. Is the Chrome extension installed?');
      }
    } finally {
      setLoading(false);
    }
  }, [listingPageUrl, marketComparisonContext, mode, onComplete]);

  const autoTriggeredRef = useRef(false);
  // Auto-trigger get data once on mount in modal mode only.
  // Page mode is a persistent panel that resets after cart adds — firing there would open
  // an unwanted tab every time the user adds an item to cart.
  useEffect(() => {
    if (mode === 'modal' && step === 'get-data' && !readOnly && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel the active listing tab session without leaving the cards view.
  // The awaiting handleRefineSearch/handleGetData promise resolves but is ignored
  // because userCancelledRef is set, so no error or onComplete is triggered.
  const handleCancelRefine = useCallback(() => {
    userCancelledRef.current = true;
    setError(null);
    cancelListingTab().catch(() => {});
    // setLoading(false) will be called by the finally block of the awaiting handler
  }, []);

  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;

  const handleToggleExclude = useCallback((listingId) => {
    setListings(prev => prev.map(l =>
      l._id === listingId ? { ...l, excluded: !l.excluded } : l
    ));
  }, []);

  const handleClearAllExclusions = useCallback(() => {
    setListings(prev => prev.map(l => (l.excluded ? { ...l, excluded: false } : l)));
  }, []);

  const displayedListings = useMemo(() => {
    if (!listings || listings.length === 0) return null;
    if (!currentPriceRange) return listings;
    return listings.filter(item => {
      const p = typeof item.price === 'string'
        ? parseFloat(item.price.replace(/[^0-9.]/g, ''))
        : item.price;
      return !isNaN(p) && p >= currentPriceRange.min && p <= currentPriceRange.max;
    });
  }, [listings, currentPriceRange]);

  // Stats exclude listings marked as excluded
  const stats = useMemo(() => calculateStats(listings.filter(l => !l.excluded)), [listings]);
  const displayedStats = useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) return stats;
    const relevant = displayedListings.filter(l => !l.excluded);
    if (relevant.length === 0) return stats;
    return calculateStats(relevant);
  }, [displayedListings, stats]);

  const buyOffers = useMemo(
    () => calculateBuyOffers(displayedStats.suggestedPrice, ebayOfferMargins),
    [displayedStats.suggestedPrice, ebayOfferMargins]
  );

  const handleDrillDown = useCallback((rangeStart, rangeEnd) => {
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  }, []);

  const handleZoomOut = useCallback(() => {
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  const handleComplete = useCallback(() => {
    onComplete?.({
      listings,
      showHistogram,
      drillHistory,
      stats: displayedStats,
      buyOffers,
      searchTerm,
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer,
    });
  }, [onComplete, listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer]);

  const handleCompleteWithSelection = useCallback((selectedOfferIndex, overrideManualOffer) => {
    const state = {
      listings,
      showHistogram,
      drillHistory,
      stats: displayedStats,
      buyOffers,
      searchTerm,
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer: overrideManualOffer ?? manualOffer,
    };
    if (showManualOffer) state.selectedOfferIndex = selectedOfferIndex;
    onComplete?.(state);
  }, [onComplete, listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer, showManualOffer]);

  const handleAddToCartWithOffer = useCallback((offerArg) => {
    let selectedOfferIndex = offerArg;
    let nextManualOffer = manualOffer;

    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferIndex = 'manual';
      const amount = Number(offerArg.amount);
      if (Number.isFinite(amount) && amount > 0) {
        nextManualOffer = amount.toFixed(2);
      }
    }

    const state = {
      listings,
      showHistogram,
      drillHistory,
      stats: displayedStats,
      buyOffers,
      searchTerm,
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer: nextManualOffer,
      selectedOfferIndex,
    };
    onComplete?.(state);
  }, [onComplete, listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer]);

  const handleOfferSelect = useCallback((offerArg) => {
    if (!onOfferSelect) return;
    onOfferSelect(offerArg);
  }, [onOfferSelect]);

  const handleResetSearch = useCallback(() => {
    // If a listing tab is currently open and waiting, cancel it first
    if (loading) {
      userCancelledRef.current = true;
      cancelListingTab().catch(() => {});
    }
    setListings([]);
    setSearchTerm('');
    setListingPageUrl(null);
    setDrillHistory([]);
    setShowHistogram(initialHistogramState !== null ? initialHistogramState : (mode === 'modal'));
    setManualOffer('');
    setError(null);
    setLoading(false);
    setStep('get-data');
  }, [loading, initialHistogramState, mode]);

  if (step === 'get-data') {
    const getDataBody = (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[200px] gap-4 p-6">
        <p className="text-gray-600 text-center">
          Click below to open eBay in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.
        </p>
        <button
          type="button"
          onClick={handleGetData}
          disabled={loading || readOnly}
          className="px-6 py-3 bg-blue-900 text-white font-semibold rounded-xl shadow-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Waiting for you to get the data…' : 'Get data'}
        </button>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
        )}
      </div>
    );

    if (mode === 'modal') {
      return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40">
          <div className="bg-white w-full h-full flex flex-col overflow-hidden">
            <header className="bg-blue-900 px-6 py-4 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 p-1.5 rounded">
                  <Icon name="search_insights" className="text-yellow-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">eBay Market Research</h2>
                  <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                    Get data via Chrome extension
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-white/60 hover:text-white transition-colors p-1"
                onClick={() => onComplete?.({ cancel: true })}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </header>
            <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">
              {getDataBody}
            </main>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-gray-50">
        <header className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <h2 className="text-lg font-bold text-blue-900">eBay Market Research</h2>
          <p className="text-sm text-gray-500">Get data from a listings page via the Chrome extension</p>
        </header>
        <main className="flex-1 overflow-auto flex flex-col">
          {getDataBody}
        </main>
      </div>
    );
  }

  return (
    <>
      <ResearchFormShell
      searchTerm=""
      onSearchTermChange={() => {}}
      onSearch={() => {}}
      listings={listings}
      displayedListings={displayedListings}
      stats={stats}
      displayedStats={displayedStats}
      filterOptions={[]}
      selectedFilters={{ basic: [], apiFilters: {} }}
      onBasicFilterChange={() => {}}
      onApiFilterChange={() => {}}
      loading={false}
      showHistogram={showHistogram}
      onShowHistogramChange={setShowHistogram}
      drillHistory={drillHistory}
      onDrillDown={handleDrillDown}
      onZoomOut={handleZoomOut}
      onNavigateToDrillLevel={handleNavigateToDrillLevel}
      onComplete={showManualOffer ? undefined : handleComplete}
      onCompleteWithSelection={showManualOffer ? handleCompleteWithSelection : undefined}
      onAddToCartWithOffer={mode === 'page' && !readOnly
        ? (onOfferSelect ? handleOfferSelect : (onComplete && !onAddNewItem ? handleAddToCartWithOffer : undefined))
        : undefined}
      showInlineOfferAction={mode === 'page' ? !onAddNewItem : !onOfferSelect}
      enableRightClickManualOffer={mode === 'page'}
      mode={mode}
      readOnly={readOnly}
      basicFilterOptions={[]}
      searchPlaceholder=""
      headerTitle={searchTerm || 'eBay Market Research'}
      headerSubtitle={searchTerm ? `eBay: ${searchTerm}` : 'Real-time valuation lookup'}
      headerIcon="search_insights"
      buyOffers={buyOffers}
      customControls={null}
      allowHistogramToggle={initialHistogramState !== false}
      manualOffer={manualOffer}
      onManualOfferChange={showManualOffer ? setManualOffer : null}
      showManualOffer={showManualOffer}
      hideSearchAndFilters={true}
      onRefineSearch={handleRefineSearch}
      onCancelRefine={handleCancelRefine}
      refineError={error}
      refineLoading={loading}
      onToggleExclude={!readOnly ? handleToggleExclude : undefined}
      onClearAllExclusions={!readOnly ? handleClearAllExclusions : undefined}
      onAddNewItem={onAddNewItem}
      onResetSearch={!readOnly ? handleResetSearch : null}
      addActionLabel={addActionLabel}
      hideOfferCards={hideOfferCards}
      useVoucherOffers={useVoucherOffers}
    />
    </>
  );
}

export default React.memo(EbayResearchForm);
