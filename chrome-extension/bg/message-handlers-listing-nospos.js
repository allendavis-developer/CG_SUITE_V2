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

