/* eslint-disable no-var, no-console */
/**
 * MINIMAL LEVEL-1-ONLY SCRAPE — diagnostic step.
 *
 * Runs inside Web EPOS `/products/new` (MAIN world). Reads the current options
 * of `#catLevel1` synchronously, logs each one to the tab's console, and
 * returns them. No select-setting, no waiting on React, no recursion.
 *
 * We dropped the full tree walk here because the deeper walk was racing with
 * the MV3 service-worker boundary. Once we confirm this minimal version
 * returns all 17 top-level categories end-to-end, we'll layer the recursion
 * back on top.
 *
 * Entry point:
 *   window.__CG_WEB_EPOS_CATEGORY_TREE_WALK(options?) → {
 *     ok: true, nodes: [{ uuid, name, parent_uuid: null, level: 1 }], log: string[]
 *   } | { ok: false, error, log }
 */
(function () {
  if (window.__CG_WEB_EPOS_CATEGORY_TREE_WALK) return;

  var LOG_PREFIX = '[CG Suite Category Walk]';
  var MAX_LEVELS_PRESENT_CHECK = 10;

  function logInfo(lines, msg) {
    lines.push('[' + new Date().toISOString().slice(11, 23) + '][info] ' + msg);
    try { console.log(LOG_PREFIX, msg); } catch (_) {}
  }
  function logError(lines, msg) {
    lines.push('[' + new Date().toISOString().slice(11, 23) + '][error] ' + msg);
    try { console.error(LOG_PREFIX, msg); } catch (_) {}
  }

  function describeSelect(sel) {
    if (!sel) return 'null';
    var total = sel.options ? sel.options.length : 0;
    var withValue = 0;
    for (var i = 0; i < total; i += 1) {
      if (String(sel.options[i].value || '').trim()) withValue += 1;
    }
    return JSON.stringify({ total: total, withValue: withValue, disabled: sel.disabled });
  }

  window.__CG_WEB_EPOS_CATEGORY_TREE_WALK = function () {
    var log = [];
    logInfo(log, 'level-1 scrape starting · url: ' + window.location.href);

    var sel = document.getElementById('catLevel1');
    if (!sel) {
      var present = [];
      for (var lv = 1; lv <= MAX_LEVELS_PRESENT_CHECK; lv += 1) {
        if (document.getElementById('catLevel' + lv)) present.push(lv);
      }
      logError(
        log,
        '#catLevel1 not found. Present catLevel ids: ' + JSON.stringify(present)
          + ' · total <select> on page: ' + document.querySelectorAll('select').length
      );
      return { ok: false, error: '#catLevel1 not found — is this /products/new?', log: log };
    }

    logInfo(log, 'initial #catLevel1 state: ' + describeSelect(sel));

    var nodes = [];
    var total = sel.options ? sel.options.length : 0;
    for (var i = 0; i < total; i += 1) {
      var opt = sel.options[i];
      var uuid = String(opt.value || '').trim();
      var name = String(opt.textContent || '').trim();
      if (!uuid) {
        logInfo(log, 'skipping placeholder option [' + (i + 1) + '/' + total + '] "' + name + '" (empty value)');
        continue;
      }
      nodes.push({ uuid: uuid, name: name, parent_uuid: null, level: 1 });
      logInfo(
        log,
        'level-1 option [' + nodes.length + '] "' + name + '" · uuid=' + uuid
      );
    }

    logInfo(log, 'level-1 scrape finished · captured ' + nodes.length + ' top-level categories');
    return { ok: true, nodes: nodes, log: log };
  };
})();
