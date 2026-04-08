import React from 'react';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';
import { formatOfferPrice } from '@/utils/helpers';
import NegotiationHeaderTransactionDropdown from './NegotiationHeaderTransactionDropdown';

const LABEL_COL =
  'flex w-[12rem] shrink-0 items-center border-r border-amber-200/80 bg-amber-50/70 px-2.5';

/** One control: amber-tint label column, white value area on white strip. */
function StripField({
  label,
  children,
  valueJustify = 'justify-start',
  valueClassName = 'px-2.5',
}) {
  return (
    <div className="inline-flex h-9 max-w-full overflow-hidden rounded-md border border-amber-200/90 bg-white shadow-sm">
      <div className={LABEL_COL} title={label}>
        <span className="truncate text-[10px] font-black uppercase leading-tight tracking-wider text-brand-blue/80">
          {label}
        </span>
      </div>
      <div className={`flex min-w-0 flex-1 items-center bg-white ${valueJustify} ${valueClassName}`}>{children}</div>
    </div>
  );
}

const numCls = 'text-sm font-black tabular-nums tracking-tight text-brand-blue';

/**
 * Buying / negotiation: transaction + metrics — white bar with amber accents under customer strip.
 */
export default function NegotiationOfferMetricsBar({
  mode,
  transactionType,
  onTransactionChange,
  totalExpectation,
  setTotalExpectation,
  offerMin,
  offerMax,
  parsedTarget,
  setShowTargetModal,
  setShowNewBuyConfirm,
  actualRequestId,
  researchSandboxBookedView,
}) {
  const transaction = TRANSACTION_META[transactionType] || {
    label: 'Unknown',
    className: 'text-gray-400',
  };

  const targetHint = parsedTarget > 0 ? 'Exact total offer required' : 'Not set';
  const txLabels = TRANSACTION_OPTIONS.map((o) => o.label);

  return (
    <div className="shrink-0 border-b-2 border-amber-300/90 border-t border-t-amber-200/90 bg-white px-6 py-2 md:px-10">
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'negotiate' && (
          <button
            type="button"
            onClick={() => setShowNewBuyConfirm(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-amber-500/80 bg-brand-orange px-2.5 text-xs font-black uppercase tracking-wide text-brand-blue shadow-sm transition-colors hover:opacity-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-orange/50"
            title="Clear cart/customer and start a fresh buying session"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">refresh</span>
            New Buy
          </button>
        )}

        <StripField label="Transaction type" valueClassName="px-0">
          {mode === 'view' ? (
            <span className="min-w-[9rem] truncate px-2.5 text-sm font-semibold text-brand-blue">{transaction.label}</span>
          ) : (
            <NegotiationHeaderTransactionDropdown
              value={transaction.label}
              options={txLabels}
              onChange={(label) => {
                const selected = TRANSACTION_OPTIONS.find((o) => o.label === label);
                if (selected) onTransactionChange(selected.value);
              }}
            />
          )}
        </StripField>

        <StripField label="Customer Total Expectation" valueClassName="px-0">
          <div className="relative flex h-9 min-w-[6.75rem] flex-1 bg-amber-50/30">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-blue">
              £
            </span>
            <input
              className="h-9 w-full min-w-[5.75rem] border-0 bg-transparent py-0 pl-6 pr-2 text-sm font-bold text-brand-blue placeholder:text-brand-blue/35 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-400/80"
              type="text"
              value={totalExpectation}
              onChange={(e) => setTotalExpectation(e.target.value)}
              onKeyDown={
                mode === 'negotiate'
                  ? (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }
                  : undefined
              }
              placeholder="0.00"
              readOnly={mode === 'view'}
            />
          </div>
        </StripField>

        <StripField label="Offer Min" valueJustify="justify-end">
          <span className={`${numCls} flex items-baseline gap-0.5`}>
            <span className="text-xs font-bold text-brand-blue/70">£</span>
            {offerMin !== null ? formatOfferPrice(offerMin) : '—'}
          </span>
        </StripField>

        <StripField label="Offer Max" valueJustify="justify-end">
          <span className={`${numCls} flex items-baseline gap-0.5`}>
            <span className="text-xs font-bold text-brand-blue/70">£</span>
            {offerMax !== null ? formatOfferPrice(offerMax) : '—'}
          </span>
        </StripField>

        <StripField label="Target Offer">
          <div
            className={`flex min-w-0 flex-1 items-center gap-2 ${
              mode === 'negotiate'
                ? 'group -mx-0.5 cursor-pointer rounded px-1.5 transition-colors hover:bg-amber-50/80'
                : ''
            }`}
            onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
            role={mode === 'negotiate' ? 'button' : undefined}
            title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
          >
            <span className={`${numCls} flex shrink-0 items-baseline gap-0.5`}>
              <span className="text-xs font-bold text-brand-blue/70">£</span>
              {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
            </span>
            {mode === 'negotiate' && (
              <span className="material-symbols-outlined shrink-0 text-[18px] text-brand-blue/40 transition-colors group-hover:text-brand-blue">
                edit
              </span>
            )}
            <span className="min-w-0 truncate text-[10px] font-medium leading-tight text-gray-500" title={targetHint}>
              {targetHint}
            </span>
          </div>
        </StripField>

        <div className="ml-auto flex min-h-9 shrink-0 flex-col justify-center border-l border-amber-200/80 pl-4 text-right">
          <p className="text-[10px] font-bold uppercase leading-none tracking-wider text-gray-500">Request ID</p>
          <p className="mt-0.5 text-sm font-black leading-none tracking-tight text-brand-blue">#{actualRequestId || 'N/A'}</p>
          {mode === 'view' &&
            (researchSandboxBookedView ? (
              <p className="mt-1 inline-flex max-w-sm items-center justify-end gap-1 text-[9px] font-bold uppercase leading-snug tracking-wide text-amber-800">
                <span className="material-symbols-outlined shrink-0 text-[12px]">science</span>
                In-store testing — Park Agreement opens NoSpos and fills the first line category when CG Suite has one
              </p>
            ) : (
              <p className="mt-1 inline-flex items-center justify-end gap-1 text-[9px] font-bold uppercase tracking-wide text-red-600">
                <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                View Only
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}
