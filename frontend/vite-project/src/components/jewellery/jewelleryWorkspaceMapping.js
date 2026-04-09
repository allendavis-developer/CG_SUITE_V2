import {
  JEWELLERY_TIER_MARGINS_PCT,
  getJewelleryWorkspaceDerivedState,
  isJewelleryCoinLine,
  resolveJewelleryTierMarginsPct,
} from '@/components/jewellery/jewelleryNegotiationCart';

/**
 * Map negotiation quote items (jewellery) ↔ workspace line shape used in the header panel.
 */

export function negotiationJewelleryItemToWorkspaceLine(item) {
  const ref = item.referenceData;
  if (!ref || ref.jewellery_line !== true) return null;

  const sid = item.selectedOfferId;
  const isManual = sid === 'manual';

  let selectedOfferTierPct = null;
  const tierMargins = resolveJewelleryTierMarginsPct(ref?.jewellery_offer_margins_pct);
  if (!isManual && sid) {
    const s = String(sid);
    const cashId = s.startsWith('jew-v-') ? s.slice('jew-v-'.length) : s;
    const tierIdx = cashId.match(/^jew-cash_([1-4])$/);
    if (tierIdx) {
      const i = Number(tierIdx[1]) - 1;
      const pct = tierMargins[i];
      if (pct != null) selectedOfferTierPct = pct;
    } else {
      const m = cashId.match(/^jew-cash-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (tierMargins.includes(n) || JEWELLERY_TIER_MARGINS_PCT.includes(n)) selectedOfferTierPct = n;
      }
    }
  }

  const mo = item.manualOffer != null ? String(item.manualOffer).trim() : '';
  const manualOfferInput =
    isManual && mo !== '' ? mo.replace(/[£,]/g, '').trim() : '';
  const manualOfferAuthBy = isManual && item.seniorMgmtApprovedBy ? item.seniorMgmtApprovedBy : null;
  const persistedAuthorisedSlots = Array.isArray(item?.rawData?.authorisedOfferSlots)
    ? item.rawData.authorisedOfferSlots
    : [];
  const runtimeAuthorisedSlots = Array.isArray(item?.authorisedOfferSlots) ? item.authorisedOfferSlots : [];

  const coin = isJewelleryCoinLine({ productName: ref.product_name, materialGrade: ref.material_grade });

  return {
    id: item.id,
    request_item_id: item.request_item_id ?? null,
    jewelleryDbCategoryId:
      item.categoryObject?.id != null && Number(item.categoryObject.id) > 0
        ? Number(item.categoryObject.id)
        : null,
    variantId: ref.variant_id,
    variantTitle: ref.line_title || item.variantName || item.title,
    categoryLabel: ref.category_label || ref.line_title || item.variantName || item.title,
    itemName: ref.item_name || ref.category_label || ref.line_title || item.variantName || item.title,
    productName: ref.product_name,
    materialGrade: ref.material_grade,
    referenceEntry: {
      catalogId: ref.reference_catalog_id,
      sectionTitle: ref.reference_section_title,
      displayName: ref.reference_display_name,
      sourceKind: ref.reference_price_source_kind,
      ratePerGram: ref.rate_per_gram != null ? Number(ref.rate_per_gram) : null,
      unitPrice: ref.unit_price != null ? Number(ref.unit_price) : null,
    },
    sourceKind: ref.reference_price_source_kind,
    ratePerGram: ref.rate_per_gram != null ? Number(ref.rate_per_gram) : null,
    unitPrice: ref.unit_price != null ? Number(ref.unit_price) : null,
    weight: coin ? '1' : ref.weight != null ? String(ref.weight) : '1',
    weightUnit: coin ? 'each' : ref.weight_unit || 'g',
    selectedOfferTierPct,
    selectedOfferTierAuthBy: !isManual && item.seniorMgmtApprovedBy ? item.seniorMgmtApprovedBy : null,
    manualOfferInput,
    manualOfferAuthBy,
    authorisedOfferSlots: Array.from(new Set([...persistedAuthorisedSlots, ...runtimeAuthorisedSlots])),
  };
}

export function negotiationJewelleryItemsToWorkspaceLines(items) {
  return items.map(negotiationJewelleryItemToWorkspaceLine).filter(Boolean);
}

/**
 * Recompute negotiation row state when jewellery weight (workspace grams input) changes.
 * @returns {null | { cleaned: string, d: ReturnType<typeof getJewelleryWorkspaceDerivedState>, ourSale: number|null }} 
 */
export function deriveNegotiationJewelleryWeightUpdate(item, nextWeightRaw, useVoucherOffers, jewelleryRuleSettings) {
  const cleaned = String(nextWeightRaw ?? '').replace(/[^0-9.]/g, '');
  const workspaceLine = negotiationJewelleryItemToWorkspaceLine(item);
  if (!workspaceLine) return null;
  const updatedLine = { ...workspaceLine, weight: cleaned };
  const d = getJewelleryWorkspaceDerivedState(updatedLine, useVoucherOffers, jewelleryRuleSettings);
  const ourSale = d.ourSalePrice != null && d.ourSalePrice > 0 ? d.ourSalePrice : item.ourSalePrice;
  return { cleaned, d, ourSale };
}
