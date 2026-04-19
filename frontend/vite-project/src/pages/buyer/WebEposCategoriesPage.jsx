import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import {
  CASH_GENERATOR_RETAIL_HOME,
  WEB_EPOS_UPLOAD_SKIP_GATE_KEY,
} from '@/pages/buyer/webEposUploadConstants';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import {
  fetchCashGeneratorRetailCategories,
  syncCashGeneratorRetailCategories,
} from '@/services/api';
import { useNotification } from '@/contexts/NotificationContext';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];

/** Upload → View categories. GET loads `cg_categories`; Update POST scrapes and upserts. */
export default function WebEposCategoriesPage() {
  const navigate = useNavigate();
  const { showNotification } = useNotification();

  const [rows, setRows] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [pagingText, setPagingText] = useState(null);
  const [pageUrl, setPageUrl] = useState(null);
  const [scrapedAt, setScrapedAt] = useState(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [updateLoading, setUpdateLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCashGeneratorRetailCategories();
        if (cancelled || !data?.ok || !Array.isArray(data.rows)) return;
        setRows(data.rows);
        setPagingText(
          data.rows.length
            ? `Showing ${data.rows.length} categories from the database`
            : 'No categories stored yet — click Update to sync from the website.'
        );
      } catch (e) {
        if (!cancelled) showNotification(e?.message || 'Could not load categories.', 'error');
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNotification]);

  const handleUpdateCategories = useCallback(async () => {
    setUpdateLoading(true);
    try {
      const data = await syncCashGeneratorRetailCategories();
      if (!data?.ok || !Array.isArray(data.rows)) {
        throw new Error(data?.error || 'Server did not return category rows.');
      }
      setRows(data.rows);
      setPageUrl(data.pageUrl ?? null);
      setScrapedAt(new Date().toISOString());
      const added = data.added ?? 0;
      const updated = data.updated ?? 0;
      setPagingText(
        data.rows.length
          ? `Database: ${data.rows.length} rows · last scrape: +${added} new, ${updated} updated`
          : 'Scrape finished but no categories were parsed.'
      );
      if (data.rows.length === 0) {
        showNotification('Scrape finished but no categories were found.', 'info');
      } else {
        showNotification(`Saved to database (+${added} new, ${updated} updated).`, 'success');
      }
    } catch (e) {
      showNotification(e?.message || 'Could not update categories.', 'error');
    } finally {
      setUpdateLoading(false);
    }
  }, [showNotification]);

  const hasRows = rows.length > 0;
  const totalRows = rows.length;

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
              <h1 className="cg-section-title text-xl sm:text-2xl">Cash Generator categories</h1>
              <p className="cg-section-subtitle mt-1">
                Stored in <strong>cg_categories</strong> · live menu from{' '}
                <a
                  href={CASH_GENERATOR_RETAIL_HOME}
                  className="text-brand-blue underline hover:no-underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {CASH_GENERATOR_RETAIL_HOME.replace(/^https:\/\//, '')}
                </a>
                {scrapedAt ? ` · last update ${new Date(scrapedAt).toLocaleString()}` : null}
              </p>
              {pageUrl ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-all">
                  Last page URL: {pageUrl}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleUpdateCategories}
                disabled={updateLoading || listLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-blue text-white hover:bg-brand-blue-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {updateLoading ? 'Updating…' : 'Update categories'}
              </button>
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
          </div>

          {listLoading ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-8 text-center text-sm bg-white dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
              Loading categories…
            </div>
          ) : !hasRows ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-8 text-center text-sm bg-white dark:bg-slate-800/40">
              <p className="text-slate-600 dark:text-slate-300 mb-2">No categories in the database yet.</p>
              <p className="text-slate-500 dark:text-slate-400">
                Click <strong>Update categories</strong> to fetch the retail homepage, parse the All Categories menu, and save rows (name + parent id).
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
                <table className="w-full min-w-[820px] spreadsheet-table spreadsheet-table--static-header border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {['Level', 'Category', 'Full path', 'Parent ID'].map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, ri) => {
                      const globalIndex = (safePage - 1) * pageSize + ri;
                      const path =
                        row.categoryPath ||
                        [row.parentCategoryName, row.categoryName].filter(Boolean).join(' › ') ||
                        row.categoryName ||
                        '';
                      const segs = path.split(' › ').map((s) => s.trim()).filter(Boolean);
                      const level = Math.max(0, segs.length - 1);
                      const rowKey = `${path}-${globalIndex}`;
                      const padRem = 0.5 + Math.max(0, level - 1) * 0.75;
                      return (
                        <tr key={rowKey}>
                          <td className="w-14 whitespace-nowrap text-center tabular-nums text-slate-600 dark:text-slate-400 align-top">
                            {level}
                          </td>
                          <td
                            className="max-w-[260px] align-top font-medium text-slate-900 dark:text-slate-100"
                            style={{ paddingLeft: `${padRem}rem` }}
                          >
                            <span
                              className={
                                level > 1
                                  ? 'inline-block border-l-2 border-slate-300 pl-2 dark:border-slate-600'
                                  : 'inline-block'
                              }
                            >
                              {row.categoryName}
                            </span>
                          </td>
                          <td className="min-w-[240px] max-w-[480px] text-slate-700 dark:text-slate-300 align-top whitespace-normal break-words text-xs leading-snug">
                            {path}
                          </td>
                          <td className="w-24 whitespace-nowrap text-center tabular-nums text-slate-600 dark:text-slate-400 align-top">
                            {row.parentCategoryId ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pagingText ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 px-4 py-2 border-t border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/30">
                  {pagingText}
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
