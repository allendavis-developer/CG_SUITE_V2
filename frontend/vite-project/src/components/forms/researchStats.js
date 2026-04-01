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

/** Short titles for cart / negotiation rows (eBay & Cash Converters tiers). */
export const EBAY_CC_OFFER_TITLES_SHORT = [
  '1st Offer',
  '2nd Offer',
  '3rd Offer',
  '4th Offer',
];

/** Labels in research UI (cash). */
export const EBAY_CC_RESEARCH_LABELS_CASH = [
  '1st Cash Offer',
  '2nd Cash Offer',
  '3rd Cash Offer',
  '4th Cash Offer',
];

/** Labels in research UI (voucher). */
export const EBAY_CC_RESEARCH_LABELS_VOUCHER = [
  '1st Voucher Offer',
  '2nd Voucher Offer',
  '3rd Voucher Offer',
  '4th Voucher Offer',
];

export function titleForEbayCcOfferIndex(idx) {
  return EBAY_CC_OFFER_TITLES_SHORT[idx] || `Offer ${idx + 1}`;
}

/**
 * @param {number} sellPrice - Suggested sale price from research
 * @param {[number, number, number, number]|null|undefined} pcts - Up to four % of sale from rules (first three sorted low→high for tiers 1–3; tier 4 is top tier %, often 100)
 */
export function calculateBuyOffers(sellPrice, pcts) {
  if (!sellPrice || sellPrice <= 0) return [];
  const defaults = [40, 50, 60, 70];
  const raw = [0, 1, 2, 3].map((i) => {
    const v = pcts?.[i];
    return v != null && !Number.isNaN(Number(v)) ? Number(v) : defaults[i];
  });
  const [p1, p2, p3] = [...raw.slice(0, 3)].sort((a, b) => a - b);
  let p4 = raw[3];
  const price1 = roundOfferPrice(sellPrice * (p1 / 100));
  const price2 = roundOfferPrice(sellPrice * (p2 / 100));
  const price3 = roundOfferPrice(sellPrice * (p3 / 100));
  let price4 = roundOfferPrice(sellPrice * (p4 / 100));
  if (price4 < price3) price4 = price3;
  return [
    { pctOfSale: p1, price: price1 },
    { pctOfSale: p2, price: price2 },
    { pctOfSale: p3, price: price3 },
    { pctOfSale: p4, price: price4 },
  ];
}
