/**
 * Runs on ebay.co.uk and cashconverters.co.uk.
 * Injects a side panel: "Have you got the data yet?" [Yes].
 * On Yes, scrapes the page (placeholder selectors for now) and sends data to the app.
 */
(function () {
  let currentRequestId = null;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'WAITING_FOR_DATA') {
      currentRequestId = msg.requestId;
      showPanel(!!msg.isRefine);
      sendResponse({ ok: true });
    }
    return true;
  });

  // When script loads, if we're on a listings-like page, tell background we're ready
  // (Background may then assign us a requestId.)
  function maybeNotifyReady() {
    if (isListingsPage()) {
      chrome.runtime.sendMessage({ type: 'LISTING_PAGE_READY' }).catch(() => {});
    }
  }

  function isListingsPage() {
    const u = window.location.href;
    if (u.includes('ebay.co.uk')) {
      return !!document.querySelector('#srp-river-results > ul');
    }
    if (u.includes('cashconverters.co.uk')) {
      return /\/buy\//.test(u) || /\/search\//.test(u) || /\/c\//.test(u);
    }
    return false;
  }

  function showPanel(isRefine) {
    if (document.getElementById('cg-suite-research-panel')) return;

    const heading = isRefine ? "Are you done?" : "Have you got the data yet?";
    const buttonLabel = isRefine ? "Yes, bring me back" : "Yes";

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
          data
        });
        currentRequestId = null;
      }
      panel.remove();
    });
  }

  function scrapeListings() {
    const results = [];
    const site = window.location.hostname.includes('ebay') ? 'eBay' : 'CashConverters';
    const searchTerm = window.location.hostname.includes('ebay')
      ? (document.querySelector('#gh-ac')?.value?.trim() || '')
      : '';

    if (window.location.hostname.includes('ebay')) {
      const list = document.querySelector('#srp-river-results > ul');
      if (!list) {
        return { success: true, results: [], competitor: site, searchTerm, listingPageUrl: window.location.href };
      }
      const cards = list.querySelectorAll(':scope > li');
      cards.forEach(function (li) {
        // Title: prefer main title text (e.g. "Xbox Series X"), not "New listing"
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
        // Sold: caption (e.g. "Sold  20 Feb 2026") or attribute row (e.g. "289 sold")
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
    } else if (window.location.hostname.includes('cashconverters')) {
      // Placeholder Cash Converters selectors - to be replaced with real selectors
      const items = document.querySelectorAll('[data-testid="product-tile"], .product-card, .listing-card, .product');
      items.forEach((el) => {
        const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
        const priceEl = el.querySelector('[class*="price"], [data-testid*="price"]');
        const linkEl = el.querySelector('a[href]');
        const imgEl = el.querySelector('img');
        if (titleEl && priceEl) {
          results.push({
            title: (titleEl.textContent?.trim() || '').slice(0, 200),
            price: (priceEl.textContent?.replace(/[^0-9.]/g, '') || '0').trim(),
            url: linkEl?.href || window.location.href,
            image: imgEl?.src || null,
            sold: null
          });
        }
      });
    }

    return {
      success: true,
      results: results.length ? results : [],
      competitor: site,
      searchTerm,
      listingPageUrl: window.location.href
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeNotifyReady);
  } else {
    maybeNotifyReady();
  }
})();
