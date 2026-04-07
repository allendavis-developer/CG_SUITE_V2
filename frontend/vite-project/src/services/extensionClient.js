import { sendMessage } from '@/services/extensionBridge';
import { JEWELLERY_SCRAP_OPEN_TAB_ACTION } from '@/constants/jewelleryScrapBridge';

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
 * Open nospos.com via the extension and wait until the browser shows a logged-in session
 * (same content-script flow as customer intake: NOSPOS_PAGE_READY, NOSPOS_LOGIN_REQUIRED closes the tab and rejects).
 * Does not use the /customers intake flow. After login, the extension walks stock category index pages 1–12
 * (see chrome-extension/tasks/nospos-stock-category-pagination.js). Resolves with `{ ok: true, pagesVisited, lastUrl, categories }`.
 */
export async function openNosposSiteOnly() {
  return sendMessage({ action: 'openNosposSiteOnly' });
}

/**
 * Same session flow as openNosposSiteOnly (login, NOSPOS_PAGE_READY); then opens
 * /stock/category/modify?id=… and scrapes `.card-content.fields` (field names only).
 */
export async function openNosposSiteForFields() {
  return sendMessage({ action: 'openNosposSiteForFields' });
}

/**
 * Same session flow as `openNosposSiteForFields`, but opens `/stock/category/modify?id=<nosposCategoryId>`
 * and returns scraped rows including active / editable / sensitive / required flags per field.
 */
export async function openNosposSiteForCategoryFields(nosposCategoryId) {
  return sendMessage({
    action: 'openNosposSiteForCategoryFields',
    nosposCategoryId: Number(nosposCategoryId),
  });
}

/** Use with `openNosposSiteOnly`: login plus up to 12 full page loads (extension allows 90s each). */
export const OPEN_NOSPOS_SITE_CATEGORY_TIMEOUT_MS = 12 * 95000;

/** Use with `openNosposSiteForFields` (login + one modify page). */
export const OPEN_NOSPOS_SITE_FIELD_TIMEOUT_MS = 12 * 95000;

/** Bulk field scrape: many modify pages × ~90s load cap each (2h default). */
export const OPEN_NOSPOS_BULK_CATEGORY_FIELDS_TIMEOUT_MS = 120 * 60 * 1000;

/**
 * One NoSpos tab: after login, visits each `/stock/category/modify?id=` in sequence.
 * Calls `onProgress` after each category with `{ kind, index, total, categoryNosposId, fields, scrapeOk, scrapeError }`.
 * Resolves with `{ ok, bulk, results, total }`.
 */
export async function openNosposSiteForCategoryFieldsBulk(nosposCategoryIds, onProgress) {
  const ids = Array.isArray(nosposCategoryIds) ? nosposCategoryIds : [];
  return sendMessage(
    {
      action: 'openNosposSiteForCategoryFieldsBulk',
      nosposCategoryIds: ids,
    },
    { onProgress, timeoutMs: OPEN_NOSPOS_BULK_CATEGORY_FIELDS_TIMEOUT_MS }
  );
}

/** Default cap for extension calls that should not leave the UI stuck (e.g. open NosPos site flows). */
export const OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS = 28000;

/**
 * Race an extension call so the UI never stays in a loading state forever if the bridge hangs.
 */
export function withExtensionCallTimeout(
  promise,
  ms = OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS,
  timeoutMessage
) {
  const msg =
    timeoutMessage ||
    'NoSpos did not respond in time. If you closed the app tab or the extension stalled, try again. If a button stays stuck, refresh this page.';
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
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

/**
 * Step 1 — Park agreement: credentialed fetch to `/customer/{id}/buying` with the same login detection as stock search.
 * @returns {Promise<{ ok: true } | { ok: false, loginRequired?: boolean, error?: string }>}
 */
export async function checkNosposCustomerBuyingSession(nosposCustomerId) {
  return sendMessage({
    action: 'checkNosposCustomerBuyingSession',
    nosposCustomerId,
  });
}

/**
 * Step 2 — Open new-agreement create in a new browser tab (same window when possible; tab is not focused). Returns NosPos tab id.
 * @returns {Promise<{ ok: true, tabId: number } | { ok: false, error?: string }>}
 */
export async function openNosposNewAgreementCreateBackground(nosposCustomerId, options = {}) {
  const agreementType = options.agreementType === 'PA' ? 'PA' : 'DP';
  return sendMessage({
    action: 'openNosposNewAgreementCreateBackground',
    nosposCustomerId,
    agreementType,
  });
}

/**
 * Step 3 — Wait for items page, set category (if provided), then fill name, quantity, retail, offer, and stock fields.
 * @param {{ tabId: number, categoryId?: string, name?: string, quantity?: string, retailPrice?: string|null, boughtFor?: string|null, stockFields?: Array<{ label: string, value: string }> }} payload
 */
export async function fillNosposAgreementFirstItem(payload) {
  return sendMessage({
    action: 'fillNosposAgreementFirstItem',
    ...payload,
  });
}

/**
 * Park agreement: for each negotiation line, click NoSpos Add (except the first), wait for reload,
 * then set category and fill fields on that line. Each entry matches the per-line shape of
 * {@link fillNosposAgreementFirstItem} without `tabId`.
 */
export async function fillNosposAgreementItems(payload) {
  return sendMessage({
    action: 'fillNosposAgreementItems',
    ...payload,
  });
}

/**
 * Park one agreement line: step 0 = fill first row (items page must be open); step N &gt; 0 = Add + wait reload + fill row N.
 */
export async function fillNosposAgreementItemStep(payload) {
  return sendMessage({
    action: 'fillNosposAgreementItemStep',
    ...payload,
  });
}

/** Find marker row / Add+wait — UI can call before category+rest for progress text. */
export async function resolveNosposParkAgreementLine(payload) {
  return sendMessage({
    action: 'resolveNosposParkAgreementLine',
    ...payload,
  });
}

/**
 * Park flow: delete NosPos agreement rows whose description contains `-RI-{id}-` for each requestItemId
 * (skipped / excluded lines from CG Suite).
 */
export async function deleteExcludedNosposAgreementLines(payload) {
  return sendMessage({
    action: 'deleteExcludedNosposAgreementLines',
    ...payload,
  });
}

/** Items page: Agreement card → Actions → Park Agreement → confirm SweetAlert (NosPos POST /newagreement/{id}/park). */
export async function clickNosposSidebarParkAgreement(payload) {
  return sendMessage({
    action: 'clickNosposSidebarParkAgreement',
    ...payload,
  });
}

/** Focus the NosPos park tab; if it was closed, open fallbackCreateUrl (validated agreement URL). */
export async function focusOrOpenNosposParkTab(payload) {
  return sendMessage({
    action: 'focusOrOpenNosposParkTab',
    ...payload,
  });
}

/** Get the current URL of a browser tab by tabId (returns { ok, url }). */
export async function getNosposTabUrl(tabId) {
  return sendMessage({ action: 'getNosposTabUrl', tabId });
}

export async function fillNosposParkAgreementCategory(payload) {
  return sendMessage({
    action: 'fillNosposParkAgreementCategory',
    ...payload,
  });
}

export async function fillNosposParkAgreementRest(payload) {
  return sendMessage({
    action: 'fillNosposParkAgreementRest',
    ...payload,
  });
}

/**
 * Update a single field on the NosPos agreement items page (same tab as park flow).
 */
export async function patchNosposAgreementField(payload) {
  return sendMessage({
    action: 'patchNosposAgreementField',
    ...payload,
  });
}

/**
 * @deprecated Prefer fillNosposAgreementFirstItem — kept for callers that only set category.
 * @returns {Promise<{ ok: true, label?: string } | { ok: false, error?: string }>}
 */
export async function fillNosposAgreementFirstItemCategory({ tabId, categoryId }) {
  return sendMessage({
    action: 'fillNosposAgreementFirstItemCategory',
    tabId,
    categoryId,
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

/**
 * Opens https://uk.webuy.com/ in a new tab (via extension), scrapes super-category links from
 * `ul.nav-menu`, and returns a tree-shaped list (children reserved for future sub-category scrapes).
 *
 * @returns {Promise<{
 *   success: boolean,
 *   categories?: Array<{
 *     id: string,
 *     label: string,
 *     href: string,
 *     superCatId: string | null,
 *     superCatNameFromQuery: string | null,
 *     path: string[],
 *     children: unknown[]
 *   }>,
 *   scrapedAt?: string,
 *   sourceTabUrl?: string,
 *   warnings?: string[],
 *   error?: string,
 *   cancelled?: boolean
 * }>}
 */
export async function scrapeCexSuperCategories() {
  return sendMessage({ action: 'scrapeCexSuperCategories' });
}

/**
 * Opens jewellery reference scrap worker tab (extension jewellery-scrap/*).
 */
export async function openJewelleryScrapPrices() {
  return sendMessage({ action: JEWELLERY_SCRAP_OPEN_TAB_ACTION });
}
