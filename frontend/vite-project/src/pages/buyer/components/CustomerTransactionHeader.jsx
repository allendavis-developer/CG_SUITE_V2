import React from 'react';
import { CustomDropdown } from '@/components/ui/components';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';

const CustomerTransactionHeader = ({
  customer,
  transactionType,
  onTransactionChange,
  containerClassName = '',
  readOnly = false, // Add readOnly prop with default false
  /** `card` = sidebar/white panel with transaction controls; `infoStrip` = full-width brand bar, customer details only */
  presentation = 'card',
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

  if (presentation === 'infoStrip') {
    const bypassText =
      customer.bypassReason === 'Within 14 days of last transaction'
        ? `Customer data not updated — ${customer.bypassReason}`
        : `Customer data was not updated because: ${customer.bypassReason}`;

    /** Matches name line-height so pills align vertically with the heading */
    const rowMinH = 'min-h-[2.75rem]';

    const pillCls = `flex shrink-0 ${rowMinH} items-center gap-2 whitespace-nowrap rounded-md border border-white/25 bg-white/10 px-3 text-sm text-white`;

    const joinedRow = detailRows.find((r) => r.label === 'Joined');
    const stripRows = detailRows.filter((r) => r.label !== 'Joined');

    const joinedTitle =
      joinedRow?.value && typeof joinedRow.value === 'object' && joinedRow.value.base
        ? `${joinedRow.label}: ${joinedRow.value.base}`
        : joinedRow
          ? `${joinedRow.label}: ${joinedRow.value}`
          : '';

    return (
      <div
        className={`shrink-0 border-t-4 border-t-white/35 bg-brand-blue px-6 pt-2 pb-1 ${containerClassName}`}
      >
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0">
          <div
            className={`flex shrink-0 ${rowMinH} max-w-full min-w-0 overflow-hidden rounded-md border border-white/25 bg-white/10 ${joinedRow ? '' : 'pl-1.5 pr-3'}`}
          >
            <div
              className={`flex min-w-0 flex-1 items-center ${joinedRow ? 'border-r border-white/25 pl-1.5 pr-3' : ''}`}
            >
              <h2 className="min-w-0 truncate text-base font-extrabold leading-tight tracking-tight text-white md:text-lg">
                {customer.name}
              </h2>
            </div>
            {joinedRow && (
              <div
                className="flex shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm text-white"
                title={joinedTitle}
              >
                <span className="font-semibold text-white/75">{joinedRow.label}</span>
                <span className="font-bold text-white">
                  {joinedRow.value &&
                  typeof joinedRow.value === 'object' &&
                  joinedRow.value.base &&
                  joinedRow.value.age ? (
                    <>
                      <span>{joinedRow.value.base}</span>
                      <span className="text-white/70"> ({joinedRow.value.age})</span>
                    </>
                  ) : (
                    joinedRow.value
                  )}
                </span>
              </div>
            )}
          </div>
          {stripRows.length > 0 &&
            stripRows.map((row) => (
              <div key={row.label} className={pillCls} title={`${row.label}: ${row.value && typeof row.value === 'object' && row.value.base ? row.value.base : row.value}`}>
                <span className="font-semibold text-white/75">{row.label}</span>
                <span className="font-bold text-white">
                  {row.value && typeof row.value === 'object' && row.value.base && row.value.age ? (
                    <>
                      <span>{row.value.base}</span>
                      <span className="text-white/70"> ({row.value.age})</span>
                    </>
                  ) : (
                    row.value
                  )}
                </span>
              </div>
            ))}
          {customer.bypassReason && (
            <div className={`${pillCls} border-white/40 bg-white/15`} title={bypassText}>
              <span className="material-symbols-outlined flex size-6 shrink-0 items-center justify-center text-[22px] leading-none text-white">
                info
              </span>
              <span className="whitespace-nowrap font-semibold leading-none text-white">{bypassText}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white p-6 ${containerClassName}`}>
      <h1 className="text-3xl font-extrabold tracking-tight text-brand-blue">
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
              variant="compact"
            />
          )}
        </div>
      </div>

      {detailRows.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          {detailRows.map((row) => {
            const isDateRow = row.label === 'Joined' || row.label === 'Last Transacted';
            return (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-brand-blue/5 px-2.5 py-1.5">
              <span className="font-semibold text-brand-blue/75">{row.label}</span>
              <span className="text-right font-bold text-brand-blue">
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
