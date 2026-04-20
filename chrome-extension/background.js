/**
 * CG Suite Research – background service worker (Manifest V3).
 *
 * IMPORTANT: MV3 service workers are killed by Chrome after ~30 s of inactivity.
 * All pending-request state is persisted in chrome.storage.session so it survives
 * those restarts.
 *
 * Storage schema (key "cgPending"):
 *   { [requestId]: { appTabId, listingTabId, competitor, marketComparisonContext } }
 *
 * FLOW FOR "ADD FROM CEX":
 * 1. App sends BRIDGE_FORWARD with action 'startWaitingForData', competitor 'CeX'.
 * 2. We create a new tab (uk.webuy.com/ or search), store pending[requestId] = { appTabId, listingTabId: newTab.id, competitor: 'CeX' }.
 * 3. User navigates to a product-detail page (same tab or different tab). Content script on that page sends LISTING_PAGE_READY.
 * 4. We match the tab to the pending request (by listingTabId, or for CeX by re-associating if user opened product in another tab).
 * 5. We send WAITING_FOR_DATA to that tab so the content script shows "Have you got the data yet?". We retry a few times in case the content script isn't ready yet.
 */

importScripts(
  'bg/park-log.js',
  'bg/tab-utils.js',
  'bg/nospos-url-utils.js',
  'bg/nospos-html.js',
  'jewellery-scrap/constants.js',
  'jewellery-scrap/worker-session.js',
);

/**
 * Open NosPos (or any URL) in a separate background window — same path as repricing `openNosposAndWait`.
 * Never call putTabInYellowGroup on this tab: grouping can move the tab into the focused window.
 * Order: minimized create → unfocused window + minimize → last resort inactive tab in current window.
 */
async function openBackgroundNosposTab(url, appTabId = null) {
  try {
    const win = await chrome.windows.create({
      url,
      focused: false,
      state: 'minimized',
    });
    if (win?.id != null) {
      await chrome.windows.update(win.id, { focused: false, state: 'minimized' }).catch(() => {});
    }
    const tab = (win?.tabs || [])[0];
    if (tab?.id != null) {
      if (appTabId) {
        await focusAppTab(appTabId);
      }
      return { tabId: tab.id, windowId: win.id || null, dedicatedWindow: true };
    }
  } catch (e) {
    console.warn('[CG Suite] Could not open minimized NoSpos window:', e?.message);
  }

  try {
    const win = await chrome.windows.create({
      url,
      focused: false,
    });
    if (win?.id != null) {
      await chrome.windows.update(win.id, { focused: false, state: 'minimized' }).catch(() => {});
    }
    const tab = (win?.tabs || [])[0];
    if (tab?.id != null) {
      if (appTabId) {
        await focusAppTab(appTabId);
      }
      return { tabId: tab.id, windowId: win.id || null, dedicatedWindow: true };
    }
  } catch (e2) {
    console.warn('[CG Suite] Could not open NosPos window (fallback):', e2?.message);
  }

  const fallbackTab = await chrome.tabs.create({ url, active: false });
  await putTabInYellowGroup(fallbackTab.id);
  if (appTabId) {
    await focusAppTab(appTabId);
  }
  return {
    tabId: fallbackTab.id,
    windowId: fallbackTab.windowId || null,
    dedicatedWindow: false,
  };
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

const NOSPOS_BUYING_AFTER_PARK_WAIT_MS = 60000;

/** Force-remove `tabs.onUpdated` listener for {@link waitForNosposTabBuyingAfterPark} when closing the tab from CG Suite. */
const nosposBuyingAfterParkDetachByTabId = new Map();
const nosposActiveParkTabIds = new Set();
const nosposParkClosedAbortByTabId = new Map();

const NOSPOS_PARK_TAB_CLOSED_ERR = 'NosPos tab was closed — parking failed.';

function applyNosposParkTabClosedMark(tabId, removeInfo = null) {
  nosposActiveParkTabIds.delete(tabId);
  const err = NOSPOS_PARK_TAB_CLOSED_ERR;
  if (!nosposParkClosedAbortByTabId.has(tabId)) {
    nosposParkClosedAbortByTabId.set(tabId, err);
    logPark(
      'nosposParkTabLifecycle',
      'error',
      {
        tabId,
        removeInfo: removeInfo || null,
        tickmark: 'x',
      },
      `✗ ${err}`
    );
  }
}

/**
 * When the service worker restarts, in-memory `nosposActiveParkTabIds` is empty but
 * `chrome.storage.session` may still hold the park UI lock for this tab — still treat
 * closure as a park failure so the app gets a consistent error.
 */
function markNosposParkTabClosed(tabId, removeInfo = null) {
  if (nosposActiveParkTabIds.has(tabId)) {
    applyNosposParkTabClosedMark(tabId, removeInfo);
    return;
  }
  void chrome.storage.session.get(NOSPOS_PARK_UI_STORAGE_KEY).then((data) => {
    const lock = data[NOSPOS_PARK_UI_STORAGE_KEY];
    if (lock?.active && lock.tabId === tabId) {
      applyNosposParkTabClosedMark(tabId, removeInfo);
    }
  });
}

function registerNosposParkTab(tabId) {
  nosposActiveParkTabIds.clear();
  nosposActiveParkTabIds.add(tabId);
  nosposParkClosedAbortByTabId.delete(tabId);
}

function unregisterNosposParkTab(tabId) {
  nosposActiveParkTabIds.delete(tabId);
  nosposParkClosedAbortByTabId.delete(tabId);
}

function getNosposParkTabClosedError(tabId) {
  return nosposParkClosedAbortByTabId.get(tabId) || null;
}

function failIfNosposParkTabClosed(tabId) {
  const err = getNosposParkTabClosedError(tabId);
  if (!err) return null;
  return { ok: false, tabClosed: true, error: err };
}

/**
 * Like {@link failIfNosposParkTabClosed} but also detects a missing tab when `tabs.onRemoved`
 * was missed (e.g. MV3 worker asleep). Call at the start of park bridge handlers.
 */
async function failIfNosposParkTabClosedOrMissing(tabId) {
  const err = getNosposParkTabClosedError(tabId);
  if (err) return { ok: false, tabClosed: true, error: err };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    applyNosposParkTabClosedMark(tabId, null);
    return { ok: false, tabClosed: true, error: NOSPOS_PARK_TAB_CLOSED_ERR };
  }
  return null;
}

const pendingNosposDuplicateChoices = new Map();

function resolveNosposDuplicateUserChoice(requestId, tabId, choice) {
  const entry = pendingNosposDuplicateChoices.get(requestId);
  if (!entry || entry.tabId !== tabId) return false;
  entry.finish(choice);
  return true;
}

function waitForNosposDuplicateUserChoice(tabId, requestId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let onRemoved = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (onRemoved) {
        try {
          chrome.tabs.onRemoved.removeListener(onRemoved);
        } catch (_) {}
        onRemoved = null;
      }
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      pendingNosposDuplicateChoices.delete(requestId);
      resolve(value);
    };
    onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return;
      markNosposParkTabClosed(tabId, null);
      finish('tab_closed');
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    pollTimer = setInterval(() => {
      if (getNosposParkTabClosedError(tabId)) finish('tab_closed');
    }, 350);
    pendingNosposDuplicateChoices.set(requestId, { tabId, finish });
    setTimeout(() => finish('timeout'), timeoutMs);
  });
}

async function waitForNosposTabComplete(tabId, maxWaitMs = 45000) {
  const deadline = Date.now() + Math.max(1000, maxWaitMs);
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { ok: false, error: 'The NoSpos tab was closed' };
    if (tab.status === 'complete') return { ok: true, url: tab.url || '' };
    await sleep(120);
  }
  return { ok: false, error: 'NoSpos page did not finish loading in time after reload' };
}

async function maybeRecoverNospos429Page(tabId, context = '') {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, recovered: false, error: 'The NoSpos tab was closed' };
  const url = String(tab.url || '');
  if (!/nospos\.com/i.test(url) || tab.status !== 'complete') {
    return { ok: true, recovered: false, skipped: true };
  }

  const now = Date.now();
  const last = nospos429LastRecoveryAtByTabId.get(tabId) || 0;
  if (now - last < 5000) {
    return { ok: true, recovered: false, skipped: true };
  }

  const probe = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const h = document.querySelector('h1.text-danger.mb-1');
        const text = String(h?.textContent || '').trim();
        return {
          has429Heading: /too many requests/i.test(text) && /\(#\s*429\)/i.test(text),
          heading: text || null,
          href: window.location.href,
        };
      },
    })
    .catch(() => [{ result: { has429Heading: false, heading: null, href: null } }]);

  const info = probe?.[0]?.result || { has429Heading: false, heading: null, href: null };
  if (!info.has429Heading) return { ok: true, recovered: false };

  nospos429LastRecoveryAtByTabId.set(tabId, Date.now());
  logPark(
    'nospos429Guard',
    'error',
    { tabId, context, heading: info.heading, href: info.href, tickmark: 'x' },
    'NosPos returned Too Many Requests (#429) — waiting 4s then reloading the page'
  );
  await sleep(NOSPOS_429_RELOAD_DELAY_MS);
  await chrome.tabs.reload(tabId).catch(() => {});
  const waitReload = await waitForNosposTabComplete(tabId, 45000);
  logPark(
    'nospos429Guard',
    waitReload.ok ? 'step' : 'error',
    { tabId, context, waitReload },
    waitReload.ok
      ? '429 recovery reload complete'
      : '429 recovery reload did not complete cleanly'
  );
  return { ok: true, recovered: true, waitReload };
}

async function throttleAndRecoverNospos429(tabId, context = '') {
  if (NOSPOS_PARK_GLOBAL_STEP_DELAY_MS > 0) {
    await sleep(NOSPOS_PARK_GLOBAL_STEP_DELAY_MS);
  }
  return maybeRecoverNospos429Page(tabId, context);
}

async function sendParkMessageToTabWithAbort(tabId, message, retries, delayMs) {
  const existingErr = getNosposParkTabClosedError(tabId);
  if (existingErr) {
    throw new Error(existingErr);
  }
  await throttleAndRecoverNospos429(
    tabId,
    `send:${String(message?.phase || message?.type || 'unknown')}`
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        chrome.tabs.onRemoved.removeListener(onRemoved);
      } catch (_) {}
      fn(value);
    };
    const onRemoved = (removedTabId, removeInfo) => {
      if (removedTabId !== tabId) return;
      markNosposParkTabClosed(tabId, removeInfo);
      finish(reject, new Error(NOSPOS_PARK_TAB_CLOSED_ERR));
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    sendMessageToTabWithRetries(tabId, message, retries, delayMs)
      .then((res) => finish(resolve, res))
      .catch((err) => finish(reject, err));
  });
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  markNosposParkTabClosed(tabId, removeInfo || null);
});

/** After opening `/newagreement/agreement/create?…`, NosPos redirects to `/newagreement/{id}/items?…`. */
const NOSPOS_OPEN_AGREEMENT_ITEMS_URL_WAIT_MS = 120000;

async function waitForNosposNewAgreementItemsTabUrl(
  tabId,
  maxWaitMs = NOSPOS_OPEN_AGREEMENT_ITEMS_URL_WAIT_MS
) {
  logPark('waitForNosposNewAgreementItemsTabUrl', 'enter', { tabId, maxWaitMs }, 'Waiting for NoSpos to redirect to agreement items URL');
  const deadline = Date.now() + maxWaitMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      logPark('waitForNosposNewAgreementItemsTabUrl', 'error', { tabId, pollCount }, 'NoSpos tab was closed while waiting for items URL');
      return { ok: false, error: 'The NoSpos tab was closed' };
    }
    const url = tab.url || '';
    if (pollCount % 10 === 0 && tab.status === 'complete') {
      await maybeRecoverNospos429Page(tabId, 'waitForNosposNewAgreementItemsTabUrl');
    }
    const isItems = isNosposAgreementItemsUrl(url);
    if (pollCount % 10 === 0) {
      logPark('waitForNosposNewAgreementItemsTabUrl', 'step', { pollCount, tabStatus: tab.status, url, isItems }, 'Polling for items URL');
    }
    if (tab.status === 'complete' && isItems) {
      logPark('waitForNosposNewAgreementItemsTabUrl', 'exit', { url, pollCount }, 'Items URL reached');
      return { ok: true, url };
    }
    pollCount++;
    await sleep(300);
  }
  const finalTab = await chrome.tabs.get(tabId).catch(() => null);
  logPark('waitForNosposNewAgreementItemsTabUrl', 'error', { tabId, pollCount, finalUrl: finalTab?.url }, 'Timed out waiting for items URL');
  return {
    ok: false,
    error:
      'NoSpos did not reach the agreement items page in time — use the NoSpos tab if it loaded.',
  };
}

/** Park Agreement completion: NosPos navigates the tab to https://nospos.com/buying (authoritative). */
async function waitForNosposTabBuyingAfterPark(tabId, maxWaitMs = NOSPOS_BUYING_AFTER_PARK_WAIT_MS) {
  logPark('waitForNosposTabBuyingAfterPark', 'enter', { tabId, maxWaitMs }, 'Waiting for NoSpos tab to reach buying hub after park');
  const deadline = Date.now() + maxWaitMs;
  let settled = false;
  return new Promise((resolve) => {
    const onTabUpdated = (updatedTabId, _changeInfo, tab) => {
      if (updatedTabId !== tabId || settled) return;
      const url = tab?.url || '';
      if (url && isNosposBuyingHubUrl(url)) {
        logPark('waitForNosposTabBuyingAfterPark', 'result', { url }, 'Buying hub URL detected via onUpdated listener');
        done({ ok: true });
      }
    };

    const detach = () => {
      try {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
      } catch (_) {}
      try {
        nosposBuyingAfterParkDetachByTabId.delete(tabId);
      } catch (_) {}
    };

    const done = (result) => {
      if (settled) return;
      settled = true;
      detach();
      resolve(result);
    };

    nosposBuyingAfterParkDetachByTabId.set(tabId, detach);
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    (async function poll() {
      const tab0 = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab0) {
        logPark('waitForNosposTabBuyingAfterPark', 'error', { tabId }, 'Tab was closed at poll start');
        done({ ok: false, error: 'The NoSpos tab was closed' });
        return;
      }
      if (isNosposBuyingHubUrl(tab0.url || '')) {
        logPark('waitForNosposTabBuyingAfterPark', 'result', { url: tab0.url }, 'Already on buying hub at poll start');
        done({ ok: true });
        return;
      }
      if (tab0.status === 'complete') {
        await maybeRecoverNospos429Page(tabId, 'waitForNosposTabBuyingAfterPark:init');
      }
      logPark('waitForNosposTabBuyingAfterPark', 'step', { currentUrl: tab0.url }, 'Not yet on buying hub — beginning poll loop');
      let pollCount = 0;
      while (Date.now() < deadline && !settled) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
          logPark('waitForNosposTabBuyingAfterPark', 'error', { tabId, pollCount }, 'Tab closed during poll loop');
          done({ ok: false, error: 'The NoSpos tab was closed' });
          return;
        }
        const url = tab.url || '';
        if (pollCount % 15 === 0 && tab.status === 'complete') {
          await maybeRecoverNospos429Page(tabId, 'waitForNosposTabBuyingAfterPark:poll');
        }
        if (isNosposBuyingHubUrl(url)) {
          logPark('waitForNosposTabBuyingAfterPark', 'result', { url, pollCount }, 'Buying hub URL detected via poll loop');
          done({ ok: true });
          return;
        }
        pollCount++;
        await sleep(80);
      }
      if (!settled) {
        logPark('waitForNosposTabBuyingAfterPark', 'error', { tabId }, 'Timed out waiting for buying hub URL');
        done({
          ok: false,
          error:
            'NoSpos did not return to nospos.com/buying after Park — finish or confirm Park in the NoSpos tab, then try again.',
        });
      }
    })();
  });
}

/** Items page Next → wait for reload → Agreement card Actions → Park Agreement → SweetAlert OK. */
async function clickNosposSidebarParkAgreementImpl(payload) {
  logPark('clickNosposSidebarParkAgreementImpl', 'enter', { tabId: payload.tabId }, 'Starting sidebar park agreement sequence');
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    logPark('clickNosposSidebarParkAgreementImpl', 'error', { rawTabId: payload.tabId }, 'Invalid tabId');
    return { ok: false, error: 'Invalid tab' };
  }
  const tabCheck = await waitForNosposAgreementTabReadyForPark(tabId, 120000);
  logPark('clickNosposSidebarParkAgreementImpl', 'result', { tabCheck }, 'Tab readiness check result');
  if (!tabCheck.ok) {
    return tabCheck;
  }
  try {
    if (tabCheck.onItemsStep) {
      logPark('clickNosposSidebarParkAgreementImpl', 'step', { tabId }, 'Tab is on items step — clicking Next');
      const rNext = await sendParkMessageToTabWithAbort(
        tabId,
        { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'click_items_form_next' },
        18,
        450
      );
      logPark('clickNosposSidebarParkAgreementImpl', 'result', { rNext }, 'click_items_form_next response');
      if (!rNext || rNext.ok === false) {
        logPark('clickNosposSidebarParkAgreementImpl', 'error', { rNext }, 'Failed to click Next on items page');
        return {
          ok: false,
          error: rNext?.error || 'Could not press Next on the NoSpos items page',
        };
      }
      const waitNav = await waitAfterAgreementItemsNextClick(tabId, NOSPOS_RELOAD_WAIT_MS);
      logPark('clickNosposSidebarParkAgreementImpl', 'result', { waitNav }, 'Wait-after-Next navigation result');
      if (!waitNav.ok) {
        return waitNav;
      }
    } else {
      logPark('clickNosposSidebarParkAgreementImpl', 'step', { tabId }, 'Tab is past items step — skipping Next, waiting 500ms');
      await sleep(500);
    }
    logPark('clickNosposSidebarParkAgreementImpl', 'step', { tabId }, 'Sending sidebar_park_agreement phase to content script (racing with buying hub detection)');
    const buyingReachedPromise = waitForNosposTabBuyingAfterPark(
      tabId,
      NOSPOS_BUYING_AFTER_PARK_WAIT_MS
    );
    const parkSidebarPromise = sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'sidebar_park_agreement' },
      22,
      450
    )
      .then((result) => {
        logPark('clickNosposSidebarParkAgreementImpl', 'result', { result }, 'sidebar_park_agreement content-script response');
        return { ok: true, result };
      })
      .catch((e) => {
        logPark('clickNosposSidebarParkAgreementImpl', 'error', { error: e?.message }, 'sidebar_park_agreement sendMessage threw');
        return { ok: false, error: e?.message || String(e) };
      });

    const first = await Promise.race([
      buyingReachedPromise.then((result) => ({ kind: 'buying', ...result })),
      parkSidebarPromise.then((result) => ({ kind: 'park', ...result })),
    ]);
    logPark('clickNosposSidebarParkAgreementImpl', 'step', { firstKind: first.kind, firstOk: first.ok }, 'Race winner resolved');

    if (first.kind === 'buying' && first.ok) {
      logPark('clickNosposSidebarParkAgreementImpl', 'exit', { parked: true, via: 'buying-hub-race' }, 'Park confirmed — buying hub reached first in race');
      return { ok: true, parked: true };
    }

    const r = first.kind === 'park' ? first : await parkSidebarPromise;
    const buyingReached = first.kind === 'buying' ? first : await buyingReachedPromise;
    logPark('clickNosposSidebarParkAgreementImpl', 'step', { parkResult: r, buyingReached }, 'Both race legs settled');

    if (buyingReached.ok) {
      logPark('clickNosposSidebarParkAgreementImpl', 'exit', { parked: true, via: 'buying-hub-poll' }, 'Park confirmed — buying hub reached after sidebar');
      return { ok: true, parked: true };
    }
    if (!r.ok || r.result?.ok === false) {
      const err = r.error || r.result?.error || buyingReached.error || 'NoSpos did not complete sidebar Park Agreement';
      logPark('clickNosposSidebarParkAgreementImpl', 'error', { parkResult: r, buyingReached, err }, 'Park sidebar failed');
      return { ok: false, error: err };
    }
    logPark('clickNosposSidebarParkAgreementImpl', 'error', { buyingReached }, 'Park sidebar sent but buying hub not reached');
    return {
      ok: false,
      error: buyingReached.error || 'NoSpos did not return to Buying after Park.',
    };
  } catch (e) {
    logPark('clickNosposSidebarParkAgreementImpl', 'error', { error: e?.message }, 'Unexpected exception in sidebar park');
    return { ok: false, error: e?.message || String(e) || 'Sidebar park failed' };
  }
}

async function clickNosposAgreementAddItem(tabId) {
  if (NOSPOS_ADD_ITEM_CLICK_DELAY_MS > 0) {
    logPark(
      'clickNosposAgreementAddItem',
      'step',
      { tabId, delayMs: NOSPOS_ADD_ITEM_CLICK_DELAY_MS },
      'Rate-limit guard: delaying before Add click'
    );
    await sleep(NOSPOS_ADD_ITEM_CLICK_DELAY_MS);
  }
  return sendParkMessageToTabWithAbort(
    tabId,
    { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'click_add' },
    10,
    400
  );
}

/** After clicking Add: wait for reload, then confirm line count increased (fallback if reload is soft). */
async function waitForNewAgreementLineAfterAdd(tabId, countBefore) {
  await waitForAgreementItemsPageReload(tabId, 'after Add', NOSPOS_RELOAD_WAIT_MS);
  await sleep(600);
  const want = countBefore + 1;
  const start = Date.now();
  const lineWaitMs = NOSPOS_RELOAD_WAIT_MS;
  while (Date.now() - start < lineWaitMs) {
    // Only count lines once the page is fully loaded — counting during a mid-render
    // state can return a stale count and cause the rest phase to target the wrong row.
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) {
      return { ok: false, error: 'The NoSpos tab was closed' };
    }
    if (!isNosposAgreementItemsUrl(t.url || '') || t.status !== 'complete') {
      await sleep(350);
      continue;
    }
    const n = await countNosposAgreementItemLines(tabId);
    if (n >= want) return { ok: true, count: n };
    await sleep(500);
  }
  return {
    ok: false,
    error:
      'NoSpos did not show a new item row after Add within the wait window (reload or new row timed out). Use Retry on that line or check the NoSpos tab.',
  };
}

async function ensureNosposAgreementItemsTab(tabId, deadlineMs = 90000) {
  logPark('ensureNosposAgreementItemsTab', 'enter', { tabId, deadlineMs }, 'Ensuring items page is loaded');
  const deadline = Date.now() + deadlineMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      logPark('ensureNosposAgreementItemsTab', 'error', { tabId }, 'Tab closed while waiting for items page');
      return { ok: false, error: 'The NoSpos tab was closed' };
    }
    const isItems = isNosposAgreementItemsUrl(tab.url || '');
    if (pollCount % 10 === 0 && tab.status === 'complete') {
      await maybeRecoverNospos429Page(tabId, 'ensureNosposAgreementItemsTab');
    }
    if (pollCount % 10 === 0) {
      logPark('ensureNosposAgreementItemsTab', 'step', { pollCount, tabStatus: tab.status, url: tab.url, isItems }, 'Polling for items page ready');
    }
    if (isItems && tab.status === 'complete') {
      logPark('ensureNosposAgreementItemsTab', 'exit', { url: tab.url, pollCount }, 'Items page is loaded and ready');
      return { ok: true };
    }
    pollCount++;
    await sleep(350);
  }
  logPark('ensureNosposAgreementItemsTab', 'error', { tabId }, 'Timed out waiting for items page');
  return {
    ok: false,
    error:
      'Items page did not load in time. Finish opening the agreement in the NoSpos window, then try again.',
  };
}

/**
 * Before Park Agreement: tab must be on a NosPos new-agreement step with the sidebar.
 * With a single line, NosPos sometimes advances past /items before we run — waiting only for
 * /items would spin until timeout while the user finishes Park in the UI (CG Suite stuck on the line).
 */
async function waitForNosposAgreementTabReadyForPark(tabId, deadlineMs = 120000) {
  logPark('waitForNosposAgreementTabReadyForPark', 'enter', { tabId, deadlineMs }, 'Waiting for NoSpos agreement tab to be ready for Park');
  const deadline = Date.now() + deadlineMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      logPark('waitForNosposAgreementTabReadyForPark', 'error', { tabId }, 'Tab closed while waiting for park readiness');
      return { ok: false, error: 'The NoSpos tab was closed' };
    }
    const url = tab.url || '';
    if (pollCount % 10 === 0 && tab.status === 'complete') {
      await maybeRecoverNospos429Page(tabId, 'waitForNosposAgreementTabReadyForPark');
    }
    const isWorkflow = isNosposNewAgreementWorkflowUrl(url);
    const isItems = isNosposAgreementItemsUrl(url);
    if (pollCount % 10 === 0) {
      logPark('waitForNosposAgreementTabReadyForPark', 'step', { pollCount, tabStatus: tab.status, url, isWorkflow, isItems }, 'Polling tab readiness');
    }
    if (tab.status !== 'complete') { pollCount++; await sleep(350); continue; }
    if (!isWorkflow) { pollCount++; await sleep(350); continue; }
    if (isItems) {
      logPark('waitForNosposAgreementTabReadyForPark', 'exit', { url, onItemsStep: true, pollCount }, 'Tab is on items step — ready for park');
      return { ok: true, onItemsStep: true };
    }
    logPark('waitForNosposAgreementTabReadyForPark', 'exit', { url, onItemsStep: false, pollCount }, 'Tab is past items step — ready for park');
    return { ok: true, onItemsStep: false };
  }
  logPark('waitForNosposAgreementTabReadyForPark', 'error', { tabId }, 'Timed out waiting for agreement tab park readiness');
  return {
    ok: false,
    error:
      'Agreement page did not load in time. Finish opening the agreement in the NoSpos window, then try again.',
  };
}

/**
 * Set category and wait for NosPos reload / form (up to {@link NOSPOS_RELOAD_WAIT_MS} for reload detection).
 */
async function applyNosposAgreementCategoryPhaseImpl(tabId, payload) {
  const lineIndex = Math.max(0, parseInt(String(payload.lineIndex ?? '0'), 10) || 0);
  const categoryId = String(payload.categoryId ?? '').trim();
  logPark('applyNosposAgreementCategoryPhaseImpl', 'enter', { tabId, lineIndex, categoryId, name: payload.name, marker: payload.cgParkLineMarker }, 'Setting category on NoSpos agreement line');
  let categoryLabel = null;
  const stockLabelsForWait = Array.isArray(payload.stockFields)
    ? payload.stockFields.map((r) => r && r.label).filter(Boolean)
    : [];
  if (!categoryId) {
    logPark('applyNosposAgreementCategoryPhaseImpl', 'decision', { lineIndex }, 'No categoryId — skipping category phase');
    return { ok: true, categoryLabel: null, waitForm: { ok: true }, lineIndex };
  }
  try {
    if (NOSPOS_SET_CATEGORY_DELAY_MS > 0) {
      logPark(
        'applyNosposAgreementCategoryPhaseImpl',
        'step',
        { tabId, lineIndex, delayMs: NOSPOS_SET_CATEGORY_DELAY_MS },
        'Rate-limit guard: delaying before category set'
      );
      await sleep(NOSPOS_SET_CATEGORY_DELAY_MS);
    }
    logPark('applyNosposAgreementCategoryPhaseImpl', 'call', { tabId, lineIndex, categoryId }, 'Sending category phase to content script');
    const r1 = await sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'category', categoryId, lineIndex },
      8,
      500
    );
    logPark('applyNosposAgreementCategoryPhaseImpl', 'result', { r1 }, 'Category phase response from content script');
    if (!r1?.ok) {
      logPark('applyNosposAgreementCategoryPhaseImpl', 'error', { r1, lineIndex, categoryId }, 'Content script could not set category');
      return { ok: false, error: r1?.error || 'Could not set category', lineIndex, ...r1 };
    }
    categoryLabel = r1.label || null;
    logPark('applyNosposAgreementCategoryPhaseImpl', 'step', { lineIndex, categoryLabel, stockLabelsForWait }, 'Category set — waiting for page/form reload');
    console.log('[CG Suite] NosPos agreement fill: category set, waiting for page/form…', {
      lineIndex,
      categoryLabel,
      expectStockLabels: stockLabelsForWait,
    });
    const waitForm = await waitForAgreementItemsReadyAfterCategory(
      tabId,
      stockLabelsForWait,
      lineIndex
    );
    logPark('applyNosposAgreementCategoryPhaseImpl', 'result', { waitForm, lineIndex, categoryLabel }, 'Post-category form-ready wait result');
    if (!waitForm.ok) {
      console.warn('[CG Suite] NosPos agreement fill: post-category wait failed', waitForm);
    }
    return { ok: true, categoryLabel, waitForm, lineIndex };
  } catch (e) {
    logPark('applyNosposAgreementCategoryPhaseImpl', 'error', { error: e?.message, lineIndex, categoryId }, 'Exception in category phase');
    return { ok: false, error: e?.message || 'Could not set category on NoSpos', lineIndex };
  }
}

/**
 * Fill name, description, qty, prices, stock fields on an agreement line (retries when DOM not ready).
 */
async function applyNosposAgreementRestPhaseImpl(tabId, payload, categoryLabel) {
  const lineIndex = Math.max(0, parseInt(String(payload.lineIndex ?? '0'), 10) || 0);
  logPark('applyNosposAgreementRestPhaseImpl', 'enter', {
    tabId, lineIndex, categoryLabel,
    name: payload.name, quantity: payload.quantity,
    retailPrice: payload.retailPrice, boughtFor: payload.boughtFor,
    stockFieldCount: Array.isArray(payload.stockFields) ? payload.stockFields.length : 0,
    itemDescription: payload.itemDescription,
  }, 'Filling rest of agreement line fields');
  const restPayload = {
    type: 'NOSPOS_AGREEMENT_FILL_PHASE',
    phase: 'rest',
    lineIndex,
    name: payload.name ?? '',
    itemDescription: payload.itemDescription ?? '',
    quantity: payload.quantity ?? '',
    retailPrice: payload.retailPrice ?? '',
    boughtFor: payload.boughtFor ?? '',
    stockFields: Array.isArray(payload.stockFields) ? payload.stockFields : [],
    categoryOurDisplay: String(payload.categoryOurDisplay ?? '').trim(),
  };

  let last = null;
  try {
    for (let i = 0; i < 28; i += 1) {
      last = await sendParkMessageToTabWithAbort(tabId, restPayload, 6, 350);
      if (last?.ok) {
        logPark('applyNosposAgreementRestPhaseImpl', 'exit', { lineIndex, attempt: i, applied: last?.applied, warnings: last?.warnings, missingRequired: last?.missingRequired }, 'Rest phase succeeded');
        return { ok: true, categoryLabel, lineIndex, ...last };
      }
      if (!last?.notReady) {
        logPark('applyNosposAgreementRestPhaseImpl', 'error', { lineIndex, attempt: i, last }, 'Rest phase failed (not a notReady error)');
        return { ok: false, categoryLabel, lineIndex, error: last?.error || 'Could not fill agreement line', ...last };
      }
      logPark('applyNosposAgreementRestPhaseImpl', 'step', { lineIndex, attempt: i, notReady: true }, `Form not ready yet — retry ${i + 1}/28`);
      await sleep(500);
    }
    logPark('applyNosposAgreementRestPhaseImpl', 'error', { lineIndex, attempts: 28 }, 'Rest phase exhausted all retries — form never became ready');
    return { ok: false, categoryLabel, lineIndex, error: last?.error || 'Agreement line form did not become ready in time', ...last };
  } catch (e) {
    logPark('applyNosposAgreementRestPhaseImpl', 'error', { error: e?.message, lineIndex }, 'Exception in rest phase');
    return { ok: false, categoryLabel, lineIndex, error: e?.message || 'Could not fill agreement line on NoSpos' };
  }
}

/**
 * Fill one agreement line by index (0-based). Caller must ensure tab is already on the items page.
 */
async function fillNosposAgreementOneLineImpl(tabId, payload) {
  const cat = await applyNosposAgreementCategoryPhaseImpl(tabId, payload);
  if (!cat.ok) {
    return {
      ok: false,
      error: cat.error,
      lineIndex: cat.lineIndex ?? payload.lineIndex,
    };
  }
  let restPayload = { ...payload };
  const marker = String(payload.cgParkLineMarker || '').trim();
  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      restPayload = { ...restPayload, lineIndex: found };
      console.log('[CG Suite] NosPos park: re-resolved line index after category', {
        marker,
        lineIndex: found,
      });
    }
  }
  return applyNosposAgreementRestPhaseImpl(tabId, restPayload, cat.categoryLabel);
}

async function fillNosposParkAgreementCategoryImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const lineIndex = Math.max(
    0,
    parseInt(String(payload.lineIndex ?? item.lineIndex ?? '0'), 10) || 0
  );
  const merged = { ...item, lineIndex };
  const result = await applyNosposAgreementCategoryPhaseImpl(tabId, merged);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      lineIndex: result.lineIndex ?? lineIndex,
    };
  }
  let restLineIndex = lineIndex;
  const marker = String(item.cgParkLineMarker || '').trim();
  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      restLineIndex = found;
      console.log('[CG Suite] NosPos park: rest line index after category (split step)', {
        marker,
        restLineIndex,
      });
    } else {
      // Brand-new row: description/marker not written yet, so the marker scan
      // comes up empty. After the category-triggered reload the row order may
      // have shifted, so use the current last-row count rather than the
      // pre-reload lineIndex.
      const count = await countNosposAgreementItemLines(tabId);
      if (count > 0) {
        const lastIdx = count - 1;
        if (lastIdx !== lineIndex) {
          console.log('[CG Suite] NosPos park: marker not found after category reload — using last row index', {
            lineIndex,
            lastIdx,
          });
        }
        restLineIndex = lastIdx;
      }
    }
  }
  return {
    ok: true,
    categoryLabel: result.categoryLabel,
    waitForm: result.waitForm,
    lineIndex: result.lineIndex ?? lineIndex,
    restLineIndex,
  };
}

async function fillNosposParkAgreementRestImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const lineIndex = Math.max(
    0,
    parseInt(String(payload.lineIndex ?? item.lineIndex ?? '0'), 10) || 0
  );
  const categoryLabel =
    payload.categoryLabel !== undefined && payload.categoryLabel !== ''
      ? payload.categoryLabel
      : null;
  return applyNosposAgreementRestPhaseImpl(
    tabId,
    { ...item, lineIndex },
    categoryLabel
  );
}

/**
 * Wait for agreement items URL, optionally set category, then fill name/qty/prices/stock (with retries after category DOM refresh).
 */
async function fillNosposAgreementFirstItemImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const firstDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (firstDead) return firstDead;
  const tabCheck = await ensureNosposAgreementItemsTab(tabId, 90000);
  if (!tabCheck.ok) return tabCheck;
  return fillNosposAgreementOneLineImpl(tabId, {
    ...payload,
    lineIndex: payload.lineIndex ?? 0,
  });
}

/**
 * stepIndex = index among *included* lines only. negotiationLineIndex = index in parkNegotiationLines.
 * After a full park, NosPos row i ↔ line i even if some lines are later "excluded" in CG (rows remain).
 * When row count matches negotiation count, prefer negotiationLineIndex; else stepIndex (compressed layout).
 */
function pickParkFallbackLineIndex(stepIndex, negotiationLineIndex, countBefore, parkNegotiationLineCount) {
  const n = Math.max(0, parseInt(String(countBefore ?? '0'), 10) || 0);
  const step = Math.max(0, parseInt(String(stepIndex ?? '0'), 10) || 0);
  const plc = Math.max(0, parseInt(String(parkNegotiationLineCount ?? '0'), 10) || 0);
  let nl = null;
  if (negotiationLineIndex != null && negotiationLineIndex !== '') {
    const parsed = parseInt(String(negotiationLineIndex), 10);
    if (Number.isFinite(parsed) && parsed >= 0) nl = parsed;
  }
  if (plc > 0 && nl != null && n >= plc && n > nl) {
    return nl;
  }
  return step;
}

/**
 * Find row by description marker, or use row 0, or click Add and wait for new row.
 */
async function resolveNosposParkAgreementLineImpl(tabId, stepIndex, item, opts = {}) {
  const noAdd = opts.noAdd === true;
  const alwaysEnsureTab = opts.ensureTab === true;
  const marker = String(item.cgParkLineMarker || '').trim();
  const parkNegotiationLineCount = opts.parkNegotiationLineCount;
  const negotiationLineIndex = opts.negotiationLineIndex;
  logPark('resolveNosposParkAgreementLineImpl', 'enter', {
    tabId, stepIndex, noAdd, alwaysEnsureTab, marker,
    parkNegotiationLineCount, negotiationLineIndex,
    itemName: item.name, itemCategoryId: item.categoryId,
  }, `Resolving NoSpos line for step ${stepIndex}`);

  if (stepIndex === 0 || alwaysEnsureTab) {
    logPark('resolveNosposParkAgreementLineImpl', 'step', { stepIndex, alwaysEnsureTab }, 'Ensuring items tab is loaded');
    const tabCheck = await ensureNosposAgreementItemsTab(tabId, 120000);
    logPark('resolveNosposParkAgreementLineImpl', 'result', { tabCheck }, 'ensureNosposAgreementItemsTab result');
    if (!tabCheck.ok) return { ...tabCheck, targetLineIndex: undefined };
  }

  let targetLineIndex = null;
  let reusedExistingRow = false;
  let didClickAdd = false;

  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      targetLineIndex = found;
      reusedExistingRow = true;
      const expCat = String(item.categoryId || '').trim();
      const snap = await readNosposAgreementLineSnapshot(tabId, targetLineIndex);
      if (snap?.ok) {
        logPark('resolveNosposParkAgreementLineImpl', 'decision', {
          marker, targetLineIndex, stepIndex,
          nosposName: snap.name, nosposDescription: snap.description, nosposCategoryId: snap.categoryId,
          expectedCategoryId: expCat, categoryMismatch: expCat && snap.categoryId && expCat !== snap.categoryId,
          markerMissing: !String(snap.description || '').includes(marker),
        }, 'Reusing existing NoSpos row matched by marker (skipping Add)');
        console.log('[CG Suite] NosPos park: reusing row with CG marker (skip Add)', {
          marker, targetLineIndex, stepIndex,
          nosposName: snap.name, nosposItemDescription: snap.description, nosposCategoryId: snap.categoryId,
        });
        if (expCat && snap.categoryId && expCat !== snap.categoryId) {
          console.warn('[CG Suite] NosPos park: category differs on reused row (fill will overwrite)', { expectedCategoryId: expCat, nosposCategoryId: snap.categoryId });
        }
        if (!String(snap.description || '').includes(marker)) {
          console.warn('[CG Suite] NosPos park: marker missing in Nospos item description before fill', { marker, description: snap.description });
        }
      }
    } else {
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { marker }, 'Marker not found in any NoSpos row');
    }
  }

  if (targetLineIndex == null) {
    const countBefore = await countNosposAgreementItemLines(tabId);
    const fallbackIdx = pickParkFallbackLineIndex(
      stepIndex,
      negotiationLineIndex,
      countBefore,
      parkNegotiationLineCount
    );
    logPark('resolveNosposParkAgreementLineImpl', 'step', { countBefore, fallbackIdx, stepIndex, noAdd, negotiationLineIndex, parkNegotiationLineCount }, 'Marker not found — deciding between fallback index or Add');

    if (stepIndex === 0 || noAdd) {
      targetLineIndex = fallbackIdx;
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { targetLineIndex, reason: stepIndex === 0 ? 'first-step' : 'noAdd' }, 'Using fallback line index (no Add click)');
      if (noAdd && stepIndex > 0) {
        console.log('[CG Suite] NosPos park: noAdd — marker not found, using fallback line index', {
          stepIndex, negotiationLineIndex, fallbackIdx, lineCount: countBefore, parkNegotiationLineCount, reusedExistingRow,
        });
      }
    } else if (countBefore > fallbackIdx) {
      targetLineIndex = fallbackIdx;
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { targetLineIndex, countBefore, fallbackIdx }, 'Existing row available at fallback index — skipping Add');
      console.log('[CG Suite] NosPos park: marker not found; using existing row at fallback index (skip Add)', {
        stepIndex, negotiationLineIndex, fallbackIdx, lineCount: countBefore, parkNegotiationLineCount, marker,
      });
    } else {
      logPark('resolveNosposParkAgreementLineImpl', 'step', { countBefore, fallbackIdx }, 'No existing row at fallback index — clicking Add');
      const clickR = await clickNosposAgreementAddItem(tabId);
      logPark('resolveNosposParkAgreementLineImpl', 'result', { clickR }, 'clickNosposAgreementAddItem result');
      if (!clickR?.ok) {
        logPark('resolveNosposParkAgreementLineImpl', 'error', { clickR }, 'Failed to click Add');
        return { ok: false, error: clickR?.error || 'Could not click Add on NoSpos' };
      }
      didClickAdd = true;
      const waitNew = await waitForNewAgreementLineAfterAdd(tabId, countBefore);
      logPark('resolveNosposParkAgreementLineImpl', 'result', { waitNew }, 'waitForNewAgreementLineAfterAdd result');
      if (!waitNew.ok) {
        return { ok: false, error: waitNew.error };
      }
      const countAfter = await countNosposAgreementItemLines(tabId);
      targetLineIndex = Math.max(0, countAfter - 1);
      logPark('resolveNosposParkAgreementLineImpl', 'step', { countAfter, targetLineIndex }, 'Add succeeded — targeting last row');
    }
  }

  logPark('resolveNosposParkAgreementLineImpl', 'exit', { targetLineIndex, reusedExistingRow, didClickAdd }, 'Line resolved');
  return { ok: true, targetLineIndex, reusedExistingRow, didClickAdd };
}

/**
 * One step of the park flow: optional Add+wait (stepIndex &gt; 0), then fill that line.
 * Lets the app refresh UI between lines.
 */
async function fillNosposAgreementItemStepImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  const stepIndex = Math.max(0, parseInt(String(payload.stepIndex ?? '0'), 10) || 0);
  logPark('fillNosposAgreementItemStepImpl', 'enter', { tabId, stepIndex, negotiationLineIndex: payload.negotiationLineIndex, itemName: payload.item?.name }, `Step ${stepIndex} — resolving then filling`);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    logPark('fillNosposAgreementItemStepImpl', 'error', { tabId }, 'Invalid tabId');
    return { ok: false, error: 'Invalid tab' };
  }
  const stepDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (stepDead) return stepDead;

  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const resolved = await resolveNosposParkAgreementLineImpl(tabId, stepIndex, item, {
    negotiationLineIndex: payload.negotiationLineIndex,
    parkNegotiationLineCount: payload.parkNegotiationLineCount,
  });
  logPark('fillNosposAgreementItemStepImpl', 'result', { resolved }, 'Line resolution result');
  if (!resolved.ok) return resolved;

  const fillRes = await fillNosposAgreementOneLineImpl(tabId, {
    ...item,
    lineIndex: resolved.targetLineIndex,
  });
  logPark('fillNosposAgreementItemStepImpl', 'result', { fillOk: fillRes?.ok, lineIndex: resolved.targetLineIndex, warnings: fillRes?.warnings }, 'fillNosposAgreementOneLineImpl result');
  if (!fillRes?.ok) return fillRes;
  const out = {
    ...fillRes,
    reusedExistingRow: resolved.reusedExistingRow,
    targetLineIndex: resolved.targetLineIndex,
    didClickAdd: resolved.didClickAdd,
  };
  logPark('fillNosposAgreementItemStepImpl', 'exit', { targetLineIndex: out.targetLineIndex, reusedExistingRow: out.reusedExistingRow, didClickAdd: out.didClickAdd }, `Step ${stepIndex} complete`);
  return out;
}

async function fillNosposAgreementItemsSequentialImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const seqDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (seqDead) return seqDead;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, error: 'No items to add' };
  }

  const tabCheck = await ensureNosposAgreementItemsTab(tabId, 120000);
  if (!tabCheck.ok) return tabCheck;

  const perItem = [];
  for (let i = 0; i < items.length; i += 1) {
    const marker = String(items[i].cgParkLineMarker || '').trim();
    let targetLineIndex = null;
    if (marker) {
      const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
      if (found != null && found >= 0) {
        targetLineIndex = found;
        const snap = await readNosposAgreementLineSnapshot(tabId, targetLineIndex);
        if (snap?.ok) {
          console.log('[CG Suite] NosPos sequential: reusing row with CG marker (skip Add)', {
            itemIndex: i,
            marker,
            targetLineIndex,
            nosposName: snap.name,
            nosposItemDescription: snap.description,
            nosposCategoryId: snap.categoryId,
          });
        }
      }
    }
    if (targetLineIndex == null) {
      if (i > 0) {
        const countBefore = await countNosposAgreementItemLines(tabId);
        const clickR = await clickNosposAgreementAddItem(tabId);
        if (!clickR?.ok) {
          return {
            ok: false,
            error: clickR?.error || 'Could not click Add on NoSpos',
            perItem,
            filledUpToIndex: i - 1,
          };
        }
        const waitNew = await waitForNewAgreementLineAfterAdd(tabId, countBefore);
        if (!waitNew.ok) {
          return {
            ok: false,
            error: waitNew.error,
            perItem,
            filledUpToIndex: i - 1,
          };
        }
        const countAfter = await countNosposAgreementItemLines(tabId);
        targetLineIndex = Math.max(0, countAfter - 1);
      } else {
        targetLineIndex = 0;
      }
    }
    const one = await fillNosposAgreementOneLineImpl(tabId, {
      ...items[i],
      lineIndex: targetLineIndex,
    });
    if (!one?.ok) {
      return {
        ok: false,
        error: one?.error || `Could not fill agreement line ${i + 1}`,
        perItem,
        filledUpToIndex: i - 1,
        ...one,
      };
    }
    perItem.push(one);
  }

  const last = perItem[perItem.length - 1];
  return {
    ok: true,
    perItem,
    categoryLabel: last?.categoryLabel,
    fieldRows: last?.fieldRows,
    applied: last?.applied,
    missingRequired: last?.missingRequired,
    warnings: last?.warnings,
  };
}

async function scrapeNosposStockCategoryModifyTab(tabId) {
  try {
    const response = await sendMessageToTabWithRetries(
      tabId,
      { type: 'SCRAPE_NOSPOS_STOCK_CATEGORY_MODIFY' },
      12,
      400
    );
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    let buybackRatePercent = null;
    if (response?.buybackRatePercent != null && response.buybackRatePercent !== '') {
      const n = Number(response.buybackRatePercent);
      buybackRatePercent = Number.isFinite(n) ? n : null;
    }
    let offerRatePercent = null;
    if (response?.offerRatePercent != null && response.offerRatePercent !== '') {
      const n = Number(response.offerRatePercent);
      offerRatePercent = Number.isFinite(n) ? n : null;
    }
    const hasData = rows.length > 0 || buybackRatePercent != null || offerRatePercent != null;
    if (response?.ok === false && !hasData) {
      return {
        ok: false,
        rows: [],
        buybackRatePercent: null,
        offerRatePercent: null,
        error: response?.error || 'Scrape returned no data',
      };
    }
    return {
      ok: true,
      rows,
      buybackRatePercent,
      offerRatePercent,
      error: response?.error || null,
    };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      buybackRatePercent: null,
      offerRatePercent: null,
      error: e?.message || 'Scrape failed',
    };
  }
}

async function clearNosposPendingEntries(tabId) {
  const pending = await getPending();
  let changed = false;
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.type === 'openNospos' && (tabId == null || entry.listingTabId === tabId)) {
      delete pending[requestId];
      changed = true;
    }
  }
  if (changed) {
    await setPending(pending);
  }
}

async function clearNosposRepricingState(tabId) {
  await chrome.storage.session.remove('cgNosposRepricingData');
  await chrome.storage.local.remove('cgNosposRepricingProgress');
  await clearNosposPendingEntries(tabId);
}

async function setLastRepricingResult(payload) {
  await chrome.storage.local.set({ cgNosposLastRepricingResult: payload || null });
}

async function getLastRepricingResult() {
  const stored = await chrome.storage.local.get('cgNosposLastRepricingResult');
  return stored.cgNosposLastRepricingResult || null;
}

async function clearLastRepricingResult() {
  await chrome.storage.local.remove('cgNosposLastRepricingResult');
}

async function getRepricingStatus() {
  const stored = await chrome.storage.local.get('cgNosposRepricingStatus');
  return stored.cgNosposRepricingStatus || null;
}

async function setRepricingStatus(status) {
  await chrome.storage.local.set({ cgNosposRepricingStatus: status || null });
}

async function clearRepricingStatus() {
  await chrome.storage.local.remove('cgNosposRepricingStatus');
}

function countTotalBarcodes(repricingData) {
  return (repricingData || []).reduce((sum, item) => sum + ((item?.barcodes?.length) || 0), 0);
}

function countCompletedBarcodes(completedBarcodes) {
  return Object.values(completedBarcodes || {}).reduce((sum, indices) => sum + ((indices || []).length), 0);
}

function getStockEditUrl(stockUrl) {
  if (!stockUrl) return null;
  if (/\/stock\/\d+\/edit\/?$/.test(stockUrl)) return stockUrl.replace(/\/?$/, '');
  if (/\/stock\/\d+\/?$/.test(stockUrl)) return stockUrl.replace(/\/?$/, '') + '/edit';
  return null;
}

function buildBarcodeQueue(repricingData, completedBarcodes, completedItems, skippedBarcodes = {}) {
  const queue = [];
  for (let i = 0; i < (repricingData || []).length; i++) {
    const item = repricingData[i];
    if (completedItems?.includes(item?.itemId)) continue;
    const done = completedBarcodes?.[item?.itemId] || [];
    const skipped = skippedBarcodes?.[item?.itemId] || [];
    for (let j = 0; j < (item?.barcodes?.length || 0); j++) {
      if (done.includes(j) || skipped.includes(j)) continue;
      const barcode = (item?.barcodes?.[j] || '').trim();
      if (!barcode) continue;
      queue.push({
        itemIndex: i,
        barcodeIndex: j,
        itemId: item?.itemId,
        itemTitle: item?.title || '',
        barcode,
        stockUrl: item?.stockUrls?.[j] || ''
      });
    }
  }
  return queue;
}

function getActiveQueue(data) {
  const queue = Array.isArray(data?.queue) ? data.queue : [];
  if (queue.length > 0) return queue;
  return buildBarcodeQueue(data?.repricingData || [], data?.completedBarcodes || {}, data?.completedItems || [], data?.skippedBarcodes || {});
}

function removeQueueHead(queue, expected) {
  const currentQueue = Array.isArray(queue) ? [...queue] : [];
  if (currentQueue.length === 0) return currentQueue;
  if (!expected) return currentQueue.slice(1);
  const head = currentQueue[0];
  if (
    head?.itemId === expected?.itemId &&
    head?.barcodeIndex === expected?.barcodeIndex &&
    head?.barcode === expected?.barcode
  ) {
    return currentQueue.slice(1);
  }
  return currentQueue.filter((entry) => !(
    entry?.itemId === expected?.itemId &&
    entry?.barcodeIndex === expected?.barcodeIndex &&
    entry?.barcode === expected?.barcode
  ));
}

function appendRepricingLog(data, message, level = 'info') {
  const logs = [...(data?.logs || []), {
    timestamp: new Date().toISOString(),
    level,
    message: String(message || '').trim()
  }].slice(-200);
  return { ...(data || {}), logs };
}

function itemTitleForLog(item) {
  return item?.title || 'Unknown Item';
}

function formatBarcodeArrayForLog(item) {
  const values = (item?.barcodes || []).map((barcode) => String(barcode || '').trim()).filter(Boolean);
  return `[${values.map((barcode) => `"${barcode}"`).join(', ')}]`;
}

function addItemContextLog(data, item, prefix = 'Next item is') {
  if (!item?.itemId) return data;
  if (data?.lastLoggedItemId === item.itemId) return data;
  const label = data?.lastLoggedItemId ? 'Next item is' : 'First item is';
  return appendRepricingLog(
    { ...(data || {}), lastLoggedItemId: item.itemId },
    `${label} ${itemTitleForLog(item)} - updating barcodes ${formatBarcodeArrayForLog(item)}.`
  );
}

function buildRepricingStatusPayload(data, overrides = {}) {
  const repricingData = data?.repricingData || [];
  const completedBarcodes = data?.completedBarcodes || {};
  const completedItems = data?.completedItems || [];
  const totalBarcodes =
    overrides.totalBarcodes != null ? Number(overrides.totalBarcodes) : countTotalBarcodes(repricingData);
  const completedBarcodeCount =
    overrides.completedBarcodeCount != null
      ? Number(overrides.completedBarcodeCount)
      : data?.completedBarcodeCount != null
        ? Number(data.completedBarcodeCount)
        : countCompletedBarcodes(completedBarcodes);
  const queue = getActiveQueue(data);
  const next = queue[0] || null;
  const nextItem = next ? repricingData[next.itemIndex] : null;

  return {
    cartKey: data?.cartKey || '',
    running: overrides.running != null ? !!overrides.running : !data?.done,
    done: overrides.done != null ? !!overrides.done : !!data?.done,
    step: overrides.step || data?.step || (data?.done ? 'completed' : 'working'),
    message: overrides.message || data?.message || '',
    currentBarcode: overrides.currentBarcode ?? data?.currentBarcode ?? next?.barcode ?? '',
    currentItemId: overrides.currentItemId ?? data?.currentItemId ?? nextItem?.itemId ?? '',
    currentItemTitle: overrides.currentItemTitle ?? data?.currentItemTitle ?? nextItem?.title ?? '',
    totalBarcodes,
    completedBarcodeCount,
    completedBarcodes,
    completedItems,
    logs: overrides.logs != null ? overrides.logs : data?.logs || [],
  };
}

async function broadcastRepricingStatus(appTabId, data, overrides = {}) {
  const payload = buildRepricingStatusPayload(data, overrides);
  await setRepricingStatus(payload);
  if (appTabId) {
    await chrome.tabs.sendMessage(appTabId, {
      type: 'REPRICING_PROGRESS_TO_PAGE',
      payload
    }).catch(() => {});
  }
  return payload;
}

async function failNosposRequestAndCloseTab(requestId, entry, message) {
  const pending = await getPending();
  if (pending[requestId]) {
    delete pending[requestId];
    await setPending(pending);
  }

  if (entry?.type === 'openNospos') {
    const status = await getRepricingStatus();
    if (status?.cartKey) {
      await setRepricingStatus({
        ...status,
        running: false,
        done: false,
        step: 'error',
        message: message || 'You must be logged into NoSpos to continue.',
        logs: [...(status.logs || []), {
          timestamp: new Date().toISOString(),
          level: 'error',
          message: message || 'You must be logged into NoSpos to continue.'
        }].slice(-200)
      });
    }
    await clearNosposRepricingState(entry.listingTabId);
  }

  if (entry?.appTabId != null) {
    chrome.tabs.sendMessage(entry.appTabId, {
      type: 'EXTENSION_RESPONSE_TO_PAGE',
      requestId,
      error: message || 'You must be logged into NoSpos to continue.'
    }).catch(() => {});
    await focusAppTab(entry.appTabId);
  }

  if (entry?.listingTabId != null) {
    await chrome.tabs.remove(entry.listingTabId).catch(() => {});
  }
}

const WEB_EPOS_UPLOAD_HOST = 'webepos.cashgenerator.co.uk';
const WEB_EPOS_LOGIN_PATH = /^\/login(\/|$)/i;
/** Upload / gate / scrape: [products list](https://webepos.cashgenerator.co.uk/products) (logged-in table). */
const WEB_EPOS_PRODUCTS_URL = `https://${WEB_EPOS_UPLOAD_HOST}/products`;
const WEB_EPOS_PRODUCT_NEW_URL = `https://${WEB_EPOS_UPLOAD_HOST}/products/new`;
const WEB_EPOS_UPLOAD_SESSION_KEY = 'cgWebEposUploadSession';

function normalizeWebEposUploadUrl(raw) {
  let url = String(raw || WEB_EPOS_PRODUCTS_URL).trim() || WEB_EPOS_PRODUCTS_URL;
  try {
    const pu = new URL(url);
    if (pu.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) return WEB_EPOS_PRODUCTS_URL;
    return url;
  } catch {
    return WEB_EPOS_PRODUCTS_URL;
  }
}

/** Close the worker tab; if it is the only tab in its window, close the whole window (dedicated Web EPOS window). */
async function removeWebEposWorkerByTabId(tabId) {
  if (tabId == null) return;
  const workerTab = await chrome.tabs.get(tabId).catch(() => null);
  const wid = workerTab?.windowId;
  if (wid == null) {
    await chrome.tabs.remove(tabId).catch(() => {});
    return;
  }
  try {
    const w = await chrome.windows.get(wid, { populate: true });
    const onlyTab =
      Array.isArray(w.tabs) &&
      w.tabs.length === 1 &&
      Number(w.tabs[0]?.id) === Number(tabId);
    if (onlyTab) {
      await chrome.windows.remove(wid).catch(() => chrome.tabs.remove(tabId).catch(() => {}));
    } else {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  } catch {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

/** @returns {'wait'|'login'|{ kind: 'ready', url: string }} */
function classifyWebEposUrl(u) {
  const url = String(u || '').trim();
  if (!url || url.startsWith('chrome://')) return 'wait';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'wait';
  }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) return 'wait';
  const path = (parsed.pathname || '/').toLowerCase();
  if (WEB_EPOS_LOGIN_PATH.test(path)) return 'login';
  return { kind: 'ready', url };
}

async function readWebEposUploadSession() {
  try {
    const raw = await chrome.storage.session.get(WEB_EPOS_UPLOAD_SESSION_KEY);
    const s = raw[WEB_EPOS_UPLOAD_SESSION_KEY];
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch (_) {
    return null;
  }
}

async function writeWebEposUploadSession(partial) {
  try {
    const raw = await chrome.storage.session.get(WEB_EPOS_UPLOAD_SESSION_KEY);
    const cur =
      raw[WEB_EPOS_UPLOAD_SESSION_KEY] && typeof raw[WEB_EPOS_UPLOAD_SESSION_KEY] === 'object'
        ? raw[WEB_EPOS_UPLOAD_SESSION_KEY]
        : {};
    await chrome.storage.session.set({
      [WEB_EPOS_UPLOAD_SESSION_KEY]: { ...cur, ...partial },
    });
  } catch (_) {}
}

async function clearWebEposUploadSession() {
  try {
    await chrome.storage.session.remove(WEB_EPOS_UPLOAD_SESSION_KEY);
  } catch (_) {}
}

async function closeWebEposUploadSessionForAppTab(appTabId) {
  if (appTabId == null) return;
  const session = await readWebEposUploadSession();
  if (!session || Number(session.appTabId) !== Number(appTabId)) return;
  const workerTabId = session.workerTabId;
  if (workerTabId != null) {
    await writeWebEposUploadSession({ ...session, workerTabId: null });
    await removeWebEposWorkerByTabId(workerTabId);
  }
  await clearWebEposUploadSession();
}

/**
 * Only the tab id stored in our upload session is reused (never arbitrary Web EPOS tabs).
 * Otherwise opens a new minimised window via openBackgroundNosposTab.
 */
async function ensureWebEposUploadWorkerTabOpen(url, appTabId) {
  let session = await readWebEposUploadSession();
  if (
    session?.workerTabId != null &&
    session.appTabId != null &&
    Number(session.appTabId) !== Number(appTabId)
  ) {
    const wid = session.workerTabId;
    await writeWebEposUploadSession({ ...session, workerTabId: null });
    await removeWebEposWorkerByTabId(wid);
    await clearWebEposUploadSession();
    session = null;
  }
  if (session?.workerTabId != null) {
    try {
      await chrome.tabs.get(session.workerTabId);
      await chrome.tabs.update(session.workerTabId, { url });
      await writeWebEposUploadSession({
        workerTabId: session.workerTabId,
        appTabId,
        lastUrl: url,
      });
      if (appTabId != null) await focusAppTab(appTabId);
      return { tabId: session.workerTabId };
    } catch {
      await writeWebEposUploadSession({ workerTabId: null, appTabId, lastUrl: url });
    }
  }
  const { tabId } = await openBackgroundNosposTab(url, appTabId);
  await writeWebEposUploadSession({
    workerTabId: tabId,
    appTabId,
    lastUrl: url,
  });
  return { tabId };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  void (async () => {
    try {
      const session = await readWebEposUploadSession();
      if (
        !session ||
        session.workerTabId == null ||
        Number(session.workerTabId) !== Number(tabId)
      ) {
        return;
      }
      const u = (tab.url || tab.pendingUrl || '').trim();
      if (!u || u.startsWith('chrome://')) return;
      let p;
      try {
        p = new URL(u);
      } catch {
        return;
      }
      if (p.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) return;
      await writeWebEposUploadSession({ lastUrl: u });
    } catch (_) {}
  })();
});

/** Abort active `watchWebEposUploadTab` timers/listeners when the worker tab is removed (global handler). */
const webEposUploadWatchAbortByTabId = new Map();

/**
 * Always detect the upload worker closing — including after the initial open/watch has finished.
 * (Per-tab watch removes its listeners on success; without this, the app never learns the window was closed.)
 */
async function handleWebEposWorkerTabRemovedGlobally(removedTabId) {
  const abort = webEposUploadWatchAbortByTabId.get(removedTabId);
  if (typeof abort === 'function') abort();

  const session = await readWebEposUploadSession();
  if (
    !session ||
    session.workerTabId == null ||
    Number(session.workerTabId) !== Number(removedTabId)
  ) {
    return;
  }

  const lastUrl = session.lastUrl || WEB_EPOS_PRODUCTS_URL;
  const appTabId = session.appTabId;

  await writeWebEposUploadSession({
    workerTabId: null,
    appTabId,
    lastUrl,
  });

  const pending = await getPending();
  for (const [reqId, entry] of Object.entries(pending)) {
    if (
      entry.type === 'openWebEposUpload' &&
      entry.appTabId === appTabId &&
      Number(entry.listingTabId) === Number(removedTabId)
    ) {
      delete pending[reqId];
      await setPending(pending);
      chrome.tabs
        .sendMessage(appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId: reqId,
          error: 'Web EPOS window was closed.',
        })
        .catch(() => {});
      break;
    }
  }

  if (appTabId != null) {
    chrome.tabs
      .sendMessage(appTabId, {
        type: 'WEB_EPOS_UPLOAD_WORKER_TO_PAGE',
        lastUrl,
      })
      .catch(() => {});
    await focusAppTab(appTabId);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleWebEposWorkerTabRemovedGlobally(tabId);
});

/**
 * Injected into the Web EPOS products tab. Waits for SPA/async table render (polls).
 * Must stay self-contained for MV3 serialization; returns a Promise Chrome will await.
 * @param {number} maxWaitMs
 * @returns {Promise<{ ok: true, headers: string[], rows: object[], pagingText: string|null, pageUrl: string } | { ok: false, error: string }>}
 */
async function scrapeWebEposProductsTableInPageWithWait(maxWaitMs) {
  const ms = Math.min(Math.max(Number(maxWaitMs) || 25000, 5000), 180000);
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const globalDeadline = Date.now() + ms;
  const MAX_PAGES = 200;

  function rowLooksLikeProduct(tr) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 5) return false;
    const t = String(cells[0].textContent || '').trim();
    if (t.length < 4) return false;
    return true;
  }

  function scoreProductRows(table) {
    let n = 0;
    if (!table) return 0;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (rowLooksLikeProduct(tr)) n += 1;
    });
    return n;
  }

  /** Prefer the table with the most valid product rows (avoids grabbing a small/static table before the real grid). */
  function findProductsTable() {
    const seen = new Set();
    const list = [];
    const selectors = [
      '.col-sm-12 table',
      'div.col-sm-12 table',
      'table.table',
      'main table',
      '[class*="product"] table',
      'article table',
      '#root table',
      'body table',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      document.querySelectorAll(selectors[i]).forEach((t) => {
        if (t && !seen.has(t)) {
          seen.add(t);
          list.push(t);
        }
      });
    }
    if (list.length === 0) {
      document.querySelectorAll('table').forEach((t) => {
        if (!seen.has(t)) {
          seen.add(t);
          list.push(t);
        }
      });
    }
    let best = null;
    let bestScore = 0;
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k];
      const s = scoreProductRows(t);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function isUsableNextButton(b) {
    if (!b) return false;
    if (b.disabled) return false;
    if (b.classList.contains('disabled')) return false;
    if (String(b.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
    return true;
  }

  /**
   * Must not use container.querySelector('.paging') — that returns the *first* pager in the tree,
   * often a header/stub with no working Next, so we never click and only scrape page 1.
   */
  function findPagingNearTable(table) {
    const all = Array.from(document.querySelectorAll('.paging'));
    if (all.length === 0) return null;
    const hasUsableNext = (root) =>
      Array.from(root.querySelectorAll('button.next')).some(isUsableNextButton);

    if (!table) {
      for (let i = 0; i < all.length; i += 1) {
        if (hasUsableNext(all[i])) return all[i];
      }
      return all[0];
    }

    for (let i = 0; i < all.length; i += 1) {
      const p = all[i];
      const pos = table.compareDocumentPosition(p);
      if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
      if (!hasUsableNext(p)) continue;
      return p;
    }

    let n = table.nextElementSibling;
    for (let i = 0; i < 8 && n; i += 1) {
      if (n.matches && n.matches('.paging') && hasUsableNext(n)) return n;
      const inner = n.querySelector ? n.querySelector(':scope .paging') : null;
      if (inner && hasUsableNext(inner)) return inner;
      n = n.nextElementSibling;
    }

    for (let i = 0; i < all.length; i += 1) {
      if (hasUsableNext(all[i])) return all[i];
    }
    return all[0];
  }

  function extractFromTable(table) {
    const thead = table.querySelector('thead tr');
    const headers = thead
      ? Array.from(thead.querySelectorAll('th')).map((th) =>
          String(th.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
        )
      : [];
    const rows = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (!rowLooksLikeProduct(tr)) return;
      const cells = tr.querySelectorAll('td');
      const bcLink = cells[0].querySelector('a');
      const lastCell = cells[cells.length - 1];
      const extLink =
        lastCell && lastCell.querySelector ? lastCell.querySelector('a[href^="http"]') : null;
      let productHref = bcLink ? bcLink.getAttribute('href') : null;
      if (productHref && productHref.startsWith('/') && host) {
        productHref = `https://${host}${productHref}`;
      }
      rows.push({
        barcode: (bcLink ? bcLink.textContent : cells[0].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        productHref,
        productName: String(cells[1].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        price: String(cells[2].textContent || '').trim(),
        quantity: String(cells[3].textContent || '').trim(),
        status: String(cells[4].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        retailUrl: extLink && extLink.href ? extLink.href : null,
      });
    });
    const pagingRoot = findPagingNearTable(table);
    const pagingEl = pagingRoot ? pagingRoot.querySelector('p') : null;
    return {
      ok: true,
      headers,
      rows,
      pagingText: pagingEl
        ? String(pagingEl.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
        : null,
      pageUrl: typeof location !== 'undefined' ? location.href : '',
    };
  }

  function readPagingMeta(pagingRoot) {
    const root = pagingRoot || findPagingNearTable(findProductsTable());
    const el = root ? root.querySelector('p') : document.querySelector('.paging p');
    const raw = el
      ? String(el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
      : '';
    const m = raw.match(/\bpage\s+(\d+)\s+of\s+(\d+)\b/i);
    let current = m ? Number(m[1]) : null;
    let total = m ? Number(m[2]) : null;
    if (root && (total == null || Number.isNaN(total))) {
      const tsp = root.querySelector('.total-page-count');
      const tm = tsp && String(tsp.textContent || '').match(/(\d+)/);
      if (tm) total = Number(tm[1]);
    }
    if (current != null && Number.isNaN(current)) current = null;
    if (total != null && Number.isNaN(total)) total = null;
    return { raw, current, total };
  }

  function pickNextFromPagingRoot(root) {
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll('button.next')).filter(isUsableNextButton);
    if (buttons.length === 0) return null;
    const single = buttons.find((b) => String(b.textContent || '').trim() === '»');
    return single || buttons[0];
  }

  function findNextPageButton(pagingRoot) {
    const direct = pickNextFromPagingRoot(pagingRoot);
    if (direct) return direct;
    const pagings = document.querySelectorAll('.paging');
    for (let i = 0; i < pagings.length; i += 1) {
      const b = pickNextFromPagingRoot(pagings[i]);
      if (b) return b;
    }
    return null;
  }

  function triggerClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    try {
      el.focus();
    } catch (_) {}
    try {
      if (typeof el.click === 'function') el.click();
    } catch (_) {}
    try {
      el.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      );
    } catch (_) {}
  }

  function tableBarcodeSignature(table) {
    const parts = [];
    if (!table) return '';
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (!rowLooksLikeProduct(tr)) return;
      const cells = tr.querySelectorAll('td');
      const bc = String(cells[0].textContent || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (bc) parts.push(bc);
    });
    const joined = parts.join('|');
    return joined.length > 4000 ? joined.slice(0, 4000) : joined;
  }

  function tryJumpToPageNum(targetPage, pagingRoot) {
    const root = pagingRoot || document.querySelector('.paging');
    const jump = root
      ? root.querySelector('.jump-to-page')
      : document.querySelector('.paging .jump-to-page') || document.querySelector('.jump-to-page');
    if (!jump) return false;
    const inp = jump.querySelector('input[type="number"]');
    const go =
      jump.querySelector('button.go-to-page-button') ||
      (root && root.querySelector('button.go-to-page-button')) ||
      document.querySelector('.paging button.go-to-page-button');
    if (!inp || !go) return false;
    try {
      inp.focus();
    } catch (_) {}
    inp.value = String(targetPage);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    triggerClick(go);
    return true;
  }

  let table = null;
  while (Date.now() < globalDeadline) {
    table = findProductsTable();
    if (table && scoreProductRows(table) > 0) break;
    await sleep(350);
  }
  if (!table || scoreProductRows(table) === 0) {
    return { ok: false, error: 'Products table not found on this page.' };
  }

  const allRows = [];
  let headers = [];
  const pagePagingTexts = [];
  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx += 1) {
    table = findProductsTable();
    if (!table || scoreProductRows(table) === 0) {
      if (pageIdx === 0) {
        return { ok: false, error: 'Products table not found on this page.' };
      }
      break;
    }

    const extracted = extractFromTable(table);
    if (!extracted.ok) return extracted;
    if (pageIdx === 0) headers = extracted.headers;
    allRows.push(...extracted.rows);
    if (extracted.pagingText) pagePagingTexts.push(extracted.pagingText);

    const pagingRoot = findPagingNearTable(table);
    const metaAfter = readPagingMeta(pagingRoot);
    if (
      metaAfter.current != null &&
      metaAfter.total != null &&
      metaAfter.current >= metaAfter.total
    ) {
      break;
    }

    const nextBtn = findNextPageButton(pagingRoot);
    if (!nextBtn) break;

    const prevSig = tableBarcodeSignature(table);
    const prevPage = metaAfter.current;
    triggerClick(nextBtn);

    /**
     * Pager text ("page 2 of 2") often updates before tbody rows swap; do not treat meta alone as done.
     * Wait until product barcode signature changes, then re-read once so React has committed.
     */
    let navOk = false;
    while (Date.now() < globalDeadline) {
      await sleep(400);
      const t2 = findProductsTable();
      if (!t2 || scoreProductRows(t2) === 0) continue;
      const sig2 = tableBarcodeSignature(t2);
      if (!sig2 || sig2 === prevSig) continue;
      await sleep(180);
      const t3 = findProductsTable();
      if (!t3 || scoreProductRows(t3) === 0) continue;
      const sig3 = tableBarcodeSignature(t3);
      if (sig3 === sig2) {
        table = t3;
        navOk = true;
        break;
      }
    }

    if (!navOk && prevPage != null && metaAfter.total != null && prevPage < metaAfter.total) {
      tryJumpToPageNum(prevPage + 1, pagingRoot);
      while (Date.now() < globalDeadline) {
        await sleep(400);
        const t3 = findProductsTable();
        if (!t3 || scoreProductRows(t3) === 0) continue;
        const sig3 = tableBarcodeSignature(t3);
        if (!sig3 || sig3 === prevSig) continue;
        await sleep(180);
        const t4 = findProductsTable();
        if (!t4 || scoreProductRows(t4) === 0) continue;
        const sig4 = tableBarcodeSignature(t4);
        if (sig4 === sig3) {
          table = t4;
          navOk = true;
          break;
        }
      }
    }

    if (!navOk) break;
  }

  const pagingText =
    pagePagingTexts.length <= 1
      ? pagePagingTexts[0] || null
      : `${pagePagingTexts[0]} · ${pagePagingTexts.length} pages (${allRows.length} rows)`;

  return {
    ok: true,
    headers,
    rows: allRows,
    pagingText,
    pageUrl: typeof location !== 'undefined' ? location.href : '',
  };
}

/**
 * Web EPOS product `href`s are in-app routes (cold-open product URL → missing `storeId`).
 * Opens `/products` in a new tab in the app window (unfocused), runs list paging + real link click,
 * then focuses that tab only after the click succeeds. On failure the tab is closed.
 */
async function navigateWebEposProductInWorkerForBridge(appTabId, productHref, barcode) {
  const hrefRaw = String(productHref || '').trim();
  const code = String(barcode || '').trim();
  if (!hrefRaw) {
    return { ok: false, error: 'Missing product link.' };
  }
  let parsed;
  try {
    parsed = new URL(hrefRaw);
  } catch {
    return { ok: false, error: 'Invalid product link.' };
  }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
    return { ok: false, error: 'Link is not a Web EPOS URL.' };
  }

  let appTab;
  try {
    appTab = await chrome.tabs.get(appTabId);
  } catch {
    return { ok: false, error: 'Could not read the CG Suite tab.' };
  }
  const windowId = appTab.windowId;

  let navTabId = null;
  try {
    const created = await chrome.tabs.create({
      windowId,
      url: WEB_EPOS_PRODUCTS_URL,
      active: false,
    });
    navTabId = created.id;
    await waitForTabLoadComplete(navTabId, 90000, 'Web EPOS products page load timed out');
    const loaded = await chrome.tabs.get(navTabId);
    const u = String(loaded.url || '').trim();
    if (!u) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Could not read Web EPOS URL after load.' };
    }
    let loadParsed;
    try {
      loadParsed = new URL(u);
    } catch {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Invalid Web EPOS URL after load.' };
    }
    if (loadParsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Not on Web EPOS after load.' };
    }
    const loadPath = (loadParsed.pathname || '/').toLowerCase();
    if (WEB_EPOS_LOGIN_PATH.test(loadPath)) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'You must be logged into Web EPOS to open products.' };
    }
    await sleep(400);

    const injected = await chrome.scripting.executeScript({
      target: { tabId: navTabId },
      func: async (fullHref, barcodeText) => {
        const sleep = (t) => new Promise((r) => setTimeout(r, t));
        const MAX_PAGES = 200;

        function normPath(h) {
          try {
            const u = new URL(h, location.origin);
            return (u.pathname || '') + (u.search || '') + (u.hash || '');
          } catch {
            return String(h || '');
          }
        }

        const targetPath = normPath(fullHref);
        let targetAbs = '';
        try {
          targetAbs = new URL(fullHref).href;
        } catch (_) {}

        function tryClickFromDom() {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (let i = 0; i < anchors.length; i += 1) {
            const a = anchors[i];
            const raw = a.getAttribute('href') || '';
            if (!raw) continue;
            if (normPath(raw) === targetPath) {
              a.click();
              return true;
            }
            if (targetAbs && a.href === targetAbs) {
              a.click();
              return true;
            }
          }
          const want = String(barcodeText || '')
            .trim()
            .replace(/\s+/g, ' ');
          if (want) {
            const rows = document.querySelectorAll('tbody tr');
            for (let j = 0; j < rows.length; j += 1) {
              const tr = rows[j];
              const cell0 = tr.querySelector('td');
              if (!cell0) continue;
              const text = String(cell0.textContent || '')
                .trim()
                .replace(/\s+/g, ' ');
              if (text === want) {
                const link = cell0.querySelector('a');
                if (link) {
                  link.click();
                  return true;
                }
              }
            }
          }
          return false;
        }

        function isUsableNextButton(b) {
          if (!b) return false;
          if (b.disabled) return false;
          if (b.classList.contains('disabled')) return false;
          if (String(b.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
          return true;
        }

        function pickNextButton() {
          const buttons = Array.from(document.querySelectorAll('.paging button.next')).filter(
            isUsableNextButton
          );
          if (buttons.length === 0) return null;
          const single = buttons.find((b) => String(b.textContent || '').trim() === '»');
          return single || buttons[0];
        }

        async function jumpToProductsPageOne() {
          const jump =
            document.querySelector('.paging .jump-to-page') ||
            document.querySelector('.jump-to-page');
          const inp = jump && jump.querySelector('input[type="number"]');
          const go =
            (jump && jump.querySelector('button.go-to-page-button')) ||
            document.querySelector('.paging button.go-to-page-button');
          if (!inp || !go) return false;
          try {
            inp.focus();
          } catch (_) {}
          inp.value = '1';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          try {
            go.click();
          } catch (_) {}
          await sleep(650);
          return true;
        }

        await jumpToProductsPageOne();

        for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx += 1) {
          if (tryClickFromDom()) {
            return { ok: true, via: 'paged', pageIdx };
          }
          const nextBtn = pickNextButton();
          if (!nextBtn) break;
          nextBtn.click();
          await sleep(500);
        }

        return { ok: false, error: 'NOT_FOUND' };
      },
      args: [hrefRaw, code],
    });
    const res = injected && injected[0] ? injected[0].result : null;
    if (!res || !res.ok) {
      if (navTabId != null) {
        await chrome.tabs.remove(navTabId).catch(() => {});
        navTabId = null;
      }
      return {
        ok: false,
        error:
          res && res.error === 'NOT_FOUND'
            ? 'That product was not found in the Web EPOS list (try again after the table has fully loaded).'
            : (res && res.error) || 'Could not open the product in Web EPOS.',
      };
    }

    const t = await chrome.tabs.get(navTabId);
    if (t.windowId != null) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(navTabId, { active: true }).catch(() => {});
    return { ok: true };
  } catch (e) {
    if (navTabId != null) {
      await chrome.tabs.remove(navTabId).catch(() => {});
    }
    return {
      ok: false,
      error: e && e.message ? String(e.message) : 'Could not open Web EPOS.',
    };
  }
}

async function scrapeWebEposProductsAndRespond(requestId, appTabId) {
  const respondErr = async (msg) => {
    if (!appTabId) return;
    chrome.tabs
      .sendMessage(appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        error: msg,
      })
      .catch(() => {});
    await focusAppTab(appTabId);
  };

  try {
    const session = await readWebEposUploadSession();
    if (
      !session?.workerTabId ||
      Number(session.appTabId) !== Number(appTabId)
    ) {
      await respondErr(
        'No Web EPOS window for this session. Open the Upload module and wait for Web EPOS to load.'
      );
      return;
    }
    let tabId = session.workerTabId;
    try {
      await chrome.tabs.get(tabId);
    } catch {
      await respondErr(
        'The Web EPOS window was closed. Reopen it from the launchpad prompt.'
      );
      return;
    }
    await chrome.tabs.update(tabId, { url: WEB_EPOS_PRODUCTS_URL });
    await waitForTabLoadComplete(tabId, 90000, 'Web EPOS products page load timed out');
    const tab = await chrome.tabs.get(tabId);
    const u = (tab.url || '').trim();
    if (!u) {
      await respondErr('Could not read Web EPOS URL.');
      return;
    }
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      await respondErr('Invalid Web EPOS URL.');
      return;
    }
    if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
      await respondErr('Not on Web EPOS.');
      return;
    }
    const path = (parsed.pathname || '/').toLowerCase();
    if (WEB_EPOS_LOGIN_PATH.test(path)) {
      await respondErr('You must be logged into Web EPOS to view products.');
      return;
    }
    await sleep(400);
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrapeWebEposProductsTableInPageWithWait,
      args: [120000],
    });
    const payload = injected && injected[0] ? injected[0].result : null;
    if (!payload || !payload.ok) {
      await respondErr(payload?.error || 'Could not read products from Web EPOS.');
      return;
    }
    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: true,
      headers: payload.headers,
      rows: payload.rows,
      pagingText: payload.pagingText,
      pageUrl: payload.pageUrl,
    });
    try {
      const s2 = await readWebEposUploadSession();
      const lastUrl = payload.pageUrl || s2?.lastUrl || WEB_EPOS_PRODUCTS_URL;
      if (s2 && Number(s2.appTabId) === Number(appTabId)) {
        await writeWebEposUploadSession({
          workerTabId: null,
          appTabId,
          lastUrl,
        });
      }
      await removeWebEposWorkerByTabId(tabId);
    } catch (_) {}
  } catch (e) {
    await respondErr(e?.message || 'Failed to load Web EPOS products.');
  }
}

function sanitizeWebEposProductCreateSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const allowed = [
    'title',
    'price',
    'costPrice',
    'wasPrice',
    'quantity',
    'condition',
    'grade',
    'barcode',
    'gtin',
    'intro',
    'fulfilmentOption',
    'storeId',
    'categoryLevelUuids',
    'categoryPathLabels',
  ];
  const o = {};
  for (const k of allowed) {
    if (raw[k] == null) continue;
    if (k === 'categoryLevelUuids' || k === 'categoryPathLabels') {
      if (Array.isArray(raw[k])) {
        o[k] = raw[k]
          .map((x) => String(x ?? '').trim())
          .filter(Boolean);
      }
    } else {
      o[k] = raw[k];
    }
  }
  return Object.keys(o).length ? o : null;
}

/** Validates URL after load; throws if still on /login. Caller should close the worker tab when catching. */
async function webEposAssertNewProductPageNotLogin(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const u = (tab.url || '').trim();
  if (!u) {
    throw new Error('Could not read Web EPOS URL.');
  }
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error('Invalid Web EPOS URL.');
  }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
    throw new Error('Not on Web EPOS.');
  }
  const path = (parsed.pathname || '/').toLowerCase();
  if (WEB_EPOS_LOGIN_PATH.test(path)) {
    throw new Error('You must be logged into Web EPOS to view products.');
  }
  return u;
}

async function injectWebEposEnsureOnSaleOff(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['bg/webepos-new-product-fill-page.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const fn = window.__CG_WEB_EPOS_ENSURE_ON_SALE_OFF;
      if (typeof fn === 'function') return fn();
    },
  });
}

async function injectWebEposNewProductFill(tabId, spec) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['bg/webepos-new-product-fill-page.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [spec],
    func: (s) => {
      const run = window.__CG_WEB_EPOS_FILL_RUN;
      if (typeof run === 'function') return run(s);
      return undefined;
    },
  });
  await sleep(400);
}

async function injectWebEposNewProductFinishSave(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['bg/webepos-new-product-fill-page.js'],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const fn = window.__CG_WEB_EPOS_FINISH_NEW_PRODUCT;
      if (typeof fn !== 'function') {
        return Promise.reject(new Error('Web EPOS finish helper not available'));
      }
      return fn();
    },
  });
  const inj = results && results[0];
  if (inj?.error) {
    throw new Error(inj.error.message || String(inj.error));
  }
  await sleep(300);
}

/**
 * Upload proceed: open `/products/new` in one minimised tab, fill each item in sequence, turn Off Sale
 * off, click Save Product, wait for redirect, then move to the next row. Progress mirrors repricing
 * (`broadcastRepricingStatus`) when `uploadProgressCartKey` is set.
 */
async function openWebEposProductCreateMinimizedAndRespond(requestId, appTabId, createListRaw, uploadProgressCartKey) {
  const respondErr = async (msg) => {
    if (!appTabId) return;
    chrome.tabs
      .sendMessage(appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        error: msg,
      })
      .catch(() => {});
    await focusAppTab(appTabId);
  };

  const rawList = Array.isArray(createListRaw) ? createListRaw : [];
  const createList = rawList
    .map(sanitizeWebEposProductCreateSpec)
    .filter(Boolean)
    .slice(0, 20);

  const cartKey = String(uploadProgressCartKey || '').trim();
  let progressData = {
    cartKey,
    done: false,
    repricingData: [],
    completedBarcodes: {},
    completedItems: [],
    logs: [],
    step: 'webEposUpload',
    message: '',
  };

  let webEposWorkerTabId = null;
  /** When set, we opened this window only for Web EPOS upload — remove the whole window so extra tabs (e.g. after save) do not leave a minimised shell. */
  let webEposDedicatedWindowId = null;
  const closeWebEposWorkerTab = async () => {
    const wid = webEposDedicatedWindowId;
    const tid = webEposWorkerTabId;
    webEposDedicatedWindowId = null;
    webEposWorkerTabId = null;
    if (wid != null) {
      await chrome.windows.remove(wid).catch(() => {});
      return;
    }
    if (tid != null) {
      await removeWebEposWorkerByTabId(tid);
    }
  };

  try {
    if (createList.length === 0) {
      try {
        const opened = await openBackgroundNosposTab(WEB_EPOS_PRODUCT_NEW_URL, appTabId);
        webEposWorkerTabId = opened?.tabId ?? null;
        webEposDedicatedWindowId =
          opened?.dedicatedWindow && opened?.windowId != null ? opened.windowId : null;
        if (webEposWorkerTabId == null) {
          await respondErr('Could not open Web EPOS.');
          return;
        }
        await waitForTabLoadComplete(webEposWorkerTabId, 90000, 'Web EPOS new product page load timed out');
        const u = await webEposAssertNewProductPageNotLogin(webEposWorkerTabId);
        await notifyAppExtensionResponse(appTabId, requestId, { ok: true, url: u, tabsFilled: 0 });
        await closeWebEposWorkerTab();
        if (appTabId) await focusAppTab(appTabId);
      } catch (e) {
        await closeWebEposWorkerTab();
        await respondErr(e?.message || 'Failed to open Web EPOS new product page.');
        if (appTabId) await focusAppTab(appTabId);
      }
      return;
    }

    const emitProgress = async (patch) => {
      if (!cartKey || !appTabId) return;
      const { logMessage, ...dataPatch } = patch;
      progressData = { ...progressData, ...dataPatch };
      progressData = appendRepricingLog(
        progressData,
        logMessage != null ? String(logMessage) : String(patch.message || '').trim() || '…'
      );
      await broadcastRepricingStatus(appTabId, progressData, {
        ...dataPatch,
        logs: progressData.logs,
        totalBarcodes: createList.length,
      });
    };

    if (cartKey && appTabId) {
      progressData = appendRepricingLog(
        progressData,
        `Starting Web EPOS upload (${createList.length} item${createList.length === 1 ? '' : 's'}).`
      );
      await broadcastRepricingStatus(appTabId, progressData, {
        running: true,
        done: false,
        message: 'Opening Web EPOS',
        currentBarcode: createList[0]?.barcode || '',
        currentItemTitle: createList[0]?.title || '',
        completedBarcodeCount: 0,
        totalBarcodes: createList.length,
        logs: progressData.logs,
      });
    }

    try {
      const opened = await openBackgroundNosposTab(WEB_EPOS_PRODUCT_NEW_URL, appTabId);
      webEposWorkerTabId = opened?.tabId ?? null;
      webEposDedicatedWindowId =
        opened?.dedicatedWindow && opened?.windowId != null ? opened.windowId : null;
      if (webEposWorkerTabId == null) throw new Error('Could not open Web EPOS.');
    } catch (e) {
      await closeWebEposWorkerTab();
      await respondErr(e?.message || 'Could not open Web EPOS.');
      if (cartKey && appTabId) {
        progressData = appendRepricingLog(progressData, e?.message || 'Could not open Web EPOS.');
        await broadcastRepricingStatus(appTabId, progressData, {
          running: false,
          done: true,
          message: 'Web EPOS upload failed',
          completedBarcodeCount: 0,
          totalBarcodes: createList.length,
          logs: progressData.logs,
        });
      }
      return;
    }

    let lastUrl = WEB_EPOS_PRODUCT_NEW_URL;
    for (let i = 0; i < createList.length; i++) {
      const spec = createList[i];
      try {
        if (i > 0) {
          await chrome.tabs.update(webEposWorkerTabId, { url: WEB_EPOS_PRODUCT_NEW_URL });
          await waitForTabLoadComplete(webEposWorkerTabId, 90000, 'Web EPOS new product page load timed out');
        } else {
          await waitForTabLoadComplete(webEposWorkerTabId, 90000, 'Web EPOS new product page load timed out');
        }
        lastUrl = await webEposAssertNewProductPageNotLogin(webEposWorkerTabId);

        if (cartKey && appTabId) {
          await emitProgress({
            running: true,
            done: false,
            message: `Ticking off On Sale — product ${i + 1} of ${createList.length}`,
            currentBarcode: spec.barcode || '',
            currentItemTitle: spec.title || '',
            completedBarcodeCount: i,
            logMessage: `Item ${i + 1}/${createList.length}: ensuring On Sale is off (${spec.title || 'Product'}).`,
          });
        }

        await injectWebEposEnsureOnSaleOff(webEposWorkerTabId);

        if (cartKey && appTabId) {
          await emitProgress({
            message: `Filling item info — product ${i + 1} of ${createList.length}`,
            logMessage: `Item ${i + 1}/${createList.length}: On Sale ticked off, now filling item info.`,
          });
        }

        await injectWebEposNewProductFill(webEposWorkerTabId, spec);

        if (cartKey && appTabId) {
          await emitProgress({
            message: `Saving product ${i + 1} of ${createList.length}…`,
            logMessage: `Item ${i + 1}/${createList.length}: item info filled, clicking Save Product.`,
          });
        }

        await injectWebEposNewProductFinishSave(webEposWorkerTabId);
        const tab = await chrome.tabs.get(webEposWorkerTabId);
        lastUrl = (tab.url || '').trim() || lastUrl;

        if (cartKey && appTabId) {
          await emitProgress({
            message: `Saved product ${i + 1} of ${createList.length} ✓`,
            completedBarcodeCount: i + 1,
            logMessage: `Item ${i + 1}/${createList.length}: saved successfully (${spec.barcode || 'no barcode'}).`,
          });
        }
      } catch (e) {
        const errMsg = e?.message || 'Failed to open, fill, or save Web EPOS product.';
        await closeWebEposWorkerTab();
        await respondErr(errMsg);
        if (cartKey && appTabId) {
          progressData = appendRepricingLog(progressData, `Error on item ${i + 1}: ${errMsg}`);
          await broadcastRepricingStatus(appTabId, progressData, {
            running: false,
            done: true,
            message: 'Web EPOS upload stopped due to an error',
            completedBarcodeCount: i,
            totalBarcodes: createList.length,
            logs: progressData.logs,
          });
        }
        return;
      }
    }

    if (cartKey && appTabId) {
      progressData = appendRepricingLog(progressData, 'Web EPOS upload finished for all items.');
      await broadcastRepricingStatus(appTabId, progressData, {
        running: false,
        done: true,
        message: 'Web EPOS upload complete',
        completedBarcodeCount: createList.length,
        totalBarcodes: createList.length,
        logs: progressData.logs,
      });
    }

    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: true,
      url: lastUrl,
      tabsFilled: createList.length,
    });
    await closeWebEposWorkerTab();
    if (appTabId) {
      await focusAppTab(appTabId);
    }
  } catch (e) {
    await closeWebEposWorkerTab();
    await respondErr(e?.message || 'Failed to open Web EPOS new product page.');
    if (cartKey && appTabId) {
      progressData = appendRepricingLog(progressData, e?.message || 'Unexpected error');
      await broadcastRepricingStatus(appTabId, progressData, {
        running: false,
        done: true,
        message: 'Web EPOS upload failed',
        totalBarcodes: createList.length,
        completedBarcodeCount: 0,
        logs: progressData.logs,
      });
    }
  }
}

/**
 * After opening Web EPOS for upload: fail fast if the site lands on /login (not logged in),
 * otherwise resolve the bridge promise so the app can continue. Product-create upload closes the tab when finished.
 */
function watchWebEposUploadTab(webeposTabId, requestId, entry) {
  let resolved = false;
  let settleTimer = null;
  let timeoutId = null;

  function cleanupWatchListeners() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    chrome.tabs.onUpdated.removeListener(onUpdated);
    webEposUploadWatchAbortByTabId.delete(webeposTabId);
  }

  webEposUploadWatchAbortByTabId.set(webeposTabId, () => {
    if (resolved) return;
    resolved = true;
    cleanupWatchListeners();
  });

  async function fail(err) {
    if (resolved) return;
    resolved = true;
    cleanupWatchListeners();
    await clearPendingRequest(requestId);
    const msg = err || 'Web EPOS did not load.';
    if (entry.appTabId != null) {
      chrome.tabs
        .sendMessage(entry.appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId,
          error: msg,
        })
        .catch(() => {});
      await focusAppTab(entry.appTabId);
    }
    try {
      const session = await readWebEposUploadSession();
      if (session && Number(session.workerTabId) === Number(webeposTabId)) {
        await writeWebEposUploadSession({ ...session, workerTabId: null });
        await removeWebEposWorkerByTabId(webeposTabId);
      }
      await clearWebEposUploadSession();
    } catch (_) {}
  }

  async function ok(finalUrl) {
    if (resolved) return;
    resolved = true;
    cleanupWatchListeners();
    await clearPendingRequest(requestId);
    const lastUrl = finalUrl || WEB_EPOS_PRODUCTS_URL;
    await writeWebEposUploadSession({
      workerTabId: webeposTabId,
      appTabId: entry.appTabId,
      lastUrl,
    });
    if (entry.appTabId != null) {
      await notifyAppExtensionResponse(entry.appTabId, requestId, { ok: true, url: lastUrl });
    }
  }

  function scheduleSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(async () => {
      settleTimer = null;
      if (resolved) return;
      try {
        const t = await chrome.tabs.get(webeposTabId);
        const c = classifyWebEposUrl(t.url || '');
        if (c === 'login') {
          await fail('You must be logged into Web EPOS to continue.');
          return;
        }
        if (c !== 'wait' && c.kind === 'ready') await ok(c.url);
      } catch (e) {
        await fail(e?.message || 'Web EPOS check failed.');
      }
    }, 600);
  }

  async function onUpdated(id, info) {
    if (id !== webeposTabId || resolved) return;
    if (info.status !== 'complete') return;
    try {
      const t = await chrome.tabs.get(webeposTabId);
      const c = classifyWebEposUrl(t.url || '');
      if (c === 'login') {
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        await fail('You must be logged into Web EPOS to continue.');
        return;
      }
      if (c !== 'wait' && c.kind === 'ready') scheduleSettle();
    } catch (e) {
      await fail(e?.message || 'Web EPOS check failed.');
    }
  }

  timeoutId = setTimeout(() => {
    void fail('Timed out waiting for Web EPOS to load.');
  }, 60000);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs
    .get(webeposTabId)
    .then((t) => {
      if (resolved) return;
      if (t.status === 'complete' && t.url) {
        void onUpdated(webeposTabId, { status: 'complete' });
      }
    })
    .catch(() => {});
}

// focusAppTab, waitForTabLoadComplete — imported from bg/tab-utils.js

importScripts('tasks/jewellery-scrap-prices-tab.js');

// ── CeX nav scrape (super-categories) — see cex-scrape/ in repo ──────────────

importScripts('tasks/nospos-stock-category-pagination.js');

/**
 * Shared tail for Data-page imports: clear pending, run `work(tabId)` after NOSPOS_PAGE_READY,
 * then post `{ response }` or `{ error }` to the app tab (same contract as category import).
 */
async function runNosposDataImportAfterLogin({ tabId, requestId, entry, failureMessageDefault, work }) {
  const pending = await getPending();
  delete pending[requestId];
  await setPending(pending);
  try {
    const response = await work(tabId);
    if (entry.appTabId != null) {
      chrome.tabs
        .sendMessage(entry.appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId,
          response,
        })
        .catch(() => {});
      await focusAppTab(entry.appTabId);
    }
  } catch (e) {
    const msg = e?.message || failureMessageDefault || 'NoSpos import failed.';
    console.error('[CG Suite] runNosposDataImportAfterLogin', { requestId, error: msg });
    if (entry.appTabId != null) {
      chrome.tabs
        .sendMessage(entry.appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId,
          error: msg,
        })
        .catch(() => {});
      await focusAppTab(entry.appTabId);
    }
  } finally {
    if (tabId != null) {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

async function notifyAppExtensionResponse(appTabId, requestId, response) {
  if (!appTabId) return;
  await focusAppTab(appTabId);
  await chrome.tabs.sendMessage(appTabId, {
    type: 'EXTENSION_RESPONSE_TO_PAGE',
    requestId,
    response,
  }).catch(() => {});
}

async function clearPendingRequest(requestId) {
  const pending = await getPending();
  if (pending[requestId]) {
    delete pending[requestId];
    await setPending(pending);
  }
}

/**
 * Opens uk.webuy.com, reads ul.nav-menu super-category links via cex-scrape content script,
 * posts results to the app tab. Deferred promise (content-bridge does not resolve early).
 */
async function executeCexSuperCategoryNavScrape(requestId, appTabId) {
  const CEX_HOME = 'https://uk.webuy.com/';
  let scrapeTabId = null;
  try {
    const tab = await chrome.tabs.create({ url: CEX_HOME, active: true });
    scrapeTabId = tab.id;
    await putTabInYellowGroup(scrapeTabId);

    const pending = await getPending();
    pending[requestId] = {
      appTabId,
      listingTabId: scrapeTabId,
      type: 'cexNavScrape',
    };
    await setPending(pending);

    await waitForTabLoadComplete(scrapeTabId, 90000);

    const maxAttempts = 32;
    let lastCode = 'NOT_TRIED';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
      try {
        const resp = await chrome.tabs.sendMessage(scrapeTabId, {
          type: 'CEX_SCRAPE_SUPER_CATEGORIES',
        });
        if (resp && resp.ok && Array.isArray(resp.categories) && resp.categories.length > 0) {
          await clearPendingRequest(requestId);
          await notifyAppExtensionResponse(appTabId, requestId, {
            success: true,
            categories: resp.categories,
            scrapedAt: resp.scrapedAt,
            sourceTabUrl: resp.sourceUrl,
            warnings: resp.warnings,
          });
          return;
        }
        lastCode = (resp && resp.code) || 'EMPTY_OR_NOT_READY';
      } catch (e) {
        lastCode = (e && e.message) || 'SEND_MESSAGE_FAILED';
      }
    }

    await clearPendingRequest(requestId);
    await notifyAppExtensionResponse(appTabId, requestId, {
      success: false,
      error:
        'Could not read CeX super-categories after ' +
        maxAttempts +
        ' attempts (' +
        lastCode +
        '). The site may still be loading or the header layout changed.',
    });
  } catch (e) {
    await clearPendingRequest(requestId);
    await notifyAppExtensionResponse(appTabId, requestId, {
      success: false,
      error: (e && e.message) || 'CeX scrape failed',
    });
  }
}

async function sendRepricingComplete(appTabId, payload) {
  if (!appTabId) return;
  await chrome.tabs.sendMessage(appTabId, {
    type: 'REPRICING_COMPLETE_TO_PAGE',
    payload
  }).catch(() => {});
}

// NosPos HTML parsers, address lookup — imported from bg/nospos-html.js

// ── Message router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === CG_JEWELLERY_SCRAP.MSG_SCRAPED) {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return true;
    }
    forwardJewelleryScrapPricesToApp(tabId, message.payload)
      .catch((e) => console.warn('[CG Suite] Jewellery scrap forward to app:', e?.message))
      .finally(async () => {
        await unregisterJewelleryScrapWorkerTab(tabId);
        await chrome.tabs.remove(tabId).catch(() => {});
        sendResponse({ ok: true });
      });
    return true;
  }

  if (message.type === 'BRIDGE_FORWARD') {
    handleBridgeForward(message, sender)
      .then((r) => sendResponse(r))
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e?.message || String(e) || 'Extension bridge handler failed',
        })
      );
    return true;
  }

  if (message.type === 'CG_APP_PAGE_UNLOADING') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      void closeWebEposUploadSessionForAppTab(tabId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'LISTING_PAGE_READY') {
    handleListingPageReady(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'SCRAPED_DATA') {
    handleScrapedData(message)
      .then(r => sendResponse(r))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_PAGE_READY') {
    handleNosposPageReady(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_STOCK_SEARCH_READY') {
    handleNosposStockSearchReady(message, sender)
      .then((r) => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_STOCK_EDIT_READY') {
    handleNosposStockEditReady(message, sender)
      .then((r) => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_PAGE_LOADED') {
    handleNosposPageLoaded(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'PARK_LOG_ENTRY') {
    logPark(
      message.fn || 'content-nospos-agreement-fill',
      message.phase || 'step',
      message.data || {},
      message.msg || ''
    );
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'NOSPOS_LOGIN_REQUIRED') {
    handleNosposLoginRequired(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_SEARCH_READY') {
    handleNosposCustomerSearchReady(message, sender)
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_DETAIL_READY') {
    handleNosposCustomerDetailReady(message, sender)
      .then(r => sendResponse(r || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'NOSPOS_CUSTOMER_DONE') {
    handleNosposCustomerDone(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'FETCH_ADDRESS_SUGGESTIONS') {
    handleFetchAddressSuggestions(message)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'Failed' }));
    return true;
  }

  if (message.type === 'NOSPOS_PARK_UI_SYNC') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ show: false });
      return true;
    }
    chrome.storage.session
      .get(NOSPOS_PARK_UI_STORAGE_KEY)
      .then((data) => {
        const lock = data[NOSPOS_PARK_UI_STORAGE_KEY];
        const show = !!(lock && lock.active && lock.tabId === tabId);
        const duplicatePrompt =
          show && lock.duplicatePromptRequestId
            ? {
                requestId: lock.duplicatePromptRequestId,
                agreementId: lock.duplicatePromptAgreementId ?? null,
              }
            : null;
        sendResponse({
          show,
          message: lock?.message || NOSPOS_PARK_OVERLAY_DEFAULT_MSG,
          duplicatePrompt,
        });
      })
      .catch(() => sendResponse({ show: false }));
    return true;
  }

  if (message.type === 'NOSPOS_PARK_DUPLICATE_CHOICE') {
    const tabId = sender.tab?.id;
    const requestId = message.requestId;
    const choice = message.choice;
    if (
      tabId != null &&
      requestId &&
      (choice === 'delete' || choice === 'cancel')
    ) {
      resolveNosposDuplicateUserChoice(requestId, tabId, choice);
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

// NOSPOS_HTML_FETCH_HEADERS, nosposHtmlFetchIndicatesNotLoggedIn — imported from bg/nospos-html.js

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleBridgeForward(message, sender) {
  const { requestId, payload } = message;
  const appTabId = sender.tab?.id;

  // User clicked "Add from CeX" (or eBay / Cash Converters). Open the competitor site and store pending so we can later send WAITING_FOR_DATA to the tab when it's on a listing/product page.
  if (payload.action === 'startWaitingForData' && appTabId != null) {
    const competitor = payload.competitor || 'eBay';
    const searchQuery = (payload.searchQuery || '').trim();
    const marketComparisonContext = payload.marketComparisonContext || null;

    let url;
    if (competitor === 'CashConverters') {
      url = searchQuery
        ? `https://www.cashconverters.co.uk/search-results?Sort=default&page=1&query=${encodeURIComponent(searchQuery)}`
        : 'https://www.cashconverters.co.uk/';
    } else if (competitor === 'CashGenerator') {
      url = searchQuery
        ? `https://cashgenerator.co.uk/pages/search-results-page?q=${encodeURIComponent(searchQuery)}`
        : 'https://cashgenerator.co.uk/';
    } else if (competitor === 'CeX') {
      // With a header search term: CeX site search. Without: homepage (unchanged).
      url = searchQuery
        ? `https://uk.webuy.com/search?stext=${encodeURIComponent(searchQuery)}`
        : 'https://uk.webuy.com/';
    } else {
      // Always enforce: Completed items (LH_Complete=1), Sold items (LH_Sold=1), UK Only (LH_PrefLoc=1)
      url = searchQuery
        ? `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Complete=1&LH_Sold=1&LH_PrefLoc=1`
        : 'https://www.ebay.co.uk/';
    }

    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: newTab.id, competitor, marketComparisonContext };
    await setPending(pending);

    console.log('[CG Suite] startWaitingForData saved – only this tab can complete the flow; closing it will notify the app', { requestId, competitor, listingTabId: newTab.id, appTabId });
    return { ok: true };
  }

  if (payload.action === 'scrapeCexSuperCategories' && appTabId != null) {
    void executeCexSuperCategoryNavScrape(requestId, appTabId);
    return { ok: true };
  }

  if (payload.action === 'cancelRequest' && appTabId != null) {
    // User clicked Cancel/Reset in the app while a listing tab was open.
    // Find the pending entry for this app tab, close the listing tab, and
    // send a clean cancelled response so the app's awaiting promise resolves.
    // Skip openNospos entries – we never close the NoSpos tab (user needs it to log in).
    const pending = await getPending();
    for (const [reqId, entry] of Object.entries(pending)) {
      if (
        entry.appTabId === appTabId &&
        entry.type !== 'openNospos' &&
        entry.type !== 'openNosposCustomerIntake' &&
        entry.type !== 'openNosposCustomerIntakeWaiting' &&
        entry.type !== 'openNosposSiteOnly' &&
        entry.type !== 'openNosposSiteForFields' &&
        entry.type !== 'openNosposSiteForCategoryFields' &&
        entry.type !== 'openNosposSiteForCategoryFieldsBulk'
      ) {
        const listingTabId = entry.listingTabId;
        delete pending[reqId];
        await setPending(pending);
        if (listingTabId != null) {
          await chrome.tabs.remove(listingTabId).catch(() => {});
        }
        chrome.tabs.sendMessage(appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId: reqId,
          response: { success: false, cancelled: true }
        }).catch(() => {});
        break;
      }
    }
    return { ok: true };
  }

  // Search NosPos stock by barcode in the background (no tab switch).
  // Fetches the stock search results page directly and parses the results table.
  if (payload.action === 'searchNosposBarcode') {
    const barcode = (payload.barcode || '').trim();
    if (!barcode) return { ok: false, error: 'No barcode provided' };
    try {
      const searchUrl = `https://nospos.com/stock/search/index?StockSearchAndFilter[query]=${encodeURIComponent(barcode)}&sort=-quantity`;
      const response = await fetch(searchUrl, {
        credentials: 'include',
        headers: NOSPOS_HTML_FETCH_HEADERS,
      });
      const finalUrl = response.url || '';
      if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
        return { ok: false, loginRequired: true };
      }
      const html = await response.text();
      const isDirectStockEditHit = /^https:\/\/[^/]*nospos\.com\/stock\/\d+\/edit\/?(\?.*)?$/i.test(finalUrl);
      const results = isDirectStockEditHit
        ? parseNosposStockEditResult(html, finalUrl)
        : parseNosposSearchResults(html);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message || 'Search failed' };
    }
  }

  /** Upload workspace: open stock edit in a minimised NosPos window, fetch HTML, parse details, close tab. */
  if (payload.action === 'scrapeNosposStockEditForUpload') {
    const stockUrl = String(payload.stockUrl || '').trim();
    if (!stockUrl) return { ok: false, error: 'No stock URL' };
    const editUrl = normalizeNosposStockEditUrl(stockUrl);
    if (!editUrl) return { ok: false, error: 'Invalid stock URL' };
    let opened = null;
    try {
      if (appTabId != null) {
        opened = await openBackgroundNosposTab(editUrl, appTabId);
      }
      const response = await fetch(editUrl, {
        credentials: 'include',
        headers: NOSPOS_HTML_FETCH_HEADERS,
      });
      const finalUrl = response.url || '';
      const html = await response.text();
      if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
        return { ok: false, loginRequired: true };
      }
      const details = parseNosposStockEditPageDetails(html);
      return { ok: true, details };
    } catch (e) {
      return { ok: false, error: e?.message || 'Scrape failed' };
    } finally {
      if (opened?.tabId != null) {
        await chrome.tabs.remove(opened.tabId).catch(() => {});
      }
      if (appTabId != null) {
        await focusAppTab(appTabId).catch(() => {});
      }
    }
  }

  async function nosposCancelResponseBody(response) {
    try {
      await response.body?.cancel?.();
    } catch (_) {
      /* ignore */
    }
  }

  async function nosposFetchCustomerBuyingSession(customerId, sessionCheckMs = 12000) {
    const id = parseInt(String(customerId ?? '').trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, error: 'Invalid NosPos customer id' };
    }
    const buyingPageUrl = `https://nospos.com/customer/${id}/buying`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), sessionCheckMs);
      let response;
      try {
        response = await fetch(buyingPageUrl, {
          credentials: 'include',
          headers: NOSPOS_HTML_FETCH_HEADERS,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const finalUrl = response.url || '';
      await nosposCancelResponseBody(response);
      if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
        return { ok: false, loginRequired: true };
      }
      return { ok: true, customerId: id };
    } catch (e) {
      const isAbort = e?.name === 'AbortError';
      return {
        ok: false,
        error: isAbort
          ? 'NoSpos did not respond in time. Check your connection, sign in at nospos.com in Chrome, and try again.'
          : e?.message || 'Could not verify NoSpos session',
      };
    }
  }

  /**
   * Fetch https://nospos.com/buying and extract every agreement ID shown in the table
   * (via data-key attributes on <tr> rows). Returns { ok, ids } where ids is an array
   * of numeric strings. Used before creating a new agreement to detect duplicate drafts.
   */
  async function fetchNosposBuyingAgreementIds(fetchTimeoutMs = 15000) {
    const buyingUrl = 'https://nospos.com/buying';
    logPark('fetchNosposBuyingAgreementIds', 'enter', { buyingUrl }, 'Fetching buying hub to collect pre-existing agreement IDs');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
      let response;
      try {
        response = await fetch(buyingUrl, {
          credentials: 'include',
          headers: NOSPOS_HTML_FETCH_HEADERS,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const finalUrl = response.url || '';
      if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
        logPark('fetchNosposBuyingAgreementIds', 'error', { finalUrl }, 'Not logged in to NosPos — cannot read buying list');
        return { ok: false, loginRequired: true, ids: [] };
      }
      const html = await response.text();
      // Extract all data-key="<id>" attributes from <tr> elements in the buying table.
      // Service workers don't have DOMParser, so we use a regex.
      const ids = [];
      const re = /<tr[^>]+\bdata-key="(\d+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        ids.push(m[1]);
      }
      logPark('fetchNosposBuyingAgreementIds', 'exit', { count: ids.length, ids }, `Found ${ids.length} pre-existing agreement IDs on buying hub`);
      return { ok: true, ids };
    } catch (e) {
      const isAbort = e?.name === 'AbortError';
      logPark('fetchNosposBuyingAgreementIds', 'error', { error: e?.message, isAbort }, 'Failed to fetch buying hub');
      return {
        ok: false,
        error: isAbort ? 'Timed out fetching nospos.com/buying' : (e?.message || 'Could not fetch buying hub'),
        ids: [],
      };
    }
  }

  /**
   * Duplicate-draft recovery:
   * 1) Navigate to /newagreement/{id}/items for the duplicate.
   * 2) On items page: Actions -> Delete Agreement -> confirm OK.
   * 3) Wait for NosPos to redirect back to nospos.com/buying.
   */
  async function deleteNosposBuyingAgreementByIdViaUi(tabId, agreementId) {
    const id = String(agreementId || '').trim();
    if (!id || !/^\d+$/.test(id)) {
      logPark('deleteNosposBuyingAgreementByIdViaUi', 'error', { tabId, agreementId }, 'Invalid agreement id for delete');
      return { ok: false, error: 'Invalid agreement id for delete' };
    }
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'enter', { tabId, agreementId: id }, `Starting delete of duplicate agreement #${id}`);

    // Step 1: Navigate directly to the items page of the duplicate.
    const duplicateItemsUrl = `https://nospos.com/newagreement/${id}/items`;
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { duplicateItemsUrl }, 'Navigating to duplicate agreement items page');
    try {
      await chrome.tabs.update(tabId, { url: duplicateItemsUrl });
    } catch (e) {
      logPark('deleteNosposBuyingAgreementByIdViaUi', 'error', { error: e?.message }, 'Could not navigate to duplicate items page');
      return { ok: false, error: e?.message || 'Could not navigate to duplicate agreement items page' };
    }

    // Step 2: Wait for items page to finish loading.
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { tabId }, 'Waiting for duplicate items page to load');
    const waitItems = await waitForNosposNewAgreementItemsTabUrl(tabId, 35000);
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { waitItems }, waitItems?.ok ? 'Duplicate items page loaded' : 'Duplicate items page failed to load');
    if (!waitItems?.ok) {
      return { ok: false, error: waitItems?.error || 'Duplicate agreement items page did not load in time' };
    }

    // Step 3: Inject script — Actions → Delete Agreement → confirm OK.
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { tabId, url: waitItems.url }, 'Injecting delete script: Actions → Delete Agreement → confirm OK');
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (agreementIdInPage, actionDelayMs) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const aid = String(agreementIdInPage || '').trim();
        const deleteSelector = `a[href*="/newagreement/${aid}/delete"]`;

        const cardCandidates = Array.from(document.querySelectorAll('.card'));
        let agreementCard = null;
        for (let i = 0; i < cardCandidates.length; i += 1) {
          const card = cardCandidates[i];
          const titleEl = card.querySelector('.card-title');
          const t = String(titleEl ? titleEl.textContent : '').toLowerCase();
          if (t.includes('agreement') && !t.includes('item')) {
            agreementCard = card;
            break;
          }
        }
        if (!agreementCard) agreementCard = document.querySelector('.card');
        if (!agreementCard) {
          return { ok: false, error: 'Agreement card not found on duplicate items page' };
        }

        const toggle =
          agreementCard.querySelector('a.dropdown-toggle[data-toggle="dropdown"]') ||
          agreementCard.querySelector('a.dropdown-toggle[data-bs-toggle="dropdown"]') ||
          agreementCard.querySelector('.dropdown-toggle');
        if (toggle && typeof toggle.click === 'function') {
          toggle.click();
          await sleep(280);
        }

        let deleteLink = agreementCard.querySelector(deleteSelector) || document.querySelector(deleteSelector);
        if (!deleteLink && toggle && typeof toggle.click === 'function') {
          toggle.click();
          await sleep(280);
          deleteLink = agreementCard.querySelector(deleteSelector) || document.querySelector(deleteSelector);
        }
        if (!deleteLink || typeof deleteLink.click !== 'function') {
          return { ok: false, error: `Delete Agreement link not found for #${aid}` };
        }

        await sleep(Math.max(0, Number(actionDelayMs) || 0));
        deleteLink.click();

        const confirmSelectors = [
          '.swal2-confirm',
          'button.swal2-confirm',
          '.swal2-actions button.swal2-confirm',
          '.swal-button--confirm',
          '[data-bb-handler="confirm"]',
          '.bootbox .btn-primary',
        ];
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          for (let i = 0; i < confirmSelectors.length; i += 1) {
            const btn = document.querySelector(confirmSelectors[i]);
            if (btn && typeof btn.click === 'function') {
              btn.click();
              await sleep(220);
              return { ok: true, deleted: true };
            }
          }
          await sleep(80);
        }
        return { ok: false, error: 'Delete confirmation OK button did not appear' };
      },
      args: [id, NOSPOS_ACTION_POST_DELAY_MS],
    }).catch((e) => [{ result: { ok: false, error: e?.message || 'Delete script threw an error' } }]);

    const result = injected?.[0]?.result;
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { result }, 'Delete inject script result');
    if (result?.ok === false) {
      return result;
    }

    // Step 4: After confirm click, NosPos redirects the tab to nospos.com/buying.
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { tabId }, 'Delete confirmed — waiting for nospos.com/buying redirect');
    const waitBuying = await waitForNosposTabBuyingAfterPark(tabId, 30000);
    logPark(
      'deleteNosposBuyingAgreementByIdViaUi',
      waitBuying?.ok ? 'exit' : 'step',
      { waitBuying },
      waitBuying?.ok
        ? `✓ Tab reached nospos.com/buying after deleting agreement #${id}`
        : 'Buying redirect not detected within timeout — proceeding anyway'
    );
    return { ok: true, deleted: true };
  }

  // Diagnostic log: return all accumulated park agreement log entries.
  if (payload.action === 'getParkAgreementLog') {
    return { ok: true, entries: cgParkLog.slice(), startTs: cgParkLogStartTs };
  }

  // Park agreement (step 1): session only — same probe as searchNosposBarcode path.
  if (payload.action === 'checkNosposCustomerBuyingSession') {
    logPark('handleBridgeForward', 'enter', { action: 'checkNosposCustomerBuyingSession', nosposCustomerId: payload.nosposCustomerId }, 'Step 1: checking NoSpos customer buying session');
    return nosposFetchCustomerBuyingSession(payload.nosposCustomerId);
  }

  if (payload.action === 'clearNosposParkAgreementUi') {
    await clearNosposParkAgreementUiLock({ focusApp: payload.focusApp !== false });
    return { ok: true };
  }

  // Park agreement (step 2): open create URL in background; call after checkNosposCustomerBuyingSession succeeds.
  if (payload.action === 'openNosposNewAgreementCreateBackground') {
    // ── Clear log for each new park run ──────────────────────────────────────
    cgParkLog = [];
    cgParkLogStartTs = Date.now();
    // ─────────────────────────────────────────────────────────────────────────
    const id = parseInt(String(payload.nosposCustomerId ?? '').trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      logPark('handleBridgeForward', 'error', { rawId: payload.nosposCustomerId }, 'Invalid NosPos customer id');
      return { ok: false, error: 'Invalid NosPos customer id' };
    }
    const rawType = String(
      payload.agreementType ?? payload.nosposAgreementType ?? 'DP'
    ).toUpperCase();
    const agreementType = rawType === 'PA' ? 'PA' : 'DP';
    const createUrl = `https://nospos.com/newagreement/agreement/create?type=${agreementType}&customer_id=${id}`;
    logPark('handleBridgeForward', 'enter', { action: 'openNosposNewAgreementCreateBackground', nosposCustomerId: id, agreementType, createUrl }, 'Step 2: opening new agreement tab');
    try {
      // ── STEP 2a: Snapshot the buying hub BEFORE creating the new agreement ──
      const buyingSnapshot = await fetchNosposBuyingAgreementIds();
      const preExistingIds = new Set(buyingSnapshot.ids || []);
      logPark('handleBridgeForward', 'step', {
        buyingSnapshotOk: buyingSnapshot.ok,
        preExistingCount: preExistingIds.size,
        preExistingIds: [...preExistingIds],
      }, 'Pre-existing agreement IDs collected from nospos.com/buying');
      // ───────────────────────────────────────────────────────────────────────

      const { tabId } = await openNosposParkAgreementTab(createUrl, appTabId);
      if (tabId == null) {
        logPark('handleBridgeForward', 'error', {}, 'openNosposParkAgreementTab returned null tabId');
        return { ok: false, error: 'Could not open NoSpos tab' };
      }
      registerNosposParkTab(tabId);
      const urlRes = await waitForNosposNewAgreementItemsTabUrl(
        tabId,
        NOSPOS_OPEN_AGREEMENT_ITEMS_URL_WAIT_MS
      );
      logPark('handleBridgeForward', 'result', { urlRes, tabId }, 'waitForNosposNewAgreementItemsTabUrl result');

      if (urlRes.ok && urlRes.url) {
        // ── STEP 2b: Extract the new agreement ID and check for duplicates ──
        const newAgreementIdMatch = /\/newagreement\/(\d+)\/items/i.exec(urlRes.url || '');
        const newAgreementId = newAgreementIdMatch?.[1] ?? null;
        logPark('handleBridgeForward', 'step', {
          newAgreementId,
          newAgreementItemsUrl: urlRes.url,
        }, 'New agreement ID extracted from items URL');

        if (newAgreementId && preExistingIds.has(newAgreementId)) {
          logPark('handleBridgeForward', 'step', {
            newAgreementId,
            preExistingIds: [...preExistingIds],
          }, `DUPLICATE DRAFT DETECTED — agreement #${newAgreementId} already exists on buying hub. Prompting user.`);

          const dupRequestId = `cg-dup-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          try {
            await chrome.storage.session.set({
              [NOSPOS_PARK_UI_STORAGE_KEY]: {
                active: true,
                tabId,
                appTabId: appTabId ?? null,
                message: NOSPOS_PARK_OVERLAY_DEFAULT_MSG,
                duplicatePromptRequestId: dupRequestId,
                duplicatePromptAgreementId: String(newAgreementId),
              },
            });
          } catch (_) {}
          await focusNosposTabForPark(tabId);
          await sendNosposParkDuplicatePromptToTab(tabId, dupRequestId, newAgreementId);
          await sleep(450);
          await sendNosposParkDuplicatePromptToTab(tabId, dupRequestId, newAgreementId);

          const choice = await waitForNosposDuplicateUserChoice(
            tabId,
            dupRequestId,
            15 * 60 * 1000
          );

          if (choice !== 'delete') {
            const tabAlreadyGone = choice === 'tab_closed';
            logPark(
              'handleBridgeForward',
              'step',
              { newAgreementId, choice },
              tabAlreadyGone
                ? 'NoSpos tab closed during duplicate prompt'
                : 'User declined duplicate delete or prompt timed out — closing NosPos tab'
            );
            if (!tabAlreadyGone) {
              try {
                await sendNosposParkOverlayToTab(tabId, false);
              } catch (_) {}
            }
            try {
              await chrome.storage.session.remove(NOSPOS_PARK_UI_STORAGE_KEY);
            } catch (_) {}
            unregisterNosposParkTab(tabId);
            if (!tabAlreadyGone) {
              try {
                await chrome.tabs.remove(tabId);
              } catch (_) {}
            }
            if (appTabId != null) {
              try {
                await focusAppTab(appTabId);
              } catch (_) {}
            }
            return {
              ok: false,
              duplicateDraftDetected: true,
              userDeclinedDuplicateDelete: choice === 'cancel',
              duplicatePromptTimedOut: choice === 'timeout',
              nosposTabClosedDuringDuplicatePrompt: tabAlreadyGone,
              newAgreementId,
              error: tabAlreadyGone ? NOSPOS_PARK_TAB_CLOSED_ERR : NOSPOS_DUPLICATE_DECLINED_ERROR,
            };
          }

          logPark(
            'handleBridgeForward',
            'step',
            { newAgreementId, tabId },
            'User confirmed delete — switching to wait overlay and deleting duplicate'
          );
          try {
            await chrome.storage.session.set({
              [NOSPOS_PARK_UI_STORAGE_KEY]: {
                active: true,
                tabId,
                appTabId: appTabId ?? null,
                message: 'Deleting duplicate draft — please wait…',
              },
            });
            await sendNosposParkOverlayToTab(tabId, true, 'Deleting duplicate draft — please wait…');
          } catch (_) {}

          // Step A: Navigate to the duplicate's items page, delete it, wait for nospos.com/buying.
          logPark('handleBridgeForward', 'step', { newAgreementId, tabId }, `Step A: deleting duplicate agreement #${newAgreementId}`);
          const autoDelete = await deleteNosposBuyingAgreementByIdViaUi(tabId, newAgreementId);
          logPark('handleBridgeForward', 'step', { autoDelete, newAgreementId }, autoDelete?.ok ? `✓ Duplicate #${newAgreementId} deleted — tab is on nospos.com/buying` : `Auto-delete failed: ${autoDelete?.error}`);
          if (!autoDelete?.ok) {
            try { await clearNosposParkAgreementUiLock({ focusApp: false }); } catch (_) {}
            return {
              ok: false,
              duplicateDraftDetected: true,
              newAgreementId,
              autoDeleteAttempted: true,
              error: autoDelete?.error || `Parking failed — could not auto-delete duplicate agreement #${newAgreementId}.`,
            };
          }

          // Step B: Close the old tab (now on nospos.com/buying) and open a fresh one for the new agreement.
          logPark('handleBridgeForward', 'step', { tabId, createUrl }, 'Step B: deletion done — closing old tab and opening a fresh tab for the new agreement');
          unregisterNosposParkTab(tabId);
          try { await chrome.tabs.remove(tabId); } catch (_) {}

          let newTabId = null;
          try {
            const newTabResult = await openNosposParkAgreementTab(createUrl, appTabId);
            newTabId = newTabResult?.tabId ?? null;
          } catch (e) {
            logPark('handleBridgeForward', 'error', { error: e?.message }, 'Failed to open new tab after duplicate delete');
            return {
              ok: false,
              duplicateDraftDetected: true,
              newAgreementId,
              autoDeleteAttempted: true,
              autoDeleteSuccess: true,
              error: e?.message || 'Could not open a new tab after deleting the duplicate agreement.',
            };
          }
          if (newTabId == null) {
            logPark('handleBridgeForward', 'error', {}, 'openNosposParkAgreementTab returned null tabId for fresh tab');
            return {
              ok: false,
              duplicateDraftDetected: true,
              newAgreementId,
              autoDeleteAttempted: true,
              autoDeleteSuccess: true,
              error: 'Could not open a new tab after deleting the duplicate agreement.',
            };
          }
          registerNosposParkTab(newTabId);
          logPark('handleBridgeForward', 'step', { newTabId, createUrl }, `New tab #${newTabId} opened — activating overlay and waiting for items page`);
          try { await activateNosposParkAgreementUi(newTabId, appTabId); } catch (_) {}

          // Step C: Wait for NosPos to redirect from createUrl to the new agreement items page.
          logPark('handleBridgeForward', 'step', { newTabId }, 'Step C: waiting for items page on new tab');
          const retryUrlRes = await waitForNosposNewAgreementItemsTabUrl(newTabId, NOSPOS_OPEN_AGREEMENT_ITEMS_URL_WAIT_MS);
          logPark('handleBridgeForward', 'result', { retryUrlRes, newTabId }, retryUrlRes?.ok ? `✓ Items page reached on new tab: ${retryUrlRes.url}` : `Items page not reached on new tab: ${retryUrlRes?.error}`);
          if (!retryUrlRes?.ok || !retryUrlRes?.url) {
            return {
              ok: false,
              duplicateDraftDetected: true,
              newAgreementId,
              autoDeleteAttempted: true,
              autoDeleteSuccess: true,
              error: retryUrlRes?.error || 'Deleted duplicate, but new tab did not reach the agreement items page in time.',
            };
          }

          logPark('handleBridgeForward', 'step', {
            retriedFromDuplicate: true,
            deletedAgreementId: newAgreementId,
            newTabId,
            newAgreementItemsUrl: retryUrlRes.url,
          }, `✓ Duplicate deleted, old tab closed, fresh tab on items page — resuming park flow`);
          return {
            ok: true,
            tabId: newTabId,
            agreementItemsUrl: retryUrlRes.url,
            autoDeletedDuplicateAgreementId: newAgreementId,
          };
        }
        logPark('handleBridgeForward', 'step', {
          newAgreementId,
          existsInPreExistingBuyingIds: newAgreementId ? preExistingIds.has(newAgreementId) : null,
          preExistingCount: preExistingIds.size,
        }, 'NEW AGREEMENT CONFIRMED — extracted agreement ID was not present in pre-existing buying IDs');
        // ─────────────────────────────────────────────────────────────────────

        logPark('handleBridgeForward', 'exit', { tabId, agreementItemsUrl: urlRes.url, newAgreementId }, 'Step 2 complete — items URL obtained');
        try {
          await activateNosposParkAgreementUi(tabId, appTabId);
        } catch (_) {}
        return { ok: true, tabId, agreementItemsUrl: urlRes.url };
      }
      logPark('handleBridgeForward', 'exit', { tabId, warning: urlRes.error }, 'Step 2 complete — items URL not confirmed (warning)');
      try {
        await activateNosposParkAgreementUi(tabId, appTabId);
      } catch (_) {}
      return {
        ok: true,
        tabId,
        agreementItemsUrl: null,
        agreementItemsUrlWarning: urlRes.error || null,
      };
    } catch (e) {
      logPark('handleBridgeForward', 'error', { error: e?.message }, 'Exception opening NoSpos tab');
      return { ok: false, error: e?.message || 'Could not open NoSpos' };
    }
  }

  // Park agreement (step 3): wait for items page, set category, then fill first line (name, qty, prices, stock fields).
  if (payload.action === 'fillNosposAgreementFirstItem') {
    return fillNosposAgreementFirstItemImpl(payload);
  }

  // Park agreement: add each negotiation line sequentially (Add → wait reload → category → fill).
  if (payload.action === 'fillNosposAgreementItems') {
    return fillNosposAgreementItemsSequentialImpl(payload);
  }

  // Park agreement: single line step (UI updates between calls).
  if (payload.action === 'fillNosposAgreementItemStep') {
    return fillNosposAgreementItemStepImpl(payload);
  }

  if (payload.action === 'resolveNosposParkAgreementLine') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    const stepIndex = Math.max(0, parseInt(String(payload.stepIndex ?? '0'), 10) || 0);
    const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
    if (!Number.isFinite(tabId) || tabId <= 0) {
      return { ok: false, error: 'Invalid tab' };
    }
    const closed = await failIfNosposParkTabClosedOrMissing(tabId);
    if (closed) return closed;
    if (CG_TEST_FAIL_PARK_AFTER_SECOND_ITEM && stepIndex >= 2) {
      const intentionalError =
        `Intentional test failure (CG_TEST_FAIL_PARK_AFTER_SECOND_ITEM=true): ` +
        `blocking Park Agreement at stepIndex=${stepIndex} (after 2 items).`;
      logPark(
        'handleBridgeForward',
        'error',
        { stepIndex, tabId, intentionalTestFail: true },
        intentionalError
      );
      return { ok: false, intentionalTestFail: true, error: intentionalError };
    }
    return resolveNosposParkAgreementLineImpl(tabId, stepIndex, item, {
      noAdd: payload.noAdd === true,
      ensureTab: payload.ensureTab === true,
      negotiationLineIndex: payload.negotiationLineIndex,
      parkNegotiationLineCount: payload.parkNegotiationLineCount,
    });
  }

  if (payload.action === 'deleteExcludedNosposAgreementLines') {
    return deleteExcludedNosposAgreementLinesImpl(payload);
  }

  if (payload.action === 'clickNosposSidebarParkAgreement') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return clickNosposSidebarParkAgreementImpl(payload);
  }

  if (payload.action === 'focusOrOpenNosposParkTab') {
    return focusOrOpenNosposParkTabImpl({
      tabId: payload.tabId,
      fallbackCreateUrl: payload.fallbackCreateUrl,
      appTabId,
    });
  }

  if (payload.action === 'getNosposTabUrl') {
    const tid = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (!Number.isFinite(tid) || tid <= 0) return { ok: false, error: 'Invalid tabId' };
    try {
      const tab = await chrome.tabs.get(tid);
      return { ok: true, url: tab?.url ?? null };
    } catch (_) {
      return { ok: false, error: 'Tab not found' };
    }
  }

  /** After Park Agreement succeeds (nospos.com/buying): close worker tab and drop stray buying wait listeners. */
  if (payload.action === 'closeNosposParkAgreementTab') {
    const tid = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (!Number.isFinite(tid) || tid <= 0) return { ok: false, error: 'Invalid tabId' };
    unregisterNosposParkTab(tid);
    const detach = nosposBuyingAfterParkDetachByTabId.get(tid);
    if (typeof detach === 'function') {
      try {
        detach();
      } catch (_) {}
    }
    try {
      await chrome.tabs.remove(tid);
    } catch (_) {
      /* already closed */
    }
    return { ok: true };
  }

  if (payload.action === 'fillNosposParkAgreementCategory') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return fillNosposParkAgreementCategoryImpl(payload);
  }

  if (payload.action === 'fillNosposParkAgreementRest') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return fillNosposParkAgreementRestImpl(payload);
  }

  // Park agreement: user edits a field in the progress modal → patch NosPos tab DOM.
  if (payload.action === 'patchNosposAgreementField') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (!Number.isFinite(tabId) || tabId <= 0) {
      return { ok: false, error: 'Invalid tab' };
    }
    const patchDead = await failIfNosposParkTabClosedOrMissing(tabId);
    if (patchDead) return patchDead;
    try {
      const r = await sendMessageToTabWithRetries(
        tabId,
        {
          type: 'NOSPOS_AGREEMENT_PATCH_FIELD',
          lineIndex: payload.lineIndex ?? 0,
          patchKind: payload.patchKind,
          fieldLabel: payload.fieldLabel ?? '',
          value: payload.value ?? '',
        },
        10,
        450
      );
      return r && typeof r === 'object' ? r : { ok: false, error: 'No response from NoSpos page' };
    } catch (e) {
      return { ok: false, error: e?.message || 'Could not update NoSpos' };
    }
  }

  // Legacy: category only (same pipeline; rest phase sends empty strings).
  if (payload.action === 'fillNosposAgreementFirstItemCategory') {
    const categoryId = String(payload.categoryId ?? '').trim();
    if (!categoryId) {
      return { ok: false, error: 'No category id' };
    }
    const r = await fillNosposAgreementFirstItemImpl({
      tabId: payload.tabId,
      categoryId,
      name: '',
      quantity: '',
      retailPrice: '',
      boughtFor: '',
      stockFields: [],
    });
    if (r?.ok) {
      return { ok: true, label: r.categoryLabel || r.label };
    }
    return r;
  }

  // Open nospos.com for customer intake – same flow as openNosposAndWait (waits for user to log in)
  // but does not navigate to /stock/search; user stays on nospos.com to look up customer data.
  if (payload.action === 'openNosposForCustomerIntake') {
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = { appTabId: appTabId || null, listingTabId: newTab.id, type: 'openNosposCustomerIntake' };
    await setPending(pending);

    console.log('[CG Suite] openNosposForCustomerIntake – waiting for user to land on nospos.com', { requestId, listingTabId: newTab.id });
    return { ok: true };
  }

  // Open nospos.com only: same session / forced-login checks as customer intake; after NOSPOS_PAGE_READY,
  // navigate to /stock/category (no /customers flow).
  if (payload.action === 'openNosposSiteOnly') {
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = { appTabId: appTabId || null, listingTabId: newTab.id, type: 'openNosposSiteOnly' };
    await setPending(pending);

    console.log('[CG Suite] openNosposSiteOnly – waiting for user to land on nospos.com', { requestId, listingTabId: newTab.id });
    return { ok: true };
  }

  if (payload.action === 'openNosposSiteForFields') {
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = {
      appTabId: appTabId || null,
      listingTabId: newTab.id,
      type: 'openNosposSiteForFields',
    };
    await setPending(pending);

    console.log('[CG Suite] openNosposSiteForFields – waiting for user to land on nospos.com', {
      requestId,
      listingTabId: newTab.id,
    });
    return { ok: true };
  }

  if (payload.action === 'openNosposSiteForCategoryFields') {
    const nosposCategoryId = Math.floor(Number(payload.nosposCategoryId));
    if (!Number.isFinite(nosposCategoryId) || nosposCategoryId <= 0) {
      return { ok: false, error: 'Invalid nosposCategoryId' };
    }
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = {
      appTabId: appTabId || null,
      listingTabId: newTab.id,
      type: 'openNosposSiteForCategoryFields',
      nosposCategoryId,
    };
    await setPending(pending);

    console.log('[CG Suite] openNosposSiteForCategoryFields – waiting for user to land on nospos.com', {
      requestId,
      listingTabId: newTab.id,
      nosposCategoryId,
    });
    return { ok: true };
  }

  if (payload.action === 'openNosposSiteForCategoryFieldsBulk') {
    const rawIds = Array.isArray(payload.nosposCategoryIds) ? payload.nosposCategoryIds : [];
    const nosposCategoryIds = [];
    const seen = new Set();
    for (const x of rawIds) {
      const n = Math.floor(Number(x));
      if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
      seen.add(n);
      nosposCategoryIds.push(n);
    }
    if (nosposCategoryIds.length === 0) {
      return { ok: false, error: 'nosposCategoryIds must be a non-empty array of positive integers' };
    }
    const url = 'https://nospos.com';
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);

    const pending = await getPending();
    pending[requestId] = {
      appTabId: appTabId || null,
      listingTabId: newTab.id,
      type: 'openNosposSiteForCategoryFieldsBulk',
      nosposCategoryIds,
    };
    await setPending(pending);

    console.log('[CG Suite] openNosposSiteForCategoryFieldsBulk – waiting for nospos.com', {
      requestId,
      listingTabId: newTab.id,
      count: nosposCategoryIds.length,
    });
    return { ok: true };
  }

  // Open a URL in a new tab (e.g. nospos.com for repricing flow)
  if (payload.action === 'openUrl') {
    const url = (payload.url || 'https://nospos.com').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { ok: false, error: 'Invalid URL' };
    }
    const newTab = await chrome.tabs.create({ url });
    await putTabInYellowGroup(newTab.id);
    return { ok: true };
  }

  // Negotiation Jewellery workspace (jewellery-scrap/* + tasks/jewellery-scrap-prices-tab.js).
  if (payload.action === CG_JEWELLERY_SCRAP.BRIDGE_OPEN_ACTION) {
    try {
      const result = await openJewelleryScrapPricesTab(appTabId);
      if (result?.tabId != null && appTabId != null) {
        await registerJewelleryScrapWorkerTab(result.tabId, appTabId);
        scheduleJewelleryScrapInject(result.tabId);
      }
    } catch (e) {
      console.warn('[CG Suite] openJewelleryScrapPrices failed:', e?.message);
    }
    return { ok: true };
  }

  // Upload workspace: open Web EPOS products; if redirected to /login, close tab and reject bridge promise.
  if (payload.action === 'openWebEposUpload' && appTabId != null) {
    const { tabId: webeposTabId } = await ensureWebEposUploadWorkerTabOpen(
      WEB_EPOS_PRODUCTS_URL,
      appTabId
    );
    const pending = await getPending();
    const entry = { appTabId, listingTabId: webeposTabId, type: 'openWebEposUpload' };
    pending[requestId] = entry;
    await setPending(pending);
    watchWebEposUploadTab(webeposTabId, requestId, entry);
    console.log('[CG Suite] openWebEposUpload – watching tab', { requestId, listingTabId: webeposTabId });
    return { ok: true };
  }

  if (payload.action === 'reopenWebEposUpload' && appTabId != null) {
    const url = normalizeWebEposUploadUrl(payload.url);
    await clearWebEposUploadSession();
    const { tabId: webeposTabId } = await ensureWebEposUploadWorkerTabOpen(url, appTabId);
    const pending = await getPending();
    const entry = { appTabId, listingTabId: webeposTabId, type: 'openWebEposUpload' };
    pending[requestId] = entry;
    await setPending(pending);
    watchWebEposUploadTab(webeposTabId, requestId, entry);
    console.log('[CG Suite] reopenWebEposUpload – watching tab', { requestId, listingTabId: webeposTabId, url });
    return { ok: true };
  }

  if (payload.action === 'closeWebEposUploadSession' && appTabId != null) {
    await closeWebEposUploadSessionForAppTab(appTabId);
    return { ok: true };
  }

  if (payload.action === 'scrapeWebEposProducts' && appTabId != null) {
    void scrapeWebEposProductsAndRespond(requestId, appTabId);
    return { ok: true };
  }

  if (payload.action === 'openWebEposProductCreateForUpload' && appTabId != null) {
    void openWebEposProductCreateMinimizedAndRespond(
      requestId,
      appTabId,
      payload.webEposProductCreateList,
      payload.uploadProgressCartKey
    );
    return { ok: true };
  }

  if (payload.action === 'navigateWebEposProductInWorker' && appTabId != null) {
    return navigateWebEposProductInWorkerForBridge(
      appTabId,
      String(payload.productHref || '').trim(),
      String(payload.barcode || '').trim()
    );
  }

  // Open nospos.com and wait for the user to land on the main site (after login if needed).
  // Then navigate to /stock/search and fill the first barcode.
  if (payload.action === 'openNosposAndWait' && appTabId != null) {
    const url = 'https://nospos.com';
    await clearNosposRepricingState();
    await chrome.storage.local.remove('cgNosposLastRepricingResult');
    await clearRepricingStatus();
    const { tabId: nosposTabId } = await openBackgroundNosposTab(url, appTabId);

    const repricingData = payload.repricingData || [];
    const completedBarcodes = payload.completedBarcodes || {};
    const completedItems = payload.completedItems || [];
    const cartKey = payload.cartKey || '';

    const data = { repricingData, appTabId, completedBarcodes, completedItems, cartKey, nosposTabId };
    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId: nosposTabId, type: 'openNospos', repricingData };
    await setPending(pending);

    const stored = await chrome.storage.local.get('cgNosposRepricingProgress');
    const merged = stored.cgNosposRepricingProgress && stored.cgNosposRepricingProgress.cartKey === cartKey
      ? { ...data, completedBarcodes: { ...completedBarcodes, ...stored.cgNosposRepricingProgress.completedBarcodes }, completedItems: [...new Set([...completedItems, ...(stored.cgNosposRepricingProgress.completedItems || [])])] }
      : data;
    const initialData = {
      ...merged,
      queue: buildBarcodeQueue(repricingData, merged.completedBarcodes, merged.completedItems, {}),
      awaitingStockSelection: false,
      currentBarcode: '',
      currentItemId: '',
      currentItemIndex: null,
      currentBarcodeIndex: null,
      skippedBarcodes: {},
      ambiguousBarcodes: [],
      unverifiedBarcodes: [],
      justSaved: false,
      verifyRetries: 0,
      done: false,
      pendingCompletion: null,
      verifiedChanges: [],
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Started repricing.'
      }],
      step: 'starting',
      message: 'Opening hidden NoSpos worker'
    };
    await chrome.storage.session.set({
      cgNosposRepricingData: initialData
    });
    await chrome.storage.local.set({ cgNosposRepricingProgress: { cartKey, completedBarcodes: merged.completedBarcodes, completedItems: merged.completedItems, appTabId } });
    await broadcastRepricingStatus(appTabId, initialData, {
      step: 'starting',
      message: 'Opening hidden NoSpos worker'
    });

    console.log('[CG Suite] openNosposAndWait – waiting for user to land on nospos.com', { requestId, listingTabId: nosposTabId });
    return { ok: true };
  }

  if (payload.action === 'getLastRepricingResult') {
    return { ok: true, payload: await getLastRepricingResult() };
  }

  if (payload.action === 'clearLastRepricingResult') {
    await clearLastRepricingResult();
    return { ok: true };
  }

  if (payload.action === 'getNosposRepricingStatus') {
    return { ok: true, payload: await getRepricingStatus() };
  }

  if (payload.action === 'cancelNosposRepricing') {
    const nosposData = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;
    const progress = (await chrome.storage.local.get('cgNosposRepricingProgress')).cgNosposRepricingProgress;
    const appTabId = nosposData?.appTabId ?? progress?.appTabId;
    const nosposTabId = nosposData?.nosposTabId;
    const cartKey = nosposData?.cartKey ?? progress?.cartKey ?? payload.cartKey ?? '';

    await clearNosposRepricingState(nosposTabId || 0);
    const cancelledStatus = {
      cartKey,
      running: false,
      done: false,
      cancelled: true,
      step: 'cancelled',
      message: 'Repricing was cancelled.',
      completedBarcodes: nosposData?.completedBarcodes ?? progress?.completedBarcodes ?? {},
      completedItems: nosposData?.completedItems ?? progress?.completedItems ?? [],
      logs: [...(nosposData?.logs || []), {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Repricing was cancelled by the user.'
      }].slice(-200)
    };
    await setRepricingStatus(cancelledStatus);
    if (appTabId) {
      chrome.tabs.sendMessage(appTabId, {
        type: 'REPRICING_PROGRESS_TO_PAGE',
        payload: cancelledStatus
      }).catch(() => {});
    }
    if (nosposTabId) {
      chrome.tabs.remove(nosposTabId).catch(() => {});
    }
    return { ok: true };
  }

  if (payload.action === 'startRefine' && appTabId != null) {
    const listingPageUrl = payload.listingPageUrl;
    let competitor = 'eBay';
    if (payload.competitor === 'CashConverters') competitor = 'CashConverters';
    else if (payload.competitor === 'CashGenerator') competitor = 'CashGenerator';
    const defaultUrl =
      competitor === 'CashConverters'
        ? 'https://www.cashconverters.co.uk/'
        : competitor === 'CashGenerator'
          ? 'https://cashgenerator.co.uk/'
          : 'https://www.ebay.co.uk/';
    const urlToOpen = ensureEbayFilters(listingPageUrl) || defaultUrl;
    const marketComparisonContext = payload.marketComparisonContext || null;

    const tabs = await chrome.tabs.query({});
    const existingTab = listingPageUrl ? tabs.find(t => t.url === listingPageUrl) : null;

    let listingTabId;
    if (existingTab) {
      listingTabId = existingTab.id;
      await chrome.tabs.update(existingTab.id, { active: true }).catch(() => {});
      if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => {});
      await putTabInYellowGroup(existingTab.id);
    } else {
      const newTab = await chrome.tabs.create({ url: urlToOpen });
      await putTabInYellowGroup(newTab.id);
      await chrome.tabs.update(newTab.id, { active: true }).catch(() => {});
      listingTabId = newTab.id;
    }

    const pending = await getPending();
    pending[requestId] = { appTabId, listingTabId, competitor, marketComparisonContext };
    await setPending(pending);

    await sendWaitingForData(listingTabId, requestId, marketComparisonContext, 5, true);

    return { ok: true };
  }

  return { ok: false };
}

/**
 * Send WAITING_FOR_DATA to the content script so it shows "Have you got the data yet?" (or "Are you done?" for refine).
 * Retries a few times with delay in case the content script was injected after we received LISTING_PAGE_READY.
 */
async function sendWaitingForData(tabId, requestId, marketComparisonContext, retriesLeft, isRefine) {
  const payload = {
    type: 'WAITING_FOR_DATA',
    requestId: requestId,
    marketComparisonContext: marketComparisonContext || null,
    isRefine: !!isRefine
  };
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    console.log('[CG Suite] WAITING_FOR_DATA sent to tab', tabId);
    return true;
  } catch (err) {
    if (retriesLeft > 0) {
      console.log('[CG Suite] WAITING_FOR_DATA send failed, retrying in 300ms, retriesLeft=', retriesLeft, err?.message);
      await new Promise(r => setTimeout(r, 300));
      return sendWaitingForData(tabId, requestId, marketComparisonContext, retriesLeft - 1, isRefine);
    }
    console.warn('[CG Suite] WAITING_FOR_DATA send failed after retries', err?.message);
    return false;
  }
}

async function handleListingPageReady(message, sender) {
  const tabId = sender.tab?.id;
  const tabUrl = (sender.tab?.url || '').toLowerCase();

  console.log('[CG Suite] LISTING_PAGE_READY received from tab', tabId, 'url=', tabUrl, 'explicitRequestId=', message?.requestId);

  const pending = await getPending();
  const entries = Object.entries(pending);

  let matchedId = null;
  let matchedEntry = null;

  // 1. If the content script provided an explicit requestId (CeX: from cgReq in URL / sessionStorage),
  //    only accept it if this tab is already the one we opened for that request (no re-association to other tabs).
  const explicitRequestId = message && message.requestId;
  if (explicitRequestId && pending[explicitRequestId] && pending[explicitRequestId].listingTabId === tabId) {
    matchedId = explicitRequestId;
    matchedEntry = pending[explicitRequestId];
    console.log('[CG Suite] LISTING_PAGE_READY matched by explicit requestId (same tab)', { explicitRequestId, tabId });
  }

  // 2. Otherwise match by tab: only the tab we opened (listingTabId) can complete this flow.
  if (!matchedEntry) {
    for (const [rid, entry] of entries) {
      if (entry.listingTabId === tabId) {
        matchedId = rid;
        matchedEntry = entry;
        console.log('[CG Suite] LISTING_PAGE_READY matched by listingTabId', { matchedId, tabId });
        break;
      }
    }
  }

  // Do NOT re-associate to a different tab: user must use the single tab we opened. Other CeX tabs are ignored.

  if (matchedEntry) {
    if (matchedEntry.type === 'cexNavScrape') {
      console.log('[CG Suite] LISTING_PAGE_READY ignored for cexNavScrape flow', { matchedId, tabId });
      return;
    }
    console.log('[CG Suite] LISTING_PAGE_READY matched', { matchedId, tabId, competitor: matchedEntry.competitor });
    await sendWaitingForData(tabId, matchedId, matchedEntry.marketComparisonContext || null, 5);
  } else {
    console.log('[CG Suite] LISTING_PAGE_READY – no matching pending request for tab', tabId, 'pending keys:', Object.keys(pending));
  }
}

async function handleNosposPageReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId !== tabId) continue;
    if (entry.type === 'openNospos') {
      // Navigate to stock search; keep pending so content script can get repricingData and fill first barcode
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/stock/search' });
      const stored = await chrome.storage.session.get('cgNosposRepricingData');
      const nextData = appendRepricingLog(stored.cgNosposRepricingData, 'Logged into NoSpos. Opening stock search…');
      await chrome.storage.session.set({ cgNosposRepricingData: nextData });
      await broadcastRepricingStatus(entry.appTabId, nextData, {
        step: 'search',
        message: 'Logged into NoSpos. Opening stock search…'
      });
      console.log('[CG Suite] NOSPOS_PAGE_READY – navigating to /stock/search', { requestId });
      return;
    }
    if (entry.type === 'openNosposCustomerIntake') {
      // First time landing on nospos after opening the tab — user is now logged in.
      // Navigate to /customers and mark as waiting.
      pending[requestId] = { ...entry, type: 'openNosposCustomerIntakeWaiting' };
      await setPending(pending);
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/customers' });
      console.log('[CG Suite] NOSPOS_PAGE_READY – customer intake: navigating to /customers', { requestId });
      return;
    }
    if (entry.type === 'openNosposCustomerIntakeWaiting') {
      // The user logged in and was bounced back to the home page (or some other nospos page)
      // instead of /customers. Re-navigate them there.
      await chrome.tabs.update(tabId, { url: 'https://nospos.com/customers' });
      console.log('[CG Suite] NOSPOS_PAGE_READY – re-navigating to /customers after post-login redirect', { requestId });
      return;
    }
    if (entry.type === 'openNosposSiteOnly') {
      await runNosposDataImportAfterLogin({
        tabId,
        requestId,
        entry,
        failureMessageDefault: 'NoSpos category pages did not finish loading.',
        work: async (tid) => {
          const pagesEnd = NOSPOS_STOCK_CATEGORY_PAGINATION.endPage;
          const scrapedByNosposId = new Map();
          await runNosposStockCategoryPageLoop(tid, {
            loadTimeoutMs: 90000,
            onPage: (page, url) => {
              console.log('[CG Suite] openNosposSiteOnly category page', { requestId, page, url });
            },
            afterPageLoad: async () => {
              const pack = await scrapeNosposStockCategoryTab(tid);
              if (!pack.ok) {
                console.warn('[CG Suite] openNosposSiteOnly scrape', pack.error);
              }
              for (const row of pack.rows || []) {
                if (row && row.nosposId != null) scrapedByNosposId.set(row.nosposId, row);
              }
            },
          });
          const categories = Array.from(scrapedByNosposId.values());
          console.log('[CG Suite] NOSPOS_PAGE_READY – openNosposSiteOnly: done', {
            requestId,
            rows: categories.length,
          });
          return {
            ok: true,
            pagesVisited: pagesEnd - NOSPOS_STOCK_CATEGORY_PAGINATION.startPage + 1,
            lastUrl: buildNosposStockCategoryIndexUrl(pagesEnd),
            categories,
          };
        },
      });
      return;
    }
    if (entry.type === 'openNosposSiteForFields') {
      await runNosposDataImportAfterLogin({
        tabId,
        requestId,
        entry,
        failureMessageDefault: 'NoSpos category modify page did not finish loading.',
        work: async (tid) => {
          const targetUrl = buildNosposStockCategoryModifyUrl(1);
          await chrome.tabs.update(tid, { url: targetUrl });
          await waitForTabLoadComplete(
            tid,
            90000,
            'NoSpos category modify page did not finish loading in time.'
          );
          const pack = await scrapeNosposStockCategoryModifyTab(tid);
          if (!pack.ok) {
            console.warn('[CG Suite] openNosposSiteForFields scrape', pack.error);
          }
          const byFieldId = new Map();
          for (const row of pack.rows || []) {
            if (row && row.nosposFieldId != null) byFieldId.set(row.nosposFieldId, row);
          }
          const fields = Array.from(byFieldId.values());
          const buybackRatePercent =
            pack.buybackRatePercent != null && Number.isFinite(Number(pack.buybackRatePercent))
              ? Number(pack.buybackRatePercent)
              : null;
          const offerRatePercent =
            pack.offerRatePercent != null && Number.isFinite(Number(pack.offerRatePercent))
              ? Number(pack.offerRatePercent)
              : null;
          console.log('[CG Suite] NOSPOS_PAGE_READY – openNosposSiteForFields: done', {
            requestId,
            rows: fields.length,
            buybackRatePercent,
            offerRatePercent,
          });
          return {
            ok: true,
            pagesVisited: 1,
            lastUrl: targetUrl,
            fields,
            buybackRatePercent,
            offerRatePercent,
          };
        },
      });
      return;
    }
    if (entry.type === 'openNosposSiteForCategoryFields') {
      await runNosposDataImportAfterLogin({
        tabId,
        requestId,
        entry,
        failureMessageDefault: 'NoSpos category modify page did not finish loading.',
        work: async (tid) => {
          const targetUrl = buildNosposStockCategoryModifyUrl(entry.nosposCategoryId);
          await chrome.tabs.update(tid, { url: targetUrl });
          await waitForTabLoadComplete(
            tid,
            90000,
            'NoSpos category modify page did not finish loading in time.'
          );
          const pack = await scrapeNosposStockCategoryModifyTab(tid);
          if (!pack.ok) {
            console.warn('[CG Suite] openNosposSiteForCategoryFields scrape', pack.error);
          }
          const byFieldId = new Map();
          for (const row of pack.rows || []) {
            if (row && row.nosposFieldId != null) byFieldId.set(row.nosposFieldId, row);
          }
          const fields = Array.from(byFieldId.values());
          const buybackRatePercent =
            pack.buybackRatePercent != null && Number.isFinite(Number(pack.buybackRatePercent))
              ? Number(pack.buybackRatePercent)
              : null;
          const offerRatePercent =
            pack.offerRatePercent != null && Number.isFinite(Number(pack.offerRatePercent))
              ? Number(pack.offerRatePercent)
              : null;
          console.log('[CG Suite] NOSPOS_PAGE_READY – openNosposSiteForCategoryFields: done', {
            requestId,
            categoryNosposId: entry.nosposCategoryId,
            rows: fields.length,
            buybackRatePercent,
            offerRatePercent,
          });
          return {
            ok: true,
            pagesVisited: 1,
            lastUrl: targetUrl,
            categoryNosposId: entry.nosposCategoryId,
            fields,
            buybackRatePercent,
            offerRatePercent,
          };
        },
      });
      return;
    }
    if (entry.type === 'openNosposSiteForCategoryFieldsBulk') {
      await runNosposDataImportAfterLogin({
        tabId,
        requestId,
        entry,
        failureMessageDefault: 'NoSpos category modify bulk scrape failed.',
        work: async (tid) => {
          const ids = entry.nosposCategoryIds || [];
          const results = [];
          for (let i = 0; i < ids.length; i += 1) {
            const categoryNosposId = ids[i];
            const targetUrl = buildNosposStockCategoryModifyUrl(categoryNosposId);
            await chrome.tabs.update(tid, { url: targetUrl });
            await waitForTabLoadComplete(
              tid,
              90000,
              `NoSpos category modify page did not finish loading (id=${categoryNosposId}).`
            );
            const pack = await scrapeNosposStockCategoryModifyTab(tid);
            if (!pack.ok) {
              console.warn('[CG Suite] openNosposSiteForCategoryFieldsBulk scrape', categoryNosposId, pack.error);
            }
            const byFieldId = new Map();
            for (const row of pack.rows || []) {
              if (row && row.nosposFieldId != null) byFieldId.set(row.nosposFieldId, row);
            }
            const fields = Array.from(byFieldId.values());
            const buybackRatePercent =
              pack.buybackRatePercent != null && Number.isFinite(Number(pack.buybackRatePercent))
                ? Number(pack.buybackRatePercent)
                : null;
            const offerRatePercent =
              pack.offerRatePercent != null && Number.isFinite(Number(pack.offerRatePercent))
                ? Number(pack.offerRatePercent)
                : null;
            if (entry.appTabId != null) {
              chrome.tabs
                .sendMessage(entry.appTabId, {
                  type: 'EXTENSION_PROGRESS_TO_PAGE',
                  requestId,
                  payload: {
                    kind: 'nosposCategoryFields',
                    index: i + 1,
                    total: ids.length,
                    categoryNosposId,
                    fields,
                    buybackRatePercent,
                    offerRatePercent,
                    scrapeOk: pack.ok === true,
                    scrapeError: pack.error || null,
                  },
                })
                .catch(() => {});
            }
            results.push({
              categoryNosposId,
              fields,
              buybackRatePercent,
              offerRatePercent,
              ok: pack.ok === true,
              error: pack.error || null,
            });
          }
          console.log('[CG Suite] NOSPOS_PAGE_READY – openNosposSiteForCategoryFieldsBulk: done', {
            requestId,
            categories: results.length,
          });
          return {
            ok: true,
            bulk: true,
            results,
            total: ids.length,
          };
        },
      });
      return;
    }
  }
  console.log('[CG Suite] NOSPOS_PAGE_READY – no matching pending request for tab', tabId);
}

async function handleNosposLoginRequired(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const loginUrl = message?.url || '';
  const errorMessage = 'You must be logged into NoSpos to continue.';

  const pending = await getPending();

  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId !== tabId) continue;
    if (
      entry.type !== 'openNospos' &&
      entry.type !== 'openNosposCustomerIntake' &&
      entry.type !== 'openNosposCustomerIntakeWaiting' &&
      entry.type !== 'openNosposCustomerIntakeSaveFailed' &&
      entry.type !== 'openNosposSiteOnly' &&
      entry.type !== 'openNosposSiteForFields' &&
      entry.type !== 'openNosposSiteForCategoryFields' &&
      entry.type !== 'openNosposSiteForCategoryFieldsBulk'
    ) {
      continue;
    }

    await failNosposRequestAndCloseTab(requestId, entry, errorMessage);
    console.log('[CG Suite] NOSPOS_LOGIN_REQUIRED – closed tab and failed request', { requestId, tabId, loginUrl, type: entry.type });
    return;
  }

  console.log('[CG Suite] NOSPOS_LOGIN_REQUIRED – no matching pending request for tab', tabId, loginUrl);
}

async function handleNosposCustomerSearchReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === tabId && entry.type === 'openNosposCustomerIntakeWaiting') {
      console.log('[CG Suite] NOSPOS_CUSTOMER_SEARCH_READY – returning requestId to content script', { requestId });
      return { ok: true, requestId };
    }
  }
  return { ok: false };
}

async function handleNosposCustomerDetailReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === tabId && entry.type === 'openNosposCustomerIntakeWaiting') {
      console.log('[CG Suite] NOSPOS_CUSTOMER_DETAIL_READY – user on customer detail page, returning requestId', { requestId });
      return { ok: true, requestId };
    }
  }
  return { ok: false };
}

async function handleNosposCustomerDone(message, sender) {
  const { requestId, cancelled } = message;
  if (!requestId) return;

  const pending = await getPending();
  const entry = pending[requestId];
  if (!entry) return;

  if (message.saveFailed) {
    // Keep the entry so the user can fix the save on NosPos and we can still
    // switch them back. Change the type so NOSPOS_CUSTOMER_DETAIL_READY won't
    // try to show the modal again while waiting for the fix.
    pending[requestId] = { ...entry, type: 'openNosposCustomerIntakeSaveFailed' };
    await setPending(pending);
  } else {
    delete pending[requestId];
    await setPending(pending);
  }

  if (entry.appTabId) {
    // If the entry was already in the saveFailed state, the app's promise listener
    // was removed when we sent the first saveFailed response, so skip the redundant
    // send. Just call focusAppTab to switch back to the system tab.
    const isPostSaveFailedFix = entry.type === 'openNosposCustomerIntakeSaveFailed';
    if (!isPostSaveFailedFix) {
      chrome.tabs.sendMessage(entry.appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        response: cancelled
          ? { ok: false, cancelled: true }
          : { ok: true, customer: message.customer || null, changes: message.changes || [], saveFailed: !!message.saveFailed }
      }).catch(() => {});
    }
    if (!message.saveFailed) {
      await focusAppTab(entry.appTabId);
    }
  }
  // Close the NoSpos tab when flow completed successfully (keep it open if save failed so user can fix)
  if (entry.listingTabId != null && !message.saveFailed) {
    await chrome.tabs.remove(entry.listingTabId).catch(() => {});
  }
  console.log('[CG Suite] NOSPOS_CUSTOMER_DONE – resolved app promise, focused app tab, closed nospos tab', { requestId, cancelled });
}

function findNextBarcode(repricingData, completedBarcodes, completedItems, skippedBarcodes = {}) {
  for (let i = 0; i < repricingData.length; i++) {
    const item = repricingData[i];
    if (completedItems.includes(item?.itemId)) continue;
    const done = completedBarcodes[item?.itemId] || [];
    const skipped = skippedBarcodes[item?.itemId] || [];
    for (let j = 0; j < (item?.barcodes?.length || 0); j++) {
      if (done.includes(j) || skipped.includes(j)) continue;
      const barcode = (item.barcodes[j] || '').trim();
      if (barcode) return { itemIndex: i, barcodeIndex: j, barcode };
    }
  }
  return null;
}

function applyVerifiedBarcodeCompletion(data) {
  const pendingCompletion = data?.pendingCompletion;
  if (!pendingCompletion?.itemId || pendingCompletion?.barcodeIndex == null) {
    return null;
  }

  const completedBarcodes = { ...(data.completedBarcodes || {}) };
  const completedItems = [...(data.completedItems || [])];
  const itemId = pendingCompletion.itemId;
  const barcodeIndex = pendingCompletion.barcodeIndex;

  if (!completedBarcodes[itemId]) completedBarcodes[itemId] = [];
  if (!completedBarcodes[itemId].includes(barcodeIndex)) {
    completedBarcodes[itemId] = [...completedBarcodes[itemId], barcodeIndex];
  }

  const item = (data.repricingData || []).find((entry) => entry?.itemId === itemId);
  const itemBarcodeCount = item?.barcodes?.length || 0;
  if (itemBarcodeCount > 0 && completedBarcodes[itemId].length >= itemBarcodeCount && !completedItems.includes(itemId)) {
    completedItems.push(itemId);
  }

  const verifiedChanges = [...(data.verifiedChanges || [])];
  if (item) {
    verifiedChanges.push({
      item_identifier: item.itemId != null ? String(item.itemId) : '',
      title: item.title || '',
      quantity: item.quantity || 1,
      barcode: pendingCompletion.barcode || '',
      stock_barcode: pendingCompletion.stockBarcode || '',
      stock_url: pendingCompletion.stockUrl || '',
      old_retail_price: pendingCompletion.oldRetailPrice || null,
      new_retail_price: item.salePrice != null ? String(item.salePrice) : null,
      cex_sell_at_repricing: item.cexSellAtRepricing != null ? String(item.cexSellAtRepricing) : null,
      our_sale_price_at_repricing: item.ourSalePriceAtRepricing != null ? String(item.ourSalePriceAtRepricing) : null,
      raw_data: item.raw_data || {},
      cash_converters_data: item.cash_converters_data || {}
    });
  }

  return { completedBarcodes, completedItems, verifiedChanges };
}

function markBarcodeAsAmbiguous(data, next) {
  if (!data || !next) return data;

  const item = (data.repricingData || [])[next.itemIndex];
  const itemId = item?.itemId;
  if (itemId == null) return data;

  const skippedBarcodes = { ...(data.skippedBarcodes || {}) };
  if (!skippedBarcodes[itemId]) skippedBarcodes[itemId] = [];
  if (!skippedBarcodes[itemId].includes(next.barcodeIndex)) {
    skippedBarcodes[itemId] = [...skippedBarcodes[itemId], next.barcodeIndex];
  }

  const ambiguousBarcodes = [...(data.ambiguousBarcodes || [])];
  const alreadyTracked = ambiguousBarcodes.some(
    (entry) => String(entry?.itemId) === String(itemId) && entry?.barcodeIndex === next.barcodeIndex
  );

  if (!alreadyTracked) {
    ambiguousBarcodes.push({
      itemId,
      itemTitle: item?.title || '',
      barcodeIndex: next.barcodeIndex,
      barcode: next.barcode
    });
  }

  return {
    ...data,
    skippedBarcodes,
    ambiguousBarcodes,
    awaitingStockSelection: false,
    currentBarcode: '',
    verifyRetries: 0
  };
}

function buildRepricingCompletionPayload(data) {
  const verifiedChanges = [...(data?.verifiedChanges || [])];
  const ambiguousBarcodes = [...(data?.ambiguousBarcodes || [])];
  const unverifiedBarcodes = [...(data?.unverifiedBarcodes || [])];

  return {
    cart_key: data?.cartKey || '',
    item_count: [...new Set(verifiedChanges.map((item) => item.item_identifier).filter(Boolean))].length,
    barcode_count: verifiedChanges.length,
    items_data: verifiedChanges,
    ambiguous_barcodes: ambiguousBarcodes,
    unverified_barcodes: unverifiedBarcodes
  };
}

async function finalizeNosposRepricing(data, tabId) {
  const completedData = appendRepricingLog(
    { ...data, done: true, step: 'completed', message: 'Repricing completed.' },
    'Repricing completed.',
    'success'
  );
  const finalPayload = buildRepricingCompletionPayload(data);
  if (finalPayload.barcode_count > 0 || finalPayload.ambiguous_barcodes.length > 0) {
    await setLastRepricingResult(finalPayload);
    await sendRepricingComplete(data?.appTabId, finalPayload);
  }
  await setRepricingStatus(buildRepricingStatusPayload(completedData, {
    step: 'completed',
    message: 'Repricing completed.'
  }));
  await clearNosposRepricingState(tabId);
  await focusAppTab(data?.appTabId);
  if (tabId != null) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return finalPayload;
}

async function handleNosposStockSearchReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  let data = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;

  if (!data) {
    const pending = await getPending();
    for (const [requestId, entry] of Object.entries(pending)) {
      if (entry.type === 'openNospos' && entry.listingTabId === tabId) {
        const repricingData = entry.repricingData || [];
        delete pending[requestId];
        await setPending(pending);
        const stored = await chrome.storage.local.get('cgNosposRepricingProgress');
        const prog = stored.cgNosposRepricingProgress || {};
        data = {
          repricingData,
          appTabId: entry.appTabId,
          completedBarcodes: prog.completedBarcodes || {},
          completedItems: prog.completedItems || [],
          cartKey: prog.cartKey || '',
          nosposTabId: tabId,
          queue: buildBarcodeQueue(repricingData, prog.completedBarcodes || {}, prog.completedItems || [], {}),
          awaitingStockSelection: false,
          currentBarcode: '',
          currentItemId: '',
          currentItemIndex: null,
          currentBarcodeIndex: null,
          skippedBarcodes: {},
          ambiguousBarcodes: [],
          unverifiedBarcodes: [],
          justSaved: false,
          verifyRetries: 0,
          done: false,
          pendingCompletion: null,
          verifiedChanges: []
        };
        await chrome.storage.session.set({ cgNosposRepricingData: data });
        chrome.tabs.sendMessage(entry.appTabId, {
          type: 'EXTENSION_RESPONSE_TO_PAGE',
          requestId,
          response: { success: true, ready: true }
        }).catch(() => {});
        break;
      }
    }
  }

  if (!data) return { ok: false };

  const {
    repricingData = [],
    completedBarcodes = {},
    completedItems = [],
    awaitingStockSelection,
    currentBarcode
  } = data;
  const queue = getActiveQueue(data);
  const next = queue[0] || null;

  if (!next) {
    const finalizingData = appendRepricingLog(data, 'All barcodes processed. Finalizing repricing…');
    await chrome.storage.session.set({ cgNosposRepricingData: finalizingData });
    await broadcastRepricingStatus(finalizingData.appTabId, finalizingData, {
      step: 'finalizing',
      message: 'All barcodes processed. Finalizing repricing…'
    });
    await finalizeNosposRepricing(finalizingData, tabId);
    return { ok: false };
  }

  if (awaitingStockSelection && currentBarcode === next.barcode) {
    const ambiguousData = markBarcodeAsAmbiguous(data, next);
    const nextQueue = queue.slice(1);
    const nextAfterSkip = nextQueue[0] || null;

    if (!nextAfterSkip) {
      await finalizeNosposRepricing({ ...ambiguousData, queue: nextQueue }, tabId);
      return { ok: false };
    }

    const updatedData = appendRepricingLog(
      {
        ...ambiguousData,
        queue: nextQueue,
        nosposTabId: tabId,
        awaitingStockSelection: true,
        currentBarcode: nextAfterSkip.barcode,
        currentItemId: nextAfterSkip.itemId || '',
        currentItemIndex: nextAfterSkip.itemIndex,
        currentBarcodeIndex: nextAfterSkip.barcodeIndex,
        verifyRetries: 0
      },
      `No single stock row could be selected for ${next.barcode}. Marking it as ambiguous and moving to ${nextAfterSkip.barcode}.`,
      'warning'
    );
    await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
    await broadcastRepricingStatus(updatedData.appTabId, updatedData, {
      step: 'search',
      message: `Skipped ambiguous barcode ${next.barcode}`
    });

    return { ok: true, firstBarcode: nextAfterSkip.barcode, skippedPreviousBarcode: true };
  }

  const itemWithContext = repricingData[next.itemIndex];
  const dataWithItemHeader = addItemContextLog(data, itemWithContext);

  const editUrl = getStockEditUrl(next.stockUrl);
  if (editUrl) {
    const updatedData = appendRepricingLog(
      {
        ...dataWithItemHeader,
        queue,
        nosposTabId: tabId,
        awaitingStockSelection: false,
        currentBarcode: next.barcode,
        currentItemId: next.itemId || '',
        currentItemIndex: next.itemIndex,
        currentBarcodeIndex: next.barcodeIndex,
        verifyRetries: 0
      },
      `Navigating directly to stock edit for "${next.itemTitle || repricingData[next.itemIndex]?.title || 'unknown'}" [${next.barcode}]`
    );
    await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
    await broadcastRepricingStatus(updatedData.appTabId, updatedData, {
      step: 'search',
      message: `Opening stock edit for ${next.barcode}`,
      currentBarcode: next.barcode,
      currentItemId: next.itemId || '',
      currentItemTitle: next.itemTitle || repricingData[next.itemIndex]?.title || ''
    });
    await chrome.tabs.update(tabId, { url: editUrl });
    return { ok: false };
  }

  const updatedData = appendRepricingLog(
    {
      ...dataWithItemHeader,
      queue,
      nosposTabId: tabId,
      awaitingStockSelection: true,
      currentBarcode: next.barcode,
      currentItemId: next.itemId || '',
      currentItemIndex: next.itemIndex,
      currentBarcodeIndex: next.barcodeIndex,
      verifyRetries: 0
    },
    `Searching NosPos for barcode ${next.barcode} — "${next.itemTitle || repricingData[next.itemIndex]?.title || 'unknown'}"`
  );
  await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
  await broadcastRepricingStatus(updatedData.appTabId, updatedData, {
    step: 'search',
    message: `Searching barcode ${next.barcode}`,
    currentBarcode: next.barcode,
    currentItemId: next.itemId || '',
    currentItemTitle: next.itemTitle || repricingData[next.itemIndex]?.title || ''
  });

  return { ok: true, firstBarcode: next.barcode };
}

async function handleNosposStockEditReady(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return { ok: false };

  const stored = await chrome.storage.session.get('cgNosposRepricingData');
  const data = stored.cgNosposRepricingData;
  if (!data) return { ok: false };
  if (data.justSaved) return { ok: false, waitingForVerification: true };

  const { repricingData = [], appTabId, completedBarcodes = {}, completedItems = [], cartKey, nosposTabId } = data;
  const queue = getActiveQueue(data);
  const next = queue[0] || null;
  if (!next) return { ok: false };

  const item = repricingData[next.itemIndex];
  const raw = item?.salePrice;
  const salePrice = raw != null && typeof raw === 'number' && !Number.isNaN(raw)
    ? raw.toFixed(2)
    : (raw != null ? String(raw) : '');

  const newStockName = (item?.title || '').trim();
  const currentStockName = (message.currentStockName || '').trim();
  const currentExternallyListed = !!message.currentExternallyListed;
  const oldPrice = (message.oldRetailPrice || '').trim();

  const stateBase = {
    ...data,
    repricingData,
    appTabId,
    completedBarcodes,
    completedItems,
    cartKey,
    nosposTabId: nosposTabId || tabId,
    queue,
    awaitingStockSelection: false,
    currentBarcode: '',
    currentItemId: '',
    currentItemIndex: null,
    currentBarcodeIndex: null,
    justSaved: true,
    lastSalePrice: salePrice,
    verifyRetries: 0,
    done: false,
    pendingCompletion: {
      itemId: item?.itemId,
      barcodeIndex: next.barcodeIndex,
      barcode: next.barcode,
      oldRetailPrice: oldPrice,
      stockBarcode: message.stockBarcode || '',
      stockUrl: sender.tab?.url || ''
    }
  };

  let d = appendRepricingLog(stateBase, `Saving "${item?.title || next.barcode}" [${next.barcode}]`);

  if (newStockName) {
    const nameMsg = !currentStockName
      ? `Name: setting to "${newStockName}"`
      : currentStockName === newStockName
      ? `Name: "${newStockName}" (already correct)`
      : `Name: "${currentStockName}" → "${newStockName}"`;
    d = appendRepricingLog(d, nameMsg);
  }

  d = appendRepricingLog(d, currentExternallyListed
    ? 'Externally Listed: already ticked'
    : 'Externally Listed: ticking');

  if (salePrice !== '') {
    d = appendRepricingLog(d, oldPrice
      ? `RRP: £${oldPrice} → £${salePrice}`
      : `RRP: setting to £${salePrice}`);
  } else if (oldPrice) {
    d = appendRepricingLog(d, `RRP: £${oldPrice} (no change)`);
  }

  const updatedData = d;
  await chrome.storage.session.set({ cgNosposRepricingData: updatedData });
  await broadcastRepricingStatus(appTabId, updatedData, {
    step: 'saving',
    message: `Saving "${item?.title || next.barcode}"…`,
    currentBarcode: next.barcode,
    currentItemId: item?.itemId || '',
    currentItemTitle: item?.title || ''
  });

  return { ok: true, salePrice, stockName: newStockName, externallyListed: true, done: false };
}

function normalizePriceForCompare(val) {
  if (val == null || val === '') return '';
  const s = String(val).replace(/[£,\s]/g, '').trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? s : n.toFixed(2);
}

async function handleNosposPageLoaded(message, sender) {
  const tabId = sender.tab?.id;
  const path = (message.path || '').toLowerCase();
  const retailPrice = (message.retailPrice || '').trim();
  const stockBarcode = (message.stockBarcode || '').trim();

  const stored = await chrome.storage.session.get('cgNosposRepricingData');
  const data = stored.cgNosposRepricingData;
  if (!data) return;

  const isSearchPage = isNosposSearchPath(path);
  const isEditPage = /^\/stock\/\d+\/edit\/?$/.test(path);

  if (isEditPage && data.justSaved) {
    const lastSalePrice = data.lastSalePrice || '';
    const expected = normalizePriceForCompare(lastSalePrice);
    const actual = normalizePriceForCompare(retailPrice);
    const verified = expected !== '' && actual !== '' && expected === actual;

    if (verified) {
      const verifiedData = {
        ...data,
        pendingCompletion: data.pendingCompletion
          ? {
              ...data.pendingCompletion,
              stockBarcode: stockBarcode || data.pendingCompletion.stockBarcode || ''
            }
          : data.pendingCompletion
      };
      const updatedProgress = applyVerifiedBarcodeCompletion(verifiedData);
      if (!updatedProgress) return;
      const { completedBarcodes, completedItems, verifiedChanges } = updatedProgress;
      const nextQueue = removeQueueHead(data.queue, data.pendingCompletion);
      const payload = { cartKey: data.cartKey, completedBarcodes, completedItems };
      const verifiedState = appendRepricingLog(
        {
          ...verifiedData,
          completedBarcodes,
          completedItems,
          verifiedChanges,
          queue: nextQueue
        },
        `Barcode ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'} saved.`,
        'success'
      );
      await broadcastRepricingStatus(data.appTabId, verifiedState, {
        ...payload,
        step: 'verified',
        message: `Verified ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'}.`
      });
      await chrome.storage.local.set({
        cgNosposRepricingProgress: {
          cartKey: data.cartKey,
          completedBarcodes,
          completedItems,
          appTabId: data.appTabId
        }
      });
      const done = nextQueue.length === 0;

      if (done) {
        await finalizeNosposRepricing(
          {
            ...verifiedState,
            completedBarcodes,
            completedItems,
            verifiedChanges,
            queue: nextQueue,
            pendingCompletion: null
          },
          tabId
        );
      } else {
        await chrome.storage.session.set({
          cgNosposRepricingData: {
            ...verifiedState,
            completedBarcodes,
            completedItems,
            verifiedChanges,
            queue: nextQueue,
            justSaved: false,
            verifyRetries: 0,
            pendingCompletion: null,
            done
          }
        });
        if (tabId) {
          const nextEditUrl = getStockEditUrl(nextQueue[0]?.stockUrl);
          await chrome.tabs.update(tabId, { url: nextEditUrl || 'https://nospos.com/stock/search' });
        }
      }
    } else {
      const retries = (data.verifyRetries || 0) + 1;
      if (retries < 5) {
        const retryState = {
          ...data,
          verifyRetries: retries
        };
        await chrome.storage.session.set({ cgNosposRepricingData: retryState });
        await broadcastRepricingStatus(data.appTabId, retryState, {
          step: 'verifying',
          message: `Checking that NoSpos saved the new retail price for ${data.pendingCompletion?.barcode || stockBarcode || 'barcode'}…`
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'NOSPOS_VERIFY_RETAIL_PRICE' }).catch(() => {});
        }, 800);
      } else {
        // Max retries exceeded — skip this barcode, record it as unverified, and move to the next one.
        const pendingCompletion = data.pendingCompletion || {};
        const unverifiedItem = (data.repricingData || []).find(entry => String(entry?.itemId) === String(pendingCompletion.itemId));
        const unverifiedBarcodes = [...(data.unverifiedBarcodes || [])];
        const alreadyTracked = unverifiedBarcodes.some(
          e => String(e?.itemId) === String(pendingCompletion.itemId) && e?.barcodeIndex === pendingCompletion.barcodeIndex
        );
        if (!alreadyTracked && pendingCompletion.itemId != null) {
          unverifiedBarcodes.push({
            itemId: pendingCompletion.itemId,
            itemTitle: unverifiedItem?.title || '',
            barcodeIndex: pendingCompletion.barcodeIndex,
            barcode: pendingCompletion.barcode || '',
            stockBarcode: pendingCompletion.stockBarcode || stockBarcode || '',
            stockUrl: pendingCompletion.stockUrl || ''
          });
        }

        const nextQueue = removeQueueHead(getActiveQueue(data), pendingCompletion);
        const skippedData = appendRepricingLog(
          {
            ...data,
            unverifiedBarcodes,
            queue: nextQueue,
            justSaved: false,
            verifyRetries: 0,
            pendingCompletion: null
          },
          `Could not verify saved price for "${pendingCompletion.barcode || stockBarcode || 'barcode'}" after ${retries} attempts — skipping and moving on.`,
          'warning'
        );

        if (nextQueue.length === 0) {
          await finalizeNosposRepricing(skippedData, tabId);
        } else {
          await chrome.storage.session.set({ cgNosposRepricingData: skippedData });
          await broadcastRepricingStatus(data.appTabId, skippedData, {
            step: 'search',
            message: `Verification failed for "${pendingCompletion.barcode || 'barcode'}". Moving to next item…`
          });
          if (tabId) {
            const nextEditUrl = getStockEditUrl(nextQueue[0]?.stockUrl);
            await chrome.tabs.update(tabId, { url: nextEditUrl || 'https://nospos.com/stock/search' });
          }
        }
      }
    }
    return;
  }

  if (isSearchPage && data.justSaved) {
    const searchResetState = appendRepricingLog(
      { ...data, justSaved: false, verifyRetries: 0 },
      'Returned to the stock search page. Preparing the next barcode…'
    );
    await chrome.storage.session.set({
      cgNosposRepricingData: searchResetState
    });
    await broadcastRepricingStatus(data.appTabId, searchResetState, {
      step: 'search',
      message: 'Returned to stock search. Preparing the next barcode…'
    });
    return;
  }

  if (!isSearchPage && !isEditPage && tabId) {
    const rerouteState = appendRepricingLog(
      { ...data, justSaved: false, verifyRetries: 0 },
      'NoSpos moved away from the expected page. Redirecting back to stock search…',
      'warning'
    );
    await chrome.storage.session.set({
      cgNosposRepricingData: rerouteState
    });
    await broadcastRepricingStatus(data.appTabId, rerouteState, {
      step: 'search',
      message: 'Redirecting the background worker back to stock search…'
    });
    await chrome.tabs.update(tabId, { url: 'https://nospos.com/stock/search' });
  }
}

async function handleScrapedData(message) {
  const { requestId, data } = message;

  const pending = await getPending();
  const entry = pending[requestId];

  if (entry?.appTabId != null) {
    const listingTabId = entry.listingTabId;
    delete pending[requestId];
    await setPending(pending);

    const appTab = await chrome.tabs.get(entry.appTabId).catch(() => null);
    await chrome.tabs.update(entry.appTabId, { active: true }).catch(() => {});
    if (appTab?.windowId) await chrome.windows.update(appTab.windowId, { focused: true }).catch(() => {});

    await chrome.tabs.sendMessage(entry.appTabId, {
      type: 'EXTENSION_RESPONSE_TO_PAGE',
      requestId,
      response: data
    });

    // Close the listing tab (eBay, Cash Converters, or CeX) after data was sent to the app.
    // Never close openNospos tabs – user needs them to log in.
    if (listingTabId != null && entry.type !== 'openNospos') {
      await chrome.tabs.remove(listingTabId).catch(() => {});
    }
    return { ok: true };
  }

  return { ok: false };
}

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  const nosposData = (await chrome.storage.session.get('cgNosposRepricingData')).cgNosposRepricingData;
  const progress = (await chrome.storage.local.get('cgNosposRepricingProgress')).cgNosposRepricingProgress;
  if (nosposData?.nosposTabId === removedTabId) {
    const appTabId = nosposData?.appTabId ?? progress?.appTabId;
    await clearNosposRepricingState(removedTabId);
    const cancelledStatus = {
      cartKey: nosposData?.cartKey ?? progress?.cartKey ?? '',
      running: false,
      done: false,
      cancelled: true,
      step: 'cancelled',
      message: 'NoSpos tab was closed. Repricing cancelled.',
      completedBarcodes: nosposData?.completedBarcodes ?? progress?.completedBarcodes ?? {},
      completedItems: nosposData?.completedItems ?? progress?.completedItems ?? [],
      logs: [...(nosposData?.logs || []), {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'NoSpos tab was closed. Repricing cancelled.'
      }].slice(-200)
    };
    await setRepricingStatus(cancelledStatus);
    if (appTabId) {
      chrome.tabs.sendMessage(appTabId, {
        type: 'REPRICING_PROGRESS_TO_PAGE',
        payload: cancelledStatus
      }).catch(() => {});
    }
  }

  const pending = await getPending();
  for (const [requestId, entry] of Object.entries(pending)) {
    if (entry.listingTabId === removedTabId) {
      delete pending[requestId];
      await setPending(pending);
      chrome.tabs.sendMessage(entry.appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        response: {
          success: false,
          cancelled: true,
          error: 'Tab was closed. You can try again when ready.',
        }
      }).catch(() => {});
      break;
    }
  }

  await unregisterJewelleryScrapWorkerTab(removedTabId);
});
