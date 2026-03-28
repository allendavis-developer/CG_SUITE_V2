import { formatOfferPrice, roundOfferPrice, toVoucherOfferPrice } from '@/utils/helpers';

/** 1st offer = 30% margin, then 20%, 10% — must match workspace column order. */
export const JEWELLERY_TIER_MARGINS_PCT = [30, 20, 10];

export function computeWorkspaceLineTotal(line) {
  if (line.sourceKind === 'UNIT') {
    const n = parseFloat(line.weight) || 0;
    return Math.round(n * (line.unitPrice || 0) * 100) / 100;
  }
  const w = parseFloat(line.weight) || 0;
  const rate = line.ratePerGram;
  if (rate == null || !Number.isFinite(rate)) return 0;
  const grams = line.weightUnit === 'kg' ? w * 1000 : w;
  return Math.round(grams * rate * 100) / 100;
}

export function tierOfferGbpFromReference(referenceTotalGbp, marginPct) {
  if (!Number.isFinite(referenceTotalGbp) || referenceTotalGbp <= 0) return 0;
  const raw = referenceTotalGbp * (1 - marginPct / 100);
  return roundOfferPrice(raw);
}

function buildJewelleryReferencePayload(line, total) {
  const ref = line.referenceEntry;
  return {
    jewellery_line: true,
    variant_id: line.variantId,
    product_name: line.productName,
    material_grade: line.materialGrade,
    line_title: line.variantTitle,
    reference_catalog_id: ref?.catalogId ?? null,
    reference_display_name: ref?.displayName ?? null,
    reference_section_title: ref?.sectionTitle ?? null,
    reference_price_source_kind: ref?.sourceKind ?? null,
    rate_per_gram: ref?.ratePerGram ?? null,
    unit_price: ref?.unitPrice ?? null,
    weight: line.weight,
    weight_unit: line.weightUnit,
    computed_total_gbp: total,
  };
}

/**
 * Reference totals, rebuilt tier offers, and selection (tier vs manual) for a workspace row.
 * @param {object} line
 * @param {boolean} useVoucherOffers
 * @returns {{ referenceData: object, cashOffers: array, voucherOffers: array, offers: array, selectedOfferId: string|null, manualOffer: string, manualOfferUsed: boolean, ourSalePrice: number|null }}
 */
export function getJewelleryWorkspaceDerivedState(line, useVoucherOffers) {
  const total = computeWorkspaceLineTotal(line);
  const referenceData = buildJewelleryReferencePayload(line, total);
  const cashOffers = JEWELLERY_TIER_MARGINS_PCT.map((p, idx) => ({
    id: `jew-cash-${p}`,
    title: ['1st Offer', '2nd Offer', '3rd Offer'][idx] || 'Offer',
    price: tierOfferGbpFromReference(total, p),
  }));
  const voucherOffers = cashOffers.map((o) => ({
    id: `jew-v-${o.id}`,
    title: o.title,
    price: toVoucherOfferPrice(o.price),
  }));
  const offers = useVoucherOffers ? voucherOffers : cashOffers;

  const manualRaw = String(line.manualOfferInput ?? '').trim();
  const manualVal = parseFloat(manualRaw.replace(/[£,]/g, ''));
  const hasManual = Number.isFinite(manualVal) && manualVal > 0;
  const pct = line.selectedOfferTierPct;
  const hasTier = pct != null && JEWELLERY_TIER_MARGINS_PCT.includes(pct);

  let selectedOfferId = null;
  let manualOffer = '';
  let manualOfferUsed = false;

  if (hasTier) {
    const cashId = `jew-cash-${pct}`;
    selectedOfferId = useVoucherOffers ? `jew-v-${cashId}` : cashId;
  } else if (hasManual) {
    const rounded = roundOfferPrice(manualVal);
    selectedOfferId = 'manual';
    manualOffer = formatOfferPrice(rounded);
    manualOfferUsed = true;
  }

  return {
    referenceData,
    cashOffers,
    voucherOffers,
    offers,
    selectedOfferId,
    manualOffer,
    manualOfferUsed,
    ourSalePrice: total > 0 ? Number(formatOfferPrice(total)) : null,
  };
}

/**
 * One workspace row → cart item for {@link handleAddNegotiationItem}.
 * Tier selection is optional: all three offers are still attached; `selectedOfferId` is set only when a tier was chosen.
 * @throws {Error} if reference total is not positive
 */
export function buildJewelleryNegotiationCartItem(line, useVoucherOffers) {
  const total = computeWorkspaceLineTotal(line);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Each jewellery item needs a positive reference total (check weight).');
  }
  const derived = getJewelleryWorkspaceDerivedState(line, useVoucherOffers);

  return {
    id: crypto.randomUUID?.() ?? `jew-neg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: line.variantTitle,
    subtitle: [line.referenceEntry?.displayName, `${line.weight}${line.weightUnit === 'each' ? ' ea' : line.weightUnit}`]
      .filter(Boolean)
      .join(' · '),
    quantity: 1,
    variantId: line.variantId,
    variantName: line.variantTitle,
    isJewelleryItem: true,
    referenceData: derived.referenceData,
    cashOffers: derived.cashOffers,
    voucherOffers: derived.voucherOffers,
    offers: derived.offers,
    selectedOfferId: derived.selectedOfferId,
    manualOffer: derived.manualOffer,
    manualOfferUsed: derived.manualOfferUsed,
    ourSalePrice: derived.ourSalePrice ?? Number(formatOfferPrice(total)),
    category: 'Jewellery',
    categoryObject: { name: 'Jewellery', path: ['Jewellery'] },
    request_item_id: null,
  };
}

export function buildJewelleryNegotiationCartItems(lines, useVoucherOffers) {
  return lines.map((line) => buildJewelleryNegotiationCartItem(line, useVoucherOffers));
}
