/**
 * Background fetch of NosPos stock search by barcode (no tab switch).
 *
 * Hardened against transient throttling: after a long sequence of searches NosPos can
 * respond with 429 (rate limit) or 5xx (overload), which used to surface to the user as
 * "log in to NosPos first" because the legacy login detector treated any non-2xx as
 * login-required. The detector is now tightened, AND we transparently retry transient
 * failures here so the modal never has to ask the user to click Retry for a glitch.
 *
 * Retry policy:
 *   - 429 / 5xx / network error → retry up to 3 attempts with exponential backoff
 *     (400ms, 900ms, 1600ms) plus jitter.
 *   - Honour `Retry-After` (seconds or HTTP-date) when NosPos sends one.
 *   - 401/403/login-redirect → stop immediately; return loginRequired.
 *   - 4xx (other) / parsed result / network give-up → return as normal.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */

const NOSPOS_SEARCH_RETRY_DELAYS_MS = [400, 900, 1600];

function nosposSearchParseRetryAfter(headerValue) {
  if (!headerValue) return null;
  var raw = String(headerValue).trim();
  if (!raw) return null;
  var asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && String(asInt) === raw) {
    return Math.min(Math.max(asInt * 1000, 0), 10000);
  }
  var ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    return Math.min(Math.max(ts - Date.now(), 0), 10000);
  }
  return null;
}

function nosposSearchSleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function handleBridgeAction_searchNosposBarcode({ requestId, appTabId, payload }) {
  const barcode = (payload.barcode || '').trim();
  if (!barcode) return { ok: false, error: 'No barcode provided' };
  const searchUrl = `https://nospos.com/stock/search/index?StockSearchAndFilter[query]=${encodeURIComponent(barcode)}&sort=-quantity`;

  let lastError = null;
  for (let attempt = 0; attempt <= NOSPOS_SEARCH_RETRY_DELAYS_MS.length; attempt += 1) {
    let response;
    try {
      response = await fetch(searchUrl, {
        credentials: 'include',
        headers: NOSPOS_HTML_FETCH_HEADERS,
      });
    } catch (e) {
      // Network blip — eligible for retry.
      lastError = e?.message || 'Network error';
      if (attempt < NOSPOS_SEARCH_RETRY_DELAYS_MS.length) {
        const base = NOSPOS_SEARCH_RETRY_DELAYS_MS[attempt];
        await nosposSearchSleep(base + Math.floor(Math.random() * 200));
        continue;
      }
      return { ok: false, error: lastError };
    }

    const finalUrl = response.url || '';
    if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
      return { ok: false, loginRequired: true };
    }

    // Throttling / transient server errors → backoff + retry. Honour Retry-After if present.
    if (response.status === 429 || response.status >= 500) {
      lastError = `NosPos returned ${response.status}`;
      if (attempt < NOSPOS_SEARCH_RETRY_DELAYS_MS.length) {
        const hinted = nosposSearchParseRetryAfter(response.headers?.get?.('Retry-After'));
        const base = NOSPOS_SEARCH_RETRY_DELAYS_MS[attempt];
        const delay = hinted != null ? Math.max(hinted, base) : base + Math.floor(Math.random() * 200);
        await nosposSearchSleep(delay);
        continue;
      }
      return { ok: false, error: lastError };
    }

    if (!response.ok) {
      // Genuine 4xx (other than auth) — not retryable, surface to caller.
      return { ok: false, error: `NosPos returned ${response.status}` };
    }

    try {
      const html = await response.text();
      const isDirectStockEditHit = /^https:\/\/[^/]*nospos\.com\/stock\/\d+\/edit\/?(\?.*)?$/i.test(finalUrl);
      const results = isDirectStockEditHit
        ? parseNosposStockEditResult(html, finalUrl)
        : parseNosposSearchResults(html);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e?.message || 'Search failed' };
    }
  }

  return { ok: false, error: lastError || 'Search failed' };
}
