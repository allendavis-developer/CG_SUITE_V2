/**
 * Buyer-mode cart offer checks: block add when every visible offer is £0 or the chosen offer is £0.
 * @param {object} item - Cart item shape (offers, cashOffers, voucherOffers, selectedOfferId, manualOffer)
 * @param {boolean} useVoucherOffers - true when transaction is store credit / voucher list applies
 * @returns {string|null} Error message or null if valid
 */
export function validateBuyerCartItemOffers(item, useVoucherOffers) {
  const activeOffers =
    item.offers?.length > 0
      ? item.offers
      : useVoucherOffers
        ? item.voucherOffers || []
        : item.cashOffers || [];

  if (activeOffers.length > 0) {
    const allZeroOrInvalid = activeOffers.every((o) => {
      const p = Number(o?.price);
      return !Number.isFinite(p) || p <= 0;
    });
    if (allZeroOrInvalid) {
      return 'Cannot add this item: all offers are £0. Enter a positive offer before adding to cart.';
    }
  }

  if (item.selectedOfferId === 'manual') {
    const raw = item.manualOffer;
    const m =
      raw == null || raw === ''
        ? NaN
        : Number(String(raw).replace(/[£,]/g, ''));
    if (!Number.isFinite(m) || m <= 0) {
      return 'Cannot add this item: manual offer must be greater than £0.';
    }
    return null;
  }

  if (item.selectedOfferId != null && item.selectedOfferId !== '') {
    const pool = [
      ...(item.offers || []),
      ...(item.cashOffers || []),
      ...(item.voucherOffers || []),
    ];
    const sel = pool.find((o) => o && o.id === item.selectedOfferId);
    if (sel) {
      const p = Number(sel.price);
      if (!Number.isFinite(p) || p <= 0) {
        return 'Cannot add this item: the selected offer is £0. Choose a different offer or enter a positive price.';
      }
    }
  }

  return null;
}
