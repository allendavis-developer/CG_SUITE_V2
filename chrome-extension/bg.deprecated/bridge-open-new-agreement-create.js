/**
 * Bridge action `openNosposNewAgreementCreateBackground` — tab open, duplicate detection, optional delete + retry.
 */

async function bridgeForwardOpenNosposNewAgreementCreateBackground(payload, appTabId) {
  cgParkLog = [];
  cgParkLogStartTs = Date.now();
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
    const buyingSnapshot = await fetchNosposBuyingAgreementIds();
    const preExistingIds = new Set(buyingSnapshot.ids || []);
    logPark('handleBridgeForward', 'step', {
      buyingSnapshotOk: buyingSnapshot.ok,
      preExistingCount: preExistingIds.size,
      preExistingIds: [...preExistingIds],
    }, 'Pre-existing agreement IDs collected from nospos.com/buying');

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
