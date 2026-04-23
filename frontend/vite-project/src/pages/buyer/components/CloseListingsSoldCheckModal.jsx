import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import {
  closeTabsByIds,
  navigateWebEposProductInWorkerTab,
  searchNosposBarcode,
  scrapeNosposStockEditForUpload,
  setWebEposProductOnSaleOff,
} from '@/services/extensionClient';
import { extractWebEposBarserial } from '@/pages/buyer/webEposUploadConstants';
import { runWithConcurrency } from '@/pages/buyer/utils/runWithConcurrency';

/** Match the audit preview — opening a tab per item slams Web EPOS, 4-at-a-time stays fast without thrashing. */
const CLOSE_FLAGGED_MAX_CONCURRENCY = 4;

const STATUS_LABEL = {
  pending: { tone: 'text-slate-500', icon: 'schedule', label: 'Queued' },
  searching: { tone: 'text-brand-blue', icon: 'progress_activity', label: 'Searching NosPos…' },
  loading_stock: { tone: 'text-brand-blue', icon: 'progress_activity', label: 'Reading stock page…' },
  picker: { tone: 'text-amber-600', icon: 'rule', label: 'Multiple matches — pick one' },
  ok: { tone: 'text-emerald-600', icon: 'check_circle', label: 'Stock OK' },
  flagged: { tone: 'text-red-600', icon: 'warning', label: 'Free-stock < 1' },
  skipped: { tone: 'text-slate-400', icon: 'skip_next', label: 'Skipped' },
  error: { tone: 'text-red-500', icon: 'error', label: 'Error' },
};

/** Parse a NosPos quantity string ("3", "0", "1.00", "") to a finite number or null. */
function parseStockQuantity(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Two-phase popup:
 *
 *  Phase 1 (lookup): walks the queue, calls `searchNosposBarcode` + `scrapeNosposStockEditForUpload`
 *  for each row, and flags any row whose NosPos free-stock quantity is `< 1`. Mirrors the existing
 *  {@link RepricingBarcodeModal} status vocabulary. Zero-result NosPos lookups auto-skip — only
 *  multi-match rows pause the loop for the user.
 *
 *  Phase 2 (close flagged): when the user clicks "Close flagged items on Web EPOS", each flagged
 *  row is opened in a background worker tab (the canonical `navigateWebEposProductInWorkerTab`
 *  path), its "On Sale" toggle is flipped off + Save clicked via the shared bridge action, then
 *  the tab is closed. Runs with the same 4-worker pool the audit preview uses.
 *
 * @param {{
 *   rows: Array<{ barcode: string, rawBarcode?: string|null, productName?: string, productHref?: string|null }>,
 *   onClose: () => void,
 *   onFlaggedChange?: (map: Record<string, { quantity: number|null, stockName: string|null, stockUrl: string|null, productHref: string|null, productName: string }>) => void,
 *   showNotification?: (msg: string, tone?: 'info'|'success'|'warning'|'error') => void,
 * }} props
 */
export default function CloseListingsSoldCheckModal({
  rows,
  onClose,
  onFlaggedChange,
  showNotification,
}) {
  const queue = useMemo(
    () =>
      (Array.isArray(rows) ? rows : [])
        .map((r) => {
          const stripped = extractWebEposBarserial(r?.barcode ?? r?.rawBarcode ?? '');
          return stripped
            ? {
                barserial: stripped,
                rawBarcode: r?.rawBarcode ?? r?.barcode ?? '',
                productName: r?.productName ?? '',
                productHref: r?.productHref ?? null,
              }
            : null;
        })
        .filter(Boolean),
    [rows],
  );

  // ─── Phase 1: NosPos lookup ────────────────────────────────────────────────
  const [activeIdx, setActiveIdx] = useState(0);
  /** statusByBarserial[barserial] = { status, results?, stockUrl?, stockName?, quantity?, error? } */
  const [statusByBarserial, setStatusByBarserial] = useState({});
  /** Bumped whenever a barserial is re-queried so stale promises are ignored. */
  const runGenRef = useRef(new Map());

  // ─── Phase 2: close flagged on Web EPOS ────────────────────────────────────
  const [phase, setPhase] = useState('lookup'); // 'lookup' | 'closing' | 'closed'
  const [closingDone, setClosingDone] = useState(0);
  const [closingLog, setClosingLog] = useState([]);

  const total = queue.length;
  const active = queue[activeIdx] || null;
  const activeStatus = active ? statusByBarserial[active.barserial] : null;

  const flagged = useMemo(() => {
    const out = {};
    queue.forEach((row) => {
      const s = statusByBarserial[row.barserial];
      if (s?.status === 'flagged') {
        out[row.barserial] = {
          quantity: s.quantity ?? null,
          stockName: s.stockName ?? null,
          stockUrl: s.stockUrl ?? null,
          productHref: row.productHref ?? null,
          productName: row.productName ?? '',
        };
      }
    });
    return out;
  }, [queue, statusByBarserial]);

  useEffect(() => {
    onFlaggedChange?.(flagged);
  }, [flagged, onFlaggedChange]);

  const setStatus = useCallback((barserial, patch) => {
    setStatusByBarserial((prev) => ({ ...prev, [barserial]: { ...(prev[barserial] || {}), ...patch } }));
  }, []);

  const advance = useCallback(() => {
    setActiveIdx((idx) => Math.min(idx + 1, total));
  }, [total]);

  const fetchStockQuantity = useCallback(
    async (barserial, stockUrl, stockName) => {
      setStatus(barserial, { status: 'loading_stock', stockUrl, stockName });
      try {
        const r = await scrapeNosposStockEditForUpload(stockUrl);
        if (r?.loginRequired) {
          setStatus(barserial, { status: 'error', error: 'Log in to NosPos first.' });
          return;
        }
        if (!r?.ok || !r?.details) {
          setStatus(barserial, { status: 'error', error: r?.error || 'Could not load stock page.' });
          return;
        }
        const qtyNum = parseStockQuantity(r.details.quantity);
        const nextName = r.details.name || stockName || '';
        if (qtyNum != null && qtyNum < 1) {
          setStatus(barserial, {
            status: 'flagged',
            stockUrl,
            stockName: nextName,
            quantity: qtyNum,
          });
        } else {
          setStatus(barserial, {
            status: 'ok',
            stockUrl,
            stockName: nextName,
            quantity: qtyNum,
          });
        }
      } catch (e) {
        setStatus(barserial, { status: 'error', error: e?.message || 'Extension unavailable.' });
      }
    },
    [setStatus],
  );

  /** Run NosPos search for the current row; 0 results auto-skips, 1 result auto-selects and scrapes stock. */
  const runLookup = useCallback(
    async (row) => {
      const gen = (runGenRef.current.get(row.barserial) ?? 0) + 1;
      runGenRef.current.set(row.barserial, gen);
      setStatus(row.barserial, { status: 'searching', error: null, results: null });
      try {
        const result = await searchNosposBarcode(row.barserial);
        if (runGenRef.current.get(row.barserial) !== gen) return;
        if (result?.loginRequired) {
          setStatus(row.barserial, { status: 'error', error: 'Log in to NosPos first.' });
          showNotification?.('NosPos lookup needs you to be logged in first.', 'error');
          return;
        }
        if (!result?.ok) {
          setStatus(row.barserial, { status: 'error', error: result?.error || 'Search failed.' });
          return;
        }
        const matches = result.results || [];
        if (matches.length === 0) {
          // No NosPos match at all — nothing to audit; auto-skip so the loop keeps moving.
          setStatus(row.barserial, { status: 'skipped', results: [] });
          return;
        }
        if (matches.length === 1) {
          const only = matches[0];
          const stockUrl = `https://nospos.com${only.href}`;
          setStatus(row.barserial, {
            status: 'loading_stock',
            results: matches,
            stockUrl,
            stockName: only.name || '',
          });
          await fetchStockQuantity(row.barserial, stockUrl, only.name || '');
          return;
        }
        setStatus(row.barserial, { status: 'picker', results: matches });
      } catch (e) {
        if (runGenRef.current.get(row.barserial) !== gen) return;
        setStatus(row.barserial, { status: 'error', error: e?.message || 'Extension unavailable.' });
      }
    },
    [fetchStockQuantity, setStatus, showNotification],
  );

  // Kick off whichever row is active if it hasn't been processed yet. Defer the first setState
  // out of the effect body to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (phase !== 'lookup') return undefined;
    if (!active) return undefined;
    const current = statusByBarserial[active.barserial];
    if (current && current.status) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void runLookup(active);
    });
    return () => {
      cancelled = true;
    };
  }, [active, phase, runLookup, statusByBarserial]);

  // Auto-advance past terminal states that don't need user input.
  useEffect(() => {
    if (phase !== 'lookup' || !active || !activeStatus) return undefined;
    if (
      activeStatus.status === 'ok' ||
      activeStatus.status === 'flagged' ||
      activeStatus.status === 'skipped'
    ) {
      const t = setTimeout(advance, 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active, activeStatus, advance, phase]);

  const handlePick = useCallback(
    (match) => {
      if (!active) return;
      const stockUrl = `https://nospos.com${match.href}`;
      void fetchStockQuantity(active.barserial, stockUrl, match.name || '');
    },
    [active, fetchStockQuantity],
  );

  const handleRetryActive = useCallback(() => {
    if (!active) return;
    void runLookup(active);
  }, [active, runLookup]);

  const completedCount = useMemo(
    () =>
      queue.reduce((n, row) => {
        const s = statusByBarserial[row.barserial]?.status;
        return s === 'ok' || s === 'flagged' || s === 'skipped' ? n + 1 : n;
      }, 0),
    [queue, statusByBarserial],
  );
  const flaggedEntries = useMemo(() => Object.entries(flagged), [flagged]);
  const flaggedCount = flaggedEntries.length;
  const lookupFinished = activeIdx >= total;

  // ─── Phase 2: close flagged on Web EPOS (concurrent, max 4) ────────────────
  const appendLog = useCallback((level, message) => {
    setClosingLog((prev) => [
      ...prev,
      { timestamp: new Date().toISOString(), level, message },
    ]);
  }, []);

  const handleCloseFlaggedOnWebEpos = useCallback(async () => {
    if (flaggedCount === 0) return;
    setPhase('closing');
    setClosingDone(0);
    setClosingLog([]);

    appendLog(
      'info',
      `Closing ${flaggedCount} flagged listing${flaggedCount === 1 ? '' : 's'} on Web EPOS (max ${CLOSE_FLAGGED_MAX_CONCURRENCY} in parallel)…`,
    );

    const items = flaggedEntries.map(([barserial, meta]) => ({ barserial, ...meta }));

    await runWithConcurrency(
      items,
      async (item) => {
        const display = item.productName || item.barserial;
        if (!item.productHref) {
          appendLog('warn', `Skipped ${display} — no Web EPOS product link on the scraped row.`);
          setClosingDone((n) => n + 1);
          return;
        }
        appendLog('info', `Opening ${display}…`);
        let tabId = null;
        try {
          const res = await navigateWebEposProductInWorkerTab({
            productHref: item.productHref,
            barcode: item.barserial,
            focusOnSuccess: false,
          });
          if (!res?.ok || !Number.isFinite(Number(res?.tabId))) {
            appendLog('warn', `Could not open ${display}: ${res?.error || 'unknown error'}`);
            setClosingDone((n) => n + 1);
            return;
          }
          tabId = Number(res.tabId);
          appendLog('info', `Opened ${display} — ticking On Sale off and saving…`);

          const toggle = await setWebEposProductOnSaleOff(tabId);
          if (!toggle?.ok) {
            appendLog('warn', `Save failed for ${display}: ${toggle?.error || 'unknown error'}`);
          } else {
            appendLog('success', `Closed ${display} ✓`);
          }
        } catch (err) {
          appendLog('warn', `Failed to close ${display}: ${err?.message || err}`);
        } finally {
          if (tabId != null) {
            try {
              await closeTabsByIds([tabId]);
            } catch (closeErr) {
              console.warn('[CloseListingsSoldCheck] tab close failed', closeErr);
            }
          }
          setClosingDone((n) => n + 1);
        }
      },
      CLOSE_FLAGGED_MAX_CONCURRENCY,
    );

    appendLog('success', 'Web EPOS close-flagged run complete.');
    setPhase('closed');
  }, [appendLog, flaggedCount, flaggedEntries]);

  return (
    <TinyModal
      title="Close listings for sold items"
      onClose={phase === 'closing' ? () => {} : onClose}
      zClass="z-[140]"
      panelClassName="!w-[min(95vw,1200px)] !max-w-[min(95vw,1200px)] !h-[min(90vh,900px)] !max-h-[90vh]"
      closeOnBackdrop={phase !== 'closing'}
      bodyScroll={false}
    >
      {total === 0 ? (
        <div className="space-y-3 text-sm text-slate-600">
          <p>Nothing to check — no Web EPOS rows were supplied.</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-brand-blue py-2 text-sm font-bold text-white hover:bg-brand-blue-hover"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
          {/* Phase 1 header */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-600">
              {lookupFinished
                ? `NosPos check done · ${total} item${total !== 1 ? 's' : ''}`
                : `Checking ${Math.min(activeIdx + 1, total)} of ${total} on NosPos`}
            </p>
            <p className={`text-xs font-bold ${flaggedCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {flaggedCount > 0 ? `${flaggedCount} flagged` : 'None flagged yet'}
            </p>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-blue transition-[width] duration-200"
              style={{ width: `${total === 0 ? 0 : (completedCount / total) * 100}%` }}
            />
          </div>

          {phase === 'lookup' && !lookupFinished && active ? (
            <ActiveRowCard
              row={active}
              status={activeStatus}
              onPick={handlePick}
              onRetry={handleRetryActive}
            />
          ) : null}

          {/* Phase 1 row list — hidden during/after phase 2 which shows its own log instead. */}
          {phase === 'lookup' ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-44" />
                  <col />
                  <col className="w-24" />
                  <col className="w-56" />
                </colgroup>
                <thead className="sticky top-0 bg-slate-50 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Barcode</th>
                    <th className="px-3 py-1.5">Product</th>
                    <th className="px-3 py-1.5 text-right">NosPos qty</th>
                    <th className="px-3 py-1.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queue.map((row, idx) => {
                    const s = statusByBarserial[row.barserial];
                    const key = s?.status || 'pending';
                    const meta = STATUS_LABEL[key] || STATUS_LABEL.pending;
                    const isActive = idx === activeIdx && !lookupFinished;
                    const qtyDisplay = s?.quantity != null ? String(s.quantity) : '—';
                    return (
                      <tr key={row.barserial} className={isActive ? 'bg-brand-blue/5' : ''}>
                        <td className="px-3 py-1.5 font-mono font-semibold text-brand-blue">
                          {row.barserial}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          <span className="block truncate" title={row.productName || ''}>
                            {row.productName || '—'}
                          </span>
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                            key === 'flagged' ? 'text-red-600' : 'text-slate-600'
                          }`}
                        >
                          {qtyDisplay}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <span
                            className={`inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide ${meta.tone}`}
                          >
                            <span
                              className={`material-symbols-outlined text-[14px] leading-none ${
                                key === 'searching' || key === 'loading_stock' ? 'animate-spin' : ''
                              }`}
                            >
                              {meta.icon}
                            </span>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ClosePhasePanel
              flaggedCount={flaggedCount}
              done={closingDone}
              log={closingLog}
              phase={phase}
            />
          )}

          <div className="flex items-center justify-end gap-2">
            {phase === 'lookup' && !lookupFinished ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}

            {phase === 'lookup' && lookupFinished ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCloseFlaggedOnWebEpos}
                  disabled={flaggedCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  title={
                    flaggedCount === 0
                      ? 'Nothing to close — no flagged items'
                      : `Toggle On Sale off for ${flaggedCount} flagged listing${flaggedCount === 1 ? '' : 's'}`
                  }
                >
                  <span className="material-symbols-outlined text-[16px]">remove_shopping_cart</span>
                  Close flagged items on Web EPOS
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-black">
                    {flaggedCount}
                  </span>
                </button>
              </>
            ) : null}

            {phase === 'closed' ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-blue-hover"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      )}
    </TinyModal>
  );
}

/** Per-row action card — shown for whichever row is currently mid-flight. */
function ActiveRowCard({ row, status, onPick, onRetry }) {
  const key = status?.status || 'pending';
  const meta = STATUS_LABEL[key] || STATUS_LABEL.pending;

  return (
    <div className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-3">
      <div className="flex items-center gap-2">
        <span
          className={`material-symbols-outlined text-[18px] leading-none ${meta.tone} ${
            key === 'searching' || key === 'loading_stock' ? 'animate-spin' : ''
          }`}
        >
          {meta.icon}
        </span>
        <span className="font-mono text-sm font-bold text-brand-blue">{row.barserial}</span>
        {row.productName ? (
          <span className="truncate text-xs text-slate-600">· {row.productName}</span>
        ) : null}
      </div>

      <p className={`mt-1.5 text-xs font-semibold ${meta.tone}`}>{meta.label}</p>
      {status?.error ? (
        <p className="mt-1 text-[11px] text-red-500">{status.error}</p>
      ) : null}

      {key === 'picker' && Array.isArray(status?.results) ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Select the matching NosPos item:
          </p>
          {status.results.map((result, ri) => (
            <button
              key={`${result.barserial}-${ri}`}
              type="button"
              onClick={() => onPick(result)}
              className="flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] font-bold text-brand-blue">{result.barserial}</p>
                <p className="truncate text-[11px] text-slate-600">{result.name}</p>
                <p className="text-[10px] text-slate-400">
                  Cost {result.costPrice} · Retail {result.retailPrice} · Qty {result.quantity}
                </p>
              </div>
              <span className="material-symbols-outlined text-[18px] text-brand-blue">chevron_right</span>
            </button>
          ))}
        </div>
      ) : null}

      {key === 'error' ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-brand-blue/30 px-2.5 py-1 text-[11px] font-semibold text-brand-blue hover:bg-brand-blue/5"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

const LOG_TONE = {
  info: 'text-slate-600',
  warn: 'text-amber-600',
  success: 'text-emerald-600',
  error: 'text-red-600',
};

/** Phase-2 panel: live log + progress bar of the Web EPOS close-flagged run. */
function ClosePhasePanel({ flaggedCount, done, log, phase }) {
  const pct = flaggedCount === 0 ? 0 : (done / flaggedCount) * 100;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-600">
          {phase === 'closed'
            ? `Web EPOS close-flagged done · ${done} / ${flaggedCount}`
            : `Closing on Web EPOS · ${done} / ${flaggedCount}`}
        </p>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-red-600">
          On Sale → Off
        </p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-red-500 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 font-mono text-[11px] leading-relaxed">
        {log.length === 0 ? (
          <p className="text-slate-400">Starting…</p>
        ) : (
          log.map((entry, idx) => (
            <p key={idx} className={LOG_TONE[entry.level] || LOG_TONE.info}>
              <span className="mr-2 text-slate-300">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              {entry.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
