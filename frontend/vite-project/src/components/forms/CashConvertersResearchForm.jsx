import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { getDataFromListingPage, getDataFromRefine } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { Icon } from '../ui/components';

/**
 * Cash Converters Research Form – multi-step flow:
 * 1. User clicks "Get data" → extension opens cashconverters.co.uk in a new tab.
 * 2. User lands on a listings page; extension shows "Have you got the data yet?" [Yes].
 * 3. User clicks Yes → data appears in ResearchFormShell with histogram, buy offers, modal/page mode (no left filters).
 */
export default function CashConvertersResearchForm({
  onComplete,
  category,
  mode = 'modal',
  savedState = null,
  initialHistogramState = null,
  readOnly = false,
  showManualOffer = false,
}) {
  const [step, setStep] = useState(savedState?.listings?.length ? 'cards' : 'get-data');
  const [listings, setListings] = useState(savedState?.listings ?? []);
  const [listingPageUrl, setListingPageUrl] = useState(savedState?.listingPageUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drillHistory, setDrillHistory] = useState(savedState?.drillHistory ?? []);
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
      const result = await getDataFromListingPage('CashConverters');
      if (result?.success && Array.isArray(result.results)) {
        setListings(result.results);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setStep('cards');
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked Yes.");
      }
    } catch (err) {
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed and the tab open?');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefineSearch = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromRefine('CashConverters', listingPageUrl);
      if (result?.success && Array.isArray(result.results)) {
        setListings(result.results);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setError(null);
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked the button.");
      }
    } catch (err) {
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed?');
    } finally {
      setLoading(false);
    }
  }, [listingPageUrl]);

  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;

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

  const stats = useMemo(() => calculateStats(listings), [listings]);
  const displayedStats = useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) return stats;
    return calculateStats(displayedListings);
  }, [displayedListings, stats]);

  const buyOffers = useMemo(
    () => calculateBuyOffers(displayedStats.suggestedPrice),
    [displayedStats.suggestedPrice]
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
      searchTerm: '',
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer,
    });
  }, [onComplete, listings, showHistogram, drillHistory, displayedStats, buyOffers, listingPageUrl, manualOffer]);

  const handleCompleteWithSelection = useCallback((selectedOfferIndex) => {
    const state = {
      listings,
      showHistogram,
      drillHistory,
      stats: displayedStats,
      buyOffers,
      searchTerm: '',
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer,
    };
    if (showManualOffer) state.selectedOfferIndex = selectedOfferIndex;
    onComplete?.(state);
  }, [onComplete, listings, showHistogram, drillHistory, displayedStats, buyOffers, listingPageUrl, manualOffer, showManualOffer]);

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
      return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40">
          <div className="bg-white w-full h-full flex flex-col overflow-hidden">
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
    />
  );
}
