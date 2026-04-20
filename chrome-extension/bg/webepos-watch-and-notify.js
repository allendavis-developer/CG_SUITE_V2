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

/**
 * After opening Web EPOS for upload: fail fast if the site lands on /login (not logged in),
 * otherwise resolve the bridge promise so the app can continue. Tab stays open on success.
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
