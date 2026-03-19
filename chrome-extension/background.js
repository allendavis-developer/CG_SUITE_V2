/**
 * CG Suite Research – background service worker (Manifest V3).
 *
 * IMPORTANT: MV3 service workers are killed by Chrome after ~30 s of inactivity.
 * All pending-request state is persisted in chrome.storage.session so it survives
 * those restarts.
 *
 * Storage schema (key "cgPending"):
 *   { [requestId]: { appTabId, listingTabId, competitor, marketComparisonContext } }
 *
 * FLOW FOR "ADD FROM CEX":
 * 1. App sends BRIDGE_FORWARD with action 'startWaitingForData', competitor 'CeX'.
 * 2. We create a new tab (uk.webuy.com/ or search), store pending[requestId] = { appTabId, listingTabId: newTab.id, competitor: 'CeX' }.
 * 3. User navigates to a product-detail page (same tab or different tab). Content script on that page sends LISTING_PAGE_READY.
 * 4. We match the tab to the pending request (by listingTabId, or for CeX by re-associating if user opened product in another tab).
 * 5. We send WAITING_FOR_DATA to that tab so the content script shows "Have you got the data yet?". We retry a few times in case the content script isn't ready yet.
 */

// ── eBay filter enforcement ────────────────────────────────────────────────────

/**
 * Ensure the three required eBay filters are present in the URL:
 *   LH_Complete=1  (Completed items)
 *   LH_Sold=1      (Sold items)
 *   LH_PrefLoc=1   (UK Only)
 * Returns the (possibly modified) URL unchanged for non-eBay URLs.
 */
function ensureEbayFilters(url) {
  if (!url || !url.includes('ebay.co.uk')) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('LH_Complete', '1');
    u.searchParams.set('LH_Sold', '1');
    u.searchParams.set('LH_PrefLoc', '1');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// ── Tab group styling (yellow) for extension-opened eBay/CC/CeX tabs ─────────────

/**
 * Put a tab into a yellow tab group so users can distinguish extension-opened
 * tabs (eBay, Cash Converters, CeX) from other tabs.
 */
async function putTabInYellowGroup(tabId) {
  try {
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    await chrome.tabGroups.update(groupId, {
      color: 'yellow',
      title: 'CG Suite'
    });
  } catch (e) {
    console.warn('[CG Suite] Could not add tab to yellow group:', e?.message);
  }
}

async function openBackgroundNosposTab(url, appTabId = null) {
  try {
    const win = await chrome.windows.create({
      url,
      focused: false,
      state: 'minimized'
    });
    if (win?.id != null) {
      await chrome.windows.update(win.id, { focused: false, state: 'minimized' }).catch(() => {});
    }
    const tab = (win?.tabs || [])[0];
    if (tab?.id != null) {
      if (appTabId) {
        await focusAppTab(appTabId);
      }
      return { tabId: tab.id, windowId: win.id || null };
    }
  } catch (e) {
    console.warn('[CG Suite] Could not open minimized NoSpos window:', e?.message);
  }

  const fallbackTab = await chrome.tabs.create({ url, active: false });
  await putTabInYellowGroup(fallbackTab.id);
  if (appTabId) {
    await focusAppTab(appTabId);
  }
  return { tabId: fallbackTab.id, windowId: fallbackTab.windowId || null };
}

// ── Storage helpers ────────────────────────────────────────────────────────────

async function getPending() {
  const data = await chrome.storage.session.get('cgPending');
  return data.cgPending || {};
}

async function setPending(obj) {
  return chrome.storage.session.set({ cgPending: obj });
}

function isNosposSearchPath(path) {
  return /^\/stock\/search(?:\/index)?\/?$/i.test((path || '').trim());
}

async function clearNosposPendingEntries(tabId) {
  const pending = await getPending();
  let changed = false;
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.type === 'openNospos' && (tabId == null || entry.listingTabId === tabId)) {
      delete pending[requestId];
      changed = true;
    }
  }
  if (changed) {
    await setPending(pending);
  }
}

async function clearNosposRepricingState(tabId) {
  await chrome.storage.session.remove('cgNosposRepricingData');
  await chrome.storage.local.remove('cgNosposRepricingProgress');
  await clearNosposPendingEntries(tabId);
}

async function setLastRepricingResult(payload) {
  await chrome.storage.local.set({ cgNosposLastRepricingResult: payload || null });
}

async function getLastRepricingResult() {
  const stored = await chrome.storage.local.get('cgNosposLastRepricingResult');
  return stored.cgNosposLastRepricingResult || null;
}

async function clearLastRepricingResult() {
  await chrome.storage.local.remove('cgNosposLastRepricingResult');
}

async function getRepricingStatus() {
  const stored = await chrome.storage.local.get('cgNosposRepricingStatus');
  return stored.cgNosposRepricingStatus || null;
}

async function setRepricingStatus(status) {
  await chrome.storage.local.set({ cgNosposRepricingStatus: status || null });
}

async function clearRepricingStatus() {
  await chrome.storage.local.remove('cgNosposRepricingStatus');
}

function countTotalBarcodes(repricingData) {
  return (repricingData || []).reduce((sum, item) => sum + ((item?.barcodes?.length) || 0), 0);
}

function countCompletedBarcodes(completedBarcodes) {
  return Object.values(completedBarcodes || {}).reduce((sum, indices) => sum + ((indices || []).length), 0);
}

function buildBarcodeQueue(repricingData, completedBarcodes, completedItems, skippedBarcodes = {}) {
  const queue = [];
  for (let i = 0; i < (repricingData || []).length; i++) {
    const item = repricingData[i];
    if (completedItems?.includes(item?.itemId)) continue;
    const done = completedBarcodes?.[item?.itemId] || [];
    const skipped = skippedBarcodes?.[item?.itemId] || [];
    for (let j = 0; j < (item?.barcodes?.length || 0); j++) {
      if (done.includes(j) || skipped.includes(j)) continue;
      const barcode = (item?.barcodes?.[j] || '').trim();
      if (!barcode) continue;
      queue.push({
        itemIndex: i,
        barcodeIndex: j,
        itemId: item?.itemId,
        itemTitle: item?.title || '',
        barcode
      });
    }
  }
  return queue;
}

function getActiveQueue(data) {
  const queue = Array.isArray(data?.queue) ? data.queue : [];
  if (queue.length > 0) return queue;
  return buildBarcodeQueue(data?.repricingData || [], data?.completedBarcodes || {}, data?.completedItems || [], data?.skippedBarcodes || {});
}

function removeQueueHead(queue, expected) {
  const currentQueue = Array.isArray(queue) ? [...queue] : [];
  if (currentQueue.length === 0) return currentQueue;
  if (!expected) return currentQueue.slice(1);
  const head = currentQueue[0];
  if (
    head?.itemId === expected?.itemId &&
    head?.barcodeIndex === expected?.barcodeIndex &&
    head?.barcode === expected?.barcode
  ) {
    return currentQueue.slice(1);
  }
  return currentQueue.filter((entry) => !(
    entry?.itemId === expected?.itemId &&
    entry?.barcodeIndex === expected?.barcodeIndex &&
    entry?.barcode === expected?.barcode
  ));
}

function appendRepricingLog(data, message, level = 'info') {
  const logs = [...(data?.logs || []), {
    timestamp: new Date().toISOString(),
    level,
    message: String(message || '').trim()
  }].slice(-200);
  return { ...(data || {}), logs };
}

function itemTitleForLog(item) {
  return item?.title || 'Unknown Item';
}

function formatBarcodeArrayForLog(item) {
  const values = (item?.barcodes || []).map((barcode) => String(barcode || '').trim()).filter(Boolean);
  return `[${values.map((barcode) => `"${barcode}"`).join(', ')}]`;
}

function addItemContextLog(data, item, prefix = 'Next item is') {
  if (!item?.itemId) return data;
  if (data?.lastLoggedItemId === item.itemId) return data;
  const label = data?.lastLoggedItemId ? 'Next item is' : 'First item is';
  return appendRepricingLog(
    { ...(data || {}), lastLoggedItemId: item.itemId },
    `${label} ${itemTitleForLog(item)} - doing barcodes ${formatBarcodeArrayForLog(item)}.`
  );
}

function buildRepricingStatusPayload(data, overrides = {}) {
  const repricingData = data?.repricingData || [];
  const completedBarcodes = data?.completedBarcodes || {};
  const completedItems = data?.completedItems || [];
  const totalBarcodes = countTotalBarcodes(repricingData);
  const completedBarcodeCount = countCompletedBarcodes(completedBarcodes);
  const queue = getActiveQueue(data);
  const next = queue[0] || null;
  const nextItem = next ? repricingData[next.itemIndex] : null;

  return {
    cartKey: data?.cartKey || '',
    running: !data?.done,
    done: !!data?.done,
    step: overrides.step || data?.step || (data?.done ? 'completed' : 'working'),
    message: overrides.message || data?.message || '',
    currentBarcode: overrides.currentBarcode ?? data?.currentBarcode ?? next?.barcode ?? '',
    currentItemId: overrides.currentItemId ?? data?.currentItemId ?? nextItem?.itemId ?? '',
    currentItemTitle: overrides.currentItemTitle ?? data?.currentItemTitle ?? nextItem?.title ?? '',
    totalBarcodes,
    completedBarcodeCount,
    completedBarcodes,
    completedItems,
    logs: data?.logs || [],
  };
}

async function broadcastRepricingStatus(appTabId, data, overrides = {}) {
  const payload = buildRepricingStatusPayload(data, overrides);
  await setRepricingStatus(payload);
  if (appTabId) {
    await chrome.tabs.sendMessage(appTabId, {
      type: 'REPRICING_PROGRESS_TO_PAGE',
      payload
    }).catch(() => {});
  }
  return payload;
}

async function failNosposRequestAndCloseTab(requestId, entry, message) {
  const pending = await getPending();
  if (pending[requestId]) {
    delete pending[requestId];
    await setPending(pending);
  }

  if (entry?.type === 'openNospos') {
    const status = await getRepricingStatus();
    if (status?.cartKey) {
      await setRepricingStatus({
        ...status,
        running: false,
        done: false,
        step: 'error',
        message: message || 'You must be logged into NoSpos to continue.',
        logs: [...(status.logs || []), {
          timestamp: new Date().toISOString(),
          level: 'error',
          message: message || 'You must be logged into NoSpos to continue.'
        }].slice(-200)
      });
    }
    await clearNosposRepricingState(entry.listingTabId);
  }

  if (entry?.appTabId != null) {
    chrome.tabs.sendMessage(entry.appTabId, {
      type: 'EXTENSION_RESPONSE_TO_PAGE',
      requestId,
      error: message || 'You must be logged into NoSpos to continue.'
    }).catch(() => {});
    await focusAppTab(entry.appTabId);
  }

  if (entry?.listingTabId != null) {
    await chrome.tabs.remove(entry.listingTabId).catch(() => {});
  }
}

async function focusAppTab(appTabId) {
  if (!appTabId) return;
  const appTab = await chrome.tabs.get(appTabId).catch(() => null);
  if (!appTab) return;
  await chrome.tabs.update(appTabId, { active: true }).catch(() => {});
  if (appTab.windowId) {
    await chrome.windows.update(appTab.windowId, { focused: true }).catch(() => {});
  }
}

async function sendRepricingComplete(appTabId, payload) {
  if (!appTabId) return;
  await chrome.tabs.sendMessage(appTabId, {
    type: 'REPRICING_COMPLETE_TO_PAGE',
    payload
  }).catch(() => {});
}

// ── NosPos stock search result parser ─────────────────────────────────────────

/**
 * Parse the NosPos /stock/search/index HTML page and extract result rows.
 * Returns an array of { barserial, href, name, costPrice, retailPrice, quantity }.
 */
function decodeNosposHtmlText(value) {
  return (value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStockNameFromEditHtml(html) {
  // Try every ordering of attributes on the stock-name input.
  // The input looks like: <input type="text" id="stock-name" class="..." name="Stock[name]" value="xbox series x" ...>
  // We match the whole input tag first, then pull value= out of it.
  const byId = html.match(/<input[^>]+id="stock-name"[^>]*>/i);
  const byName = html.match(/<input[^>]+name="Stock\[name\]"[^>]*>/i);
  const tag = (byId || byName)?.[0] || '';
  const valueMatch = tag.match(/\bvalue="([^"]*)"/i);
  return decodeNosposHtmlText(valueMatch?.[1] || '');
}

function parseNosposSearchResults(html) {
  const results = [];
  // Match <tr data-key="..."> rows
  const rowRe = /<tr[^>]+data-key="\d+"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    // Extract all <td>...</td> cells
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 5) continue;

    // Cell 0: barserial + href
    const linkMatch = cells[0].match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i);
    const href = linkMatch ? linkMatch[1].replace(/&amp;/g, '&') : '';
    const barserial = linkMatch ? linkMatch[2].trim() : '';

    // Cell 1: item name (prefer title attribute for full text, handles HTML entities)
    const titleAttr = cells[1].match(/(?:data-original-title|title)="([^"]+)"/i);
    const name = titleAttr
      ? decodeNosposHtmlText(titleAttr[1])
      : cells[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // Cells 2-4: prices + quantity (strip all tags)
    const costPrice = cells[2].replace(/<[^>]*>/g, '').trim();
    const retailPrice = cells[3].replace(/<[^>]*>/g, '').trim();
    const quantity = cells[4].replace(/<[^>]*>/g, '').trim();

    if (barserial || href) {
      results.push({ barserial, href, name, costPrice, retailPrice, quantity });
    }
  }
  return results;
}

/**
 * Parse a direct /stock/:id/edit hit when NosPos bypasses the search results page.
 * Returns a single result row if the page contains a Barserial detail.
 */
function parseNosposStockEditResult(html, finalUrl) {
  const barserialMatch = html.match(
    /<div[^>]*class="detail"[^>]*>\s*<strong>\s*Barserial\s*<\/strong>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/i
  );
  const barserial = decodeNosposHtmlText(
    (barserialMatch?.[1] || '').replace(/<[^>]*>/g, ' ')
  );
  if (!barserial) return [];

  let href = '';
  try {
    href = new URL(finalUrl).pathname || '';
  } catch {
    href = '';
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const stockNameFromInput = getStockNameFromEditHtml(html);
  const name = stockNameFromInput || decodeNosposHtmlText((titleMatch?.[1] || '').replace(/\s*-\s*Nospos\s*$/i, ''));

  return [{
    barserial,
    href,
    name,
    costPrice: '',
    retailPrice: '',
    quantity: ''
  }];
}

// ── Address lookup (getAddress.io via Django proxy) ─────────────────────────────

const ADDRESS_API_BASE = 'http://127.0.0.1:8000';

async function handleFetchAddressSuggestions(message) {
  // Normalize postcode: trim, collapse whitespace (including nbsp), uppercase
  const raw = (message.postcode || '').trim().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
  const postcode = raw.toUpperCase();
  if (!postcode || postcode.replace(/\s/g, '').length < 4) {
    return { ok: true, addresses: [] };
  }
  const bases = ['http://127.0.0.1:8000', 'http://localhost:8000'];
  for (const base of bases) {
    try {
      const url = `${base}/api/address-lookup/${encodeURIComponent(postcode)}/`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, error: err.error || `HTTP ${resp.status}` };
      }
      const data = await resp.json();
      const addresses = data.addresses || [];
      return { ok: true, addresses: Array.isArray(addresses) ? addresses : [] };
    } catch (e) {
      if (bases.indexOf(base) < bases.length - 1) continue;
      return { ok: false, error: (e?.message || 'Network error') + '. Is Django running at http://127.0.0.1:8000?' };
    }
  }
  return { ok: false, error: 'Could not reach address lookup service' };
}

// ── Message router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BRIDGE_FORWARD') {
    handleBridgeForward(message, sender)
      .then(r => sendResponse(r))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'LISTING_PAGE_READY') {
    handleListingPageReady(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'SCRAPED_DATA') {
    handleScrapedData(message)
      .then(r => sendResponse(r))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_PAGE_READY') {
    handleNosposPageReady(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_STOCK_SEARCH_READY') {
    handleNosposStockSearchReady(message, sender)
      .then((r) => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_STOCK_EDIT_READY') {
    handleNosposStockEditReady(message, sender)
      .then((r) => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_PAGE_LOADED') {
    handleNosposPageLoaded(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_LOGIN_REQUIRED') {
    handleNosposLoginRequired(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_SEARCH_READY') {
    handleNosposCustomerSearchReady(message, sender)
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_DETAIL_READY') {
    handleNosposCustomerDetailReady(message, sender)
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_DONE') {
    handleNosposCustomerDone(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'FETCH_ADDRESS_SUGGESTIONS') {
    handleFetchAddressSuggestions(message)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'Failed' }));
    return true;
  }

  return false;
});

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleBridgeForward(message, sender) {
  const { requestId, payload } = message;
  const appTabId = sender.tab?.id;

  // User clicked "Add from CeX" (or eBay / Cash Converters). Open the competitor site and store pending so we can later send WAITING_FOR_DATA to the tab when it's on a listing/product page.
  if (payload.action === 'startWaitingForData' && appTabId != null) {
    const competitor = payload.competitor || 'eBay';
    const searchQuery = (payload.searchQuery || '').trim();
    const marketComparisonContext = payload.marketComparisonContext || null;

    let url;
    if (competitor === 'CashConverters') {
      url = searchQuery
        ? `https://www.cashconverters.co.uk/search-results?Sort=default&page=1&query=${encodeURIComponent(searchQuery)}`
        : 'https://www.cashconverters.co.uk/';
    } else if (competitor === 'CeX') {
      // For CeX, always open the clean homepage. We no longer append any
      // tracking/query parameters (cgReq, keyword, etc.) so the user only ever
      // sees a simple `https://uk.webuy.com/` URL.
      url = 'https://uk.webuy.com/';
    } else {
      // Always enforce: Completed items (LH_Complete=1), Sold items (LH_Sold=1), UK Only (LH_PrefLoc=1)
      url = searchQuery
        ? `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Complete=1&LH_Sold=1&LH_PrefLoc=1`
        : 'https://www.ebay.co.uk/';
    }

    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: newTab.id, competitor, marketComparisonContext };
    await setPending(pending);

    console.log('[CG Suite] startWaitingForData saved – only this tab can complete the flow; closing it will notify the app', { requestId, competitor, listingTabId: newTab.id, appTabId });
    return { ok: true };
  }

  if (payload.action === 'cancelRequest' && appTabId != null) {
    // User clicked Cancel/Reset in the app while a listing tab was open.
    // Find the pending entry for this app tab, close the listing tab, and
    // send a clean cancelled response so the app's awaiting promise resolves.
    // Skip openNospos entries – we never close the NoSpos tab (user needs it to log in).
    const pending = await getPending();
    for (const [reqId, entry] of Object.entries(pending)) {
      if (entry.appTabId === appTabId && entry.type !== 'openNospos' && entry.type !== 'openNosposCustomerIntake' && entry.type !== 'openNosposCustomerIntakeWaiting') {
        const listingTabId = entry.listingTabId;
        delete pending[reqId];
        await setPending(pending);
        if (listingTabId != null) {
          await chrome.tabs.remove(listingTabId).catch(() => {});
        }
        chrome.tabs.sendMessage(appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId: reqId,
          response: { success: false, cancelled: true }
        }).catch(() => {});
        break;
      }
    }
    return { ok: true };
  }

  // Search NosPos stock by barcode in the background (no tab switch).
  // Fetches the stock search results page directly and parses the results table.
  if (payload.action === 'searchNosposBarcode') {
    const barcode = (payload.barcode || '').trim();
    if (!barcode) return { ok: false, error: 'No barcode provided' };
    try {
      const searchUrl = `https://nospos.com/stock/search/index?StockSearchAndFilter[query]=${encodeURIComponent(barcode)}&sort=-quantity`;
      const response = await fetch(searchUrl, {
        credentials: 'include',
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
      });
      const finalUrl = response.url || '';
      if (!response.ok || finalUrl.includes('/login') || finalUrl.includes('/signin') || finalUrl.includes('/site/standard-login') || finalUrl.includes('/twofactor')) {
        return { ok: false, loginRequired: true };
      }
      const html = await response.text();
      const isDirectStockEditHit = /^https:\/\/[^/]*nospos\.com\/stock\/\d+\/edit\/?(\?.*)?$/i.test(finalUrl);
      const results = isDirectStockEditHit
        ? parseNosposStockEditResult(html, finalUrl)
        : parseNosposSearchResults(html);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message || 'Search failed' };
    }
  }

  // Open nospos.com for customer intake – same flow as openNosposAndWait (waits for user to log in)
  // but does not navigate to /stock/search; user stays on nospos.com to look up customer data.
  if (payload.action === 'openNosposForCustomerIntake') {
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = { appTabId: appTabId || null, listingTabId: newTab.id, type: 'openNosposCustomerIntake' };
    await setPending(pending);

    console.log('[CG Suite] openNosposForCustomerIntake – waiting for user to land on nospos.com', { requestId, listingTabId: newTab.id });
    return { ok: true };
  }

  // Open a URL in a new tab (e.g. nospos.com for repricing flow)
  if (payload.action === 'openUrl') {
    const url = (payload.url || 'https://nospos.com').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { ok: false, error: 'Invalid URL' };
    }
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);
    return { ok: true };
  }

  // Open nospos.com and wait for the user to land on the main site (after login if needed).
  // Then navigate to /stock/search and fill the first barcode.
  if (payload.action === 'openNosposAndWait' && appTabId != null) {
    const url = 'https://nospos.com';
    await clearNosposRepricingState();
    await chrome.storage.local.remove('cgNosposLastRepricingResult');
    await clearRepricingStatus();
    const { tabId: nosposTabId } = await openBackgroundNosposTab(url, appTabId);

    const repricingData = payload.repricingData || [];
    const completedBarcodes = payload.completedBarcodes || {};
    const completedItems = payload.completedItems || [];
    const cartKey = payload.cartKey || '';

    const data = { repricingData, appTabId, completedBarcodes, completedItems, cartKey, nosposTabId };
    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: nosposTabId, type: 'openNospos', repricingData };
    await setPending(pending);

    const stored = await chrome.storage.local.get('cgNosposRepricingProgress');
    const merged = stored.cgNosposRepricingProgress && stored.cgNosposRepricingProgress.cartKey === cartKey
      ? { ...data, completedBarcodes: { ...completedBarcodes, ...stored.cgNosposRepricingProgress.completedBarcodes }, completedItems: [...new Set([...completedItems, ...(stored.cgNosposRepricingProgress.completedItems || [])])] }
      : data;
    const initialData = {
      ...merged,
      queue: buildBarcodeQueue(repricingData, merged.completedBarcodes, merged.completedItems, {}),
      awaitingStockSelection: false,
      currentBarcode: '',
      currentItemId: '',
      currentItemIndex: null,
      currentBarcodeIndex: null,
      skippedBarcodes: {},
      ambiguousBarcodes: [],
      justSaved: false,
      verifyRetries: 0,
      done: false,
      pendingCompletion: null,
      verifiedChanges: [],
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Started repricing.'
      }],
      step: 'starting',
      message: 'Opening hidden NoSpos worker'
    };
    await chrome.storage.session.set({
      cgNosposRepricingData: initialData
    });
    await chrome.storage.local.set({ cgNosposRepricingProgress: { cartKey, completedBarcodes: merged.completedBarcodes, completedItems: merged.completedItems, appTabId } });
    await broadcastRepricingStatus(appTabId, initialData, {
      step: 'starting',
      message: 'Opening hidden NoSpos worker'
    });

    console.log('[CG Suite] openNosposAndWait – waiting for user to land on nospos.com', { requestId, listingTabId: nosposTabId });
    return { ok: true };
  }

  if (payload.action === 'getLastRepricingResult') {
    return { ok: true, payload: await getLastRepricingResult() };
  }

  if (payload.action === 'clearLastRepricingResult') {
    await clearLastRepricingResult();
    return { ok: true };
  }

  if (payload.action === 'getNosposRepricingStatus') {
    return { ok: true, payload: await getRepricingStatus() };
  }

  if (payload.action === 'cancelNosposRepricing') {
    const nosposData = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;
    const progress = (await chrome.storage.local.get('cgNosposRepricingProgress')).cgNosposRepricingProgress;
    const appTabId = nosposData?.appTabId ?? progress?.appTabId;
    const nosposTabId = nosposData?.nosposTabId;
    const cartKey = nosposData?.cartKey ?? progress?.cartKey ?? payload.cartKey ?? '';

    await clearNosposRepricingState(nosposTabId || 0);
    const cancelledStatus = {
      cartKey,
      running: false,
      done: false,
      cancelled: true,
      step: 'cancelled',
      message: 'Repricing was cancelled.',
      completedBarcodes: nosposData?.completedBarcodes ?? progress?.completedBarcodes ?? {},
      completedItems: nosposData?.completedItems ?? progress?.completedItems ?? [],
      logs: [...(nosposData?.logs || []), {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Repricing was cancelled by the user.'
      }].slice(-200)
    };
    await setRepricingStatus(cancelledStatus);
    if (appTabId) {
      chrome.tabs.sendMessage(appTabId, {
        type: 'REPRICING_PROGRESS_TO_PAGE',
        payload: cancelledStatus
      }).catch(() => {});
    }
    if (nosposTabId) {
      chrome.tabs.remove(nosposTabId).catch(() => {});
    }
    return { ok: true };
  }

  if (payload.action === 'startRefine' && appTabId != null) {
    const listingPageUrl = payload.listingPageUrl;
    const competitor = payload.competitor === 'CashConverters' ? 'CashConverters' : 'eBay';
    const defaultUrl = competitor === 'CashConverters'
      ? 'https://www.cashconverters.co.uk/'
      : 'https://www.ebay.co.uk/';
    const urlToOpen = ensureEbayFilters(listingPageUrl) || defaultUrl;
    const marketComparisonContext = payload.marketComparisonContext || null;

    const tabs = await chrome.tabs.query({});
    const existingTab = listingPageUrl ? tabs.find(t => t.url === listingPageUrl) : null;

    let listingTabId;
    if (existingTab) {
      listingTabId = existingTab.id;
      await chrome.tabs.update(existingTab.id, { active: true }).catch(() => {});
      if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => {});
      await putTabInYellowGroup(existingTab.id);
    } else {
      const newTab = await chrome.tabs.create({ url: urlToOpen });
      await putTabInYellowGroup(newTab.id);
      await chrome.tabs.update(newTab.id, { active: true }).catch(() => {});
      listingTabId = newTab.id;
    }

    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId, competitor, marketComparisonContext };
    await setPending(pending);

    await sendWaitingForData(listingTabId, requestId, marketComparisonContext, 5, true);

    return { ok: true };
  }

  return { ok: false };
}

/**
 * Send WAITING_FOR_DATA to the content script so it shows "Have you got the data yet?" (or "Are you done?" for refine).
 * Retries a few times with delay in case the content script was injected after we received LISTING_PAGE_READY.
 */
async function sendWaitingForData(tabId, requestId, marketComparisonContext, retriesLeft, isRefine) {
  const payload = {
    type: 'WAITING_FOR_DATA',
    requestId: requestId,
    marketComparisonContext: marketComparisonContext || null,
    isRefine: !!isRefine
  };
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    console.log('[CG Suite] WAITING_FOR_DATA sent to tab', tabId);
    return true;
  } catch (err) {
    if (retriesLeft > 0) {
      console.log('[CG Suite] WAITING_FOR_DATA send failed, retrying in 300ms, retriesLeft=', retriesLeft, err?.message);
      await new Promise(r => setTimeout(r, 300));
      return sendWaitingForData(tabId, requestId, marketComparisonContext, retriesLeft - 1, isRefine);
    }
    console.warn('[CG Suite] WAITING_FOR_DATA send failed after retries', err?.message);
    return false;
  }
}

async function handleListingPageReady(message, sender) {
  const tabId = sender.tab?.id;
  const tabUrl = (sender.tab?.url || '').toLowerCase();

  console.log('[CG Suite] LISTING_PAGE_READY received from tab', tabId, 'url=', tabUrl, 'explicitRequestId=', message?.requestId);

  const pending = await getPending();
  const entries = Object.entries(pending);

  let matchedId = null;
  let matchedEntry = null;

  // 1. If the content script provided an explicit requestId (CeX: from cgReq in URL / sessionStorage),
  //    only accept it if this tab is already the one we opened for that request (no re-association to other tabs).
  const explicitRequestId = message && message.requestId;
  if (explicitRequestId && pending[explicitRequestId] && pending[explicitRequestId].listingTabId === tabId) {
    matchedId = explicitRequestId;
    matchedEntry = pending[explicitRequestId];
    console.log('[CG Suite] LISTING_PAGE_READY matched by explicit requestId (same tab)', { explicitRequestId, tabId });
  }

  // 2. Otherwise match by tab: only the tab we opened (listingTabId) can complete this flow.
  if (!matchedEntry) {
    for (const [rid, entry] of entries) {
      if (entry.listingTabId === tabId) {
        matchedId = rid;
        matchedEntry = entry;
        console.log('[CG Suite] LISTING_PAGE_READY matched by listingTabId', { matchedId, tabId });
        break;
      }
    }
  }

  // Do NOT re-associate to a different tab: user must use the single tab we opened. Other CeX tabs are ignored.

  if (matchedEntry) {
    console.log('[CG Suite] LISTING_PAGE_READY matched', { matchedId, tabId, competitor: matchedEntry.competitor });
    await sendWaitingForData(tabId, matchedId, matchedEntry.marketComparisonContext || null, 5);
  } else {
    console.log('[CG Suite] LISTING_PAGE_READY – no matching pending request for tab', tabId, 'pending keys:', Object.keys(pending));
  }
}

async function handleNosposPageReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId !== tabId) continue;
    if (entry.type === 'openNospos') {
      // Navigate to stock search; keep pending so content script can get repricingData and fill first barcode
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/stock/search' });
      const stored = await chrome.storage.session.get('cgNosposRepricingData');
      const nextData = appendRepricingLog(stored.cgNosposRepricingData, 'Logged into NoSpos. Opening stock search…');
      await chrome.storage.session.set({ cgNosposRepricingData: nextData });
      await broadcastRepricingStatus(entry.appTabId, nextData, {
        step: 'search',
        message: 'Logged into NoSpos. Opening stock search…'
      });
      console.log('[CG Suite] NOSPOS_PAGE_READY – navigating to /stock/search', { requestId });
      return;
    }
    if (entry.type === 'openNosposCustomerIntake') {
      // First time landing on nospos after opening the tab — user is now logged in.
      // Navigate to /customers and mark as waiting.
      pending[requestId] = { ...entry, type: 'openNosposCustomerIntakeWaiting' };
      await setPending(pending);
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/customers' });
      console.log('[CG Suite] NOSPOS_PAGE_READY – customer intake: navigating to /customers', { requestId });
      return;
    }
    if (entry.type === 'openNosposCustomerIntakeWaiting') {
      // The user logged in and was bounced back to the home page (or some other nospos page)
      // instead of /customers. Re-navigate them there.
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/customers' });
      console.log('[CG Suite] NOSPOS_PAGE_READY – re-navigating to /customers after post-login redirect', { requestId });
      return;
    }
  }
  console.log('[CG Suite] NOSPOS_PAGE_READY – no matching pending request for tab', tabId);
}

async function handleNosposLoginRequired(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const pending = await getPending();
  const loginUrl = message?.url || '';
  const errorMessage = 'You must be logged into NoSpos to continue.';

  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId !== tabId) continue;
    if (entry.type !== 'openNospos' && entry.type !== 'openNosposCustomerIntake' && entry.type !== 'openNosposCustomerIntakeWaiting') {
      continue;
    }

    await failNosposRequestAndCloseTab(requestId, entry, errorMessage);
    console.log('[CG Suite] NOSPOS_LOGIN_REQUIRED – closed tab and failed request', { requestId, tabId, loginUrl, type: entry.type });
    return;
  }

  console.log('[CG Suite] NOSPOS_LOGIN_REQUIRED – no matching pending request for tab', tabId, loginUrl);
}

async function handleNosposCustomerSearchReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === tabId && entry.type === 'openNosposCustomerIntakeWaiting') {
      console.log('[CG Suite] NOSPOS_CUSTOMER_SEARCH_READY – returning requestId to content script', { requestId });
      return { ok: true, requestId };
    }
  }
  return { ok: false };
}

async function handleNosposCustomerDetailReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === tabId && entry.type === 'openNosposCustomerIntakeWaiting') {
      console.log('[CG Suite] NOSPOS_CUSTOMER_DETAIL_READY – user on customer detail page, returning requestId', { requestId });
      return { ok: true, requestId };
    }
  }
  return { ok: false };
}

async function handleNosposCustomerDone(message, sender) {
  const { requestId, cancelled } = message;
  if (!requestId) return;

  const pending = await getPending();
  const entry = pending[requestId];
  if (!entry) return;

  delete pending[requestId];
  await setPending(pending);

  if (entry.appTabId) {
    chrome.tabs.sendMessage(entry.appTabId, {
      type: 'EXTENSION_RESPONSE_TO_PAGE',
      requestId,
      response: cancelled
        ? { ok: false, cancelled: true }
        : { ok: true, customer: message.customer || null, changes: message.changes || [], saveFailed: !!message.saveFailed }
    }).catch(() => {});
    if (!message.saveFailed) {
      await focusAppTab(entry.appTabId);
    }
  }
  // Close the NoSpos tab when flow completed successfully (keep it open if save failed so user can fix)
  if (entry.listingTabId != null && !message.saveFailed) {
    await chrome.tabs.remove(entry.listingTabId).catch(() => {});
  }
  console.log('[CG Suite] NOSPOS_CUSTOMER_DONE – resolved app promise, focused app tab, closed nospos tab', { requestId, cancelled });
}

function findNextBarcode(repricingData, completedBarcodes, completedItems, skippedBarcodes = {}) {
  for (let i = 0; i < repricingData.length; i++) {
    const item = repricingData[i];
    if (completedItems.includes(item?.itemId)) continue;
    const done = completedBarcodes[item?.itemId] || [];
    const skipped = skippedBarcodes[item?.itemId] || [];
    for (let j = 0; j < (item?.barcodes?.length || 0); j++) {
      if (done.includes(j) || skipped.includes(j)) continue;
      const barcode = (item.barcodes[j] || '').trim();
      if (barcode) return { itemIndex: i, barcodeIndex: j, barcode };
    }
  }
  return null;
}

function applyVerifiedBarcodeCompletion(data) {
  const pendingCompletion = data?.pendingCompletion;
  if (!pendingCompletion?.itemId || pendingCompletion?.barcodeIndex == null) {
    return null;
  }

  const completedBarcodes = { ...(data.completedBarcodes || {}) };
  const completedItems = [...(data.completedItems || [])];
  const itemId = pendingCompletion.itemId;
  const barcodeIndex = pendingCompletion.barcodeIndex;

  if (!completedBarcodes[itemId]) completedBarcodes[itemId] = [];
  if (!completedBarcodes[itemId].includes(barcodeIndex)) {
    completedBarcodes[itemId] = [...completedBarcodes[itemId], barcodeIndex];
  }

  const item = (data.repricingData || []).find((entry) => entry?.itemId === itemId);
  const itemBarcodeCount = item?.barcodes?.length || 0;
  if (itemBarcodeCount > 0 && completedBarcodes[itemId].length >= itemBarcodeCount && !completedItems.includes(itemId)) {
    completedItems.push(itemId);
  }

  const verifiedChanges = [...(data.verifiedChanges || [])];
  if (item) {
    verifiedChanges.push({
      item_identifier: item.itemId != null ? String(item.itemId) : '',
      title: item.title || '',
      quantity: item.quantity || 1,
      barcode: pendingCompletion.barcode || '',
      stock_barcode: pendingCompletion.stockBarcode || '',
      stock_url: pendingCompletion.stockUrl || '',
      old_retail_price: pendingCompletion.oldRetailPrice || null,
      new_retail_price: item.salePrice != null ? String(item.salePrice) : null,
      cex_sell_at_repricing: item.cexSellAtRepricing != null ? String(item.cexSellAtRepricing) : null,
      our_sale_price_at_repricing: item.ourSalePriceAtRepricing != null ? String(item.ourSalePriceAtRepricing) : null,
      raw_data: item.raw_data || {},
      cash_converters_data: item.cash_converters_data || {}
    });
  }

  return { completedBarcodes, completedItems, verifiedChanges };
}

function markBarcodeAsAmbiguous(data, next) {
  if (!data || !next) return data;

  const item = (data.repricingData || [])[next.itemIndex];
  const itemId = item?.itemId;
  if (itemId == null) return data;

  const skippedBarcodes = { ...(data.skippedBarcodes || {}) };
  if (!skippedBarcodes[itemId]) skippedBarcodes[itemId] = [];
  if (!skippedBarcodes[itemId].includes(next.barcodeIndex)) {
    skippedBarcodes[itemId] = [...skippedBarcodes[itemId], next.barcodeIndex];
  }

  const ambiguousBarcodes = [...(data.ambiguousBarcodes || [])];
  const alreadyTracked = ambiguousBarcodes.some(
    (entry) => String(entry?.itemId) === String(itemId) && entry?.barcodeIndex === next.barcodeIndex
  );

  if (!alreadyTracked) {
    ambiguousBarcodes.push({
      itemId,
      itemTitle: item?.title || '',
      barcodeIndex: next.barcodeIndex,
      barcode: next.barcode
    });
  }

  return {
    ...data,
    skippedBarcodes,
    ambiguousBarcodes,
    awaitingStockSelection: false,
    currentBarcode: '',
    verifyRetries: 0
  };
}

function buildRepricingCompletionPayload(data) {
  const verifiedChanges = [...(data?.verifiedChanges || [])];
  const ambiguousBarcodes = [...(data?.ambiguousBarcodes || [])];

  return {
    cart_key: data?.cartKey || '',
    item_count: [...new Set(verifiedChanges.map((item) => item.item_identifier).filter(Boolean))].length,
    barcode_count: verifiedChanges.length,
    items_data: verifiedChanges,
    ambiguous_barcodes: ambiguousBarcodes
  };
}

async function finalizeNosposRepricing(data, tabId) {
  const completedData = appendRepricingLog(
    { ...data, done: true, step: 'completed', message: 'Repricing completed.' },
    'Repricing completed.',
    'success'
  );
  const finalPayload = buildRepricingCompletionPayload(data);
  if (finalPayload.barcode_count > 0 || finalPayload.ambiguous_barcodes.length > 0) {
    await setLastRepricingResult(finalPayload);
    await sendRepricingComplete(data?.appTabId, finalPayload);
  }
  await setRepricingStatus(buildRepricingStatusPayload(completedData, {
    step: 'completed',
    message: 'Repricing completed.'
  }));
  await clearNosposRepricingState(tabId);
  await focusAppTab(data?.appTabId);
  if (tabId != null) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return finalPayload;
}

async function handleNosposStockSearchReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  let data = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;

  if (!data) {
    const pending = await getPending();
    for (const [requestId, entry] of Object.entries(pending)) {
      if (entry.type === 'openNospos' && entry.listingTabId === tabId) {
        const repricingData = entry.repricingData || [];
        delete pending[requestId];
        await setPending(pending);
        const stored = await chrome.storage.local.get('cgNosposRepricingProgress');
        const prog = stored.cgNosposRepricingProgress || {};
        data = {
          repricingData,
          appTabId: entry.appTabId,
          completedBarcodes: prog.completedBarcodes || {},
          completedItems: prog.completedItems || [],
          cartKey: prog.cartKey || '',
          nosposTabId: tabId,
          queue: buildBarcodeQueue(repricingData, prog.completedBarcodes || {}, prog.completedItems || [], {}),
          awaitingStockSelection: false,
          currentBarcode: '',
          currentItemId: '',
          currentItemIndex: null,
          currentBarcodeIndex: null,
          skippedBarcodes: {},
          ambiguousBarcodes: [],
          justSaved: false,
          verifyRetries: 0,
          done: false,
          pendingCompletion: null,
          verifiedChanges: []
        };
        await chrome.storage.session.set({ cgNosposRepricingData: data });
        chrome.tabs.sendMessage(entry.appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId,
          response: { success: true, ready: true }
        }).catch(() => {});
        break;
      }
    }
  }

  if (!data) return { ok: false };

  const {
    repricingData = [],
    completedBarcodes = {},
    completedItems = [],
    awaitingStockSelection,
    currentBarcode
  } = data;
  const queue = getActiveQueue(data);
  const next = queue[0] || null;

  if (!next) {
    const finalizingData = appendRepricingLog(data, 'All barcodes processed. Finalizing repricing…');
    await chrome.storage.session.set({ cgNosposRepricingData: finalizingData });
    await broadcastRepricingStatus(finalizingData.appTabId, finalizingData, {
      step: 'finalizing',
      message: 'All barcodes processed. Finalizing repricing…'
    });
    await finalizeNosposRepricing(finalizingData, tabId);
    return { ok: false };
  }

  if (awaitingStockSelection && currentBarcode === next.barcode) {
    const ambiguousData = markBarcodeAsAmbiguous(data, next);
    const nextQueue = queue.slice(1);
    const nextAfterSkip = nextQueue[0] || null;

    if (!nextAfterSkip) {
      await finalizeNosposRepricing({ ...ambiguousData, queue: nextQueue }, tabId);
      return { ok: false };
    }

    const updatedData = appendRepricingLog(
      {
        ...ambiguousData,
        queue: nextQueue,
        nosposTabId: tabId,
        awaitingStockSelection: true,
        currentBarcode: nextAfterSkip.barcode,
        currentItemId: nextAfterSkip.itemId || '',
        currentItemIndex: nextAfterSkip.itemIndex,
        currentBarcodeIndex: nextAfterSkip.barcodeIndex,
        verifyRetries: 0
      },
      `No single stock row could be selected for ${next.barcode}. Marking it as ambiguous and moving to ${nextAfterSkip.barcode}.`,
      'warning'
    );
    await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
    await broadcastRepricingStatus(updatedData.appTabId, updatedData, {
      step: 'search',
      message: `Skipped ambiguous barcode ${next.barcode}`
    });

    return { ok: true, firstBarcode: nextAfterSkip.barcode, skippedPreviousBarcode: true };
  }

  const itemWithContext = repricingData[next.itemIndex];
  const dataWithItemHeader = addItemContextLog(data, itemWithContext);
  const updatedData = appendRepricingLog(
    {
      ...dataWithItemHeader,
      queue,
      nosposTabId: tabId,
      awaitingStockSelection: true,
      currentBarcode: next.barcode,
      currentItemId: next.itemId || '',
      currentItemIndex: next.itemIndex,
      currentBarcodeIndex: next.barcodeIndex,
      verifyRetries: 0
    },
    `Doing barcode ${next.barcode}.`
  );
  await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
  await broadcastRepricingStatus(updatedData.appTabId, updatedData, {
    step: 'search',
    message: `Searching barcode ${next.barcode}`,
    currentBarcode: next.barcode,
    currentItemId: next.itemId || '',
    currentItemTitle: next.itemTitle || repricingData[next.itemIndex]?.title || ''
  });

  return { ok: true, firstBarcode: next.barcode };
}

async function handleNosposStockEditReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const stored = await chrome.storage.session.get('cgNosposRepricingData');
  const data = stored.cgNosposRepricingData;
  if (!data) return { ok: false };
  if (data.justSaved) return { ok: false, waitingForVerification: true };

  const { repricingData = [], appTabId, completedBarcodes = {}, completedItems = [], cartKey, nosposTabId } = data;
  const queue = getActiveQueue(data);
  const next = queue[0] || null;
  if (!next) return { ok: false };

  const item = repricingData[next.itemIndex];
  const raw = item?.salePrice;
  const salePrice = raw != null && typeof raw === 'number' && !Number.isNaN(raw)
    ? raw.toFixed(2)
    : (raw != null ? String(raw) : '');

  // Always set justSaved and wait for page reload + verification before proceeding.
  // Do NOT focus app tab here - wait until after verify + navigate to search, then focus when done.
  const updatedData = appendRepricingLog({
    ...data,
    repricingData,
    appTabId,
    completedBarcodes,
    completedItems,
    cartKey,
    nosposTabId: nosposTabId || tabId,
    queue,
    awaitingStockSelection: false,
    currentBarcode: '',
    currentItemId: '',
    currentItemIndex: null,
    currentBarcodeIndex: null,
    justSaved: true,
    lastSalePrice: salePrice,
    verifyRetries: 0,
    done: false,
    pendingCompletion: {
      itemId: item?.itemId,
      barcodeIndex: next.barcodeIndex,
      barcode: next.barcode,
      oldRetailPrice: message.oldRetailPrice || '',
      stockBarcode: message.stockBarcode || '',
      stockUrl: sender.tab?.url || ''
    }
  }, `Saving barcode ${next.barcode}.`);
  await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
  await broadcastRepricingStatus(appTabId, updatedData, {
    step: 'saving',
    message: `Saving retail price for ${next.barcode}…`,
    currentBarcode: next.barcode,
    currentItemId: item?.itemId || '',
    currentItemTitle: item?.title || ''
  });

  return { ok: true, salePrice, done: false };
}

function normalizePriceForCompare(val) {
  if (val == null || val === '') return '';
  const s = String(val).replace(/[£,\s]/g, '').trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? s : n.toFixed(2);
}

async function handleNosposPageLoaded(message, sender) {
  const tabId = sender.tab?.id;
  const path = (message.path || '').toLowerCase();
  const retailPrice = (message.retailPrice || '').trim();
  const stockBarcode = (message.stockBarcode || '').trim();

  const stored = await chrome.storage.session.get('cgNosposRepricingData');
  const data = stored.cgNosposRepricingData;
  if (!data) return;

  const isSearchPage = isNosposSearchPath(path);
  const isEditPage = /^\/stock\/\d+\/edit\/?$/.test(path);

  if (isEditPage && data.justSaved) {
    const lastSalePrice = data.lastSalePrice || '';
    const expected = normalizePriceForCompare(lastSalePrice);
    const actual = normalizePriceForCompare(retailPrice);
    const verified = expected !== '' && actual !== '' && expected === actual;

    if (verified) {
      const verifiedData = {
        ...data,
        pendingCompletion: data.pendingCompletion
          ? {
              ...data.pendingCompletion,
              stockBarcode: stockBarcode || data.pendingCompletion.stockBarcode || ''
            }
          : data.pendingCompletion
      };
      const updatedProgress = applyVerifiedBarcodeCompletion(verifiedData);
      if (!updatedProgress) return;
      const { completedBarcodes, completedItems, verifiedChanges } = updatedProgress;
      const nextQueue = removeQueueHead(data.queue, data.pendingCompletion);
      const payload = { cartKey: data.cartKey, completedBarcodes, completedItems };
      const verifiedState = appendRepricingLog(
        {
          ...verifiedData,
          completedBarcodes,
          completedItems,
          verifiedChanges,
          queue: nextQueue
        },
        `Barcode ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'} saved.`,
        'success'
      );
      await broadcastRepricingStatus(data.appTabId, verifiedState, {
        ...payload,
        step: 'verified',
        message: `Verified ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'}.`
      });
      await chrome.storage.local.set({
        cgNosposRepricingProgress: {
          cartKey: data.cartKey,
          completedBarcodes,
          completedItems,
          appTabId: data.appTabId
        }
      });
      const done = nextQueue.length === 0;

      if (done) {
        await finalizeNosposRepricing(
          {
            ...verifiedState,
            completedBarcodes,
            completedItems,
            verifiedChanges,
            queue: nextQueue,
            pendingCompletion: null
          },
          tabId
        );
      } else {
        await chrome.storage.session.set({
          cgNosposRepricingData: {
            ...verifiedState,
            completedBarcodes,
            completedItems,
            verifiedChanges,
            queue: nextQueue,
            justSaved: false,
            verifyRetries: 0,
            pendingCompletion: null,
            done
          }
        });
        if (tabId) await chrome.tabs.update(tabId, { url: 'https://nospos.com/stock/search' });
      }
    } else {
      const retries = (data.verifyRetries || 0) + 1;
      if (retries < 5) {
        const retryState = {
          ...data,
          verifyRetries: retries
        };
        await chrome.storage.session.set({ cgNosposRepricingData: retryState });
        await broadcastRepricingStatus(data.appTabId, retryState, {
          step: 'verifying',
          message: `Checking that NoSpos saved the new retail price for ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'}…`
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'NOSPOS_VERIFY_RETAIL_PRICE' }).catch(() => {});
        }, 800);
      } else {
        const failedVerify = appendRepricingLog(
          { ...data, verifyRetries: retries },
          `Could not verify saved price for ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'} after ${retries} attempts.`,
          'warning'
        );
        await chrome.storage.session.set({ cgNosposRepricingData: failedVerify });
        await broadcastRepricingStatus(data.appTabId, failedVerify, {
          step: 'verifying',
          message: `Still waiting to verify ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'}…`
        });
      }
    }
    return;
  }

  if (isSearchPage && data.justSaved) {
    const searchResetState = appendRepricingLog(
      { ...data, justSaved: false, verifyRetries: 0 },
      'Returned to the stock search page. Preparing the next barcode…'
    );
    await chrome.storage.session.set({
      cgNosposRepricingData: searchResetState
    });
    await broadcastRepricingStatus(data.appTabId, searchResetState, {
      step: 'search',
      message: 'Returned to stock search. Preparing the next barcode…'
    });
    return;
  }

  if (!isSearchPage && !isEditPage && tabId) {
    const rerouteState = appendRepricingLog(
      { ...data, justSaved: false, verifyRetries: 0 },
      'NoSpos moved away from the expected page. Redirecting back to stock search…',
      'warning'
    );
    await chrome.storage.session.set({
      cgNosposRepricingData: rerouteState
    });
    await broadcastRepricingStatus(data.appTabId, rerouteState, {
      step: 'search',
      message: 'Redirecting the background worker back to stock search…'
    });
    await chrome.tabs.update(tabId, { url: 'https://nospos.com/stock/search' });
  }
}

async function handleScrapedData(message) {
  const { requestId, data } = message;

  const pending = await getPending();
  const entry = pending[requestId];

  if (entry?.appTabId != null) {
    const listingTabId = entry.listingTabId;
    delete pending[requestId];
    await setPending(pending);

    const appTab = await chrome.tabs.get(entry.appTabId).catch(() => null);
    await chrome.tabs.update(entry.appTabId, { active: true }).catch(() => {});
    if (appTab?.windowId) await chrome.windows.update(appTab.windowId, { focused: true }).catch(() => {});

    await chrome.tabs.sendMessage(entry.appTabId, {
      type: 'EXTENSION_RESPONSE_TO_PAGE',
      requestId,
      response: data
    });

    // Close the listing tab (eBay, Cash Converters, or CeX) after data was sent to the app.
    // Never close openNospos tabs – user needs them to log in.
    if (listingTabId != null && entry.type !== 'openNospos') {
      await chrome.tabs.remove(listingTabId).catch(() => {});
    }
    return { ok: true };
  }

  return { ok: false };
}

// ── Tab close: only the single tab we opened is tracked; closing it notifies the app ─────────────

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  const nosposData = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;
  const progress = (await chrome.storage.local.get('cgNosposRepricingProgress')).cgNosposRepricingProgress;
  if (nosposData?.nosposTabId === removedTabId) {
    const appTabId = nosposData?.appTabId ?? progress?.appTabId;
    await clearNosposRepricingState(removedTabId);
    const cancelledStatus = {
      cartKey: nosposData?.cartKey ?? progress?.cartKey ?? '',
      running: false,
      done: false,
      cancelled: true,
      step: 'cancelled',
      message: 'NoSpos tab was closed. Repricing cancelled.',
      completedBarcodes: nosposData?.completedBarcodes ?? progress?.completedBarcodes ?? {},
      completedItems: nosposData?.completedItems ?? progress?.completedItems ?? [],
      logs: [...(nosposData?.logs || []), {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'NoSpos tab was closed. Repricing cancelled.'
      }].slice(-200)
    };
    await setRepricingStatus(cancelledStatus);
    if (appTabId) {
      chrome.tabs.sendMessage(appTabId, {
        type: 'REPRICING_PROGRESS_TO_PAGE',
        payload: cancelledStatus
      }).catch(() => {});
    }
  }

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === removedTabId) {
      delete pending[requestId];
      await setPending(pending);
      chrome.tabs.sendMessage(entry.appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        response: { success: false, error: 'Tab was closed. You can try again when ready.' }
      }).catch(() => {});
      break;
    }
  }
});
