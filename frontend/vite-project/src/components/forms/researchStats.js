import { roundOfferPrice, roundSalePrice, salePriceRoundingLabel } from '@/utils/helpers';

/**
 * Stats and buy-offer helpers for research forms (works with listings whose price may be string or number).
 * Offer prices follow the same rounding rules used elsewhere in the app.
 */

/** Parse listing `item.price` (number or currency string) for research stats and sorting. */
export function parseResearchPrice(item) {
  if (item == null || item.price == null) return NaN;
  const p = item.price;
  if (typeof p === 'number') return isNaN(p) ? NaN : p;
  return parseFloat(String(p).replace(/[^0-9.]/g, '')) || NaN;
}

function emptyResearchStats() {
  return { average: 0, median: 0, suggestedPrice: 0 };
}

/**
 * Full research stats plus tooltip/working fields. Single pass over listings.
 * `workingOut` is null when there are no usable prices (same cases as empty stats).
 */
export function calculateResearchStats(listingsData) {
  if (!listingsData || listingsData.length === 0) {
    return { stats: emptyResearchStats(), workingOut: null };
  }

  const prices = listingsData
    .map(parseResearchPrice)
    .filter(p => !isNaN(p) && p > 0);

  if (prices.length === 0) {
    return { stats: emptyResearchStats(), workingOut: null };
  }

  const sum = prices.reduce((acc, p) => acc + p, 0);
  const average = sum / prices.length;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const median = sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];

  const preSuggestedRaw = Math.max(median - 1, 0);
  const suggestedPrice = roundSalePrice(preSuggestedRaw);

  return {
    stats: { average, median, suggestedPrice },
    workingOut: {
      sum,
      count: prices.length,
      preSuggestedRaw,
      suggestedSaleRoundingLabel: salePriceRoundingLabel(preSuggestedRaw),
    },
  };
}

export function calculateStats(listingsData) {
  return calculateResearchStats(listingsData).stats;
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
