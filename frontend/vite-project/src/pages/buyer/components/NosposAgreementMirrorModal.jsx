import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  focusNosposAgreementTab,
  nosposAgreementAddItem,
  nosposAgreementApplyFields,
  nosposAgreementClickNext,
} from '@/services/extensionClient';
import {
  buildCategoryTree,
  categoryOptionsAreHierarchical,
  findPathForCategoryValue,
} from '../nosposCategoryTree';
import { computeNosposMirrorPrefill } from '../utils/nosposMirrorPrefill';
import {
  normalizeAiFieldResponseKeys,
  suggestNosposCategory,
  suggestFieldValues,
  shouldSkipAiFill,
} from '@/services/aiCategoryService';

// ---------------------------------------------------------------------------
// Item summariser — builds the payload sent to the AI service
// ---------------------------------------------------------------------------

/**
 * Extract a minimal, AI-friendly summary from a source negotiation line.
 * @returns {{ name: string, dbCategory: string|null, attributes: Record<string,string> }}
 */
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

// ---------------------------------------------------------------------------
// AI status chip — shown inline to the right of each dropdown after auto-selection
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES = {
  high:   'text-green-700 bg-green-50 border-green-300',
  medium: 'text-amber-700 bg-amber-50 border-amber-300',
  low:    'text-red-700   bg-red-50   border-red-300',
};

/** One-line status chip; reasoning is hidden behind a small “Why?” toggle. */
function AiLevelChip({ aiState }) {
  const [whyOpen, setWhyOpen] = useState(false);

  if (!aiState || aiState.status === 'loading') return null;

  if (aiState.status === 'error') {
    return (
      <span className="shrink-0 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
        AI unavailable
      </span>
    );
  }

  const { confidence, reasoning } = aiState.suggestion;
  const confStyle = CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.low;

  return (
    <div className="relative shrink-0">
      <div className="inline-flex items-center gap-1 rounded-md border border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] px-1.5 py-0.5">
        <span className="material-symbols-outlined text-[14px] leading-none text-green-600">check_circle</span>
        <span className="whitespace-nowrap text-[10px] font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
          AI selected
        </span>
        <span className={`rounded border px-1 py-px text-[9px] font-bold uppercase leading-none ${confStyle}`}>
          {confidence}
        </span>
        {reasoning ? (
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            className="ml-0.5 border-l border-[var(--ui-border)] pl-1 text-[10px] font-bold text-[var(--brand-blue)] underline decoration-dotted underline-offset-2 hover:opacity-80"
            aria-expanded={whyOpen}
          >
            {whyOpen ? 'Hide' : 'Why?'}
          </button>
        ) : null}
      </div>
      {whyOpen && reasoning ? (
        <p className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-[var(--ui-border)] bg-white px-2 py-1.5 text-[10px] leading-snug text-[var(--text-muted)] shadow-md">
          {reasoning}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option-value resolver — maps AI text response → actual <select> option value
// ---------------------------------------------------------------------------

/**
 * Given the AI's returned string, find the best-matching option VALUE.
 * Tries: exact value match → exact text match → case-insensitive match.
 * Falls back to the raw string if nothing matches (text-input fields).
 */
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

/** No shadow on inputs — clean flat controls. */
const inputClass =
  'w-full rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-3 py-2.5 text-sm text-[var(--text-main)] transition-colors focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]';
const inputErrorClass =
  'border-red-400 focus:border-red-500 focus:ring-red-500';

function isNosposMirrorCategoryField(f) {
  return /\[category\]/i.test(f.name || '') || String(f.label || '').toLowerCase() === 'category';
}

function isEmptyForValidation(field, raw) {
  const v = raw != null ? String(raw).trim() : '';
  return v === '';
}

function partitionCardFields(fields) {
  const categoryFields = [];
  const otherFields = [];
  for (const f of fields || []) {
    if (!f?.name) continue;
    if (isNosposMirrorCategoryField(f)) categoryFields.push(f);
    else otherFields.push(f);
  }
  return { categoryFields, otherFields };
}

function CategoryCascadeField({ field, tree, value, onChange, required, showError, item }) {
  const pathFromValue = useMemo(() => findPathForCategoryValue(tree, value), [tree, value]);
  const [path, setPath] = useState(pathFromValue);
  const prevTreeRef = useRef(tree);

  // { [levelIndex]: { status: 'loading'|'ready'|'error', suggestion: null|{...}, error: null|string } }
  const [aiSuggestions, setAiSuggestions] = useState({});

  // Track which (path, level) pairs AI has already fired for so that:
  //   1. React 18 Strict Mode's double-effect-run never fires two real API calls
  //   2. A new `tree` reference (NosPos snapshot update) doesn't restart a completed cascade
  const aiRanForLevelRef = useRef(new Set());

  // Once the user manually changes any dropdown, AI must never interfere again for this field
  const userTookOverRef = useRef(false);

  useLayoutEffect(() => {
    const treeChanged = tree !== prevTreeRef.current;
    prevTreeRef.current = tree;
    if (!value && !treeChanged) return;
    setPath(pathFromValue.length ? pathFromValue : []);
  }, [tree, value, pathFromValue.join('\0')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the async .then() always calls the latest version
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

  /**
   * Fires as soon as a level's options are available. Sends ONLY that level's list to the AI
   * (one list per call). On success, auto-applies the suggestion — which updates `path`,
   * triggering this effect again for the next level, cascading all the way to the leaf.
   */
  useEffect(() => {
    if (!tree || tree.children.size === 0) return;

    // User has taken over — AI is permanently silent for this field
    if (userTookOverRef.current) return;

    let node = tree;
    for (const seg of path) {
      const next = node.children.get(seg);
      if (!next) return;
      node = next;
    }

    if (node.children.size === 0) return;

    const levelIndex = path.length;

    // De-duplicate: prevent both React Strict Mode's double-fire and NosPos snapshot-update
    // re-triggers from sending a second API call for the same (path, level) combination.
    // Refs survive Strict Mode's cleanup→re-setup cycle so the second run always hits this guard.
    const pathKey = [...path, levelIndex].join('\0');
    if (aiRanForLevelRef.current.has(pathKey)) return;
    aiRanForLevelRef.current.add(pathKey);

    const capturedPath = [...path]; // snapshot for async closure
    const availableOptions = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    const itemSummary = summariseItemForAiPrompt(item);

    setAiSuggestions((prev) => ({
      ...prev,
      [levelIndex]: { status: 'loading', suggestion: null, error: null },
    }));

    // ── Log: list being sent ──────────────────────────────────────────────
    console.group(
      `%c[CG Suite] AI Category — Level ${levelIndex + 1} (sending list)`,
      'color:#1a56db;font-weight:bold'
    );
    console.log('Item         :', itemSummary.name, itemSummary.dbCategory ? `(${itemSummary.dbCategory})` : '');
    console.log('Path so far  :', capturedPath.length ? capturedPath.join(' > ') : '(top level)');
    console.log(`List sent    : [${availableOptions.length} options]`, availableOptions);
    console.groupEnd();

    suggestNosposCategory({
      item: itemSummary,
      levelIndex,
      availableOptions,
      previousPath: capturedPath,
    })
      .then((result) => {
        // ── Log: AI response for this list ───────────────────────────────
        console.group(
          `%c[CG Suite] AI Category — Level ${levelIndex + 1} (response)`,
          'color:#057a55;font-weight:bold'
        );
        console.log(`AI selected  : "${result.suggested}" (${result.confidence})`);
        console.log('Reasoning    :', result.reasoning);
        console.groupEnd();

        // Use startTransition so AI-driven cascade updates don't block user interactions
        startTransition(() => {
          setAiSuggestions((prev) => ({
            ...prev,
            [levelIndex]: { status: 'ready', suggestion: result, error: null },
          }));

          // Auto-apply → sets path → triggers next level's useEffect
          updateFromPathRef.current([...capturedPath, result.suggested]);
        });
      })
      .catch((err) => {
        console.error(`[CG Suite] AI Category — Level ${levelIndex + 1} ERROR:`, err.message);
        startTransition(() => {
          setAiSuggestions((prev) => ({
            ...prev,
            [levelIndex]: { status: 'error', suggestion: null, error: err.message },
          }));
        });
      });
  }, [tree, path.join('\0')]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCalculating = Object.values(aiSuggestions).some((s) => s.status === 'loading');

  const rows = [];
  let node = tree;
  let depth = 0;
  const maxDepth = 24;

  while (node && depth < maxDepth) {
    const branchKeys = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    if (branchKeys.length > 0) {
      const capturedDepth = depth;
      const sel = path[capturedDepth] || '';
      rows.push(
        <div key={`row-${capturedDepth}`} className="flex items-start gap-3">
          <select
            aria-label={`${field.label} — level ${capturedDepth + 1}`}
            required={required && capturedDepth === 0}
            className={`min-w-0 flex-1 ${inputClass} ${showError ? inputErrorClass : ''}`}
            value={sel}
            onChange={(e) => {
              const seg = e.target.value;
              const next = path.slice(0, capturedDepth);
              if (seg) next.push(seg);
              // User has taken control — disable AI for this field permanently
              userTookOverRef.current = true;
              // Clear AI state for deeper levels — new branch, fresh cascade
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

          {/* Show what AI chose at this level once it's done */}
          <AiLevelChip key={`${capturedDepth}-${sel || 'empty'}`} aiState={aiSuggestions[capturedDepth]} />
        </div>
      );
      if (!sel) break;
      node = node.children.get(sel);
      depth++;
      continue;
    }
    if (node.leafValues && node.leafValues.length > 1) {
      rows.push(
        <select
          key={`lf-${depth}`}
          aria-label={`${field.label} — variant`}
          required={required}
          className={`${inputClass} ${showError ? inputErrorClass : ''}`}
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
      );
    }
    break;
  }

  return (
    <div className="flex flex-col gap-3">
      {isCalculating && (
        <div className="flex items-center gap-2.5 rounded-lg border border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] px-3 py-2.5">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" />
          <span className="text-sm font-bold text-[var(--brand-blue)]">AI calculating category…</span>
        </div>
      )}
      {rows}
    </div>
  );
}

function MirrorField({ field, value, onChange, showError, item }) {
  const id = `nospos-mirror-${field.name.replace(/[^\w-]/g, '_')}`;
  const req = Boolean(field.required);

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
      return (
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
            {field.label}
            {req ? <span className="text-red-600"> *</span> : null}
          </label>
          <CategoryCascadeField
            field={field}
            tree={categoryTree}
            value={value}
            onChange={onChange}
            required={req}
            showError={showError}
            item={item}
          />
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
        <select
          id={id}
          required={req}
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

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-extrabold uppercase tracking-wide text-[var(--brand-blue)]">
        {field.label}
        {req ? <span className="text-red-600"> *</span> : null}
      </label>
      <input
        id={id}
        type={inputType}
        required={req}
        className={`${inputClass} ${showError ? inputErrorClass : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {showError ? (
        <p className="text-xs font-semibold text-red-600">This field is required.</p>
      ) : null}
    </div>
  );
}

/**
 * NosPos agreement items mirror: centered modal, brand styling, category block at top of each item.
 */
export default function NosposAgreementMirrorModal({
  open,
  snapshot,
  /** True when modal is open but items form not received yet */
  loading = false,
  waitExpired = false,
  requestId = null,
  /** Negotiation lines in card order: jewellery rows first, then main items (not removed). */
  sourceLines = [],
  useVoucherOffers = false,
  /** Pass `{ completed: true }` after NosPos Next succeeds; omit or false when dismissing. */
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
  const userOverriddenFieldsRef = useRef(new Set());
  const prevOpenRef = useRef(false);

  // Cards awaiting AI field fill after NosPos returns the populated snapshot
  const aiPendingFillRef = useRef(new Set());
  // Always-current values ref so async closures read the latest state
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; });
  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = snapshot; });
  const pendingFieldApplyRef = useRef(new Map());
  const pendingFieldApplyCardRef = useRef(new Map());
  const applyFlushTimerRef = useRef(null);
  const applyInFlightRef = useRef(false);
  const applyNeedsAnotherPassRef = useRef(false);

  useLayoutEffect(() => {
    if (open && !prevOpenRef.current) {
      userOverriddenFieldsRef.current = new Set();
      pendingFieldApplyRef.current = new Map();
      pendingFieldApplyCardRef.current = new Map();
      applyNeedsAnotherPassRef.current = false;
      applyInFlightRef.current = false;
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
      setApplyingCards(new Set());
      setUpdatingCategoryCards(new Set());
      setAddingItem(false);
      setTouched(false);
    }
    prevOpenRef.current = open;
  }, [open]);

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

    const base = {};
    for (const card of snapshot.cards || []) {
      for (const f of card.fields || []) {
        if (f?.name) base[f.name] = f.value != null ? String(f.value) : '';
      }
    }
    const prefill = computeNosposMirrorPrefill(snapshot, sourceLines, useVoucherOffers);
    setValues((prev) => {
      const next = { ...base };
      for (const k of userOverriddenFieldsRef.current) {
        if (names.has(k) && prev[k] !== undefined) next[k] = prev[k];
      }
      for (const [k, v] of Object.entries(prefill)) {
        if (userOverriddenFieldsRef.current.has(k)) continue;
        if (v != null && String(v).trim() !== '') next[k] = String(v);
      }
      return next;
    });
    setFormError(null);
  }, [open, snapshot, sourceLines, useVoucherOffers]);

  /**
   * When a leaf category is chosen, push it to NosPos so the real form updates.
   * After NosPos confirms, mark the card for AI field fill — the next snapshot
   * update will carry the fully-populated form fields for that category.
   */
  const handleCategoryFieldChange = useCallback((name, cardIdx) => {
    return (v) => {
      userOverriddenFieldsRef.current.add(name);
      const str = v != null ? String(v) : '';
      setValues((prev) => ({ ...prev, [name]: str }));
      if (str.trim() === '') return;
      void (async () => {
        try {
          setFormError(null);
          setUpdatingCategoryCards((prev) => new Set([...prev, cardIdx]));
          const r = await nosposAgreementApplyFields([{ name, value: str }]);
          if (!r?.ok) {
            setFormError(
              r?.error ||
                'Could not update category on NosPos. Check the agreement tab is still open.'
            );
          } else {
            // NosPos will push a new snapshot with populated spec fields — queue AI fill
            aiPendingFillRef.current.add(cardIdx);
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
  }, []);

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
      if (isEmptyForValidation(f, values[f.name])) errs.add(f.name);
    }
    return errs;
  }, [allFields, values]);

  const getValidationErrorsForValues = useCallback((candidateValues) => {
    const errs = new Set();
    for (const f of allFields) {
      if (!f.required) continue;
      if (isEmptyForValidation(f, candidateValues?.[f.name])) errs.add(f.name);
    }
    return errs;
  }, [allFields]);

  const flushQueuedFieldApplies = useCallback(async () => {
    if (applyFlushTimerRef.current) {
      clearTimeout(applyFlushTimerRef.current);
      applyFlushTimerRef.current = null;
    }
    if (applyInFlightRef.current) {
      applyNeedsAnotherPassRef.current = true;
      return;
    }

    const pendingEntries = [...pendingFieldApplyRef.current.entries()];
    if (pendingEntries.length === 0) return;

    applyInFlightRef.current = true;
    applyNeedsAnotherPassRef.current = false;
    pendingFieldApplyRef.current = new Map();
    const cardMap = pendingFieldApplyCardRef.current;
    pendingFieldApplyCardRef.current = new Map();

    const currentCards = snapshotRef.current?.cards || [];
    const currentSnapshotByName = {};
    for (const card of currentCards) {
      for (const f of card.fields || []) {
        if (f?.name) currentSnapshotByName[f.name] = f.value != null ? String(f.value) : '';
      }
    }

    let fields = pendingEntries
      .map(([name, value]) => ({
        name,
        value: value != null ? String(value) : '',
      }))
      .filter((f) => (currentSnapshotByName[f.name] ?? '') !== f.value);

    const cardIdxs = [...new Set(
      fields
        .map((f) => cardMap.get(f.name))
        .filter((idx) => Number.isInteger(idx))
    )];

    if (fields.length === 0) {
      applyInFlightRef.current = false;
      if (applyNeedsAnotherPassRef.current || pendingFieldApplyRef.current.size > 0) {
        void flushQueuedFieldApplies();
      }
      return;
    }

    if (cardIdxs.length > 0) {
      setApplyingCards((prev) => new Set([...prev, ...cardIdxs]));
    }

    try {
      let pendingFields = [...fields];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (pendingFields.length === 0) break;
        const r1 = await nosposAgreementApplyFields(pendingFields);
        if (!r1?.ok && !Array.isArray(r1?.missing) && !Array.isArray(r1?.failed)) {
          throw new Error(
            r1?.error || 'Could not update the NosPos form. Is the agreement tab still open?'
          );
        }
        const missing = Array.isArray(r1?.missing) ? r1.missing : [];
        const failed = Array.isArray(r1?.failed) ? r1.failed : [];
        const failedNames = failed.map((x) => x?.name).filter(Boolean);
        const retryNames = new Set([...missing, ...failedNames]);
        if (retryNames.size === 0) {
          pendingFields = [];
          break;
        }
        pendingFields = pendingFields.filter((f) => retryNames.has(f.name));
        if (pendingFields.length > 0) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }
      if (pendingFields.length > 0) {
        const names = pendingFields.slice(0, 5).map((f) => f.name).join(', ');
        const more = pendingFields.length > 5 ? ', ...' : '';
        throw new Error(
          `Could not copy all fields to NosPos (${pendingFields.length} field(s) still failing): ${names}${more}`
        );
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
        void flushQueuedFieldApplies();
      }
    }
  }, []);

  const queueFieldApply = useCallback((name, value, cardIdx) => {
    if (!name) return;
    pendingFieldApplyRef.current.set(name, value != null ? String(value) : '');
    if (Number.isInteger(cardIdx)) {
      pendingFieldApplyCardRef.current.set(name, cardIdx);
    }
    if (applyFlushTimerRef.current) clearTimeout(applyFlushTimerRef.current);
    applyFlushTimerRef.current = setTimeout(() => {
      applyFlushTimerRef.current = null;
      void flushQueuedFieldApplies();
    }, 120);
  }, [flushQueuedFieldApplies]);

  useEffect(() => {
    if (!open || !snapshot) return;
    const prefill = computeNosposMirrorPrefill(snapshot, sourceLines, useVoucherOffers);
    for (let cardIdx = 0; cardIdx < (snapshot.cards || []).length; cardIdx += 1) {
      const card = snapshot.cards[cardIdx];
      for (const field of card.fields || []) {
        if (!field?.name) continue;
        if (userOverriddenFieldsRef.current.has(field.name)) continue;
        const prefillValue = prefill[field.name];
        if (prefillValue == null || String(prefillValue).trim() === '') continue;
        const currentValue = field.value != null ? String(field.value) : '';
        const nextValue = String(prefillValue);
        if (currentValue === nextValue) continue;
        queueFieldApply(field.name, nextValue, cardIdx);
      }
    }
  }, [open, snapshot, sourceLines, useVoucherOffers, queueFieldApply]);

  const handleFieldChange = useCallback((name, cardIdx) => {
    return (v) => {
      userOverriddenFieldsRef.current.add(name);
      const str = v != null ? String(v) : '';
      setValues((prev) => ({ ...prev, [name]: str }));
      queueFieldApply(name, str, cardIdx);
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

  useEffect(() => {
    return () => {
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
    };
  }, []);

  /**
   * After the category is applied and NosPos sends back the populated snapshot,
   * this effect fires and AI-fills the remaining empty fields.
   *
   * Rules:
   *  1. Attribute-match pass (computeNosposMirrorPrefill) runs first via the
   *     useLayoutEffect above — AI never touches what it already filled.
   *  2. Skip fields already filled by attribute pass.
   *  3. Skip skip-pattern fields (serial, IMEI, description, location…).
   *  4. After filling, add field names to userOverriddenFieldsRef so that
   *     future snapshot updates (which reset from NosPos base) don't wipe the
   *     AI values before the user presses Next.
   *  5. Resolve AI text responses to the actual option value for SELECT fields.
   */
  useEffect(() => {
    if (!snapshot || aiPendingFillRef.current.size === 0) return;
    const cards = snapshot.cards || [];
    const pendingCopy = [...aiPendingFillRef.current];
    aiPendingFillRef.current.clear();

    // What the attribute-match pass already determined for this snapshot
    const attributePrefill = computeNosposMirrorPrefill(snapshot, sourceLines, useVoucherOffers);

    // Mark all pending cards as actively being AI-filled (shows spinner in card header)
    const cardsWithWork = [];
    for (const cardIdx of pendingCopy) {
      const card = cards[cardIdx];
      if (!card) continue;
      const cardItem = sourceLines?.[cardIdx] ?? null;
      if (!cardItem) continue;
      const { otherFields } = partitionCardFields(card.fields);
      const hasWork = otherFields.some((f) => {
        if (!f?.name) return false;
        if (userOverriddenFieldsRef.current.has(f.name)) return false;
        if (shouldSkipAiFill(f)) return false;
        const attrVal = attributePrefill[f.name];
        if (attrVal != null && String(attrVal).trim() !== '') return false;
        return true;
      });
      if (hasWork) cardsWithWork.push(cardIdx);
    }
    if (cardsWithWork.length > 0) {
      setAiFillingCards((prev) => new Set([...prev, ...cardsWithWork]));
    }

    for (const cardIdx of pendingCopy) {
      const card = cards[cardIdx];
      if (!card) continue;
      const cardItem = sourceLines?.[cardIdx] ?? null;
      if (!cardItem) continue;

      const { otherFields } = partitionCardFields(card.fields);

      const fieldsForAi = otherFields.filter((f) => {
        if (!f?.name) return false;
        if (userOverriddenFieldsRef.current.has(f.name)) return false;
        if (shouldSkipAiFill(f)) return false;
        // Let the attribute pass own what it already filled
        const attrVal = attributePrefill[f.name];
        if (attrVal != null && String(attrVal).trim() !== '') return false;
        return true;
      });

      if (fieldsForAi.length === 0) {
        // No AI work for this card — remove from filling set immediately
        setAiFillingCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
        continue;
      }

      // Keep a options map for value resolution after the async call
      const fieldOptionsMap = Object.fromEntries(
        fieldsForAi.map((f) => [f.name, f.options || []])
      );

      const itemSummary = summariseItemForAiPrompt(cardItem);

      console.group('%c[CG Suite] AI Field Fill — sending fields', 'color:#7e3af2;font-weight:bold');
      console.log('Card    :', card.title || `Card ${cardIdx}`);
      console.log('Item    :', itemSummary.name);
      console.log('Fields  :', fieldsForAi.map((f) => f.label || f.name));
      console.log('Skipped by attr-pass:', Object.keys(attributePrefill).filter((k) => otherFields.some((f) => f.name === k)));
      console.groupEnd();

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
          // ─── Compute what to apply OUTSIDE setValues ──────────────────────
          // React 18 StrictMode calls state updaters twice; any ref mutation
          // or side-effect inside an updater would cause the second call to
          // see different ref state and produce the wrong result. We resolve
          // values and mark overrides here (synchronously, once) then pass a
          // pure updater to setValues.
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

          console.group('%c[CG Suite] AI Field Fill — response', 'color:#057a55;font-weight:bold');
          console.log('Raw from AI :', result.fields);
          console.log('Normalized keys:', normalizedFields);
          console.log('Applying    :', toApply);
          console.groupEnd();

          if (Object.keys(toApply).length > 0) {
            // Mark as overridden BEFORE setValues so that any concurrent
            // snapshot update (useLayoutEffect) won't wipe these values.
            for (const fieldName of Object.keys(toApply)) {
              userOverriddenFieldsRef.current.add(fieldName);
            }

            // Pure updater — no side effects
            setValues((prev) => {
              const next = { ...prev };
              for (const [fieldName, resolved] of Object.entries(toApply)) {
                next[fieldName] = resolved;
              }
              return next;
            });

            for (const [fieldName, resolved] of Object.entries(toApply)) {
              queueFieldApply(fieldName, resolved, cardIdx);
            }
          }
        })
        .catch((err) => {
          console.error('[CG Suite] AI Field Fill error:', err.message);
        })
        .finally(() => {
          setAiFillingCards((prev) => { const next = new Set(prev); next.delete(cardIdx); return next; });
        });
    }
  }, [snapshot, queueFieldApply]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !snapshot || addingItem || busy) return;
    const currentCount = snapshot.cards?.length || 0;
    const targetCount = sourceLines?.length || 0;
    if (currentCount === 0 || currentCount >= targetCount) return;
    if (aiFillingCards.size > 0 || applyingCards.size > 0 || updatingCategoryCards.size > 0 || applyInFlightRef.current) return;
    if (validationErrors.size > 0) {
      setTouched(true);
      return;
    }

    setAddingItem(true);
    setFormError(null);
    void (async () => {
      try {
        await flushQueuedFieldApplies();
        const addResult = await nosposAgreementAddItem();
        if (!addResult?.ok) {
          throw new Error(addResult?.error || 'Could not add the next NosPos item.');
        }
        await waitForSnapshotCardCount(currentCount + 1);
      } catch (err) {
        setFormError(err?.message || 'Could not add the next NosPos item.');
      } finally {
        setAddingItem(false);
      }
    })();
  }, [
    open,
    snapshot,
    sourceLines,
    addingItem,
    busy,
    aiFillingCards,
    applyingCards,
    updatingCategoryCards,
    validationErrors,
    flushQueuedFieldApplies,
    waitForSnapshotCardCount,
  ]);

  const handleNext = async () => {
    if (!snapshot || busy) return;
    setTouched(true);
    setFormError(null);
    setBusy(true);
    try {
      await flushQueuedFieldApplies();
      const finalizedValues = { ...valuesRef.current };

      const currentCardCount = snapshot.cards?.length || 0;
      const expectedCardCount = sourceLines?.length || 0;
      if (currentCardCount < expectedCardCount) {
        throw new Error('Finish the current item so NoSpos can add the remaining item cards first.');
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

      // Only send names that exist on the real NosPos #items-form (from snapshot).
      // Order matches cards so the extension applies in a stable sequence.
      const namesInOrder = [];
      const seen = new Set();
      const currentSnapshotByName = {};
      for (const card of snapshot.cards || []) {
        for (const f of card.fields || []) {
          if (!f?.name || seen.has(f.name)) continue;
          seen.add(f.name);
          namesInOrder.push(f.name);
          currentSnapshotByName[f.name] = f.value != null ? String(f.value) : '';
        }
      }
      const fields = namesInOrder
        .map((name) => ({
          name,
          value: finalizedValues[name] != null ? String(finalizedValues[name]) : '',
        }))
        // Only apply changed fields; this avoids long flashing cycles across every control.
        .filter((f) => (currentSnapshotByName[f.name] ?? '') !== f.value);

      // Apply all fields, retrying any controls that were temporarily missing.
      let pendingFields = [...fields];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (pendingFields.length === 0) break;
        const r1 = await nosposAgreementApplyFields(pendingFields);
        if (!r1?.ok && !Array.isArray(r1?.missing) && !Array.isArray(r1?.failed)) {
          throw new Error(
            r1?.error || 'Could not update the NosPos form. Is the agreement window still open?'
          );
        }
        const missing = Array.isArray(r1?.missing) ? r1.missing : [];
        const failed = Array.isArray(r1?.failed) ? r1.failed : [];
        const failedNames = failed
          .map((x) => x?.name)
          .filter(Boolean);
        const retryNames = new Set([...missing, ...failedNames]);
        if (retryNames.size === 0) {
          pendingFields = [];
          break;
        }
        console.warn(
          `[CG Suite] NosPos apply attempt ${attempt} retrying ${retryNames.size} control(s). Missing: ${missing.length}, Failed set: ${failedNames.length}`,
          { missing, failed }
        );
        pendingFields = pendingFields.filter((f) => retryNames.has(f.name));
        if (pendingFields.length > 0) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }
      if (pendingFields.length > 0) {
        const names = pendingFields.slice(0, 5).map((f) => f.name).join(', ');
        const more = pendingFields.length > 5 ? ', …' : '';
        throw new Error(
          `Could not copy all fields to NosPos (${pendingFields.length} field(s) still failing): ${names}${more}`
        );
      }

      // Brief pause so NosPos JS can react after synchronous bulk apply.
      await new Promise((r) => setTimeout(r, 120));

      let r2 = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        r2 = await nosposAgreementClickNext();
        if (r2?.ok) break;
        await new Promise((r) => setTimeout(r, 360));
      }
      if (!r2?.ok) {
        throw new Error(
          r2?.error ||
            'Could not press Next on NosPos. Check required fields on the NosPos page.'
        );
      }
      console.info('[CG Suite] NosPos Next submitted successfully.');
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

  if (!open) return null;

  const showForm = snapshot && !loading;
  const missingCardCount = Math.max(0, (sourceLines?.length || 0) - (snapshot?.cards?.length || 0));
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
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nospos-mirror-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={() => !busy && onClose?.()}
        aria-hidden="true"
      />
      <div
        className="relative flex max-h-[min(92vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--ui-border)] bg-[var(--ui-card)] shadow-[var(--brand-shadow-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/15 bg-brand-blue px-5 py-4 text-white">
          <div className="min-w-0">
            <h2 id="nospos-mirror-title" className="text-xl font-bold leading-none tracking-tight">
              NosPos agreement — items
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/70">
              Choosing a category updates NosPos immediately; AI and manual field changes sync to NosPos as they are
              made. When an item is complete, CG Suite adds the next NosPos card automatically.
              {requestId != null ? ` Request ${requestId}.` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="shrink-0 rounded-xl border border-white/20 p-2 text-white transition hover:bg-white/15 disabled:opacity-50"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showForm ? (
            <div className="px-4 py-4">
              {(missingCardCount > 0 || validationErrors.size > 0) && (
                <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                  {validationErrors.size > 0
                    ? 'Fill the highlighted required NosPos fields before CG Suite can continue.'
                    : `Preparing the next item card in NoSpos${missingCardCount > 1 ? ` (${missingCardCount} remaining)` : ''}...`}
                </div>
              )}
              {(snapshot.cards || []).map((card, cardIdx) => {
                const { categoryFields, otherFields } = partitionCardFields(card.fields);
                const cardItem = sourceLines?.[cardIdx] ?? null;
                return (
                  <section
                    key={card.cardId}
                    className="mb-4 overflow-hidden rounded-[var(--radius)] border border-[var(--ui-border)] bg-[var(--ui-bg)] last:mb-0"
                  >
                    <div className="border-b border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-2.5 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brand-blue)]">
                        {card.title || 'Item'}
                      </h3>
                      {(aiFillingCards.has(cardIdx) || applyingCards.has(cardIdx) || updatingCategoryCards.has(cardIdx)) && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
                          <span className="text-[10px] font-bold text-[var(--brand-blue)]">
                            {updatingCategoryCards.has(cardIdx)
                              ? 'Updating category…'
                              : aiFillingCards.has(cardIdx)
                                ? 'AI filling…'
                                : 'Syncing to NoSpos…'}
                          </span>
                        </div>
                      )}
                    </div>

                    {categoryFields.length > 0 ? (
                      <div className="border-b border-[var(--ui-border)] bg-[var(--brand-blue-alpha-05)] px-4 py-4">
                        <div className="grid grid-cols-1 gap-4">
                          {categoryFields.map((f) => (
                            <MirrorField
                              key={f.name}
                              field={f}
                              value={values[f.name] ?? ''}
                              onChange={handleCategoryFieldChange(f.name, cardIdx)}
                              showError={touched && f.required && validationErrors.has(f.name)}
                              item={cardItem}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {otherFields.map((f) => (
                        <MirrorField
                          key={f.name}
                          field={f}
                          value={values[f.name] ?? ''}
                          onChange={handleFieldChange(f.name, cardIdx)}
                          showError={touched && f.required && validationErrors.has(f.name)}
                        />
                      ))}
                    </div>
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

        {formError ? (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800">
            {formError}
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-[var(--radius)] border border-[var(--ui-border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--text-main)] hover:bg-[var(--ui-bg)] disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!canProceed}
            onClick={handleNext}
            className="rounded-[var(--radius)] bg-brand-orange px-5 py-2.5 text-sm font-black uppercase tracking-wide text-brand-blue transition hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : addingItem ? 'Adding item…' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
