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

  // Step-by-step logs with before → after for each field
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
    const rrpMsg = oldPrice
      ? `RRP: £${oldPrice} → £${salePrice}`
      : `RRP: setting to £${salePrice}`;
    d = appendRepricingLog(d, rrpMsg);
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
