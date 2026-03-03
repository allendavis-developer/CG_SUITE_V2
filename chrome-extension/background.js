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

// ── Storage helpers ────────────────────────────────────────────────────────────

async function getPending() {
  const data = await chrome.storage.session.get('cgPending');
  return data.cgPending || {};
}

async function setPending(obj) {
  return chrome.storage.session.set({ cgPending: obj });
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
    handleListingPageReady(sender)
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
      url = searchQuery
        ? `https://uk.webuy.com/search?keyword=${encodeURIComponent(searchQuery)}`
        : 'https://uk.webuy.com/';
    } else {
      url = searchQuery
        ? `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}`
        : 'https://www.ebay.co.uk/';
    }

    const newTab = await chrome.tabs.create({ url });

    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: newTab.id, competitor, marketComparisonContext };
    await setPending(pending);

    console.log('[CG Suite] startWaitingForData saved – when this tab (or a CeX product tab) sends LISTING_PAGE_READY we will send WAITING_FOR_DATA', { requestId, competitor, listingTabId: newTab.id, appTabId });
    return { ok: true };
  }

  if (payload.action === 'startRefine' && appTabId != null) {
    const listingPageUrl = payload.listingPageUrl;
    const competitor = payload.competitor === 'CashConverters' ? 'CashConverters' : 'eBay';
    const defaultUrl = competitor === 'CashConverters'
      ? 'https://www.cashconverters.co.uk/'
      : 'https://www.ebay.co.uk/';
    const urlToOpen = listingPageUrl || defaultUrl;
    const marketComparisonContext = payload.marketComparisonContext || null;

    const tabs = await chrome.tabs.query({});
    const existingTab = listingPageUrl ? tabs.find(t => t.url === listingPageUrl) : null;

    let listingTabId;
    if (existingTab) {
      listingTabId = existingTab.id;
      await chrome.tabs.update(existingTab.id, { active: true }).catch(() => {});
      if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => {});
    } else {
      const newTab = await chrome.tabs.create({ url: urlToOpen });
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

async function handleListingPageReady(sender) {
  const tabId = sender.tab?.id;
  const tabUrl = (sender.tab?.url || '').toLowerCase();

  console.log('[CG Suite] LISTING_PAGE_READY received from tab', tabId, 'url=', tabUrl);

  const pending = await getPending();
  const entries = Object.entries(pending);

  // 1. Try exact match by the tab we created / already associated
  let matchedId = null;
  let matchedEntry = null;

  for (const [rid, entry] of entries) {
    if (entry.listingTabId === tabId) {
      matchedId = rid;
      matchedEntry = entry;
      break;
    }
  }

  // 2. Fallback: user opened product in a different tab (new tab, or same-origin link)
  //    Re-associate the pending CeX request to whichever tab is now on the product page.
  if (!matchedEntry && tabUrl.includes('webuy.com') && tabUrl.includes('product-detail') && tabUrl.includes('id=')) {
    for (const [rid, entry] of entries) {
      if (entry.competitor === 'CeX') {
        matchedId = rid;
        matchedEntry = { ...entry, listingTabId: tabId };
        pending[rid] = matchedEntry;
        await setPending(pending);
        console.log('[CG Suite] LISTING_PAGE_READY re-associated CeX request to tab', tabId);
        break;
      }
    }
  }

  if (matchedEntry) {
    console.log('[CG Suite] LISTING_PAGE_READY matched', { matchedId, tabId, competitor: matchedEntry.competitor });
    await sendWaitingForData(tabId, matchedId, matchedEntry.marketComparisonContext || null, 5);
  } else {
    console.log('[CG Suite] LISTING_PAGE_READY – no matching pending request for tab', tabId, 'pending keys:', Object.keys(pending));
  }
}

async function handleScrapedData(message) {
  const { requestId, data } = message;

  const pending = await getPending();
  const entry = pending[requestId];

  if (entry?.appTabId != null) {
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
    return { ok: true };
  }

  return { ok: false };
}

// ── Tab close: unblock the app if user closes the listing tab ─────────────────

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
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
