/**
 * Floating status badge during CG Suite Park Agreement — no full-page backdrop;
 * the NosPos page stays fully visible. Clicks pass through (`pointer-events: none`).
 */
(function () {
  if (window.__cgNosposParkOverlayHooked) return;
  window.__cgNosposParkOverlayHooked = true;

  var OVERLAY_ID = 'cg-suite-nospos-park-overlay';
  var STYLE_ID = 'cg-suite-nospos-park-overlay-style';
  var DEFAULT_MSG =
    'CG Suite is updating this agreement — please wait. Do not use this tab until finished.';

  function showParkLoadingOverlay(message) {
    var text = (message && String(message).trim()) || DEFAULT_MSG;
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      var span = existing.querySelector('.cg-suite-nospos-park-msg');
      if (span) span.textContent = text;
      return;
    }
    var root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('aria-busy', 'true');
    root.setAttribute('aria-live', 'polite');
    root.style.cssText = [
      'position: fixed',
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 2147483646',
      'pointer-events: none',
      'box-sizing: border-box',
      'max-width: min(420px, calc(100vw - 24px))',
    ].join(';');
    root.innerHTML =
      '<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding:16px 20px;border-radius:14px;background:rgba(15,23,42,0.95);border:1px solid rgba(250,204,21,0.35);box-shadow:0 12px 40px rgba(0,0,0,0.35);">' +
      '<div class="cg-suite-nospos-park-spinner" style="width:40px;height:40px;border:3px solid rgba(254,249,195,0.35);border-top-color:#facc15;border-radius:50%;animation:cg-suite-nospos-park-spin 0.9s linear infinite;flex-shrink:0;"></div>' +
      '<span class="cg-suite-nospos-park-msg" style="font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;color:#f8fafc;line-height:1.45;"></span></div>';
    var msgEl = root.querySelector('.cg-suite-nospos-park-msg');
    if (msgEl) msgEl.textContent = text;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '@keyframes cg-suite-nospos-park-spin { to { transform: rotate(360deg); } }';
    document.documentElement.appendChild(style);
    (document.body || document.documentElement).appendChild(root);
  }

  function removeParkLoadingOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    var styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg && msg.type === 'NOSPOS_PARK_OVERLAY') {
      if (msg.show) showParkLoadingOverlay(msg.message);
      else removeParkLoadingOverlay();
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });

  function syncParkOverlayFromBackground() {
    try {
      chrome.runtime.sendMessage({ type: 'NOSPOS_PARK_UI_SYNC' }, function (r) {
        if (chrome.runtime.lastError) return;
        if (r && r.show) showParkLoadingOverlay(r.message);
        else removeParkLoadingOverlay();
      });
    } catch (_) {}
  }

  function runSync() {
    if (document.body) syncParkOverlayFromBackground();
    else document.addEventListener('DOMContentLoaded', syncParkOverlayFromBackground, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runSync, { once: true });
  } else {
    runSync();
  }

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) syncParkOverlayFromBackground();
  });
})();
