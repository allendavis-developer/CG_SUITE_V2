import { linkedFieldsForCategory } from '@/pages/buyer/utils/nosposFieldAiAtAdd';
import { nosposCaratHallmarkValueForMaterialGrade } from '@/pages/buyer/utils/jewelleryNosposMaterialGradeMap';
import {
  nosposFieldValueMapFromPersisted,
  resolveNosposLeafCategoryIdForAgreementItem,
} from '@/utils/nosposCategoryMappings';
import { getDisplayOffers, resolveOurSalePrice } from '@/pages/buyer/utils/negotiationHelpers';

/**
 * Map CG Suite / jewellery workspace data → NosPos stock field labels on the agreement line.
 * `nosposLabel` must match the label text NosPos shows (extension finds controls by label).
 * Entries run first; add rows here for more attributes.
 */
const OUR_ATTR_TO_NOSPOS_STOCK = [
  {
    /** Must match Nospos agreement line label text (extension finds control by label). */
    nosposLabel: 'Carat / Hallmark',
    resolveValue(item) {
      if (!item || item.isJewelleryItem !== true) return null;
      const ref = item.referenceData || {};
      const mg = ref.material_grade ?? ref.materialGrade;
      return nosposCaratHallmarkValueForMaterialGrade(mg);
    },
  },
  {
    nosposLabel: 'Weight (g)',
    resolveValue(item) {
      if (!item || item.isJewelleryItem !== true) return null;
      const ref = item.referenceData;
      let rawW;
      let unit;
      if (ref?.jewellery_line === true && ref.weight != null && String(ref.weight).trim() !== '') {
        rawW = ref.weight;
        unit = ref.weight_unit;
      } else if (item.weight != null && String(item.weight).trim() !== '') {
        rawW = item.weight;
        unit = item.weightUnit ?? item.weight_unit ?? 'g';
      } else {
        return null;
      }
      const w = parseFloat(String(rawW).replace(/,/g, ''));
      if (!Number.isFinite(w) || w <= 0) return null;
      const u = String(unit ?? 'g').trim().toLowerCase();
      if (u === 'each') return null;
      let grams;
      if (u === 'kg') grams = w * 1000;
      else if (u === 'g' || u === '') grams = w;
      else return null;
      const rounded = Math.round(grams * 10000) / 10000;
      if (Number.isInteger(rounded)) return String(rounded);
      const s = String(rounded);
      return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    },
  },
];

function stockFieldLabelDedupeKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Embedded in NosPos item description so park flow can find an existing row and skip Add.
 * Includes request id and, when present, request_item_id. Line index is 1-based for readability.
 */
export function nosposParkLineMarker(requestId, lineIndexZeroBased, requestItemId) {
  const id = String(requestId ?? '').trim();
  if (!id) return '';
  const n = Math.max(0, parseInt(String(lineIndexZeroBased), 10) || 0);
  const ri =
    requestItemId != null && String(requestItemId).trim() !== ''
      ? String(requestItemId).trim()
      : '';
  if (ri) return `[CG-RQ-${id}-RI-${ri}-L${n + 1}]`;
  return `[CG-RQ-${id}-L${n + 1}]`;
}

/** Same display title as Park Agreement modal / line label (no React import). */
export function agreementItemNameForNosposPark(item, index) {
  if (!item) return `Item ${index + 1}`;
  const ref = item.referenceData || {};
  if (item.isJewelleryItem) {
    return (
      String(
        ref.item_name ||
          ref.line_title ||
          ref.reference_display_name ||
          ref.product_name ||
          item.variantName ||
          item.title ||
          'Jewellery',
      ).trim() || 'Jewellery'
    );
  }
  return (
    String(item.variantName || item.title || ref.product_name || `Item ${index + 1}`).trim() ||
    `Item ${index + 1}`
  );
}

function resolveLineOfferPerUnit(item, useVoucherOffers) {
  if (!item || item.isRemoved) return null;
  if (item.selectedOfferId === 'manual' && item.manualOffer) {
    const n = parseFloat(String(item.manualOffer).replace(/[£,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const selected = getDisplayOffers(item, useVoucherOffers)?.find((o) => o.id === item.selectedOfferId);
  if (!selected || selected.price == null) return null;
  const n = Number(selected.price);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a JSON-serialisable payload for the extension to fill the first NoSpos agreement line.
 *
 * @param {object} item - negotiation line
 * @param {number} negotiationIndex - 0-based index in `parkNegotiationLines` order (UI / progress labels)
 * @param {{ useVoucherOffers: boolean, categoriesResults?: object[], categoryMappings?: object[], requestId?: string|number|null, parkSequentialIndex?: number }} options
 * `parkSequentialIndex`: 0-based count among non-excluded lines up to this row — must match `stepIndex` in
 * `resolveNosposParkAgreementLine` so description markers line up with Add vs fill-row behaviour.
 * (Marker in description uses `item.request_item_id` when set.)
 */
export function buildNosposAgreementFirstItemFillPayload(item, negotiationIndex, options) {
  const useVoucherOffers = options?.useVoucherOffers === true;
  const categoriesResults = Array.isArray(options?.categoriesResults) ? options.categoriesResults : [];
  const categoryMappings = Array.isArray(options?.categoryMappings) ? options.categoryMappings : null;
  const markerSeqIndex =
    options?.parkSequentialIndex != null && Number.isFinite(Number(options.parkSequentialIndex))
      ? Math.max(0, parseInt(String(options.parkSequentialIndex), 10) || 0)
      : negotiationIndex;

  const categoryId = resolveNosposLeafCategoryIdForAgreementItem(item, {
    categoryMappings,
    nosposCategoriesResults: categoriesResults,
  });
  const baseName = agreementItemNameForNosposPark(item, negotiationIndex);
  const cgParkLineMarker = nosposParkLineMarker(options?.requestId, markerSeqIndex, item?.request_item_id);
  const name = String(baseName || '').trim();
  /** NosPos “Item description” — holds CG marker so park can find an existing row without touching the name. */
  const itemDescription = cgParkLineMarker ? String(cgParkLineMarker).trim() : '';
  const qty = Math.max(1, Number(item?.quantity) || 1);
  const rrp = item ? resolveOurSalePrice(item) : null;
  const retailPrice =
    rrp != null && Number.isFinite(rrp) && rrp > 0 ? String(Number(rrp.toFixed(2))) : null;
  const perUnit = item ? resolveLineOfferPerUnit(item, useVoucherOffers) : null;
  const boughtFor =
    perUnit != null && Number.isFinite(perUnit) && perUnit >= 0
      ? String(Number(perUnit.toFixed(2)))
      : null;

  const linked =
    categoryId != null && Number(categoryId) > 0
      ? linkedFieldsForCategory(categoryId, categoriesResults)
      : [];
  const fieldMap = item ? nosposFieldValueMapFromPersisted(item) : {};

  const stockFields = [];
  const presetLabelKeys = new Set();

  for (const row of OUR_ATTR_TO_NOSPOS_STOCK) {
    const v = row.resolveValue(item);
    if (v == null || String(v).trim() === '') continue;
    const label = String(row.nosposLabel).trim();
    if (!label) continue;
    stockFields.push({ label, value: String(v).trim() });
    presetLabelKeys.add(stockFieldLabelDedupeKey(label));
  }

  const requiredWithData = [];
  const requiredMissing = [];
  const optionalFilled = [];

  for (const lf of linked) {
    const fid = String(lf.nosposFieldId ?? lf.nospos_field_id ?? '');
    const label = String(lf.name || '').trim();
    if (!fid || !label) continue;
    const isReq = lf.required === true;
    const dedupeKey = stockFieldLabelDedupeKey(label);

    if (presetLabelKeys.has(dedupeKey)) {
      if (isReq) requiredWithData.push(label);
      continue;
    }

    const val = fieldMap[fid];
    if (val) {
      stockFields.push({ label, value: val });
      if (isReq) requiredWithData.push(label);
      else optionalFilled.push(label);
    } else if (isReq) {
      requiredMissing.push(label);
    }
  }

  return {
    categoryId: categoryId != null && String(categoryId).trim() ? String(categoryId).trim() : '',
    name: String(name || '').trim(),
    itemDescription,
    cgParkLineMarker,
    quantity: String(qty),
    retailPrice,
    boughtFor,
    stockFields,
    stockCoverage: { requiredWithData, requiredMissing, optionalFilled },
  };
}

export function formatParkStockCoverageDetail(cov) {
  if (!cov || typeof cov !== 'object') return null;
  const { requiredWithData, requiredMissing, optionalFilled } = cov;
  const bits = [];
  if (requiredWithData?.length) bits.push(`Required (have data): ${requiredWithData.join(', ')}`);
  if (optionalFilled?.length) bits.push(`Optional filled: ${optionalFilled.join(', ')}`);
  if (requiredMissing?.length) bits.push(`Required (no CG data): ${requiredMissing.join(', ')}`);
  return bits.length ? bits.join(' · ') : 'No linked NosPos fields for this category (or categories not loaded).';
}

export function formatParkCoreFillDetail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const bits = [];
  if (payload.name) {
    const n = String(payload.name);
    bits.push(`Name → ${n.length > 90 ? `${n.slice(0, 90)}…` : n}`);
  }
  if (payload.itemDescription) {
    const d = String(payload.itemDescription);
    bits.push(`Description → ${d.length > 60 ? `${d.slice(0, 60)}…` : d}`);
  }
  if (payload.quantity) bits.push(`Qty → ${payload.quantity}`);
  if (payload.retailPrice) bits.push(`Retail £${payload.retailPrice}`);
  if (payload.boughtFor) bits.push(`Offer £${payload.boughtFor} (per unit)`);
  return bits.length ? bits.join(' · ') : 'Add RRP and select an offer in CG Suite to pre-fill prices.';
}
