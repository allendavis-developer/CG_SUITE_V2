import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatGBP } from '@/utils/helpers';

/**
 * Maps API intent to display type and badge style.
 */
const getTypeDisplay = (intent) => {
  switch (intent) {
    case 'BUYBACK':
      return { label: 'Buy Back', badgeClass: 'bg-blue-100 text-blue-700', dotClass: 'bg-blue-600' };
    case 'STORE_CREDIT':
      return { label: 'Store Credit', badgeClass: 'bg-purple-100 text-purple-700', dotClass: 'bg-purple-600' };
    case 'DIRECT_SALE':
      return { label: 'Direct Sale', badgeClass: 'bg-orange-100 text-orange-700', dotClass: 'bg-orange-600' };
    default:
      return { label: intent || '—', badgeClass: 'bg-slate-100 text-slate-700', dotClass: 'bg-slate-600' };
  }
};

/**
 * Recent activity table with transaction rows.
 * Uses real data from requests when available.
 */
const RecentActivityTable = ({ transactions = [], totalCount = 0 }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const pageSize = 4;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const displayTransactions = transactions.slice(
    page * pageSize,
    page * pageSize + pageSize
  );

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-slate-900 dark:text-slate-100 text-2xl font-bold tracking-tight">
          Today&apos;s Transactions
          <span className="ml-2 text-slate-500 dark:text-slate-400 font-normal text-lg">
            ({totalCount})
          </span>
        </h2>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Transaction ID
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Customer Name
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayTransactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    No recent transactions
                  </td>
                </tr>
              ) : (
                displayTransactions.map((tx) => {
                  const typeDisplay = getTypeDisplay(tx.intent);
                  return (
                    <tr
                      key={tx.request_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/requests/${tx.request_id}/view`)}
                    >
                      <td className="px-6 py-4 font-mono text-sm text-brand-blue font-semibold">
                        #{tx.request_id}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {tx.customer_name}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-bold ${typeDisplay.badgeClass}`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${typeDisplay.dotClass}`}
                          />
                          {typeDisplay.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-slate-900 dark:text-slate-100">
                        {tx.amount != null ? formatGBP(tx.amount) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {totalCount} transaction{totalCount !== 1 ? 's' : ''} today
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="p-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="p-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RecentActivityTable;
