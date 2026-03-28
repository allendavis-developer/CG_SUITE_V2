import { JEWELLERY_TIER_MARGINS_PCT } from '@/components/jewellery/jewelleryNegotiationCart';

/**
 * Map negotiation quote items (jewellery) ↔ workspace line shape used in the header panel.
 */

export function negotiationJewelleryItemToWorkspaceLine(item) {
  const ref = item.referenceData;
  if (!ref || ref.jewellery_line !== true) return null;

  const sid = item.selectedOfferId;
  const isManual = sid === 'manual';

  let selectedOfferTierPct = null;
  if (!isManual && sid) {
    const s = String(sid);
    const cashId = s.startsWith('jew-v-') ? s.slice('jew-v-'.length) : s;
    const m = cashId.match(/^jew-cash-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (JEWELLERY_TIER_MARGINS_PCT.includes(n)) selectedOfferTierPct = n;
    }
  }

  const mo = item.manualOffer != null ? String(item.manualOffer).trim() : '';
  const manualOfferInput =
    isManual && mo !== '' ? mo.replace(/[£,]/g, '').trim() : '';

  return {
    id: item.id,
    request_item_id: item.request_item_id ?? null,
    variantId: ref.variant_id,
    variantTitle: ref.line_title || item.variantName || item.title,
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
    weight: ref.weight != null ? String(ref.weight) : '1',
    weightUnit: ref.weight_unit || 'g',
    selectedOfferTierPct,
    manualOfferInput,
  };
}

export function negotiationJewelleryItemsToWorkspaceLines(items) {
  return items.map(negotiationJewelleryItemToWorkspaceLine).filter(Boolean);
}
