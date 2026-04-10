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
      className={`relative flex min-h-14 shrink-0 flex-col justify-between rounded-lg border px-2.5 py-1.5 shadow-sm ${cardClass}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider leading-none text-gray-500">{label}</span>
      {children}
    </div>
  );

  const priceCard = (label, rawVal) => {
    const formatted = formatStatPrice(rawVal);
    const isEmpty = formatted == null;
    return (
      <StatCard
        label={label}
        cardClass={isEmpty ? 'border-gray-200 bg-gray-50/80' : 'border-brand-blue/20 bg-brand-blue/5'}
      >
        <span
          className={`text-lg font-extrabold leading-tight ${isEmpty ? 'text-gray-400' : 'text-brand-blue'}`}
        >
          {isEmpty ? '—' : `£${formatted}`}
        </span>
      </StatCard>
    );
  };

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-wrap content-center items-center gap-2 self-stretch ${className}`.trim()}
    >
      {cexOutOfStock ? (
        <span className="mr-0.5 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
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

      <StatCard label="Suggested RRP" cardClass="border-red-200 bg-red-50">
        <span className={`text-lg font-extrabold leading-tight ${ourNum != null ? 'text-red-600' : 'text-gray-400'}`}>
          {ourNum != null ? `£${formatStatPrice(ourNum)}` : '—'}
        </span>
      </StatCard>

      <StatCard
        label="Method"
        cardClass={
          methodLabel === '—' ? 'border-gray-200 bg-gray-50/80' : 'border-brand-blue/20 bg-brand-blue/5'
        }
      >
        <span
          className={`text-lg font-extrabold leading-tight ${methodLabel === '—' ? 'text-gray-400' : 'text-brand-blue'}`}
        >
          {methodLabel}
        </span>
      </StatCard>
    </div>
  );
}
