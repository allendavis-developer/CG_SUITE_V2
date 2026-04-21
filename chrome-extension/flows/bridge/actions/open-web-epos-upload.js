/**
 * Open the Web EPOS upload worker tab (minimized).
 * Guard: original action required appTabId — dispatcher provides it when present.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_openWebEposUpload({ requestId, appTabId, payload }) {
  if (appTabId == null) return { ok: false, error: 'No app tab' };

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
