import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, cancelListingTab, isExtensionListingFlowAborted } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { buildOtherResearchChannelsSummaries } from './researchOtherChannelsSummary';
import { Icon } from '../ui/components';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';
import { fetchProductCategories, fetchAllCategoriesFlat } from '@/services/api';
import { matchCexCategoryNameToDb } from '@/utils/cexCategoryMatch';

// ─── Category Picker (hierarchical, JewelleryPickerList-style) ───────────────

function CategoryPickerList({ items, isLoading, onSelect, query, setQuery, statsHeading, entitySingular, entityPlural }) {
  const searchRef = useRef(null);

  useEffect(() => { if (!isLoading && items.length > 0) searchRef.current?.focus({ preventScroll: true }); }, [isLoading, items.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [items, query]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
        <span className="material-symbols-outlined animate-spin text-3xl text-brand-blue">sync</span>
        <p className="text-sm">Loading categories…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-gray-400">search</span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && filtered.length === 1) onSelect(filtered[0]); }}
            placeholder="Search categories…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : null}
        </div>
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{statsHeading}</p>
              {filtered.length === items.length ? (
                <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                  {items.length}
                  <span className="ml-1.5 text-base font-bold text-gray-700">{items.length === 1 ? entitySingular : entityPlural}</span>
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                    {filtered.length}
                    <span className="mx-1 text-lg font-bold text-gray-400">/</span>
                    <span className="text-xl font-bold text-gray-700">{items.length}</span>
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-gray-600">Showing matches — {items.length} total</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-gray-500">
            <span className="material-symbols-outlined mb-3 text-4xl text-gray-400">{query.trim() ? 'search_off' : 'category'}</span>
            {query.trim() ? (
              <>
                <p className="text-sm font-semibold text-gray-800">No matches</p>
                <p className="mt-1 max-w-sm text-sm text-gray-600">Try different keywords or clear the search.</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-gray-800">Nothing to show</p>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {filtered.map((cat, i) => (
                <tr
                  key={cat.category_id}
                  onClick={() => onSelect(cat)}
                  className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {cat.name}
                    {cat.children?.length > 0 && (
                      <span className="ml-2 text-[11px] font-normal text-gray-400">{cat.children.length} sub-{cat.children.length === 1 ? 'category' : 'categories'}</span>
                    )}
                  </td>
                  <td className="w-10 px-4 py-3 text-right">
                    <span className="material-symbols-outlined align-middle text-[20px] text-gray-400">chevron_right</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Hierarchical category picker shown as a step inside the research form
 * when the item doesn't already have a known category id.
 */
function CategoryPickerStep({ onSelect, onSkip }) {
  const [allCategories, setAllCategories] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState([]); // stack of category nodes
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchProductCategories().then((data) => {
      if (cancelled) return;
      setLoading(false);
      if (Array.isArray(data) && data.length > 0) setAllCategories(data);
      else setLoadError('Could not load categories.');
    }).catch(() => {
      if (!cancelled) { setLoading(false); setLoadError('Could not load categories.'); }
    });
    return () => { cancelled = true; };
  }, []);

  const currentLevelItems = path.length === 0 ? allCategories : (path[path.length - 1].children || []);
  const currentCategory = path.length > 0 ? path[path.length - 1] : null;

  const handleSelectItem = (cat) => {
    if (cat.children?.length > 0) {
      setPath([...path, cat]);
      setQuery('');
    } else {
      const resolvedPath = [...path.map((p) => p.name), cat.name];
      onSelect({ id: cat.category_id, name: cat.name, path: resolvedPath });
    }
  };

  const handleUseCurrentCategory = () => {
    if (!currentCategory) return;
    onSelect({ id: currentCategory.category_id, name: currentCategory.name, path: path.map((p) => p.name) });
  };

  const navigateTo = (index) => {
    setPath(path.slice(0, index + 1));
    setQuery('');
  };

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3 overflow-hidden p-4">
      {/* Breadcrumb navigation */}
      {path.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 text-xs font-medium">
          <button type="button" onClick={() => { setPath([]); setQuery(''); }} className="text-brand-blue hover:underline">All Categories</button>
          {path.map((p, i) => (
            <React.Fragment key={p.category_id}>
              <span className="text-gray-400">›</span>
              {i < path.length - 1 ? (
                <button type="button" onClick={() => navigateTo(i)} className="text-brand-blue hover:underline">{p.name}</button>
              ) : (
                <span className="font-bold text-gray-800">{p.name}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* "Use this category" when drilled into a non-leaf */}
      {currentCategory && (currentCategory.children?.length > 0) && (
        <button
          type="button"
          onClick={handleUseCurrentCategory}
          className="shrink-0 flex items-center gap-2 rounded-lg border border-brand-blue/30 bg-brand-blue/5 px-3 py-2 text-xs font-bold text-brand-blue transition-colors hover:bg-brand-blue/10"
        >
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          Use &ldquo;{currentCategory.name}&rdquo; as category
        </button>
      )}

      {/* Back button + error */}
      {path.length > 0 && (
        <button type="button" onClick={() => { setPath(path.slice(0, -1)); setQuery(''); }} className="shrink-0 inline-flex w-fit items-center gap-1 text-xs font-bold text-brand-blue hover:underline">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
      )}

      {loadError && <p className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200">
        <CategoryPickerList
          items={currentLevelItems}
          isLoading={loading}
          onSelect={handleSelectItem}
          query={query}
          setQuery={setQuery}
          statsHeading={path.length === 0 ? 'Top-level categories' : `Sub-categories of "${currentCategory?.name}"`}
          entitySingular="category"
          entityPlural="categories"
        />
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
      >
        Skip — continue without selecting a category
      </button>
    </div>
  );
}

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
  ephemeralSessionNotice = null,
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
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  /** Called immediately when a category is selected (before search). Use to persist the
   *  category onto the item so other research forms for the same item skip the picker. */
  onCategoryResolved = null,
}) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.eBay;
  const isEbay = source === 'eBay';

  // resolvedCategory: either the category prop (if it has an id), one restored from saved state,
  // or one the user picks during this session
  const [resolvedCategory, setResolvedCategory] = useState(() => {
    if (category?.id != null) return category;
    if (savedState?.resolvedCategory?.id != null) return savedState.resolvedCategory;
    return null;
  });
  // Sync if the category prop changes externally (e.g. cart item updated)
  const prevCategoryIdRef = useRef(category?.id);
  useEffect(() => {
    if (category?.id != null && category.id !== prevCategoryIdRef.current) {
      prevCategoryIdRef.current = category?.id;
      setResolvedCategory(category);
    }
  }, [category]);

  const categoryId = resolvedCategory?.id ?? null;
  const ebayOfferMargins = useEbayOfferMargins(categoryId);
  useEffect(() => {
    if (categoryId) useAppStore.getState().loadEbayOfferMargins(categoryId);
  }, [categoryId]);
  useEffect(() => {
    if (!resolvedCategory) return;
    if (typeof console === 'undefined') return;
    console.log('[CG Suite][CategoryRule]', {
      context: `${source}-research-category-and-rule`,
      categoryName: resolvedCategory?.name ?? null,
      categoryId: resolvedCategory?.id ?? null,
      categoryPath: resolvedCategory?.path ?? null,
      rule: {
        source: 'ebay-offer-margins',
        margins: Array.isArray(ebayOfferMargins) ? ebayOfferMargins : null,
      },
    });
  }, [resolvedCategory, ebayOfferMargins, source]);

  const savedHasAnyResearch =
    Boolean(savedState?.listings?.length) ||
    Boolean(savedState?.buyOffers?.length) ||
    Boolean(savedState?.stats && typeof savedState.stats === 'object');

  // Show category picker when: not readOnly, no existing category id (from prop or saved state),
  // and no saved research yet
  const categoryKnown = (category?.id != null) || (savedState?.resolvedCategory?.id != null);
  const needsCategoryPick = !readOnly && !categoryKnown && !savedHasAnyResearch;
  const [step, setStep] = useState(() => {
    if (savedHasAnyResearch) return 'cards';
    if (needsCategoryPick) return 'category';
    return 'get-data';
  });

  // ─── Auto-resolve CeX category name to DB category ─────────────────────
  // Runs once when we land on the 'category' step with a named (non-id) category.
  // If we can match "Games / Xbox" → DB "Xbox", we skip the picker entirely.
  const [autoResolvingCategory, setAutoResolvingCategory] = useState(false);
  const autoResolveDoneRef = useRef(false);

  useEffect(() => {
    if (step !== 'category') return;
    if (autoResolveDoneRef.current) return;

    // Only attempt auto-resolution when there's a real CeX-sourced category name to match.
    // eBay items come in with "Other" or no category — skip straight to the manual picker.
    const cexName = category?.name;
    const GENERIC_NAMES = new Set(['cex', 'other', 'n/a', 'unknown', '']);
    const isUsableName = cexName && !GENERIC_NAMES.has(cexName.toLowerCase().trim());

    if (!isUsableName || category?.id != null) {
      autoResolveDoneRef.current = true;
      return;
    }

    autoResolveDoneRef.current = true;
    let cancelled = false;
    let slowResolveTimer = null;
    setAutoResolvingCategory(true);
    slowResolveTimer = window.setTimeout(() => {
      if (!cancelled) setAutoResolvingCategory(false);
    }, 2500);
    fetchAllCategoriesFlat().then((flat) => {
      if (cancelled) return;
      const match = matchCexCategoryNameToDb(cexName, flat);
      if (match) {
        setResolvedCategory(match);
        if (typeof console !== 'undefined') {
          console.log('[CG Suite][CategoryRule]', {
            context: `${source}-auto-resolved-from-cex-name`,
            categoryName: match?.name ?? null,
            categoryId: match?.id ?? null,
            categoryPath: match?.path ?? null,
            rawCexCategoryName: cexName,
          });
        }
        onCategoryResolved?.(match);
        setStep('get-data');
      }
    }).catch(() => {
      /* silently fall through to manual picker */
    }).finally(() => {
      if (slowResolveTimer) window.clearTimeout(slowResolveTimer);
      if (!cancelled) setAutoResolvingCategory(false);
    });
    return () => {
      cancelled = true;
      if (slowResolveTimer) window.clearTimeout(slowResolveTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const [listings, setListings] = useState(() =>
    prepareExtensionListingsForShell(source, savedState?.listings ?? [], config.idPrefix)
  );
  const [dataVersion, setDataVersion] = useState(0);
  /** eBay: when false, rows with isRelevant === 'no' are omitted everywhere (list, histogram, stats, offers). Persisted in advancedFilterState. */
  const [includeEbayBroadMatchListings, setIncludeEbayBroadMatchListings] = useState(() =>
    source === 'eBay' && Boolean(savedState?.advancedFilterState?.includeEbayBroadMatchListings)
  );

  const skipBroadMatchResetOnMountRef = useRef(true);
  useEffect(() => {
    if (!isEbay) return;
    if (skipBroadMatchResetOnMountRef.current) {
      skipBroadMatchResetOnMountRef.current = false;
      return;
    }
    setIncludeEbayBroadMatchListings(false);
  }, [dataVersion, isEbay]);
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
    // Only auto-trigger when we're actually on the get-data step (not category step)
    if (mode === 'modal' && step === 'get-data' && !readOnly && savedState == null && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleCancelRefine = useCallback(() => {
    userCancelledRef.current = true;
    setError(null);
    cancelListingTab().catch(() => {});
  }, []);

  // ─── Listings / stats / offers ──────────────────────────────────────────
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;

  const ebayHasBroadMatchListings = useMemo(() => {
    if (!isEbay) return false;
    if ((listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no')) return true;
    // Saved sessions (e.g. request overview) after older saves may lack per-row isRelevant; flag on advancedFilterState.
    return Boolean(savedState?.advancedFilterState?.ebayHadBroadMatchListings);
  }, [isEbay, listings, savedState?.advancedFilterState?.ebayHadBroadMatchListings]);

  const listingsForResearch = useMemo(() => {
    if (!isEbay || includeEbayBroadMatchListings) return listings;
    return (listings || []).filter((l) => String(l?.isRelevant || '').toLowerCase() !== 'no');
  }, [listings, isEbay, includeEbayBroadMatchListings]);

  const handleToggleExclude = useCallback((listingId) => {
    setListings(prev => prev.map(l => l._id === listingId ? { ...l, excluded: !l.excluded } : l));
  }, []);

  const handleClearAllExclusions = useCallback(() => {
    setListings(prev => prev.map(l => (l.excluded ? { ...l, excluded: false } : l)));
  }, []);

  const displayedListings = useMemo(() => {
    if (!listingsForResearch || listingsForResearch.length === 0) return null;
    if (!currentPriceRange) return listingsForResearch;
    return listingsForResearch.filter(item => {
      const p = typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) : item.price;
      return !isNaN(p) && p >= currentPriceRange.min && p <= currentPriceRange.max;
    });
  }, [listingsForResearch, currentPriceRange]);

  // Histogram drill can target a range that only has rows under a wider cohort (e.g. looser matches on).
  // When the cohort shrinks and that range is empty, snap back to root so the grid/histogram aren’t blank.
  useEffect(() => {
    if (drillHistory.length === 0) return;
    if (!listingsForResearch?.length) return;
    if (!displayedListings || displayedListings.length > 0) return;
    setDrillHistory([]);
  }, [drillHistory.length, listingsForResearch, displayedListings]);

  const resetDrillToRoot = useCallback(() => {
    setDrillHistory([]);
  }, []);

  const stats = useMemo(() => calculateStats(listingsForResearch.filter(l => !l.excluded)), [listingsForResearch]);
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
    if (!lineItemContext) return null;
    return buildOtherResearchChannelsSummaries(lineItemContext, source, { ebayOfferMargins, useVoucherOffers });
  }, [lineItemContext, source, ebayOfferMargins, useVoucherOffers]);

  // eBay-only: debounced onOffersChange when exclusions or offers change
  const onOffersChangeRef = useRef(onOffersChange);
  useEffect(() => { onOffersChangeRef.current = onOffersChange; });
  const offersChangeInitializedRef = useRef(false);
  // ─── Advanced filter state tracking (for persistence) ────────────────────
  const advancedFilterStateRef = useRef(savedState?.advancedFilterState ?? null);
  const handleAdvancedFilterChange = useCallback((filterState) => {
    const base = filterState && typeof filterState === 'object' ? filterState : {};
    advancedFilterStateRef.current = {
      ...base,
      ...(isEbay ? { includeEbayBroadMatchListings } : {}),
    };
  }, [isEbay, includeEbayBroadMatchListings]);

  useEffect(() => {
    if (!isEbay) return;
    const cur = advancedFilterStateRef.current;
    const base = cur && typeof cur === 'object' ? cur : {};
    const hasBroad = (listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no');
    advancedFilterStateRef.current = {
      ...base,
      includeEbayBroadMatchListings,
      ...(hasBroad ? { ebayHadBroadMatchListings: true } : {}),
    };
  }, [isEbay, includeEbayBroadMatchListings, listings]);

  const savedAdvInclude = savedState?.advancedFilterState?.includeEbayBroadMatchListings;
  useEffect(() => {
    if (source !== 'eBay') return;
    setIncludeEbayBroadMatchListings(Boolean(savedAdvInclude));
  }, [source, savedAdvInclude]);

  useEffect(() => {
    if (!isEbay) return;
    if (!offersChangeInitializedRef.current) {
      offersChangeInitializedRef.current = true;
      return;
    }
    const advSnapshot = {
      ...(advancedFilterStateRef.current && typeof advancedFilterStateRef.current === 'object'
        ? advancedFilterStateRef.current
        : {}),
      includeEbayBroadMatchListings,
    };
    const t = window.setTimeout(() => {
      onOffersChangeRef.current?.({
        buyOffers,
        listings: listingsForResearch,
        stats: displayedStats,
        advancedFilterState: advSnapshot,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [
    isEbay,
    listings,
    buyOffers,
    listingsForResearch,
    displayedStats,
    includeEbayBroadMatchListings,
  ]);

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
  const buildPayload = useCallback((extras = {}) => {
    const prevAdv = advancedFilterStateRef.current;
    const advBase = prevAdv && typeof prevAdv === 'object' ? prevAdv : {};
    const hasBroadRows =
      isEbay &&
      (listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no');
    const advancedFilterState = isEbay
      ? {
          ...advBase,
          includeEbayBroadMatchListings,
          ...(hasBroadRows || advBase.ebayHadBroadMatchListings
            ? { ebayHadBroadMatchListings: true }
            : {}),
        }
      : prevAdv;
    return {
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
      advancedFilterState,
      // Pass along any category that was resolved during this research session
      resolvedCategory: resolvedCategory || null,
      ...extras,
    };
  }, [listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer, isEbay, includeEbayBroadMatchListings, resolvedCategory]);

  const handleComplete = useCallback(() => {
    onComplete?.(buildPayload());
  }, [onComplete, buildPayload]);

  /** Shell footer OK: view-only overlays close with cancel (no save). */
  const handleShellOnComplete = useCallback(() => {
    if (readOnly) onComplete?.({ cancel: true });
    else handleComplete();
  }, [readOnly, onComplete, handleComplete]);

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
    } else if (offerArg == null) {
      selectedOfferIndex = null;
      nextManualOffer = '';
    } else {
      selectedOfferIndex = offerArg;
      nextManualOffer = '';
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

  // ─── Category-pick step ─────────────────────────────────────────────────
  if (step === 'category') {
    const handleCategorySelected = (cat) => {
      setResolvedCategory(cat);
      if (typeof console !== 'undefined') {
        console.log('[CG Suite][CategoryRule]', {
          context: `${source}-manual-category-selected`,
          categoryName: cat?.name ?? null,
          categoryId: cat?.id ?? null,
          categoryPath: cat?.path ?? null,
        });
      }
      // Immediately notify the parent so sibling research forms for the same item
      // don't re-ask for category (the category is now known for this item).
      onCategoryResolved?.(cat);
      setStep('get-data');
    };
    const handleSkipCategory = () => {
      setStep('get-data');
    };

    const categoryBody = (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-gray-200 bg-brand-blue/5 px-4 py-3">
          <p className="text-xs font-semibold text-brand-blue">
            What category does this item belong to?
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Selecting a category applies the correct offer margins from the pricing rules config.
          </p>
        </div>
        {autoResolvingCategory ? (
          <div className="shrink-0 mx-4 mt-3 rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-xs text-brand-blue">
            Matching category from scraped data...
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CategoryPickerStep onSelect={handleCategorySelected} onSkip={handleSkipCategory} />
        </div>
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
                  <Icon name="category" className="text-brand-orange" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{config.headerTitle}</h2>
                  <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest leading-none mt-0.5">
                    Select item category
                  </p>
                </div>
              </div>
              <WorkspaceCloseButton
                title={`Close ${config.label} research`}
                onClick={() => onComplete?.({ cancel: true })}
              />
            </header>
            {ephemeralSessionNotice && (
              <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-950" role="status">
                {ephemeralSessionNotice}
              </div>
            )}
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">{categoryBody}</main>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-gray-50">
        <header className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <h2 className="text-lg font-bold text-brand-blue">{config.headerTitle}</h2>
          <p className="text-sm text-gray-500">Select the item category before searching</p>
        </header>
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">{categoryBody}</main>
      </div>
    );
  }

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
            {ephemeralSessionNotice && (
              <div
                className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-950"
                role="status"
              >
                {ephemeralSessionNotice}
              </div>
            )}
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
      listings={listingsForResearch}
      displayedListings={displayedListings}
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
      onResetDrillToRoot={resetDrillToRoot}
      onComplete={handleShellOnComplete}
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
      ephemeralSessionNotice={ephemeralSessionNotice}
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
      onManualOfferChange={!readOnly && (showManualOffer || isEbay) ? setManualOffer : null}
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
      isEbayResearchSource={isEbay}
      ebayHasBroadMatchListings={ebayHasBroadMatchListings}
      includeEbayBroadMatchListings={includeEbayBroadMatchListings}
      onIncludeEbayBroadMatchChange={isEbay && !readOnly ? setIncludeEbayBroadMatchListings : undefined}
      blockedOfferSlots={blockedOfferSlots}
      onBlockedOfferClick={onBlockedOfferClick}
      lineItemContext={lineItemContext}
    />
  );
}

export default React.memo(ExtensionResearchForm);
