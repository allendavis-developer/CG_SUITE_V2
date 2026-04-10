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
    const lastTransactedRow = detailRows.find((r) => r.label === 'Last Transacted');
    const otherRows = detailRows.filter(
      (r) => r.label !== 'Joined' && r.label !== 'Last Transacted'
    );

    const hasDateRow = Boolean(joinedRow || lastTransactedRow);
    const hasMetricsSecondRow = otherRows.length > 0;

    const rowTitle = (row) => {
      if (!row) return '';
      const v = row.value;
      if (v && typeof v === 'object' && v.base) return `${row.label}: ${v.base}`;
      return `${row.label}: ${v}`;
    };

    const renderPillValue = (row) => (
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
    );

    const metricPill = (row) => (
      <div key={row.label} className={pillCls} title={rowTitle(row)}>
        <span className="font-semibold text-white/75">{row.label}</span>
        {renderPillValue(row)}
      </div>
    );

    const nameBlock = (
      <div
        className={`flex ${rowMinH} max-w-[min(100%,28rem)] min-w-0 shrink-0 items-center overflow-hidden rounded-md border border-white/25 bg-white/10 px-3`}
      >
        <h2 className="min-w-0 truncate text-base font-extrabold leading-tight tracking-tight text-white md:text-lg">
          {customer.name}
        </h2>
      </div>
    );

    const bypassPill = customer.bypassReason ? (
      <div className={`${pillCls} border-white/40 bg-white/15`} title={bypassText}>
        <span className="material-symbols-outlined flex size-6 shrink-0 items-center justify-center text-[22px] leading-none text-white">
          info
        </span>
        <span className="min-w-0 whitespace-normal font-semibold leading-snug text-white sm:whitespace-nowrap">
          {bypassText}
        </span>
      </div>
    ) : null;

    return (
      <div
        className={`shrink-0 border-t-4 border-t-white/35 bg-brand-blue px-6 pt-2 pb-1 ${containerClassName}`}
      >
        <div className="min-w-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:h-0">
          {!hasDateRow ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {nameBlock}
              {otherRows.map((row) => metricPill(row))}
              {bypassPill}
            </div>
          ) : (
            <div className="grid w-full min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-2 gap-y-2 items-start">
              <div className="col-start-1 row-start-1 min-w-0 self-start">
                {nameBlock}
              </div>
              <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-2">
                {joinedRow ? metricPill(joinedRow) : null}
                {lastTransactedRow ? metricPill(lastTransactedRow) : null}
                {bypassPill}
              </div>
              {hasMetricsSecondRow ? (
                <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2">
                  {otherRows.map((row) => metricPill(row))}
                </div>
              ) : null}
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
          {detailRows.map((row) => (
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
          ))}
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
