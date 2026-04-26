import React, { useEffect, useMemo, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { scrapeNosposListedStockPage } from '@/services/extensionClient';
import { extractWebEposBarserial } from '@/pages/buyer/webEposUploadConstants';

/**
 * "Sync listed on NosPos to WebEpos": background-scrape every page of NosPos
 * /stock/search filtered to `Manually Listed = Yes` and stream the rows into
 * a table modelled on `CloseListingsSoldCheckModal`. No write side-effects.
 *
 * The bridge action streams `{ page, rows, hasMore }` once per page; we
 * accumulate `rows` into the table and let the resolved promise flip the
 * modal from 'loading' to 'ready'. Each row is cross-checked against the
 * Web EPOS snapshot already loaded by the parent (`webEposRows`) so the
 * "Listed on WebEpos" column shows a tick for matches and an X for misses.
 */
export default function SyncListedNosposToWebEposModal({ webEposRows, onClose, showNotification }) {
  // Web EPOS barcodes are `<barserial>-<timestamp>`; NosPos only stores the
  // base barserial — strip the suffix once so per-row matching is O(1).
  const webEposBarserials = useMemo(() => {
    const set = new Set();
    (webEposRows || []).forEach((r) => {
      const base = extractWebEposBarserial(r?.barcode || r?.rawBarcode || '');
      if (base) set.add(base);
    });
    return set;
  }, [webEposRows]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [pagesScanned, setPagesScanned] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await scrapeNosposListedStockPage({
          onProgress: (p) => {
            if (cancelled || !p) return;
            setPagesScanned(p.page);
            if (p.rows?.length) setResults((prev) => prev.concat(p.rows));
          },
        });
        if (cancelled) return;
        if (r?.loginRequired) {
          setError('Log in to NosPos first.');
          setPhase('error');
          showNotification?.('NosPos lookup needs you to be logged in first.', 'error');
          return;
        }
        if (!r?.ok) {
          // Rows already streamed in via onProgress — leave them in place.
          setError(r?.error || 'Could not load NosPos listed stock page.');
          setPhase('error');
          return;
        }
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Extension unavailable.');
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNotification]);

  const total = results.length;
  const isLoading = phase === 'loading';
  const heading = isLoading
    ? `Fetching from NosPos · ${total} item${total === 1 ? '' : 's'} across ${pagesScanned} page${pagesScanned === 1 ? '' : 's'} so far…`
    : phase === 'error'
      ? 'NosPos listed stock — error'
      : `NosPos listed stock · ${total} item${total === 1 ? '' : 's'} across ${pagesScanned} page${pagesScanned === 1 ? '' : 's'}`;

  return (
    <TinyModal
      title="Sync listed on NosPos to WebEpos"
      onClose={onClose}
      zClass="z-[140]"
      panelClassName="!w-[min(95vw,1200px)] !max-w-[min(95vw,1200px)] !h-[min(90vh,900px)] !max-h-[90vh]"
      bodyScroll={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            {isLoading ? (
              <span className="material-symbols-outlined animate-spin text-[16px] text-brand-blue">
                progress_activity
              </span>
            ) : null}
            {heading}
          </p>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
            Filter: Manually Listed = Yes
          </p>
        </div>

        {phase === 'error' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
            {total > 0 ? (
              <span className="ml-1 text-red-600/80">
                (showing {total} row{total === 1 ? '' : 's'} scraped before the error)
              </span>
            ) : null}
          </div>
        ) : null}

        {total > 0 ? (
          <ResultsTable results={results} webEposBarserials={webEposBarserials} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
            {isLoading ? 'Waiting for the first page…' : 'No items returned.'}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </TinyModal>
  );
}

function ResultsTable({ results, webEposBarserials }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
      <table className="w-full table-fixed text-left text-xs">
        <colgroup>
          <col className="w-44" />
          <col />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-32" />
          <col className="w-20" />
        </colgroup>
        <thead className="sticky top-0 bg-slate-50 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-1.5">Barcode</th>
            <th className="px-3 py-1.5">Product</th>
            <th className="px-3 py-1.5 text-right">Cost</th>
            <th className="px-3 py-1.5 text-right">Retail</th>
            <th className="px-3 py-1.5 text-right">Qty</th>
            <th className="px-3 py-1.5 text-center">Listed on WebEpos</th>
            <th className="px-3 py-1.5 text-right">Open</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map((row, idx) => {
            const stockUrl = row.href ? `https://nospos.com${row.href}` : null;
            const isListed = !!row.barserial && webEposBarserials.has(row.barserial);
            return (
              <tr key={`${row.barserial || 'row'}-${idx}`}>
                <td className="px-3 py-1.5 font-mono font-semibold text-brand-blue">
                  {row.barserial || '—'}
                </td>
                <td className="px-3 py-1.5 text-slate-600">
                  <span className="block truncate" title={row.name || ''}>
                    {row.name || '—'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                  {row.costPrice || '—'}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                  {row.retailPrice || '—'}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-700">
                  {row.quantity || '—'}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {isListed ? (
                    <span
                      className="material-symbols-outlined text-[18px] leading-none text-emerald-600"
                      title="Found in current Web EPOS products list"
                    >
                      check_circle
                    </span>
                  ) : (
                    <span
                      className="material-symbols-outlined text-[18px] leading-none text-red-500"
                      title="Not found in current Web EPOS products list"
                    >
                      cancel
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {stockUrl ? (
                    <a
                      href={stockUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-blue hover:underline"
                      title={`Open ${row.barserial} on NosPos`}
                    >
                      <span className="material-symbols-outlined text-[14px] leading-none">open_in_new</span>
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
