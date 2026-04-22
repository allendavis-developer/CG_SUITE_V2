/**
 * Orchestrator for the Web EPOS category-tree scrape — MINIMAL LEVEL-1 STEP.
 *
 * 1. Open `/products/new` in a new unfocused tab in the app's window.
 * 2. Wait for load + login guard.
 * 3. Inject `bg/webepos-category-tree-walk-page.js`.
 * 4. Call `window.__CG_WEB_EPOS_CATEGORY_TREE_WALK()` — a SYNCHRONOUS read of
 *    `#catLevel1` that returns immediately with the option list.
 * 5. Close the tab and post the result back to the app.
 *
 * Because the walker is synchronous (no async, no select-setting, no waiting
 * on React), we can rely on a single `chrome.scripting.executeScript` round
 * trip — we don't hit the MV3 MAIN-world Promise-awaiting quirk. Once this
 * path is confirmed working end-to-end, we'll layer the recursive deeper-level
 * walk back on top with a polling architecture.
 */
async function scrapeWebEposCategoryTreeAndRespond(requestId, appTabId) {
  const LOG_PREFIX = '[CG Suite Category Walk][ext]';
  const orchestratorLog = [];
  const log = (...parts) => {
    const stamp = new Date().toISOString().slice(11, 23);
    const msg = parts
      .map((p) => {
        if (p == null) return String(p);
        if (typeof p === 'string') return p;
        try { return JSON.stringify(p); } catch (_) { return String(p); }
      })
      .join(' ');
    orchestratorLog.push(`[${stamp}][ext] ${msg}`);
    try { console.log(LOG_PREFIX, msg); } catch (_) { /* ignore */ }
  };

  // Errors travel as a normal `{ ok: false, error, log }` response so the
  // diagnostic log survives (the bridge's raw-error envelope drops extra fields).
  const respondErr = async (msg, walkerLog) => {
    const fullLog = [...orchestratorLog, ...(Array.isArray(walkerLog) ? walkerLog : [])];
    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: false,
      error: msg,
      log: fullLog,
    });
  };

  log('scrape requested · appTabId', appTabId);

  let appTab;
  try {
    appTab = await chrome.tabs.get(appTabId);
  } catch (e) {
    log('chrome.tabs.get(appTabId) failed:', e?.message || String(e));
    await respondErr('Could not read the CG Suite tab.');
    return;
  }
  const windowId = appTab.windowId;

  let navTabId = null;
  try {
    const created = await chrome.tabs.create({
      windowId,
      url: WEB_EPOS_PRODUCT_NEW_URL,
      active: false,
    });
    navTabId = created.id;
    log('opened scrape tab', navTabId, 'at', WEB_EPOS_PRODUCT_NEW_URL);

    await waitForTabLoadComplete(navTabId, 90000, 'Web EPOS new-product page load timed out');
    log('tab load complete');

    await webEposAssertNewProductPageNotLogin(navTabId);
    log('login guard passed');

    // React needs a moment to fetch + populate catLevel1 after load.
    await sleep(600);

    const injectFiles = await chrome.scripting.executeScript({
      target: { tabId: navTabId },
      world: 'MAIN',
      files: ['bg/webepos-category-tree-walk-page.js'],
    });
    log('injected walker file · result count', injectFiles?.length ?? 0);

    // Synchronous walker — single round trip, no async awaiting weirdness.
    const walkRes = await chrome.scripting.executeScript({
      target: { tabId: navTabId },
      world: 'MAIN',
      func: () => {
        const fn = window.__CG_WEB_EPOS_CATEGORY_TREE_WALK;
        if (typeof fn !== 'function') {
          return { ok: false, error: 'walker not exposed on window', log: [] };
        }
        return fn();
      },
    });
    const result = walkRes && walkRes[0] ? walkRes[0].result : null;
    log(
      'walker returned · ok:', result?.ok,
      '· nodes:', Array.isArray(result?.nodes) ? result.nodes.length : 0,
      '· log lines:', Array.isArray(result?.log) ? result.log.length : 0
    );

    const walkerLog = Array.isArray(result?.log) ? result.log : [];

    // Keep the tab open for 2s so the user can glance at the devtools console
    // on the scrape tab if they want to — then close it.
    await sleep(2000);

    if (navTabId != null) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      log('scrape tab closed');
    }

    if (!result || result.ok !== true) {
      await respondErr(result?.error || 'Walker returned no result.', walkerLog);
      return;
    }

    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: true,
      nodes: Array.isArray(result.nodes) ? result.nodes : [],
      log: [...orchestratorLog, ...walkerLog],
    });
  } catch (e) {
    log('orchestrator threw:', e?.message || String(e));
    if (navTabId != null) {
      await chrome.tabs.remove(navTabId).catch(() => {});
    }
    await respondErr((e && e.message) ? String(e.message) : 'Category tree scrape failed.');
  }
}
