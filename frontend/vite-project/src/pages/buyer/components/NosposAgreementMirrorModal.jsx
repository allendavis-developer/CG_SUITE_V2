import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
} from '../nosposCategoryTree';
import { computeNosposMirrorPrefill, inferNosposMirrorFieldRole } from '../utils/nosposMirrorPrefill';
import {
  normalizeAiFieldResponseKeys,
  suggestNosposCategory,
  suggestFieldValues,
  shouldSkipAiFill,
} from '@/services/aiCategoryService';
import { SPREADSHEET_TABLE_STYLES } from '../spreadsheetTableStyles';

const NOSPOS_MIRROR_DEBUG =
  typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

function mirrorDebug(...args) {
  if (NOSPOS_MIRROR_DEBUG) console.debug(...args);
}

// ---------------------------------------------------------------------------
// Item summariser — builds the payload sent to the AI service
// ---------------------------------------------------------------------------

function summariseItemForAiPrompt(item) {
  if (!item) return { name: 'Unknown item', dbCategory: null, attributes: {} };

  const ref = item.referenceData || {};

  let name = item.isJewelleryItem
    ? (ref.item_name || ref.line_title || ref.reference_display_name || ref.product_name || item.variantName || item.title || 'Unknown item')
    : (item.variantName || item.title || ref.product_name || 'Unknown item');

  const dbCategory =
    item.categoryName || item.category || ref.category_label || ref.product_name || null;

  const attributes = {};
  const labels = item.attributeLabels || {};
  for (const [code, val] of Object.entries(item.attributeValues || {})) {
    if (val == null || String(val).trim() === '') continue;
    attributes[labels[code] || code] = String(val).trim();
  }
  if (item.isJewelleryItem) {
    for (const [k, v] of [
      ['Material grade', ref.material_grade],
      ['Product', ref.product_name],
      ['Stone', ref.stone],
      ['Finger size', ref.finger_size],
      ['Carat', ref.carat],
      ['Hallmark', ref.hallmark],
    ]) {
      if (v != null && String(v).trim() !== '') attributes[k] = String(v).trim();
    }
  }
  if (item.isCustomCeXItem) {
    const specs = item.cexProductData?.specifications;
    if (specs && typeof specs === 'object') {
      for (const [k, v] of Object.entries(specs)) {
        if (v != null && String(v).trim() !== '' && attributes[k] === undefined) {
          attributes[k] = String(v).trim();
        }
      }
    }
  }

  return { name: String(name).trim(), dbCategory, attributes };
}

function getSourceLineDisplayName(item, fallback = 'Item') {
  if (!item) return fallback;
  const ref = item.referenceData || {};
  const name = item.isJewelleryItem
    ? (ref.item_name || ref.line_title || ref.reference_display_name || ref.product_name)
    : (item.variantName || item.title || ref.product_name);
  return String(name || fallback).trim() || fallback;
}

function getSourceLineDisplayMeta(item) {
  if (!item) return '';
  const parts = [];
  const quantity = Math.max(1, Math.floor(Number(item.quantity)) || 1);
  if (quantity > 1) parts.push(`Qty ${quantity}`);
  const ref = item.referenceData || {};
  const category = item.categoryName || item.category || ref.category_label || null;
  if (category) parts.push(String(category).trim());
  return parts.join(' / ');
}

function getSourceLineAttributesSummary(item) {
  const summary = summariseItemForAiPrompt(item);
  const entries = Object.entries(summary.attributes || {})
    .filter(([k, v]) => String(k || '').trim() !== '' && String(v || '').trim() !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return entries.join(' | ');
}

// ---------------------------------------------------------------------------
// Option-value resolver
// ---------------------------------------------------------------------------

function resolveOptionValue(options, aiValue) {
  if (!options || options.length === 0 || !aiValue) return aiValue;
  const raw = String(aiValue).trim();
  const rawLower = raw.toLowerCase();
  for (const o of options) {
    if (String(o.value ?? '') === raw) return String(o.value);
  }
  for (const o of options) {
    if (String(o.text ?? '').trim() === raw) return String(o.value);
  }
  for (const o of options) {
    const tl = String(o.text ?? '').trim().toLowerCase();
    const vl = String(o.value ?? '').toLowerCase();
    if (tl === rawLower || vl === rawLower) return String(o.value);
  }
  return raw;
}

// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-3 py-2.5 text-sm text-[var(--text-main)] transition-colors focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]';
const inputErrorClass =
  'border-red-400 focus:border-red-500 focus:ring-red-500';

function getMirrorFieldControlId(field) {
  return `nospos-mirror-${String(field?.name || '').replace(/[^\w-]/g, '_')}`;
}

/** Advance focus to the next `[data-mirror-focusable]` within the nearest `[data-mirror-focus-chain]`. */
function mirrorFocusChainAdvance(current) {
  const root = current?.closest?.('[data-mirror-focus-chain]');
  if (!root) return;
  const nodes = Array.from(root.querySelectorAll('[data-mirror-focusable="true"]')).filter(
    (n) =>
      n instanceof HTMLElement &&
      !n.disabled &&
      n.getAttribute('aria-hidden') !== 'true' &&
      !n.closest('[hidden]')
  );
  const idx = nodes.indexOf(current);
  if (idx >= 0 && idx < nodes.length - 1) nodes[idx + 1].focus();
}

function mirrorFocusChainKeyDown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  mirrorFocusChainAdvance(e.currentTarget);
}

function isNosposMirrorCategoryField(f) {
  return /\[category\]/i.test(f.name || '') || String(f.label || '').toLowerCase() === 'category';
}

function isEmptyForValidation(field, raw) {
  const v = raw != null ? String(raw).trim() : '';
  return v === '';
}

function partitionCardFields(fields) {
  const categoryFields = [];
  const coreFields = [];
  const otherFields = [];
  for (const f of fields || []) {
    if (!f?.name) continue;
    if (isNosposMirrorCategoryField(f)) categoryFields.push(f);
    else {
      const role = inferNosposMirrorFieldRole(f);
      if (
        role === 'item_name' ||
        role === 'quantity' ||
        role === 'retail_price' ||
        role === 'offer' ||
        isNosposRateField(f) ||
        isNosposLocationField(f)
      ) {
        coreFields.push(f);
      } else {
        otherFields.push(f);
      }
    }
  }
  return { categoryFields, coreFields, otherFields };
}

function buildApplyFieldKey(name, cardIdx, cardId = null) {
  const locationKey = cardId || (Number.isInteger(cardIdx) ? `idx:${cardIdx}` : 'idx:unknown');
  return `${locationKey}\0${name || ''}`;
}

function buildCardFieldKey(cardIdx, name) {
  return `${Number.isInteger(cardIdx) ? cardIdx : 'idx:unknown'}\0${name || ''}`;
}

function isNosposRateField(field) {
  const n = String(field?.name || '').toLowerCase();
  const l = String(field?.label || '').toLowerCase();
  return /\[rate\]$/.test(n) || l === 'rate' || l.includes('rate');
}

function isNosposLocationField(field) {
  const n = String(field?.name || '').toLowerCase();
  const l = String(field?.label || '').toLowerCase();
  return /\[location\]$/.test(n) || l === 'location' || l.includes('location');
}

const CG_SYNC_MARKER_PREFIX = '[CG_SUITE_SYNCED:';

function isItemDescriptionField(field) {
  const n = String(field?.name || '').toLowerCase();
  const l = String(field?.label || '').toLowerCase();
  return /\[description\]$/.test(n) || l === 'item description';
}

function buildSourceItemSyncKey(item, cardIdx, requestId) {
  const reqPart = requestId != null && requestId !== '' ? String(requestId) : 'req-unknown';
  const itemPart =
    item?.request_item_id != null ? `rid-${item.request_item_id}`
      : item?.id != null ? `id-${item.id}`
      : item?.variantId != null ? `vid-${item.variantId}`
      : `idx-${cardIdx}`;
  return `${reqPart}:${itemPart}`;
}

function buildCgSyncMarkerForItem(item, cardIdx, requestId) {
  return `${CG_SYNC_MARKER_PREFIX}${buildSourceItemSyncKey(item, cardIdx, requestId)}]`;
}

function hasCgSyncMarkerForItem(value, item, cardIdx, requestId) {
  const marker = buildCgSyncMarkerForItem(item, cardIdx, requestId);
  return String(value || '').includes(marker);
}

function appendCgSyncMarker(value, item, cardIdx, requestId) {
  const s = value != null ? String(value) : '';
  const marker = buildCgSyncMarkerForItem(item, cardIdx, requestId);
  if (s.includes(marker)) return s;
  return s.trim() ? `${s} ${marker}` : marker;
}

function resolveItemDescriptionFieldForCard(card) {
  const fields = card?.fields || [];
  return fields.find((f) => f?.name && isItemDescriptionField(f)) || null;
}

function shallowEqualObject(a, b) {
  if (a === b) return true;
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// CategoryCascadeField — manual only, with "Prefill using AI" button
// ---------------------------------------------------------------------------

function CategoryCascadeField({
  field,
  tree,
  value,
  onChange,
  required,
  showError,
  item,
  firstSelectId,
  onAiFilled,
  onCategoryAiRunningChange,
}) {
  const [path, setPath] = useState([]);

  // { [levelIndex]: { status: 'loading'|'ready'|'error', suggestion: null|{...}, error: null|string } }
  const [, setAiSuggestions] = useState({});
  const [aiRunning, setAiRunning] = useState(false);
  const [categoryAiManualFallback, setCategoryAiManualFallback] = useState(false);

  const userTookOverRef = useRef(false);
  const autoCategoryPrefillAttemptedRef = useRef(false);
  const onAiFilledRef = useRef(onAiFilled);
  useEffect(() => {
    onAiFilledRef.current = onAiFilled;
  });

  const updateFromPathRef = useRef(null);

  const updateFromPath = useCallback(
    (newPath) => {
      setPath(newPath);
      let node = tree;
      for (const s of newPath) {
        node = node.children.get(s);
        if (!node) break;
      }
      if (node && node.children.size === 0 && node.leafValues.length === 1) {
        onChange(node.leafValues[0].value);
      } else {
        onChange('');
      }
    },
    [tree, onChange]
  );

  useEffect(() => {
    updateFromPathRef.current = updateFromPath;
  });

  useEffect(() => {
    if (!tree) return;
    const rawValue = value != null ? String(value) : '';
    if (!rawValue) {
      setPath((prev) => (prev.length ? [] : prev));
      return;
    }
    const resolvedPath = findPathForCategoryValue(tree, rawValue) || [];
    setPath((prev) => {
      if (
        resolvedPath.length === prev.length &&
        resolvedPath.every((seg, idx) => seg === prev[idx])
      ) {
        return prev;
      }
      return resolvedPath;
    });
  }, [tree, value]);

  /**
   * Recursively cascade through levels starting from `startPath`,
   * calling the AI for each level sequentially.
   */
  const runAiCascade = useCallback(async (startPath) => {
    onCategoryAiRunningChange?.(true);
    setAiRunning(true);
    setAiSuggestions({});
    setCategoryAiManualFallback(false);

    let currentPath = [...startPath];
    let node = tree;

    try {
      for (const seg of currentPath) {
        const next = node.children.get(seg);
        if (!next) return;
        node = next;
      }

      const itemSummary = summariseItemForAiPrompt(item);

      while (node.children.size > 0) {
        const levelIndex = currentPath.length;
        const availableOptions = [...node.children.keys()].sort((a, b) => a.localeCompare(b));

        setAiSuggestions((prev) => ({
          ...prev,
          [levelIndex]: { status: 'loading', suggestion: null, error: null },
        }));

        if (NOSPOS_MIRROR_DEBUG) {
          console.group(
            `%c[CG Suite] AI Category — Level ${levelIndex + 1} (sending list)`,
            'color:#1a56db;font-weight:bold'
          );
          console.log('Item         :', itemSummary.name, itemSummary.dbCategory ? `(${itemSummary.dbCategory})` : '');
          console.log('Path so far  :', currentPath.length ? currentPath.join(' > ') : '(top level)');
          console.log(`List sent    : [${availableOptions.length} options]`, availableOptions);
          console.groupEnd();
        }

        // eslint-disable-next-line no-await-in-loop
        const result = await suggestNosposCategory({
          item: itemSummary,
          levelIndex,
          availableOptions,
          previousPath: currentPath,
        });

        console.info(
          '[CG Suite] Category AI reasoning',
          {
            level: levelIndex + 1,
            selected: result.suggested,
            confidence: result.confidence,
            reasoning: result.reasoning || '',
          }
        );

        setAiSuggestions((prev) => ({
          ...prev,
          [levelIndex]: { status: 'ready', suggestion: result, error: null },
        }));

        const nextNode = node.children.get(result.suggested);
        if (!nextNode) break;

        currentPath = [...currentPath, result.suggested];
        node = nextNode;

        startTransition(() => {
          updateFromPathRef.current([...currentPath]);
        });
        onAiFilledRef.current?.();
      }
    } catch (err) {
      const levelIndex = currentPath.length;
      console.error(`[CG Suite] AI Category — Level ${levelIndex + 1} ERROR:`, err.message);
      setAiSuggestions((prev) => ({
        ...prev,
        [levelIndex]: { status: 'error', suggestion: null, error: err.message },
      }));
      setCategoryAiManualFallback(true);
    } finally {
      setAiRunning(false);
      onCategoryAiRunningChange?.(false);
    }
  }, [tree, item, onCategoryAiRunningChange]);

  const handlePrefillClick = useCallback(() => {
    userTookOverRef.current = false;
    setCategoryAiManualFallback(false);
    runAiCascade(path);
  }, [runAiCascade, path]);

  const categoryFullySelected = String(value ?? '').trim() !== '';

  useEffect(() => {
    if (!tree || tree.children.size === 0) return;
    if (categoryFullySelected) {
      autoCategoryPrefillAttemptedRef.current = true;
      return;
    }
    if (aiRunning || categoryAiManualFallback) return;
    if (autoCategoryPrefillAttemptedRef.current) return;
    autoCategoryPrefillAttemptedRef.current = true;
    handlePrefillClick();
  }, [tree, categoryFullySelected, aiRunning, categoryAiManualFallback, handlePrefillClick]);

  const levelBlocks = [];
  let node = tree;
  let depth = 0;
  const maxDepth = 24;

  while (node && depth < maxDepth) {
    const branchKeys = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    if (branchKeys.length > 0) {
      const capturedDepth = depth;
      const sel = path[capturedDepth] || '';
      levelBlocks.push(
        <div key={`row-${capturedDepth}`} className="flex min-w-0 max-w-full shrink-0 items-center gap-1.5">
          <select
            id={firstSelectId && levelBlocks.length === 0 ? firstSelectId : undefined}
            aria-label={`${field.label} — level ${capturedDepth + 1}`}
            required={required && capturedDepth === 0}
            data-mirror-focusable="true"
            onKeyDown={mirrorFocusChainKeyDown}
            className={`min-w-[10rem] max-w-[18rem] shrink-0 ${inputClass} ${showError ? inputErrorClass : ''}`}
            value={sel}
            onChange={(e) => {
              const seg = e.target.value;
              const next = path.slice(0, capturedDepth);
              if (seg) next.push(seg);
              userTookOverRef.current = true;
              setCategoryAiManualFallback(false);
              setAiSuggestions((prev) => {
                const cleaned = { ...prev };
                Object.keys(cleaned).forEach((k) => {
                  if (Number(k) >= capturedDepth) delete cleaned[k];
                });
                return cleaned;
              });
              updateFromPath(next);
            }}
          >
            <option value="">Select…</option>
            {branchKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

        </div>
      );
      if (!sel) break;
      node = node.children.get(sel);
      depth++;
      continue;
    }
    if (node.leafValues && node.leafValues.length > 1) {
      levelBlocks.push(
        <div key={`lf-${depth}`} className="flex min-w-0 shrink-0 items-center">
          <select
            id={firstSelectId && levelBlocks.length === 0 ? firstSelectId : undefined}
            aria-label={`${field.label} — variant`}
            required={required}
            data-mirror-focusable="true"
            onKeyDown={mirrorFocusChainKeyDown}
            className={`min-w-[10rem] max-w-[20rem] ${inputClass} ${showError ? inputErrorClass : ''}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select…</option>
            {node.leafValues.map((l) => (
              <option key={l.value} value={l.value}>
                {l.text}
              </option>
            ))}
          </select>
        </div>
      );
    }
    break;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Prefill button */}
      {tree && tree.children.size > 0 && !categoryFullySelected && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={aiRunning}
            onClick={handlePrefillClick}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] px-3 py-1.5 text-xs font-bold text-[var(--brand-blue)] transition hover:bg-[var(--brand-blue)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {aiRunning ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Calculating…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[14px] leading-none">auto_awesome</span>
                Prefill using AI
              </>
            )}
          </button>
          {aiRunning && (
            <span className="text-[10px] font-semibold text-[var(--text-muted)]">
              AI calculating category…
            </span>
          )}
        </div>
      )}
      {categoryAiManualFallback ? (
        <p className="text-xs font-medium text-amber-800">
          Category AI stopped early. Choose each level manually using the dropdowns — they stay fully editable.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{levelBlocks}</div>
    </div>
  );
}

function MirrorField({
  field,
  value,
  onChange,
  showError,
  item,
  layout = 'default',
  onAiFilled,
  onCategoryAiRunningChange,
}) {
  const id = getMirrorFieldControlId(field);
  const req = Boolean(field.required);
  const tableCell = layout === 'tableCell';

  const categoryTree = useMemo(() => {
    if (field.control !== 'select' || !isNosposMirrorCategoryField(field)) return null;
    return buildCategoryTree(field.options || []);
  }, [field.control, field.options, field.name]);

  if (field.control === 'select' && Array.isArray(field.options)) {
    const hierarchical =
      isNosposMirrorCategoryField(field) &&
      categoryTree &&
      categoryTree.children.size > 0 &&
      categoryOptionsAreHierarchical(field.options);
    if (hierarchical) {
      const cascade = (
        <CategoryCascadeField
          field={field}
          tree={categoryTree}
          value={value}
          onChange={onChange}
          required={req}
          showError={showError}
          item={item}
          firstSelectId={tableCell ? id : undefined}
          onAiFilled={onAiFilled}
          onCategoryAiRunningChange={onCategoryAiRunningChange}
        />
      );
      if (tableCell) {
        return (
          <div className="space-y-1">
            {cascade}
            {showError ? (
              <p className="text-xs font-semibold text-red-600">This field is required.</p>
            ) : null}
          </div>
        );
      }
      return (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
            {field.label}
            {req ? <span className="text-red-600"> *</span> : null}
          </label>
          {cascade}
          {showError ? (
            <p className="text-xs font-semibold text-red-600">This field is required.</p>
          ) : null}
        </div>
      );
    }

    const flatSelect = (
      <select
        id={id}
        required={req}
        data-mirror-focusable="true"
        onKeyDown={mirrorFocusChainKeyDown}
        className={`${inputClass} ${showError ? inputErrorClass : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.options || []).map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.text || o.value || '—'}
          </option>
        ))}
      </select>
    );

    if (tableCell) {
      return (
        <div className="space-y-1">
          {flatSelect}
          {showError ? (
            <p className="text-xs font-semibold text-red-600">This field is required.</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
          {field.label}
          {req ? <span className="text-red-600"> *</span> : null}
        </label>
        {flatSelect}
        {showError ? (
          <p className="text-xs font-semibold text-red-600">This field is required.</p>
        ) : null}
      </div>
    );
  }

  const inputType =
    field.inputType === 'number' || field.inputType === 'email' || field.inputType === 'tel'
      ? field.inputType
      : 'text';

  const textInput = (
    <input
      id={id}
      type={inputType}
      required={req}
      data-mirror-focusable="true"
      onKeyDown={mirrorFocusChainKeyDown}
      className={`${inputClass} ${showError ? inputErrorClass : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  );

  if (tableCell) {
    return (
      <div className="space-y-1">
        {textInput}
        {showError ? (
          <p className="text-xs font-semibold text-red-600">This field is required.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
        {field.label}
        {req ? <span className="text-red-600"> *</span> : null}
      </label>
      {textInput}
      {showError ? (
        <p className="text-xs font-semibold text-red-600">This field is required.</p>
      ) : null}
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
  /** When true (in-store testing), only one NoSpos item card is required; other lines are display-only. */
  mirrorFirstLineOnly = false,
  selectedIndex = null,
  autoAddSelectedIfMissing = false,
  onClose,
}) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [touched, setTouched] = useState(false);
  const [aiFillingCards, setAiFillingCards] = useState(new Set());
  const [applyingCards, setApplyingCards] = useState(new Set());
  const [updatingCategoryCards, setUpdatingCategoryCards] = useState(new Set());
  const [addingItem, setAddingItem] = useState(false);
  const [addingItemIndex, setAddingItemIndex] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [preexistingSyncedCards, setPreexistingSyncedCards] = useState(new Set());
  const [aiFilledFieldKeys, setAiFilledFieldKeys] = useState(new Set());
  /** Card indices that completed the first “attribute prefill” button press (enables AI pass label). */
  const attrPrefillStepDoneRef = useRef(new Set());
  const [prefillStepVersion, setPrefillStepVersion] = useState(0);
  /** Cards where AI failed or returned nothing useful — show manual fallback hint. */
  const [aiManualFallbackCards, setAiManualFallbackCards] = useState(new Set());
  const userOverriddenFieldsRef = useRef(new Set());
  const preservedFieldValuesRef = useRef(new Set());
  const prevOpenRef = useRef(false);
  const preexistingSyncScannedRef = useRef(false);

  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; });
  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = snapshot; });
  const pendingFieldApplyRef = useRef(new Map());
  const applyFlushTimerRef = useRef(null);
  const applyInFlightRef = useRef(false);
  const applyNeedsAnotherPassRef = useRef(false);
  const markerApplyQueuedRef = useRef(new Set());
  const autoAddAttemptedRef = useRef(new Set());
  const autoAiRequestedRef = useRef(new Set());
  const categoryAiRunDepthRef = useRef(0);
  const [categoryAiBlocking, setCategoryAiBlocking] = useState(false);

  const notifyCategoryAiRunning = useCallback((running) => {
    if (running) {
      categoryAiRunDepthRef.current += 1;
    } else {
      categoryAiRunDepthRef.current = Math.max(0, categoryAiRunDepthRef.current - 1);
    }
    setCategoryAiBlocking(categoryAiRunDepthRef.current > 0);
  }, []);

  const attributePrefill = useMemo(
    () => computeNosposMirrorPrefill(snapshot, sourceLines, useVoucherOffers),
    [snapshot, sourceLines, useVoucherOffers]
  );

  useEffect(() => {
    if (!open || !snapshot) return;
    if (preexistingSyncScannedRef.current) return;
    const marked = new Set();
    (snapshot.cards || []).forEach((card, idx) => {
      const sourceItem = sourceLines?.[idx] || null;
      const descriptionField = resolveItemDescriptionFieldForCard(card);
      if (!descriptionField) return;
      if (hasCgSyncMarkerForItem(descriptionField.value, sourceItem, idx, requestId)) {
        marked.add(idx);
      }
    });
    preexistingSyncScannedRef.current = true;
    setPreexistingSyncedCards(marked);
    mirrorDebug('[CG Suite] Initial sync scan complete', { markedCards: [...marked] });
  }, [open, snapshot, sourceLines, requestId]);

  useEffect(() => {
    if (!open || !snapshot) return;
    if (!preexistingSyncScannedRef.current) return;
    if (busy || addingItem) return;
    const fieldsToMark = [];
    for (let cardIdx = 0; cardIdx < (snapshot.cards || []).length; cardIdx++) {
      const card = snapshot.cards[cardIdx];
      const sourceItem = sourceLines?.[cardIdx] || null;
      const descriptionField = resolveItemDescriptionFieldForCard(card);
      if (!descriptionField?.name) continue;
      if (hasCgSyncMarkerForItem(descriptionField.value, sourceItem, cardIdx, requestId)) continue;
      const markerValue = appendCgSyncMarker(descriptionField.value, sourceItem, cardIdx, requestId);
      const queueKey = `${snapshot.pageInstanceId || 'page:unknown'}::${card.cardId || `idx:${cardIdx}`}::${markerValue}`;
      if (markerApplyQueuedRef.current.has(queueKey)) continue;
      markerApplyQueuedRef.current.add(queueKey);
      fieldsToMark.push({
        name: descriptionField.name,
        value: markerValue,
        cardIndex: cardIdx,
        cardId: card.cardId || null,
      });
    }
    if (fieldsToMark.length === 0) return;
    mirrorDebug('[CG Suite] Auto-applying CG sync marker to item description', fieldsToMark);
    void nosposAgreementApplyFields(fieldsToMark)
      .then((r) => {
        mirrorDebug('[CG Suite] Auto-marker apply response', r);
      })
      .catch((e) => {
        console.error('[CG Suite] Auto-marker apply failed', e?.message || e);
      });
  }, [open, snapshot, sourceLines, requestId, busy, addingItem]);

  // -------------------------------------------------------------------------
  // Stable flush implementation stored in a ref — breaks the useCallback
  // dependency cycle that was causing cascading re-renders and lag.
  // -------------------------------------------------------------------------
  const flushQueuedFieldAppliesRef = useRef(null);

  // Wire the real implementation into the ref after every render so it always
  // closes over the freshest state/refs, but the function identity is stable.
  useEffect(() => {
    flushQueuedFieldAppliesRef.current = async function _flush() {
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
      if (applyInFlightRef.current) {
        applyNeedsAnotherPassRef.current = true;
        return;
      }

      const pendingEntries = [...pendingFieldApplyRef.current.values()];
      if (pendingEntries.length === 0) return;

      applyInFlightRef.current = true;
      applyNeedsAnotherPassRef.current = false;
      pendingFieldApplyRef.current = new Map();

      const currentCards = snapshotRef.current?.cards || [];
      const currentSnapshotByKey = new Map();
      for (let cardIdx = 0; cardIdx < currentCards.length; cardIdx++) {
        const card = currentCards[cardIdx];
        for (const f of card.fields || []) {
          if (!f?.name) continue;
          currentSnapshotByKey.set(
            buildApplyFieldKey(f.name, cardIdx, card.cardId || null),
            f.value != null ? String(f.value) : ''
          );
        }
      }

      let fields = pendingEntries.filter((f) => {
        const fieldKey = buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null);
        return (currentSnapshotByKey.get(fieldKey) ?? '') !== f.value;
      });

      const cardIdxs = [...new Set(
        fields.map((f) => f.cardIndex).filter((idx) => Number.isInteger(idx))
      )];

      if (fields.length === 0) {
        applyInFlightRef.current = false;
        if (applyNeedsAnotherPassRef.current || pendingFieldApplyRef.current.size > 0) {
          void flushQueuedFieldAppliesRef.current();
        }
        return;
      }

      if (cardIdxs.length > 0) {
        setApplyingCards((prev) => new Set([...prev, ...cardIdxs]));
      }

      try {
        let pendingFields = [...fields];
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (pendingFields.length === 0) break;
          const r1 = await nosposAgreementApplyFields(pendingFields);
          if (!r1?.ok && !Array.isArray(r1?.missing) && !Array.isArray(r1?.failed)) {
            throw new Error(r1?.error || 'Could not update the NosPos form. Is the agreement tab still open?');
          }
          const missing = Array.isArray(r1?.missing) ? r1.missing : [];
          const failed = Array.isArray(r1?.failed) ? r1.failed : [];
          const retryKeys = new Set(
            [...missing, ...failed]
              .map((entry) => buildApplyFieldKey(entry?.name, entry?.cardIndex, entry?.cardId || null))
              .filter((key) => key !== buildApplyFieldKey('', null, null))
          );
          if (retryKeys.size === 0) { pendingFields = []; break; }
          pendingFields = pendingFields.filter((f) =>
            retryKeys.has(buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null))
          );
          if (pendingFields.length > 0) await new Promise((r) => setTimeout(r, 80));
        }
        if (pendingFields.length > 0) {
          // Final false-positive guard: if snapshot now reflects desired values, treat as success.
          const latestCards = snapshotRef.current?.cards || [];
          const latestByKey = new Map();
          for (let cardIdx = 0; cardIdx < latestCards.length; cardIdx++) {
            const card = latestCards[cardIdx];
            for (const f of card.fields || []) {
              if (!f?.name) continue;
              latestByKey.set(
                buildApplyFieldKey(f.name, cardIdx, card.cardId || null),
                f.value != null ? String(f.value) : ''
              );
            }
          }
          pendingFields = pendingFields.filter((f) => {
            const key = buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null);
            const nowValue = latestByKey.get(key) ?? '';
            return nowValue !== f.value;
          });
        }
        if (pendingFields.length > 0) {
          const names = pendingFields.slice(0, 5).map((f) => f.name).join(', ');
          const more = pendingFields.length > 5 ? ', ...' : '';
          throw new Error(`Could not copy all fields to NosPos (${pendingFields.length} field(s) still failing): ${names}${more}`);
        }
        setFormError(null);
      } catch (err) {
        setFormError(err?.message || 'Could not update the NosPos form.');
      } finally {
        applyInFlightRef.current = false;
        if (cardIdxs.length > 0) {
          setApplyingCards((prev) => {
            const next = new Set(prev);
            cardIdxs.forEach((idx) => next.delete(idx));
            return next;
          });
        }
        if (applyNeedsAnotherPassRef.current || pendingFieldApplyRef.current.size > 0) {
          void flushQueuedFieldAppliesRef.current();
        }
      }
    };
  }); // intentionally no deps — runs after every render

  // Stable public surface — never recreated, just delegates to the ref
  const flushQueuedFieldApplies = useCallback(
    () => flushQueuedFieldAppliesRef.current?.(),
    []
  );

  // Stable — only uses refs, no state deps
  const queueFieldApply = useCallback((name, value, cardIdx, cardId = null) => {
    if (!name) return;
    const normalized = {
      name,
      value: value != null ? String(value) : '',
      cardIndex: Number.isInteger(cardIdx) ? cardIdx : null,
      cardId: cardId || null,
    };
    pendingFieldApplyRef.current.set(
      buildApplyFieldKey(normalized.name, normalized.cardIndex, normalized.cardId),
      normalized
    );
    if (applyFlushTimerRef.current) clearTimeout(applyFlushTimerRef.current);
    applyFlushTimerRef.current = setTimeout(() => {
      applyFlushTimerRef.current = null;
      void flushQueuedFieldAppliesRef.current?.();
    }, 120);
  }, []); // stable

  useLayoutEffect(() => {
    if (open && !prevOpenRef.current) {
      userOverriddenFieldsRef.current = new Set();
      preservedFieldValuesRef.current = new Set();
      markerApplyQueuedRef.current = new Set();
      autoAddAttemptedRef.current = new Set();
      autoAiRequestedRef.current = new Set();
      categoryAiRunDepthRef.current = 0;
      setCategoryAiBlocking(false);
      preexistingSyncScannedRef.current = false;
      setPreexistingSyncedCards(new Set());
      setAiFilledFieldKeys(new Set());
      pendingFieldApplyRef.current = new Map();
      applyNeedsAnotherPassRef.current = false;
      applyInFlightRef.current = false;
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
      setApplyingCards(new Set());
      setUpdatingCategoryCards(new Set());
      setAddingItem(false);
      setAddingItemIndex(null);
      setTouched(false);
      attrPrefillStepDoneRef.current = new Set();
      setPrefillStepVersion(0);
      setAiManualFallbackCards(new Set());
      const defaultExpandIdx =
        mirrorFirstLineOnly && !Number.isInteger(selectedIndex)
          ? 0
          : Number.isInteger(selectedIndex)
            ? selectedIndex
            : Math.min(snapshot?.cards?.length || 0, (sourceLines?.length || 1) - 1);
      setExpandedRows(
        new Set((sourceLines?.length || 0) > 0 ? [defaultExpandIdx] : [])
      );
    }
    prevOpenRef.current = open;
  }, [open, snapshot, sourceLines, selectedIndex, mirrorFirstLineOnly]);

  useLayoutEffect(() => {
    if (!open || !snapshot) return;
    const names = new Set();
    for (const card of snapshot.cards || []) {
      for (const f of card.fields || []) {
        if (f?.name) names.add(f.name);
      }
    }
    for (const k of [...userOverriddenFieldsRef.current]) {
      if (!names.has(k)) userOverriddenFieldsRef.current.delete(k);
    }
    for (const k of [...preservedFieldValuesRef.current]) {
      if (!names.has(k)) preservedFieldValuesRef.current.delete(k);
    }

    const base = {};
    const autoApplyCoreFields = [];
    for (let cardIdx = 0; cardIdx < (snapshot.cards || []).length; cardIdx++) {
      const card = snapshot.cards[cardIdx];
      const cardMarked = preexistingSyncedCards.has(cardIdx);
      for (const f of card.fields || []) {
        if (!f?.name) continue;
        if (cardMarked) {
          base[f.name] = f.value != null ? String(f.value) : '';
          continue;
        }
        const role = inferNosposMirrorFieldRole(f);
        const prefillValue = attributePrefill[f.name];
        const currentNosposValue = f.value != null ? String(f.value) : '';
        if (
          (role === 'item_name' || role === 'quantity' || role === 'retail_price' || role === 'offer') &&
          prefillValue != null &&
          String(prefillValue).trim() !== ''
        ) {
          const normalizedPrefill = String(prefillValue);
          base[f.name] = normalizedPrefill;
          if (!userOverriddenFieldsRef.current.has(f.name)) {
            const currentNosposValue = f.value != null ? String(f.value) : '';
            if (currentNosposValue !== normalizedPrefill) {
              autoApplyCoreFields.push({
                name: f.name,
                value: normalizedPrefill,
                cardIndex: cardIdx,
                cardId: card.cardId || null,
              });
            }
          }
          continue;
        }
        if (isNosposRateField(f) || isNosposLocationField(f)) {
          base[f.name] = currentNosposValue;
          continue;
        }
        base[f.name] = '';
      }
    }
    mirrorDebug('[CG Suite] Base field init', {
      fieldCount: Object.keys(base).length,
      markedCards: [...preexistingSyncedCards],
      sample: Object.entries(base).slice(0, 15),
    });
    setValues((prev) => {
      const next = { ...base };
      for (const k of preservedFieldValuesRef.current) {
        if (names.has(k) && prev[k] !== undefined) next[k] = prev[k];
      }
      return shallowEqualObject(prev, next) ? prev : next;
    });
    if (autoApplyCoreFields.length > 0) {
      mirrorDebug('[CG Suite] Auto-syncing core prefill fields to NoSpos', autoApplyCoreFields);
      for (const field of autoApplyCoreFields) {
        preservedFieldValuesRef.current.add(field.name);
        queueFieldApply(field.name, field.value, field.cardIndex, field.cardId);
      }
    }
    setFormError(null);
  }, [open, snapshot, attributePrefill, preexistingSyncedCards, queueFieldApply]);

  const waitForSnapshotReload = useCallback((previousPageInstanceId, options = {}) => {
    const { minCardCount = 0, timeoutMs = 15000, actionLabel = 'NoSpos' } = options;
    const startingSnapshot = snapshotRef.current;
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      function check() {
        const nextSnapshot = snapshotRef.current;
        const nextCardCount = nextSnapshot?.cards?.length || 0;
        const nextPageInstanceId = nextSnapshot?.pageInstanceId || null;
        const pageReloaded = previousPageInstanceId
          ? nextPageInstanceId != null && nextPageInstanceId !== previousPageInstanceId
          : nextSnapshot != null && nextSnapshot !== startingSnapshot;
        if (pageReloaded && nextCardCount >= minCardCount) {
          resolve(nextSnapshot);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`${actionLabel} triggered a NoSpos reload, but the refreshed items page did not come back in time.`));
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }, []);

  const handleCategoryFieldChange = useCallback((name, cardIdx, cardId) => {
    return (v) => {
      userOverriddenFieldsRef.current.add(name);
      preservedFieldValuesRef.current.add(name);
      const str = v != null ? String(v) : '';
      mirrorDebug('[CG Suite] Category changed', { cardIdx, cardId, name, value: str });
      setValues((prev) => ({ ...prev, [name]: str }));
      if (str.trim() === '') return;
      void (async () => {
        try {
          setFormError(null);
          setUpdatingCategoryCards((prev) => new Set([...prev, cardIdx]));
          const currentPageInstanceId = snapshotRef.current?.pageInstanceId || null;
          const r = await nosposAgreementApplyFields([{
            name,
            value: str,
            cardIndex: cardIdx,
            cardId: cardId || null,
          }]);
          mirrorDebug('[CG Suite] Category apply response', { cardIdx, cardId, name, value: str, response: r });
          if (!r?.ok) {
            setFormError(
              r?.error ||
                'Could not update category on NosPos. Check the agreement tab is still open.'
            );
          } else {
            await waitForSnapshotReload(currentPageInstanceId, {
              minCardCount: snapshotRef.current?.cards?.length || 0,
              actionLabel: 'Updating the category',
            });
          }
        } catch (e) {
          setFormError(e?.message || 'Could not update category on NosPos.');
        } finally {
          setUpdatingCategoryCards((prev) => {
            const next = new Set(prev);
            next.delete(cardIdx);
            return next;
          });
        }
      })();
    };
  }, [waitForSnapshotReload]);

  const allFields = useMemo(() => {
    if (!snapshot) return [];
    const list = [];
    for (const card of snapshot.cards || []) {
      for (const f of card.fields || []) {
        if (f?.name) list.push(f);
      }
    }
    return list;
  }, [snapshot]);

  const validationErrors = useMemo(() => {
    const errs = new Set();
    for (const f of allFields) {
      if (!f.required) continue;
      const localValue = values[f.name];
      const localIsEmpty = isEmptyForValidation(f, localValue);
      const wasUserOverridden = userOverriddenFieldsRef.current.has(f.name);
      const effectiveValue =
        !localIsEmpty || wasUserOverridden
          ? localValue
          : (f.value != null ? String(f.value) : '');
      if (isEmptyForValidation(f, effectiveValue)) errs.add(f.name);
    }
    return errs;
  }, [allFields, values]);

  const getValidationErrorsForValues = useCallback((candidateValues) => {
    const errs = new Set();
    for (const f of allFields) {
      if (!f.required) continue;
      const localValue = candidateValues?.[f.name];
      const localIsEmpty = isEmptyForValidation(f, localValue);
      const wasUserOverridden = userOverriddenFieldsRef.current.has(f.name);
      const effectiveValue =
        !localIsEmpty || wasUserOverridden
          ? localValue
          : (f.value != null ? String(f.value) : '');
      if (isEmptyForValidation(f, effectiveValue)) errs.add(f.name);
    }
    return errs;
  }, [allFields]);

  const getValidationErrorsForCard = useCallback((cardIdx, candidateValues) => {
    const errs = new Set();
    const card = snapshot?.cards?.[cardIdx];
    if (!card) return errs;
    for (const f of card.fields || []) {
      if (!f?.required || !f?.name) continue;
      const localValue = candidateValues?.[f.name];
      const localIsEmpty = isEmptyForValidation(f, localValue);
      const wasUserOverridden = userOverriddenFieldsRef.current.has(f.name);
      const effectiveValue =
        !localIsEmpty || wasUserOverridden
          ? localValue
          : (f.value != null ? String(f.value) : '');
      if (isEmptyForValidation(f, effectiveValue)) errs.add(f.name);
    }
    return errs;
  }, [snapshot]);

  const handleFieldChange = useCallback((name, cardIdx, cardId) => {
    return (v) => {
      userOverriddenFieldsRef.current.add(name);
      preservedFieldValuesRef.current.add(name);
      const str = v != null ? String(v) : '';
      mirrorDebug('[CG Suite] Field changed', { cardIdx, cardId, name, value: str });
      setValues((prev) => ({ ...prev, [name]: str }));
      queueFieldApply(name, str, cardIdx, cardId || null);
    };
  }, [queueFieldApply]);

  const waitForSnapshotCardCount = useCallback((targetCount, timeoutMs = 12000) => {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      function check() {
        const count = snapshotRef.current?.cards?.length || 0;
        if (count >= targetCount) {
          resolve(snapshotRef.current);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error('NoSpos did not add the next item card in time.'));
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }, []);

  const handleApplyAttributePrefillForCard = useCallback((cardIdx) => {
    const card = snapshotRef.current?.cards?.[cardIdx];
    if (!card) return;
    const { otherFields } = partitionCardFields(card.fields);
    const toApply = [];
    const skipped = [];
    for (const field of otherFields) {
      if (!field?.name) continue;
      if (userOverriddenFieldsRef.current.has(field.name)) {
        skipped.push({ name: field.name, reason: 'user_overridden' });
        continue;
      }
      const prefillValue = attributePrefill[field.name];
      if (prefillValue == null || String(prefillValue).trim() === '') {
        skipped.push({ name: field.name, reason: 'no_attribute_prefill_match' });
        continue;
      }
      const options = Array.isArray(field.options) ? field.options : [];
      if (field.control === 'select' && options.length === 0) {
        skipped.push({ name: field.name, reason: 'select_options_not_ready' });
        continue;
      }
      const resolved = resolveOptionValue(options, String(prefillValue));
      // Select-style fields must map to a real option value before we try applying to NoSpos.
      if (options.length > 0) {
        const hasResolvedOption = options.some((o) => String(o.value ?? '') === String(resolved ?? ''));
        if (!hasResolvedOption) {
          skipped.push({ name: field.name, reason: 'prefill_not_in_options', requested: String(prefillValue) });
          continue;
        }
      }
      if (resolved == null || String(resolved).trim() === '') {
        skipped.push({ name: field.name, reason: 'resolved_empty' });
        continue;
      }
      toApply.push({ name: field.name, value: String(resolved) });
    }
    if (NOSPOS_MIRROR_DEBUG) {
      console.group('[CG Suite] Apply attribute prefill');
      console.log('Card idx:', cardIdx);
      console.log('Card title:', card.title || `Card ${cardIdx + 1}`);
      console.log('Applying fields:', toApply);
      console.log('Skipped fields:', skipped);
      console.groupEnd();
    }
    if (toApply.length === 0) {
      return;
    }
    setValues((prev) => {
      const next = { ...prev };
      for (const { name, value } of toApply) next[name] = value;
      return next;
    });
    for (const { name, value } of toApply) {
      preservedFieldValuesRef.current.add(name);
      queueFieldApply(name, value, cardIdx, card.cardId || null);
    }
    setFormError(null);
  }, [attributePrefill, queueFieldApply]);

  const handleAiFillForCard = useCallback((cardIdx) => {
    const card = snapshotRef.current?.cards?.[cardIdx];
    if (!card) return;
    const cardItem = sourceLines?.[cardIdx] ?? null;
    if (!cardItem) return;

    setAiManualFallbackCards((prev) => {
      const next = new Set(prev);
      next.delete(cardIdx);
      return next;
    });

    const { otherFields } = partitionCardFields(card.fields);
    const aiSkipped = [];
    const fieldsForAi = otherFields.filter((f) => {
      if (!f?.name || !f.required) return false;
      const currentVal = valuesRef.current?.[f.name];
      const isRequired = Boolean(f.required);
      const isCurrentlyEmpty = currentVal == null || String(currentVal).trim() === '';
      const userOverridden = userOverriddenFieldsRef.current.has(f.name);
      const hasAttrPrefill = attributePrefill[f.name] != null && String(attributePrefill[f.name]).trim() !== '';

      // Required and empty always gets sent to AI, even if manually touched or usually skipped.
      if (isRequired && isCurrentlyEmpty) return true;

      if (userOverridden) {
        aiSkipped.push({ name: f.name, reason: 'user_overridden' });
        return false;
      }
      if (shouldSkipAiFill(f)) {
        aiSkipped.push({ name: f.name, reason: 'skip_rule' });
        return false;
      }
      if (hasAttrPrefill) {
        aiSkipped.push({ name: f.name, reason: 'handled_by_attribute_prefill' });
        return false;
      }
      if (!isCurrentlyEmpty) {
        aiSkipped.push({ name: f.name, reason: 'already_has_value' });
        return false;
      }
      return true;
    });
    if (NOSPOS_MIRROR_DEBUG) {
      console.group('[CG Suite] Fill out using AI');
      console.log('Card idx:', cardIdx);
      console.log('Card title:', card.title || `Card ${cardIdx + 1}`);
      console.log('Fields sent to AI:', fieldsForAi.map((f) => ({ name: f.name, label: f.label || '' })));
      console.log('Fields skipped:', aiSkipped);
      console.groupEnd();
    }
    if (fieldsForAi.length === 0) {
      setFormError(
        'Nothing left for AI to suggest for required fields on this item. Fill any empty required fields manually.'
      );
      setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
      return;
    }

    const fieldOptionsMap = Object.fromEntries(
      fieldsForAi.map((f) => [f.name, f.options || []])
    );
    const itemSummary = summariseItemForAiPrompt(cardItem);
    setAiFillingCards((prev) => new Set([...prev, cardIdx]));

    suggestFieldValues({
      item: itemSummary,
      fields: fieldsForAi.map((f) => ({
        name: f.name,
        label: f.label || '',
        control: f.control || 'text',
        options: (f.options || []).map((o) => ({
          value: String(o.value ?? ''),
          text: String(o.text ?? o.value ?? ''),
        })),
      })),
    })
      .then((result) => {
        const normalizedFields = normalizeAiFieldResponseKeys(result.fields, fieldsForAi);
        const toApply = {};
        for (const [fieldName, aiRaw] of Object.entries(normalizedFields)) {
          if (userOverriddenFieldsRef.current.has(fieldName)) continue;
          if (aiRaw == null || String(aiRaw).trim() === '') continue;
          const opts = fieldOptionsMap[fieldName] || [];
          const resolved = resolveOptionValue(opts, String(aiRaw));
          if (!resolved || String(resolved).trim() === '') continue;
          toApply[fieldName] = String(resolved);
        }
        if (NOSPOS_MIRROR_DEBUG) {
          console.group('[CG Suite] AI response');
          console.log('Card idx:', cardIdx);
          console.log('Raw response:', result);
          console.log('Normalized response:', normalizedFields);
          console.log('Applying AI fields:', toApply);
          console.groupEnd();
        }
        if (Object.keys(toApply).length > 0) {
          setValues((prev) => {
            const next = { ...prev };
            for (const [fieldName, resolved] of Object.entries(toApply)) {
              next[fieldName] = resolved;
            }
            return next;
          });
          setAiFilledFieldKeys((prev) => {
            const next = new Set(prev);
            for (const fieldName of Object.keys(toApply)) {
              next.add(buildCardFieldKey(cardIdx, fieldName));
            }
            return next;
          });
          for (const [fieldName, resolved] of Object.entries(toApply)) {
            preservedFieldValuesRef.current.add(fieldName);
            queueFieldApply(fieldName, resolved, cardIdx, card.cardId || null);
          }
          setFormError(null);
        } else if (fieldsForAi.length > 0) {
          setFormError(
            'AI did not return usable values for the empty fields. Please complete them manually — all fields below stay editable.'
          );
          setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
        }
      })
      .catch((err) => {
        console.error('[CG Suite] AI fill failed', { cardIdx, error: err?.message });
        setFormError(
          `${err?.message || 'AI fill failed.'} You can fill every field manually below; nothing is locked.`
        );
        setAiManualFallbackCards((prev) => new Set([...prev, cardIdx]));
      })
      .finally(() => {
        setAiFillingCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
      });
  }, [queueFieldApply, sourceLines]);

  const handleAddItem = useCallback(async (cardIdx) => {
    if (!snapshot || busy || addingItem) return;
    if (mirrorFirstLineOnly && cardIdx > 0) {
      setFormError('Only the first line is used in this testing flow.');
      return;
    }
    const currentCount = snapshot.cards?.length || 0;
    if (cardIdx !== currentCount) {
      setFormError('Add items to NoSpos in order from top to bottom.');
      return;
    }
    if (validationErrors.size > 0) {
      setTouched(true);
      setFormError('Fill the highlighted required NoSpos fields before adding the next item.');
      for (let i = 0; i < (snapshot.cards?.length || 0); i++) {
        const c = snapshot.cards[i];
        if (!c) continue;
        const hasErr = (c.fields || []).some((f) => f?.name && validationErrors.has(f.name));
        if (hasErr) {
          setExpandedRows((prev) => new Set([...prev, i]));
          break;
        }
      }
      return;
    }

    setAddingItem(true);
    setAddingItemIndex(cardIdx);
    setFormError(null);
    void (async () => {
      try {
        await flushQueuedFieldApplies();
        const currentPageInstanceId = snapshotRef.current?.pageInstanceId || null;
        const addResult = await nosposAgreementAddItem();
        if (!addResult?.ok) {
          throw new Error(addResult?.error || 'Could not add the next NoSpos item.');
        }
        await waitForSnapshotReload(currentPageInstanceId, {
          minCardCount: currentCount + 1,
          actionLabel: 'Adding the next item',
        });
        const reloadedSnapshot = await waitForSnapshotCardCount(currentCount + 1);
        const newCard = reloadedSnapshot?.cards?.[cardIdx];
        const markerField = resolveItemDescriptionFieldForCard(newCard);
        const sourceItem = sourceLines?.[cardIdx] || null;
        if (markerField?.name) {
          const markerValue = appendCgSyncMarker(markerField.value, sourceItem, cardIdx, requestId);
          mirrorDebug('[CG Suite] Marking NoSpos card as synced', {
            cardIdx,
            cardId: newCard?.cardId || null,
            markerField: markerField.name,
            markerValue,
          });
          const markerResult = await nosposAgreementApplyFields([{
            name: markerField.name,
            value: markerValue,
            cardIndex: cardIdx,
            cardId: newCard?.cardId || null,
          }]);
          mirrorDebug('[CG Suite] Marker apply response', markerResult);
        } else {
          console.warn('[CG Suite] Could not find item description field for CG sync marker', { cardIdx });
        }
      } catch (err) {
        setFormError(err?.message || 'Could not add the next NoSpos item.');
      } finally {
        setAddingItem(false);
        setAddingItemIndex(null);
      }
    })();
  }, [
    snapshot,
    busy,
    addingItem,
    validationErrors,
    flushQueuedFieldApplies,
    waitForSnapshotReload,
    waitForSnapshotCardCount,
    sourceLines,
    requestId,
    mirrorFirstLineOnly,
  ]);

  useEffect(() => {
    if (!open || !autoAddSelectedIfMissing) return;
    if (!Number.isInteger(selectedIndex)) return;
    if (busy || addingItem) return;
    const alreadyAdded = Boolean(snapshot?.cards?.[selectedIndex]);
    if (alreadyAdded) return;
    const autoAddKey = `${snapshot?.pageInstanceId || 'page:unknown'}:${selectedIndex}`;
    if (autoAddAttemptedRef.current.has(autoAddKey)) return;
    autoAddAttemptedRef.current.add(autoAddKey);
    handleAddItem(selectedIndex);
  }, [
    open,
    autoAddSelectedIfMissing,
    selectedIndex,
    busy,
    addingItem,
    snapshot,
    handleAddItem,
  ]);

  const handleDismiss = useCallback(async () => {
    if (busy) return;
    try {
      await flushQueuedFieldApplies();
    } finally {
      onClose?.();
    }
  }, [busy, flushQueuedFieldApplies, onClose]);

  const handleDoneWithItem = useCallback(async () => {
    if (selectedIndex == null || busy) return;
    setTouched(true);
    setFormError(null);
    const selectedCard = snapshotRef.current?.cards?.[selectedIndex] || null;
    if (!selectedCard) {
      setFormError('Add this item to NoSpos first.');
      return;
    }
    const selectedErrors = getValidationErrorsForCard(selectedIndex, valuesRef.current);
    if (selectedErrors.size > 0) {
      setFormError('Fill the required NoSpos fields for this item before continuing.');
      return;
    }
    try {
      await flushQueuedFieldApplies();
      onClose?.({ itemCompleted: true, itemIndex: selectedIndex });
    } catch (err) {
      setFormError(err?.message || 'Could not finish this NoSpos item yet.');
    }
  }, [selectedIndex, busy, getValidationErrorsForCard, flushQueuedFieldApplies, onClose]);

  useEffect(() => {
    return () => {
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
    };
  }, []);

  const handleNext = async () => {
    if (!snapshot || busy) return;
    setTouched(true);
    setFormError(null);
    setBusy(true);
    try {
      await flushQueuedFieldApplies();
      const finalizedValues = { ...valuesRef.current };

      const currentCardCount = snapshot.cards?.length || 0;
      const expectedCardCount = mirrorFirstLineOnly ? 1 : (sourceLines?.length || 0);
      if (currentCardCount < expectedCardCount) {
        throw new Error(
          mirrorFirstLineOnly
            ? 'Add the first line to NoSpos before parking.'
            : 'Add each remaining item to NoSpos before continuing.'
        );
      }

      const finalValidationErrors = getValidationErrorsForValues(finalizedValues);
      if (finalValidationErrors.size > 0) {
        const missingLabels = allFields
          .filter((f) => finalValidationErrors.has(f.name))
          .slice(0, 4)
          .map((f) => f.label || f.name);
        const suffix = finalValidationErrors.size > 4 ? '…' : '';
        throw new Error(
          `Please fill all required fields before continuing: ${missingLabels.join(', ')}${suffix}`
        );
      }

      const fieldsInOrder = [];
      const currentSnapshotByKey = new Map();
      for (let cardIdx = 0; cardIdx < (snapshot.cards || []).length; cardIdx++) {
        const card = snapshot.cards[cardIdx];
        const markerField = resolveItemDescriptionFieldForCard(card);
        const markerFieldName = markerField?.name || null;
        const sourceItem = sourceLines?.[cardIdx] || null;
        for (const f of card.fields || []) {
          if (!f?.name) continue;
          const rawValue = finalizedValues[f.name] != null ? String(finalizedValues[f.name]) : '';
          const nextValue =
            markerFieldName && f.name === markerFieldName
              ? appendCgSyncMarker(rawValue, sourceItem, cardIdx, requestId)
              : rawValue;
          const descriptor = {
            name: f.name,
            value: nextValue,
            cardIndex: cardIdx,
            cardId: card.cardId || null,
          };
          fieldsInOrder.push(descriptor);
          currentSnapshotByKey.set(
            buildApplyFieldKey(f.name, cardIdx, card.cardId || null),
            f.value != null ? String(f.value) : ''
          );
        }
      }
      const fields = fieldsInOrder.filter((f) =>
        (currentSnapshotByKey.get(buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null)) ?? '') !== f.value
      );

      let pendingFields = [...fields];
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (pendingFields.length === 0) break;
        const r1 = await nosposAgreementApplyFields(pendingFields);
        if (!r1?.ok && !Array.isArray(r1?.missing) && !Array.isArray(r1?.failed)) {
          throw new Error(r1?.error || 'Could not update the NosPos form. Is the agreement window still open?');
        }
        const missing = Array.isArray(r1?.missing) ? r1.missing : [];
        const failed = Array.isArray(r1?.failed) ? r1.failed : [];
        const retryKeys = new Set(
          [...missing, ...failed]
            .map((entry) => buildApplyFieldKey(entry?.name, entry?.cardIndex, entry?.cardId || null))
            .filter((key) => key !== buildApplyFieldKey('', null, null))
        );
        if (retryKeys.size === 0) { pendingFields = []; break; }
        console.warn(
          `[CG Suite] NosPos apply attempt ${attempt} retrying ${retryKeys.size} control(s).`,
          { missing, failed }
        );
        pendingFields = pendingFields.filter((f) =>
          retryKeys.has(buildApplyFieldKey(f.name, f.cardIndex, f.cardId || null))
        );
        if (pendingFields.length > 0) await new Promise((r) => setTimeout(r, 80));
      }
      if (pendingFields.length > 0) {
        const names = pendingFields.slice(0, 5).map((f) => f.name).join(', ');
        const more = pendingFields.length > 5 ? ', …' : '';
        throw new Error(`Could not copy all fields to NosPos (${pendingFields.length} field(s) still failing): ${names}${more}`);
      }

      await new Promise((r) => setTimeout(r, 120));

      let r2 = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        r2 = await nosposAgreementParkAgreement();
        if (r2?.ok) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!r2?.ok) {
        throw new Error(
          r2?.error
            || 'Could not park the agreement from NoSpos. Use Actions → Park Agreement on the NoSpos tab.'
        );
      }
      if (NOSPOS_MIRROR_DEBUG) console.info('[CG Suite] NosPos Park Agreement triggered successfully.');
      try {
        await focusNosposAgreementTab();
      } catch (focusErr) {
        console.warn('[CG Suite] Could not focus NosPos tab:', focusErr?.message);
      }
      onClose?.({ completed: true });
    } catch (e) {
      setFormError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const cardFieldPartitions = useMemo(
    () => (snapshot?.cards || []).map((c) => partitionCardFields(c?.fields || [])),
    [snapshot]
  );

  useEffect(() => {
    if (!open || !snapshot) return;
    const cards = snapshot.cards || [];
    const autoPrefilled = [];
    for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
      if (attrPrefillStepDoneRef.current.has(cardIdx)) continue;
      const card = cards[cardIdx];
      if (!card) continue;
      const { categoryFields } = partitionCardFields(card.fields || []);
      const requiredCategoryFieldsForAuto = categoryFields.filter((f) => f.required);
      const categoryReady =
        requiredCategoryFieldsForAuto.length === 0 ||
        requiredCategoryFieldsForAuto.every((f) => {
          const local = values[f.name];
          const effective = (local != null ? String(local) : '').trim() !== ''
            ? local
            : (f.value != null ? String(f.value) : '');
          return String(effective ?? '').trim() !== '';
        });
      if (!categoryReady) continue;
      autoPrefilled.push(cardIdx);
    }
    if (autoPrefilled.length === 0) return;
    autoPrefilled.forEach((cardIdx) => {
      attrPrefillStepDoneRef.current.add(cardIdx);
      handleApplyAttributePrefillForCard(cardIdx);
    });
    setPrefillStepVersion((v) => v + 1);
  }, [open, snapshot, values, handleApplyAttributePrefillForCard]);

  useEffect(() => {
    if (!open || !snapshot) return;
    if (busy || addingItem || applyingCards.size > 0 || updatingCategoryCards.size > 0 || aiFillingCards.size > 0) return;
    const cards = snapshot.cards || [];
    for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
      const card = cards[cardIdx];
      if (!card) continue;
      if (!attrPrefillStepDoneRef.current.has(cardIdx)) continue;

      const { categoryFields } = partitionCardFields(card.fields || []);
      const requiredCategoryFieldsForAuto = categoryFields.filter((f) => f.required);
      const categoryReady =
        requiredCategoryFieldsForAuto.length === 0 ||
        requiredCategoryFieldsForAuto.every((f) => {
          const local = values[f.name];
          const effective = (local != null ? String(local) : '').trim() !== ''
            ? local
            : (f.value != null ? String(f.value) : '');
          return String(effective ?? '').trim() !== '';
        });
      if (!categoryReady) continue;

      const missing = getValidationErrorsForCard(cardIdx, values);
      const aiKey = `${snapshot.pageInstanceId || 'page:unknown'}::${card.cardId || `idx:${cardIdx}`}`;
      if (missing.size === 0) {
        autoAiRequestedRef.current.delete(aiKey);
        continue;
      }
      if (autoAiRequestedRef.current.has(aiKey)) continue;
      autoAiRequestedRef.current.add(aiKey);
      handleAiFillForCard(cardIdx);
      break;
    }
  }, [
    open,
    snapshot,
    values,
    busy,
    addingItem,
    applyingCards,
    updatingCategoryCards,
    aiFillingCards,
    getValidationErrorsForCard,
    handleAiFillForCard,
  ]);

  useEffect(() => {
    if (!open || !snapshot) return;
    setAiManualFallbackCards((prev) => {
      if (!prev || prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const cardIdx of prev) {
        const cardErrors = getValidationErrorsForCard(cardIdx, values);
        if (cardErrors.size === 0) {
          next.delete(cardIdx);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, snapshot, values, getValidationErrorsForCard]);

  if (!open) return null;

  const showForm = snapshot && !loading;
  const expectedMirrorCardCount = mirrorFirstLineOnly ? 1 : (sourceLines?.length || 0);
  const missingCardCount = Math.max(0, expectedMirrorCardCount - (snapshot?.cards?.length || 0));
  const addedCardCount = snapshot?.cards?.length || 0;
  const singleItemMode = Number.isInteger(selectedIndex);
  const selectedCard = singleItemMode ? (snapshot?.cards?.[selectedIndex] || null) : null;
  const selectedValidationErrors = singleItemMode
    ? getValidationErrorsForCard(selectedIndex, values)
    : new Set();
  const activeValidationErrors = singleItemMode ? selectedValidationErrors : validationErrors;
  const selectedRowBusy = singleItemMode && selectedIndex != null
    ? (
      addingItemIndex === selectedIndex ||
      aiFillingCards.has(selectedIndex) ||
      applyingCards.has(selectedIndex) ||
      updatingCategoryCards.has(selectedIndex)
    )
    : false;
  const canDoneSelectedItem =
    singleItemMode &&
    selectedCard &&
    !busy &&
    !selectedRowBusy &&
    !applyInFlightRef.current &&
    selectedValidationErrors.size === 0;

  // True whenever we're waiting on NosPos to reload its page (category applied or item added)
  const nosposReloading = updatingCategoryCards.size > 0 || addingItem;

  const canProceed =
    !busy &&
    !addingItem &&
    !aiFillingCards.size &&
    !applyingCards.size &&
    !updatingCategoryCards.size &&
    showForm &&
    snapshot?.hasNext !== false &&
    validationErrors.size === 0 &&
    missingCardCount === 0;

  return (
    <div
      className="fixed inset-0 z-[130] flex h-[100dvh] min-h-[100svh] w-full flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nospos-mirror-title"
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => { if (!busy) void handleDismiss(); }}
        aria-hidden="true"
      />
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--ui-card)]"
        onClick={(e) => e.stopPropagation()}
      >
        {categoryAiBlocking && !nosposReloading ? (
          <div
            className="absolute inset-0 z-[50] flex flex-col items-center justify-center gap-3 bg-white/92"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div
              className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]"
              aria-hidden
            />
            <p className="text-base font-bold text-[var(--brand-blue)]">
              Calculating category with AI…
            </p>
            <p className="max-w-xs px-4 text-center text-xs text-[var(--text-muted)]">
              Choosing category levels — please wait
            </p>
          </div>
        ) : null}
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
                  : 'Each negotiation item appears as its own row here. Expand a row and add it to NoSpos when you want that item created; once added, category, AI, and manual field updates sync to that row.'}
              {requestId != null ? ` Request ${requestId}.` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void handleDismiss(); }}
            className="shrink-0 rounded-xl border border-white/20 p-2 text-white transition hover:bg-white/15 disabled:opacity-50"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </header>

        {/* Outer clips height; inner scrolls. Overlay is a sibling of the scroller so it stays
            fixed over the visible viewport instead of scrolling away with the content. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {nosposReloading ? (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/90"
              role="status"
              aria-live="polite"
            >
              <div
                className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]"
                aria-hidden
              />
              <p className="text-sm font-bold text-[var(--brand-blue)]">
                {addingItem ? 'Adding item on NoSpos…' : 'Waiting for NoSpos to update…'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                NosPos is reloading the items page
              </p>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {showForm ? (
            <div className="px-4 py-4">
              {!singleItemMode && (missingCardCount > 0 || (touched && validationErrors.size > 0)) && (
                <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                  {(touched && validationErrors.size > 0)
                    ? 'Fill the highlighted required NoSpos fields before adding another item or continuing.'
                    : mirrorFirstLineOnly
                      ? 'Add the first line to NoSpos from the row above, then finish required fields.'
                      : `Open the next item row and add it to NoSpos${missingCardCount > 1 ? ` (${missingCardCount} items still not added)` : ''}.`}
                </div>
              )}
              {singleItemMode && !selectedCard ? (
                <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                  Add this line to NoSpos if needed, then finish the required fields before pressing OK.
                </div>
              ) : null}
              {sourceLines.map((cardItem, cardIdx) => {
                if (singleItemMode && cardIdx !== selectedIndex) return null;
                const card = snapshot.cards?.[cardIdx] || null;
                const { categoryFields, coreFields, otherFields } = cardFieldPartitions[cardIdx] || {
                  categoryFields: [],
                  coreFields: [],
                  otherFields: [],
                };
                const requiredCategoryFields = categoryFields.filter((f) => f.required);
                const requiredOtherFields = otherFields.filter((f) => f.required);
                const isAdded = Boolean(card);
                const isExpanded = expandedRows.has(cardIdx);
                const canAddThisRow =
                  showForm &&
                  !isAdded &&
                  cardIdx === addedCardCount &&
                  !(mirrorFirstLineOnly && cardIdx > 0) &&
                  validationErrors.size === 0 &&
                  !busy &&
                  !addingItem &&
                  !aiFillingCards.size &&
                  !applyingCards.size &&
                  !updatingCategoryCards.size &&
                  !applyInFlightRef.current &&
                  snapshot?.hasNext !== false;
                const rowBusy =
                  addingItemIndex === cardIdx ||
                  aiFillingCards.has(cardIdx) ||
                  applyingCards.has(cardIdx) ||
                  updatingCategoryCards.has(cardIdx);
                const categoryReloading = updatingCategoryCards.has(cardIdx);
                const hasRequiredCategoryComplete =
                  requiredCategoryFields.length === 0 ||
                  requiredCategoryFields.every((f) => {
                    const v = values[f.name];
                    return v != null && String(v).trim() !== '';
                  });
                const rowTitle = getSourceLineDisplayName(cardItem, card?.title || `Item ${cardIdx + 1}`);
                const rowMeta = getSourceLineDisplayMeta(cardItem);
                const rowAttributesSummary = getSourceLineAttributesSummary(cardItem);
                const rowIsMarkedByCgSuite = preexistingSyncedCards.has(cardIdx);
                const aiRunningForRow = aiFillingCards.has(cardIdx);
                const rowHasMissingRequired = (card?.fields || []).some(
                  (f) => f?.required && f?.name && activeValidationErrors.has(f.name)
                );
                const statusTone = mirrorFirstLineOnly && !isAdded && cardIdx > 0
                  ? 'border-slate-300 bg-slate-100 text-slate-600'
                  : addingItemIndex === cardIdx
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : isAdded
                      ? 'border-green-300 bg-green-50 text-green-800'
                      : canAddThisRow
                        ? 'border-blue-300 bg-blue-50 text-blue-800'
                        : 'border-slate-300 bg-slate-100 text-slate-700';
                const statusLabel = mirrorFirstLineOnly && !isAdded && cardIdx > 0
                  ? 'Not in test'
                  : addingItemIndex === cardIdx
                    ? 'Adding to NoSpos…'
                    : rowIsMarkedByCgSuite
                      ? 'Synced from NoSpos'
                      : isAdded
                        ? 'Added to NoSpos'
                        : canAddThisRow
                          ? 'Ready to add'
                          : 'Waiting';
                return (
                  <section
                    key={card?.cardId || cardItem?.id || `mirror-row-${cardIdx}`}
                    className="mb-4 overflow-hidden rounded-[var(--radius)] border border-[var(--ui-border)] bg-[var(--ui-bg)] last:mb-0 [content-visibility:auto] [contain-intrinsic-size:auto_200px]"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-3 text-left transition hover:bg-white"
                      onClick={() => {
                        setExpandedRows((prev) => {
                          const next = new Set(prev);
                          if (next.has(cardIdx)) next.delete(cardIdx);
                          else next.add(cardIdx);
                          return next;
                        });
                      }}
                      aria-expanded={isExpanded}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xs font-black uppercase tracking-wider text-[var(--brand-blue)]">
                            {rowTitle}
                          </h3>
                          {rowAttributesSummary ? (
                            <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                              {rowAttributesSummary}
                            </span>
                          ) : null}
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone}`}>
                            {statusLabel}
                          </span>
                          {rowBusy && addingItemIndex !== cardIdx ? (
                            <span className="text-[10px] font-bold text-[var(--brand-blue)]">
                              {updatingCategoryCards.has(cardIdx)
                                ? 'Updating category…'
                                : aiFillingCards.has(cardIdx)
                                  ? 'AI filling…'
                                  : 'Syncing to NoSpos…'}
                            </span>
                          ) : null}
                        </div>
                        {rowMeta ? (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {rowMeta}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`material-symbols-outlined shrink-0 text-[20px] text-[var(--brand-blue)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        aria-hidden
                      >
                        expand_more
                      </span>
                    </button>

                    {isExpanded ? (
                      isAdded ? (
                        <div data-mirror-focus-chain>
                          {requiredCategoryFields.length > 0 ? (
                            <div className="border-b border-[var(--ui-border)] bg-[var(--brand-blue-alpha-05)] px-4 py-4">
                              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--ui-border)] bg-white">
                                <table className="spreadsheet-table w-full min-w-[20rem] border-collapse text-left spreadsheet-table--static-header">
                                  <thead>
                                    <tr>
                                      <th className="w-[32%] max-w-[14rem]">Field</th>
                                      <th>Value</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {requiredCategoryFields.map((f) => {
                                      const fid = getMirrorFieldControlId(f);
                                      const aiFilled = aiFilledFieldKeys.has(buildCardFieldKey(cardIdx, f.name));
                                      return (
                                        <tr key={f.name}>
                                          <td className="align-top bg-slate-50/90">
                                            <label
                                              htmlFor={fid}
                                              className="block text-xs font-extrabold uppercase tracking-wide text-[var(--text-main)]"
                                            >
                                              {f.label || f.name}
                                              {f.required ? <span className="text-red-600"> *</span> : null}
                                              {aiFilled ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" aria-label="AI filled" /> : null}
                                            </label>
                                          </td>
                                          <td className="align-top">
                                            <MirrorField
                                              layout="tableCell"
                                              field={f}
                                              value={values[f.name] ?? ''}
                                              onChange={handleCategoryFieldChange(f.name, cardIdx, card.cardId || null)}
                                              showError={touched && f.required && activeValidationErrors.has(f.name)}
                                              item={cardItem}
                                              onCategoryAiRunningChange={notifyCategoryAiRunning}
                                              onAiFilled={() => {
                                                setAiFilledFieldKeys((prev) => {
                                                  const next = new Set(prev);
                                                  next.add(buildCardFieldKey(cardIdx, f.name));
                                                  return next;
                                                });
                                              }}
                                            />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}

                          {isAdded &&
                          !categoryReloading &&
                          requiredCategoryFields.length > 0 &&
                          hasRequiredCategoryComplete &&
                          (card?.fields || []).some((f) => f?.name && activeValidationErrors.has(f.name)) ? (
                            <div
                              className="border-b border-amber-200 bg-amber-50 px-4 py-3"
                              role="status"
                              aria-live="polite"
                            >
                              <div className="flex flex-col gap-2">
                                <p className="text-sm font-semibold leading-snug text-amber-950">
                                  You&apos;ve set the category for this item, but NoSpos still needs required fields.
                                </p>
                                <p className="text-xs font-semibold text-amber-900">
                                  AI help runs automatically when available. You can still edit required fields manually below.
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {categoryReloading ? (
                            <div className="border-b border-[var(--ui-border)] bg-white px-4 py-4">
                              <div className="flex items-center gap-2">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
                                <span className="text-xs font-bold text-[var(--brand-blue)]">
                                  Waiting for NoSpos to reload category fields…
                                </span>
                              </div>
                            </div>
                          ) : hasRequiredCategoryComplete ? (
                            <div
                              className="border-b border-[var(--ui-border)] bg-white px-4 py-3"
                              data-prefill-step-ver={prefillStepVersion}
                            >
                              <div className="flex flex-col gap-2">
                                <p className="text-xs text-[var(--text-muted)]">
                                  Required fields are auto-prefilled from negotiation first, then AI help runs automatically
                                  for anything still missing.
                                </p>
                                {aiRunningForRow ? (
                                  <p className="text-xs font-semibold text-[var(--brand-blue)]">
                                    Running AI help…
                                  </p>
                                ) : null}
                                {aiManualFallbackCards.has(cardIdx) && rowHasMissingRequired ? (
                                  <p className="text-xs font-medium text-amber-800">
                                    AI could not complete this row. Enter the remaining values manually — every field
                                    below stays editable.
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {!categoryReloading && hasRequiredCategoryComplete && coreFields.length > 0 && (
                            <div className="border-b border-[var(--ui-border)] bg-slate-50 px-4 py-3">
                              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-[var(--text-muted)]">
                                Synced from negotiation (locked)
                              </p>
                              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--ui-border)] bg-white">
                                <table className="spreadsheet-table w-full min-w-0 border-collapse text-left spreadsheet-table--static-header">
                                  <thead>
                                    <tr>
                                      {coreFields.map((f) => (
                                        <th key={f.name}>{f.label || f.name}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr className="[&_td]:hover:bg-transparent [&_td]:hover:shadow-none">
                                      {coreFields.map((f) => {
                                        const lockedValue =
                                          values[f.name] != null
                                            ? String(values[f.name])
                                            : (f.value != null ? String(f.value) : '');
                                        return (
                                          <td key={f.name}>
                                            <input
                                              type="text"
                                              value={lockedValue}
                                              readOnly
                                              disabled
                                              tabIndex={-1}
                                              className="w-full rounded-[var(--radius)] border border-[var(--ui-border)] bg-slate-100 px-2 py-2 text-sm text-[var(--text-main)]"
                                            />
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {!categoryReloading && hasRequiredCategoryComplete && (
                            <div className="p-4">
                              {requiredOtherFields.length > 0 ? (
                                <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--ui-border)] bg-white">
                                  <table className="spreadsheet-table w-full min-w-[20rem] border-collapse text-left spreadsheet-table--static-header">
                                    <thead>
                                      <tr>
                                        <th className="w-[32%] max-w-[14rem]">Field</th>
                                        <th>Value</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {requiredOtherFields.map((f) => {
                                        const fid = getMirrorFieldControlId(f);
                                        const aiFilled = aiFilledFieldKeys.has(buildCardFieldKey(cardIdx, f.name));
                                        return (
                                          <tr key={f.name}>
                                            <td className="align-top bg-slate-50/90">
                                              <label
                                                htmlFor={fid}
                                                className="block text-xs font-extrabold uppercase tracking-wide text-[var(--text-main)]"
                                              >
                                                {f.label || f.name}
                                                {f.required ? <span className="text-red-600"> *</span> : null}
                                                {aiFilled ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" aria-label="AI filled" /> : null}
                                              </label>
                                            </td>
                                            <td className="align-top">
                                              <MirrorField
                                                layout="tableCell"
                                                field={f}
                                                value={values[f.name] ?? ''}
                                                onChange={handleFieldChange(f.name, cardIdx, card.cardId || null)}
                                                showError={touched && f.required && activeValidationErrors.has(f.name)}
                                              />
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3 p-4">
                          <p className="text-sm text-[var(--text-main)]">
                            {singleItemMode && autoAddSelectedIfMissing
                              ? 'This item has not been added to NoSpos yet. We are adding it to NoSpos automatically and will continue when the page refreshes.'
                              : 'This item has not been added to NoSpos yet. Add it from the row action to continue.'}
                          </p>
                          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-blue)]">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
                            {canAddThisRow
                              ? 'Adding this item now…'
                              : validationErrors.size > 0
                                ? 'Waiting until required fields above are complete.'
                                : cardIdx < addedCardCount
                                  ? 'This item is already in NoSpos.'
                                  : 'Waiting for previous item to finish.'}
                          </div>
                        </div>
                      )
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div
                className="mb-4 h-9 w-9 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]"
                aria-hidden
              />
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

        {formError ? (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800">
            {formError}
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => { void handleDismiss(); }}
            className="rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--text-main)] hover:bg-[var(--ui-bg)] disabled:opacity-50"
          >
            {singleItemMode ? 'Cancel' : 'Close'}
          </button>
          {singleItemMode ? (
            <button
              type="button"
              disabled={!canDoneSelectedItem}
              onClick={() => { void handleDoneWithItem(); }}
              className="rounded-[var(--radius)] bg-brand-orange px-5 py-2.5 text-sm font-black uppercase tracking-wide text-brand-blue transition hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : selectedRowBusy ? 'Syncing…' : 'OK'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!canProceed}
              onClick={handleNext}
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