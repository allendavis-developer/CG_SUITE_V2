/**
 * Runs on the CG Suite app origin (e.g. localhost).
 * Forwards window postMessages from the page to the extension background,
 * and forwards extension responses back to the page.
 */
(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'EXTENSION_RESPONSE_TO_PAGE') {
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
    chrome.runtime.sendMessage({
      type: 'BRIDGE_FORWARD',
      requestId,
      payload: message
    }, (bridgeResponse) => {
      // For startWaitingForData and startRefine we don't resolve here; the listing page will send SCRAPED_DATA later
      if (message.action === 'startWaitingForData' || message.action === 'startRefine') {
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
