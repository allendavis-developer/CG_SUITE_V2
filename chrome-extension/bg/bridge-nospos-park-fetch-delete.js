/**
 * NosPos park duplicate recovery: fetch buying hub IDs, probe customer session, delete agreement via injected UI.
 * (Hoisted out of bridge-forward-actions.js so the main bridge file stays readable.)
 */

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

  const duplicateItemsUrl = `https://nospos.com/newagreement/${id}/items`;
  logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { duplicateItemsUrl }, 'Navigating to duplicate agreement items page');
  try {
    await chrome.tabs.update(tabId, { url: duplicateItemsUrl });
  } catch (e) {
    logPark('deleteNosposBuyingAgreementByIdViaUi', 'error', { error: e?.message }, 'Could not navigate to duplicate items page');
    return { ok: false, error: e?.message || 'Could not navigate to duplicate agreement items page' };
  }

  logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { tabId }, 'Waiting for duplicate items page to load');
  const waitItems = await waitForNosposNewAgreementItemsTabUrl(tabId, 35000);
  logPark('deleteNosposBuyingAgreementByIdViaUi', 'step', { waitItems }, waitItems?.ok ? 'Duplicate items page loaded' : 'Duplicate items page failed to load');
  if (!waitItems?.ok) {
    return { ok: false, error: waitItems?.error || 'Duplicate agreement items page did not load in time' };
  }

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
