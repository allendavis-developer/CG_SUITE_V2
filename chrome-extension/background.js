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

async function failNosposRequestAndCloseTab(requestId, entry, message) {
  const pending = await getPending();
  if (pending[requestId]) {
    delete pending[requestId];
    await setPending(pending);
  }

  if (entry?.type === 'openNospos') {
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
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const repricingData = payload.repricingData || [];
    const completedBarcodes = payload.completedBarcodes || {};
    const completedItems = payload.completedItems || [];
    const cartKey = payload.cartKey || '';

    const data = { repricingData, appTabId, completedBarcodes, completedItems, cartKey, nosposTabId: newTab.id };
    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: newTab.id, type: 'openNospos', repricingData };
    await setPending(pending);

    const stored = await chrome.storage.local.get('cgNosposRepricingProgress');
    const merged = stored.cgNosposRepricingProgress && stored.cgNosposRepricingProgress.cartKey === cartKey
      ? { ...data, completedBarcodes: { ...completedBarcodes, ...stored.cgNosposRepricingProgress.completedBarcodes }, completedItems: [...new Set([...completedItems, ...(stored.cgNosposRepricingProgress.completedItems || [])])] }
      : data;
    await chrome.storage.session.set({
      cgNosposRepricingData: {
        ...merged,
        awaitingStockSelection: false,
        currentBarcode: '',
        skippedBarcodes: {},
        ambiguousBarcodes: [],
        justSaved: false,
        verifyRetries: 0,
        done: false,
        pendingCompletion: null,
        verifiedChanges: []
      }
    });
    await chrome.storage.local.set({ cgNosposRepricingProgress: { cartKey, completedBarcodes: merged.completedBarcodes, completedItems: merged.completedItems, appTabId } });

    console.log('[CG Suite] openNosposAndWait – waiting for user to land on nospos.com', { requestId, listingTabId: newTab.id });
    return { ok: true };
  }

  if (payload.action === 'getLastRepricingResult') {
    return { ok: true, payload: await getLastRepricingResult() };
  }

  if (payload.action === 'clearLastRepricingResult') {
    await clearLastRepricingResult();
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
        : { ok: true, customer: message.customer || null, changes: message.changes || [] }
    }).catch(() => {});
    await focusAppTab(entry.appTabId);
  }
  // Close the NoSpos tab now that the flow is complete
  if (entry.listingTabId != null) {
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
  const finalPayload = buildRepricingCompletionPayload(data);
  if (finalPayload.barcode_count > 0 || finalPayload.ambiguous_barcodes.length > 0) {
    await setLastRepricingResult(finalPayload);
    await sendRepricingComplete(data?.appTabId, finalPayload);
  }
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
          awaitingStockSelection: false,
          currentBarcode: '',
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
  const next = findNextBarcode(repricingData, completedBarcodes, completedItems, data.skippedBarcodes || {});

  if (!next) {
    await finalizeNosposRepricing(data, tabId);
    return { ok: false };
  }

  if (awaitingStockSelection && currentBarcode === next.barcode) {
    const ambiguousData = markBarcodeAsAmbiguous(data, next);
    const nextAfterSkip = findNextBarcode(
      ambiguousData.repricingData || [],
      ambiguousData.completedBarcodes || {},
      ambiguousData.completedItems || [],
      ambiguousData.skippedBarcodes || {}
    );

    if (!nextAfterSkip) {
      await finalizeNosposRepricing(ambiguousData, tabId);
      return { ok: false };
    }

    await chrome.storage.session.set({
      cgNosposRepricingData: {
        ...ambiguousData,
        nosposTabId: tabId,
        awaitingStockSelection: true,
        currentBarcode: nextAfterSkip.barcode,
        verifyRetries: 0
      }
    });

    return { ok: true, firstBarcode: nextAfterSkip.barcode, skippedPreviousBarcode: true };
  }

  await chrome.storage.session.set({
    cgNosposRepricingData: {
      ...data,
      nosposTabId: tabId,
      awaitingStockSelection: true,
      currentBarcode: next.barcode,
      verifyRetries: 0
    }
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
  const next = findNextBarcode(repricingData, completedBarcodes, completedItems, data.skippedBarcodes || {});
  if (!next) return { ok: false };

  const item = repricingData[next.itemIndex];
  const raw = item?.salePrice;
  const salePrice = raw != null && typeof raw === 'number' && !Number.isNaN(raw)
    ? raw.toFixed(2)
    : (raw != null ? String(raw) : '');

  // Always set justSaved and wait for page reload + verification before proceeding.
  // Do NOT focus app tab here - wait until after verify + navigate to search, then focus when done.
  await chrome.storage.session.set({
    cgNosposRepricingData: {
      ...data,
      repricingData,
      appTabId,
      completedBarcodes,
      completedItems,
      cartKey,
      nosposTabId: nosposTabId || tabId,
      awaitingStockSelection: false,
      currentBarcode: '',
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
    }
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
      const payload = { cartKey: data.cartKey, completedBarcodes, completedItems };
      if (data.appTabId) {
        chrome.tabs.sendMessage(data.appTabId, { type: 'REPRICING_PROGRESS_TO_PAGE', payload }).catch(() => {});
      }
      await chrome.storage.local.set({
        cgNosposRepricingProgress: {
          cartKey: data.cartKey,
          completedBarcodes,
          completedItems,
          appTabId: data.appTabId
        }
      });
      const done = findNextBarcode(
        data.repricingData || [],
        completedBarcodes,
        completedItems,
        data.skippedBarcodes || {}
      ) == null;

      if (done) {
        await finalizeNosposRepricing(
          {
            ...verifiedData,
            completedBarcodes,
            completedItems,
            verifiedChanges,
            pendingCompletion: null
          },
          tabId
        );
      } else {
        await chrome.storage.session.set({
          cgNosposRepricingData: {
            ...verifiedData,
            completedBarcodes,
            completedItems,
            verifiedChanges,
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
        await chrome.storage.session.set({
          cgNosposRepricingData: { ...data, verifyRetries: retries }
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'NOSPOS_VERIFY_RETAIL_PRICE' }).catch(() => {});
        }, 800);
      } else {
        await chrome.storage.session.set({
          cgNosposRepricingData: { ...data, verifyRetries: retries }
        });
      }
    }
    return;
  }

  if (isSearchPage && data.justSaved) {
    await chrome.storage.session.set({
      cgNosposRepricingData: { ...data, justSaved: false, verifyRetries: 0 }
    });
    return;
  }

  if (!isSearchPage && !isEditPage && tabId) {
    await chrome.storage.session.set({
      cgNosposRepricingData: { ...data, justSaved: false, verifyRetries: 0 }
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
  if (nosposData?.nosposTabId === removedTabId) {
    await clearNosposRepricingState(removedTabId);
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
