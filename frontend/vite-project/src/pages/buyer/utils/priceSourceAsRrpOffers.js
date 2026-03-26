import { applyRrpAndOffersFromPriceSource } from './negotiationHelpers';

/**
 * Apply right-click "Use as RRP/offers source" for a spreadsheet row.
 *
 * @param {object} item — row model
 * @param {string} zone — {@link import('../rowContextZones.js').NEGOTIATION_ROW_CONTEXT} price-source value
 * @param {object} ctx
 * @param {Function} [ctx.showNotification]
 * @param {Function} ctx.setItems — React setState for items array
 * @param {boolean} ctx.useVoucherOffers — transaction type store credit vs cash
 * @returns {boolean} true if applied
 */
export function handlePriceSourceAsRrpOffersSource(item, zone, ctx) {
  const { showNotification, setItems, useVoucherOffers } = ctx || {};
  if (!item || !setItems) return false;

  const { item: next, errorMessage } = applyRrpAndOffersFromPriceSource(item, zone, useVoucherOffers);
  if (errorMessage) {
    showNotification?.(errorMessage, 'error');
    return false;
  }
  setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
  showNotification?.('RRP and offers updated from selected source.', 'success');
  return true;
}
