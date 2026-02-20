// 🔓 Public API
import { sendMessage } from '@/services/extensionBridge';

export async function scrapeEbay(params) {
  return sendMessage({
    action: "scrape",
    data: {
      competitors: ["eBay"],
      ...params,
    },
  });
}

export async function scrapeCashConverters(params) {
  return sendMessage({
    action: "scrape",
    data: {
      competitors: ["CashConverters"],
      ...params,
    },
  });
}

/**
 * Open eBay or Cash Converters in a new tab and wait for the user to confirm
 * they're on a listings page and click "Yes" in the extension panel.
 * Returns scraped listing data when the user confirms.
 */
export async function getDataFromListingPage(competitor) {
  const payload = competitor === 'CashConverters'
    ? { action: 'startWaitingForData', competitor: 'CashConverters' }
    : { action: 'startWaitingForData', competitor: 'eBay' };
  return sendMessage(payload);
}

/**
 * Send user back to the listing page (or open it if closed) to refine their search.
 * listingPageUrl should be the URL stored from the last scrape (app side).
 * The extension shows "Are you done?" on the listing page; when they click Yes,
 * returns scraped data and focuses the app tab (same as getDataFromListingPage).
 */
export async function getDataFromRefine(competitor, listingPageUrl) {
  const payload = competitor === 'CashConverters'
    ? { action: 'startRefine', competitor: 'CashConverters', listingPageUrl: listingPageUrl || null }
    : { action: 'startRefine', competitor: 'eBay', listingPageUrl: listingPageUrl || null };
  return sendMessage(payload);
}
