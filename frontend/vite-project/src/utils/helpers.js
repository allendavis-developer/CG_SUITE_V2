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