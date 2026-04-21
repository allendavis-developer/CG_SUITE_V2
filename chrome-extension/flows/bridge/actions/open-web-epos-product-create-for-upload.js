/**
 * Open Web EPOS's new-product page and fill it from the upload spec.
 * Guard: original action required appTabId — dispatcher provides it when present.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_openWebEposProductCreateForUpload({ requestId, appTabId, payload }) {
  if (appTabId == null) return { ok: false, error: 'No app tab' };

  void openWebEposProductCreateMinimizedAndRespond(
    requestId,
    appTabId,
    payload.webEposProductCreateList,
    payload.uploadProgressCartKey
  );
  return { ok: true };
}
