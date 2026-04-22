/**
 * Read the cascading `#catLevel{1..N}` selects on a Web EPOS product edit page
 * (or any EPOS page that renders them) and return the selected option labels
 * per tab. Read-only — no page mutations.
 *
 * Used by the upload audit preview: while the tabs are open after navigation,
 * we reverse-engineer the product's CG category from its Web EPOS selects, so
 * each audit row can be pre-filled with a categoryObject without the user
 * having to pick one manually.
 *
 * Payload: { tabIds: number[] }
 * Response: { ok: true, byTabId: { [tabId]: { labels, uuids, error? } } }
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_scrapeWebEposCategorySelects({ payload }) {
  const ids = Array.isArray(payload?.tabIds)
    ? payload.tabIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];
  const byTabId = {};

  await Promise.all(
    ids.map(async (tabId) => {
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const labels = [];
            const uuids = [];
            const MAX_LEVELS = 10;
            for (let level = 1; level <= MAX_LEVELS; level += 1) {
              const sel = document.getElementById(`catLevel${level}`);
              if (!sel) break;
              const opt = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
              if (!opt || !opt.value) break;
              labels.push(String(opt.textContent || '').trim());
              uuids.push(String(opt.value || '').trim());
            }
            return { labels, uuids };
          },
        });
        const out = injected && injected[0] ? injected[0].result : null;
        byTabId[tabId] = out && Array.isArray(out.labels)
          ? { labels: out.labels, uuids: Array.isArray(out.uuids) ? out.uuids : [] }
          : { labels: [], uuids: [] };
      } catch (e) {
        byTabId[tabId] = { labels: [], uuids: [], error: e?.message || 'scrape failed' };
      }
    })
  );

  return { ok: true, byTabId };
}
