/**
 * Identifies which spreadsheet cell opened the row context menu.
 * Used by negotiation + repricing tables so menu actions stay scoped to the intended column.
 */
export const NEGOTIATION_ROW_CONTEXT = {
  /** Item title / meta column — remove row only (no manual offer / price-source actions). */
  ITEM_META: 'item-meta',
  MANUAL_OFFER: 'manual-offer',
  PRICE_SOURCE_CEX_SELL: 'price-source-cex-sell',
  PRICE_SOURCE_EBAY: 'price-source-ebay',
  PRICE_SOURCE_CASH_CONVERTERS: 'price-source-cash-converters',
};

/** @param {string} zone @returns {boolean} */
export function isNegotiationPriceSourceZone(zone) {
  return (
    zone === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL ||
    zone === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY ||
    zone === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS
  );
}

/** Add to `<td>` for full brand-blue RRP/offers source column (styles in `spreadsheetTableStyles.js`). */
export const RRP_SOURCE_CELL_CLASS = 'negotiation-rrp-source-cell';
