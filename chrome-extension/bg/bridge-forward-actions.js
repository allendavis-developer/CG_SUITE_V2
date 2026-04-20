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
    return bridgeForwardOpenNosposNewAgreementCreateBackground(payload, appTabId);
  }

  // Park agreement (step 3): wait for items page, set category, then fill first line (name, qty, prices, stock fields).
  const parkFill = await bridgeForwardHandleParkFillActions(payload, appTabId);
  if (parkFill !== undefined) return parkFill;

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

