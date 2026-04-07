/**
 * One-shot NosPos stock field AI at negotiation add time: load linked fields for a
 * NosPos category, call suggest-fields once, persist under raw_data for mirror view.
 */
import { fetchNosposCategories } from '@/services/api';
import {
  normalizeAiFieldResponseKeys,
  shouldSkipAiFill,
  suggestFieldValues,
} from '@/services/aiCategoryService';
import { summariseNegotiationItemForAi } from '@/services/aiCategoryPathCascade';

export const AI_SUGGESTED_NOSPOS_FIELD_VALUES_KEY = 'aiSuggestedNosposStockFieldValues';

function syntheticFieldName(nosposFieldId) {
  return `cg_nf_${nosposFieldId}`;
}

export function linkedFieldsForCategory(nosposCategoryId, categoriesResults) {
  const nid = Number(nosposCategoryId);
  if (!Number.isFinite(nid) || nid <= 0) return [];
  const list = Array.isArray(categoriesResults) ? categoriesResults : [];
  const row = list.find((c) => Number(c.nosposId ?? c.nospos_id) === nid);
  return (row?.linkedFields || []).filter((lf) => lf.active === true);
}

/**
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
function attributePairsFromCartItem(negotiationItem) {
  const av = negotiationItem?.attributeValues;
  const al = negotiationItem?.attributeLabels || {};
  if (!av || typeof av !== 'object') return [];
  return Object.entries(av)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([code, v]) => ({
      code,
      label: al[code] != null && String(al[code]).trim() ? String(al[code]).trim() : code,
      value: String(v).trim(),
    }));
}

export async function buildNosposStockFieldAiPayload({
  nosposCategoryId,
  negotiationItem,
  source = 'negotiation_add',
  categoriesResults = null,
}) {
  const pairsFromCart = attributePairsFromCartItem(negotiationItem);
  console.log('[CG Suite][NosposFieldAi][add] cart attributes (raw)', {
    source,
    title: negotiationItem?.title,
    variantName: negotiationItem?.variantName,
    subtitle: negotiationItem?.subtitle,
    categoryObject: negotiationItem?.categoryObject?.name ?? negotiationItem?.categoryObject?.id,
    attributeValues: negotiationItem?.attributeValues ?? null,
    attributeLabels: negotiationItem?.attributeLabels ?? null,
    pairsResolved: pairsFromCart,
    variant_details: negotiationItem?.variant_details
      ? {
          attribute_values: negotiationItem.variant_details.attribute_values ?? negotiationItem.variant_details.attributeValues,
          attribute_labels: negotiationItem.variant_details.attribute_labels ?? negotiationItem.variant_details.attributeLabels,
        }
      : null,
    referenceDataAttributeValues:
      negotiationItem?.referenceData?.attribute_values ??
      negotiationItem?.referenceData?.attributeValues ??
      null,
  });

  const results =
    categoriesResults != null ? categoriesResults : (await fetchNosposCategories())?.results || [];
  const linked = linkedFieldsForCategory(nosposCategoryId, results);
  const entries = buildNosposFieldAiPayloadEntries(linked);
  if (!entries.length) {
    console.log('[CG Suite][NosposFieldAi][add] skip — no eligible linked fields', {
      nosposCategoryId,
      linkedCount: linked.length,
    });
    return null;
  }

  const item = summariseNegotiationItemForAi(negotiationItem);
  console.log('[CG Suite][NosposFieldAi][add] item summary sent to /api/ai/suggest-fields/', {
    name: item.name,
    dbCategory: item.dbCategory,
    attributes: item.attributes,
    attributeCount: Object.keys(item.attributes || {}).length,
    nosposFieldsRequested: entries.map((e) => ({ nosposFieldId: e._fid, apiName: e.name, label: e.label })),
  });

  const fieldsForApi = entries.map(({ name, label, control, options }) => ({
    name,
    label,
    control,
    options,
  }));

  const result = await suggestFieldValues({ item, fields: fieldsForApi });
  console.log('[CG Suite][NosposFieldAi][add] API response fields (raw keys)', result?.fields ?? null);

  const normalized = normalizeAiFieldResponseKeys(result.fields, fieldsForApi);
  console.log('[CG Suite][NosposFieldAi][add] normalized (after key-map cg_nf_* → canonical)', normalized);
  const byNosposFieldId = mapAiResponseToByFieldId(normalized, entries);
  console.log('[CG Suite][NosposFieldAi][add] byNosposFieldId (string ids → values)', byNosposFieldId);

  const labelById = Object.fromEntries(entries.map((e) => [String(e._fid), e.label]));

  if (!Object.keys(byNosposFieldId).length) {
    console.log('[CG Suite][NosposFieldAi][add] no values returned', {
      nosposCategoryId,
      fieldCount: entries.length,
      normalizedAfterKeyMap: normalized,
    });
    return null;
  }

  const payload = {
    nosposCategoryId: Number(nosposCategoryId),
    byNosposFieldId,
    source,
    savedAt: new Date().toISOString(),
  };
  const persistedLabeled = Object.fromEntries(
    Object.entries(byNosposFieldId).map(([id, val]) => [id, { label: labelById[id] || id, value: val }])
  );
  console.log('[CG Suite][NosposFieldAi][add] persisted', {
    nosposCategoryId: payload.nosposCategoryId,
    byNosposFieldId: persistedLabeled,
  });
  return payload;
}
