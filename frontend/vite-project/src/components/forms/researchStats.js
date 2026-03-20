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

export function calculateBuyOffers(sellPrice) {
  if (!sellPrice || sellPrice <= 0) return [];
  // Round 1st (60% margin) and 3rd (40% margin) first, then derive 2nd as
  // midpoint of the rounded values so they never collide after rounding.
  const price1 = roundOfferPrice(sellPrice * 0.4);   // 60% margin
  const price3 = roundOfferPrice(sellPrice * 0.6);   // 40% margin
  const price2 = roundOfferPrice((price1 + price3) / 2); // midpoint
  return [
    { margin: 0.6, price: price1 },
    { margin: 0.5, price: price2 },
    { margin: 0.4, price: price3 },
  ];
}
