/**
 * Walk a list of Web EPOS products and apply edits.
 * Guard: original action required appTabId — dispatcher provides it when present.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_editWebEposProductsForAudit({ requestId, appTabId, payload }) {
  if (appTabId == null) return { ok: false, error: 'No app tab' };

  void openWebEposProductEditMinimizedAndRespond(
    requestId,
    appTabId,
    payload.webEposEditList,
    payload.uploadProgressCartKey
  );
  return { ok: true };
}
