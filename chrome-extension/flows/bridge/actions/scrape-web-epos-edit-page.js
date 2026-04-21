/**
 * Scrape a Web EPOS product edit page for audit.
 * Guard: original action required appTabId — dispatcher provides it when present.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_scrapeWebEposEditPage({ requestId, appTabId, payload }) {
  if (appTabId == null) return { ok: false, error: 'No app tab' };

  void scrapeWebEposEditPageAndRespond(
    requestId,
    appTabId,
    String(payload.productHref || '').trim()
  );
  return { ok: true };
}
