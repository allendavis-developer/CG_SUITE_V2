/**
 * NosPos draft agreement "items" step (/newagreement/{id}/items): snapshot form for CG Suite mirror
 * and apply field updates / click Next from the app via the extension.
 */
(function () {
  const SNAP_INTERVAL_MS = 4000;
  const SNAP_DEBOUNCE_MS = 120;
  const SNAP_MAX_MS = 120000;

  function escapeCssIdent(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function labelFor(el) {
    try {
      if (el.id) {
        const lab = document.querySelector('label[for="' + escapeCssIdent(el.id) + '"]');
        if (lab) return lab.textContent.replace(/\s+/g, ' ').trim();
      }
    } catch (e) {
      /* ignore */
    }
    const fg = el.closest('.form-group');
    if (fg) {
      const lab = fg.querySelector('label.control-label');
      if (lab) return lab.textContent.replace(/\s+/g, ' ').trim();
    }
    return el.name || el.id || 'Field';
  }

  function shouldIncludeControl(el) {
    const t = (el.type || '').toLowerCase();
    if (t === 'submit' || t === 'button' || t === 'file' || t === 'hidden') return false;
    if (!el.name) return false;
    if (el.name === 'ids[]') return false;
    return true;
  }

  function serializeField(el) {
    const tag = el.tagName.toLowerCase();
    var fg = el.closest('.form-group');
    var fgRequired = fg && fg.classList.contains('required');
    const base = {
      name: el.name,
      id: el.id || null,
      label: labelFor(el),
      control: tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'input',
      inputType: el.type || null,
      value: el.value != null ? String(el.value) : '',
      required:
        el.required === true ||
        el.getAttribute('aria-required') === 'true' ||
        fgRequired === true,
    };
    if (tag === 'select') {
      base.options = Array.prototype.map.call(el.options, function (o) {
        return { value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() };
      });
    }
    return base;
  }

  function buildSnapshot() {
    var form = document.getElementById('items-form');
    if (!form) return null;
    var csrfInput = form.querySelector('input[name="_csrf"]');
    var csrf = csrfInput ? csrfInput.value : null;
    var cards = [];
    var cardEls = form.querySelectorAll('.card');
    cardEls.forEach(function (card, idx) {
      var fields = [];
      card.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (!shouldIncludeControl(el)) return;
        fields.push(serializeField(el));
      });
      if (fields.length === 0) return;
      var titleEl = card.querySelector('.card-title');
      var title = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : 'Item ' + (idx + 1);
      cards.push({
        cardId: card.id || 'card-' + idx,
        title: title,
        fields: fields,
      });
    });
    var nextBtn =
      form.querySelector('button[type="submit"].btn.btn-blue[name="action"][value="next"]') ||
      form.querySelector('button[type="submit"][name="action"][value="next"]');
    return {
      formAction: form.getAttribute('action') || '',
      pageUrl: location.href,
      csrf: csrf,
      cards: cards,
      hasNext: !!nextBtn,
    };
  }

  var lastSentJson = null;
  var started = Date.now();

  function maybeSendSnapshot() {
    if (Date.now() - started > SNAP_MAX_MS) return;
    var snap = buildSnapshot();
    if (!snap || snap.cards.length === 0) return;
    var json = JSON.stringify(snap);
    if (json === lastSentJson) return;
    lastSentJson = json;
    chrome.runtime
      .sendMessage({
        type: 'NOSPOS_ITEMS_FORM_SNAPSHOT',
        payload: snap,
      })
      .catch(function () {});
  }

  var sendTimer = null;
  var hooksInstalled = false;
  var snapshotObserver = null;

  function scheduleSnapshot() {
    if (Date.now() - started > SNAP_MAX_MS) return;
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(function () {
      sendTimer = null;
      maybeSendSnapshot();
    }, SNAP_DEBOUNCE_MS);
  }

  function installSnapshotHooks() {
    if (hooksInstalled) return true;
    var form = document.getElementById('items-form');
    if (!form) return false;
    hooksInstalled = true;
    form.addEventListener('input', scheduleSnapshot, true);
    form.addEventListener('change', scheduleSnapshot, true);
    form.addEventListener('blur', scheduleSnapshot, true);
    snapshotObserver = new MutationObserver(function () {
      scheduleSnapshot();
    });
    snapshotObserver.observe(form, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['value', 'selected', 'disabled', 'class', 'style', 'aria-expanded'],
    });
    return true;
  }

  var tick = setInterval(maybeSendSnapshot, SNAP_INTERVAL_MS);
  var hookTick = setInterval(function () {
    if (installSnapshotHooks()) {
      clearInterval(hookTick);
    }
  }, 300);
  document.addEventListener('visibilitychange', scheduleSnapshot);
  window.addEventListener('load', function () {
    installSnapshotHooks();
    scheduleSnapshot();
  });
  window.addEventListener('beforeunload', function () {
    if (snapshotObserver) {
      snapshotObserver.disconnect();
      snapshotObserver = null;
    }
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
  }, { once: true });
  installSnapshotHooks();
  maybeSendSnapshot();

  function escapeAttrName(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /** Resolve a named control inside #items-form only (avoids wrong global getElementsByName match). */
  function resolveFormControl(form, fieldName) {
    if (!form || !fieldName) return null;
    var named = form.elements.namedItem(fieldName);
    if (named) {
      if (named.tagName) return named;
      if (named.length && named[0] && named[0].tagName) return named[0];
    }
    try {
      return form.querySelector('[name="' + escapeAttrName(fieldName) + '"]');
    } catch (e) {
      return null;
    }
  }

  function flashField(el) {
    if (!el || !el.style) return;
    var prev = el.style.boxShadow;
    el.style.boxShadow = '0 0 0 3px rgba(255, 152, 0, 0.95)';
    el.style.transition = 'box-shadow 0.15s ease';
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e2) {
      /* ignore */
    }
    setTimeout(function () {
      el.style.boxShadow = prev || '';
    }, 400);
  }

  function controlValueMatches(el, expectedStr, actualStr) {
    if (actualStr === expectedStr) return true;
    var t = (el.type || '').toLowerCase();
    if (t === 'number') {
      var a = parseFloat(actualStr);
      var b = parseFloat(expectedStr);
      if (!Number.isNaN(a) && !Number.isNaN(b) && a === b) return true;
    }
    return false;
  }

  function setControlValue(el, value) {
    var str = value != null ? String(value) : '';
    var tag = el.tagName && el.tagName.toLowerCase();
    var before = el.value != null ? String(el.value) : '';
    if (tag === 'select') {
      try { el.focus(); } catch (e0) {}
      el.value = str;
      if (el.value !== str && el.options && el.options.length) {
        var lower = str.toLowerCase();
        for (var oi = 0; oi < el.options.length; oi++) {
          var opt = el.options[oi];
          var t = (opt.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
          var v = String(opt.value || '').toLowerCase();
          if (v === lower || t === lower) {
            el.value = opt.value;
            break;
          }
        }
      }
    } else {
      try {
        var proto = Object.getPrototypeOf(el);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
          desc.set.call(el, str);
        } else {
          el.value = str;
        }
      } catch (e1) {
        el.value = str;
      }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: str }));
    } catch (e) {
      /* InputEvent not supported */
    }
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e2) {}
    var after = el.value != null ? String(el.value) : '';
    return { ok: controlValueMatches(el, str, after), before: before, after: after };
  }

  function findNextButton(form) {
    if (!form) return null;
    var btn =
      form.querySelector('button[type="submit"].btn.btn-blue[name="action"][value="next"]') ||
      form.querySelector('button.btn.btn-blue[type="submit"][name="action"][value="next"]') ||
      form.querySelector('button[type="submit"][name="action"][value="next"]');
    return btn || null;
  }

  function findAddButton(form) {
    if (!form) return null;
    var btn =
      form.querySelector('a.btn.btn-secondary.action-btn[href*="action=add"]') ||
      form.querySelector('a.action-btn[href*="action=add"]') ||
      form.querySelector('a[href*="action=add"][data-method="post"]');
    if (btn) return btn;
    var anchors = form.querySelectorAll('a[href*="action=add"], button');
    for (var i = 0; i < anchors.length; i++) {
      if (/\badd\b/i.test((anchors[i].textContent || '').replace(/\s+/g, ' ').trim())) {
        return anchors[i];
      }
    }
    return null;
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg.type === 'NOSPOS_ITEMS_FORM_APPLY') {
      var fields = msg.fields || [];
      var form = document.getElementById('items-form');
      if (!form) {
        sendResponse({ ok: false, error: 'items-form not found', applied: 0, missing: [] });
        return false;
      }
      var missing = [];
      var failed = [];
      var applied = 0;
      var doFlash = msg.flash === true;

      for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        if (!f || !f.name) continue;
        var el = resolveFormControl(form, f.name);
        if (!el || el.type === 'hidden' || el.disabled) {
          missing.push(f.name);
          continue;
        }
        var setResult = setControlValue(el, f.value);
        if (doFlash) flashField(el);
        if (setResult.ok) applied++;
        else {
          failed.push({
            name: f.name,
            expected: f.value != null ? String(f.value) : '',
            actual: setResult.after,
          });
        }
      }

      lastSentJson = null;
      maybeSendSnapshot();
      sendResponse({
        ok: missing.length === 0 && failed.length === 0,
        applied: applied,
        missing: missing,
        failed: failed,
        partial: missing.length > 0 || failed.length > 0,
      });
      return false;
    }
    if (msg.type === 'NOSPOS_ITEMS_FORM_NEXT') {
      var formN = document.getElementById('items-form');
      var btn = findNextButton(formN);
      if (btn && formN) {
        lastSentJson = null;
        // Signal the next page (still on newagreement/*) to open the Actions dropdown automatically
        try { sessionStorage.setItem('cgOpenActionsDropdown', '1'); } catch (e) {}
        try {
          if (typeof formN.requestSubmit === 'function') {
            formN.requestSubmit(btn);
          } else {
            btn.click();
          }
        } catch (e) {
          btn.click();
        }
        // Return immediately; background verifies navigation after submit.
        sendResponse({ ok: true, submitted: true });
      } else {
        sendResponse({ ok: false, error: 'Next button not found (expected button.btn.btn-blue[type=submit][name=action][value=next])' });
      }
      return true;
    }
    if (msg.type === 'NOSPOS_ITEMS_FORM_ADD') {
      var formA = document.getElementById('items-form');
      var addBtn = findAddButton(formA);
      if (addBtn && formA) {
        lastSentJson = null;
        try {
          addBtn.click();
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || 'Could not click Add button' });
          return false;
        }
        sendResponse({ ok: true, submitted: true });
      } else {
        sendResponse({ ok: false, error: 'Add button not found on NoSpos items form' });
      }
      return false;
    }
    return false;
  });

  /** After the items form submits and the page reloads, open the Actions dropdown if flagged. */
  function maybeOpenActionsDropdown() {
    try {
      if (!sessionStorage.getItem('cgOpenActionsDropdown')) return;
      sessionStorage.removeItem('cgOpenActionsDropdown');
    } catch (e) { return; }

    function findActionsToggle() {
      var candidates = document.querySelectorAll('a.dropdown-toggle[data-toggle="dropdown"], button.dropdown-toggle[data-toggle="dropdown"]');
      for (var i = 0; i < candidates.length; i++) {
        if (/actions/i.test(candidates[i].textContent || '')) return candidates[i];
      }
      return null;
    }

    function tryOpen(attemptsLeft) {
      var toggle = findActionsToggle();
      if (toggle) {
        toggle.click();
        return;
      }
      if (attemptsLeft > 0) {
        setTimeout(function () { tryOpen(attemptsLeft - 1); }, 300);
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      tryOpen(15);
    } else {
      window.addEventListener('load', function () { tryOpen(15); }, { once: true });
    }
  }

  maybeOpenActionsDropdown();
})();
