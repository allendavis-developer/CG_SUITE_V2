import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatGBP } from '@/utils/helpers';

const INTENT_CONFIG = {
  BUYBACK: {
    label: 'Buy Back',
    badgeClass: 'bg-brand-blue/8 text-brand-blue border-brand-blue/15',
    dotClass: 'bg-brand-blue',
  },
  STORE_CREDIT: {
    label: 'Store Credit',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    dotClass: 'bg-purple-500',
  },
  DIRECT_SALE: {
    label: 'Direct Sale',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
  },
};

const getTypeDisplay = (intent) =>
  INTENT_CONFIG[intent] ?? {
    label: intent || '—',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    dotClass: 'bg-slate-400',
  };

const RecentActivityTable = ({ transactions = [], totalCount = 0 }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  const displayTransactions = transactions.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="cg-section-title flex items-center gap-2">
            Today&apos;s Transactions
            <span className="text-sm font-semibold text-slate-400 tabular-nums">({totalCount})</span>
          </h2>
          <p className="cg-section-subtitle">All completed transactions for today</p>
        </div>
      </div>

      <div className="cg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                  Transaction ID
                </th>
                <th className="px-5 py-3.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-5 py-3.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-5 py-3.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayTransactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="material-symbols-outlined text-3xl text-slate-300">receipt_long</span>
                      <p className="text-sm text-slate-400 font-medium">No transactions yet today</p>
                    </div>
                  </td>
                </tr>
              ) : (
                displayTransactions.map((tx) => {
                  const typeDisplay = getTypeDisplay(tx.intent);
                  return (
                    <tr
                      key={tx.request_id}
                      className="hover:bg-blue-50/40 transition-colors duration-100 cursor-pointer"
                      onClick={() => navigate(`/requests/${tx.request_id}/view`)}
                    >
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs font-semibold text-brand-blue bg-brand-blue/6 px-2 py-0.5 rounded">
                          #{tx.request_id}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-800">
                        {tx.customer_name}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 py-0.5 px-2.5 rounded-full text-[10.5px] font-bold border ${typeDisplay.badgeClass}`}>
                          <span className={`size-1.5 rounded-full ${typeDisplay.dotClass}`} />
                          {typeDisplay.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-bold text-slate-900 tabular-nums">
                        {tx.amount != null ? formatGBP(tx.amount) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">
            {totalCount} transaction{totalCount !== 1 ? 's' : ''} today
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="flex items-center justify-center size-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-white hover:border-slate-300 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">chevron_left</span>
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="flex items-center justify-center size-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-white hover:border-slate-300 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RecentActivityTable;
