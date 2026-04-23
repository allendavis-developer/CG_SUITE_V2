import {
  JEWELLERY_TIER_MARGINS_PCT,
  getJewelleryWorkspaceDerivedState,
  isJewelleryCoinLine,
  lineNeedsJewelleryWorkspaceDetail,
  finalizeJewelleryCoinUnitsInput,
  resolveJewelleryTierMarginsPct,
  sanitizeJewelleryWeightInput,
} from '@/components/jewellery/jewelleryNegotiationCart';
import { roundOfferPrice } from '@/utils/helpers';

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
  let coinUnits = '1';
  if (coin) {
    const fromRef = ref.jewellery_coin_units;
    const n = fromRef != null ? Math.floor(Number(fromRef)) : NaN;
    if (Number.isInteger(n) && n >= 1) coinUnits = String(n);
  }

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
    /** Buyer-entered total for "Other" material-grade lines (see computeWorkspaceLineTotal). */
    overrideReferenceTotal: ref.override_reference_total != null ? Number(ref.override_reference_total) : null,
    rrpTotalInput: ref.override_reference_total != null ? String(Number(ref.override_reference_total)) : undefined,
    weight: coin ? '1' : ref.weight != null && String(ref.weight).trim() !== '' ? String(ref.weight) : '0',
    weightUnit: coin ? 'each' : ref.weight_unit || 'g',
    ...(coin ? { coinUnits } : {}),
    selectedOfferTierPct,
    selectedOfferTierAuthBy: !isManual && item.seniorMgmtApprovedBy ? item.seniorMgmtApprovedBy : null,
    manualOfferInput,
    manualOfferAuthBy,
    authorisedOfferSlots: Array.from(new Set([...persistedAuthorisedSlots, ...runtimeAuthorisedSlots])),
    customerExpectation:
      item.customerExpectation != null && String(item.customerExpectation).trim() !== ''
        ? String(item.customerExpectation).trim()
        : '',
  };
}

export function negotiationJewelleryItemsToWorkspaceLines(items) {
  return items.map(negotiationJewelleryItemToWorkspaceLine).filter(Boolean);
}

/**
 * When negotiation rows re-project into the workspace, the item stores the grid-rounded offer
 * (`roundOfferPrice` + `formatOfferPrice` of the typed value). Without this merge, the manual-offer
 * cell is overwritten on every keystroke and no longer matches what the user typed.
 */
export function mergeJewelleryWorkspaceLinePreserveManualDraft(prevLine, mappedLine) {
  if (!prevLine) return mappedLine;
  const newRaw = String(mappedLine.manualOfferInput ?? '').trim();
  if (newRaw === '') return mappedLine;

  const oldRaw = String(prevLine.manualOfferInput ?? '').trim();
  if (oldRaw === '') return mappedLine;

  const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/[£,]/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  };

  const nMapped = parseNum(newRaw);
  if (!Number.isFinite(nMapped) || nMapped <= 0) return mappedLine;

  const nOld = parseNum(oldRaw);
  if (!Number.isFinite(nOld) || nOld <= 0) return mappedLine;

  if (roundOfferPrice(nOld) === nMapped) {
    return { ...mappedLine, manualOfferInput: prevLine.manualOfferInput };
  }
  return mappedLine;
}

/** True when a saved negotiation jewellery row still needs name and/or minimum weight (same rules as workspace). */
export function negotiationJewelleryLineNeedsWorkspaceDetail(item) {
  const wl = negotiationJewelleryItemToWorkspaceLine(item);
  if (!wl) return false;
  return lineNeedsJewelleryWorkspaceDetail(wl);
}

/**
 * Recompute negotiation row state when jewellery weight (workspace grams input) changes.
 * @returns {null | { cleaned: string, d: ReturnType<typeof getJewelleryWorkspaceDerivedState>, ourSale: number|null }} 
 */
export function deriveNegotiationJewelleryWeightUpdate(item, nextWeightRaw, useVoucherOffers, jewelleryRuleSettings) {
  const workspaceLine = negotiationJewelleryItemToWorkspaceLine(item);
  if (!workspaceLine) return null;
  const coin = isJewelleryCoinLine({
    productName: workspaceLine.productName,
    materialGrade: workspaceLine.materialGrade,
  });
  const cleaned = sanitizeJewelleryWeightInput(nextWeightRaw, coin);
  const updatedLine = { ...workspaceLine, weight: coin ? '1' : cleaned };
  const d = getJewelleryWorkspaceDerivedState(updatedLine, useVoucherOffers, jewelleryRuleSettings);
  const ourSale = d.ourSalePrice != null && d.ourSalePrice > 0 ? d.ourSalePrice : item.ourSalePrice;
  return { cleaned, d, ourSale };
}

/**
 * Recompute negotiation row state when coin unit count changes.
 * @returns {null | { cleaned: string, d: ReturnType<typeof getJewelleryWorkspaceDerivedState> }}
 */
export function deriveNegotiationJewelleryCoinUnitsUpdate(item, nextCoinUnitsRaw, useVoucherOffers, jewelleryRuleSettings) {
  const workspaceLine = negotiationJewelleryItemToWorkspaceLine(item);
  if (!workspaceLine) return null;
  const coin = isJewelleryCoinLine({
    productName: workspaceLine.productName,
    materialGrade: workspaceLine.materialGrade,
  });
  if (!coin) return null;
  const cleaned = finalizeJewelleryCoinUnitsInput(nextCoinUnitsRaw);
  const updatedLine = { ...workspaceLine, coinUnits: cleaned };
  const d = getJewelleryWorkspaceDerivedState(updatedLine, useVoucherOffers, jewelleryRuleSettings);
  return { cleaned, d };
}
