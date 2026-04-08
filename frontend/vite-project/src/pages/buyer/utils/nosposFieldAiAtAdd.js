/**
 * One-shot NosPos stock field AI at negotiation add time: load linked fields for a
 * NosPos category, call suggest-fields once, persist under raw_data for mirror view.
 *
 * Gated by `ENABLE_NOSPOS_STOCK_FIELD_AI` in `@/config/cgSuiteFeatureFlags`.
 */
import { fetchNosposCategories } from '@/services/api';
import {
  normalizeAiFieldResponseKeys,
  shouldSkipAiFill,
  suggestFieldValues,
} from '@/services/aiCategoryService';
import { summariseNegotiationItemForAi } from '@/services/aiCategoryPathCascade';
import {
  getBoundedNosposStockFieldSelect,
  snapAiValueToBoundedSelectOptions,
} from '@/pages/buyer/utils/nosposStockFieldBoundedSelects';

export const AI_SUGGESTED_NOSPOS_FIELD_VALUES_KEY = 'aiSuggestedNosposStockFieldValues';

function syntheticFieldName(nosposFieldId) {
  return `cg_nf_${nosposFieldId}`;
}

function logNosposFieldsOnce(payload) {
  console.log('[CG Suite][NosposFieldAi] fields', payload);
}

export function linkedFieldsForCategory(nosposCategoryId, categoriesResults) {
  const nid = Number(nosposCategoryId);
  if (!Number.isFinite(nid) || nid <= 0) return [];
  const list = Array.isArray(categoriesResults) ? categoriesResults : [];
  const row = list.find((c) => Number(c.nosposId ?? c.nospos_id) === nid);
  return (row?.linkedFields || []).filter((lf) => lf.active === true);
}

/**
 * Build field entries for /api/ai/suggest-fields/.
 *
 * Linked fields with a **bounded** label (e.g. Storage, Network — see `nosposStockFieldBoundedSelects`)
 * are sent as `control: 'select'` with only NosPos option values, and **only if** `lf.required === true`
 * (optional bounded fields are left for staff / table editors).
 *
 * All other eligible fields stay `text` as before. Jewellery Carat/Hallmark remains excluded via
 * `shouldSkipAiFill`, with presets handled separately.
 *
 * @param {object[]} linked
 * @returns {{ name: string, label: string, control: string, options: { value: string, text: string }[], _fid: number }[]}
 */
export function buildNosposFieldAiPayloadEntries(linked) {
  const out = [];
  for (const lf of linked) {
    const fid = lf.nosposFieldId ?? lf.nospos_field_id;
    if (fid == null || Number(fid) <= 0) continue;
    const label = String(lf.name || '').trim() || `Field ${fid}`;
    const stub = { name: syntheticFieldName(fid), label };
    if (shouldSkipAiFill(stub)) continue;

    const bounded = getBoundedNosposStockFieldSelect(label);
    if (bounded) {
      if (lf.required !== true) continue;
      out.push({
        name: syntheticFieldName(fid),
        label,
        control: 'select',
        options: bounded.options,
        _fid: Number(fid),
      });
      continue;
    }

    out.push({
      name: syntheticFieldName(fid),
      label,
      control: 'text',
      options: [],
      _fid: Number(fid),
    });
  }
  return out;
}

function mapAiResponseToByFieldId(normalized, entries) {
  const byNosposFieldId = {};
  for (const e of entries) {
    const v = normalized[e.name];
    if (v != null && String(v).trim()) byNosposFieldId[String(e._fid)] = String(v).trim();
  }
  return byNosposFieldId;
}

/**
 * @param {object} params
 * @param {number|string} params.nosposCategoryId
 * @param {object} params.negotiationItem  - normalized negotiation line (for item summary)
 * @param {string} [params.source]
 * @param {object[]|null} [params.categoriesResults] - if null, fetches /nospos-categories/
 * @returns {Promise<object|null>} payload for raw_data[AI_SUGGESTED_NOSPOS_FIELD_VALUES_KEY] or null
 */
export async function buildNosposStockFieldAiPayload({
  nosposCategoryId,
  negotiationItem,
  source = 'negotiation_add',
  categoriesResults = null,
}) {
  const itemLabel =
    negotiationItem?.title ||
    negotiationItem?.variantName ||
    summariseNegotiationItemForAi(negotiationItem).name ||
    null;
  const lineId = negotiationItem?.id ?? null;

  const results =
    categoriesResults != null ? categoriesResults : (await fetchNosposCategories())?.results || [];
  const linked = linkedFieldsForCategory(nosposCategoryId, results);
  const entries = buildNosposFieldAiPayloadEntries(linked);
  if (!entries.length) {
    logNosposFieldsOnce({
      source,
      item: itemLabel,
      lineId,
      nosposCategoryId: Number(nosposCategoryId),
      outcome: 'skip_no_eligible_fields',
      linkedFieldCount: linked.length,
      fieldValues: null,
    });
    return null;
  }

  const item = summariseNegotiationItemForAi(negotiationItem);

  const fieldsForApi = entries.map(({ name, label, control, options }) => ({
    name,
    label,
    control,
    options,
  }));

  let result;
  try {
    result = await suggestFieldValues({ item, fields: fieldsForApi });
  } catch (e) {
    logNosposFieldsOnce({
      source,
      item: itemLabel,
      lineId,
      nosposCategoryId: Number(nosposCategoryId),
      outcome: 'error',
      fieldValues: null,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  const normalized = normalizeAiFieldResponseKeys(result.fields, fieldsForApi);

  const snapped = { ...normalized };
  const dropped = [];
  for (const e of entries) {
    if (!e.options?.length) continue;
    const v = snapped[e.name];
    if (v == null || String(v).trim() === '') continue;
    const fixed = snapAiValueToBoundedSelectOptions(v, e.options);
    if (fixed) {
      snapped[e.name] = fixed;
    } else {
      delete snapped[e.name];
      dropped.push({ label: e.label, value: v });
    }
  }

  const byNosposFieldId = mapAiResponseToByFieldId(snapped, entries);

  const labelById = Object.fromEntries(entries.map((e) => [String(e._fid), e.label]));

  if (!Object.keys(byNosposFieldId).length) {
    logNosposFieldsOnce({
      source,
      item: itemLabel,
      lineId,
      nosposCategoryId: Number(nosposCategoryId),
      outcome: 'skip_no_values',
      requestedFieldCount: entries.length,
      fieldValues: null,
      dropped: dropped.length ? dropped : undefined,
    });
    return null;
  }

  const payload = {
    nosposCategoryId: Number(nosposCategoryId),
    byNosposFieldId,
    source,
    savedAt: new Date().toISOString(),
  };
  const fieldValues = Object.fromEntries(
    Object.entries(byNosposFieldId).map(([id, val]) => [id, { label: labelById[id] || id, value: val }])
  );
  logNosposFieldsOnce({
    source,
    item: itemLabel,
    lineId,
    nosposCategoryId: payload.nosposCategoryId,
    outcome: 'ok',
    fieldValues,
    dropped: dropped.length ? dropped : undefined,
  });
  return payload;
}
