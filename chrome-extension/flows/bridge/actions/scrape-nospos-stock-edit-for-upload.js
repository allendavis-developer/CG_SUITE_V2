/**
 * Fetch a NosPos stock/edit page in the background and return parsed fields for the upload flow.
 *
 * Uses the same retry-with-backoff guard as `searchNosposBarcode` so a momentary 429/5xx
 * (very common when many close-listings checks run back-to-back, since each barserial does
 * search + edit) doesn't surface as a spurious "log in to NosPos first" or force the user
 * to manually click Retry.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */

const NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS = [400, 900, 1600];

function nosposStockEditParseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const raw = String(headerValue).trim();
  if (!raw) return null;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && String(asInt) === raw) {
    return Math.min(Math.max(asInt * 1000, 0), 10000);
  }
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    return Math.min(Math.max(ts - Date.now(), 0), 10000);
  }
  return null;
}

function nosposStockEditSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleBridgeAction_scrapeNosposStockEditForUpload({ requestId, appTabId, payload }) {
  const stockUrl = String(payload.stockUrl || '').trim();
  if (!stockUrl) return { ok: false, error: 'No stock URL' };
  const editUrl = normalizeNosposStockEditUrl(stockUrl);
  if (!editUrl) return { ok: false, error: 'Invalid stock URL' };

  let lastError = null;
  for (let attempt = 0; attempt <= NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS.length; attempt += 1) {
    let response;
    try {
      response = await fetch(editUrl, {
        credentials: 'include',
        headers: NOSPOS_HTML_FETCH_HEADERS,
      });
    } catch (e) {
      lastError = e?.message || 'Scrape failed';
      if (attempt < NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS.length) {
        const base = NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS[attempt];
        await nosposStockEditSleep(base + Math.floor(Math.random() * 200));
        continue;
      }
      return { ok: false, error: lastError };
    }

    const finalUrl = response.url || '';
    if (nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl)) {
      return { ok: false, loginRequired: true };
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = `NosPos returned ${response.status}`;
      if (attempt < NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS.length) {
        const hinted = nosposStockEditParseRetryAfter(response.headers?.get?.('Retry-After'));
        const base = NOSPOS_STOCK_EDIT_RETRY_DELAYS_MS[attempt];
        const delay = hinted != null ? Math.max(hinted, base) : base + Math.floor(Math.random() * 200);
        await nosposStockEditSleep(delay);
        continue;
      }
      return { ok: false, error: lastError };
    }
    if (!response.ok) {
      return { ok: false, error: `NosPos returned ${response.status}` };
    }

    try {
      const html = await response.text();
      return { ok: true, details: parseNosposStockEditPageDetails(html) };
    } catch (e) {
      return { ok: false, error: e?.message || 'Scrape failed' };
    }
  }

  return { ok: false, error: lastError || 'Scrape failed' };
}
