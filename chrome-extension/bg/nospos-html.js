/**
 * NosPos HTML fetch, parse, and login detection utilities.
 * Globals: NOSPOS_HTML_FETCH_HEADERS, nosposHtmlFetchIndicatesNotLoggedIn,
 *          decodeNosposHtmlText, getStockNameFromEditHtml,
 *          parseNosposSearchResults, parseNosposStockEditResult,
 *          normalizeNosposStockEditUrl, parseNosposStockEditPageDetails,
 *          handleFetchAddressSuggestions
 */

var NOSPOS_HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function nosposHtmlFetchIndicatesNotLoggedIn(response, finalUrl) {
  var url = (finalUrl || response?.url || '').toLowerCase();
  if (!response?.ok) return true;
  return (
    url.includes('/login') ||
    url.includes('/signin') ||
    url.includes('/site/standard-login') ||
    url.includes('/twofactor')
  );
}

function decodeNosposHtmlText(value) {
  return (value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStockNameFromEditHtml(html) {
  var byId = html.match(/<input[^>]+id="stock-name"[^>]*>/i);
  var byName = html.match(/<input[^>]+name="Stock\[name\]"[^>]*>/i);
  var tag = (byId || byName)?.[0] || '';
  var valueMatch = tag.match(/\bvalue="([^"]*)"/i);
  return decodeNosposHtmlText(valueMatch?.[1] || '');
}

function parseNosposSearchResults(html) {
  var results = [];
  var rowRe = /<tr[^>]+data-key="\d+"[^>]*>([\s\S]*?)<\/tr>/gi;
  var rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    var rowHtml = rowMatch[1];
    var cells = [];
    var cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 5) continue;

    var linkMatch = cells[0].match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i);
    var href = linkMatch ? linkMatch[1].replace(/&amp;/g, '&') : '';
    var barserial = linkMatch ? linkMatch[2].trim() : '';

    var titleAttr = cells[1].match(/(?:data-original-title|title)="([^"]+)"/i);
    var name = titleAttr
      ? decodeNosposHtmlText(titleAttr[1])
      : cells[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    var costPrice = cells[2].replace(/<[^>]*>/g, '').trim();
    var retailPrice = cells[3].replace(/<[^>]*>/g, '').trim();
    var quantity = cells[4].replace(/<[^>]*>/g, '').trim();

    if (barserial || href) {
      results.push({ barserial: barserial, href: href, name: name, costPrice: costPrice, retailPrice: retailPrice, quantity: quantity });
    }
  }
  return results;
}

/** Ensure `/stock/{id}/edit` URL for credentialed fetch of cost/retail + detail rows. */
function normalizeNosposStockEditUrl(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  if (s.indexOf('//') === -1) {
    s = 'https://nospos.com' + (s.charAt(0) === '/' ? s : '/' + s);
  }
  var path;
  try {
    path = new URL(s).pathname.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
  var m = path.match(/^\/stock\/(\d+)(\/edit)?$/i);
  if (m) return 'https://nospos.com/stock/' + m[1] + '/edit';
  m = path.match(/^\/stock\/(\d+)/i);
  if (m) return 'https://nospos.com/stock/' + m[1] + '/edit';
  return s;
}

/** From stock edit HTML: name input, detail rows, cost/retail inputs. */
function parseNosposStockEditPageDetails(html) {
  function detailForLabel(label) {
    var esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp(
      '<div[^>]*class="[^"]*\\bdetail\\b[^"]*"[^>]*>\\s*<strong>\\s*' + esc + '\\s*</strong>\\s*<span>([\\s\\S]*?)</span>\\s*</div>',
      'i'
    );
    var m = html.match(re);
    return decodeNosposHtmlText((m ? m[1] : '').replace(/<[^>]*>/g, ' '));
  }
  var boughtBy = detailForLabel('Bought By');
  var createdAt = detailForLabel('Created');
  var costM = html.match(/id="stock-cost_price"[^>]*\bvalue="([^"]*)"/i);
  var retailM = html.match(/id="stock-retail_price"[^>]*\bvalue="([^"]*)"/i);
  var costPrice = decodeNosposHtmlText(costM ? costM[1] : '');
  var retailPrice = decodeNosposHtmlText(retailM ? retailM[1] : '');
  var name = getStockNameFromEditHtml(html);
  return {
    name: name || '',
    boughtBy: boughtBy || '',
    createdAt: createdAt || '',
    costPrice: costPrice || '',
    retailPrice: retailPrice || '',
  };
}

function parseNosposStockEditResult(html, finalUrl) {
  var barserialMatch = html.match(
    /<div[^>]*class="detail"[^>]*>\s*<strong>\s*Barserial\s*<\/strong>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/i
  );
  var barserial = decodeNosposHtmlText(
    (barserialMatch?.[1] || '').replace(/<[^>]*>/g, ' ')
  );
  if (!barserial) return [];

  var href = '';
  try {
    href = new URL(finalUrl).pathname || '';
  } catch (_) {
    href = '';
  }

  var titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  var stockNameFromInput = getStockNameFromEditHtml(html);
  var name = stockNameFromInput || decodeNosposHtmlText((titleMatch?.[1] || '').replace(/\s*-\s*Nospos\s*$/i, ''));

  return [{
    barserial: barserial,
    href: href,
    name: name,
    costPrice: '',
    retailPrice: '',
    quantity: ''
  }];
}

async function handleFetchAddressSuggestions(message) {
  var raw = (message.postcode || '').trim().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
  var postcode = raw.toUpperCase();
  if (!postcode || postcode.replace(/\s/g, '').length < 4) {
    return { ok: true, addresses: [] };
  }
  var bases = ['http://127.0.0.1:8000', 'http://localhost:8000'];
  for (var i = 0; i < bases.length; i++) {
    var base = bases[i];
    try {
      var url = base + '/api/address-lookup/' + encodeURIComponent(postcode) + '/';
      var resp = await fetch(url);
      if (!resp.ok) {
        var err = await resp.json().catch(function () { return {}; });
        return { ok: false, error: err.error || 'HTTP ' + resp.status };
      }
      var data = await resp.json();
      var addresses = data.addresses || [];
      return { ok: true, addresses: Array.isArray(addresses) ? addresses : [] };
    } catch (e) {
      if (i < bases.length - 1) continue;
      return { ok: false, error: (e?.message || 'Network error') + '. Is Django running at http://127.0.0.1:8000?' };
    }
  }
  return { ok: false, error: 'Could not reach address lookup service' };
}
