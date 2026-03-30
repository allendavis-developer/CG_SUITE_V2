import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button, Icon, CustomDropdown } from '../ui/components';
import ResearchOthersModal from '../modals/ResearchOthersModal';
import { toVoucherOfferPrice } from '@/utils/helpers';
import { calculateResearchStats, parseResearchPrice } from './researchStats';
import { otherResearchSummariesSignature } from './researchOtherChannelsSummary';
import { DualRangeSlider, DualDateRangeSlider, formatSoldDateMs } from './sliders';
import ListingCard from './ListingCard';
import PriceHistogram from './PriceHistogram';

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

/** Parse a sold-date string like: `Sold  23 Feb 2026` into a day bucket with deterministic ms. */
function parseSoldDateDayStart(soldStr) {
  if (!soldStr) return null;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = String(soldStr).match(/Sold\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const monthWord = String(m[2]).slice(0, 3).toLowerCase();
  const year = parseInt(m[3], 10);

  const monthIdx = MONTHS.findIndex(x => x.toLowerCase() === monthWord);
  if (monthIdx < 0 || !Number.isFinite(day) || day <= 0) return null;

  // Use UTC day boundaries so dragging by "1 day" stays consistent even across DST changes.
  const dt = new Date(Date.UTC(year, monthIdx, day));
  return { label: `${day} ${MONTHS[monthIdx]} ${year}`, ms: dt.getTime() };
}

// Global styles — injected once on module load
const globalStyles = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0);    }
  }

  .histogram-scrollbar::-webkit-scrollbar { width: 8px; }
  .histogram-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
  .histogram-scrollbar::-webkit-scrollbar-thumb { background: var(--brand-blue); border-radius: 4px; transition: background 0.2s; }
  .histogram-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--brand-blue-hover); }

  .dual-range-input {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    pointer-events: none;
    height: 6px;
    outline: none;
    position: absolute;
    width: 100%;
  }
  .dual-range-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    pointer-events: auto;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    border: 2.5px solid #1e3a8a;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
    cursor: pointer;
    transition: box-shadow 0.15s;
  }
  .dual-range-input::-webkit-slider-thumb:hover {
    box-shadow: 0 0 0 5px rgba(30,58,138,0.15);
  }
  .dual-range-input::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    border: 2.5px solid #1e3a8a;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
    cursor: pointer;
  }
`;

let stylesInjected = false;
if (typeof document !== 'undefined' && !stylesInjected) {
  const el = document.createElement('style');
  el.textContent = globalStyles;
  document.head.appendChild(el);
  stylesInjected = true;
}

// ListingCard, PriceHistogram, and slider components are imported from their own modules above.
/**
 * Generic Research Form Shell Component
 */
export default function ResearchFormShell({
  searchTerm,
  onSearchTermChange,
  onSearch,
  listings,
  displayedListings,
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
  /** Clear histogram drill when an advanced filter leaves the drilled slice empty (price/sold-date in shell). */
  onResetDrillToRoot = null,
  onComplete,
  onCompleteWithSelection = null,
  mode = "modal",
  readOnly = false,
  /** Optional banner below modal header: preview / non-persisting research session. */
  ephemeralSessionNotice = null,
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
  onAddNewItem = null,
  onAddToCartWithOffer = null,
  showInlineOfferAction = true,
  onResetSearch = null,
  enableRightClickManualOffer = false,
  enableAdvancedSoldDateFilter = false, // only eBay should show the advanced sold-date slider
  addActionLabel = "Add to Cart",
  disableAddAction = false,
  hideOfferCards = false,
  useVoucherOffers = false,
  containModalInParent = false,
  hidePrimaryAddAction = false,
  initialAdvancedFilterState = null,
  onAdvancedFilterChange = null,
  dataVersion = 0,
  otherResearchSummaries = null,
  /** eBay: scraped data includes looser keyword matches (isRelevant === 'no'). */
  ebayHasBroadMatchListings = false,
  /** eBay: when true, those looser matches are included in the research cohort. */
  includeEbayBroadMatchListings = true,
  onIncludeEbayBroadMatchChange = null,
  /** When false, looser-match UI and styling never apply (e.g. Cash Converters). */
  isEbayResearchSource = false,
}) {
  const sanitizeManualOfferInput = useCallback((rawValue) => {
    const value = String(rawValue ?? '');
    // Keep only digits and a single decimal point.
    const cleaned = value.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
  }, []);

  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;
  const prominentAddClass = 'shadow-lg shadow-brand-orange/30';

  // ─── Existing state ───────────────────────────────────────────────────────
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(null);
  const [showOnlyRelevant, setShowOnlyRelevant] = useState(false);
  const [sortOrder, setSortOrder] = useState('low_to_high');
  const manualOfferClearedOnModalOpenRef = useRef(false);

  const sortOptions = useMemo(() => ([
    { value: 'default', label: 'Default order' },
    { value: 'low_to_high', label: 'Low to high' },
    { value: 'high_to_low', label: 'High to low' },
  ]), []);
  const sortOptionLabels = useMemo(() => sortOptions.map(o => o.label), [sortOptions]);
  const currentSortLabel = useMemo(
    () => (sortOptions.find(o => o.value === sortOrder)?.label || 'Default order'),
    [sortOrder, sortOptions]
  );

  const [rightClickPivotIdx, setRightClickPivotIdx] = useState(null);
  const [rightClickPivotAction, setRightClickPivotAction] = useState(null);
  const [excludeContextMenu, setExcludeContextMenu] = useState(null);
  const excludeContextMenuRef = useRef(null);
  const manualInputRef = useRef(null);
  const [manualOfferDialog, setManualOfferDialog] = useState(null);
  const manualOfferDialogRef = useRef(null);
  const othersSummarySig = useMemo(
    () => otherResearchSummariesSignature(otherResearchSummaries),
    [otherResearchSummaries]
  );
  const [othersModalSig, setOthersModalSig] = useState('');
  const manualOfferInputRef = useRef(null);
  const manualOfferDidFocusRef = useRef(false);

  // ─── New state ────────────────────────────────────────────────────────────
  const [twoColumnLayout, setTwoColumnLayout] = useState(true);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedPriceMin, setAdvancedPriceMin] = useState(initialAdvancedFilterState?.priceMin ?? null);
  const [advancedPriceMax, setAdvancedPriceMax] = useState(initialAdvancedFilterState?.priceMax ?? null);
  const [advancedSoldDateFromIdx, setAdvancedSoldDateFromIdx] = useState(initialAdvancedFilterState?.soldDateFromMs ?? null);
  const [advancedSoldDateToIdx, setAdvancedSoldDateToIdx] = useState(initialAdvancedFilterState?.soldDateToMs ?? null);
  // Draft slider state to keep UI smooth; applied filter updates are debounced.
  const [draftPriceMin, setDraftPriceMin] = useState(null);
  const [draftPriceMax, setDraftPriceMax] = useState(null);
  const [draftSoldDateFromIdx, setDraftSoldDateFromIdx] = useState(null);
  const [draftSoldDateToIdx, setDraftSoldDateToIdx] = useState(null);
  const [filterPanelPos, setFilterPanelPos] = useState({ top: 200, left: 100 });
  const advancedFilterRef = useRef(null);
  const advancedFilterBtnRef = useRef(null);

  // ─── Manual offer dialog handlers ────────────────────────────────────────
  const openManualOfferDialog = useCallback((e, idx, initialValue) => {
    e.preventDefault();
    e.stopPropagation();
    const dialogWidth = 288;
    const x = (e.clientX + dialogWidth > window.innerWidth) ? e.clientX - dialogWidth : e.clientX;
    setManualOfferDialog({ x, y: e.clientY, value: initialValue, baseIndex: idx });
    manualOfferDidFocusRef.current = false;
  }, []);

  const closeManualOfferDialog = useCallback(() => setManualOfferDialog(null), []);

  const applyManualOfferDialog = useCallback(() => {
    if (!manualOfferDialog) return;
    const raw = String(manualOfferDialog.value || '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed <= 0) { closeManualOfferDialog(); return; }
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
    const handleEscape = (e) => { if (e.key === 'Escape') closeManualOfferDialog(); };
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

  useEffect(() => {
    if (!excludeContextMenu) return;
    const handleClickOutside = (e) => {
      if (excludeContextMenuRef.current && !excludeContextMenuRef.current.contains(e.target)) setExcludeContextMenu(null);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setExcludeContextMenu(null); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [excludeContextMenu]);

  useEffect(() => {
    if (selectedOfferIndex === 'manual' && manualInputRef.current && document.activeElement !== manualInputRef.current) {
      setTimeout(() => { manualInputRef.current?.focus(); }, 0);
    }
  }, [selectedOfferIndex]);

  // Ensure manual offer input is always empty when the modal is initially opened.
  useEffect(() => {
    if (mode !== 'modal') return;
    if (!showManualOffer) {
      manualOfferClearedOnModalOpenRef.current = false;
      return;
    }
    if (!onManualOfferChange) return;
    if (!manualOfferClearedOnModalOpenRef.current) {
      manualOfferClearedOnModalOpenRef.current = true;
      onManualOfferChange('');
    }
  }, [mode, showManualOffer, onManualOfferChange]);

  // ─── Advanced filter helpers ──────────────────────────────────────────────

  // Reset filters only when genuinely new data arrives (signalled by parent
  // incrementing dataVersion), NOT on every listings reference change.
  const prevDataVersionRef = useRef(dataVersion);
  useEffect(() => {
    if (dataVersion === prevDataVersionRef.current) return;
    prevDataVersionRef.current = dataVersion;
    setAdvancedPriceMin(null);
    setAdvancedPriceMax(null);
    setAdvancedSoldDateFromIdx(null);
    setAdvancedSoldDateToIdx(null);
    setShowAdvancedFilter(false);
  }, [dataVersion]);

  // Close advanced filter panel on outside click / Escape
  useEffect(() => {
    if (!showAdvancedFilter) return;
    const handler = e => {
      if (
        advancedFilterRef.current && !advancedFilterRef.current.contains(e.target) &&
        advancedFilterBtnRef.current && !advancedFilterBtnRef.current.contains(e.target)
      ) setShowAdvancedFilter(false);
    };
    const escape = e => { if (e.key === 'Escape') setShowAdvancedFilter(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escape);
    };
  }, [showAdvancedFilter]);

  const handleAdvancedFilterToggle = useCallback(() => {
    if (!showAdvancedFilter && advancedFilterBtnRef.current) {
      const rect = advancedFilterBtnRef.current.getBoundingClientRect();
      setFilterPanelPos({
        top: rect.bottom + 6,
        left: Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 344),
      });
    }
    setShowAdvancedFilter(prev => !prev);
  }, [showAdvancedFilter]);

  const resetAdvancedFilters = useCallback(() => {
    setAdvancedPriceMin(null);
    setAdvancedPriceMax(null);
    setAdvancedSoldDateFromIdx(null);
    setAdvancedSoldDateToIdx(null);
    // Snap slider back immediately.
    setDraftPriceMin(null);
    setDraftPriceMax(null);
    setDraftSoldDateFromIdx(null);
    setDraftSoldDateToIdx(null);
    if (!readOnly && isEbayResearchSource && ebayHasBroadMatchListings && onIncludeEbayBroadMatchChange) {
      onIncludeEbayBroadMatchChange(false);
    }
  }, [readOnly, isEbayResearchSource, ebayHasBroadMatchListings, onIncludeEbayBroadMatchChange]);

  // ─── Derived price range from all listings ────────────────────────────────
  const allPriceRange = useMemo(() => {
    if (!listings) return { min: 0, max: 100 };
    const prices = listings.map(l => {
      const p = l.price;
      if (typeof p === 'number') return p;
      return parseFloat(String(p ?? '').replace(/[^0-9.]/g, '')) || NaN;
    }).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) return { min: 0, max: 100 };
    return {
      min: Math.floor(Math.min(...prices) * 100) / 100,
      max: Math.ceil(Math.max(...prices) * 100) / 100,
    };
  }, [listings]);

  const hasResearchListings = (listings?.length ?? 0) > 0;
  /** Hide price slider when there are no rows or no usable span (single/no prices). */
  const showAdvancedPriceSlider = hasResearchListings && allPriceRange.max > allPriceRange.min;

  // Effective slider values (null = use min/max from data)
  const effectivePriceMin = advancedPriceMin ?? allPriceRange.min;
  const effectivePriceMax = advancedPriceMax ?? allPriceRange.max;
  const priceFilterActive = effectivePriceMin > allPriceRange.min || effectivePriceMax < allPriceRange.max;
  const soldDateRangeActive = enableAdvancedSoldDateFilter
    && (advancedSoldDateFromIdx != null || advancedSoldDateToIdx != null);
  /** Looser eBay toggle (or saved read-only state) counts as an active advanced filter for orange styling. */
  const ebayLooserMatchesAdvancedOn = Boolean(
    isEbayResearchSource && ebayHasBroadMatchListings && includeEbayBroadMatchListings
  );
  const advancedFilterActive = priceFilterActive || soldDateRangeActive || ebayLooserMatchesAdvancedOn;

  // ─── Sold date range derived from all listings (continuous day range) ───────────────────────────────
  const soldDateRangeMs = useMemo(() => {
    if (!listings) return { minMs: null, maxMs: null };
    const msValues = listings
      .map(l => parseSoldDateDayStart(l.sold))
      .filter(Boolean)
      .map(d => d.ms);
    if (!msValues.length) return { minMs: null, maxMs: null };
    return { minMs: Math.min(...msValues), maxMs: Math.max(...msValues) };
  }, [listings]);

  const showAdvancedSoldDateSlider =
    enableAdvancedSoldDateFilter &&
    soldDateRangeMs.minMs != null &&
    soldDateRangeMs.maxMs != null &&
    soldDateRangeMs.maxMs > soldDateRangeMs.minMs;
  const showSingleSoldDayMessage =
    enableAdvancedSoldDateFilter &&
    hasResearchListings &&
    soldDateRangeMs.minMs != null &&
    soldDateRangeMs.maxMs != null &&
    soldDateRangeMs.minMs === soldDateRangeMs.maxMs;

  const soldDateMinMs = soldDateRangeMs.minMs ?? 0;
  const soldDateMaxMs = soldDateRangeMs.maxMs ?? 0;

  // Effective (applied) slider values
  const effectiveSoldDateFromIdx = advancedSoldDateFromIdx ?? soldDateMinMs;
  const effectiveSoldDateToIdx = advancedSoldDateToIdx ?? soldDateMaxMs;

  // Draft slider values (used by range inputs; applied filter updates are debounced).
  const sliderPriceMin = draftPriceMin ?? effectivePriceMin;
  const sliderPriceMax = draftPriceMax ?? effectivePriceMax;
  const sliderSoldFromIdx = draftSoldDateFromIdx ?? effectiveSoldDateFromIdx;
  const sliderSoldToIdx = draftSoldDateToIdx ?? effectiveSoldDateToIdx;

  // Sync drafts when applied values change (e.g. new results, resets).
  useEffect(() => {
    setDraftPriceMin(advancedPriceMin ?? allPriceRange.min);
    setDraftPriceMax(advancedPriceMax ?? allPriceRange.max);
  }, [advancedPriceMin, advancedPriceMax, allPriceRange.min, allPriceRange.max]);

  useEffect(() => {
    if (!enableAdvancedSoldDateFilter) return;
    setDraftSoldDateFromIdx(advancedSoldDateFromIdx ?? soldDateMinMs);
    setDraftSoldDateToIdx(advancedSoldDateToIdx ?? soldDateMaxMs);
  }, [enableAdvancedSoldDateFilter, advancedSoldDateFromIdx, advancedSoldDateToIdx, soldDateMinMs, soldDateMaxMs]);

  // Debounced apply to expensive filter state while dragging.
  useEffect(() => {
    if (!showAdvancedFilter) return;
    const t = window.setTimeout(() => {
      const nearlyMin = draftPriceMin == null || Math.abs(draftPriceMin - allPriceRange.min) < 1e-6;
      const nearlyMax = draftPriceMax == null || Math.abs(draftPriceMax - allPriceRange.max) < 1e-6;
      setAdvancedPriceMin(nearlyMin ? null : draftPriceMin);
      setAdvancedPriceMax(nearlyMax ? null : draftPriceMax);
    }, 120);
    return () => window.clearTimeout(t);
  }, [showAdvancedFilter, draftPriceMin, draftPriceMax, allPriceRange.min, allPriceRange.max]);

  useEffect(() => {
    if (!showAdvancedFilter || !enableAdvancedSoldDateFilter) return;
    const t = window.setTimeout(() => {
      const nearlyMin = draftSoldDateFromIdx == null || Math.abs(draftSoldDateFromIdx - soldDateMinMs) < 1e-6;
      const nearlyMax = draftSoldDateToIdx == null || Math.abs(draftSoldDateToIdx - soldDateMaxMs) < 1e-6;
      setAdvancedSoldDateFromIdx(nearlyMin ? null : draftSoldDateFromIdx);
      setAdvancedSoldDateToIdx(nearlyMax ? null : draftSoldDateToIdx);
    }, 120);
    return () => window.clearTimeout(t);
  }, [
    showAdvancedFilter,
    enableAdvancedSoldDateFilter,
    draftSoldDateFromIdx,
    draftSoldDateToIdx,
    soldDateMinMs,
    soldDateMaxMs,
  ]);

  // Expose current filter state to parent (for persistence)
  const onAdvancedFilterChangeRef = useRef(onAdvancedFilterChange);
  useEffect(() => { onAdvancedFilterChangeRef.current = onAdvancedFilterChange; });
  useEffect(() => {
    onAdvancedFilterChangeRef.current?.({
      priceMin: advancedPriceMin,
      priceMax: advancedPriceMax,
      soldDateFromMs: advancedSoldDateFromIdx,
      soldDateToMs: advancedSoldDateToIdx,
    });
  }, [advancedPriceMin, advancedPriceMax, advancedSoldDateFromIdx, advancedSoldDateToIdx]);

  // ─── Advanced filtered listings ───────────────────────────────────────────
  const advancedFilteredListings = useMemo(() => {
    if (!displayedListings) return displayedListings;
    if (!advancedFilterActive) return displayedListings;
    return displayedListings.filter(l => {
      if (priceFilterActive) {
        const p = typeof l.price === 'number' ? l.price : parseFloat(String(l.price ?? '').replace(/[^0-9.]/g, ''));
        if (!isNaN(p) && (p < effectivePriceMin || p > effectivePriceMax)) return false;
      }
      if (enableAdvancedSoldDateFilter && soldDateRangeActive) {
        const parsed = parseSoldDateDayStart(l.sold);
        if (!parsed) return false;
        if (parsed.ms < effectiveSoldDateFromIdx || parsed.ms > effectiveSoldDateToIdx) return false;
      }
      return true;
    });
  }, [
    displayedListings,
    advancedFilterActive,
    priceFilterActive,
    effectivePriceMin,
    effectivePriceMax,
    soldDateRangeActive,
    effectiveSoldDateFromIdx,
    effectiveSoldDateToIdx,
  ]);

  useEffect(() => {
    if (typeof onResetDrillToRoot !== 'function') return;
    if (drillHistory.length === 0) return;
    if (!displayedListings?.length) return;
    if (!advancedFilterActive) return;
    if ((advancedFilteredListings ?? []).length > 0) return;
    onResetDrillToRoot();
  }, [
    onResetDrillToRoot,
    drillHistory.length,
    displayedListings,
    advancedFilteredListings,
    advancedFilterActive,
  ]);

  // ─── Sorting (uses advancedFilteredListings) ──────────────────────────────
  const sortedListings = useMemo(() => {
    const list = advancedFilteredListings || [];
    const withIdx = list.map((item, i) => ({ item, origIdx: i }));
    if (sortOrder === 'default') return withIdx;
    return [...withIdx].sort((a, b) => {
      const pa = parseResearchPrice(a.item);
      const pb = parseResearchPrice(b.item);
      if (sortOrder === 'low_to_high') return (pa || 0) - (pb || 0);
      if (sortOrder === 'high_to_low') return (pb || 0) - (pa || 0);
      return a.origIdx - b.origIdx;
    });
  }, [advancedFilteredListings, sortOrder]);

  const displayListings = useMemo(() => {
    if (!sortedListings) return [];
    return sortedListings
      .map((entry, sortedIdx) => ({ ...entry, sortedIdx }))
      .filter(({ item }) => !showOnlyRelevant || !item.excluded);
  }, [sortedListings, showOnlyRelevant]);

  // Histogram uses advancedFilteredListings (excluded items removed)
  const histogramListings = useMemo(
    () => (advancedFilteredListings ? advancedFilteredListings.filter(l => !l.excluded) : advancedFilteredListings),
    [advancedFilteredListings]
  );

  const formatStat = useCallback((val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }, []);

  // ─── Combined stats computation ───────────────────────────────────────────
  // Uses advancedFilteredListings so stats update with active filters (same cohort as list + histogram).
  const { activeStats, statsWorkingOut } = useMemo(() => {
    const included = (advancedFilteredListings ?? []).filter(l => !l.excluded);
    const { stats, workingOut } = calculateResearchStats(included);
    return { activeStats: stats, statsWorkingOut: workingOut };
  }, [advancedFilteredListings]);

  // ─── Stats display (offer-card style boxes with tooltips) ─────────────────
  const StatsDisplay = useMemo(() => {
    const wo = statsWorkingOut;
    // Always show below to avoid being clipped by parent overflow (modal headers, etc).
    const tooltipAbove = false;

    const StatCard = ({ label, value, valueClass, cardClass, tooltipContent }) => (
      <div className={`relative group flex flex-col rounded-lg border px-2.5 py-1.5 shadow-sm cursor-help shrink-0 ${cardClass}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider leading-none text-gray-500">{label}</span>
        <span className={`text-lg font-extrabold leading-tight ${valueClass}`}>£{formatStat(value)}</span>
        {tooltipContent && (
          <div
            className={`absolute left-0 hidden group-hover:block z-50 w-64 pointer-events-none ${tooltipAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
            role="tooltip"
          >
            {tooltipAbove ? (
              <>
                <div className="py-2.5 px-3 rounded-lg bg-gray-800 text-gray-100 text-xs shadow-xl border border-gray-600">{tooltipContent}</div>
                <div className="absolute left-4 -bottom-1.5 w-0 h-0 border-[6px] border-transparent border-t-gray-800" aria-hidden="true" />
              </>
            ) : (
              <>
                <div className="absolute left-4 -top-1.5 w-0 h-0 border-[6px] border-transparent border-b-gray-800" aria-hidden="true" />
                <div className="py-2.5 px-3 rounded-lg bg-gray-800 text-gray-100 text-xs shadow-xl border border-gray-600">{tooltipContent}</div>
              </>
            )}
          </div>
        )}
      </div>
    );

    return () => (
      <div className="flex items-center gap-2 flex-wrap">
        <StatCard
          label="Average"
          value={activeStats?.average}
          valueClass="text-brand-blue"
          cardClass="bg-brand-blue/5 border-brand-blue/20"
          tooltipContent={wo && (
            <><div className="font-semibold text-gray-200 mb-1">Average</div><div>Sum of {wo.count} prices (£{wo.sum.toFixed(2)}) ÷ {wo.count} = £{formatStat(activeStats?.average)}</div></>
          )}
        />
        <StatCard
          label="Median"
          value={activeStats?.median}
          valueClass="text-brand-blue"
          cardClass="bg-brand-blue/5 border-brand-blue/20"
          tooltipContent={wo && (
            <><div className="font-semibold text-gray-200 mb-1">Median</div><div>Middle value of {wo.count} sorted prices = £{formatStat(activeStats?.median)}</div></>
          )}
        />
        <StatCard
          label="Suggested Sale Price"
          value={activeStats?.suggestedPrice}
          valueClass="text-red-600"
          cardClass="bg-red-50 border-red-200"
          tooltipContent={wo && (
            <><div className="font-semibold text-gray-200 mb-1">Suggested Sale Price</div><div>Median £{formatStat(activeStats?.median)} − £1 = £{formatStat(wo.preSuggestedRaw)}; rounded to {wo.suggestedSaleRoundingLabel} → £{formatStat(activeStats?.suggestedPrice)}</div></>
          )}
        />
      </div>
    );
  }, [activeStats, formatStat, statsWorkingOut, mode]);

  // ─── Manual offer handler ─────────────────────────────────────────────────
  const handleManualOfferChange = useCallback((e) => {
    const cleaned = sanitizeManualOfferInput(e.target.value);
    onManualOfferChange?.(cleaned);
  }, [onManualOfferChange, sanitizeManualOfferInput]);

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

  const handleManualOfferCardClick = useCallback(() => {
    const cartManualMode = Boolean(onAddToCartWithOffer && !readOnly && !showManualOffer);

    if (cartManualMode) {
      if (selectedOfferIndex === 'manual') {
        const cleanManual = String(manualOffer ?? '').replace(/[£,]/g, '').trim();
        const parsed = parseFloat(cleanManual);
        if (Number.isFinite(parsed) && parsed > 0) {
          onAddToCartWithOffer({ type: 'manual', amount: parsed });
        }
        return;
      }
      setSelectedOfferIndex('manual');
      return;
    }

    if (!showManualOffer || readOnly) return;

    // Second tap on manual card: same as OK — always finish and close (no amount gate).
    if (selectedOfferIndex === 'manual') {
      const cleanManual = String(manualOffer ?? '').replace(/[£,]/g, '').trim();
      const parsed = parseFloat(cleanManual);
      if (Number.isFinite(parsed) && parsed > 0) {
        onManualOfferChange?.(manualOffer);
      }
      if (onCompleteWithSelection) onCompleteWithSelection('manual');
      else onComplete?.();
      return;
    }

    setSelectedOfferIndex('manual');
  }, [showManualOffer, readOnly, selectedOfferIndex, manualOffer, onManualOfferChange, onCompleteWithSelection, onComplete, onAddToCartWithOffer]);

  const handleComplete = useCallback(() => {
    if (readOnly) {
      onComplete?.();
      return;
    }
    if (showManualOffer && selectedOfferIndex === 'manual') {
      const cleanManual = String(manualOffer ?? '').replace(/[£,]/g, '').trim();
      const parsed = parseFloat(cleanManual);
      if (Number.isFinite(parsed) && parsed > 0) {
        onManualOfferChange?.(manualOffer);
      }
    }
    if (onCompleteWithSelection) {
      onCompleteWithSelection(selectedOfferIndex);
    } else {
      onComplete?.();
    }
  }, [readOnly, showManualOffer, selectedOfferIndex, manualOffer, onManualOfferChange, onComplete, onCompleteWithSelection]);

  const manualOfferPctOfSale = useMemo(() => {
    if (!activeStats?.suggestedPrice || !manualOffer) return null;
    const cleanManual = parseFloat(manualOffer.replace(/[£,]/g, ''));
    if (isNaN(cleanManual) || cleanManual <= 0) return null;
    const salePrice = activeStats.suggestedPrice;
    if (salePrice <= 0) return null;
    return Math.round((cleanManual / salePrice) * 100);
  }, [activeStats, manualOffer]);

  // ─── Exclude handlers ─────────────────────────────────────────────────────
  const handleExcludeClick = useCallback((sortedIdx) => {
    if (!onToggleExclude || !sortedListings || !sortedListings[sortedIdx]) return;
    const { item: clicked, origIdx } = sortedListings[sortedIdx];
    const id = clicked._id ?? clicked.id ?? `${clicked.url ?? clicked.title ?? 'listing'}-${origIdx}`;
    if (clicked.excluded) {
      onToggleExclude(id);
      setRightClickPivotIdx(null);
      setRightClickPivotAction(null);
      return;
    }
    if (rightClickPivotIdx === sortedIdx) {
      onToggleExclude(id);
      setRightClickPivotIdx(null);
      setRightClickPivotAction(null);
      return;
    }
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
    setRightClickPivotIdx(sortedIdx);
    setRightClickPivotAction(true);
  }, [sortedListings, onToggleExclude, rightClickPivotIdx, rightClickPivotAction]);

  const handleExcludeContextMenu = useCallback((e, sortedIdx) => {
    if (!onToggleExclude || !sortedListings || !sortedListings[sortedIdx]) return;
    setExcludeContextMenu({ x: e.clientX, y: e.clientY, sortedIdx });
  }, [sortedListings, onToggleExclude]);

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

  // ─── Buy offers display ───────────────────────────────────────────────────
  const BuyOffersDisplay = useMemo(() => {
    const useAddWithOfferFlow = Boolean(onAddToCartWithOffer && !readOnly);
    const showInlineCartManual =
      Boolean(onManualOfferChange && !showManualOffer && useAddWithOfferFlow && showInlineOfferAction && !hidePrimaryAddAction);
    const showManualOfferCard =
      Boolean(onManualOfferChange) &&
      (Boolean(showManualOffer && !hideOfferCards) || showInlineCartManual);
    if (hideOfferCards && !useAddWithOfferFlow) return null;
    if (!hideOfferCards && !buyOffers.length && !showManualOffer && !showInlineCartManual) return null;

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
        <div className="w-px h-8 bg-gray-200 shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          {!hideOfferCards && buyOffers.map((offer, idx) => {
            const { price: rawPrice } = offer;
            const price = useVoucherOffers ? toVoucherOfferPrice(rawPrice) : rawPrice;
            const pctOfSale = displayPctOfSaleForOffer(offer, activeStats?.suggestedPrice);
            const isSelected = showManualOffer && selectedOfferIndex === idx;

            const inner = (
              <>
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">{offerLabels[idx]}</span>
                <span className={`text-lg font-extrabold leading-tight ${isSelected ? 'text-brand-blue' : 'text-brand-blue group-hover:text-green-600'}`}>
                  £{formatStat(price)}
                </span>
                {pctOfSale != null && (
                  <span className="text-[10px] font-bold text-brand-orange-hover">{pctOfSale}% sale</span>
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
                      className={`flex flex-col text-left cursor-pointer transition-all focus:outline-none rounded-lg border px-2.5 py-1.5 shadow-sm ${
                        isSelected
                          ? 'ring-2 ring-brand-blue bg-brand-blue/10 border-brand-blue/30'
                          : 'group bg-brand-blue/5 border-brand-blue/20 hover:bg-green-50 hover:border-green-200 active:scale-[0.99]'
                      }`}
                      onClick={
                        useAddWithOfferFlow
                          ? () => onAddToCartWithOffer(idx)
                          : (showManualOffer && !readOnly ? () => handleOfferClick(price, idx) : undefined)
                      }
                      title={useAddWithOfferFlow ? 'Add item with this offer' : 'Select this offer'}
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

          {showManualOfferCard && (
            <>
              {(buyOffers.length > 0 || showInlineCartManual) && <div className="w-px h-8 bg-gray-200" />}
              <div
                className={`flex flex-col cursor-text rounded-lg border px-2.5 py-1.5 shadow-sm transition-all shrink-0 ${
                  selectedOfferIndex === 'manual'
                    ? 'ring-2 ring-brand-blue bg-brand-blue/10 border-brand-blue/30'
                    : 'bg-brand-blue/5 border-brand-blue/20 hover:bg-brand-blue/10 hover:border-brand-blue/30 active:scale-[0.99]'
                } min-h-[56px]`}
                onClick={handleManualOfferCardClick}
              >
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">Manual Offer</span>
                <div className="flex items-center">
                  <span className="text-lg font-extrabold text-brand-blue leading-tight">£</span>
                  <input
                    ref={manualInputRef}
                    type="text"
                    key="manual-offer-input"
                    className={`text-lg font-extrabold text-brand-blue bg-transparent outline-none w-20 border-b-2 ml-0.5 transition-colors leading-tight ${
                      selectedOfferIndex === 'manual'
                        ? 'border-brand-blue'
                        : 'border-brand-blue/20 focus:border-brand-blue/40'
                    }`}
                    placeholder="0.00"
                    value={manualOffer}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleManualOfferChange(e);
                      if (!readOnly && showManualOfferCard && selectedOfferIndex !== 'manual') setSelectedOfferIndex('manual');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (showInlineCartManual) {
                        const parsed = parseFloat(String(manualOffer ?? '').replace(/[£,]/g, ''));
                        if (Number.isFinite(parsed) && parsed > 0) {
                          onAddToCartWithOffer({ type: 'manual', amount: parsed });
                        }
                      } else {
                        handleComplete();
                      }
                    }}
                    onFocus={() => {
                      if (!readOnly && showManualOfferCard) setSelectedOfferIndex('manual');
                    }}
                    disabled={readOnly}
                    readOnly={readOnly}
                  />
                </div>
                {manualOfferPctOfSale !== null && (
                  <span className="text-[10px] font-bold text-brand-orange-hover">{manualOfferPctOfSale}% sale</span>
                )}
              </div>
            </>
          )}

          {useAddWithOfferFlow && showInlineOfferAction && !hidePrimaryAddAction && (
            <>
              {buyOffers.length > 0 && !showManualOfferCard && <div className="w-px h-8 bg-gray-200" />}
              {showManualOfferCard && showInlineCartManual && <div className="w-px h-8 bg-gray-200 shrink-0" />}
              <button
                type="button"
                onClick={() => onAddToCartWithOffer(null)}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold uppercase tracking-wide text-brand-blue transition-all shrink-0 ${
                  disableAddAction
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed shadow-none ring-0'
                    : `bg-brand-orange hover:bg-brand-orange-hover cursor-pointer ${prominentAddClass}`
                }`}
                disabled={disableAddAction}
              >
                <Icon name={addActionLabel === 'Add to Reprice List' ? 'sell' : 'add_shopping_cart'} className="text-[22px]" />
                {addActionLabel}
              </button>
            </>
          )}
        </div>
      </React.Fragment>
    );
  }, [buyOffers, showManualOffer, selectedOfferIndex, manualOffer, manualOfferPctOfSale, onManualOfferChange, readOnly, handleOfferClick, handleManualOfferCardClick, handleManualOfferChange, onAddToCartWithOffer, formatStat, enableRightClickManualOffer, openManualOfferDialog, hideOfferCards, addActionLabel, disableAddAction, useVoucherOffers, activeStats?.suggestedPrice, showInlineOfferAction, prominentAddClass, hidePrimaryAddAction, handleComplete]);

  // ─── Action buttons (shared between banners) ──────────────────────────────
  const othersPanelOpen = Boolean(
    othersModalSig && othersSummarySig && othersModalSig === othersSummarySig && otherResearchSummaries
  );

  // When opening "Others", temporarily force 1-column layout so the grid shares horizontal space cleanly with the side panel.
  // Only restore 2-column layout if we were the reason it changed.
  const othersForcedOneColRef = useRef(false);

  const handleToggleOthersPanel = useCallback(() => {
    if (othersPanelOpen) {
      setOthersModalSig('');
      if (othersForcedOneColRef.current) {
        setTwoColumnLayout(true);
        othersForcedOneColRef.current = false;
      }
      return;
    }

    // Opening
    setOthersModalSig(othersSummarySig);
    if (twoColumnLayout) {
      setTwoColumnLayout(false);
      othersForcedOneColRef.current = true;
    } else {
      // Already in 1-col; do nothing and don't auto-restore later.
      othersForcedOneColRef.current = false;
    }
  }, [othersPanelOpen, othersSummarySig, twoColumnLayout]);

  const canShowOthers = Boolean(othersSummarySig && otherResearchSummaries);

  const othersButtonBlock =
    canShowOthers && (
      <div className="shrink-0">
        <Button
          variant="secondary"
          size="md"
          className="shrink-0 justify-center text-xs font-bold uppercase tracking-wide shadow-md whitespace-nowrap px-4"
          onClick={handleToggleOthersPanel}
        >
          Others
        </Button>
      </div>
    );

  const actionButtonsEl = (
    <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
      {!readOnly && (
        <>
          {onAddNewItem && (
            <Button variant="primary" size="sm" onClick={onAddNewItem}>
              <Icon name="add_circle" className="text-sm" />
              Add new item
            </Button>
          )}
          {!onAddNewItem && !onAddToCartWithOffer && !hidePrimaryAddAction && (
            <Button
              variant="primary" size="lg"
              className={prominentAddClass}
              onClick={handleComplete}
              disabled={disableAddAction}
            >
              <Icon name="add_shopping_cart" className="text-[22px]" />
              {addActionLabel}
            </Button>
          )}
          {!onAddNewItem && onAddToCartWithOffer && !showInlineOfferAction && !hidePrimaryAddAction && (
            <Button
              variant="primary" size="lg"
              className={prominentAddClass}
              onClick={() => onAddToCartWithOffer(null)}
              disabled={disableAddAction}
            >
              <Icon name={addActionLabel === 'Add to Reprice List' ? 'sell' : 'add_shopping_cart'} className="text-[22px]" />
              {addActionLabel}
            </Button>
          )}
          {(showManualOffer || hidePrimaryAddAction) && (
            <>
              {othersButtonBlock}
              <Button
                variant="primary"
                size="md"
                className="flex-1 justify-center"
                onClick={handleComplete}
                disabled={loading}
              >
                OK
              </Button>
            </>
          )}
        </>
      )}
      {readOnly && (
        <>
          {othersButtonBlock}
          <Button
            variant="primary"
            size="md"
            className="flex-1 justify-center min-w-[4.5rem]"
            onClick={handleComplete}
          >
            OK
          </Button>
        </>
      )}
    </div>
  );

  // ─── Banner 1: search term + stats + offers ──────────────────────────────
  // The header is split into a flex-1 left section (matching listing area width)
  // and a w-80 right section (matching histogram width), so the right edge of
  // offer cards naturally aligns with the listing-card grid edge.

  const banner1MainContent = (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      {/* Search term — big */}
      {searchTerm ? (
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-px h-9 bg-gray-200 shrink-0 self-center" />
          <h2
            className="text-2xl md:text-3xl font-extrabold text-brand-blue tracking-tight shrink-0 max-w-[min(28rem,42vw)] truncate"
            title={searchTerm}
          >
            {searchTerm}
          </h2>
        </div>
      ) : null}

      {/* Stats + offers — right aligned with listing-card edge */}
      <div className="flex-1 min-w-0 flex items-center gap-3 justify-end">
        {activeStats && (
          <>
            <div className="w-px h-8 bg-gray-200 shrink-0" />
            <StatsDisplay />
          </>
        )}

        {/* Offer cards (includes its own leading separator) */}
        {BuyOffersDisplay}
      </div>
    </div>
  );

  // ─── Banner 2: controls + records ─────────────────────────────────────────
  const excludedCount = useMemo(
    () => (advancedFilteredListings ? advancedFilteredListings.filter(l => l.excluded).length : 0),
    [advancedFilteredListings]
  );

  const filteredOutByAdvancedCount = useMemo(() => {
    if (!displayedListings?.length || !advancedFilteredListings) return 0;
    return Math.max(0, displayedListings.length - advancedFilteredListings.length);
  }, [displayedListings, advancedFilteredListings]);

  const excludedOrFilteredCount = useMemo(
    () => excludedCount + filteredOutByAdvancedCount,
    [excludedCount, filteredOutByAdvancedCount]
  );

  // "Total" should always represent the full result set size (not the drilled slice).
  const totalRecordsCount = listings?.length ?? displayedListings?.length ?? 0;

  const banner2El = listings && (
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap shrink-0">

      {/* Extension source controls */}
      {hideSearchAndFilters && !readOnly && (onRefineSearch || onResetSearch) && (
        <>
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
              title="Cancel refine"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          )}
          {onResetSearch && (
            <Button variant="outline" size="sm" onClick={onResetSearch}>Reset search</Button>
          )}
          {refineError && <span className="text-xs text-red-600 font-medium shrink-0">{refineError}</span>}
          <div className="w-px h-4 bg-gray-300" />
        </>
      )}

      {/* Custom controls (extension mode) */}
      {customControls && hideSearchAndFilters && (
        <>
          {customControls}
          <div className="w-px h-4 bg-gray-300" />
        </>
      )}

      {/* Sort */}
      {advancedFilteredListings && advancedFilteredListings.length > 0 && (
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

      {/* Relevant only toggle */}
      {displayedListings && (onToggleExclude || displayedListings.some(l => l.excluded)) && (
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm text-gray-500">filter_list</span>
          <span className="text-[11px] font-medium text-gray-600">Relevant only</span>
          <button
            type="button"
            className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand-orange/60 focus:ring-offset-1"
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
          {excludedCount > 0 && !readOnly && (onToggleExclude || onClearAllExclusions) && (
            <button
              type="button"
              className="px-2 py-0.5 text-[11px] font-bold rounded border border-brand-orange bg-brand-orange text-brand-blue hover:bg-brand-orange-hover transition-colors"
              onClick={handleClearAllExclusions}
            >
              Clear exclusions
            </button>
          )}
        </div>
      )}

      <div className="w-px h-4 bg-gray-300 mx-0.5" />

      {/* Two-column layout toggle */}
      <button
        type="button"
        onClick={() => setTwoColumnLayout(prev => !prev)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
        title={twoColumnLayout ? 'Switch to single column' : 'Switch to two columns'}
      >
        <span className="material-symbols-outlined text-[14px]">{twoColumnLayout ? 'view_agenda' : 'grid_view'}</span>
        {twoColumnLayout ? '1 Col' : '2 Col'}
      </button>

      {/* Advanced filter button */}
      <button
        ref={advancedFilterBtnRef}
        type="button"
        onClick={handleAdvancedFilterToggle}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
          (advancedFilterActive || showAdvancedFilter)
            ? 'bg-brand-orange text-brand-blue border-brand-orange hover:bg-brand-orange-hover'
            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">tune</span>
        Advanced Filters
      </button>

      {/* Reset filters */}
      {advancedFilterActive && !readOnly && (
        <button
          type="button"
          onClick={resetAdvancedFilters}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border bg-white text-red-600 border-red-200 hover:bg-red-50 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
          Reset Filters
        </button>
      )}

      {/* Displayed / Excluded+filtered / Total — order matches: on-screen, hidden from view, cohort size */}
      <div className="flex items-center gap-3 text-base font-medium text-gray-600 shrink-0 ml-1">
        <span>
          <span className="font-extrabold text-brand-blue tabular-nums">{displayListings.length}</span>
          {' '}Displayed
        </span>
        <div className="w-px h-4 bg-gray-300" />
        <div className="relative group cursor-help">
          <span>
            <span className="font-extrabold text-gray-800 tabular-nums underline decoration-dotted decoration-gray-400">
              {excludedOrFilteredCount}
            </span>
            {' '}Excluded / filtered
          </span>
          <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:block z-50 w-80">
            <div className="bg-gray-800 text-gray-100 text-xs leading-relaxed rounded-lg px-3 py-2 shadow-xl text-left">
              {(excludedCount > 0 || filteredOutByAdvancedCount > 0) && (
                <p className="tabular-nums mb-1">
                  <span className="font-semibold">{excludedCount}</span> excluded
                  <span className="text-gray-400"> · </span>
                  <span className="font-semibold">{filteredOutByAdvancedCount}</span> filtered out
                </p>
              )}
              <span className="font-semibold">Excluded:</span> listings you removed from stats (pivot / exclude / range / right-click).{' '}
              <span className="font-semibold">Filtered:</span> listings hidden by <strong>Advanced filters</strong> (price, sold date, or looser eBay matches off).{' '}
              <span className="block mt-1.5 pt-1.5 border-t border-gray-600 text-gray-300">
                <strong>Click</strong> unexcluded to set pivot · <strong>Click pivot</strong> to exclude · <strong>Click excluded</strong> to re-include · <strong>Right-click</strong> for before/after.
              </span>
            </div>
            <div className="absolute top-full right-4 border-4 border-transparent border-t-gray-800" />
          </div>
        </div>
        <div className="w-px h-4 bg-gray-300" />
        <span>
          <span className="font-extrabold text-gray-800 tabular-nums">{totalRecordsCount}</span>
          {' '}Total
        </span>
      </div>
    </div>
  );

  // ─── Main content ─────────────────────────────────────────────────────────
  const content = (
    <>
      {/* ── MODAL MODE: top banner (close lives on builder chrome, not here; OK finishes flow) ── */}
      {mode === "modal" && (
        <header className="bg-white border-b border-gray-200 flex items-center shrink-0">
          {/* Left section: branding + stats + offers — pr-6 matches listing area px-6 */}
          <div className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-6 py-2.5 flex-wrap">
            {/* Branding */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="bg-brand-blue p-1.5 rounded">
                <Icon name={headerIcon} className="text-brand-orange text-[15px]" />
              </div>
              <div className="leading-tight">
                <h2 className="text-lg md:text-xl font-extrabold text-brand-blue leading-tight">{headerTitle}</h2>
                {headerSubtitle && (
                  <p className="text-xs md:text-sm text-gray-500 font-semibold uppercase tracking-widest leading-snug mt-1">{headerSubtitle}</p>
                )}
              </div>
            </div>

            {/* Stats + offers (when loaded) */}
            {listings && banner1MainContent}
          </div>

          {/* Right section: actions — w-80 matches histogram width */}
          <div className="w-80 shrink-0 flex items-center gap-2 justify-end px-4 py-2.5">
            {listings && actionButtonsEl}
          </div>
        </header>
      )}

      {mode === "modal" && ephemeralSessionNotice && (
        <div
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-950"
          role="status"
        >
          {ephemeralSessionNotice}
        </div>
      )}

      {/* ── PAGE MODE: banner 1 (search term + stats + offers + add to cart) ── */}
      {mode === "page" && listings && (
        <div className="bg-white border-b border-gray-200 flex items-center shrink-0">
          <div className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-6 py-2.5 flex-wrap">
            {banner1MainContent}
          </div>
          <div className="w-80 shrink-0 flex items-center gap-2 justify-end px-4 py-2.5">
            {actionButtonsEl}
          </div>
        </div>
      )}

      {/* ── Search Input — hidden when hideSearchAndFilters ── */}
      {!hideSearchAndFilters && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-100/50">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">search</span>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-xl pl-12 pr-4 py-3 text-sm font-medium focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue outline-none shadow-sm"
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
          {/* Custom controls for non-extension mode */}
          {customControls && !hideSearchAndFilters && (
            <div className="mt-3">{customControls}</div>
          )}
          {onResetSearch && listings && !readOnly && (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-brand-blue-hover underline"
                onClick={onResetSearch}
              >
                Reset search
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Banner 2: controls + records ── */}
      {banner2El}

      {/* ── Main content ── */}
      <div className={`flex ${mode === "page" ? "flex-1 min-h-0" : "flex-1"} overflow-hidden`}>

        {/* Sidebar filters */}
        {filterOptions.length > 0 && (
          <aside className="w-64 border-r border-gray-200 overflow-y-auto bg-white p-4 space-y-6 histogram-scrollbar">
            <div>
              <h3 className="text-xs font-bold text-brand-blue uppercase tracking-wider mb-2">Basic Filters</h3>
              <div className="space-y-2">
                {basicFilterOptions.map((filter) => (
                  <label key={filter} className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-brand-blue focus:ring-brand-orange"
                      checked={selectedFilters.basic.includes(filter)}
                      onChange={readOnly ? undefined : (e) => onBasicFilterChange(filter, e.target.checked)}
                      disabled={readOnly}
                    />
                    <span>{filter}</span>
                  </label>
                ))}
              </div>
            </div>
            {filterOptions.map((filter) => (
              <div key={filter.name} className="pt-4 border-t border-gray-200">
                <h3 className="text-xs font-bold text-brand-blue uppercase tracking-wider mb-2">{filter.name}</h3>
                <div className="space-y-2">
                  {filter.type === "checkbox" && filter.options.map(option => (
                    <label key={option.label} className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-brand-blue focus:ring-brand-orange"
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
                        type="number" placeholder="Min"
                        className="w-full p-2 border rounded text-xs focus:ring-brand-orange"
                        value={selectedFilters.apiFilters[filter.name]?.min || ""}
                        onChange={readOnly ? undefined : (e) => onApiFilterChange(filter.name, e.target.value, 'range', 'min')}
                        disabled={readOnly}
                      />
                      <input
                        type="number" placeholder="Max"
                        className="w-full p-2 border rounded text-xs focus:ring-brand-orange"
                        value={selectedFilters.apiFilters[filter.name]?.max || ""}
                        onChange={readOnly ? undefined : (e) => onApiFilterChange(filter.name, e.target.value, 'range', 'max')}
                        disabled={readOnly}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="pt-4 border-t border-gray-200">
              <Button variant="primary" size="md" onClick={readOnly ? undefined : onSearch} disabled={readOnly || loading} className="w-full">
                {loading ? "Applying..." : "Apply Filters"}
              </Button>
            </div>
          </aside>
        )}

        {/* Listings area */}
        {listings && (
          <main className="flex-1 min-h-0 overflow-hidden bg-gray-100 flex">
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              <div
                className={`flex-1 min-h-0 overflow-y-auto min-w-0 histogram-scrollbar ${
                  displayedListings && displayedListings.length > 0 ? 'px-6 pb-6 pt-4' : 'p-6'
                } ${othersPanelOpen ? 'flex flex-row gap-4 items-start' : ''}`}
              >
                <div className={othersPanelOpen ? 'flex-1 min-w-0' : ''}>
                  {/* Breadcrumb navigation */}
                  {drillHistory.length > 0 && (
                    <div className="mb-4 flex items-center gap-2 text-xs font-medium">
                      <button
                        onClick={() => onNavigateToDrillLevel && onNavigateToDrillLevel(0)}
                        className="text-brand-blue hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">home</span>
                        All Prices
                      </button>
                      {drillHistory.map((range, idx) => (
                        <React.Fragment key={idx}>
                          <span className="text-gray-400">/</span>
                          <button
                            onClick={() => onNavigateToDrillLevel && onNavigateToDrillLevel(idx + 1)}
                            className={idx === drillHistory.length - 1 ? 'text-gray-900 font-bold' : 'text-brand-blue hover:underline'}
                          >
                            £{range.min.toFixed(2)} - £{range.max.toFixed(2)}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  )}

                  {/* Listings grid */}
                  <div className={`grid ${twoColumnLayout ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
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

                {/* Other channel summaries — horizontal column beside listing cards */}
                {othersPanelOpen && (
                  <div
                    className="w-[min(22rem,calc(100vw-12rem))] shrink-0 sticky top-4 max-h-[min(70vh,calc(100vh-10rem))] overflow-y-auto histogram-scrollbar self-start"
                  >
                    <ResearchOthersModal summaries={otherResearchSummaries} variant="inline" />
                  </div>
                )}
              </div>
            </div>

            {/* Histogram (right side) */}
            <aside className="w-80 border-l border-gray-200 overflow-hidden flex flex-col shrink-0">
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
          </main>
        )}
      </div>
    </>
  );

  // ─── Advanced filter panel ─────────────────────────────────────────────────
  const advancedFilterPanelEl = showAdvancedFilter && listings && (
    <div
      ref={advancedFilterRef}
      className={`fixed z-[130] bg-white rounded-xl shadow-2xl w-80 overflow-hidden border-2 ${
        advancedFilterActive ? 'border-brand-orange' : 'border-gray-200'
      }`}
      style={{ top: filterPanelPos.top, left: filterPanelPos.left }}
      role="dialog"
      aria-label="Advanced Filters"
    >
      {/* Header — same orange accent as the toolbar Advanced Filters button when any filter is active. */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${
          advancedFilterActive
            ? 'bg-brand-orange border-brand-orange'
            : 'border-gray-100 bg-gray-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-brand-blue">tune</span>
          <h3 className="text-sm font-bold text-brand-blue uppercase tracking-wider">Advanced Filters</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvancedFilter(false)}
          className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Price range — only when the dataset has a usable price span */}
        {showAdvancedPriceSlider && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Price Range</h4>
            {priceFilterActive && (
              <button
                type="button"
                onClick={() => { setAdvancedPriceMin(null); setAdvancedPriceMax(null); setDraftPriceMin(null); setDraftPriceMax(null); }}
                className="text-[10px] text-brand-blue hover:underline font-medium"
              >
                Reset
              </button>
            )}
          </div>
          <DualRangeSlider
            min={allPriceRange.min}
            max={allPriceRange.max}
            valueMin={sliderPriceMin}
            valueMax={sliderPriceMax}
            onMinChange={setDraftPriceMin}
            onMaxChange={setDraftPriceMax}
          />
          <div className="mt-2 text-[10px] text-gray-400 text-center">
            Full range: £{allPriceRange.min.toFixed(2)} – £{allPriceRange.max.toFixed(2)}
          </div>
        </div>
        )}

        {/* Sold date */}
        {showAdvancedSoldDateSlider && (
          <div className={`border-gray-100 pt-4 ${showAdvancedPriceSlider ? 'border-t' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Sold Date</h4>
              {soldDateRangeActive && (
                <button
                  type="button"
                  onClick={() => {
                    setAdvancedSoldDateFromIdx(null);
                    setAdvancedSoldDateToIdx(null);
                    setDraftSoldDateFromIdx(soldDateMinMs);
                    setDraftSoldDateToIdx(soldDateMaxMs);
                  }}
                  className="text-[10px] text-brand-blue hover:underline font-medium"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mb-2">
              {soldDateRangeActive
                ? `${Math.round((effectiveSoldDateToIdx - effectiveSoldDateFromIdx) / (24 * 60 * 60 * 1000)) + 1} day(s) selected.`
                : 'All days shown.'}
            </p>
            <div className="mt-1">
              <DualDateRangeSlider
                minMs={soldDateMinMs}
                maxMs={soldDateMaxMs}
                valueMinMs={sliderSoldFromIdx}
                valueMaxMs={sliderSoldToIdx}
                onMinChange={setDraftSoldDateFromIdx}
                onMaxChange={setDraftSoldDateToIdx}
              />
              <div className="mt-2 text-[10px] text-gray-400 text-center">
                Full range: {formatSoldDateMs(soldDateMinMs)} – {formatSoldDateMs(soldDateMaxMs)}
              </div>
            </div>
          </div>
        )}
        {showSingleSoldDayMessage && (
          <p className="text-xs text-gray-400 italic">Only one sold day found in data.</p>
        )}

        {isEbayResearchSource && ebayHasBroadMatchListings && (onIncludeEbayBroadMatchChange || readOnly) && (
          <div
            className={`pt-4 ${
              showAdvancedPriceSlider || showAdvancedSoldDateSlider || showSingleSoldDayMessage
                ? `border-t ${
                    includeEbayBroadMatchListings
                      ? 'border-brand-orange/60 bg-brand-orange/10 -mx-4 px-4 pb-3 rounded-b-lg'
                      : 'border-gray-100'
                  }`
                : includeEbayBroadMatchListings
                  ? 'border border-brand-orange/60 bg-brand-orange/10 -mx-4 px-4 py-3 rounded-lg'
                  : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Looser eBay matches</h4>
                <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                  {readOnly
                    ? 'View only: this shows whether looser eBay matches were included in research.'
                    : 'By default those listings are hidden and ignored (not in the grid, histogram, or stats). Turn on to include them.'}
                </p>
              </div>
              <button
                type="button"
                disabled={readOnly || !onIncludeEbayBroadMatchChange}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand-orange/60 focus:ring-offset-1 disabled:opacity-90 disabled:cursor-default ${
                  includeEbayBroadMatchListings ? 'bg-brand-orange' : 'bg-gray-300'
                }`}
                onClick={
                  readOnly || !onIncludeEbayBroadMatchChange
                    ? undefined
                    : () => onIncludeEbayBroadMatchChange(!includeEbayBroadMatchListings)
                }
                aria-pressed={includeEbayBroadMatchListings}
                aria-disabled={readOnly || !onIncludeEbayBroadMatchChange}
                title={
                  readOnly
                    ? (includeEbayBroadMatchListings ? 'Looser matches were included' : 'Looser matches were excluded')
                    : includeEbayBroadMatchListings
                      ? 'Including looser matches'
                      : 'Looser matches excluded'
                }
              >
                <span
                  className={`absolute top-1/2 left-0.5 h-4 w-4 -translate-y-1/2 bg-white rounded-full shadow-sm transition-transform duration-150 ${
                    includeEbayBroadMatchListings ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div className="border-t border-gray-100 pt-3 flex items-center gap-2">
          {advancedFilterActive && !readOnly && (
            <button
              type="button"
              onClick={resetAdvancedFilters}
              className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
              Reset All Filters
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAdvancedFilter(false)}
            className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-lg text-xs font-semibold bg-brand-blue text-white hover:bg-brand-blue-hover transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Exclude context menu ─────────────────────────────────────────────────
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
          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-brand-blue/5 hover:text-brand-blue flex items-center gap-2.5 transition-colors"
          onClick={handleExcludeAllBefore}
          role="menuitem"
        >
          <span className="material-symbols-outlined text-[16px]">vertical_align_top</span>
          Exclude all before this
        </button>
        <button
          type="button"
          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-brand-blue/5 hover:text-brand-blue flex items-center gap-2.5 transition-colors"
          onClick={handleExcludeAllAfter}
          role="menuitem"
        >
          <span className="material-symbols-outlined text-[16px]">vertical_align_bottom</span>
          Exclude all after this
        </button>
      </div>
    </div>
  );

  // ─── Manual offer dialog ──────────────────────────────────────────────────
  const manualOfferDialogEl = manualOfferDialog && (
    <div
      ref={manualOfferDialogRef}
      className="fixed z-[110] w-72 bg-white rounded-lg border border-gray-200 shadow-xl p-3"
      style={{ left: manualOfferDialog.x, top: manualOfferDialog.y }}
      role="dialog"
      aria-label="Set manual offer and add to cart"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 flex-1 min-w-0">
          Custom offer for this item
        </p>
        <button
          type="button"
          onClick={closeManualOfferDialog}
          className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0 -mt-0.5 -mr-0.5"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px] leading-none">close</span>
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        Type a per-item offer amount and press Enter or click Okay to add to cart with this manual offer.
      </p>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-blue">£</span>
          <input
            ref={manualOfferInputRef}
            type="number" min="0" step="0.01"
            className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue"
            placeholder="0.00"
            value={manualOfferDialog.value}
            onChange={(e) => {
              const val = sanitizeManualOfferInput(e.target.value);
              setManualOfferDialog((prev) => (prev ? { ...prev, value: val } : prev));
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyManualOfferDialog(); } }}
          />
        </div>
        <button
          type="button"
          className="px-4 py-2.5 text-sm font-semibold text-white bg-brand-blue rounded-lg hover:bg-brand-blue-hover shrink-0"
          onClick={applyManualOfferDialog}
        >
          Okay
        </button>
      </div>
    </div>
  );

  // ─── Wrapper / container ──────────────────────────────────────────────────
  const wrapperClasses = mode === "modal"
    ? (containModalInParent
        ? "flex h-full min-h-0 w-full flex-col"
        : "fixed inset-0 z-[100] flex items-start justify-center bg-black/40")
    : "";

  const containerClasses = mode === "modal"
    ? (containModalInParent
        ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
        : "flex h-full w-full flex-col overflow-hidden bg-white")
    : "flex h-full w-full flex-col overflow-hidden bg-white";

  return mode === "modal" ? (
    <div className={wrapperClasses}>
      <div className={containerClasses}>
        {content}
        {advancedFilterPanelEl}
        {manualOfferDialogEl}
        {excludeContextMenuEl}
      </div>
    </div>
  ) : (
    <div className={containerClasses}>
      {content}
      {advancedFilterPanelEl}
      {manualOfferDialogEl}
      {excludeContextMenuEl}
    </div>
  );
}
