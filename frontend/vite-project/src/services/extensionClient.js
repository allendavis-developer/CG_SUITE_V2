import { sendMessage } from '@/services/extensionBridge';

/**
 * Open eBay, Cash Converters, or CeX in a new tab and wait for the user to confirm
 * they're on a listings page (or CeX product-detail page) and click "Yes" in the extension panel.
 * Returns scraped listing data when the user confirms.
 *
 * For CeX: extension opens uk.webuy.com; user navigates to a product-detail URL (e.g. uk.webuy.com/product-detail?id=...).
 * The extension content script on that page must send LISTING_PAGE_READY; then background sends WAITING_FOR_DATA
 * so the "Have you got the data yet?" panel appears. If it doesn't appear, check extension console (CeX tab and background)
 * for logs: LISTING_PAGE_READY, WAITING_FOR_DATA, and content-listings maybeNotifyReady/showPanel.
 *
 * @param {string} competitor - 'eBay', 'CashConverters', or 'CeX'
 * @param {string} [searchQuery] - Optional search term to pre-populate the URL (e.g. product name)
 * @param {Object} [marketComparisonContext] - Optional context from market comparisons table to show in the extension panel (cexSalePrice, ourSalePrice, ebaySalePrice, cashConvertersSalePrice)
 */
export async function getDataFromListingPage(competitor, searchQuery, marketComparisonContext) {
  const competitorVal = ['CashConverters', 'CeX'].includes(competitor) ? competitor : 'eBay';
  return sendMessage({
    action: 'startWaitingForData',
    competitor: competitorVal,
    searchQuery: searchQuery || null,
    marketComparisonContext: marketComparisonContext || null
  });
}

/**
 * Cancel the active listing-tab session (refine or initial get-data).
 * Tells the background to close the listing tab and resolve the pending promise
 * with { success: false, cancelled: true } so the app can clean up gracefully.
 */
export async function cancelListingTab() {
  return sendMessage({ action: 'cancelRequest' });
}

/**
 * True when getData / refine resolved without data because the user closed the listing tab
 * or cancelled. Handles `{ cancelled: true }` and payloads that only include the tab-closed message.
 */
export function isExtensionListingFlowAborted(result) {
  if (result == null) return false;
  if (result.cancelled === true) return true;
  if (result.success === true) return false;
  const msg = String(result.error || '');
  return /tab was closed/i.test(msg);
}

/**
 * Open nospos.com in a new tab via the Chrome extension and wait for the user to land on the main site.
 * Reuses the same flow as openNospos: extension opens nospos.com, content script waits until user is
 * logged in (not on login page) before sending NOSPOS_PAGE_READY. For customer intake we do not
 * navigate to /stock/search – user stays on nospos.com to look up customer data.
 */
export async function openNosposForCustomerIntake() {
  return sendMessage({
    action: 'openNosposForCustomerIntake'
  });
}

/**
 * Open nospos.com in a new tab via the Chrome extension and wait for the user to land on the main site.
 * If the user lands on a login page, waits for them to log in and redirect to nospos.com.
 * Resolves when the user is on nospos.com (either directly or after login).
 * Then navigates to /stock/search and fills the first item's first barcode.
 *
 * @param {Array<{ itemId: string, salePrice: number|null, barcodes: string[] }>} repricingData - Each item's sale price and nospos barcodes
 * @param {{ completedBarcodes?: Record<string,number[]>, completedItems?: string[], cartKey?: string }} progress - Progress so we can resume
 */
export async function openNospos(repricingData, progress = {}) {
  return sendMessage({
    action: 'openNosposAndWait',
    repricingData: repricingData || [],
    completedBarcodes: progress.completedBarcodes || {},
    completedItems: progress.completedItems || [],
    cartKey: progress.cartKey || ''
  });
}

/**
 * Search NosPos for a barcode in the background (no tab switch).
 * Returns { ok: true, results: [{ barserial, href, name, costPrice, retailPrice, quantity }] }
 * or { ok: false, loginRequired: true } if not logged in to NosPos,
 * or { ok: false, error: string } on failure.
 *
 * @param {string} barcode - The barcode/partial barcode to search for
 */
export async function searchNosposBarcode(barcode) {
  return sendMessage({
    action: 'searchNosposBarcode',
    barcode: barcode || ''
  });
}

export async function getLastRepricingResult() {
  return sendMessage({ action: 'getLastRepricingResult' });
}

export async function clearLastRepricingResult() {
  return sendMessage({ action: 'clearLastRepricingResult' });
}

export async function getNosposRepricingStatus() {
  return sendMessage({ action: 'getNosposRepricingStatus' });
}

/**
 * Cancel the running background repricing. Clears extension state and closes the NoSpos tab.
 * @param {string} [cartKey] - Optional cart key so we can clear the correct session when extension has no stored data
 */
export async function cancelNosposRepricing(cartKey = '') {
  return sendMessage({ action: 'cancelNosposRepricing', cartKey });
}

/**
 * Send user back to the listing page (or open it if closed) to refine their search.
 * listingPageUrl should be the URL stored from the last scrape (app side).
 * The extension shows "Are you done?" on the listing page; when they click Yes,
 * returns scraped data and focuses the app tab (same as getDataFromListingPage).
 */
export async function getDataFromRefine(competitor, listingPageUrl, marketComparisonContext) {
  const competitorVal = competitor === 'CashConverters' ? 'CashConverters' : 'eBay';
  return sendMessage({
    action: 'startRefine',
    competitor: competitorVal,
    listingPageUrl: listingPageUrl || null,
    marketComparisonContext: marketComparisonContext || null
  });
}
