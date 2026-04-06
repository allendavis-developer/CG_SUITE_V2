import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  focusNosposAgreementTab,
  nosposAgreementAddItem,
  nosposAgreementApplyFields,
  nosposAgreementParkAgreement,
} from '@/services/extensionClient';
import {
  buildCategoryTree,
  categoryOptionsAreHierarchical,
  findPathForCategoryValue,
  matchDbCategoryPathToNosposTree,
} from '../nosposCategoryTree';
import {
  findNosposMappingForCategory,
  parseNosposPath,
} from '@/utils/nosposCategoryMappings';
import { fetchNosposCategoryMappings } from '@/services/api';
import { computeNosposMirrorPrefill, inferNosposMirrorFieldRole } from '../utils/nosposMirrorPrefill';
import {
  normalizeAiFieldResponseKeys,
  suggestNosposCategory,
  suggestFieldValues,
  shouldSkipAiFill,
} from '@/services/aiCategoryService';
import { SPREADSHEET_TABLE_STYLES } from '../spreadsheetTableStyles';
import useNosposMirrorQueuedApplies from '../hooks/useNosposMirrorQueuedApplies';
import useNosposMirrorRowCardMap from '../hooks/useNosposMirrorRowCardMap';
import useNosposMirrorValidation from '../hooks/useNosposMirrorValidation';
import { buildApplyFieldKey, buildCardFieldKey } from '../utils/nosposMirrorKeys';
import NosposAgreementMirrorItemSection from './NosposAgreementMirrorItemSection';
import {
  appendNosposMirrorCgSyncMarker,
  hasNosposMirrorCgSyncMarker,
  resolveNosposMirrorItemDescriptionField,
} from '../utils/nosposMirrorSyncMarkers';

// ---------------------------------------------------------------------------
// Constants & utilities
// ---------------------------------------------------------------------------

const DEBUG = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);
const log = (...a) => DEBUG && console.debug(...a);

const cx = (...parts) => parts.filter(Boolean).join(' ');

const INPUT_BASE =
  'w-full rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-3 py-2.5 text-sm text-[var(--text-main)] transition-colors focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]';
const INPUT_ERROR = 'border-red-400 focus:border-red-500 focus:ring-red-500';
const inputCx = (err) => cx(INPUT_BASE, err && INPUT_ERROR);

// ---------------------------------------------------------------------------
// Field-type predicates (table-driven to avoid repetition)
// ---------------------------------------------------------------------------

const FIELD_ROLE_PATTERNS = {
  category: { nameRe: /\[category\]/i, labelEq: 'category' },
  rate:     { nameRe: /\[rate\]$/i,    labelRe: /rate/i },
  location: { nameRe: /\[location\]$/i, labelRe: /location/i },
};

function matchesFieldPattern({ name = '', label = '' }, pattern) {
  const n = name.toLowerCase();
  const l = label.toLowerCase();
  if (pattern.nameRe?.test(n)) return true;
  if (pattern.labelEq && l === pattern.labelEq) return true;
  if (pattern.labelRe?.test(l)) return true;
  return false;
}

const isCategoryField = (f) => matchesFieldPattern(f, FIELD_ROLE_PATTERNS.category);
const isRateField     = (f) => matchesFieldPattern(f, FIELD_ROLE_PATTERNS.rate);
const isLocationField = (f) => matchesFieldPattern(f, FIELD_ROLE_PATTERNS.location);

const CORE_ROLES = new Set(['item_name', 'quantity', 'retail_price', 'offer']);

function partitionCardFields(fields = []) {
  const categoryFields = [], coreFields = [], otherFields = [];
  for (const f of fields) {
    if (!f?.name) continue;
    if (isCategoryField(f)) { categoryFields.push(f); continue; }
    const role = inferNosposMirrorFieldRole(f);
    if (CORE_ROLES.has(role) || isRateField(f) || isLocationField(f)) coreFields.push(f);
    else otherFields.push(f);
  }
  return { categoryFields, coreFields, otherFields };
}

// ---------------------------------------------------------------------------
// Item summariser
// ---------------------------------------------------------------------------

function summariseItem(item) {
  if (!item) return { name: 'Unknown item', dbCategory: null, attributes: {} };
  const ref = item.referenceData || {};
  const name = item.isJewelleryItem
    ? (ref.item_name || ref.line_title || ref.reference_display_name || ref.product_name || item.variantName || item.title || 'Unknown item')
    : (item.variantName || item.title || ref.product_name || 'Unknown item');
  const dbCategory = item.categoryName || item.category || ref.category_label || ref.product_name || null;

  const attributes = {};
  const labels = item.attributeLabels || {};
  for (const [code, val] of Object.entries(item.attributeValues || {})) {
    if (val != null && String(val).trim()) attributes[labels[code] || code] = String(val).trim();
  }
  if (item.isJewelleryItem) {
    for (const [k, v] of [
      ['Material grade', ref.material_grade], ['Product', ref.product_name],
      ['Stone', ref.stone], ['Finger size', ref.finger_size],
      ['Carat', ref.carat], ['Hallmark', ref.hallmark],
    ]) {
      if (v != null && String(v).trim()) attributes[k] = String(v).trim();
    }
  }
  if (item.isCustomCeXItem) {
    for (const [k, v] of Object.entries(item.cexProductData?.specifications || {})) {
      if (v != null && String(v).trim() && attributes[k] === undefined) attributes[k] = String(v).trim();
    }
  }
  return { name: String(name).trim(), dbCategory, attributes };
}

function getItemDisplayName(item, fallback = 'Item') {
  if (!item) return fallback;
  const ref = item.referenceData || {};
  const name = item.isJewelleryItem
    ? (ref.item_name || ref.line_title || ref.reference_display_name || ref.product_name)
    : (item.variantName || item.title || ref.product_name);
  return String(name || fallback).trim() || fallback;
}

function getItemDisplayMeta(item) {
  if (!item) return '';
  const ref = item.referenceData || {};
  const parts = [];
  const qty = Math.max(1, Math.floor(Number(item.quantity)) || 1);
  if (qty > 1) parts.push(`Qty ${qty}`);
  const cat = item.categoryName || item.category || ref.category_label;
  if (cat) parts.push(String(cat).trim());
  return parts.join(' / ');
}

function getItemAttributesSummary(item) {
  return Object.entries(summariseItem(item).attributes || {})
    .filter(([k, v]) => k?.trim() && v?.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function resolveOptionValue(options, aiValue) {
  if (!options?.length || !aiValue) return aiValue;
  const raw = String(aiValue).trim();
  const lo = raw.toLowerCase();
  return (
    options.find((o) => String(o.value ?? '') === raw) ||
    options.find((o) => String(o.text ?? '').trim() === raw) ||
    options.find((o) => String(o.text ?? '').trim().toLowerCase() === lo || String(o.value ?? '').toLowerCase() === lo)
  )?.value != null
    ? String((options.find((o) => String(o.value ?? '') === raw) ||
               options.find((o) => String(o.text ?? '').trim() === raw) ||
               options.find((o) => [o.text, o.value].map((x) => String(x ?? '').trim().toLowerCase()).includes(lo)))?.value ?? raw)
    : raw;
}

function shallowEqual(a, b) {
  const ak = Object.keys(a || {}), bk = Object.keys(b || {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function getMirrorFieldControlId(field) {
  return `nospos-mirror-${String(field?.name || '').replace(/[^\w-]/g, '_')}`;
}

function focusChainAdvance(current) {
  const root = current?.closest?.('[data-mirror-focus-chain]');
  if (!root) return;
  const nodes = Array.from(root.querySelectorAll('[data-mirror-focusable="true"]')).filter(
    (n) => n instanceof HTMLElement && !n.disabled && n.getAttribute('aria-hidden') !== 'true' && !n.closest('[hidden]')
  );
  const idx = nodes.indexOf(current);
  if (idx >= 0 && idx < nodes.length - 1) nodes[idx + 1].focus();
}

const onEnterAdvance = (e) => { if (e.key === 'Enter') { e.preventDefault(); focusChainAdvance(e.currentTarget); } };

// ---------------------------------------------------------------------------
// Spinner overlay (shared)
// ---------------------------------------------------------------------------

function SpinnerOverlay({ message, sub, className = '' }) {
  return (
    <div
      className={cx('absolute inset-0 z-20 flex flex-col items-center justify-center gap-3', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
      <p className="text-sm font-bold text-[var(--brand-blue)]">{message}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryCascadeField
// ---------------------------------------------------------------------------

function CategoryCascadeField({ field, tree, value, onChange, required, showError, item, firstSelectId, onAiFilled, onCategoryAiRunningChange, nosposMappings }) {
  const [path, setPath] = useState([]);
  const [aiRunning, setAiRunning] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);

  const userTookOverRef = useRef(false);
  const autoAttemptedRef = useRef(false);
  const onAiFilledRef = useRef(onAiFilled);
  const updatePathRef = useRef(null);

  useEffect(() => { onAiFilledRef.current = onAiFilled; });

  // Reset when item / field changes
  useEffect(() => {
    userTookOverRef.current = false;
    autoAttemptedRef.current = false;
    setManualFallback(false);
  }, [field?.name, item?.id, item?.request_item_id, item?.variantId, tree]);

  const updatePath = useCallback((newPath) => {
    setPath(newPath);
    let node = tree;
    for (const s of newPath) { node = node.children.get(s); if (!node) break; }
    onChange(node && node.children.size === 0 && node.leafValues.length === 1 ? node.leafValues[0].value : '');
  }, [tree, onChange]);

  useEffect(() => { updatePathRef.current = updatePath; });

  // Sync path from external value
  useEffect(() => {
    if (!tree) return;
    const raw = value != null ? String(value) : '';
    if (!raw) { setPath((p) => p.length ? [] : p); return; }
    const resolved = findPathForCategoryValue(tree, raw) || [];
    setPath((p) => resolved.length === p.length && resolved.every((s, i) => s === p[i]) ? p : resolved);
  }, [tree, value]);

  const runCascade = useCallback(async (startPath) => {
    onCategoryAiRunningChange?.(true);
    setAiRunning(true);
    setManualFallback(false);
    let currentPath = [...startPath];
    let node = tree;
    let succeeded = false;
    try {
      for (const seg of currentPath) { const next = node.children.get(seg); if (!next) return; node = next; }
      const itemSummary = summariseItem(item);
      // Accumulate the full path in memory without touching React state at all,
      // then apply the complete result in one single update at the end.
      while (node.children.size > 0) {
        const levelIndex = currentPath.length;
        const availableOptions = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
        const result = await suggestNosposCategory({ item: itemSummary, levelIndex, availableOptions, previousPath: currentPath });
        console.info('[CG Suite] Category AI reasoning', { level: levelIndex + 1, selected: result.suggested, confidence: result.confidence, reasoning: result.reasoning || '' });
        const nextNode = node.children.get(result.suggested);
        if (!nextNode) break;
        currentPath = [...currentPath, result.suggested];
        node = nextNode;
      }
      succeeded = true;
    } catch (err) {
      console.error('[CG Suite] AI Category error:', err.message);
      setManualFallback(true);
    } finally {
      // Apply the full path in one shot — one render, one onChange call
      if (succeeded && currentPath.length > startPath.length) {
        updatePathRef.current([...currentPath]);
        onAiFilledRef.current?.();
      }
      setAiRunning(false);
      onCategoryAiRunningChange?.(false);
    }
  }, [tree, item, onCategoryAiRunningChange]);

  const handlePrefill = useCallback(() => {
    userTookOverRef.current = false;
    setManualFallback(false);
    runCascade(path);
  }, [runCascade, path]);

  const categorySelected = String(value ?? '').trim() !== '';

  // Auto-trigger cascade once.
  // Priority order:
  //   1. User-configured NoSpos category mapping (Config page)
  //   2. Item's saved DB category path
  //   3. Full AI
  useEffect(() => {
    if (!tree || tree.children.size === 0 || categorySelected || aiRunning || manualFallback || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;

    function applyPath(matchedPath, label) {
      let node = tree;
      for (const seg of matchedPath) { node = node.children.get(seg); if (!node) break; }
      if (!node || node.children.size === 0) {
        console.info(`[CG Suite] Category: ${label} — full match, applying directly (no AI)`, matchedPath);
        updatePath(matchedPath);
      } else {
        console.info(`[CG Suite] Category: ${label} — partial match, AI filling remainder from prefix`, matchedPath);
        runCascade(matchedPath);
      }
    }

    // 1. Check user-configured mappings (Config page → NoSpos category mappings)
    const categoryId = item?.categoryObject?.id ?? item?.categoryId ?? null;
    const categoryName = item?.categoryName || item?.category || null;
    const userMapping = findNosposMappingForCategory(categoryId, categoryName, nosposMappings || []);
    if (userMapping) {
      const userPath = parseNosposPath(userMapping.nosposPath);
      const matchedUser = matchDbCategoryPathToNosposTree(tree, userPath);
      if (matchedUser) {
        applyPath(matchedUser, 'user-configured mapping');
        return;
      }
      console.info('[CG Suite] Category: user mapping found but path not in nospos tree, trying DB path', { nosposPath: userMapping.nosposPath });
    }

    // 2. Check item's DB category path
    const dbCategoryPath = item?.categoryObject?.path;
    const matchedDb = matchDbCategoryPathToNosposTree(tree, dbCategoryPath);
    if (matchedDb) {
      applyPath(matchedDb, 'saved DB category path');
      return;
    }

    // 3. Full AI
    console.info('[CG Suite] Category: no mapping/DB path match in nospos tree, falling back to full AI', { dbCategoryPath, userMapping: userMapping?.nosposPath ?? null });
    handlePrefill();
  }, [tree, categorySelected, aiRunning, manualFallback, handlePrefill, item, runCascade, updatePath, nosposMappings]);

  // Build level selects
  const levelBlocks = [];
  let node = tree, depth = 0;
  while (node && depth < 24) {
    const branchKeys = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    if (branchKeys.length > 0) {
      const d = depth, sel = path[d] || '';
      levelBlocks.push(
        <div key={`row-${d}`} className="flex min-w-0 max-w-full shrink-0 items-center gap-1.5">
          <select
            id={!levelBlocks.length && firstSelectId ? firstSelectId : undefined}
            aria-label={`${field.label} — level ${d + 1}`}
            required={required && !d}
            data-mirror-focusable="true"
            onKeyDown={onEnterAdvance}
            className={cx('min-w-[10rem] max-w-[18rem] shrink-0', inputCx(showError))}
            value={sel}
            onChange={(e) => {
              const seg = e.target.value;
              userTookOverRef.current = true;
              setManualFallback(false);
              updatePath(seg ? [...path.slice(0, d), seg] : path.slice(0, d));
            }}
          >
            <option value="">Select…</option>
            {branchKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      );
      if (!sel) break;
      node = node.children.get(sel);
      depth++;
      continue;
    }
    if (node.leafValues?.length > 1) {
      levelBlocks.push(
        <div key={`lf-${depth}`} className="flex min-w-0 shrink-0 items-center">
          <select
            id={!levelBlocks.length && firstSelectId ? firstSelectId : undefined}
            aria-label={`${field.label} — variant`}
            required={required}
            data-mirror-focusable="true"
            onKeyDown={onEnterAdvance}
            className={cx('min-w-[10rem] max-w-[20rem]', inputCx(showError))}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select…</option>
            {node.leafValues.map((l) => <option key={l.value} value={l.value}>{l.text}</option>)}
          </select>
        </div>
      );
    }
    break;
  }

  return (
    <div className="flex flex-col gap-3">
      {tree?.children.size > 0 && !categorySelected && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={aiRunning}
            onClick={handlePrefill}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] px-3 py-1.5 text-xs font-bold text-[var(--brand-blue)] transition hover:bg-[var(--brand-blue)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {aiRunning
              ? <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />Calculating…</>
              : <><span className="material-symbols-outlined text-[14px] leading-none">auto_awesome</span>Prefill using AI</>}
          </button>
          {aiRunning && <span className="text-[10px] font-semibold text-[var(--text-muted)]">AI calculating category…</span>}
        </div>
      )}
      {manualFallback && (
        <p className="text-xs font-medium text-amber-800">
          Category AI stopped early. Choose each level manually using the dropdowns — they stay fully editable.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{levelBlocks}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MirrorField
// ---------------------------------------------------------------------------

function MirrorField({ field, value, onChange, showError, item, layout = 'default', onAiFilled, onCategoryAiRunningChange, nosposMappings }) {
  const id = getMirrorFieldControlId(field);
  const req = Boolean(field.required);
  const tableCell = layout === 'tableCell';

  const categoryTree = useMemo(
    () => field.control === 'select' && isCategoryField(field) ? buildCategoryTree(field.options || []) : null,
    [field]
  );

  let control;
  if (field.control === 'select' && Array.isArray(field.options)) {
    const hierarchical = isCategoryField(field) && categoryTree?.children.size > 0 && categoryOptionsAreHierarchical(field.options);
    if (hierarchical) {
      control = (
        <CategoryCascadeField
          key={`${field.name}:${item?.request_item_id ?? item?.id ?? item?.variantId ?? 'item'}`}
          field={field} tree={categoryTree} value={value} onChange={onChange}
          required={req} showError={showError} item={item}
          firstSelectId={tableCell ? id : undefined}
          onAiFilled={onAiFilled}
          onCategoryAiRunningChange={onCategoryAiRunningChange}
          nosposMappings={nosposMappings}
        />
      );
    } else {
      control = (
        <select
          id={id} required={req} data-mirror-focusable="true" onKeyDown={onEnterAdvance}
          className={inputCx(showError)} value={value} onChange={(e) => onChange(e.target.value)}
        >
          {(field.options || []).map((o) => <option key={String(o.value)} value={o.value}>{o.text || o.value || '—'}</option>)}
        </select>
      );
    }
  } else {
    const inputType = ['number', 'email', 'tel'].includes(field.inputType) ? field.inputType : 'text';
    control = (
      <input
        id={id} type={inputType} required={req} data-mirror-focusable="true" onKeyDown={onEnterAdvance}
        className={inputCx(showError)} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off"
      />
    );
  }

  const error = showError ? <p className="text-xs font-semibold text-red-600">This field is required.</p> : null;

  if (tableCell) return <div className="space-y-1">{control}{error}</div>;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
        {field.label}{req && <span className="text-red-600"> *</span>}
      </label>
      {control}
      {error}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function NosposAgreementMirrorModal({
  open,
  snapshot,
  loading = false,
  waitExpired = false,
  requestId = null,
  sourceLines = [],
  useVoucherOffers = false,
  mirrorFirstLineOnly = false,
  selectedIndex = null,
  autoAddSelectedIfMissing = false,
  testingOutcomeByRow = {},
  onClose,
}) {
  // --- UI state ---
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [touched, setTouched] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());

  // --- Card/AI state ---
  const [aiFillingCards, setAiFillingCards] = useState(new Set());
  const [applyingCards, setApplyingCards] = useState(new Set());
  const [updatingCategoryCards, setUpdatingCategoryCards] = useState(new Set());
  const [addingItem, setAddingItem] = useState(false);
  const [addingItemIndex, setAddingItemIndex] = useState(null);
  const [categoryAiBlocking, setCategoryAiBlocking] = useState(false);
  const [preexistingSyncedCards, setPreexistingSyncedCards] = useState(new Set());
  const [aiFilledFieldKeys, setAiFilledFieldKeys] = useState(new Set());
  const [aiManualFallbackCards, setAiManualFallbackCards] = useState(new Set());
  const [prefillStepVersion, setPrefillStepVersion] = useState(0);

  // --- NoSpos category mappings (loaded once from DB on first open) ---
  const [nosposMappings, setNosposMappings] = useState([]);
  const mappingsLoadedRef = useRef(false);
  useEffect(() => {
    if (!open || mappingsLoadedRef.current) return;
    mappingsLoadedRef.current = true;
    fetchNosposCategoryMappings().then(setNosposMappings).catch(() => {});
  }, [open]);

  // --- Refs ---
  const valuesRef = useRef(values);
  const snapshotRef = useRef(snapshot);
  const categoryAiDepthRef = useRef(0);
  const attrPrefillDoneRef = useRef(new Set());
  const userOverriddenRef = useRef(new Set());
  const preservedRef = useRef(new Set());
  const prevOpenRef = useRef(false);
  const markerQueuedRef = useRef(new Set());
  const autoAddAttemptedRef = useRef(new Set());
  const autoAiRequestedRef = useRef(new Set());
  const preexistingScannedRef = useRef(false);

  useEffect(() => { valuesRef.current = values; });
  useEffect(() => { snapshotRef.current = snapshot; });

  const { applyInFlightRef, queueFieldApply, flushQueuedFieldApplies, resetQueuedApplies } =
    useNosposMirrorQueuedApplies({ snapshotRef, setApplyingCards, setFormError });

  const notifyCategoryAiRunning = useCallback((running) => {
    categoryAiDepthRef.current = Math.max(0, categoryAiDepthRef.current + (running ? 1 : -1));
    setCategoryAiBlocking(categoryAiDepthRef.current > 0);
  }, []);

  const { failedRows: failedRowsForParking, rowToCardIndex, rowStateByIndex, nextRowToAdd, expectedCardCount: expectedMirrorCardCount, getSourceRowIndexForCard } =
    useNosposMirrorRowCardMap(sourceLines, snapshot, testingOutcomeByRow, requestId);

  const mappedSourceLines = useMemo(
    () => (snapshot?.cards || []).map((_, i) => sourceLines?.[getSourceRowIndexForCard(i)] || null),
    [snapshot, sourceLines, getSourceRowIndexForCard]
  );

  const attributePrefill = useMemo(
    () => computeNosposMirrorPrefill(snapshot, mappedSourceLines, useVoucherOffers),
    [snapshot, mappedSourceLines, useVoucherOffers]
  );

  // ---------------------------------------------------------------------------
  // Reset on open
  // ---------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (!open || prevOpenRef.current) { prevOpenRef.current = open; return; }
    prevOpenRef.current = true;
    userOverriddenRef.current = new Set();
    preservedRef.current = new Set();
    markerQueuedRef.current = new Set();
    autoAddAttemptedRef.current = new Set();
    autoAiRequestedRef.current = new Set();
    categoryAiDepthRef.current = 0;
    preexistingScannedRef.current = false;
    attrPrefillDoneRef.current = new Set();
    setCategoryAiBlocking(false);
    setPreexistingSyncedCards(new Set());
    setAiFilledFieldKeys(new Set());
    resetQueuedApplies();
    setApplyingCards(new Set());
    setUpdatingCategoryCards(new Set());
    setAddingItem(false);
    setAddingItemIndex(null);
    setTouched(false);
    setPrefillStepVersion(0);
    setAiManualFallbackCards(new Set());
    const defaultIdx =
      mirrorFirstLineOnly && !Number.isInteger(selectedIndex) ? 0
      : Number.isInteger(selectedIndex) ? selectedIndex
      : Math.min(snapshot?.cards?.length || 0, (sourceLines?.length || 1) - 1);
    setExpandedRows(new Set((sourceLines?.length || 0) > 0 ? [defaultIdx] : []));
  }, [open, snapshot, sourceLines, selectedIndex, mirrorFirstLineOnly, resetQueuedApplies]);

  // ---------------------------------------------------------------------------
  // Scan pre-existing synced cards
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !snapshot || preexistingScannedRef.current) return;
    preexistingScannedRef.current = true;
    const marked = new Set(
      (snapshot.cards || []).reduce((acc, card, idx) => {
        const srcIdx = getSourceRowIndexForCard(idx);
        const desc = resolveNosposMirrorItemDescriptionField(card);
        if (desc && hasNosposMirrorCgSyncMarker(desc.value, sourceLines?.[srcIdx] || null, srcIdx, requestId)) acc.push(idx);
        return acc;
      }, [])
    );
    setPreexistingSyncedCards(marked);
    log('[CG Suite] Initial sync scan complete', { markedCards: [...marked] });
  }, [open, snapshot, sourceLines, requestId, getSourceRowIndexForCard]);

  // ---------------------------------------------------------------------------
  // Auto-apply CG sync markers
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !snapshot || !preexistingScannedRef.current || busy || addingItem) return;
    const toMark = [];
    for (let i = 0; i < (snapshot.cards || []).length; i++) {
      const card = snapshot.cards[i];
      const srcIdx = getSourceRowIndexForCard(i);
      const srcItem = sourceLines?.[srcIdx] || null;
      const desc = resolveNosposMirrorItemDescriptionField(card);
      if (!desc?.name || hasNosposMirrorCgSyncMarker(desc.value, srcItem, srcIdx, requestId)) continue;
      const markerValue = appendNosposMirrorCgSyncMarker(desc.value, srcItem, srcIdx, requestId);
      const qKey = `${snapshot.pageInstanceId || 'page:unknown'}::${card.cardId || `idx:${i}`}::${markerValue}`;
      if (markerQueuedRef.current.has(qKey)) continue;
      markerQueuedRef.current.add(qKey);
      toMark.push({ name: desc.name, value: markerValue, cardIndex: i, cardId: card.cardId || null });
    }
    if (!toMark.length) return;
    log('[CG Suite] Auto-applying CG sync markers', toMark);
    nosposAgreementApplyFields(toMark).catch((e) => console.error('[CG Suite] Auto-marker apply failed', e?.message));
  }, [open, snapshot, sourceLines, requestId, busy, addingItem, getSourceRowIndexForCard]);

  // ---------------------------------------------------------------------------
  // Init / sync field values from snapshot
  // ---------------------------------------------------------------------------

  useLayoutEffect(() => {
    if (!open || !snapshot) return;
    const allNames = new Set((snapshot.cards || []).flatMap((c) => (c.fields || []).map((f) => f?.name).filter(Boolean)));
    for (const k of [...userOverriddenRef.current, ...preservedRef.current]) {
      if (!allNames.has(k)) { userOverriddenRef.current.delete(k); preservedRef.current.delete(k); }
    }

    const base = {};
    const autoApply = [];

    for (let ci = 0; ci < (snapshot.cards || []).length; ci++) {
      const card = snapshot.cards[ci];
      const cardMarked = preexistingSyncedCards.has(ci);
      for (const f of card.fields || []) {
        if (!f?.name) continue;
        if (cardMarked) { base[f.name] = f.value != null ? String(f.value) : ''; continue; }
        const role = inferNosposMirrorFieldRole(f);
        const prefill = attributePrefill[f.name];
        const nosposVal = f.value != null ? String(f.value) : '';
        if (CORE_ROLES.has(role) && prefill != null && String(prefill).trim()) {
          const norm = String(prefill);
          base[f.name] = norm;
          if (!userOverriddenRef.current.has(f.name) && nosposVal !== norm) {
            autoApply.push({ name: f.name, value: norm, cardIndex: ci, cardId: card.cardId || null });
          }
          continue;
        }
        base[f.name] = isRateField(f) || isLocationField(f) ? nosposVal : '';
      }
    }

    setValues((prev) => {
      const next = { ...base };
      for (const k of preservedRef.current) if (allNames.has(k) && prev[k] !== undefined) next[k] = prev[k];
      return shallowEqual(prev, next) ? prev : next;
    });

    if (autoApply.length) {
      for (const f of autoApply) { preservedRef.current.add(f.name); queueFieldApply(f.name, f.value, f.cardIndex, f.cardId); }
    }
    setFormError(null);
  }, [open, snapshot, attributePrefill, preexistingSyncedCards, queueFieldApply]);

  // ---------------------------------------------------------------------------
  // Snapshot waiter helpers
  // ---------------------------------------------------------------------------

  const waitForSnapshotReload = useCallback((prevPageId, { minCardCount = 0, timeoutMs = 15000, actionLabel = 'NoSpos' } = {}) => {
    const start = snapshotRef.current;
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        const next = snapshotRef.current;
        const pageReloaded = prevPageId ? next?.pageInstanceId != null && next.pageInstanceId !== prevPageId : next != null && next !== start;
        if (pageReloaded && (next?.cards?.length || 0) >= minCardCount) return resolve(next);
        if (Date.now() - t0 >= timeoutMs) return reject(new Error(`${actionLabel} did not reload in time.`));
        setTimeout(check, 150);
      })();
    });
  }, []);

  const waitForCardCount = useCallback((target, timeoutMs = 12000) => {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if ((snapshotRef.current?.cards?.length || 0) >= target) return resolve(snapshotRef.current);
        if (Date.now() - t0 >= timeoutMs) return reject(new Error('NoSpos did not add the next item card in time.'));
        setTimeout(check, 150);
      })();
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Field change handlers
  // ---------------------------------------------------------------------------

  const handleFieldChange = useCallback((name, cardIdx, cardId) => (v) => {
    userOverriddenRef.current.add(name);
    preservedRef.current.add(name);
    const str = v != null ? String(v) : '';
    setValues((prev) => ({ ...prev, [name]: str }));
    queueFieldApply(name, str, cardIdx, cardId || null);
  }, [queueFieldApply]);

  const handleCategoryFieldChange = useCallback((name, cardIdx, cardId) => (v) => {
    userOverriddenRef.current.add(name);
    preservedRef.current.add(name);
    const str = v != null ? String(v) : '';
    setValues((prev) => ({ ...prev, [name]: str }));
    if (!str.trim()) return;
    void (async () => {
      try {
        setFormError(null);
        setUpdatingCategoryCards((prev) => new Set([...prev, cardIdx]));
        const prevPageId = snapshotRef.current?.pageInstanceId || null;
        const r = await nosposAgreementApplyFields([{ name, value: str, cardIndex: cardIdx, cardId: cardId || null }]);
        if (!r?.ok) {
          setFormError(r?.error || 'Could not update category on NosPos. Check the agreement tab is still open.');
        } else {
          await waitForSnapshotReload(prevPageId, { minCardCount: snapshotRef.current?.cards?.length || 0, actionLabel: 'Updating the category' });
        }
      } catch (e) {
        setFormError(e?.message || 'Could not update category on NosPos.');
      } finally {
        setUpdatingCategoryCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
      }
    })();
  }, [waitForSnapshotReload]);

  // ---------------------------------------------------------------------------
  // Attribute prefill
  // ---------------------------------------------------------------------------

  const applyAttributePrefillForCard = useCallback((cardIdx) => {
    const card = snapshotRef.current?.cards?.[cardIdx];
    if (!card) return;
    const { otherFields } = partitionCardFields(card.fields);
    const toApply = [];
    for (const field of otherFields) {
      if (!field?.name || userOverriddenRef.current.has(field.name)) continue;
      const prefillValue = attributePrefill[field.name];
      if (prefillValue == null || !String(prefillValue).trim()) continue;
      const options = Array.isArray(field.options) ? field.options : [];
      if (field.control === 'select' && !options.length) continue;
      const resolved = resolveOptionValue(options, String(prefillValue));
      if (options.length && !options.some((o) => String(o.value ?? '') === String(resolved ?? ''))) continue;
      if (!resolved || !String(resolved).trim()) continue;
      toApply.push({ name: field.name, value: String(resolved) });
    }
    if (!toApply.length) return;
    setValues((prev) => { const next = { ...prev }; for (const { name, value } of toApply) next[name] = value; return next; });
    for (const { name, value } of toApply) {
      preservedRef.current.add(name);
      queueFieldApply(name, value, cardIdx, card.cardId || null);
    }
    setFormError(null);
  }, [attributePrefill, queueFieldApply]);

  // ---------------------------------------------------------------------------
  // AI fill
  // ---------------------------------------------------------------------------

  const aiFillForCard = useCallback((cardIdx) => {
    const card = snapshotRef.current?.cards?.[cardIdx];
    const srcIdx = getSourceRowIndexForCard(cardIdx);
    const cardItem = sourceLines?.[srcIdx] ?? null;
    if (!card || !cardItem) return;

    setAiManualFallbackCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
    const { otherFields } = partitionCardFields(card.fields);
    const fieldsForAi = otherFields.filter((f) => {
      if (!f?.name || !f.required) return false;
      const empty = !String(valuesRef.current?.[f.name] ?? '').trim();
      if (f.required && empty) return true;
      if (userOverriddenRef.current.has(f.name)) return false;
      if (shouldSkipAiFill(f)) return false;
      if (attributePrefill[f.name] != null && String(attributePrefill[f.name]).trim()) return false;
      return empty;
    });

    if (!fieldsForAi.length) {
      setFormError('Nothing left for AI to suggest for required fields on this item. Fill any empty required fields manually.');
      setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
      return;
    }

    const fieldOptionsMap = Object.fromEntries(fieldsForAi.map((f) => [f.name, f.options || []]));
    setAiFillingCards((prev) => new Set([...prev, cardIdx]));

    suggestFieldValues({
      item: summariseItem(cardItem),
      fields: fieldsForAi.map((f) => ({
        name: f.name, label: f.label || '', control: f.control || 'text',
        options: (f.options || []).map((o) => ({ value: String(o.value ?? ''), text: String(o.text ?? o.value ?? '') })),
      })),
    })
      .then((result) => {
        const normalized = normalizeAiFieldResponseKeys(result.fields, fieldsForAi);
        const toApply = {};
        for (const [fieldName, aiRaw] of Object.entries(normalized)) {
          if (userOverriddenRef.current.has(fieldName) || !aiRaw || !String(aiRaw).trim()) continue;
          const resolved = resolveOptionValue(fieldOptionsMap[fieldName] || [], String(aiRaw));
          if (resolved && String(resolved).trim()) toApply[fieldName] = String(resolved);
        }
        if (Object.keys(toApply).length) {
          setValues((prev) => ({ ...prev, ...toApply }));
          setAiFilledFieldKeys((prev) => {
            const next = new Set(prev);
            for (const k of Object.keys(toApply)) next.add(buildCardFieldKey(cardIdx, k));
            return next;
          });
          for (const [k, v] of Object.entries(toApply)) {
            preservedRef.current.add(k);
            queueFieldApply(k, v, cardIdx, card.cardId || null);
          }
          setFormError(null);
        } else if (fieldsForAi.length) {
          setFormError('AI did not return usable values for the empty fields. Please complete them manually — all fields below stay editable.');
          setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
        }
      })
      .catch((err) => {
        console.error('[CG Suite] AI fill failed', { cardIdx, error: err?.message });
        setFormError(`${err?.message || 'AI fill failed.'} You can fill every field manually below; nothing is locked.`);
        setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
      })
      .finally(() => {
        setAiFillingCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
      });
  }, [attributePrefill, queueFieldApply, sourceLines, getSourceRowIndexForCard]);

  // ---------------------------------------------------------------------------
  // Add item
  // ---------------------------------------------------------------------------

  const handleAddItem = useCallback(async (rowIdx) => {
    if (!snapshot || busy || addingItem) return;
    if (mirrorFirstLineOnly && rowIdx > 0) { setFormError('Only the first line is used in this testing flow.'); return; }
    if (!Number.isInteger(nextRowToAdd) || rowIdx !== nextRowToAdd) {
      setFormError(Number.isInteger(nextRowToAdd) ? 'Add items to NoSpos in order from top to bottom.' : 'There are no more rows available to add in NoSpos.');
      return;
    }
    const currentCount = snapshot.cards?.length || 0;
    setAddingItem(true);
    setAddingItemIndex(currentCount);
    setFormError(null);
    try {
      await flushQueuedFieldApplies();
      const prevPageId = snapshotRef.current?.pageInstanceId || null;
      const addResult = await nosposAgreementAddItem();
      if (!addResult?.ok) throw new Error(addResult?.error || 'Could not add the next NoSpos item.');
      await waitForSnapshotReload(prevPageId, { minCardCount: currentCount + 1, actionLabel: 'Adding the next item' });
      const reloaded = await waitForCardCount(currentCount + 1);
      const newCard = reloaded?.cards?.[currentCount];
      const markerField = resolveNosposMirrorItemDescriptionField(newCard);
      const srcItem = sourceLines?.[rowIdx] || null;
      if (markerField?.name) {
        const markerValue = appendNosposMirrorCgSyncMarker(markerField.value, srcItem, rowIdx, requestId);
        await nosposAgreementApplyFields([{ name: markerField.name, value: markerValue, cardIndex: currentCount, cardId: newCard?.cardId || null }]);
      }
    } catch (err) {
      setFormError(err?.message || 'Could not add the next NoSpos item.');
    } finally {
      setAddingItem(false);
      setAddingItemIndex(null);
    }
  }, [snapshot, busy, addingItem, flushQueuedFieldApplies, waitForSnapshotReload, waitForCardCount, sourceLines, requestId, mirrorFirstLineOnly, nextRowToAdd]);

  // ---------------------------------------------------------------------------
  // Auto-add selected item if missing
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !autoAddSelectedIfMissing || !Number.isInteger(selectedIndex) || busy || addingItem) return;
    const cardIdx = rowToCardIndex.get(selectedIndex);
    if (Number.isInteger(cardIdx) && snapshot?.cards?.[cardIdx]) return;
    const key = `${snapshot?.pageInstanceId || 'page:unknown'}:${selectedIndex}`;
    if (autoAddAttemptedRef.current.has(key)) return;
    autoAddAttemptedRef.current.add(key);
    handleAddItem(selectedIndex);
  }, [open, autoAddSelectedIfMissing, selectedIndex, busy, addingItem, snapshot, rowToCardIndex, handleAddItem]);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const hasUserOverride = useCallback((n) => userOverriddenRef.current.has(n), []);
  const { allFields, validationErrors, getValidationErrorsForCard, getValidationErrorsForParking } =
    useNosposMirrorValidation({ snapshot, values, hasUserOverride, getSourceRowIndexForCard, failedRowsForParking });

  // ---------------------------------------------------------------------------
  // Auto attribute prefill when category is ready
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !snapshot) return;
    const cards = snapshot.cards || [];
    const toPrefill = [];
    for (let ci = 0; ci < cards.length; ci++) {
      if (attrPrefillDoneRef.current.has(ci)) continue;
      const card = cards[ci];
      const { categoryFields } = partitionCardFields(card?.fields || []);
      const reqCat = categoryFields.filter((f) => f.required);
      const catReady = !reqCat.length || reqCat.every((f) => String(values[f.name] ?? (f.value ?? '')).trim());
      if (!catReady) continue;
      toPrefill.push(ci);
    }
    if (!toPrefill.length) return;
    for (const ci of toPrefill) { attrPrefillDoneRef.current.add(ci); applyAttributePrefillForCard(ci); }
    setPrefillStepVersion((v) => v + 1);
  }, [open, snapshot, values, applyAttributePrefillForCard]);

  // ---------------------------------------------------------------------------
  // Auto AI fill when attribute prefill done and fields still missing
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !snapshot || busy || addingItem || aiFillingCards.size || applyingCards.size || updatingCategoryCards.size) return;
    const cards = snapshot.cards || [];
    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      if (!card || !attrPrefillDoneRef.current.has(ci)) continue;
      const { categoryFields } = partitionCardFields(card.fields || []);
      const reqCat = categoryFields.filter((f) => f.required);
      const catReady = !reqCat.length || reqCat.every((f) => String(values[f.name] ?? (f.value ?? '')).trim());
      if (!catReady) continue;
      if (!getValidationErrorsForCard(ci, values).size) { autoAiRequestedRef.current.delete(`${snapshot.pageInstanceId || 'page:unknown'}::${card.cardId || `idx:${ci}`}`); continue; }
      const aiKey = `${snapshot.pageInstanceId || 'page:unknown'}::${card.cardId || `idx:${ci}`}`;
      if (autoAiRequestedRef.current.has(aiKey)) continue;
      autoAiRequestedRef.current.add(aiKey);
      aiFillForCard(ci);
      break;
    }
  }, [open, snapshot, values, busy, addingItem, aiFillingCards, applyingCards, updatingCategoryCards, getValidationErrorsForCard, aiFillForCard]);

  // ---------------------------------------------------------------------------
  // Park / submit
  // ---------------------------------------------------------------------------

  const handleNext = async () => {
    if (!snapshot || busy) return;
    setTouched(true);
    setFormError(null);
    setBusy(true);
    try {
      await flushQueuedFieldApplies();
      const finalValues = { ...valuesRef.current };
      const expectedCount = mirrorFirstLineOnly ? 1 : sourceLines.reduce((n, _, i) => failedRowsForParking.has(i) ? n : n + 1, 0);
      if ((snapshot.cards?.length || 0) < expectedCount) {
        throw new Error(mirrorFirstLineOnly ? 'Add the first line to NoSpos before parking.' : 'Add each non-failed item to NoSpos before continuing.');
      }
      const finalErrors = getValidationErrorsForParking(finalValues);
      if (finalErrors.size > 0) {
        const labels = allFields.filter((f) => finalErrors.has(f.name)).slice(0, 4).map((f) => f.label || f.name);
        throw new Error(`Please fill all required fields before continuing: ${labels.join(', ')}${finalErrors.size > 4 ? '…' : ''}`);
      }

      // Build field list
      const snapshotFieldMap = new Map();
      const fieldsInOrder = [];
      for (let ci = 0; ci < (snapshot.cards || []).length; ci++) {
        const card = snapshot.cards[ci];
        const srcIdx = getSourceRowIndexForCard(ci);
        const srcItem = sourceLines?.[srcIdx] || null;
        const markerFieldName = resolveNosposMirrorItemDescriptionField(card)?.name || null;
        for (const f of card.fields || []) {
          if (!f?.name) continue;
          const raw = finalValues[f.name] != null ? String(finalValues[f.name]) : '';
          const next = markerFieldName && f.name === markerFieldName ? appendNosposMirrorCgSyncMarker(raw, srcItem, srcIdx, requestId) : raw;
          fieldsInOrder.push({ name: f.name, value: next, cardIndex: ci, cardId: card.cardId || null });
          snapshotFieldMap.set(buildApplyFieldKey(f.name, ci, card.cardId || null), f.value != null ? String(f.value) : '');
        }
      }

      // Apply with retry
      let pending = fieldsInOrder.filter((f) => (snapshotFieldMap.get(buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null)) ?? '') !== f.value);
      for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
        const r = await nosposAgreementApplyFields(pending);
        if (!r?.ok && !r?.missing?.length && !r?.failed?.length) throw new Error(r?.error || 'Could not update the NosPos form. Is the agreement window still open?');
        const retryKeys = new Set([...(r?.missing || []), ...(r?.failed || [])].map((e) => buildApplyFieldKey(e?.name, e?.cardIndex, e?.cardId || null)).filter(Boolean));
        pending = retryKeys.size ? pending.filter((f) => retryKeys.has(buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null))) : [];
        if (pending.length && attempt < 3) await new Promise((r) => setTimeout(r, 80));
      }
      if (pending.length) throw new Error(`Could not copy all fields to NosPos (${pending.length} still failing): ${pending.slice(0, 5).map((f) => f.name).join(', ')}${pending.length > 5 ? ', …' : ''}`);

      await new Promise((r) => setTimeout(r, 120));

      let parkResult = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        parkResult = await nosposAgreementParkAgreement();
        if (parkResult?.ok) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!parkResult?.ok) throw new Error(parkResult?.error || 'Could not park the agreement. Use Actions → Park Agreement on the NoSpos tab.');

      try { await focusNosposAgreementTab(); } catch { /* non-fatal */ }
      onClose?.({ completed: true });
    } catch (e) {
      setFormError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Per-row done (single item mode)
  // ---------------------------------------------------------------------------

  const handleDoneWithItem = useCallback(async () => {
    if (selectedIndex == null || busy) return;
    setTouched(true);
    setFormError(null);
    const cardIdx = rowToCardIndex.get(selectedIndex);
    if (!Number.isInteger(cardIdx) || !snapshotRef.current?.cards?.[cardIdx]) { setFormError('Add this item to NoSpos first.'); return; }
    if (getValidationErrorsForCard(cardIdx, valuesRef.current).size) { setFormError('Fill the required NoSpos fields for this item before continuing.'); return; }
    try { await flushQueuedFieldApplies(); onClose?.({ itemCompleted: true, itemIndex: selectedIndex }); }
    catch (err) { setFormError(err?.message || 'Could not finish this NoSpos item yet.'); }
  }, [selectedIndex, busy, getValidationErrorsForCard, flushQueuedFieldApplies, onClose, rowToCardIndex]);

  const handleDismiss = useCallback(async () => {
    if (busy) return;
    try { await flushQueuedFieldApplies(); } finally { onClose?.(); }
  }, [busy, flushQueuedFieldApplies, onClose]);

  // ---------------------------------------------------------------------------
  // Derived render values (all hooks must come before any early return)
  // ---------------------------------------------------------------------------

  const cardFieldPartitions = useMemo(
    () => (snapshot?.cards || []).map((c) => partitionCardFields(c?.fields || [])),
    [snapshot]
  );

  if (!open) return null;

  const showForm = snapshot && !loading;
  const singleItemMode = Number.isInteger(selectedIndex);
  const selectedCardIdx = singleItemMode ? rowToCardIndex.get(selectedIndex) : null;
  const selectedCard = singleItemMode && Number.isInteger(selectedCardIdx) ? snapshot?.cards?.[selectedCardIdx] || null : null;
  const selectedValidationErrors = singleItemMode ? (Number.isInteger(selectedCardIdx) ? getValidationErrorsForCard(selectedCardIdx, values) : new Set()) : new Set();
  const activeValidationErrors = singleItemMode ? selectedValidationErrors : validationErrors;
  const addedCardCount = snapshot?.cards?.length || 0;
  const effectiveExpectedCount = mirrorFirstLineOnly ? 1 : expectedMirrorCardCount;
  const missingCardCount = Math.max(0, effectiveExpectedCount - addedCardCount);
  const parkingErrors = getValidationErrorsForParking(values);
  const nosposReloading = updatingCategoryCards.size > 0 || addingItem;

  const selectedRowBusy = singleItemMode && Number.isInteger(selectedCardIdx) && (
    addingItemIndex === selectedCardIdx || aiFillingCards.has(selectedCardIdx) ||
    applyingCards.has(selectedCardIdx) || updatingCategoryCards.has(selectedCardIdx)
  );
  const canDoneSelectedItem = singleItemMode && selectedCard && !busy && !selectedRowBusy && !applyInFlightRef.current && !selectedValidationErrors.size;
  const canProceed = !busy && !addingItem && !aiFillingCards.size && !applyingCards.size && !updatingCategoryCards.size && showForm && snapshot?.hasNext !== false && !parkingErrors.size && !missingCardCount;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-[130] flex h-[100dvh] min-h-[100svh] w-full flex-col" role="dialog" aria-modal="true" aria-labelledby="nospos-mirror-title">
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/30" onClick={() => { if (!busy) void handleDismiss(); }} aria-hidden="true" />

      <div className="cg-animate-modal-panel relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ui-card)]" onClick={(e) => e.stopPropagation()}>

        {/* Category AI blocking overlay */}
        {categoryAiBlocking && !nosposReloading && (
          <div className="absolute inset-0 z-[50] flex flex-col items-center justify-center gap-3 bg-white/92" role="status" aria-live="polite" aria-busy="true">
            <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
            <p className="text-base font-bold text-[var(--brand-blue)]">Calculating category with AI…</p>
            <p className="max-w-xs px-4 text-center text-xs text-[var(--text-muted)]">Choosing category levels — please wait</p>
          </div>
        )}

        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/15 bg-brand-blue px-5 py-4 text-white">
          <div className="min-w-0">
            <h2 id="nospos-mirror-title" className="text-xl font-bold leading-none tracking-tight">
              {singleItemMode ? 'NosPos item setup' : 'NosPos agreement — items'}
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-white/70 xl:max-w-5xl">
              {singleItemMode
                ? 'Add this item to NoSpos if needed, then finish its category and required fields using AI help or manual entry.'
                : mirrorFirstLineOnly
                  ? 'Only the first line is tested in NoSpos. Complete it below, then park the agreement. Other lines are shown for reference only.'
                  : 'Each negotiation item appears as its own row here. Expand a row and add it to NoSpos when you want that item created.'}
              {requestId != null ? ` Request ${requestId}.` : ''}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={() => void handleDismiss()} className="shrink-0 rounded-xl border border-white/20 p-2 text-white transition hover:bg-white/15 disabled:opacity-50" aria-label="Close">
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </header>

        {/* Scrollable body + overlays */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {nosposReloading && (
            <SpinnerOverlay
              className="bg-white/90 z-20"
              message={addingItem ? 'Adding item on NoSpos…' : 'Waiting for NoSpos to update…'}
              sub="NosPos is reloading the items page"
            />
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {showForm ? (
              <div className="px-4 py-4">
                {/* Banner */}
                {!singleItemMode && (missingCardCount > 0 || (touched && parkingErrors.size > 0)) && (
                  <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                    {touched && parkingErrors.size > 0
                      ? 'Some lines still have missing required fields — you can add the next line anyway; fix everything before Park on NoSpos.'
                      : mirrorFirstLineOnly
                        ? 'Add the first line to NoSpos from the row above, then finish required fields.'
                        : `Open the next item row and add it to NoSpos${missingCardCount > 1 ? ` (${missingCardCount} items still not added)` : ''}.`}
                  </div>
                )}
                {singleItemMode && !selectedCard && (
                  <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                    Add this line to NoSpos if needed, then finish the required fields before pressing OK.
                  </div>
                )}

                {/* Item rows */}
                {sourceLines.map((cardItem, rowIdx) => {
                  if (singleItemMode && rowIdx !== selectedIndex) return null;
                  const rowState = rowStateByIndex.get(rowIdx) || null;
                  const compactCardIdx = rowState?.cardIdx ?? rowToCardIndex.get(rowIdx);
                  const card = rowState?.card ?? (Number.isInteger(compactCardIdx) ? snapshot.cards?.[compactCardIdx] || null : null);
                  const { categoryFields, otherFields } = Number.isInteger(compactCardIdx)
                    ? (cardFieldPartitions[compactCardIdx] || { categoryFields: [], coreFields: [], otherFields: [] })
                    : { categoryFields: [], coreFields: [], otherFields: [] };

                  const isAdded = rowState?.isAdded ?? Boolean(card);
                  const isExpanded = expandedRows.has(rowIdx);
                  const rowBusy = Number.isInteger(compactCardIdx) && (addingItemIndex === compactCardIdx || aiFillingCards.has(compactCardIdx) || applyingCards.has(compactCardIdx) || updatingCategoryCards.has(compactCardIdx));
                  const canAddThisRow = showForm && !isAdded && rowIdx === nextRowToAdd && !(mirrorFirstLineOnly && rowIdx > 0) && !validationErrors.size && !busy && !addingItem && !aiFillingCards.size && !applyingCards.size && !updatingCategoryCards.size && !applyInFlightRef.current && snapshot?.hasNext !== false;

                  const reqCat = categoryFields.filter((f) => f.required);
                  const hasRequiredCategoryComplete = !reqCat.length || reqCat.every((f) => String(values[f.name] ?? '').trim());
                  const rowIsMarkedByCgSuite = Number.isInteger(compactCardIdx) && preexistingSyncedCards.has(compactCardIdx);
                  const rowHasMissingRequired = (card?.fields || []).some((f) => f?.required && f?.name && activeValidationErrors.has(f.name));

                  const statusTone = mirrorFirstLineOnly && !isAdded && rowIdx > 0 ? 'border-slate-300 bg-slate-100 text-slate-600'
                    : Number.isInteger(compactCardIdx) && addingItemIndex === compactCardIdx ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : isAdded ? 'border-green-300 bg-green-50 text-green-800'
                    : canAddThisRow ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-slate-300 bg-slate-100 text-slate-700';
                  const statusLabel = mirrorFirstLineOnly && !isAdded && rowIdx > 0 ? 'Not in test'
                    : Number.isInteger(compactCardIdx) && addingItemIndex === compactCardIdx ? 'Adding to NoSpos…'
                    : rowIsMarkedByCgSuite ? 'Synced from NoSpos'
                    : isAdded ? 'Added to NoSpos'
                    : canAddThisRow ? 'Ready to add'
                    : 'Waiting';

                  return (
                    <NosposAgreementMirrorItemSection
                      key={card?.cardId || cardItem?.id || `mirror-row-${rowIdx}`}
                      rowIdx={rowIdx}
                      cardItem={cardItem}
                      card={card}
                      compactCardIdx={compactCardIdx}
                      requiredCategoryFields={reqCat}
                      requiredOtherFields={otherFields.filter((f) => f.required)}
                      isAdded={isAdded}
                      isExpanded={isExpanded}
                      canAddThisRow={canAddThisRow}
                      rowBusy={rowBusy}
                      categoryReloading={Number.isInteger(compactCardIdx) && updatingCategoryCards.has(compactCardIdx)}
                      hasRequiredCategoryComplete={hasRequiredCategoryComplete}
                      rowTitle={getItemDisplayName(cardItem, card?.title || `Item ${rowIdx + 1}`)}
                      rowMeta={getItemDisplayMeta(cardItem)}
                      rowAttributesSummary={getItemAttributesSummary(cardItem)}
                      aiRunningForRow={Number.isInteger(compactCardIdx) && aiFillingCards.has(compactCardIdx)}
                      rowHasMissingRequired={rowHasMissingRequired}
                      statusTone={statusTone}
                      statusLabel={statusLabel}
                      addedCardCount={addedCardCount}
                      autoAddSelectedIfMissing={singleItemMode && autoAddSelectedIfMissing}
                      touched={touched}
                      activeValidationErrors={activeValidationErrors}
                      values={values}
                      notifyCategoryAiRunning={notifyCategoryAiRunning}
                      setAiFilledFieldKeys={setAiFilledFieldKeys}
                      aiFilledFieldKeys={aiFilledFieldKeys}
                      aiManualFallbackCards={aiManualFallbackCards}
                      getMirrorFieldControlId={getMirrorFieldControlId}
                      handleCategoryFieldChange={handleCategoryFieldChange}
                      handleFieldChange={handleFieldChange}
                      MirrorField={MirrorField}
                      nosposMappings={nosposMappings}
                      prefillStepVersion={prefillStepVersion}
                      onToggle={() => setExpandedRows((prev) => {
                        const next = new Set(prev);
                        next.has(rowIdx) ? next.delete(rowIdx) : next.add(rowIdx);
                        return next;
                      })}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-4 h-9 w-9 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
                <p className="text-sm font-bold text-[var(--brand-blue)]">
                  {waitExpired ? 'Items form not detected yet' : 'Waiting for NosPos items form…'}
                </p>
                <p className="mt-2 max-w-sm text-xs font-medium leading-relaxed text-[var(--text-muted)]">
                  {waitExpired
                    ? 'Restore the minimized NosPos window and complete earlier steps, or close and try Park / Open in NoSpos again.'
                    : 'Finish any NosPos steps before the items page; this panel fills in automatically.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Error bar */}
        {formError && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800">
            {formError}
          </div>
        )}

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-3">
          <button
            type="button" disabled={busy} onClick={() => void handleDismiss()}
            className="rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--text-main)] hover:bg-[var(--ui-bg)] disabled:opacity-50"
          >
            {singleItemMode ? 'Cancel' : 'Close'}
          </button>
          {singleItemMode ? (
            <button
              type="button" disabled={!canDoneSelectedItem} onClick={() => void handleDoneWithItem()}
              className="rounded-[var(--radius)] bg-brand-orange px-5 py-2.5 text-sm font-black uppercase tracking-wide text-brand-blue transition hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : selectedRowBusy ? 'Syncing…' : 'OK'}
            </button>
          ) : (
            <button
              type="button" disabled={!canProceed} onClick={handleNext}
              className="rounded-[var(--radius)] bg-brand-orange px-5 py-2.5 text-sm font-black uppercase tracking-wide text-brand-blue transition hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : addingItem ? 'Adding item…' : 'Park on NoSpos'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}