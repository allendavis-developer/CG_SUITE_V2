/**
 * Park-agreement bridge actions that delegate to nospos-park-* implementations.
 * @returns {Promise<object|undefined>} Result, or undefined if action not handled here.
 */
async function bridgeForwardHandleParkFillActions(payload, appTabId) {
  const a = payload.action;
  if (a === 'fillNosposAgreementFirstItem') return fillNosposAgreementFirstItemImpl(payload);
  if (a === 'fillNosposAgreementItems') return fillNosposAgreementItemsSequentialImpl(payload);
  if (a === 'fillNosposAgreementItemStep') return fillNosposAgreementItemStepImpl(payload);

  if (a === 'resolveNosposParkAgreementLine') {
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

  if (a === 'deleteExcludedNosposAgreementLines') return deleteExcludedNosposAgreementLinesImpl(payload);

  if (a === 'clickNosposSidebarParkAgreement') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return clickNosposSidebarParkAgreementImpl(payload);
  }

  if (a === 'focusOrOpenNosposParkTab') {
    return focusOrOpenNosposParkTabImpl({
      tabId: payload.tabId,
      fallbackCreateUrl: payload.fallbackCreateUrl,
      appTabId,
    });
  }

  if (a === 'getNosposTabUrl') {
    const tid = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (!Number.isFinite(tid) || tid <= 0) return { ok: false, error: 'Invalid tabId' };
    try {
      const tab = await chrome.tabs.get(tid);
      return { ok: true, url: tab?.url ?? null };
    } catch (_) {
      return { ok: false, error: 'Tab not found' };
    }
  }

  if (a === 'closeNosposParkAgreementTab') {
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

  if (a === 'fillNosposParkAgreementCategory') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return fillNosposParkAgreementCategoryImpl(payload);
  }

  if (a === 'fillNosposParkAgreementRest') {
    const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
    if (Number.isFinite(tabId) && tabId > 0) {
      const closed = await failIfNosposParkTabClosedOrMissing(tabId);
      if (closed) return closed;
    }
    return fillNosposParkAgreementRestImpl(payload);
  }

  if (a === 'patchNosposAgreementField') {
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

  if (a === 'fillNosposAgreementFirstItemCategory') {
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

  return undefined;
}
