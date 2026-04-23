import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import {
  WEB_EPOS_PRODUCTS_URL,
  extractWebEposBarserial as extractBarcode,
} from '@/pages/buyer/webEposUploadConstants';
import { navigateWebEposProductInWorkerTab } from '@/services/extensionClient';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];

/**
 * Paginated Web EPOS products grid (shared by full products page and upload hub).
 *
 * Selection follows the same pivot-range logic as the research form exclusion:
 *  - Click unselected (no pivot) → set as pivot
 *  - Click pivot → deselect and clear pivot
 *  - Click any row when pivot is set → range-select from pivot to this row, clear pivot
 */
export default function WebEposProductsTablePanel({
  rows = [],
  pagingText = null,
  pageUrl = null,
  scrapedAt = null,
  showSourceBlurb = true,
  emptyDetail = null,
  onSelectedBarcodes = null,
  onSelectedRows = null,
  /**
   * Map<barserial, { reason?: string }> — when present, renders a danger badge on the row's
   * barcode cell. Keys are the extracted barserial (same value we emit to `onSelectedBarcodes`).
   */
  dangerByBarcode = null,
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const totalRows = rows.length;

  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [productNavError, setProductNavError] = useState(null);
  const [productNavBusyKey, setProductNavBusyKey] = useState(null);

  // Selection state — mirrors ResearchFormShell's rightClickPivotIdx pattern
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [pivotIdx, setPivotIdx] = useState(null);

  useEffect(() => { setPage(1); }, [totalRows, pageSize]);
  useEffect(() => { setProductNavError(null); setProductNavBusyKey(null); }, [rows]);

  // Clear selection when rows change (new scrape)
  useEffect(() => {
    setSelectedIndices(new Set());
    setPivotIdx(null);
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    if (!hasRows) return [];
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, hasRows, safePage, pageSize]);

  // Notify parent of selected barcodes (deduplicated, barcode extracted) and, when wired, the full
  // scraped rows (productHref, productName, price, etc.) so audit mode can open each edit page.
  useEffect(() => {
    const sortedIdx = Array.from(selectedIndices).sort((a, b) => a - b);
    if (onSelectedBarcodes) {
      const selected = sortedIdx
        .map((idx) => rows[idx]?.barcode)
        .filter(Boolean)
        .map(extractBarcode);
      onSelectedBarcodes(selected);
    }
    if (onSelectedRows) {
      const selectedRows = sortedIdx
        .map((idx) => rows[idx])
        .filter(Boolean)
        .map((r) => ({
          barcode: extractBarcode(r.barcode),
          rawBarcode: r.barcode || '',
          productHref: r.productHref || null,
          productName: r.productName || '',
          price: r.price || '',
          quantity: r.quantity || '',
          status: r.status || '',
          retailUrl: r.retailUrl || null,
        }))
        .filter((r) => r.barcode);
      onSelectedRows(selectedRows);
    }
  }, [selectedIndices, rows, onSelectedBarcodes, onSelectedRows]);

  // Pivot-range selection — mirrors ResearchFormShell handleExcludeClick.
  // Clicking an already-selected row always toggles it off (including the pivot itself),
  // so a double-click outside an existing multi-select is net-zero instead of clobbering.
  const handleSelectionClick = useCallback((globalIndex) => {
    const isSelected = selectedIndices.has(globalIndex);

    if (isSelected) {
      setSelectedIndices((prev) => { const s = new Set(prev); s.delete(globalIndex); return s; });
      setPivotIdx(null);
      return;
    }

    if (pivotIdx !== null) {
      const start = Math.min(pivotIdx, globalIndex);
      const end = Math.max(pivotIdx, globalIndex);
      setSelectedIndices((prev) => {
        const s = new Set(prev);
        for (let i = start; i <= end; i++) s.add(i);
        return s;
      });
      setPivotIdx(null);
      return;
    }

    setPivotIdx(globalIndex);
    setSelectedIndices((prev) => { const s = new Set(prev); s.add(globalIndex); return s; });
  }, [selectedIndices, pivotIdx]);

  const selectedCount = selectedIndices.size;

  return (
    <>
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div className="space-y-4">
        {showSourceBlurb ? (
          <div>
            <p className="cg-section-subtitle text-sm text-slate-600 dark:text-slate-300">
              Data from{' '}
              <a
                href={WEB_EPOS_PRODUCTS_URL}
                className="text-brand-blue underline hover:no-underline"
                target="_blank"
                rel="noreferrer"
              >
                {WEB_EPOS_PRODUCTS_URL.replace(/^https:\/\//, '')}
              </a>
              {scrapedAt ? ` · scraped ${new Date(scrapedAt).toLocaleString()}` : null}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Clicking a barcode opens Web EPOS in a new tab in this window, finds the row on the products list, then
              focuses that tab once the product opens (deep product URLs are not pasted directly because Web EPOS needs
              in-app navigation).
            </p>
            {productNavError ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
                {productNavError}
              </p>
            ) : null}
            {pageUrl ? (
              <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">Last Web EPOS URL: {pageUrl}</p>
            ) : null}
          </div>
        ) : null}

        {!hasRows ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm dark:border-slate-600 dark:bg-slate-800/40">
            <p className="mb-2 text-slate-600 dark:text-slate-300">No product rows in this view.</p>
            {emptyDetail ? (
              <div className="text-slate-500 dark:text-slate-400">{emptyDetail}</div>
            ) : (
              <p className="text-slate-500 dark:text-slate-400">
                Open the Upload module while logged into Web EPOS so the extension can read the product list.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-600 dark:bg-slate-900/40">
              <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {totalRows} result{totalRows !== 1 ? 's' : ''}
                {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : null}
                {selectedCount > 0 ? (
                  <span className="ml-2 rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-semibold text-brand-blue">
                    {selectedCount} selected
                  </span>
                ) : null}
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto">
              <table className="spreadsheet-table spreadsheet-table--static-header w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="w-10 text-center">
                      <span className="material-symbols-outlined text-[16px] leading-none text-slate-400" title="Click to set pivot, click another to range-select">check_circle</span>
                    </th>
                    {['Barcode', 'Product Name', 'Price', 'Quantity', 'Status', 'Shop'].map((h) => (
                      <th key={h} scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, ri) => {
                    const globalIndex = (safePage - 1) * pageSize + ri;
                    const isSelected = selectedIndices.has(globalIndex);
                    const isPivot = pivotIdx === globalIndex;
                    const rowBarserial = extractBarcode(row.barcode);
                    const danger = dangerByBarcode && rowBarserial ? dangerByBarcode[rowBarserial] : null;
                    return (
                      <tr
                        key={`${row.barcode}-${globalIndex}`}
                        className={isSelected ? (isPivot ? 'bg-brand-blue/20' : 'bg-brand-blue/10') : ''}
                      >
                        <td className="w-10 px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => handleSelectionClick(globalIndex)}
                            className={`inline-flex items-center justify-center size-7 rounded-full transition-colors ${
                              isPivot
                                ? 'bg-brand-blue text-white shadow ring-2 ring-brand-blue/30'
                                : isSelected
                                  ? 'bg-brand-blue/80 text-white'
                                  : 'border border-slate-300 bg-white text-slate-400 hover:border-brand-blue hover:text-brand-blue'
                            }`}
                            title={
                              isPivot
                                ? 'Pivot set — click another row to range-select, or click here to deselect'
                                : isSelected
                                  ? 'Click to deselect'
                                  : 'Click to set pivot, then click another to range-select'
                            }
                          >
                            <span className="material-symbols-outlined text-[15px] leading-none">
                              {isPivot ? 'swap_vert' : isSelected ? 'check' : 'add'}
                            </span>
                          </button>
                        </td>
                        <td className="font-mono text-xs">
                          {danger ? (
                            <span
                              className="mr-1.5 inline-flex items-center align-middle rounded-full bg-red-100 px-1.5 py-0.5 text-red-700"
                              title={danger.reason || 'Flagged: free-stock quantity is below 1'}
                            >
                              <span className="material-symbols-outlined text-[14px] leading-none">warning</span>
                            </span>
                          ) : null}
                          {row.productHref ? (
                            <button
                              type="button"
                              disabled={productNavBusyKey != null}
                              title="Opens Web EPOS in a new tab, navigates the list, then shows the product"
                              onClick={async () => {
                                const busyKey = `${globalIndex}-${row.barcode}`;
                                setProductNavError(null);
                                setProductNavBusyKey(busyKey);
                                try {
                                  const r = await navigateWebEposProductInWorkerTab({
                                    productHref: row.productHref,
                                    barcode: row.barcode,
                                  });
                                  if (!r || r.ok !== true) {
                                    setProductNavError((r && r.error) || 'Could not open this product in Web EPOS.');
                                  }
                                } catch (e) {
                                  setProductNavError(
                                    e && e.message
                                      ? String(e.message)
                                      : 'Extension unavailable. Use the Web EPOS products list to open items.'
                                  );
                                } finally {
                                  setProductNavBusyKey(null);
                                }
                              }}
                              className="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold text-brand-blue hover:underline disabled:cursor-wait disabled:opacity-60"
                            >
                              {productNavBusyKey === `${globalIndex}-${row.barcode}` ? 'Opening…' : row.barcode}
                            </button>
                          ) : (
                            row.barcode
                          )}
                        </td>
                        <td className="max-w-[320px]">{row.productName}</td>
                        <td className="whitespace-nowrap">{row.price}</td>
                        <td className="whitespace-nowrap">{row.quantity}</td>
                        <td className="whitespace-nowrap text-xs">{row.status}</td>
                        <td className="whitespace-nowrap">
                          {row.retailUrl ? (
                            <a
                              href={row.retailUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-brand-blue hover:underline"
                              title="Open on cashgenerator.co.uk"
                            >
                              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagingText ? (
              <p className="border-t border-slate-200 bg-slate-50/50 px-4 py-2 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900/30 dark:text-slate-400">
                Web EPOS: {pagingText}
              </p>
            ) : null}

            {totalPages > 1 ? (
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-slate-200 bg-brand-blue/10 px-4 py-4 sm:justify-between dark:border-slate-600">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <span className="material-symbols-outlined text-[22px] leading-none">chevron_left</span>
                  Prev
                </button>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, idx) =>
                      p === '…' ? (
                        <span key={`ellipsis-${idx}`} className="px-2 text-sm font-medium text-gray-500">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPage(p)}
                          className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                            p === safePage
                              ? 'border-brand-blue bg-brand-blue text-white shadow-sm'
                              : 'border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                </div>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Next
                  <span className="material-symbols-outlined text-[22px] leading-none">chevron_right</span>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
