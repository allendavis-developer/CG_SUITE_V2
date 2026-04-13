import {
  applyRrpAndOffersFromPriceSource,
  applyRrpOnlyFromPriceSource,
} from './negotiationHelpers';

/**
 * Apply right-click "Use as RRP/offers source" for a spreadsheet row.
 *
 * @param {object} item — row model
 * @param {string} zone — {@link import('../rowContextZones.js').NEGOTIATION_ROW_CONTEXT} price-source value
 * @param {object} ctx
 * @param {Function} [ctx.showNotification]
 * @param {Function} ctx.setItems — React setState for items array
 * @param {boolean} ctx.useVoucherOffers — transaction type store credit vs cash
 * @param {boolean} [ctx.repricingRrpOnly] — repricing table: only update New Sale Price + RRP source (no tier offers)
 * @returns {boolean} true if applied
 */
export function handlePriceSourceAsRrpOffersSource(item, zone, ctx) {
  const { showNotification, setItems, useVoucherOffers, repricingRrpOnly } = ctx || {};
  if (!item || !setItems) return false;

  if (repricingRrpOnly) {
    const { item: next, errorMessage } = applyRrpOnlyFromPriceSource(item, zone);
    if (errorMessage) {
      showNotification?.(errorMessage, 'error');
      return false;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    showNotification?.('New Sale Price updated from selected source.', 'success');
    return true;
  }

  const { item: next, errorMessage } = applyRrpAndOffersFromPriceSource(item, zone, useVoucherOffers);
  if (errorMessage) {
    showNotification?.(errorMessage, 'error');
    return false;
  }
  setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
  showNotification?.('RRP and offers updated from selected source.', 'success');
  return true;
}
