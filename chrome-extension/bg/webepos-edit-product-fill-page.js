/**
 * Injected into Web EPOS edit-product pages (MAIN world). Exposes:
 *   window.__CG_WEB_EPOS_EDIT_SCRAPE() → { title, price, categoryLevels: [{uuid,label},...] }
 *   window.__CG_WEB_EPOS_EDIT_RUN(spec) → fills #price and/or #catLevel{N}
 *   window.__CG_WEB_EPOS_EDIT_FINISH() → clicks "Save Product", waits for save, verifies persisted price
 *
 * spec (all optional — only present fields are edited):
 *   price: number|string
 *   categoryLevelUuids: string[]
 *   categoryLevelLabels: string[]  (fallback when UUIDs missing)
 */
(function () {
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function normText(t) {
    return String(t || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/&amp;/g, '&');
  }

  function setNativeValue(el, value) {
    if (!el) return;
    var v = value == null ? '' : String(value);
    var proto = el.constructor && el.constructor.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectById(id, value) {
    var el = document.getElementById(id);
    if (!el || !value) return;
    setNativeValue(el, value);
  }

  function scrapeEditPage() {
    var title = '';
    var price = '';
    var titleEl = document.getElementById('title');
    if (titleEl) title = String(titleEl.value || '').trim();
    var priceEl = document.getElementById('price');
    if (priceEl) price = String(priceEl.value || '').trim();

    var categoryLevels = [];
    for (var i = 1; i <= 10; i++) {
      var sel = document.getElementById('catLevel' + i);
      if (!sel) break;
      var val = String(sel.value || '').trim();
      if (!val) break;
      var opts = Array.prototype.slice.call(sel.options || []);
      var selectedOpt = null;
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].value === val) { selectedOpt = opts[j]; break; }
      }
      var label = selectedOpt ? String(selectedOpt.textContent || '').trim() : '';
      categoryLevels.push({ uuid: val, label: label });
    }

    return { title: title, price: price, categoryLevels: categoryLevels };
  }

  async function fillCategoryUuids(uuids) {
    var level = 1;
    for (var i = 0; i < uuids.length; i++) {
      var uuid = String(uuids[i] || '').trim();
      if (!uuid) break;
      await sleep(200);
      setSelectById('catLevel' + level, uuid);
      await sleep(450);
      level++;
    }
  }

  async function fillCategoryLabels(labels) {
    var cleaned = (labels || [])
      .map(function (s) { return String(s || '').trim(); })
      .filter(function (s) { return s && !/^all categories$/i.test(s); });
    var level = 1;
    for (var i = 0; i < cleaned.length; i++) {
      var want = normText(cleaned[i]);
      if (!want) continue;
      var deadline = Date.now() + 12000;
      var placed = false;
      while (Date.now() < deadline) {
        var sel = document.getElementById('catLevel' + level);
        if (!sel) { placed = true; break; }
        var opts = Array.prototype.slice.call(sel.options || []).filter(function (o) { return o.value; });
        if (opts.length === 0) { await sleep(120); continue; }
        var hit = opts.find(function (o) { return normText(o.textContent) === want; }) ||
                  opts.find(function (o) {
                    var nt = normText(o.textContent);
                    return nt.indexOf(want) !== -1 || want.indexOf(nt) !== -1;
                  });
        if (hit) {
          setNativeValue(sel, hit.value);
          await sleep(450);
          level++;
          placed = true;
          break;
        }
        break;
      }
      if (!placed) break;
    }
  }

  async function run(spec) {
    if (!spec || typeof spec !== 'object') return;
    await sleep(300);

    if (Array.isArray(spec.categoryLevelUuids) && spec.categoryLevelUuids.length) {
      await fillCategoryUuids(spec.categoryLevelUuids);
    } else if (Array.isArray(spec.categoryLevelLabels) && spec.categoryLevelLabels.length) {
      await fillCategoryLabels(spec.categoryLevelLabels);
    }

    if (spec.price != null && String(spec.price).length > 0) {
      setNativeValue(document.getElementById('price'), String(spec.price));
    }
  }

  /**
   * Click "Save Product" (same label as new-product page per user). Then wait for the save to settle —
   * edit pages usually stay on the same URL, so detect a "Saving…" → idle transition, or fall back to a
   * reload-and-verify round trip.
   */
  async function finishEdit(expectedPrice) {
    await sleep(200);
    var btn = Array.prototype.slice
      .call(document.querySelectorAll('button, input[type="submit"]'))
      .find(function (b) {
        var t = String(b.textContent || b.value || '').replace(/\s+/g, ' ').trim();
        return /save\s*product/i.test(t);
      });
    if (!btn) throw new Error('Save Product button not found on edit page');

    btn.click();

    // Give the app time to POST
    await sleep(1500);

    // Poll for disabled-save cleared / spinner gone / success message visible.
    var settleDeadline = Date.now() + 25000;
    while (Date.now() < settleDeadline) {
      await sleep(300);
      var stillSaving = false;
      try {
        stillSaving = !!document.querySelector(
          'button[disabled][class*="saving"], .saving, [class*="spinner"]:not([style*="display: none"])'
        );
      } catch (_) { stillSaving = false; }
      if (!stillSaving) break;
    }

    // Verify by reloading and re-reading the price (mirrors NosPos repricing verification).
    if (expectedPrice != null && String(expectedPrice).length > 0) {
      try {
        location.reload();
      } catch (_) {}
      var reloadDeadline = Date.now() + 60000;
      while (Date.now() < reloadDeadline) {
        await sleep(500);
        var priceEl = document.getElementById('price');
        if (priceEl) {
          var have = String(priceEl.value || '').trim();
          var want = String(expectedPrice).trim();
          var haveNum = parseFloat(have.replace(/[^\d.]/g, ''));
          var wantNum = parseFloat(want.replace(/[^\d.]/g, ''));
          if (Number.isFinite(haveNum) && Number.isFinite(wantNum) && Math.abs(haveNum - wantNum) < 0.005) {
            return { ok: true };
          }
        }
      }
      return { ok: false, error: 'Price did not persist on Web EPOS after save' };
    }

    return { ok: true };
  }

  window.__CG_WEB_EPOS_EDIT_SCRAPE = scrapeEditPage;
  window.__CG_WEB_EPOS_EDIT_RUN = run;
  window.__CG_WEB_EPOS_EDIT_FINISH = finishEdit;
})();
