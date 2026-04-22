import { formatOfferPrice } from '@/utils/helpers';
import { slimCexNegotiationOfferRows } from '@/utils/cexOfferMapping';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';

/**
 * Preferred display tier list: non-empty typed array beats a stale `offers`
 * array so an accidental [] doesn't mask aligned tier data.
 */
export function getDisplayOffers(item, useVoucherOffers) {
  if (useVoucherOffers) {
    if (item.voucherOffers?.length) return item.voucherOffers;
    return item.offers || [];
  }
  if (item.cashOffers?.length) return item.cashOffers;
  return item.offers || [];
}

function getItemOfferTotal(item, useVoucherOffers) {
  if (item.isRemoved) return 0;
  const qty = item.quantity || 1;
  if (item.selectedOfferId === 'manual' && item.manualOffer) {
    return (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) * qty;
  }
  const selected = getDisplayOffers(item, useVoucherOffers)?.find((o) => o.id === item.selectedOfferId);
  return selected ? selected.price * qty : 0;
}

export function calculateItemTargetContribution(itemId, items, targetOffer, useVoucherOffers) {
  const parsedTarget = parseFloat(targetOffer);
  if (!parsedTarget || parsedTarget <= 0) return null;
  const otherTotal = items
    .filter((i) => !i.isRemoved && i.id !== itemId)
    .reduce((sum, i) => sum + getItemOfferTotal(i, useVoucherOffers), 0);
  return parsedTarget - otherTotal;
}

export function calculateTotalOfferPrice(items, useVoucherOffers) {
  return items.reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

export function calculateJewelleryOfferTotal(items, useVoucherOffers) {
  return items
    .filter((i) => !i.isRemoved && i.isJewelleryItem === true)
    .reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

export function calculateNonJewelleryOfferTotal(items, useVoucherOffers) {
  return items
    .filter((i) => !i.isRemoved && i.isJewelleryItem !== true)
    .reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

export function sumOfferMinMaxForNegotiationItems(items, useVoucherOffers) {
  const list = Array.isArray(items) ? items.filter((i) => i && !i.isRemoved) : [];
  if (list.length === 0) return { offerMin: null, offerMax: null };
  let min = 0;
  let max = 0;
  for (const item of list) {
    const qty = item.quantity || 1;
    const displayOffers = getDisplayOffers(item, useVoucherOffers);
    const prices = displayOffers.map((o) => Number(o.price)).filter((p) => !Number.isNaN(p) && p >= 0);
    if (prices.length > 0) {
      min += Math.min(...prices) * qty;
      max += Math.max(...prices) * qty;
    }
  }
  return { offerMin: min, offerMax: max };
}

export function offerMinMaxFromCexProductData(cexProductData, useVoucherOffers) {
  if (!cexProductData) return { offerMin: null, offerMax: null };
  const cashOffers = slimCexNegotiationOfferRows(cexProductData.cash_offers || []);
  const voucherOffers = slimCexNegotiationOfferRows(cexProductData.voucher_offers || []);
  const synthetic = {
    isRemoved: false,
    quantity: 1,
    cashOffers,
    voucherOffers,
    offers: cashOffers.length ? cashOffers : voucherOffers,
  };
  const display = getDisplayOffers(synthetic, useVoucherOffers);
  if (!display.length) return { offerMin: null, offerMax: null };
  return sumOfferMinMaxForNegotiationItems([synthetic], useVoucherOffers);
}

export function offerMinMaxFromResearchBuyOffers(buyOffers, useVoucherOffers) {
  const rows = Array.isArray(buyOffers) ? buyOffers : [];
  if (rows.length === 0) return { offerMin: null, offerMax: null };
  const cashOffers = rows.map((o, idx) => ({
    id: `research-cash-${idx + 1}`,
    title: titleForEbayCcOfferIndex(idx),
    price: Number(formatOfferPrice(o.price)),
  }));
  const voucherOffers = cashOffers.map((co) => ({
    id: `research-voucher-${co.id}`,
    title: co.title,
    price: Number(formatOfferPrice(co.price * 1.1)),
  }));
  const synthetic = {
    isRemoved: false,
    quantity: 1,
    cashOffers,
    voucherOffers,
    offers: cashOffers.length ? cashOffers : voucherOffers,
  };
  return sumOfferMinMaxForNegotiationItems([synthetic], useVoucherOffers);
}

export function offerMinMaxFromWorkspaceOfferRows(offers, useVoucherOffers) {
  const rows = Array.isArray(offers) ? offers : [];
  if (rows.length === 0) return { offerMin: null, offerMax: null };
  return sumOfferMinMaxForNegotiationItems(
    [
      {
        isRemoved: false,
        quantity: 1,
        cashOffers: useVoucherOffers ? [] : rows,
        voucherOffers: useVoucherOffers ? rows : [],
        offers: rows,
      },
    ],
    useVoucherOffers
  );
}
