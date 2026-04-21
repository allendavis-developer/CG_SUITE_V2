/**
 * Background fetch of NosPos stock search by barcode (no tab switch).
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_searchNosposBarcode({ requestId, appTabId, payload }) {
  const barcode = (payload.barcode || '').trim();
  if (!barcode) return { ok: false, error: 'No barcode provided' };
  try {
    const searchUrl = `https://nospos.com/stock/search/index?StockSearchAndFilter[query]=${encodeURIComponent(barcode)}&sort=-quantity`;
    const response = await fetch(searchUrl, {
      credentials: 'include',
      headers: NOSPOS_HTML_FETCH_HEADERS,
    });
    const finalUrl = response.url || '';
    if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
      return { ok: false, loginRequired: true };
    }
    const html = await response.text();
    const isDirectStockEditHit = /^https:\/\/[^/]*nospos\.com\/stock\/\d+\/edit\/?(\?.*)?$/i.test(finalUrl);
    const results = isDirectStockEditHit
      ? parseNosposStockEditResult(html, finalUrl)
      : parseNosposSearchResults(html);
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e.message || 'Search failed' };
  }
}
