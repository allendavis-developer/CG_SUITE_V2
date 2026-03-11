/**
 * CG Suite Research – content script for nospos.com (repricing flow).
 *
 * Runs on nospos.com and *.nospos.com.
 *
 * Flow:
 * 1. Extension opens nospos.com. If on login page → wait (user will redirect).
 * 2. If on main nospos.com site → send NOSPOS_PAGE_READY. Background navigates to /stock/search.
 * 3. On /stock/search → fill search, submit. User clicks a result → /stock/:id/edit.
 * 4. On /stock/:id/edit → fill retail_price, click Save. Wait for page load.
 * 5. Navigate to /stock/search, fill next barcode, repeat until all items/barcodes done.
 * 6. When done, background focuses app tab.
 */
(function () {
  const LOGIN_PATH_PATTERN = /^\/(login|signin|sign-in|auth|log-in|session|sessions|account\/login)(\/|$)/i;
  const LOGIN_SUBDOMAINS = ['login', 'auth', 'signin', 'sso', 'accounts'];
  const STOCK_SEARCH_PAGE = '/stock/search';
  const STOCK_SEARCH_PAGE_PATTERN = /^\/stock\/search(?:\/index)?\/?$/i;
  const STOCK_EDIT_PAGE_PATTERN = /^\/stock\/\d+\/edit\/?$/i;

  function isOnLoginPage() {
    try {
      const host = (window.location.hostname || '').toLowerCase().replace(/^www\./, '');
      if (host.startsWith('nospos.com')) {
        const subdomain = window.location.hostname.toLowerCase().replace('.nospos.com', '').replace('www.', '');
        if (LOGIN_SUBDOMAINS.includes(subdomain)) return true;
      }
      const path = (window.location.pathname || '/').toLowerCase();
      return LOGIN_PATH_PATTERN.test(path);
    } catch (e) {
      return false;
    }
  }

  function isOnNosposDomain() {
    try {
      const host = (window.location.hostname || '').toLowerCase();
      return host === 'nospos.com' || host.endsWith('.nospos.com');
    } catch (e) {
      return false;
    }
  }

  function isOnStockSearchPage() {
    try {
      const path = (window.location.pathname || '').toLowerCase();
      return STOCK_SEARCH_PAGE_PATTERN.test(path);
    } catch (e) {
      return false;
    }
  }

  function isOnStockEditPage() {
    try {
      const path = (window.location.pathname || '/').toLowerCase();
      return STOCK_EDIT_PAGE_PATTERN.test(path);
    } catch (e) {
      return false;
    }
  }

  function sendPageReady() {
    if (!isOnNosposDomain()) return;
    if (isOnLoginPage()) return;

    chrome.runtime.sendMessage({ type: 'NOSPOS_PAGE_READY' }).catch(function () {});
  }

  function fillStockSearchInput(firstBarcode) {
    if (!firstBarcode) return;
    const input = document.getElementById('stocksearchandfilter-query') ||
      document.querySelector('input[name="StockSearchAndFilter[query]"]');
    if (input) {
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = firstBarcode;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Press Enter to submit the search
      const form = input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        const submitBtn = input.closest('.input-group')?.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
        else {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      }
    }
  }

  function fillRetailPriceInput(salePrice) {
    if (salePrice === '') return;
    const input = document.getElementById('stock-retail_price') ||
      document.querySelector('input[name="Stock[retail_price]"]');
    if (input) {
      input.value = salePrice;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function onStockSearchPageLoad() {
    chrome.runtime.sendMessage({ type: 'NOSPOS_STOCK_SEARCH_READY' }, function (response) {
      if (response?.ok && response.firstBarcode) {
        fillStockSearchInput(response.firstBarcode);
      }
    });
  }

  function clickSaveButton() {
    const btn = document.querySelector('button.btn.btn-blue[type="submit"]') ||
      Array.from(document.querySelectorAll('button.btn.btn-blue')).find(function (b) {
        return (b.textContent || '').trim().includes('Save');
      });
    if (btn) btn.click();
  }

  function sendStockEditReady(attempt) {
    const stockBarcode = getStockBarcodeFromPage();
    if (!stockBarcode && attempt < 10) {
      setTimeout(function () {
        sendStockEditReady(attempt + 1);
      }, 250);
      return;
    }

    chrome.runtime.sendMessage({
      type: 'NOSPOS_STOCK_EDIT_READY',
      oldRetailPrice: getRetailPriceFromPage(),
      stockBarcode
    }, function (response) {
      if (response?.ok && response.salePrice !== undefined) {
        fillRetailPriceInput(response.salePrice);
        setTimeout(function () { clickSaveButton(); }, 150);
      }
    });
  }

  function onStockEditPageLoad() {
    sendStockEditReady(0);
  }

  function getRetailPriceFromPage() {
    const input = document.getElementById('stock-retail_price') ||
      document.querySelector('input[name="Stock[retail_price]"]');
    return input ? (input.value || '').trim() : '';
  }

  function getStockBarcodeFromPage() {
    const details = Array.from(document.querySelectorAll('.detail'));
    const match = details.find(function (node) {
      const label = node.querySelector('strong');
      return (label?.textContent || '').trim().toLowerCase() === 'barserial';
    });
    const value = match?.querySelector('span');
    return value ? (value.textContent || '').trim() : '';
  }

  function sendPageLoaded() {
    if (!isOnNosposDomain() || isOnLoginPage()) return;
    const path = (window.location.pathname || '/').toLowerCase();
    const msg = { type: 'NOSPOS_PAGE_LOADED', path };
    if (isOnStockEditPage()) {
      msg.retailPrice = getRetailPriceFromPage();
      msg.stockBarcode = getStockBarcodeFromPage();
    }
    chrome.runtime.sendMessage(msg).catch(function () {});
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg.type === 'NOSPOS_VERIFY_RETAIL_PRICE') {
      sendPageLoaded();
      sendResponse({ ok: true });
    }
    return true;
  });

  function onLoad() {
    sendPageLoaded();

    if (document.readyState === 'complete') {
      if (isOnStockSearchPage()) {
        onStockSearchPageLoad();
      } else if (isOnStockEditPage()) {
        onStockEditPageLoad();
      } else {
        sendPageReady();
      }
    } else {
      window.addEventListener('load', function () {
        if (isOnStockSearchPage()) {
          onStockSearchPageLoad();
        } else if (isOnStockEditPage()) {
          onStockEditPageLoad();
        } else {
          sendPageReady();
        }
      }, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onLoad);
  } else {
    onLoad();
  }
})();
