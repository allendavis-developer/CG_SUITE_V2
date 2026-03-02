// Pending "wait for data" requests: requestId -> { appTabId, listingTabId? }
const pendingRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BRIDGE_FORWARD') {
    const { requestId, payload } = message;
    const appTabId = sender.tab?.id;
    if (payload.action === 'startWaitingForData' && appTabId != null) {
      const competitor = payload.competitor || 'eBay';
      const searchQuery = (payload.searchQuery || '').trim();
      // Debug: check service worker console (chrome://extensions -> "Inspect views: service worker")
      if (typeof console !== 'undefined') {
        console.log('[CG Suite] startWaitingForData:', { competitor, searchQuery, fullPayload: payload });
      }
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
      chrome.tabs.create({ url }, (newTab) => {
        pendingRequests.set(requestId, { appTabId, listingTabId: newTab.id });
      });
      sendResponse({ ok: true });
    } else if (payload.action === 'startRefine' && appTabId != null) {
      const listingPageUrl = payload.listingPageUrl;
      const defaultUrl = payload.competitor === 'CashConverters'
        ? 'https://www.cashconverters.co.uk/'
        : 'https://www.ebay.co.uk/';
      const urlToOpen = listingPageUrl || defaultUrl;
      function showPanelOnTab(listingTabId) {
        pendingRequests.set(requestId, { appTabId, listingTabId });
        chrome.tabs.sendMessage(listingTabId, { type: 'WAITING_FOR_DATA', requestId, isRefine: true }).catch(() => {});
        sendResponse({ ok: true });
      }
      chrome.tabs.query({}, (tabs) => {
        const tab = listingPageUrl ? tabs.find((t) => t.url === listingPageUrl) : null;
        if (tab) {
          chrome.tabs.update(tab.id, { active: true }, (t) => {
            if (t?.windowId) chrome.windows.update(t.windowId, { focused: true });
          });
          showPanelOnTab(tab.id);
        } else {
          chrome.tabs.create({ url: urlToOpen }, (newTab) => {
            chrome.tabs.update(newTab.id, { active: true }, (t) => {
              if (t?.windowId) chrome.windows.update(t.windowId, { focused: true });
            });
            showPanelOnTab(newTab.id);
          });
        }
      });
    }
    return true;
  }

  if (message.type === 'LISTING_PAGE_READY') {
    const tabId = sender.tab?.id;
    const entry = Array.from(pendingRequests.entries()).find(([, v]) => v.listingTabId === tabId);
    if (entry) {
      const [requestId] = entry;
      chrome.tabs.sendMessage(tabId, { type: 'WAITING_FOR_DATA', requestId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SCRAPED_DATA') {
    const { requestId, data } = message;
    const pending = pendingRequests.get(requestId);
    if (pending?.appTabId != null) {
      pendingRequests.delete(requestId);
      const appTabId = pending.appTabId;
      chrome.tabs.update(appTabId, { active: true }, (tab) => {
        if (tab?.windowId) chrome.windows.update(tab.windowId, { focused: true });
      });
      chrome.tabs.sendMessage(appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        response: data
      }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }

  return false;
});

// If the user closes the listing tab before clicking "Yes" / "Are you done?", resolve the app's
// waiting promise so the Refine/Get data button doesn't stay stuck.
chrome.tabs.onRemoved.addListener((removedTabId) => {
  const entry = Array.from(pendingRequests.entries()).find(([, v]) => v.listingTabId === removedTabId);
  if (!entry) return;
  const [requestId, pending] = entry;
  pendingRequests.delete(requestId);
  chrome.tabs.sendMessage(pending.appTabId, {
    type: 'EXTENSION_RESPONSE_TO_PAGE',
    requestId,
    response: { success: false, error: 'Tab was closed. You can try again when ready.' }
  }).catch(() => {});
});
