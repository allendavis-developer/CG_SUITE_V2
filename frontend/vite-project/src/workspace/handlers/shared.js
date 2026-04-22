/**
 * Shared helpers for workspace module handlers (buyer / reprice / upload).
 *
 * Everything in this file is module-agnostic: no branching on workspace kind,
 * no knowledge of backend endpoints. Handlers import what they need.
 */

import { normalizeExplicitSalePrice } from '@/utils/helpers';

/**
 * Match an incoming item against an existing cart entry. Shared across all
 * workspace kinds — dedupe rules are about the *item shape*, not the module.
 */
export function findDuplicateIndex(items, newItem) {
  return items.findIndex((ci) => {
    if (
      !newItem.isCustomEbayItem &&
      !newItem.isCustomCashConvertersItem &&
      !newItem.isCustomCashGeneratorItem &&
      newItem.variantId != null
    ) {
      return ci.variantId === newItem.variantId;
    }
    if (newItem.isCustomEbayItem) {
      return ci.isCustomEbayItem && ci.title === newItem.title && ci.category === newItem.category;
    }
    if (newItem.isCustomCashConvertersItem) {
      return ci.isCustomCashConvertersItem && ci.title === newItem.title && ci.category === newItem.category;
    }
    if (newItem.isCustomCashGeneratorItem) {
      return ci.isCustomCashGeneratorItem && ci.title === newItem.title && ci.category === newItem.category;
    }
    if (newItem.isCustomCeXItem) {
      return ci.isCustomCeXItem && ci.title === newItem.title && ci.subtitle === newItem.subtitle;
    }
    return false;
  });
}

export function normalizeOffers(offers) {
  if (!Array.isArray(offers)) return [];
  return offers.map((o) => ({
    id: o.id,
    title: o.title,
    price: normalizeExplicitSalePrice(o.price),
  }));
}

/**
 * Switch display offers between cash and voucher lists while keeping the same *slot*
 * selected (1st ↔ 1st, 2nd ↔ 2nd), since cash/voucher entries use different ids.
 */
export function recalcOffersForTransactionType(item, prevUseVoucher, newUseVoucher) {
  const prevOffers = prevUseVoucher
    ? (item.voucherOffers?.length ? item.voucherOffers : item.offers ?? [])
    : (item.cashOffers?.length ? item.cashOffers : item.offers ?? []);
  const nextOffers = newUseVoucher ? (item.voucherOffers ?? []) : (item.cashOffers ?? []);

  let selectedOfferId = item.selectedOfferId;

  if (selectedOfferId !== 'manual' && selectedOfferId != null && selectedOfferId !== '') {
    const prevIndex = prevOffers.findIndex((o) => o.id === selectedOfferId);
    if (prevIndex >= 0 && nextOffers[prevIndex]) {
      selectedOfferId = nextOffers[prevIndex].id;
    } else if (!nextOffers.some((o) => o.id === selectedOfferId)) {
      selectedOfferId = null;
    }
  }

  return {
    ...item,
    offers: nextOffers,
    offerType: newUseVoucher ? 'voucher' : 'cash',
    selectedOfferId,
  };
}

export function coerceQuantity(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
