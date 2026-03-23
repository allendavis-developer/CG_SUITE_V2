import { roundOfferPrice, roundSalePrice } from '@/utils/helpers';

/**
 * Stats and buy-offer helpers for research forms (works with listings whose price may be string or number).
 * Offer prices follow the same rounding rules used elsewhere in the app.
 */

function parsePrice(item) {
  if (item == null || item.price == null) return NaN;
  const p = item.price;
  if (typeof p === 'number') return isNaN(p) ? NaN : p;
  return parseFloat(String(p).replace(/[^0-9.]/g, '')) || NaN;
}

export function calculateStats(listingsData) {
  if (!listingsData || listingsData.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0 };
  }

  const prices = listingsData
    .map(parsePrice)
    .filter(p => !isNaN(p) && p > 0);

  if (prices.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0 };
  }

  const sum = prices.reduce((acc, p) => acc + p, 0);
  const average = sum / prices.length;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const median = sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];

  // Suggested sale price: £1 below median, then sale-price rounding (£5 / £2).
  const suggestedPrice = roundSalePrice(Math.max(median - 1, 0));

  return { average, median, suggestedPrice };
}

/**
 * @param {number} sellPrice - Suggested sale price from research
 * @param {[number, number, number]|null|undefined} pcts - Three % of sale values from rules (order need not be sorted)
 */
export function calculateBuyOffers(sellPrice, pcts) {
  if (!sellPrice || sellPrice <= 0) return [];
  const defaults = [40, 50, 60];
  const raw = [0, 1, 2].map((i) => {
    const v = pcts?.[i];
    return v != null && !Number.isNaN(Number(v)) ? Number(v) : defaults[i];
  });
  // 1st cash offer = lowest % / lowest £, then escalate to 3rd (avoids reversed rule fields or legacy ordering)
  const [p1, p2, p3] = [...raw].sort((a, b) => a - b);
  const price1 = roundOfferPrice(sellPrice * (p1 / 100));
  const price2 = roundOfferPrice(sellPrice * (p2 / 100));
  const price3 = roundOfferPrice(sellPrice * (p3 / 100));
  return [
    { pctOfSale: p1, price: price1 },
    { pctOfSale: p2, price: price2 },
    { pctOfSale: p3, price: price3 },
  ];
}
