/**
 * Toggle Web EPOS "On Sale" to off on an already-opened product edit tab, then click
 * Save/Update. Expects the caller to have opened the tab via the canonical opener
 * (`navigateWebEposProductInWorkerTab` with `focusOnSuccess: false`) so the routing is
 * session-safe and the edit page has actually mounted — we still wait for `#price` as a
 * belt-and-braces readiness signal so a slow tab doesn't race the toggle.
 *
 * The three injection helpers are the same ones the upload/audit flows use
 * (`injectWebEposWaitForEditFormReady`, `injectWebEposEnsureOnSaleOff`,
 * `injectWebEposEditProductFinishSave`), so every Web EPOS form selector stays in one
 * place — `chrome-extension/bg/webepos-new-product-fill-page.js`.
 *
 * Payload: { tabId: number }
 * Response: { ok: true } | { ok: false, error: string }
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_setWebEposProductOnSaleOff({ payload }) {
  const tabId = Number(payload?.tabId);
  if (!Number.isFinite(tabId)) return { ok: false, error: 'Missing tabId' };
  try {
    await injectWebEposWaitForEditFormReady(tabId);
    await injectWebEposEnsureOnSaleOff(tabId);
    await injectWebEposEditProductFinishSave(tabId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to toggle On Sale off' };
  }
}
