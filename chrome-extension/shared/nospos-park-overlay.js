/**
 * Full-page input-blocking overlay during CG Suite Park Agreement.
 * A very transparent dark-blue backdrop covers the whole page (blocks all clicks/input)
 * while keeping everything visible. A floating status badge sits at the top-centre.
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

    // Full-page backdrop — blocks all pointer events so the user cannot click anything,
    // but opacity is very low so page content remains clearly readable.
    var root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('aria-busy', 'true');
    root.setAttribute('aria-live', 'polite');
    root.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 2147483646',
      'pointer-events: all',
      'box-sizing: border-box',
      'background: rgba(8, 18, 56, 0.13)',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: flex-start',
      'padding-top: 18px',
      'cursor: not-allowed',
    ].join(';');

    // Floating badge — sits inside the backdrop, centred at the top.
    root.innerHTML =
      '<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:14px 20px;border-radius:14px;background:rgba(10,20,50,0.92);border:1px solid rgba(250,204,21,0.4);box-shadow:0 10px 36px rgba(0,0,0,0.4);max-width:min(440px,calc(100vw - 28px));cursor:default;">' +
      '<div class="cg-suite-nospos-park-spinner" style="width:36px;height:36px;border:3px solid rgba(254,249,195,0.3);border-top-color:#facc15;border-radius:50%;animation:cg-suite-nospos-park-spin 0.85s linear infinite;flex-shrink:0;"></div>' +
      '<span class="cg-suite-nospos-park-msg" style="font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;color:#f1f5f9;line-height:1.5;letter-spacing:0.01em;"></span>' +
      '</div>';

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
