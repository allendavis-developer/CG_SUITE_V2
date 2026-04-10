import React from 'react';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';
import { formatOfferPrice } from '@/utils/helpers';
import NegotiationHeaderTransactionDropdown from './NegotiationHeaderTransactionDropdown';

const LABEL_COL =
  'flex shrink-0 items-center self-stretch border-r border-white/25 bg-white/10 px-2.5';

/** One control: bordered cell on blue negotiation strip. */
function StripField({
  label,
  children,
  valueJustify = 'justify-start',
  valueClassName = 'px-2.5',
}) {
  return (
    <div className="inline-flex h-9 max-w-full overflow-hidden rounded-md border border-white/25 bg-white/10">
      <div className={LABEL_COL} title={label}>
        <span className="whitespace-nowrap text-left text-[10px] font-black uppercase leading-tight tracking-wider text-white/80">
          {label}
        </span>
      </div>
      <div className={`flex min-w-0 items-center bg-transparent ${valueJustify} ${valueClassName}`}>{children}</div>
    </div>
  );
}

const numCls = 'text-sm font-black tabular-nums tracking-tight text-white';
function jewelleryScrapeTimestampUi(rawValue) {
  if (!rawValue) return null;
  const dt = new Date(rawValue);
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date();
  const stale =
    dt.getFullYear() !== now.getFullYear() ||
    dt.getMonth() !== now.getMonth() ||
    dt.getDate() !== now.getDate();
  return {
    stale,
    title: `Reference scraped: ${dt.toLocaleString()}`,
    label: dt.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

/**
 * Buying / negotiation: transaction + metrics — bordered controls on white strip under customer header.
 */
export default function NegotiationOfferMetricsBar({
  mode,
  transactionType,
  onTransactionChange,
  customerExpectationValue,
  onCustomerExpectationChange,
  customerExpectationLocked = false,
  offerMin,
  offerMax,
  parsedTarget,
  setShowTargetModal,
  actualRequestId,
  researchSandboxBookedView,
  hasJewelleryReferenceData,
  jewelleryReferenceScrapedAt = null,
  headerWorkspaceOpen = false,
  headerWorkspaceMode = 'builder',
  onOpenJewelleryReferenceModal,
  className = '',
}) {
  const showJewelleryReferenceCta =
    hasJewelleryReferenceData &&
    (mode === 'view' || (headerWorkspaceOpen && headerWorkspaceMode === 'jewellery'));
  const transaction = TRANSACTION_META[transactionType] || {
    label: 'Unknown',
    className: 'text-gray-400',
  };
  const jewelleryStampUi = jewelleryScrapeTimestampUi(jewelleryReferenceScrapedAt);

  const targetHint = parsedTarget > 0 ? 'Exact total offer required' : 'Not set';
  const txLabels = TRANSACTION_OPTIONS.map((o) => o.label);

  return (
    <div className={`shrink-0 bg-brand-blue px-6 pb-2 pt-1 ${className}`.trim()}>
      <div className="flex flex-wrap items-center gap-2">
        <StripField label="Transaction type" valueClassName="px-0">
          {mode === 'view' ? (
            <span className="min-w-[9rem] truncate px-2.5 text-sm font-semibold text-white">{transaction.label}</span>
          ) : (
            <NegotiationHeaderTransactionDropdown
              value={transaction.label}
              options={txLabels}
              onChange={(label) => {
                const selected = TRANSACTION_OPTIONS.find((o) => o.label === label);
                if (selected) onTransactionChange(selected.value);
              }}
              onDarkBackground
            />
          )}
        </StripField>

        <StripField label="Customer expectation" valueClassName="px-0">
          <div className="relative h-9 w-[8.25rem] min-w-[6.75rem] max-w-[11rem]">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold text-white">
              £
            </span>
            <input
              className="h-9 w-full min-w-[5.75rem] border-0 bg-transparent py-0 pl-6 pr-2 text-sm font-bold text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/35"
              type="text"
              value={customerExpectationValue}
              onChange={(e) => onCustomerExpectationChange?.(e.target.value)}
              onKeyDown={
                mode === 'negotiate' && !customerExpectationLocked
                  ? (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }
                  : undefined
              }
              placeholder="0.00"
              readOnly={mode === 'view' || customerExpectationLocked}
            />
          </div>
        </StripField>

        <StripField label="Offer Min" valueJustify="justify-end">
          <span className={`${numCls} flex items-baseline gap-0.5`}>
            <span className="text-xs font-bold text-white/75">£</span>
            {offerMin !== null ? formatOfferPrice(offerMin) : '—'}
          </span>
        </StripField>

        <StripField label="Offer Max" valueJustify="justify-end">
          <span className={`${numCls} flex items-baseline gap-0.5`}>
            <span className="text-xs font-bold text-white/75">£</span>
            {offerMax !== null ? formatOfferPrice(offerMax) : '—'}
          </span>
        </StripField>

        <StripField label="Target Offer">
          <div
            className={`flex min-w-0 max-w-[22rem] items-center gap-2 ${
              mode === 'negotiate'
                ? 'group -mx-0.5 cursor-pointer rounded px-1.5 transition-colors hover:bg-white/10'
                : ''
            }`}
            onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
            role={mode === 'negotiate' ? 'button' : undefined}
            title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
          >
            <span className={`${numCls} flex shrink-0 items-baseline gap-0.5`}>
              <span className="text-xs font-bold text-white/75">£</span>
              {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
            </span>
            {mode === 'negotiate' && (
              <span className="material-symbols-outlined shrink-0 text-[18px] text-white/45 transition-colors group-hover:text-white">
                edit
              </span>
            )}
            <span className="min-w-0 truncate text-[10px] font-medium leading-tight text-white/65" title={targetHint}>
              {targetHint}
            </span>
          </div>
        </StripField>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {showJewelleryReferenceCta ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenJewelleryReferenceModal}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/30 bg-white/10 px-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-white/15 focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/35"
                title="Mastermelt reference prices for this request"
              >
                <span className="material-symbols-outlined text-[18px] leading-none text-white/90">table_view</span>
                Reference prices
              </button>
              {jewelleryStampUi ? (
                <span
                  className={`inline-flex h-9 shrink-0 items-center rounded-md border px-2.5 text-[10px] font-black uppercase tracking-wide ${
                    jewelleryStampUi.stale
                      ? 'animate-[pulse_0.32s_ease-in-out_infinite] border-red-300/70 bg-red-500/15 text-red-100'
                      : 'border-emerald-300/70 bg-emerald-500/15 text-emerald-100'
                  }`}
                  title={jewelleryStampUi.title}
                >
                  {jewelleryStampUi.label}
                </span>
              ) : null}
            </div>
          ) : null}

          <StripField label="Request ID">
            <div className="flex min-w-0 max-w-[20rem] items-center gap-2">
              <span className="shrink-0 text-sm font-black tabular-nums tracking-tight text-white">
                #{actualRequestId || 'N/A'}
              </span>
              {mode === 'view' &&
                (researchSandboxBookedView ? (
                  <span
                    className="inline-flex min-w-0 items-center gap-0.5 truncate text-[9px] font-bold uppercase tracking-wide text-amber-200"
                    title="In-store testing — Park Agreement opens NoSpos and fills the first line category when CG Suite has one"
                  >
                    <span className="material-symbols-outlined shrink-0 text-[12px]">science</span>
                    <span className="truncate">In-store testing</span>
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-red-200">
                    <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                    View Only
                  </span>
                ))}
            </div>
          </StripField>
        </div>

      </div>
    </div>
  );
}
