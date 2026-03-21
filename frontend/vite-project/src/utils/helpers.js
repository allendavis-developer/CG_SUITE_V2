/**
 * Format a number as GBP currency
 * @param {number} value - The value to format
 * @returns {string} Formatted currency string
 */
export const formatGBP = (value) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2
  }).format(value);

/** Offer price: nearest £5 if above £50, else nearest £2 (matches backend `_round_offer_price`). */
export const roundOfferPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  if (amount > 50) return Math.round(amount / 5) * 5;
  return Math.round(amount / 2) * 2;
};

/** Sale / retail price: nearest £5 if above £50, else nearest £2 (matches backend `_round_sale_price`). */
export const roundSalePrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  if (amount > 50) return Math.round(amount / 5) * 5;
  return Math.round(amount / 2) * 2;
};

/** Typed or persisted per-unit sale price: keep value, only snap to pence (no £2/£5 grid). */
export const normalizeExplicitSalePrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
};

export const toVoucherOfferPrice = (cashOfferPrice) =>
  roundOfferPrice(Number(cashOfferPrice) * 1.1);

export const formatOfferPrice = (value) => {
  const rounded = roundOfferPrice(value);
  return String(rounded);
};

/**
 * Get CSRF token from cookie
 * @returns {string|undefined} CSRF token
 */
export function getCSRFToken() {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrftoken='))
    ?.split('=')[1];
  return cookieValue;
}

/**
 * Calculate margin percentage
 * @param {number|string} offerPrice - The offer price
 * @param {number|string} salePrice - The sale price
 * @returns {number} Margin percentage (rounded)
 */
export const calculateMargin = (offerPrice, salePrice) => {
  const salePriceNum = parseFloat(salePrice);
  const offerPriceNum = parseFloat(offerPrice);
  
  if (!salePriceNum || salePriceNum <= 0) return 0;
  
  const margin = ((salePriceNum - offerPriceNum) / salePriceNum) * 100;
  return Math.round(margin);
};