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

/** Which sale grid applies before rounding (same £50 threshold as `roundSalePrice`). */
export const salePriceRoundingLabel = (preRoundedValue) => {
  const amount = Number(preRoundedValue);
  if (!Number.isFinite(amount)) return '';
  return amount > 50 ? 'nearest £5' : 'nearest £2';
};

/** Typed or persisted per-unit sale price: keep value, only snap to pence (no £2/£5 grid). */
export const normalizeExplicitSalePrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
};

/**
 * CeX negotiation tiers from `variant_prices` / `cex_product_prices`:
 * - 1st / 2nd: offer £ grid (£2 / £5)
 * - 3rd: pence only (matches rule % trade-in; backend may already round before send)
 * - 4th (Match CeX): raw CeX cash/voucher reference — pence only, never £2/£5 grid
 * @param {{ id?: string, price?: unknown, isMatchCex?: boolean }} offer
 * @param {number} tierIndex - 0-based; Match CeX = 3
 */
export function priceForCexNegotiationTier(offer, tierIndex) {
  const amount = Number(offer?.price);
  if (!Number.isFinite(amount)) return 0;
  const id = offer?.id != null ? String(offer.id) : '';
  const isMatchCexTier =
    offer?.isMatchCex === true ||
    tierIndex === 3 ||
    /(^|_)4$/.test(id);
  if (isMatchCexTier) return normalizeExplicitSalePrice(amount);
  const isThirdTier =
    tierIndex === 2 ||
    /(^|_)3$/.test(id);
  if (isThirdTier) return normalizeExplicitSalePrice(amount);
  return roundOfferPrice(amount);
}

export const toVoucherOfferPrice = (cashOfferPrice) =>
  roundOfferPrice(Number(cashOfferPrice) * 1.1);

/** String for offer inputs / display: exact to pence (no £2/£5 grid). User-edited card prices use this. */
export const formatOfferPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const n = Math.round(amount * 100) / 100;
  return String(n);
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