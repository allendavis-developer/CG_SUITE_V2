/**
 * Fetch a NosPos stock/edit page in the background and return parsed fields for the upload flow.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_scrapeNosposStockEditForUpload({ requestId, appTabId, payload }) {
  const stockUrl = String(payload.stockUrl || '').trim();
  if (!stockUrl) return { ok: false, error: 'No stock URL' };
  const editUrl = normalizeNosposStockEditUrl(stockUrl);
  if (!editUrl) return { ok: false, error: 'Invalid stock URL' };
  try {
    const response = await fetch(editUrl, {
      credentials: 'include',
      headers: NOSPOS_HTML_FETCH_HEADERS,
    });
    const finalUrl = response.url || '';
    const html = await response.text();
    if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
      return { ok: false, loginRequired: true };
    }
    return { ok: true, details: parseNosposStockEditPageDetails(html) };
  } catch (e) {
    return { ok: false, error: e?.message || 'Scrape failed' };
  }
}
