/**
 * Web EPOS product-scraping flow: in-page table scrape with waits, navigate-for-bridge,
 * and scrape-and-respond orchestration.
 */

async function scrapeWebEposProductsTableInPageWithWait(maxWaitMs) {
  const ms = Math.min(Math.max(Number(maxWaitMs) || 25000, 5000), 180000);
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const globalDeadline = Date.now() + ms;
  const MAX_PAGES = 200;

  function rowLooksLikeProduct(tr) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 5) return false;
    const t = String(cells[0].textContent || '').trim();
    if (t.length < 4) return false;
    return true;
  }

  function scoreProductRows(table) {
    let n = 0;
    if (!table) return 0;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (rowLooksLikeProduct(tr)) n += 1;
    });
    return n;
  }

  /** Prefer the table with the most valid product rows (avoids grabbing a small/static table before the real grid). */
  function findProductsTable() {
    const seen = new Set();
    const list = [];
    const selectors = [
      '.col-sm-12 table',
      'div.col-sm-12 table',
      'table.table',
      'main table',
      '[class*="product"] table',
      'article table',
      '#root table',
      'body table',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      document.querySelectorAll(selectors[i]).forEach((t) => {
        if (t && !seen.has(t)) {
          seen.add(t);
          list.push(t);
        }
      });
    }
    if (list.length === 0) {
      document.querySelectorAll('table').forEach((t) => {
        if (!seen.has(t)) {
          seen.add(t);
          list.push(t);
        }
      });
    }
    let best = null;
    let bestScore = 0;
    for (let k = 0; k < list.length; k += 1) {
      const t = list[k];
      const s = scoreProductRows(t);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function isUsableNextButton(b) {
    if (!b) return false;
    if (b.disabled) return false;
    if (b.classList.contains('disabled')) return false;
    if (String(b.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
    return true;
  }

  /**
   * Must not use container.querySelector('.paging') — that returns the *first* pager in the tree,
   * often a header/stub with no working Next, so we never click and only scrape page 1.
   */
  function findPagingNearTable(table) {
    const all = Array.from(document.querySelectorAll('.paging'));
    if (all.length === 0) return null;
    const hasUsableNext = (root) =>
      Array.from(root.querySelectorAll('button.next')).some(isUsableNextButton);

    if (!table) {
      for (let i = 0; i < all.length; i += 1) {
        if (hasUsableNext(all[i])) return all[i];
      }
      return all[0];
    }

    for (let i = 0; i < all.length; i += 1) {
      const p = all[i];
      const pos = table.compareDocumentPosition(p);
      if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
      if (!hasUsableNext(p)) continue;
      return p;
    }

    let n = table.nextElementSibling;
    for (let i = 0; i < 8 && n; i += 1) {
      if (n.matches && n.matches('.paging') && hasUsableNext(n)) return n;
      const inner = n.querySelector ? n.querySelector(':scope .paging') : null;
      if (inner && hasUsableNext(inner)) return inner;
      n = n.nextElementSibling;
    }

    for (let i = 0; i < all.length; i += 1) {
      if (hasUsableNext(all[i])) return all[i];
    }
    return all[0];
  }

  function extractFromTable(table) {
    const thead = table.querySelector('thead tr');
    const headers = thead
      ? Array.from(thead.querySelectorAll('th')).map((th) =>
          String(th.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
        )
      : [];
    const rows = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (!rowLooksLikeProduct(tr)) return;
      const cells = tr.querySelectorAll('td');
      const bcLink = cells[0].querySelector('a');
      const lastCell = cells[cells.length - 1];
      const extLink =
        lastCell && lastCell.querySelector ? lastCell.querySelector('a[href^="http"]') : null;
      let productHref = bcLink ? bcLink.getAttribute('href') : null;
      if (productHref && productHref.startsWith('/') && host) {
        productHref = `https://${host}${productHref}`;
      }
      rows.push({
        barcode: (bcLink ? bcLink.textContent : cells[0].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        productHref,
        productName: String(cells[1].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        price: String(cells[2].textContent || '').trim(),
        quantity: String(cells[3].textContent || '').trim(),
        status: String(cells[4].textContent || '')
          .trim()
          .replace(/\s+/g, ' '),
        retailUrl: extLink && extLink.href ? extLink.href : null,
      });
    });
    const pagingRoot = findPagingNearTable(table);
    const pagingEl = pagingRoot ? pagingRoot.querySelector('p') : null;
    return {
      ok: true,
      headers,
      rows,
      pagingText: pagingEl
        ? String(pagingEl.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
        : null,
      pageUrl: typeof location !== 'undefined' ? location.href : '',
    };
  }

  function readPagingMeta(pagingRoot) {
    const root = pagingRoot || findPagingNearTable(findProductsTable());
    const el = root ? root.querySelector('p') : document.querySelector('.paging p');
    const raw = el
      ? String(el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
      : '';
    const m = raw.match(/\bpage\s+(\d+)\s+of\s+(\d+)\b/i);
    let current = m ? Number(m[1]) : null;
    let total = m ? Number(m[2]) : null;
    if (root && (total == null || Number.isNaN(total))) {
      const tsp = root.querySelector('.total-page-count');
      const tm = tsp && String(tsp.textContent || '').match(/(\d+)/);
      if (tm) total = Number(tm[1]);
    }
    if (current != null && Number.isNaN(current)) current = null;
    if (total != null && Number.isNaN(total)) total = null;
    return { raw, current, total };
  }

  function pickNextFromPagingRoot(root) {
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll('button.next')).filter(isUsableNextButton);
    if (buttons.length === 0) return null;
    const single = buttons.find((b) => String(b.textContent || '').trim() === '»');
    return single || buttons[0];
  }

  function findNextPageButton(pagingRoot) {
    const direct = pickNextFromPagingRoot(pagingRoot);
    if (direct) return direct;
    const pagings = document.querySelectorAll('.paging');
    for (let i = 0; i < pagings.length; i += 1) {
      const b = pickNextFromPagingRoot(pagings[i]);
      if (b) return b;
    }
    return null;
  }

  function triggerClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    try {
      el.focus();
    } catch (_) {}
    try {
      if (typeof el.click === 'function') el.click();
    } catch (_) {}
    try {
      el.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      );
    } catch (_) {}
  }

  function tableBarcodeSignature(table) {
    const parts = [];
    if (!table) return '';
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (!rowLooksLikeProduct(tr)) return;
      const cells = tr.querySelectorAll('td');
      const bc = String(cells[0].textContent || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (bc) parts.push(bc);
    });
    const joined = parts.join('|');
    return joined.length > 4000 ? joined.slice(0, 4000) : joined;
  }

  function tryJumpToPageNum(targetPage, pagingRoot) {
    const root = pagingRoot || document.querySelector('.paging');
    const jump = root
      ? root.querySelector('.jump-to-page')
      : document.querySelector('.paging .jump-to-page') || document.querySelector('.jump-to-page');
    if (!jump) return false;
    const inp = jump.querySelector('input[type="number"]');
    const go =
      jump.querySelector('button.go-to-page-button') ||
      (root && root.querySelector('button.go-to-page-button')) ||
      document.querySelector('.paging button.go-to-page-button');
    if (!inp || !go) return false;
    try {
      inp.focus();
    } catch (_) {}
    inp.value = String(targetPage);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    triggerClick(go);
    return true;
  }

  let table = null;
  while (Date.now() < globalDeadline) {
    table = findProductsTable();
    if (table && scoreProductRows(table) > 0) break;
    await sleep(350);
  }
  if (!table || scoreProductRows(table) === 0) {
    return { ok: false, error: 'Products table not found on this page.' };
  }

  const allRows = [];
  let headers = [];
  const pagePagingTexts = [];
  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx += 1) {
    table = findProductsTable();
    if (!table || scoreProductRows(table) === 0) {
      if (pageIdx === 0) {
        return { ok: false, error: 'Products table not found on this page.' };
      }
      break;
    }

    const extracted = extractFromTable(table);
    if (!extracted.ok) return extracted;
    if (pageIdx === 0) headers = extracted.headers;
    allRows.push(...extracted.rows);
    if (extracted.pagingText) pagePagingTexts.push(extracted.pagingText);

    const pagingRoot = findPagingNearTable(table);
    const metaAfter = readPagingMeta(pagingRoot);
    if (
      metaAfter.current != null &&
      metaAfter.total != null &&
      metaAfter.current >= metaAfter.total
    ) {
      break;
    }

    const nextBtn = findNextPageButton(pagingRoot);
    if (!nextBtn) break;

    const prevSig = tableBarcodeSignature(table);
    const prevPage = metaAfter.current;
    triggerClick(nextBtn);

    /**
     * Pager text ("page 2 of 2") often updates before tbody rows swap; do not treat meta alone as done.
     * Wait until product barcode signature changes, then re-read once so React has committed.
     */
    let navOk = false;
    while (Date.now() < globalDeadline) {
      await sleep(400);
      const t2 = findProductsTable();
      if (!t2 || scoreProductRows(t2) === 0) continue;
      const sig2 = tableBarcodeSignature(t2);
      if (!sig2 || sig2 === prevSig) continue;
      await sleep(180);
      const t3 = findProductsTable();
      if (!t3 || scoreProductRows(t3) === 0) continue;
      const sig3 = tableBarcodeSignature(t3);
      if (sig3 === sig2) {
        table = t3;
        navOk = true;
        break;
      }
    }

    if (!navOk && prevPage != null && metaAfter.total != null && prevPage < metaAfter.total) {
      tryJumpToPageNum(prevPage + 1, pagingRoot);
      while (Date.now() < globalDeadline) {
        await sleep(400);
        const t3 = findProductsTable();
        if (!t3 || scoreProductRows(t3) === 0) continue;
        const sig3 = tableBarcodeSignature(t3);
        if (!sig3 || sig3 === prevSig) continue;
        await sleep(180);
        const t4 = findProductsTable();
        if (!t4 || scoreProductRows(t4) === 0) continue;
        const sig4 = tableBarcodeSignature(t4);
        if (sig4 === sig3) {
          table = t4;
          navOk = true;
          break;
        }
      }
    }

    if (!navOk) break;
  }

  const pagingText =
    pagePagingTexts.length <= 1
      ? pagePagingTexts[0] || null
      : `${pagePagingTexts[0]} · ${pagePagingTexts.length} pages (${allRows.length} rows)`;

  return {
    ok: true,
    headers,
    rows: allRows,
    pagingText,
    pageUrl: typeof location !== 'undefined' ? location.href : '',
  };
}

/**
 * Web EPOS product `href`s are in-app routes (cold-open product URL → missing `storeId`).
 * Opens `/products` in a new tab in the app window (unfocused), runs list paging + real link click,
 * then focuses that tab only after the click succeeds. On failure the tab is closed.
 */
async function navigateWebEposProductInWorkerForBridge(appTabId, productHref, barcode) {
  const hrefRaw = String(productHref || '').trim();
  const code = String(barcode || '').trim();
  if (!hrefRaw) {
    return { ok: false, error: 'Missing product link.' };
  }
  let parsed;
  try {
    parsed = new URL(hrefRaw);
  } catch {
    return { ok: false, error: 'Invalid product link.' };
  }
  if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
    return { ok: false, error: 'Link is not a Web EPOS URL.' };
  }

  let appTab;
  try {
    appTab = await chrome.tabs.get(appTabId);
  } catch {
    return { ok: false, error: 'Could not read the CG Suite tab.' };
  }
  const windowId = appTab.windowId;

  let navTabId = null;
  try {
    const created = await chrome.tabs.create({
      windowId,
      url: WEB_EPOS_PRODUCTS_URL,
      active: false,
    });
    navTabId = created.id;
    await waitForTabLoadComplete(navTabId, 90000, 'Web EPOS products page load timed out');
    const loaded = await chrome.tabs.get(navTabId);
    const u = String(loaded.url || '').trim();
    if (!u) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Could not read Web EPOS URL after load.' };
    }
    let loadParsed;
    try {
      loadParsed = new URL(u);
    } catch {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Invalid Web EPOS URL after load.' };
    }
    if (loadParsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'Not on Web EPOS after load.' };
    }
    const loadPath = (loadParsed.pathname || '/').toLowerCase();
    if (WEB_EPOS_LOGIN_PATH.test(loadPath)) {
      await chrome.tabs.remove(navTabId).catch(() => {});
      navTabId = null;
      return { ok: false, error: 'You must be logged into Web EPOS to open products.' };
    }
    await sleep(400);

    const injected = await chrome.scripting.executeScript({
      target: { tabId: navTabId },
      func: async (fullHref, barcodeText) => {
        const sleep = (t) => new Promise((r) => setTimeout(r, t));
        const MAX_PAGES = 200;

        function normPath(h) {
          try {
            const u = new URL(h, location.origin);
            return (u.pathname || '') + (u.search || '') + (u.hash || '');
          } catch {
            return String(h || '');
          }
        }

        const targetPath = normPath(fullHref);
        let targetAbs = '';
        try {
          targetAbs = new URL(fullHref).href;
        } catch (_) {}

        function tryClickFromDom() {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (let i = 0; i < anchors.length; i += 1) {
            const a = anchors[i];
            const raw = a.getAttribute('href') || '';
            if (!raw) continue;
            if (normPath(raw) === targetPath) {
              a.click();
              return true;
            }
            if (targetAbs && a.href === targetAbs) {
              a.click();
              return true;
            }
          }
          const want = String(barcodeText || '')
            .trim()
            .replace(/\s+/g, ' ');
          if (want) {
            const rows = document.querySelectorAll('tbody tr');
            for (let j = 0; j < rows.length; j += 1) {
              const tr = rows[j];
              const cell0 = tr.querySelector('td');
              if (!cell0) continue;
              const text = String(cell0.textContent || '')
                .trim()
                .replace(/\s+/g, ' ');
              if (text === want) {
                const link = cell0.querySelector('a');
                if (link) {
                  link.click();
                  return true;
                }
              }
            }
          }
          return false;
        }

        function isUsableNextButton(b) {
          if (!b) return false;
          if (b.disabled) return false;
          if (b.classList.contains('disabled')) return false;
          if (String(b.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
          return true;
        }

        function pickNextButton() {
          const buttons = Array.from(document.querySelectorAll('.paging button.next')).filter(
            isUsableNextButton
          );
          if (buttons.length === 0) return null;
          const single = buttons.find((b) => String(b.textContent || '').trim() === '»');
          return single || buttons[0];
        }

        async function jumpToProductsPageOne() {
          const jump =
            document.querySelector('.paging .jump-to-page') ||
            document.querySelector('.jump-to-page');
          const inp = jump && jump.querySelector('input[type="number"]');
          const go =
            (jump && jump.querySelector('button.go-to-page-button')) ||
            document.querySelector('.paging button.go-to-page-button');
          if (!inp || !go) return false;
          try {
            inp.focus();
          } catch (_) {}
          inp.value = '1';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          try {
            go.click();
          } catch (_) {}
          await sleep(650);
          return true;
        }

        await jumpToProductsPageOne();

        for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx += 1) {
          if (tryClickFromDom()) {
            return { ok: true, via: 'paged', pageIdx };
          }
          const nextBtn = pickNextButton();
          if (!nextBtn) break;
          nextBtn.click();
          await sleep(500);
        }

        return { ok: false, error: 'NOT_FOUND' };
      },
      args: [hrefRaw, code],
    });
    const res = injected && injected[0] ? injected[0].result : null;
    if (!res || !res.ok) {
      if (navTabId != null) {
        await chrome.tabs.remove(navTabId).catch(() => {});
        navTabId = null;
      }
      return {
        ok: false,
        error:
          res && res.error === 'NOT_FOUND'
            ? 'That product was not found in the Web EPOS list (try again after the table has fully loaded).'
            : (res && res.error) || 'Could not open the product in Web EPOS.',
      };
    }

    const t = await chrome.tabs.get(navTabId);
    if (t.windowId != null) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(navTabId, { active: true }).catch(() => {});
    return { ok: true };
  } catch (e) {
    if (navTabId != null) {
      await chrome.tabs.remove(navTabId).catch(() => {});
    }
    return {
      ok: false,
      error: e && e.message ? String(e.message) : 'Could not open Web EPOS.',
    };
  }
}

async function scrapeWebEposProductsAndRespond(requestId, appTabId) {
  const respondErr = async (msg) => {
    if (!appTabId) return;
    chrome.tabs
      .sendMessage(appTabId, {
        type: 'EXTENSION_RESPONSE_TO_PAGE',
        requestId,
        error: msg,
      })
      .catch(() => {});
    await focusAppTab(appTabId);
  };

  try {
    const session = await readWebEposUploadSession();
    if (
      !session?.workerTabId ||
      Number(session.appTabId) !== Number(appTabId)
    ) {
      await respondErr(
        'No Web EPOS window for this session. Open the Upload module and wait for Web EPOS to load.'
      );
      return;
    }
    let tabId = session.workerTabId;
    try {
      await chrome.tabs.get(tabId);
    } catch {
      await respondErr(
        'The Web EPOS window was closed. Reopen it from the launchpad prompt.'
      );
      return;
    }
    await chrome.tabs.update(tabId, { url: WEB_EPOS_PRODUCTS_URL });
    await waitForTabLoadComplete(tabId, 90000, 'Web EPOS products page load timed out');
    const tab = await chrome.tabs.get(tabId);
    const u = (tab.url || '').trim();
    if (!u) {
      await respondErr('Could not read Web EPOS URL.');
      return;
    }
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      await respondErr('Invalid Web EPOS URL.');
      return;
    }
    if (parsed.hostname.toLowerCase() !== WEB_EPOS_UPLOAD_HOST) {
      await respondErr('Not on Web EPOS.');
      return;
    }
    const path = (parsed.pathname || '/').toLowerCase();
    if (WEB_EPOS_LOGIN_PATH.test(path)) {
      await respondErr('You must be logged into Web EPOS to view products.');
      return;
    }
    await sleep(400);
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrapeWebEposProductsTableInPageWithWait,
      args: [120000],
    });
    const payload = injected && injected[0] ? injected[0].result : null;
    if (!payload || !payload.ok) {
      await respondErr(payload?.error || 'Could not read products from Web EPOS.');
      return;
    }
    await notifyAppExtensionResponse(appTabId, requestId, {
      ok: true,
      headers: payload.headers,
      rows: payload.rows,
      pagingText: payload.pagingText,
      pageUrl: payload.pageUrl,
    });
    try {
      const s2 = await readWebEposUploadSession();
      const lastUrl = payload.pageUrl || s2?.lastUrl || WEB_EPOS_PRODUCTS_URL;
      if (s2 && Number(s2.appTabId) === Number(appTabId)) {
        await writeWebEposUploadSession({
          workerTabId: null,
          appTabId,
          lastUrl,
        });
      }
      await removeWebEposWorkerByTabId(tabId);
    } catch (_) {}
  } catch (e) {
    await respondErr(e?.message || 'Failed to load Web EPOS products.');
  }
}
