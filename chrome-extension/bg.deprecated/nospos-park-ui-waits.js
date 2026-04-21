/**
 * Open NosPos (or any URL) in a separate background window — same path as repricing `openNosposAndWait`.
 * Never call putTabInYellowGroup on this tab: grouping can move the tab into the focused window.
 * Order: minimized create → unfocused window + minimize → last resort inactive tab in current window.
 */
async function openBackgroundNosposTab(url, appTabId = null) {
  const createAttempts = [
    { url, focused: false, state: 'minimized' },
    { url, focused: false },
  ];
  for (const createOpts of createAttempts) {
    try {
      const win = await chrome.windows.create(createOpts);
      if (win?.id != null) {
        await chrome.windows.update(win.id, { focused: false, state: 'minimized' }).catch(() => {});
      }
      const tab = (win?.tabs || [])[0];
      if (tab?.id != null) {
        if (appTabId) await focusAppTab(appTabId);
        return { tabId: tab.id, windowId: win.id || null };
      }
    } catch (e) {
      console.warn('[CG Suite] Could not open NosPos background window:', e?.message);
    }
  }

  const fallbackTab = await chrome.tabs.create({ url, active: false });
  await putTabInYellowGroup(fallbackTab.id);
  if (appTabId) {
    await focusAppTab(appTabId);
  }
  return { tabId: fallbackTab.id, windowId: fallbackTab.windowId || null };
}

/**
 * Park agreement: open NosPos in a normal tab (same window as the app when possible), not a minimized window.
 */
async function openNosposParkAgreementTab(url, appTabId = null) {
  logPark('openNosposParkAgreementTab', 'enter', { url, appTabId }, 'Opening NoSpos park agreement tab');
  let windowId = null;
  if (appTabId) {
    try {
      const t = await chrome.tabs.get(appTabId);
      windowId = t.windowId;
      logPark('openNosposParkAgreementTab', 'step', { appTabId, resolvedWindowId: windowId }, 'Resolved window from app tab');
    } catch (_) {
      logPark('openNosposParkAgreementTab', 'step', { appTabId }, 'Could not get app tab window — will use last focused');
    }
  }
  if (windowId == null) {
    try {
      const w = await chrome.windows.getLastFocused({ populate: false });
      windowId = w?.id ?? null;
      logPark('openNosposParkAgreementTab', 'step', { windowId }, 'Using last focused window');
    } catch (_) {
      logPark('openNosposParkAgreementTab', 'step', {}, 'Could not get last focused window — tab will open in default window');
    }
  }
  const createOpts = { url, active: false };
  if (windowId != null) createOpts.windowId = windowId;
  logPark('openNosposParkAgreementTab', 'call', { createOpts }, 'Calling chrome.tabs.create');
  const newTab = await chrome.tabs.create(createOpts);
  await putTabInYellowGroup(newTab.id);
  if (appTabId) {
    await focusAppTab(appTabId);
  }
  const result = { tabId: newTab.id, windowId: newTab.windowId || null };
  logPark('openNosposParkAgreementTab', 'exit', result, 'Tab created successfully');
  console.log('[CG Suite] NosPos park agreement: opened tab', result);
  return result;
}

const NOSPOS_PARK_UI_STORAGE_KEY = 'cgNosposParkUiLock';
const NOSPOS_PARK_OVERLAY_DEFAULT_MSG =
  'CG Suite is updating this agreement — please wait. Do not use this tab until finished.';

async function sendNosposParkOverlayToTab(tabId, show, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'NOSPOS_PARK_OVERLAY',
      show,
      message: message || NOSPOS_PARK_OVERLAY_DEFAULT_MSG,
    });
  } catch (_) {
    /* Content script may not be ready yet; onUpdated + pageshow sync will re-apply. */
  }
}

/** User-facing error when a duplicate NosPos draft exists and they decline auto-delete. */
const NOSPOS_DUPLICATE_DECLINED_ERROR =
  'Failed to create new agreement for this customer because an existing one already exists, please delete it or resolve it before retrying parking';

async function sendNosposParkDuplicatePromptToTab(tabId, requestId, agreementId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'NOSPOS_PARK_OVERLAY_DUPLICATE_PROMPT',
      requestId,
      agreementId: agreementId != null ? String(agreementId) : '',
    });
  } catch (_) {
    /* Same as overlay: content script may not be ready; onUpdated + sync will re-apply. */
  }
}

async function focusNosposTabForPark(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (e) {
    logPark('focusNosposTabForPark', 'error', { tabId, error: e?.message }, 'Could not focus NoSpos tab');
  }
}

async function activateNosposParkAgreementUi(tabId, appTabId) {
  const msg = NOSPOS_PARK_OVERLAY_DEFAULT_MSG;
  await chrome.storage.session.set({
    [NOSPOS_PARK_UI_STORAGE_KEY]: {
      active: true,
      tabId,
      appTabId: appTabId ?? null,
      message: msg,
    },
  });
  await focusNosposTabForPark(tabId);
  await sendNosposParkOverlayToTab(tabId, true, msg);
}

async function clearNosposParkAgreementUiLock(options = {}) {
  const focusApp = options.focusApp !== false;
  const data = await chrome.storage.session.get(NOSPOS_PARK_UI_STORAGE_KEY);
  const lock = data[NOSPOS_PARK_UI_STORAGE_KEY];
  if (!lock || !lock.active) return;
  await chrome.storage.session.remove(NOSPOS_PARK_UI_STORAGE_KEY);
  if (lock.tabId != null) {
    unregisterNosposParkTab(lock.tabId);
    await sendNosposParkOverlayToTab(lock.tabId, false);
  }
  if (focusApp && lock.appTabId != null) {
    await focusAppTab(lock.appTabId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  if (!/nospos\.com/i.test(tab.url)) return;
  void (async () => {
    try {
      const data = await chrome.storage.session.get(NOSPOS_PARK_UI_STORAGE_KEY);
      const lock = data[NOSPOS_PARK_UI_STORAGE_KEY];
      if (!lock?.active || lock.tabId !== tabId) return;
      if (lock.duplicatePromptRequestId) {
        await sendNosposParkDuplicatePromptToTab(
          tabId,
          lock.duplicatePromptRequestId,
          lock.duplicatePromptAgreementId ?? ''
        );
      } else {
        await sendNosposParkOverlayToTab(tabId, true, lock.message);
      }
    } catch (_) {}
  })();
});

/**
 * Bring the parked NoSpos tab to the foreground; if it was closed, open fallbackCreateUrl (new agreement).
 */
async function focusOrOpenNosposParkTabImpl({ tabId, fallbackCreateUrl, appTabId = null }) {
  const id = parseInt(String(tabId ?? '').trim(), 10);
  const fallback = String(fallbackCreateUrl || '').trim();
  if (Number.isFinite(id) && id > 0) {
    try {
      const tab = await chrome.tabs.get(id);
      if (tab?.id) {
        await chrome.tabs.update(id, { active: true });
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
        return { ok: true, tabId: id, mode: 'focused' };
      }
    } catch (_) {}
  }
  let okUrl = false;
  try {
    const u = new URL(fallback);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    okUrl =
      (host === 'nospos.com' || host.endsWith('.nospos.com')) &&
      u.protocol === 'https:' &&
      /^\/newagreement\//i.test(u.pathname || '');
  } catch (_) {
    okUrl = false;
  }
  if (!okUrl) {
    return {
      ok: false,
      error:
        'NoSpos tab not found. It may have been closed — run Park agreement again or open NoSpos manually.',
    };
  }
  let windowId = null;
  if (appTabId) {
    try {
      const t = await chrome.tabs.get(appTabId);
      windowId = t.windowId;
    } catch (_) {}
  }
  if (windowId == null) {
    try {
      const w = await chrome.windows.getLastFocused({ populate: false });
      windowId = w?.id ?? null;
    } catch (_) {}
  }
  const opts = { url: fallback, active: true };
  if (windowId != null) opts.windowId = windowId;
  const newTab = await chrome.tabs.create(opts);
  await putTabInYellowGroup(newTab.id);
  console.log('[CG Suite] NosPos park: opened fallback agreement tab', { tabId: newTab.id });
  return { ok: true, tabId: newTab.id, mode: 'opened' };
}

// Storage helpers, URL utils, sleep, tab utils — imported from bg/ modules

/** Max time to wait for a NosPos full tab reload after Add or category change (user can retry after). */
const NOSPOS_RELOAD_WAIT_MS = 20000;
/** Delay before Actions -> Delete Agreement / Park Agreement clicks to reduce rate-limit spikes. */
const NOSPOS_ACTION_POST_DELAY_MS = 1200;
/** Rate-limit guard before clicking Add item (does not affect item-form filling). */
const NOSPOS_ADD_ITEM_CLICK_DELAY_MS = 700;
/** Rate-limit guard before sending category set (does not affect item-form filling). */
const NOSPOS_SET_CATEGORY_DELAY_MS = 700;
/** Global park-flow pacing delay applied before extension-to-tab steps. */
const NOSPOS_PARK_GLOBAL_STEP_DELAY_MS = 450;
/** If NosPos returns 429 page, wait this long then reload. */
const NOSPOS_429_RELOAD_DELAY_MS = 4000;
const nospos429LastRecoveryAtByTabId = new Map();

/**
 * TEST ONLY: when true, Park Agreement intentionally fails after 2 included items.
 * - stepIndex 0 => item 1 (passes)
 * - stepIndex 1 => item 2 (passes)
 * - stepIndex >= 2 => extension returns failure on purpose
 */
const CG_TEST_FAIL_PARK_AFTER_SECOND_ITEM = false;

// sendMessageToTabWithRetries — imported from bg/tab-utils.js

async function scrapeNosposGridMessage(tabId, messageType) {
  try {
    const response = await sendMessageToTabWithRetries(tabId, { type: messageType }, 12, 400);
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    if (response?.ok === false && rows.length === 0) {
      return { ok: false, rows: [], error: response?.error || 'Scrape returned no rows' };
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], error: e?.message || 'Scrape failed' };
  }
}

async function scrapeNosposStockCategoryTab(tabId) {
  return scrapeNosposGridMessage(tabId, 'SCRAPE_NOSPOS_STOCK_CATEGORY');
}

/**
 * Wait for a full navigation cycle (loading → complete) on the agreement items page.
 */
async function waitForAgreementItemsPageReload(tabId, reasonTag, maxWaitMs = NOSPOS_RELOAD_WAIT_MS) {
  await new Promise((resolve) => {
    let sawLoading = false;
    let done = false;
    const listener = (tid, change, tab) => {
      if (tid !== tabId || done) return;
      if (change.status === 'loading') sawLoading = true;
      if (
        sawLoading &&
        change.status === 'complete' &&
        isNosposAgreementItemsUrl(tab?.url || '')
      ) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        console.log('[CG Suite] NosPos agreement fill: reload complete —', reasonTag);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (done) return;
      chrome.tabs.onUpdated.removeListener(listener);
      console.log(
        '[CG Suite] NosPos agreement fill: no reload within',
        maxWaitMs,
        'ms —',
        reasonTag
      );
      resolve();
    }, maxWaitMs);
  });
  await sleep(500);
}

/**
 * After changing category, NosPos often full-reloads the items page. Wait for navigation
 * (loading → complete) and/or until the content script reports the form + stock controls exist.
 */
async function waitForAgreementItemsReadyAfterCategory(
  tabId,
  expectStockFieldLabels = [],
  lineIndex = 0
) {
  const labels = Array.isArray(expectStockFieldLabels)
    ? expectStockFieldLabels.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const start = Date.now();
  const maxTotalMs = 40000;

  await new Promise((resolve) => {
    let sawLoading = false;
    let done = false;
    const listener = (tid, change, tab) => {
      if (tid !== tabId || done) return;
      if (change.status === 'loading') sawLoading = true;
      if (
        sawLoading &&
        change.status === 'complete' &&
        isNosposAgreementItemsUrl(tab?.url || '')
      ) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        console.log(
          '[CG Suite] NosPos agreement fill: tab finished reloading after category change'
        );
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (done) return;
      chrome.tabs.onUpdated.removeListener(listener);
      console.log(
        '[CG Suite] NosPos agreement fill: no reload cycle detected within',
        NOSPOS_RELOAD_WAIT_MS,
        'ms (may be in-place update)'
      );
      resolve();
    }, NOSPOS_RELOAD_WAIT_MS);
  });

  await sleep(400);

  let lastProbe = null;
  while (Date.now() - start < maxTotalMs) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) {
      return { ok: false, error: 'The NoSpos tab was closed', probe: lastProbe };
    }
    if (!isNosposAgreementItemsUrl(t.url || '')) {
      await sleep(400);
      continue;
    }
    if (t.status !== 'complete') {
      await sleep(350);
      continue;
    }
    try {
      lastProbe = await sendParkMessageToTabWithAbort(
        tabId,
        {
          type: 'NOSPOS_AGREEMENT_FILL_PHASE',
          phase: 'probe_rest_ready',
          expectStockFieldLabels: labels,
          lineIndex,
        },
        10,
        500
      );
    } catch (e) {
      lastProbe = { ready: false, error: String(e?.message || e) };
      console.log('[CG Suite] NosPos agreement fill: probe send failed', lastProbe.error);
    }
    if (lastProbe?.ready) {
      console.log('[CG Suite] NosPos agreement fill: form probe OK', lastProbe.debug || {});
      await sleep(600);
      return { ok: true, probe: lastProbe };
    }
    if (lastProbe?.debug) {
      console.log('[CG Suite] NosPos agreement fill: probe waiting…', lastProbe.debug);
    }
    await sleep(500);
  }
  return {
    ok: false,
    error: 'Timed out waiting for NosPos form after category change',
    probe: lastProbe,
  };
}

async function countNosposAgreementItemLines(tabId) {
  try {
    const r = await sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'count_lines' },
      10,
      400
    );
    const count = typeof r?.count === 'number' ? r.count : 0;
    logPark('countNosposAgreementItemLines', 'result', { tabId, count }, `Line count: ${count}`);
    return count;
  } catch (_) {
    logPark('countNosposAgreementItemLines', 'error', { tabId }, 'count_lines message failed');
    return 0;
  }
}

/** 0-based line index whose item description contains the marker, or null if not found. */
async function findNosposLineIndexForMarker(tabId, marker) {
  const m = String(marker || '').trim();
  if (!m) return null;
  try {
    const r = await sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'find_line_marker', marker: m },
      10,
      400
    );
    if (!r?.ok) return null;
    const idx = parseInt(String(r.lineIndex), 10);
    if (!Number.isFinite(idx) || idx < 0) return null;
    return idx;
  } catch (_) {
    return null;
  }
}

function requestItemMarkerTokenFromCgMarker(marker) {
  const m = String(marker || '').trim();
  if (!m) return '';
  const hit = m.match(/-RI-([A-Za-z0-9_-]+)-L\d+\]?$/i) || m.match(/-RI-([A-Za-z0-9_-]+)/i);
  if (!hit || !hit[1]) return '';
  return `RI-${String(hit[1]).trim()}`;
}

/** Match CG marker segment `-RI-{id}-` so `RI-12` does not match `RI-1274` or `RI-12740`. */
function findMarkerSearchNeedleForPark(marker) {
  const m = String(marker || '').trim();
  if (!m) return '';
  const bracket = m.match(/-RI-([A-Za-z0-9_-]+)-/i);
  if (bracket && bracket[1]) return `-RI-${String(bracket[1]).trim()}-`;
  const riTok = requestItemMarkerTokenFromCgMarker(m);
  if (riTok) {
    const id = riTok.match(/^RI-(.+)$/i);
    if (id && id[1]) return `-RI-${String(id[1]).trim()}-`;
  }
  return m;
}

async function findNosposLineIndexForMarkerWithFallback(tabId, marker) {
  logPark('findNosposLineIndexForMarkerWithFallback', 'enter', { tabId, marker }, 'Searching NoSpos rows by description marker');
  const riNeedle = findMarkerSearchNeedleForPark(marker);
  if (riNeedle && riNeedle !== String(marker || '').trim()) {
    const byRi = await findNosposLineIndexForMarker(tabId, riNeedle);
    if (byRi != null && byRi >= 0) {
      logPark('findNosposLineIndexForMarkerWithFallback', 'result', { marker, riNeedle, lineIndex: byRi }, 'Matched by RI needle in description');
      console.log('[CG Suite] NosPos park: matched by request-item needle in description', { marker, riNeedle, lineIndex: byRi });
      return byRi;
    }
  }
  const exact = await findNosposLineIndexForMarker(tabId, marker);
  if (exact != null && exact >= 0) {
    logPark('findNosposLineIndexForMarkerWithFallback', 'result', { marker, lineIndex: exact }, 'Matched by full marker substring');
    console.log('[CG Suite] NosPos park: matched by full marker substring', { marker, lineIndex: exact });
    return exact;
  }
  logPark('findNosposLineIndexForMarkerWithFallback', 'result', { marker, riNeedle, lineIndex: null }, 'No row found by description marker');
  console.log('[CG Suite] NosPos park: no row found by description marker', { marker, riNeedle, lineIndex: null });
  return null;
}

async function readNosposAgreementLineSnapshot(tabId, lineIndex) {
  const lineIdx = Math.max(0, parseInt(String(lineIndex ?? '0'), 10) || 0);
  try {
    return await sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'read_line_snapshot', lineIndex: lineIdx },
      8,
      350
    );
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Remove NosPos draft rows that match skipped CG lines: description contains `-RI-{requestItemId}-`.
 * One delete at a time; waits for items page reload after each (same as Add flow).
 */
async function deleteExcludedNosposAgreementLinesImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab', deleted: [] };
  }
  const delDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (delDead) return { ...delDead, deleted: [] };
  const raw = Array.isArray(payload.requestItemIds) ? payload.requestItemIds : [];
  const ids = [
    ...new Set(
      raw
        .map((x) => String(x ?? '').trim())
        .filter((x) => x.length > 0 && /^\d+$/.test(x))
    ),
  ];
  if (!ids.length) {
    return { ok: true, deleted: [], skipped: true };
  }
  const tabCheck = await ensureNosposAgreementItemsTab(tabId, 120000);
  if (!tabCheck.ok) {
    return { ...tabCheck, deleted: [] };
  }
  const deleted = [];
  for (let ii = 0; ii < ids.length; ii += 1) {
    const rid = ids[ii];
    try {
      const r = await sendParkMessageToTabWithAbort(
        tabId,
        {
          type: 'NOSPOS_AGREEMENT_FILL_PHASE',
          phase: 'delete_line_by_request_item_id',
          requestItemId: rid,
        },
        18,
        450
      );
      if (!r || r.ok === false) {
        console.warn('[CG Suite] NosPos park: delete excluded line failed', rid, r?.error);
        continue;
      }
      if (r.skipped) {
        console.log('[CG Suite] NosPos park: delete excluded skipped (no row)', rid, r.reason);
        continue;
      }
      if (r.deleted) {
        deleted.push(String(rid));
        await waitForAgreementItemsPageReload(
          tabId,
          `after delete excluded RI-${rid}`,
          NOSPOS_RELOAD_WAIT_MS
        );
        await sleep(600);
      }
    } catch (e) {
      console.warn('[CG Suite] NosPos park: delete excluded error', rid, e?.message || e);
    }
  }
  return { ok: true, deleted };
}

/**
 * After clicking Items "Next", wait until the tab is off the /items step (wizard advances; often full reload).
 */
async function waitAfterAgreementItemsNextClick(tabId, maxWaitMs = NOSPOS_RELOAD_WAIT_MS) {
  logPark('waitAfterAgreementItemsNextClick', 'enter', { tabId, maxWaitMs }, 'Waiting for NoSpos to leave items step after Next click');
  const deadline = Date.now() + maxWaitMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      logPark('waitAfterAgreementItemsNextClick', 'error', { tabId }, 'Tab closed while waiting for Next navigation');
      return { ok: false, error: 'The NoSpos tab was closed' };
    }
    const url = tab.url || '';
    const leftItems = tab.status === 'complete' && isNosposNewAgreementWorkflowUrl(url) && !isNosposAgreementItemsUrl(url);
    if (pollCount % 8 === 0) {
      logPark('waitAfterAgreementItemsNextClick', 'step', { pollCount, tabStatus: tab.status, url, leftItems }, 'Polling for post-Next navigation');
    }
    if (leftItems) {
      await sleep(500);
      logPark('waitAfterAgreementItemsNextClick', 'exit', { url, pollCount }, 'Successfully left items step');
      return { ok: true };
    }
    pollCount++;
    await sleep(250);
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (
    tab?.status === 'complete' &&
    isNosposNewAgreementWorkflowUrl(tab.url || '') &&
    !isNosposAgreementItemsUrl(tab.url || '')
  ) {
    await sleep(500);
    return { ok: true };
  }
  return {
    ok: false,
    error:
      'NoSpos did not leave the items step after Next — click Next manually, wait for the page, then Park Agreement.',
  };
}
