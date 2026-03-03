/**
 * CG Suite Research – content script that runs ONLY on the app origin (localhost / 127.0.0.1).
 *
 * Bridges the app page and the extension background:
 * - App posts EXTENSION_MESSAGE (e.g. startWaitingForData for "Add from CeX") → we send BRIDGE_FORWARD to background.
 * - Background eventually sends EXTENSION_RESPONSE_TO_PAGE to this tab (when user clicks "Yes" on the listing page or closes the tab) → we post EXTENSION_RESPONSE to the page so extensionBridge.js can resolve the promise.
 *
 * For startWaitingForData we do NOT post a response immediately; the app waits until the listing-page tab sends scraped data (or error). So the app's getDataFromListingPage() promise only resolves when the user confirms on CeX/eBay/CC or the tab is closed.
 */
(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'EXTENSION_RESPONSE_TO_PAGE') {
      if (typeof console !== 'undefined') {
        console.log('[CG Suite content-bridge] EXTENSION_RESPONSE_TO_PAGE received, requestId=', msg.requestId);
      }
      window.postMessage({
        type: 'EXTENSION_RESPONSE',
        requestId: msg.requestId,
        response: msg.response,
        error: msg.error
      }, '*');
      sendResponse({ ok: true });
    }
    return true;
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.data?.type !== 'EXTENSION_MESSAGE') return;
    const { requestId, message } = event.data;
    if (typeof console !== 'undefined') {
      console.log('[CG Suite content-bridge] EXTENSION_MESSAGE from page → BRIDGE_FORWARD', message?.action, requestId);
    }
    chrome.runtime.sendMessage({
      type: 'BRIDGE_FORWARD',
      requestId,
      payload: message
    }, (bridgeResponse) => {
      // For startWaitingForData and startRefine we don't resolve here; the listing page will send SCRAPED_DATA later and background will send EXTENSION_RESPONSE_TO_PAGE to this tab.
      if (message.action === 'startWaitingForData' || message.action === 'startRefine') {
        if (typeof console !== 'undefined') {
          console.log('[CG Suite content-bridge] startWaitingForData/startRefine – not posting response; waiting for listing page to send data');
        }
        return;
      }
      window.postMessage({
        type: 'EXTENSION_RESPONSE',
        requestId,
        response: bridgeResponse,
        error: chrome.runtime.lastError ? chrome.runtime.lastError.message : null
      }, '*');
    });
  });
})();
