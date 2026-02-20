/**
 * Stats and buy-offer helpers for research forms (works with listings whose price may be string or number).
 */

function parsePrice(item) {
  if (item == null || item.price == null) return NaN;
  const p = item.price;
  if (typeof p === 'number') return isNaN(p) ? NaN : p;
  return parseFloat(String(p).replace(/[^0-9.]/g, '')) || NaN;
}

/**
 * Sensible rounding: under £50 round to £2, most items round to £5, then scale up.
 */
function getRoundingIncrement(value) {
  if (value < 5) return 0.5;
  if (value < 20) return 1;
  if (value < 50) return 2;
  if (value < 500) return 5;
  if (value < 1000) return 10;
  if (value < 2500) return 25;
  if (value < 5000) return 50;
  return 100;
}

function roundToNearest(value, increment) {
  return Math.round(value / increment) * increment;
}

export function calculateStats(listingsData) {
  if (!listingsData || listingsData.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 };
  }
  const prices = listingsData.map(parsePrice).filter(p => !isNaN(p) && p > 0);
  if (prices.length === 0) {
    return { average: 0, median: 0, suggestedPrice: 0, roundingIncrement: 5 };
  }
  const sum = prices.reduce((acc, p) => acc + p, 0);
  const averageRaw = sum / prices.length;
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const medianRaw = sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];
  const roundingIncrement = getRoundingIncrement(medianRaw);
  const average = roundToNearest(averageRaw, roundingIncrement);
  const median = roundToNearest(medianRaw, roundingIncrement);
  const suggestedPrice = Math.max(
    roundToNearest(median - roundingIncrement, roundingIncrement),
    0
  );
  return { average, median, suggestedPrice, roundingIncrement };
}

export function calculateBuyOffers(sellPrice) {
  if (!sellPrice || sellPrice <= 0) return [];
  const margins = [0.6, 0.5, 0.4];
  const roundingIncrement = getRoundingIncrement(sellPrice);
  return margins.map(margin => ({
    margin,
    price: roundToNearest(sellPrice * (1 - margin), roundingIncrement)
  }));
}
