import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, cancelListingTab, isExtensionListingFlowAborted } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { buildOtherResearchChannelsSummaries } from './researchOtherChannelsSummary';
import { Icon } from '../ui/components';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';

const SOURCE_CONFIG = {
  eBay: {
    idPrefix: 'ebay',
    label: 'eBay',
    headerTitle: 'eBay Market Research',
    headerIcon: 'search_insights',
    getDataPrompt: 'Click below to open eBay in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.',
    enableAdvancedSoldDateFilter: true,
    supportsCancelRefine: true,
  },
  CashConverters: {
    idPrefix: 'cc',
    label: 'Cash Converters',
    headerTitle: 'Cash Converters Market Research',
    headerIcon: 'store',
    getDataPrompt: 'Click below to open Cash Converters in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.',
    enableAdvancedSoldDateFilter: false,
    supportsCancelRefine: false,
  },
};

function ensureListingIds(items, prefix) {
  return items.map((item, idx) =>
    item._id ? item : { ...item, _id: `${prefix}-${Date.now()}-${idx}` }
  );
}

/** Canonical listing URL for links in the app (matches extension scrape pattern for id). */
const EBAY_UK_ITM_URL = (itemNumber) =>
  `https://www.ebay.co.uk/itm/${itemNumber}?nordt=true&orig_cvip=true`;

function extractEbayItemIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/itm\/(?:[^/?]+\/)?(\d{9,})/);
  return m ? m[1] : null;
}

function normalizeEbayListingItem(item) {
  if (!item || typeof item !== 'object') return item;
  let id = null;
  if (item.itemId != null && String(item.itemId).trim() !== '') {
    const digits = String(item.itemId).replace(/\D/g, '');
    if (digits.length >= 9) id = digits;
  }
  if (!id) id = extractEbayItemIdFromUrl(item.url);
  if (!id) return item;
  return {
    ...item,
    itemId: item.itemId != null && String(item.itemId).trim() !== '' ? item.itemId : id,
    url: EBAY_UK_ITM_URL(id),
  };
}

function prepareExtensionListingsForShell(source, results, idPrefix) {
  const items = Array.isArray(results) ? results : [];
  const mapped = source === 'eBay' ? items.map(normalizeEbayListingItem) : items;
  return ensureListingIds(mapped, idPrefix);
}

/**
 * Shared extension-driven research form supporting eBay and Cash Converters.
 * Source-specific behaviour is driven by the `source` prop.
 */
function ExtensionResearchForm({
  source = 'eBay',
  onComplete,
  category,
  mode = 'modal',
  savedState = null,
  initialHistogramState = null,
  readOnly = false,
  showManualOffer = false,
  initialSearchQuery = null,
  marketComparisonContext = null,
  resetDrillOnOpen = false,
  onAddNewItem = null,
  onOfferSelect = null,
  addActionLabel = 'Add to Cart',
  hideOfferCards = false,
  useVoucherOffers = false,
  onOffersChange = null,
  containModalInParent = false,
  hideAddAction = false,
  lineItemContext = null,
}) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.eBay;
  const isEbay = source === 'eBay';

  const categoryId = category?.id ?? null;
  const ebayOfferMargins = useEbayOfferMargins(categoryId);
  useEffect(() => {
    if (categoryId) useAppStore.getState().loadEbayOfferMargins(categoryId);
  }, [categoryId]);

  const [step, setStep] = useState(savedState?.listings?.length ? 'cards' : 'get-data');
  const [listings, setListings] = useState(() =>
    prepareExtensionListingsForShell(source, savedState?.listings ?? [], config.idPrefix)
  );
  const [dataVersion, setDataVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState(() => {
    if (savedState?.searchTerm != null && String(savedState.searchTerm).trim() !== '') {
      return String(savedState.searchTerm).trim();
    }
    if (initialSearchQuery != null && String(initialSearchQuery).trim() !== '') {
      return String(initialSearchQuery).trim();
    }
    return '';
  });
  const [listingPageUrl, setListingPageUrl] = useState(savedState?.listingPageUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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

  // ─── Data fetching ──────────────────────────────────────────────────────
  const handleGetData = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromListingPage(source, initialSearchQuery || undefined, marketComparisonContext);
      if (isEbay && userCancelledRef.current) return;
      if (result?.success && Array.isArray(result.results)) {
        setListings(prepareExtensionListingsForShell(source, result.results, config.idPrefix));
        setDataVersion(v => v + 1);
        const term = (result.searchTerm != null && String(result.searchTerm).trim())
          ? String(result.searchTerm).trim()
          : (isEbay ? '' : (initialSearchQuery || ''));
        setSearchTerm(term);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setStep('cards');
      } else if (isExtensionListingFlowAborted(result)) {
        if (mode === 'modal') onComplete?.({ cancel: true });
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked Yes.");
      }
    } catch (err) {
      if (isEbay && userCancelledRef.current) return;
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed and the tab open?');
    } finally {
      setLoading(false);
    }
  }, [source, isEbay, config.idPrefix, initialSearchQuery, marketComparisonContext, mode, onComplete]);

  const handleRefineSearch = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromRefine(source, listingPageUrl, marketComparisonContext);
      if (isEbay && userCancelledRef.current) return;
      if (result?.success && Array.isArray(result.results)) {
        setListings(prepareExtensionListingsForShell(source, result.results, config.idPrefix));
        setDataVersion(v => v + 1);
        if (isEbay) {
          setSearchTerm((result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : '');
        } else {
          setSearchTerm(prev => (result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : prev);
        }
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setError(null);
      } else if (isExtensionListingFlowAborted(result)) {
        setError(null);
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked the button.");
      }
    } catch (err) {
      if (isEbay && userCancelledRef.current) return;
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed?');
    } finally {
      setLoading(false);
    }
  }, [source, isEbay, config.idPrefix, listingPageUrl, marketComparisonContext]);

  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (mode === 'modal' && step === 'get-data' && !readOnly && savedState == null && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancelRefine = useCallback(() => {
    userCancelledRef.current = true;
    setError(null);
    cancelListingTab().catch(() => {});
  }, []);

  // ─── Listings / stats / offers ──────────────────────────────────────────
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;

  const handleToggleExclude = useCallback((listingId) => {
    setListings(prev => prev.map(l => l._id === listingId ? { ...l, excluded: !l.excluded } : l));
  }, []);

  const handleClearAllExclusions = useCallback(() => {
    setListings(prev => prev.map(l => (l.excluded ? { ...l, excluded: false } : l)));
  }, []);

  const displayedListings = useMemo(() => {
    if (!listings || listings.length === 0) return null;
    if (!currentPriceRange) return listings;
    return listings.filter(item => {
      const p = typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) : item.price;
      return !isNaN(p) && p >= currentPriceRange.min && p <= currentPriceRange.max;
    });
  }, [listings, currentPriceRange]);

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

  const otherResearchSummaries = useMemo(() => {
    if (!showManualOffer || !lineItemContext) return null;
    return buildOtherResearchChannelsSummaries(lineItemContext, source, { ebayOfferMargins, useVoucherOffers });
  }, [lineItemContext, showManualOffer, source, ebayOfferMargins, useVoucherOffers]);

  // eBay-only: debounced onOffersChange when exclusions or offers change
  const onOffersChangeRef = useRef(onOffersChange);
  useEffect(() => { onOffersChangeRef.current = onOffersChange; });
  const offersChangeInitializedRef = useRef(false);
  useEffect(() => {
    if (!isEbay) return;
    if (!offersChangeInitializedRef.current) { offersChangeInitializedRef.current = true; return; }
    const t = window.setTimeout(() => {
      onOffersChangeRef.current?.({ buyOffers, listings, stats: displayedStats });
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEbay, listings, buyOffers]);

  // ─── Advanced filter state tracking (for persistence) ────────────────────
  const advancedFilterStateRef = useRef(savedState?.advancedFilterState ?? null);
  const handleAdvancedFilterChange = useCallback((filterState) => {
    advancedFilterStateRef.current = filterState;
  }, []);

  // ─── Drill handlers ─────────────────────────────────────────────────────
  const handleDrillDown = useCallback((rangeStart, rangeEnd) => {
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  }, []);

  const handleZoomOut = useCallback(() => {
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  // ─── Completion helpers ─────────────────────────────────────────────────
  const buildPayload = useCallback((extras = {}) => ({
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
    advancedFilterState: advancedFilterStateRef.current,
    ...extras,
  }), [listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer]);

  const handleComplete = useCallback(() => {
    onComplete?.(buildPayload());
  }, [onComplete, buildPayload]);

  const handleCompleteWithSelection = useCallback((selectedOfferIndex, overrideManualOffer) => {
    const state = buildPayload({ manualOffer: overrideManualOffer ?? manualOffer });
    if (showManualOffer) state.selectedOfferIndex = selectedOfferIndex;
    onComplete?.(state);
  }, [onComplete, buildPayload, manualOffer, showManualOffer]);

  const handleAddToCartWithOffer = useCallback((offerArg) => {
    let selectedOfferIndex = offerArg;
    let nextManualOffer = manualOffer;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferIndex = 'manual';
      const amount = Number(offerArg.amount);
      if (Number.isFinite(amount) && amount > 0) nextManualOffer = amount.toFixed(2);
    }
    onComplete?.(buildPayload({ manualOffer: nextManualOffer, selectedOfferIndex }));
  }, [onComplete, buildPayload, manualOffer]);

  const handleOfferSelect = useCallback((offerArg) => {
    onOfferSelect?.(offerArg);
  }, [onOfferSelect]);

  const handleResetSearch = useCallback(() => {
    if (isEbay && loading) {
      userCancelledRef.current = true;
      cancelListingTab().catch(() => {});
    }
    setListings([]);
    setDataVersion(v => v + 1);
    setSearchTerm('');
    setListingPageUrl(null);
    setDrillHistory([]);
    setShowHistogram(initialHistogramState !== null ? initialHistogramState : (mode === 'modal'));
    setManualOffer('');
    setError(null);
    setLoading(false);
    setStep('get-data');
  }, [isEbay, loading, initialHistogramState, mode]);

  // ─── Get-data step ──────────────────────────────────────────────────────
  if (step === 'get-data') {
    const getDataBody = (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[200px] gap-4 p-6">
        <p className="text-gray-600 text-center">{config.getDataPrompt}</p>
        <button
          type="button"
          onClick={handleGetData}
          disabled={loading || readOnly}
          className="px-6 py-3 bg-brand-blue text-white font-semibold rounded-xl shadow-md hover:bg-brand-blue-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Waiting for you to get the data\u2026' : 'Get data'}
        </button>
        {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}
      </div>
    );

    if (mode === 'modal') {
      const wrapperClass = containModalInParent
        ? 'flex h-full min-h-0 w-full flex-col'
        : 'fixed inset-0 z-[100] flex items-start justify-center bg-black/40';
      return (
        <div className={wrapperClass}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <header className="bg-brand-blue px-6 py-4 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 p-1.5 rounded">
                  <Icon name={config.headerIcon} className="text-brand-orange" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{config.headerTitle}</h2>
                  <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                    Get data via Chrome extension
                  </p>
                </div>
              </div>
              <WorkspaceCloseButton
                title={`Close ${config.label} research`}
                onClick={() => onComplete?.({ cancel: true })}
              />
            </header>
            <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">{getDataBody}</main>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-gray-50">
        <header className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <h2 className="text-lg font-bold text-brand-blue">{config.headerTitle}</h2>
          <p className="text-sm text-gray-500">Get data from a listings page via the Chrome extension</p>
        </header>
        <main className="flex-1 overflow-auto flex flex-col">{getDataBody}</main>
      </div>
    );
  }

  // ─── Cards step → ResearchFormShell ─────────────────────────────────────
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
      onComplete={handleComplete}
      onCompleteWithSelection={showManualOffer ? handleCompleteWithSelection : undefined}
      onAddToCartWithOffer={
        isEbay && !readOnly
          ? (onOfferSelect ? handleOfferSelect : (onComplete && !showManualOffer ? handleAddToCartWithOffer : undefined))
          : undefined
      }
      showInlineOfferAction={isEbay ? (mode === 'page' ? !onAddNewItem : !onOfferSelect) : undefined}
      enableRightClickManualOffer={isEbay && mode === 'page'}
      enableAdvancedSoldDateFilter={config.enableAdvancedSoldDateFilter}
      mode={mode}
      readOnly={readOnly}
      basicFilterOptions={[]}
      searchPlaceholder=""
      headerTitle={searchTerm || config.headerTitle}
      headerSubtitle={
        searchTerm
          ? (isEbay ? `eBay: ${searchTerm}` : `Cash Converters: ${searchTerm}`)
          : 'Real-time valuation lookup'
      }
      headerIcon={config.headerIcon}
      buyOffers={buyOffers}
      customControls={null}
      allowHistogramToggle={initialHistogramState !== false}
      manualOffer={manualOffer}
      onManualOfferChange={showManualOffer ? setManualOffer : null}
      showManualOffer={showManualOffer}
      hideSearchAndFilters={true}
      onRefineSearch={handleRefineSearch}
      onCancelRefine={config.supportsCancelRefine ? handleCancelRefine : undefined}
      refineError={error}
      refineLoading={loading}
      onToggleExclude={!readOnly ? handleToggleExclude : undefined}
      onClearAllExclusions={!readOnly ? handleClearAllExclusions : undefined}
      onAddNewItem={onAddNewItem}
      onResetSearch={!readOnly ? handleResetSearch : null}
      addActionLabel={addActionLabel}
      hideOfferCards={hideOfferCards}
      useVoucherOffers={useVoucherOffers}
      containModalInParent={containModalInParent}
      hidePrimaryAddAction={hideAddAction}
      initialAdvancedFilterState={savedState?.advancedFilterState ?? null}
      onAdvancedFilterChange={handleAdvancedFilterChange}
      dataVersion={dataVersion}
      otherResearchSummaries={otherResearchSummaries}
    />
  );
}

export default React.memo(ExtensionResearchForm);
