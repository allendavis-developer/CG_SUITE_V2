import React from 'react';
import { CustomDropdown } from '@/components/ui/components';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';

const CustomerTransactionHeader = ({
  customer,
  transactionType,
  onTransactionChange,
  containerClassName = '',
  readOnly = false, // Add readOnly prop with default false
}) => {
  const transaction = TRANSACTION_META[transactionType] || {
    label: 'Unknown',
    className: 'text-gray-400'
  };

  const getDateAndAge = (value) => {
    if (value == null || String(value).trim() === '') return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysAgo = Math.floor((now.getTime() - parsed.getTime()) / msPerDay);
    const safeDaysAgo = Number.isFinite(daysAgo) ? Math.max(0, daysAgo) : null;
    if (safeDaysAgo == null) return value;

    return {
      base: String(value),
      age: `${safeDaysAgo} day${safeDaysAgo === 1 ? '' : 's'} ago`,
    };
  };

  const detailRows = [
    { label: 'Joined', value: getDateAndAge(customer?.joined) },
    { label: 'Last Transacted', value: getDateAndAge(customer?.lastTransacted) },
    { label: 'Buy Transactions', value: customer?.buyingCount },
    { label: 'Sell Transactions', value: customer?.salesCount },
    { label: 'Buyback Rate', value: customer?.buyBackRate ?? customer?.buyBackRateRaw },
    { label: 'Renew Rate', value: customer?.renewRate ?? customer?.renewRateRaw },
    { label: 'Cancel Rate', value: customer?.cancelRateStr ?? customer?.cancelRateRaw },
    { label: 'Faulty Rate', value: customer?.faultyRate ?? customer?.faultyRateRaw },
    { label: 'Email', value: customer?.email },
  ].filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== '');

  return (
    <div className={`bg-white p-6 ${containerClassName}`}>
      <h1 className="text-3xl font-extrabold tracking-tight text-blue-900">
        {customer.name}
      </h1>

      <div className="flex items-center gap-2 mt-2">
        <div className={transaction.className}>
          {readOnly ? (
            <span className="text-sm font-semibold">{transaction.label}</span>
          ) : (
            <CustomDropdown
              value={transaction.label}
              options={TRANSACTION_OPTIONS.map(o => o.label)}
              onChange={(label) => {
                const selected = TRANSACTION_OPTIONS.find(o => o.label === label);
                if (selected) onTransactionChange(selected.value);
              }}
            />
          )}
        </div>
      </div>

      {detailRows.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          {detailRows.map((row) => {
            const isDateRow = row.label === 'Joined' || row.label === 'Last Transacted';
            return (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-blue-50/60 px-2.5 py-1.5">
              <span className="font-semibold text-blue-900/75">{row.label}</span>
              <span className="text-right font-bold text-blue-900">
                {row.value && typeof row.value === 'object' && row.value.base && row.value.age ? (
                  <>
                    <span>{row.value.base} </span>
                    <span className="text-amber-600">({row.value.age})</span>
                  </>
                ) : (
                  row.value
                )}
              </span>
            </div>
          )})}
        </div>
      )}

      {customer.bypassReason && (
        <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 w-fit">
          <span className="material-symbols-outlined text-amber-500 text-sm">info</span>
          <p className="text-xs font-semibold text-amber-700">
            {customer.bypassReason === "Within 14 days of last transaction"
              ? `Customer data not updated — ${customer.bypassReason}`
              : `Customer data was not updated because: ${customer.bypassReason}`}
          </p>
        </div>
      )}
    </div>
  );
};

export default CustomerTransactionHeader;
