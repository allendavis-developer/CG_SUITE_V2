/**
 * Runs on ebay.co.uk and cashconverters.co.uk.
 * Injects a side panel: "Have you got the data yet?" [Yes].
 * On Yes, scrapes the page using site-specific config and sends data to the app.
 * DRY: one flow; site-specific logic in SITE_CONFIGS.
 */
(function () {
  let currentRequestId = null;

  // —— Site configs: one place for URL detection, search term, and card scraping ——
  const SITE_CONFIGS = {
    ebay: {
      competitor: 'eBay',
      isListingsPage(url) {
        return url.includes('ebay.co.uk') && !!document.querySelector('#srp-river-results > ul');
      },
      getSearchTerm() {
        return (document.querySelector('#gh-ac')?.value?.trim() || '');
      },
      getListContainer() {
        return document.querySelector('#srp-river-results > ul');
      },
      scrapeCards(container) {
        if (!container) return [];
        const results = [];
        const cards = container.querySelectorAll(':scope > li');
        cards.forEach(function (li) {
          const titleEl = li.querySelector('.s-card__title .su-styled-text.primary.default') ||
            li.querySelector('.s-card__title .su-styled-text, .s-card__title span');
          const priceEl = li.querySelector('.s-card__price');
          const linkEl = li.querySelector('a.s-card__link[href*="/itm/"]');
          const imgEl = li.querySelector('img.s-card__image');
          if (!titleEl || !priceEl) return;
          const title = (titleEl.textContent || '').trim();
          if (!title) return;
          const priceRaw = (priceEl.textContent || '').trim();
          const price = priceRaw.replace(/[^0-9.]/g, '').trim() || '0';
          let sold = null;
          const captionEl = li.querySelector('.s-card__caption');
          if (captionEl) {
            const captionText = (captionEl.textContent || '').trim();
            if (captionText && /sold/i.test(captionText)) sold = captionText;
          }
          if (!sold) {
            const primaryAttrs = li.querySelector('.su-card-container__attributes__primary');
            if (primaryAttrs) {
              const rows = primaryAttrs.querySelectorAll('.s-card__attribute-row');
              for (let r = 0; r < rows.length; r++) {
                const t = (rows[r].textContent || '').trim();
                if (/^\d+\s*sold$/i.test(t) || t.toLowerCase().includes(' sold')) {
                  sold = t;
                  break;
                }
              }
            }
          }
          results.push({
            title: title.slice(0, 200),
            price: price,
            url: linkEl ? linkEl.href : window.location.href,
            image: imgEl ? imgEl.src : null,
            sold: sold
          });
        });
        return results;
      }
    },
    cashconverters: {
      competitor: 'CashConverters',
      isListingsPage(url) {
        return url.includes('cashconverters.co.uk') && (/\/buy\//.test(url) || /\/search\//.test(url) || /\/c\//.test(url) || /search-results/.test(url) || /\/shop\//.test(url));
      },
      getSearchTerm() {
        const q = document.querySelector('input[name="query"], input[type="search"], [data-testid="search-input"]');
        return (q?.value?.trim() || '');
      },
      getListContainer() {
        return document.body;
      },
      scrapeCards(container) {
        const doc = container || document;
        const results = [];
        const cards = doc.querySelectorAll('.product-item-wrapper');
        const baseUrl = window.location.origin || (window.location.protocol + '//' + window.location.host);
        cards.forEach(function (el) {
          const titleEl = el.querySelector('.product-item__title__description');
          const shopEl = el.querySelector('.product-item__title__location');
          const priceEl = el.querySelector('.product-item__price');
          const linkEl = el.querySelector('a.product-item__title, .product-item__image a[href]');
          const imgEl = el.querySelector('.product-item__image img');
          if (!titleEl || !priceEl) return;
          const title = (titleEl.textContent || '').trim();
          if (!title) return;
          const shop = (shopEl && (shopEl.textContent || '').trim()) || null;
          const priceRaw = (priceEl.textContent || '').trim();
          const price = priceRaw.replace(/[^0-9.]/g, '').trim() || '0';
          let url = window.location.href;
          if (linkEl && linkEl.href) {
            try {
              url = linkEl.getAttribute('href').startsWith('/') ? (baseUrl + linkEl.getAttribute('href')) : linkEl.href;
            } catch (e) {}
          }
          let image = null;
          if (imgEl && imgEl.src) {
            try {
              image = imgEl.getAttribute('src') && imgEl.getAttribute('src').startsWith('/') ? (baseUrl + imgEl.getAttribute('src')) : imgEl.src;
            } catch (e) {}
          }
          results.push({
            title: title.slice(0, 200),
            price: price,
            url: url,
            image: image,
            sold: null,
            shop: shop
          });
        });
        return results;
      }
    }
  };

  function getSiteConfig() {
    const host = window.location.hostname || '';
    if (host.includes('ebay')) return SITE_CONFIGS.ebay;
    if (host.includes('cashconverters')) return SITE_CONFIGS.cashconverters;
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'WAITING_FOR_DATA') {
      currentRequestId = msg.requestId;
      showPanel(!!msg.isRefine);
      sendResponse({ ok: true });
    }
    return true;
  });

  function isListingsPage() {
    const config = getSiteConfig();
    return config ? config.isListingsPage(window.location.href) : false;
  }

  function maybeNotifyReady() {
    if (isListingsPage()) {
      chrome.runtime.sendMessage({ type: 'LISTING_PAGE_READY' }).catch(function () {});
    }
  }

  function showPanel(isRefine) {
    if (document.getElementById('cg-suite-research-panel')) return;

    const heading = isRefine ? 'Are you done?' : 'Have you got the data yet?';
    const buttonLabel = isRefine ? 'Yes, bring me back' : 'Yes';

    const panel = document.createElement('div');
    panel.id = 'cg-suite-research-panel';
    panel.innerHTML = `
      <div style="
        position: fixed; top: 50%; right: 0; transform: translateY(-50%);
        z-index: 2147483647; background: #1e3a8a; color: white;
        padding: 16px 20px; border-radius: 12px 0 0 12px; box-shadow: -4px 4px 20px rgba(0,0,0,0.2);
        font-family: system-ui, sans-serif; min-width: 200px;
      ">
        <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 14px;">${heading}</p>
        <button id="cg-suite-research-yes" style="
          width: 100%; padding: 10px 16px; background: #fbbf24; color: #1e3a8a;
          border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px;
        ">${buttonLabel}</button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('cg-suite-research-yes').addEventListener('click', function () {
      const data = scrapeListings();
      if (currentRequestId) {
        chrome.runtime.sendMessage({
          type: 'SCRAPED_DATA',
          requestId: currentRequestId,
          data: data
        });
        currentRequestId = null;
      }
      panel.remove();
    });
  }

  function scrapeListings() {
    const config = getSiteConfig();
    const competitor = config ? config.competitor : 'eBay';
    const searchTerm = config ? config.getSearchTerm() : '';
    const container = config ? config.getListContainer() : null;
    const results = config ? config.scrapeCards(container) : [];

    return {
      success: true,
      results: results,
      competitor: competitor,
      searchTerm: searchTerm,
      listingPageUrl: window.location.href
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeNotifyReady);
  } else {
    maybeNotifyReady();
  }
})();
