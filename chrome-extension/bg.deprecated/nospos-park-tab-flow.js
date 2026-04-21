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
