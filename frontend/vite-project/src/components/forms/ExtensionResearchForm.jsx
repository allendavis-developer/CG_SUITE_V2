import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, cancelListingTab, isExtensionListingFlowAborted } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import {
  drillEnvelope,
  priceMatchesDrillLevel,
  DRILL_MULTI_KIND,
  normalizeHistogramSegments,
} from './researchDrillUtils';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { buildOtherResearchChannelsSummaries } from './researchOtherChannelsSummary';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';
import { fetchAllCategoriesFlat } from '@/services/api';
import { matchCexCategoryNameToDb } from '@/utils/cexCategoryMatch';
import {
  summariseNegotiationItemForAi,
  runAiCategoryCascadeArrayTree,
  runNosposStockCategoryAiMatchBackground,
} from '@/services/aiCategoryPathCascade';
import { lineItemHasCommittedMarketplaceSearchTerm } from '@/pages/buyer/utils/negotiationHelpers';
import {
  markMarketplaceSearchConfirmedForItem,
  getMarketplaceSearchSessionTerm,
  clearMarketplaceSearchSessionTerm,
} from '@/utils/marketplaceSearchConfirmSession';

import HierarchicalCategoryPickerPanel from '@/components/pickers/HierarchicalCategoryPickerPanel';
import {
  flatCategoriesToNestedRoots,
  ebayPickerFilterChildren,
  resolveSkipCategoryFromFlat,
} from '@/utils/categoryPickerTree';


/**
 * Hierarchical category picker shown as a step inside the research form
 * when the item doesn't already have a known category id.
 */
function CategoryPickerStep({
  onSelect,
  onAiNosposStockCategoryReady,
  onClearAiNosposStockCategory,
  registerNosposBackgroundMatch,
  lineItemForAi = null,
  initialSearchQuery = null,
  categoryHint = null,
  onClose = null,
}) {
  const [allCategories, setAllCategories] = useState([]);
  const [skipCategoryPayload, setSkipCategoryPayload] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerDepth, setPickerDepth] = useState(0);
  const [aiSlotPhase, setAiSlotPhase] = useState('waiting');
  const [aiBreadcrumb, setAiBreadcrumb] = useState('');
  const [aiAutoError, setAiAutoError] = useState(null);
  const aiPendingSelectRef = useRef(null);
  const allCategoriesFlatRef = useRef([]);

  const itemSummaryForAi = useMemo(() => {
    if (lineItemForAi) return summariseNegotiationItemForAi(lineItemForAi);
    const q = initialSearchQuery != null && String(initialSearchQuery).trim();
    const name =
      (q && String(q).trim()) || categoryHint?.name || 'Unknown item';
    const dbCategory = Array.isArray(categoryHint?.path)
      ? categoryHint.path.join(' > ')
      : categoryHint?.name || null;
    const summary = {
      name: String(name).trim(),
      dbCategory: dbCategory != null && String(dbCategory).trim() !== '' ? String(dbCategory).trim() : null,
      attributes: {},
    };
    console.log('[CG Suite][CategoryPicker] fallback summary', { summary, initialSearchQuery, categoryHint });
    return summary;
  }, [lineItemForAi, initialSearchQuery, categoryHint]);

  useEffect(() => {
    let cancelled = false;
    fetchAllCategoriesFlat()
      .then((flat) => {
        if (cancelled) return;
        setLoading(false);
        if (!Array.isArray(flat) || flat.length === 0) {
          setLoadError('Could not load categories.');
          return;
        }
        allCategoriesFlatRef.current = flat;
        setSkipCategoryPayload(resolveSkipCategoryFromFlat(flat));
        setAllCategories(flatCategoriesToNestedRoots(flat));
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError('Could not load categories.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || loadError || !allCategories.length) return;

    let cancelled = false;
    aiPendingSelectRef.current = null;
    setAiSlotPhase('running');
    setAiAutoError(null);
    setAiBreadcrumb('');

    console.log('[CG Suite][CategoryPicker] auto-running cascade', {
      itemSummaryForAi,
      rootCount: allCategories.length,
    });

    (async () => {
      try {
        const res = await runAiCategoryCascadeArrayTree({
          rootNodes: allCategories,
          itemSummary: itemSummaryForAi,
          startPath: [],
          logTag: '[CG Suite][CategoryPicker][ExtensionPicker-auto]',
        });
        console.log('[CG Suite][CategoryPicker] auto cascade result', res);
        if (cancelled) return;
        if (!res.success || !res.leaf) {
          setAiSlotPhase('error');
          setAiAutoError(res.error?.message || 'Could not suggest a category. Choose below or use Skip.');
          return;
        }
        const crumb = res.path.join(' › ');
        aiPendingSelectRef.current = {
          id: res.leaf.category_id,
          name: res.leaf.name,
          path: res.path,
        };
        setAiBreadcrumb(crumb);
        setAiSlotPhase('ready');
        console.log('[CG Suite][CategoryPicker] suggestion ready — click blue bar to use', {
          breadcrumb: crumb,
          payload: aiPendingSelectRef.current,
        });
      } catch (e) {
        console.log('[CG Suite][CategoryPicker] auto cascade exception', e);
        if (cancelled) return;
        setAiSlotPhase('error');
        setAiAutoError(e?.message || 'Request failed. Choose below or use Skip.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, loadError, allCategories, itemSummaryForAi]);

  const handlePanelSelect = useCallback(
    ({ node, pathNames }) => {
      onSelect({ id: node.category_id, name: node.name, path: pathNames });
    },
    [onSelect]
  );

  const handleAiSuggestedConfirm = useCallback(() => {
    const payload = aiPendingSelectRef.current;
    if (!payload) {
      console.log('[CG Suite][CategoryPicker] click but no pending payload');
      return;
    }
    console.log('[CG Suite][CategoryPicker] user confirmed suggested category', payload);

    onClearAiNosposStockCategory?.();
    onSelect(payload, { awaitingAiNosposMatch: true });

    const flat = allCategoriesFlatRef.current;
    const run = (async () => {
      const match = await runNosposStockCategoryAiMatchBackground({
        internalCategoryId: payload.id,
        itemSummary: itemSummaryForAi,
        allCategoriesFlat: flat,
        logTag: '[CG Suite][NosposPathMatch]',
      });
      if (match) {
        onAiNosposStockCategoryReady?.({
          nosposId: match.nosposId,
          fullName: match.fullName,
          pathSegments: match.pathSegments,
        });
      }
    })();
    registerNosposBackgroundMatch?.(run);
  }, [
    onSelect,
    onClearAiNosposStockCategory,
    onAiNosposStockCategoryReady,
    registerNosposBackgroundMatch,
    itemSummaryForAi,
  ]);

  const listAiSuggestion =
    !loadError && pickerDepth === 0 && !loading
      ? aiSlotPhase === 'running'
        ? { phase: 'running' }
        : aiSlotPhase === 'ready' && aiBreadcrumb
          ? { phase: 'ready', breadcrumb: aiBreadcrumb, onConfirm: handleAiSuggestedConfirm }
          : aiSlotPhase === 'error' && aiAutoError
            ? { phase: 'error', message: aiAutoError }
            : null
      : null;

  return (
    <HierarchicalCategoryPickerPanel
      roots={allCategories}
      isLoading={loading}
      loadError={loadError}
      filterChildren={ebayPickerFilterChildren}
      onSelect={handlePanelSelect}
      aiSuggestion={listAiSuggestion}
      onSkip={skipCategoryPayload ? () => onSelect(skipCategoryPayload) : null}
      onClose={onClose}
      onPathDepthChange={setPickerDepth}
    />
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
    headerIcon: 'search_insights',
    getDataPrompt: 'Click below to open Cash Converters in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.',
    enableAdvancedSoldDateFilter: false,
    supportsCancelRefine: false,
  },
  CashGenerator: {
    idPrefix: 'cg',
    label: 'Cash Generator',
    headerTitle: 'Cash Generator Market Research',
    headerIcon: 'search_insights',
    getDataPrompt:
      'Click below to open Cash Generator in a new tab. When the search results have loaded, use the extension panel to confirm and send data back (store location is captured per listing, like Cash Converters).',
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
  const isCashGenerator = source === 'CashGenerator';

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
  const researchItemId = lineItemContext?.id ?? lineItemContext?.request_item_id ?? null;
  const marketplaceSessionTermAtMount =
    researchItemId != null ? getMarketplaceSearchSessionTerm(researchItemId) : '';
  const itemHasPriorMarketplaceSearchAgreement =
    lineItemHasCommittedMarketplaceSearchTerm(lineItemContext) ||
    String(marketplaceSessionTermAtMount).trim() !== '';
  /** CeX / custom / jewellery lines: confirm search text before opening the marketplace tab; skip for rows added from eBay research. */
  const useExtensionSearchTermGate =
    !readOnly &&
    lineItemContext != null &&
    lineItemContext.isCustomEbayItem !== true &&
    !itemHasPriorMarketplaceSearchAgreement;
  const [step, setStep] = useState(() => {
    if (savedHasAnyResearch) return 'cards';
    if (needsCategoryPick) return 'category';
    if (useExtensionSearchTermGate) return 'search-confirm';
    return 'get-data';
  });

  const aiNosposInit = savedState?.aiSuggestedNosposStockCategory;
  const aiNosposStockCategoryRef = useRef(
    aiNosposInit && typeof aiNosposInit === 'object' ? { ...aiNosposInit } : null
  );

  /** In-flight {@link runNosposStockCategoryAiMatchBackground} from category step — await before OK/save. */
  const nosposBackgroundMatchRef = useRef(null);
  const registerNosposBackgroundMatch = useCallback((promise) => {
    if (!promise || typeof promise.then !== 'function') return;
    nosposBackgroundMatchRef.current = promise;
    promise.finally(() => {
      if (nosposBackgroundMatchRef.current === promise) {
        nosposBackgroundMatchRef.current = null;
      }
    });
  }, []);
  const awaitPendingNosposBackgroundMatch = useCallback(async () => {
    const p = nosposBackgroundMatchRef.current;
    if (!p) return;
    try {
      await p;
    } catch {
      /* errors logged in cascade */
    }
  }, []);

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
    const GENERIC_NAMES = new Set([
      'cex',
      'ebay',
      'cash converters',
      'cashconverters',
      'cash generator',
      'other',
      'n/a',
      'unknown',
      '',
    ]);
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
        setStep(useExtensionSearchTermGate ? 'search-confirm' : 'get-data');
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
    if (marketplaceSessionTermAtMount != null && String(marketplaceSessionTermAtMount).trim() !== '') {
      return String(marketplaceSessionTermAtMount).trim();
    }
    if (initialSearchQuery != null && String(initialSearchQuery).trim() !== '') {
      return String(initialSearchQuery).trim();
    }
    return '';
  });
  const [pendingExtensionSearchQuery, setPendingExtensionSearchQuery] = useState(() => {
    if (savedState?.searchTerm != null && String(savedState.searchTerm).trim() !== '') {
      return String(savedState.searchTerm).trim();
    }
    if (marketplaceSessionTermAtMount != null && String(marketplaceSessionTermAtMount).trim() !== '') {
      return String(marketplaceSessionTermAtMount).trim();
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
  const handleGetData = useCallback(async (queryOverride) => {
    userCancelledRef.current = false;
    setError(null);
    let effective = '';
    if (queryOverride !== undefined && queryOverride !== null && String(queryOverride).trim() !== '') {
      effective = String(queryOverride).trim();
    } else if (searchTerm != null && String(searchTerm).trim() !== '') {
      effective = String(searchTerm).trim();
    } else if (initialSearchQuery != null && String(initialSearchQuery).trim() !== '') {
      effective = String(initialSearchQuery).trim();
    }
    setLoading(true);
    try {
      const result = await getDataFromListingPage(source, effective || undefined, marketComparisonContext);
      if (isEbay && userCancelledRef.current) return;
      if (result?.success && Array.isArray(result.results)) {
        setListings(prepareExtensionListingsForShell(source, result.results, config.idPrefix));
        setDataVersion(v => v + 1);
        const scrapedTerm = (result.searchTerm != null && String(result.searchTerm).trim())
          ? String(result.searchTerm).trim()
          : '';
        // Prefer the live site search (user may have changed it vs popup); else what we opened with.
        const displayTerm = scrapedTerm || effective;
        setSearchTerm(displayTerm);
        setPendingExtensionSearchQuery(displayTerm);
        if (researchItemId != null && displayTerm) {
          markMarketplaceSearchConfirmedForItem(researchItemId, displayTerm);
        }
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
  }, [source, isEbay, config.idPrefix, searchTerm, initialSearchQuery, marketComparisonContext, mode, onComplete, researchItemId]);

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
        const scrapedTerm = (result.searchTerm != null && String(result.searchTerm).trim())
          ? String(result.searchTerm).trim()
          : '';
        setSearchTerm((prev) => scrapedTerm || prev);
        setPendingExtensionSearchQuery((prev) => scrapedTerm || prev);
        if (researchItemId != null && scrapedTerm) {
          markMarketplaceSearchConfirmedForItem(researchItemId, scrapedTerm);
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
  }, [source, config.idPrefix, listingPageUrl, marketComparisonContext, researchItemId]);

  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    // Only auto-trigger when we're actually on the get-data step (not category step)
    if (
      mode === 'modal' &&
      step === 'get-data' &&
      !readOnly &&
      savedState == null &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const searchConfirmInputRef = useRef(null);
  const [searchConfirmInputFocused, setSearchConfirmInputFocused] = useState(false);
  useLayoutEffect(() => {
    if (step !== 'search-confirm' || readOnly) return undefined;
    const id = window.requestAnimationFrame(() => {
      searchConfirmInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [step, readOnly]);

  /** Filled by `useMarketplaceSearchPrefetch` on the negotiation items array (async, before this dialog opens). */
  const marketplaceSearchPrefetchUi = useMemo(() => {
    if (lineItemContext == null || lineItemContext.isCustomEbayItem === true) {
      return {
        suggestedSearchLoading: false,
        suggestedSearchError: null,
        suggestedSearchTerm: null,
      };
    }
    const prefetch = lineItemContext.marketplaceSuggestedSearchPrefetch;
    if (prefetch?.state === 'ready') {
      const term = prefetch.term != null ? String(prefetch.term).trim() : '';
      return {
        suggestedSearchLoading: false,
        suggestedSearchError: null,
        suggestedSearchTerm: term || null,
      };
    }
    if (prefetch?.state === 'error') {
      return {
        suggestedSearchLoading: false,
        suggestedSearchError: prefetch.error || 'Could not load suggested search.',
        suggestedSearchTerm: null,
      };
    }
    // pending / missing: do not block the dialog — user can continue with the pre-filled query while AI runs.
    return {
      suggestedSearchLoading: false,
      suggestedSearchError: null,
      suggestedSearchTerm: null,
    };
  }, [lineItemContext]);

  /** Wider of search field vs suggested term, for sizing the dialog (same font metrics as the input). */
  const searchConfirmProbeString = useMemo(() => {
    if (step !== 'search-confirm') return '\u00a0';
    const q = pendingExtensionSearchQuery || '';
    const t = marketplaceSearchPrefetchUi.suggestedSearchTerm || '';
    return q.length >= t.length ? q || '\u00a0' : t;
  }, [step, pendingExtensionSearchQuery, marketplaceSearchPrefetchUi.suggestedSearchTerm]);

  const searchConfirmWidthProbeRef = useRef(null);
  const [searchConfirmPanelMinPx, setSearchConfirmPanelMinPx] = useState(undefined);

  useLayoutEffect(() => {
    if (step !== 'search-confirm') {
      setSearchConfirmPanelMinPx(undefined);
      return undefined;
    }
    const el = searchConfirmWidthProbeRef.current;
    if (!el) return undefined;
    const cap =
      typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 48 * 16) : 768;
    const horizontalChrome = 88;
    const w = Math.min(Math.max(el.scrollWidth + horizontalChrome, 288), cap);
    setSearchConfirmPanelMinPx(w);
    return undefined;
  }, [
    step,
    searchConfirmProbeString,
    marketplaceSearchPrefetchUi.suggestedSearchLoading,
    marketplaceSearchPrefetchUi.suggestedSearchError,
  ]);

  const runExtensionSearchWithTerm = useCallback(
    (rawTerm) => {
      const q = String(rawTerm ?? '').trim();
      if (!q) return;
      if (researchItemId != null) markMarketplaceSearchConfirmedForItem(researchItemId, q);
      setPendingExtensionSearchQuery(q);
      setSearchTerm(q);
      autoTriggeredRef.current = true;
      setStep('get-data');
      void handleGetData(q);
    },
    [handleGetData, researchItemId]
  );

  const handleConfirmExtensionSearch = useCallback(() => {
    runExtensionSearchWithTerm(pendingExtensionSearchQuery);
  }, [pendingExtensionSearchQuery, runExtensionSearchWithTerm]);

  const handleCancelRefine = useCallback(() => {
    userCancelledRef.current = true;
    setError(null);
    cancelListingTab().catch(() => {});
  }, []);

  // ─── Listings / stats / offers ──────────────────────────────────────────
  const activeDrillLevel = useMemo(
    () => (drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null),
    [drillHistory]
  );
  const currentPriceRange = useMemo(
    () => (activeDrillLevel ? drillEnvelope(activeDrillLevel) : null),
    [activeDrillLevel]
  );

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
    if (!activeDrillLevel) return listingsForResearch;
    return listingsForResearch.filter((item) => {
      const p = typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) : item.price;
      return !Number.isNaN(p) && priceMatchesDrillLevel(p, activeDrillLevel);
    });
  }, [listingsForResearch, activeDrillLevel]);

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

  // eBay / Cash Converters: debounced onOffersChange when exclusions or offers change
  const onOffersChangeRef = useRef(onOffersChange);
  useEffect(() => { onOffersChangeRef.current = onOffersChange; });
  const ebayOffersChangeInitRef = useRef(false);
  const ccOffersChangeInitRef = useRef(false);
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
    if (!onOffersChange) return;
    const initRef = isEbay ? ebayOffersChangeInitRef : ccOffersChangeInitRef;
    if (!initRef.current) {
      initRef.current = true;
      return;
    }
    const advSnapshot = isEbay
      ? {
          ...(advancedFilterStateRef.current && typeof advancedFilterStateRef.current === 'object'
            ? advancedFilterStateRef.current
            : {}),
          includeEbayBroadMatchListings,
        }
      : advancedFilterStateRef.current && typeof advancedFilterStateRef.current === 'object'
        ? advancedFilterStateRef.current
        : {};
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
    onOffersChange,
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

  const handleHistogramMultiZoom = useCallback((segments) => {
    const norm = normalizeHistogramSegments(segments);
    if (norm.length === 0) return;
    if (norm.length === 1) {
      setDrillHistory((prev) => [...prev, { min: norm[0].min, max: norm[0].max }]);
      return;
    }
    const envMin = Math.min(...norm.map((s) => s.min));
    const envMax = Math.max(...norm.map((s) => s.max));
    setDrillHistory((prev) => [
      ...prev,
      { kind: DRILL_MULTI_KIND, segments: norm, min: envMin, max: envMax },
    ]);
  }, []);

  const handleZoomOut = useCallback(() => {
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  const handleAiNosposStockCategoryReady = useCallback((payload) => {
    if (payload && typeof payload === 'object') {
      aiNosposStockCategoryRef.current = payload;
    }
  }, []);

  const handleClearAiNosposStockCategory = useCallback(() => {
    aiNosposStockCategoryRef.current = null;
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
    const n = aiNosposStockCategoryRef.current;
    let aiSuggestedNosposStockCategory = null;
    if (
      n &&
      typeof n === 'object' &&
      (n.nosposId != null ||
        (n.fullName != null && String(n.fullName).trim()) ||
        (Array.isArray(n.pathSegments) && n.pathSegments.length > 0))
    ) {
      aiSuggestedNosposStockCategory = {
        nosposId: n.nosposId != null ? Number(n.nosposId) : null,
        fullName: n.fullName != null ? String(n.fullName).trim() || null : null,
        pathSegments: Array.isArray(n.pathSegments) ? n.pathSegments : null,
        source: n.source || 'extension_research_ai',
        savedAt: new Date().toISOString(),
      };
    }
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
      ...(aiSuggestedNosposStockCategory ? { aiSuggestedNosposStockCategory } : {}),
      ...extras,
    };
  }, [listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer, isEbay, includeEbayBroadMatchListings, resolvedCategory]);

  const handleComplete = useCallback(async () => {
    await awaitPendingNosposBackgroundMatch();
    onComplete?.(buildPayload());
  }, [onComplete, buildPayload, awaitPendingNosposBackgroundMatch]);

  /** Shell footer OK: view-only overlays close with cancel (no save). */
  const handleShellOnComplete = useCallback(async () => {
    if (readOnly) onComplete?.({ cancel: true });
    else await handleComplete();
  }, [readOnly, onComplete, handleComplete]);

  const handleCompleteWithSelection = useCallback(async (selectedOfferIndex, overrideManualOffer) => {
    await awaitPendingNosposBackgroundMatch();
    const state = buildPayload({ manualOffer: overrideManualOffer ?? manualOffer });
    if (showManualOffer) state.selectedOfferIndex = selectedOfferIndex;
    onComplete?.(state);
  }, [onComplete, buildPayload, manualOffer, showManualOffer, awaitPendingNosposBackgroundMatch]);

  const handleAddToCartWithOffer = useCallback(async (offerArg) => {
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
    await awaitPendingNosposBackgroundMatch();
    onComplete?.(buildPayload({ manualOffer: nextManualOffer, selectedOfferIndex }));
  }, [onComplete, buildPayload, manualOffer, awaitPendingNosposBackgroundMatch]);

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
    const nextPending =
      initialSearchQuery != null && String(initialSearchQuery).trim() !== ''
        ? String(initialSearchQuery).trim()
        : '';
    if (researchItemId != null) clearMarketplaceSearchSessionTerm(researchItemId);
    if (useExtensionSearchTermGate) {
      setSearchTerm(nextPending);
      setPendingExtensionSearchQuery(nextPending);
      setStep('search-confirm');
    } else {
      setSearchTerm('');
      setStep('get-data');
    }
    setListingPageUrl(null);
    setDrillHistory([]);
    setShowHistogram(initialHistogramState !== null ? initialHistogramState : (mode === 'modal'));
    setManualOffer('');
    setError(null);
    setLoading(false);
    aiNosposStockCategoryRef.current = null;
    nosposBackgroundMatchRef.current = null;
  }, [isEbay, loading, initialHistogramState, mode, useExtensionSearchTermGate, initialSearchQuery, researchItemId]);

  // ─── Category-pick step ─────────────────────────────────────────────────
  if (step === 'category') {
    const handleCategorySelected = (cat, opts) => {
      if (!opts?.awaitingAiNosposMatch) {
        aiNosposStockCategoryRef.current = null;
      }
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
      setStep(useExtensionSearchTermGate ? 'search-confirm' : 'get-data');
    };
    const categoryBody = (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {autoResolvingCategory ? (
          <div className="shrink-0 mx-4 mt-3 rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-xs text-brand-blue">
            Matching category from scraped data...
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CategoryPickerStep
            onSelect={handleCategorySelected}
            onAiNosposStockCategoryReady={handleAiNosposStockCategoryReady}
            onClearAiNosposStockCategory={handleClearAiNosposStockCategory}
            registerNosposBackgroundMatch={registerNosposBackgroundMatch}
            lineItemForAi={lineItemContext}
            initialSearchQuery={initialSearchQuery}
            categoryHint={category}
            onClose={mode === 'modal' ? () => onComplete?.({ cancel: true }) : null}
          />
        </div>
      </div>
    );

    if (mode === 'modal') {
      const wrapperClass = containModalInParent
        ? 'flex h-full min-h-0 w-full flex-col'
        : 'fixed inset-0 z-[100] flex items-start justify-center';
      return (
        <div className={wrapperClass}>
          {!containModalInParent && (
            <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/40" aria-hidden />
          )}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${!containModalInParent ? 'relative z-10 cg-animate-modal-panel' : ''}`}>
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
      <div className="flex h-full flex-col bg-gray-50">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{categoryBody}</main>
      </div>
    );
  }

  // ─── Confirm search term (CeX / non–eBay-origin lines) — compact dialog ──
  if (step === 'search-confirm') {
    const { suggestedSearchLoading, suggestedSearchError, suggestedSearchTerm } = marketplaceSearchPrefetchUi;
    const searchConfirmEmpty = !pendingExtensionSearchQuery.trim();
    const showAnimatedCaret = searchConfirmInputFocused && searchConfirmEmpty && !readOnly;
    const showSuggestionBlock =
      suggestedSearchLoading || suggestedSearchError || suggestedSearchTerm;

    const searchConfirmDialog = (
      <div
        className={
          containModalInParent
            ? 'absolute inset-0 z-20 flex items-center justify-center p-4'
            : 'fixed inset-0 z-[100] flex items-center justify-center p-4'
        }
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] transition-opacity"
          aria-label="Dismiss"
          disabled={loading}
          onClick={() => {
            if (!loading) onComplete?.({ cancel: true });
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cg-search-confirm-title"
          className="cg-animate-modal-panel relative w-full max-w-[min(48rem,calc(100vw-2rem))] rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10"
          style={
            searchConfirmPanelMinPx != null ? { minWidth: `${searchConfirmPanelMinPx}px` } : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          <span
            ref={searchConfirmWidthProbeRef}
            className="pointer-events-none absolute left-0 top-0 -z-10 whitespace-pre font-sans text-sm leading-[1.25rem] text-slate-900 opacity-0"
            aria-hidden
          >
            {searchConfirmProbeString}
          </span>
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 id="cg-search-confirm-title" className="text-sm font-bold text-slate-900">
              {config.label}
            </h2>
            <button
              type="button"
              onClick={() => onComplete?.({ cancel: true })}
              disabled={loading}
              className="-m-1 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              aria-label={`Close ${config.label} research`}
            >
              <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden>
                close
              </span>
            </button>
          </div>
          <p className="mb-3 text-xs leading-snug text-slate-600">
            What search should we use on {config.label}? Type what a shopper would search for this product, or tap a
            suggested phrase below when it appears.
          </p>
          {ephemeralSessionNotice ? (
            <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50 px-2.5 py-2 text-center text-[11px] font-semibold text-amber-950">
              {ephemeralSessionNotice}
            </p>
          ) : null}

          <label className="block">
            <span className="sr-only">Search</span>
            <div
              className={`flex min-h-[2.75rem] max-w-full items-center gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white px-3 transition-shadow ${
                searchConfirmInputFocused ? 'border-brand-blue ring-2 ring-brand-blue/20' : 'hover:border-slate-300'
              }`}
            >
              {showAnimatedCaret ? (
                <span
                  className="cg-search-confirm-caret h-[1.125rem] w-px shrink-0 rounded-full bg-brand-blue"
                  aria-hidden
                />
              ) : null}
              <input
                ref={searchConfirmInputRef}
                type="text"
                className={`min-w-0 w-full flex-1 border-0 bg-transparent py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 ${
                  showAnimatedCaret ? 'caret-transparent' : 'caret-[#144584]'
                }`}
                placeholder=""
                value={pendingExtensionSearchQuery}
                onChange={(e) => setPendingExtensionSearchQuery(e.target.value)}
                onFocus={() => setSearchConfirmInputFocused(true)}
                onBlur={() => setSearchConfirmInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && !readOnly && pendingExtensionSearchQuery.trim()) {
                    e.preventDefault();
                    handleConfirmExtensionSearch();
                  }
                }}
                disabled={readOnly || loading}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </label>

          {showSuggestionBlock ? (
            <div className="mt-3" aria-live="polite">
              {suggestedSearchLoading ? (
                <div className="flex min-h-[2.75rem] items-center gap-2 rounded-lg bg-brand-blue/[0.07] px-3 text-sm text-brand-blue">
                  <span
                    className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-blue border-t-transparent"
                    aria-hidden
                  />
                  Finding suggested search…
                </div>
              ) : suggestedSearchError ? (
                <p className="min-h-[2.75rem] rounded-lg bg-amber-50/90 px-3 py-2 text-sm leading-snug text-amber-900">
                  {suggestedSearchError}
                </p>
              ) : suggestedSearchTerm ? (
                <button
                  type="button"
                  onClick={() => runExtensionSearchWithTerm(suggestedSearchTerm)}
                  disabled={readOnly || loading}
                  className="flex min-h-[2.75rem] w-full min-w-0 items-center gap-2 rounded-lg bg-brand-blue px-3 py-2 text-left text-sm text-white shadow-sm transition-colors hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Use suggested search: ${suggestedSearchTerm}`}
                >
                  <span className="shrink-0 uppercase tracking-wide text-white/95">Suggested</span>
                  <span className="min-w-0 flex-1 whitespace-normal break-words text-white">
                    {suggestedSearchTerm}
                  </span>
                  <span className="material-symbols-outlined shrink-0 text-[18px] leading-none text-white/90" aria-hidden>
                    chevron_right
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleConfirmExtensionSearch}
            disabled={loading || readOnly || !pendingExtensionSearchQuery.trim()}
            className="mt-4 w-full rounded-lg bg-brand-blue py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                  aria-hidden
                />
                Opening…
              </span>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>
    );

    if (mode === 'modal') {
      if (containModalInParent) {
        return <div className="relative h-full min-h-0 w-full">{searchConfirmDialog}</div>;
      }
      return searchConfirmDialog;
    }

    return (
      <div className="relative flex min-h-[12rem] w-full flex-1 flex-col bg-slate-50/80">
        {searchConfirmDialog}
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
          onClick={() => handleGetData()}
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
        : 'fixed inset-0 z-[100] flex items-start justify-center';
      return (
        <div className={wrapperClass}>
          {!containModalInParent && (
            <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/40" aria-hidden />
          )}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${!containModalInParent ? 'relative z-10 cg-animate-modal-panel' : ''}`}>
            <div className="flex shrink-0 items-center justify-end border-b border-[var(--ui-border)] bg-white px-2 py-1.5">
              <WorkspaceCloseButton
                title={`Close ${config.label} research`}
                onClick={() => onComplete?.({ cancel: true })}
              />
            </div>
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
      <div className="flex h-full flex-col bg-gray-50">
        <main className="flex flex-1 flex-col overflow-auto">{getDataBody}</main>
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
      onHistogramMultiZoom={!readOnly ? handleHistogramMultiZoom : undefined}
      onZoomOut={handleZoomOut}
      onNavigateToDrillLevel={handleNavigateToDrillLevel}
      onResetDrillToRoot={resetDrillToRoot}
      onComplete={handleShellOnComplete}
      onCompleteWithSelection={showManualOffer ? handleCompleteWithSelection : undefined}
      onAddToCartWithOffer={
        readOnly
          ? undefined
          : onOfferSelect
            ? handleOfferSelect
            : onComplete && !showManualOffer
              ? handleAddToCartWithOffer
              : undefined
      }
      showInlineOfferAction={isEbay ? (mode === 'page' ? !onAddNewItem : !onOfferSelect) : undefined}
      enableAdvancedSoldDateFilter={config.enableAdvancedSoldDateFilter}
      mode={mode}
      readOnly={readOnly}
      ephemeralSessionNotice={ephemeralSessionNotice}
      basicFilterOptions={[]}
      searchPlaceholder=""
      headerTitle={searchTerm || config.headerTitle}
      headerSubtitle={
        searchTerm
          ? (isEbay
              ? `eBay: ${searchTerm}`
              : isCashGenerator
                ? `Cash Generator: ${searchTerm}`
                : `Cash Converters: ${searchTerm}`)
          : 'Real-time valuation lookup'
      }
      headerIcon={config.headerIcon}
      buyOffers={buyOffers}
      customControls={null}
      allowHistogramToggle={initialHistogramState !== false}
      manualOffer={manualOffer}
      onManualOfferChange={
        !readOnly && (showManualOffer || (isEbay && !hideOfferCards)) ? setManualOffer : null
      }
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
