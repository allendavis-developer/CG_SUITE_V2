/**
 * Web EPOS new-product and edit-product form injection/fill/save flows.
 */

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

/** Inject the edit-page helper (loads `bg/webepos-edit-product-fill-page.js` in MAIN world). */
async function injectWebEposEditHelper(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['bg/webepos-edit-product-fill-page.js'],
  });
}

async function injectWebEposEditScrape(tabId) {
  await injectWebEposEditHelper(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const fn = window.__CG_WEB_EPOS_EDIT_SCRAPE;
      if (typeof fn !== 'function') return null;
      return fn();
    },
  });
  return results && results[0] ? results[0].result : null;
}

async function injectWebEposEditFill(tabId, spec) {
  await injectWebEposEditHelper(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [spec],
    func: (s) => {
      const run = window.__CG_WEB_EPOS_EDIT_RUN;
      if (typeof run === 'function') return run(s);
      return undefined;
    },
  });
  await sleep(300);
}

async function injectWebEposEditFinish(tabId, expectedPrice) {
  await injectWebEposEditHelper(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [expectedPrice == null ? null : String(expectedPrice)],
    func: (ep) => {
      const fn = window.__CG_WEB_EPOS_EDIT_FINISH;
      if (typeof fn !== 'function') {
        return Promise.reject(new Error('Web EPOS edit finish helper not available'));
      }
      return fn(ep);
    },
  });
  const inj = results && results[0];
  if (inj?.error) throw new Error(inj.error.message || String(inj.error));
  const out = inj?.result;
  if (out && out.ok === false) throw new Error(out.error || 'Web EPOS edit save did not verify');
  await sleep(300);
  return out || { ok: true };
}

function sanitizeWebEposEditSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const href = String(raw.productHref || '').trim();
  if (!href) return null;
  let parsed;
  try { parsed = new URL(href); } catch { return null; }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) return null;
  const out = { productHref: href, barcode: String(raw.barcode || '').trim() };
  if (raw.price != null && String(raw.price).length > 0) out.price = String(raw.price).trim();
  if (Array.isArray(raw.categoryLevelUuids)) {
    out.categoryLevelUuids = raw.categoryLevelUuids.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (Array.isArray(raw.categoryLevelLabels)) {
    out.categoryLevelLabels = raw.categoryLevelLabels.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (!out.price && !(out.categoryLevelUuids?.length) && !(out.categoryLevelLabels?.length)) return null;
  return out;
}

/**
 * Audit-mode intake: open a single Web EPOS product edit page in the upload worker tab and return
 * the current price, title, and category levels. Reuses the upload session's worker tab — keeps it
 * open across calls so per-barcode scrapes don't thrash.
 */
async function scrapeWebEposEditPageAndRespond(requestId, appTabId, productHref) {
  const respondErr = async (msg) => {
    if (!appTabId) return;
    chrome.tabs
      .sendMessage(appTabId, { type: 'EXTENSION_RESPONSE_TO_PAGE', requestId, error: msg })
      .catch(() => {});
  };

  const href = String(productHref || '').trim();
  if (!href) { await respondErr('Missing productHref'); return; }
  let parsed;
  try { parsed = new URL(href); } catch { await respondErr('Invalid productHref'); return; }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
    await respondErr('productHref is not Web EPOS');
    return;
  }

  try {
    const { tabId } = await ensureWebEposUploadWorkerTabOpen(href, appTabId);
    if (tabId == null) { await respondErr('Could not open Web EPOS worker tab'); return; }
    await waitForTabLoadComplete(tabId, 90000, 'Web EPOS edit page load timed out');
    await webEposAssertNewProductPageNotLogin(tabId); // reused: rejects /login and enforces host
    // Give the edit form a moment to populate from the API.
    await sleep(800);
    const scraped = await injectWebEposEditScrape(tabId);
    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: true,
      details: scraped || { title: '', price: '', categoryLevels: [] },
    });
  } catch (e) {
    await respondErr(e?.message || 'Failed to scrape Web EPOS edit page');
  }
}

/**
 * Finish: for each audit item with a diff, navigate the upload worker tab to the edit URL, fill
 * changed fields, click Save Product, verify. Progress mirrors the new-product upload flow.
 */
async function openWebEposProductEditMinimizedAndRespond(requestId, appTabId, editListRaw, uploadProgressCartKey) {
  const respondErr = async (msg) => {
    if (!appTabId) return;
    chrome.tabs
      .sendMessage(appTabId, { type: 'EXTENSION_RESPONSE_TO_PAGE', requestId, error: msg })
      .catch(() => {});
    await focusAppTab(appTabId);
  };

  const rawList = Array.isArray(editListRaw) ? editListRaw : [];
  const editList = rawList.map(sanitizeWebEposEditSpec).filter(Boolean).slice(0, 40);

  if (editList.length === 0) {
    await notifyAppExtensionResponse(appTabId, requestId, { ok: true, tabsFilled: 0 });
    return;
  }

  const cartKey = String(uploadProgressCartKey || '').trim();
  let progressData = {
    cartKey, done: false, repricingData: [], completedBarcodes: {}, completedItems: [],
    logs: [], step: 'webEposEdit', message: '',
  };

  const emitProgress = async (patch) => {
    if (!cartKey || !appTabId) return;
    const { logMessage, ...dataPatch } = patch;
    progressData = { ...progressData, ...dataPatch };
    progressData = appendRepricingLog(
      progressData,
      logMessage != null ? String(logMessage) : String(patch.message || '').trim() || '…'
    );
    await broadcastRepricingStatus(appTabId, progressData, {
      ...dataPatch, logs: progressData.logs, totalBarcodes: editList.length,
    });
  };

  let workerTabId = null;
  try {
    const first = editList[0];
    const opened = await ensureWebEposUploadWorkerTabOpen(first.productHref, appTabId);
    workerTabId = opened?.tabId ?? null;
    if (workerTabId == null) throw new Error('Could not open Web EPOS.');

    if (cartKey && appTabId) {
      progressData = appendRepricingLog(progressData,
        `Starting Web EPOS edit (${editList.length} item${editList.length === 1 ? '' : 's'}).`);
      await broadcastRepricingStatus(appTabId, progressData, {
        running: true, done: false, message: 'Opening Web EPOS',
        currentBarcode: editList[0]?.barcode || '',
        completedBarcodeCount: 0, totalBarcodes: editList.length, logs: progressData.logs,
      });
    }

    for (let i = 0; i < editList.length; i++) {
      const spec = editList[i];
      try {
        if (i > 0) {
          await chrome.tabs.update(workerTabId, { url: spec.productHref });
        }
        await waitForTabLoadComplete(workerTabId, 90000, 'Web EPOS edit page load timed out');
        await webEposAssertNewProductPageNotLogin(workerTabId);
        await sleep(800);

        if (cartKey && appTabId) {
          await emitProgress({
            running: true, done: false,
            message: `Editing item ${i + 1} of ${editList.length}`,
            currentBarcode: spec.barcode || '',
            completedBarcodeCount: i,
            logMessage: `Item ${i + 1}/${editList.length}: filling changes (${spec.barcode || 'no barcode'}).`,
          });
        }

        await injectWebEposEditFill(workerTabId, spec);

        if (cartKey && appTabId) {
          await emitProgress({
            message: `Saving item ${i + 1} of ${editList.length}…`,
            logMessage: `Item ${i + 1}/${editList.length}: clicking Save Product.`,
          });
        }

        await injectWebEposEditFinish(workerTabId, spec.price || null);

        if (cartKey && appTabId) {
          await emitProgress({
            message: `Saved item ${i + 1} of ${editList.length} ✓`,
            completedBarcodeCount: i + 1,
            logMessage: `Item ${i + 1}/${editList.length}: saved.`,
          });
        }
      } catch (e) {
        const errMsg = e?.message || 'Failed to edit Web EPOS product.';
        await respondErr(errMsg);
        if (cartKey && appTabId) {
          progressData = appendRepricingLog(progressData, `Error on item ${i + 1}: ${errMsg}`);
          await broadcastRepricingStatus(appTabId, progressData, {
            running: false, done: true, message: 'Web EPOS edit stopped due to an error',
            completedBarcodeCount: i, totalBarcodes: editList.length, logs: progressData.logs,
          });
        }
        return;
      }
    }

    if (cartKey && appTabId) {
      progressData = appendRepricingLog(progressData, 'Web EPOS edit finished for all items.');
      await broadcastRepricingStatus(appTabId, progressData, {
        running: false, done: true, message: 'Web EPOS edit complete',
        completedBarcodeCount: editList.length, totalBarcodes: editList.length, logs: progressData.logs,
      });
    }

    await notifyAppExtensionResponse(appTabId, requestId, { ok: true, tabsFilled: editList.length });
    if (appTabId) await focusAppTab(appTabId);
  } catch (e) {
    await respondErr(e?.message || 'Web EPOS edit failed.');
    if (cartKey && appTabId) {
      progressData = appendRepricingLog(progressData, e?.message || 'Unexpected error');
      await broadcastRepricingStatus(appTabId, progressData, {
        running: false, done: true, message: 'Web EPOS edit failed',
        totalBarcodes: editList.length, completedBarcodeCount: 0, logs: progressData.logs,
      });
    }
  }
}

/**
 * After opening Web EPOS for upload: fail fast if the site lands on /login (not logged in),
 * otherwise resolve the bridge promise so the app can continue. Product-create upload closes the tab when finished.
 */
