import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import {
  WEB_EPOS_PRODUCTS_URL,
  WEB_EPOS_UPLOAD_SKIP_GATE_KEY,
} from '@/pages/buyer/webEposUploadConstants';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];

/**
 * Shows the Web EPOS products table scraped by the extension (Upload module → View products).
 * State: { rows, pagingText?, pageUrl?, scrapedAt? } from navigate().
 */
export default function WebEposProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { rows = [], pagingText = null, pageUrl = null, scrapedAt = null } = location.state || {};

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const totalRows = rows.length;

  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [totalRows, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    if (!hasRows) return [];
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, hasRows, safePage, pageSize]);

  return (
    <div className="min-h-screen flex flex-col bg-ui-bg text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <AppHeader />
      <main className="layout-container flex-1 px-4 sm:px-8 lg:px-12 py-8">
        <div className="max-w-[1400px] mx-auto w-full space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="cg-section-title text-xl sm:text-2xl">Web EPOS products</h1>
              <p className="cg-section-subtitle mt-1">
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
              {pageUrl ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-all">
                  Last Web EPOS URL: {pageUrl}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(WEB_EPOS_UPLOAD_SKIP_GATE_KEY, '1');
                } catch (_) {}
                navigate('/upload');
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 dark:border-slate-600 text-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              Back to upload
            </button>
          </div>

          {!hasRows ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-8 text-center text-sm bg-white dark:bg-slate-800/40">
              <p className="text-slate-600 dark:text-slate-300 mb-2">No product rows in this view.</p>
              <p className="text-slate-500 dark:text-slate-400">
                Open the Upload module and choose <strong>View products</strong> while logged into Web EPOS.
              </p>
            </div>
          ) : (
            <div className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/40 overflow-hidden shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                  {totalRows} result{totalRows !== 1 ? 's' : ''}
                  {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : null}
                </p>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="rounded-md border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="overflow-x-auto flex-1 min-h-0">
                <table className="w-full min-w-[720px] spreadsheet-table spreadsheet-table--static-header border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {['Barcode', 'Product Name', 'Price', 'Quantity', 'Status', 'Shop'].map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, ri) => {
                      const globalIndex = (safePage - 1) * pageSize + ri;
                      return (
                        <tr key={`${row.barcode}-${globalIndex}`}>
                          <td className="font-mono text-xs">
                            {row.productHref ? (
                              <a
                                href={row.productHref}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-brand-blue hover:underline"
                              >
                                {row.barcode}
                              </a>
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
                <p className="text-xs text-slate-500 dark:text-slate-400 px-4 py-2 border-t border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/30">
                  Web EPOS: {pagingText}
                </p>
              ) : null}

              {totalPages > 1 ? (
                <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 border-t border-slate-200 dark:border-slate-600 bg-brand-blue/10 px-4 py-4 sm:justify-between">
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
                          <span key={`ellipsis-${idx}`} className="px-2 text-sm font-medium text-gray-500">
                            …
                          </span>
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
      </main>
    </div>
  );
}
