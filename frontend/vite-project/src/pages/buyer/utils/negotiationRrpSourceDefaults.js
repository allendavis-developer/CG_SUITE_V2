import { NEGOTIATION_ROW_CONTEXT } from '../rowContextZones';

/**
 * Rows that carry CeX trade/sell context usually keep CeX tiers unless the row's offer source
 * is eBay or Cash Converters (`resolveOffersSource`), in which case research rebuilds those tiers.
 */
export function isCeXBackedNegotiationItem(item) {
  if (!item) return false;
  if (item.isCustomCeXItem === true) return true;
  if (item.variantId != null && item.variantId !== '') return true;
  if (item.cexSku != null && item.cexSku !== '') return true;
  if (item.cexBuyPrice != null && item.cexBuyPrice !== '') return true;
  if (item.cexVoucherPrice != null && item.cexVoucherPrice !== '') return true;
  if (item.cexSellPrice != null && item.cexSellPrice !== '') return true;
  return false;
}

/**
 * Default RRP + offer-tier source when unset: CeX-backed rows → Sell column;
 * eBay-primary rows → eBay column. `offersSource` mirrors `rrpOffersSource` unless set explicitly.
 */
export function withDefaultRrpOffersSource(item) {
  if (!item) return item;
  let next = { ...item };
  if (next.offersSource == null || next.offersSource === '') {
    if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
      next.offersSource = next.rrpOffersSource;
    }
  }
  if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
    return next;
  }
  if (isCeXBackedNegotiationItem(next)) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
    return {
      ...next,
      rrpOffersSource: z,
      offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z,
    };
  }
  if (
    next.isCustomEbayItem === true ||
    (next.ebayResearchData && !next.isCustomCashConvertersItem)
  ) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
    return {
      ...next,
      rrpOffersSource: z,
      offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z,
    };
  }
  return next;
}
