import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, isExtensionListingFlowAborted } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { Icon } from '../ui/components';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';

/**
 * Cash Converters Research Form – multi-step flow:
 * 1. User clicks "Get data" → extension opens cashconverters.co.uk in a new tab.
 * 2. User lands on a listings page; extension shows "Have you got the data yet?" [Yes].
 * 3. User clicks Yes → data appears in ResearchFormShell with histogram, buy offers, modal/page mode (no left filters).
 */
function ensureListingIds(items) {
  return items.map((item, idx) =>
    item._id ? item : { ...item, _id: `cc-${Date.now()}-${idx}` }
  );
}

export default function CashConvertersResearchForm({
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
  addActionLabel = 'Add to Cart',
  hideOfferCards = false,
  useVoucherOffers = false,
  containModalInParent = false,
  hideAddAction = false,
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
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromListingPage('CashConverters', initialSearchQuery || undefined, marketComparisonContext);
      if (result?.success && Array.isArray(result.results)) {
        setListings(ensureListingIds(result.results));
        const term = (result.searchTerm != null && String(result.searchTerm).trim())
          ? String(result.searchTerm).trim()
          : (initialSearchQuery || '');
        setSearchTerm(term);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setStep('cards');
      } else if (isExtensionListingFlowAborted(result)) {
        if (mode === 'modal') {
          onComplete?.({ cancel: true });
        }
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked Yes.");
      }
    } catch (err) {
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed and the tab open?');
    } finally {
      setLoading(false);
    }
  }, [initialSearchQuery, marketComparisonContext]);

  const autoTriggeredRef = useRef(false);
  // Auto-trigger get data once on mount in modal mode only.
  // Page mode is a persistent panel that resets after cart adds — firing there would open
  // an unwanted tab every time the user adds an item to cart.
  useEffect(() => {
    if (
      mode === 'modal'
      && step === 'get-data'
      && !readOnly
      && savedState == null
      && !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefineSearch = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromRefine('CashConverters', listingPageUrl, marketComparisonContext);
      if (result?.success && Array.isArray(result.results)) {
        setListings(ensureListingIds(result.results));
        setSearchTerm((prev) => (result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : prev);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setError(null);
      } else if (isExtensionListingFlowAborted(result)) {
        // Listing tab closed during refine — stay on cards with previous results.
        setError(null);
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked the button.");
      }
    } catch (err) {
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed?');
    } finally {
      setLoading(false);
    }
  }, [listingPageUrl, marketComparisonContext]);

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

  const handleResearchCancel = useCallback(() => {
    onComplete?.({ cancel: true });
  }, [onComplete]);

  const handleResetSearch = useCallback(() => {
    // Go back to the initial "get data" step and clear current research state
    setListings([]);
    setSearchTerm('');
    setListingPageUrl(null);
    setDrillHistory([]);
    setShowHistogram(initialHistogramState !== null ? initialHistogramState : (mode === 'modal'));
    setManualOffer('');
    setError(null);
    setStep('get-data');
  }, [initialHistogramState, mode]);

  if (step === 'get-data') {
    const getDataBody = (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[200px] gap-4 p-6">
        <p className="text-gray-600 text-center">
          Click below to open Cash Converters in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.
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
      const modalWrapperClass = containModalInParent
        ? 'flex h-full min-h-0 w-full flex-col'
        : 'fixed inset-0 z-[100] flex items-start justify-center bg-black/40';
      return (
        <div className={modalWrapperClass}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <header className="bg-blue-900 px-6 py-4 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 p-1.5 rounded">
                  <Icon name="store" className="text-yellow-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Cash Converters Market Research</h2>
                  <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                    Get data via Chrome extension
                  </p>
                </div>
              </div>
              <WorkspaceCloseButton
                title="Close Cash Converters research"
                onClick={() => onComplete?.({ cancel: true })}
              />
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
          <h2 className="text-lg font-bold text-blue-900">Cash Converters Market Research</h2>
          <p className="text-sm text-gray-500">Get data from a listings page via the Chrome extension</p>
        </header>
        <main className="flex-1 overflow-auto flex flex-col">
          {getDataBody}
        </main>
      </div>
    );
  }

  return (
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
      onCancel={handleResearchCancel}
      mode={mode}
      readOnly={readOnly}
      basicFilterOptions={[]}
      searchPlaceholder=""
      headerTitle="Cash Converters Market Research"
      headerSubtitle="Real-time valuation lookup"
      headerIcon="store"
      buyOffers={buyOffers}
      customControls={null}
      allowHistogramToggle={initialHistogramState !== false}
      manualOffer={manualOffer}
      onManualOfferChange={showManualOffer ? setManualOffer : null}
      showManualOffer={showManualOffer}
      hideSearchAndFilters={true}
      onRefineSearch={handleRefineSearch}
      refineError={error}
      refineLoading={loading}
      referenceData={referenceData}
      ourSalePrice={ourSalePrice}
      onToggleExclude={!readOnly ? handleToggleExclude : undefined}
      onClearAllExclusions={!readOnly ? handleClearAllExclusions : undefined}
      onAddNewItem={onAddNewItem}
      onResetSearch={!readOnly ? handleResetSearch : null}
      addActionLabel={addActionLabel}
      hideOfferCards={hideOfferCards}
      useVoucherOffers={useVoucherOffers}
      containModalInParent={containModalInParent}
      hidePrimaryAddAction={hideAddAction}
    />
  );
}
