import React from 'react';

function formatStatPrice(val) {
  if (val == null || val === '') return null;
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/**
 * CeX / builder workspace: same stat-card chrome as ResearchFormShell (rounded border, uppercase label, £ values).
 * Intended to sit immediately left of offer tier controls, like stats left of buy-offer cards in the research banner.
 */
export default function WorkspacePricingStatCards({
  referenceData = null,
  ourSalePrice = '',
  hideBuyInPrice = false,
  cexOutOfStock = false,
  className = '',
}) {
  const cexSalePrice = referenceData?.cex_sale_price ?? null;
  const cexBuyPrice = referenceData?.cex_tradein_cash ?? null;
  const cexVoucherPrice = referenceData?.cex_tradein_voucher ?? null;
  const methodLabel =
    referenceData?.percentage_used != null && referenceData.percentage_used !== ''
      ? `${referenceData.percentage_used}%`
      : '—';

  const parseOur = () => {
    if (ourSalePrice === '' || ourSalePrice == null) return null;
    const n = typeof ourSalePrice === 'number' ? ourSalePrice : Number(ourSalePrice);
    return Number.isFinite(n) ? n : null;
  };
  const ourNum = parseOur();

  const StatCard = ({ label, cardClass, children }) => (
    <div
      className={`relative flex min-h-[3.5rem] shrink-0 flex-col justify-between rounded-lg border px-2.5 py-2 ${cardClass}`}
    >
      <span className="text-[9.5px] font-bold uppercase tracking-wider leading-none text-slate-500 mb-1">{label}</span>
      {children}
    </div>
  );

  const priceCard = (label, rawVal) => {
    const formatted = formatStatPrice(rawVal);
    const isEmpty = formatted == null;
    return (
      <StatCard
        label={label}
        cardClass={isEmpty ? 'border-slate-200 bg-slate-50/70' : 'border-brand-blue/15 bg-brand-blue/5'}
      >
        <span
          className={`text-base font-extrabold leading-tight tabular-nums ${isEmpty ? 'text-slate-300' : 'text-brand-blue'}`}
        >
          {isEmpty ? '—' : `£${formatted}`}
        </span>
      </StatCard>
    );
  };

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-wrap content-center items-center gap-1.5 self-stretch ${className}`.trim()}
    >
      {cexOutOfStock ? (
        <span className="mr-0.5 inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
          <span className="size-1.5 rounded-full bg-red-500" />
          Out of stock
        </span>
      ) : null}

      {priceCard('CeX sell', cexSalePrice)}

      {!hideBuyInPrice ? (
        <>
          {priceCard('Buy cash', cexBuyPrice)}
          {priceCard('Buy voucher', cexVoucherPrice)}
        </>
      ) : null}

      <StatCard label="Suggested RRP" cardClass="border-rose-200 bg-rose-50/60">
        <span className={`text-base font-extrabold leading-tight tabular-nums ${ourNum != null ? 'text-rose-600' : 'text-slate-300'}`}>
          {ourNum != null ? `£${formatStatPrice(ourNum)}` : '—'}
        </span>
      </StatCard>

      <StatCard
        label="Method"
        cardClass={
          methodLabel === '—' ? 'border-slate-200 bg-slate-50/70' : 'border-brand-blue/15 bg-brand-blue/5'
        }
      >
        <span
          className={`text-base font-extrabold leading-tight ${methodLabel === '—' ? 'text-slate-300' : 'text-brand-blue'}`}
        >
          {methodLabel}
        </span>
      </StatCard>
    </div>
  );
}
