/**
 * Stats and buy-offer helpers for research forms (works with listings whose price may be string or number).
 * No rounding is applied to the underlying stats; formatting is handled by the UI.
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

  // Suggested sale price: exactly £1 below the median, no extra rounding.
  const suggestedPrice = Math.max(median - 1, 0);

  return { average, median, suggestedPrice };
}

export function calculateBuyOffers(sellPrice) {
  if (!sellPrice || sellPrice <= 0) return [];
  const margins = [0.6, 0.5, 0.4];
  return margins.map(margin => ({
    margin,
    price: sellPrice * (1 - margin),
  }));
}
