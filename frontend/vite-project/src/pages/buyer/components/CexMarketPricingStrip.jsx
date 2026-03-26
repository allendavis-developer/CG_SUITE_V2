import React from 'react';
import { Button } from '@/components/ui/components';
import { formatGBP } from '@/utils/helpers';

function LinkedPrice({ href, children }) {
  if (!href) return children;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-lg font-extrabold text-brand-blue underline decoration-dotted decoration-2 underline-offset-[3px] hover:text-brand-blue-hover"
    >
      {children}
    </a>
  );
}

function parseOurSale(ourSalePrice) {
  if (ourSalePrice === '' || ourSalePrice == null) return null;
  const n = typeof ourSalePrice === 'number' ? ourSalePrice : parseFloat(ourSalePrice);
  return Number.isFinite(n) ? n : null;
}

/**
 * Single-line CeX pricing (+ optional compact eBay / Cash Converters when research actions are enabled).
 */
export default function CexMarketPricingStrip({
  competitorStats = [],
  ourSalePrice,
  referenceData = null,
  hideBuyInPrice = false,
  cexSku: explicitCexSku = null,
  /** Prefer persisted URL from cart (same as when the product was added). */
  cexProductUrl = null,
  ebayData = null,
  cashConvertersData = null,
  onOpenEbayResearch,
  onOpenCashConvertersResearch,
  showEbayCcResearchActions = true,
}) {
  const cexSalePrice = referenceData?.cex_sale_price ?? competitorStats?.[0]?.salePrice ?? null;
  const cexBuyPrice = referenceData?.cex_tradein_cash ?? competitorStats?.[0]?.buyPrice ?? null;
  const cexVoucherPrice =
    referenceData?.cex_tradein_voucher ?? competitorStats?.[0]?.voucherPrice ?? null;
  const cexOutOfStock =
    referenceData?.cex_out_of_stock ?? competitorStats?.[0]?.outOfStock ?? false;

  const inferredCexSku =
    explicitCexSku ?? referenceData?.cex_sku ?? referenceData?.id ?? null;
  const cexUrl =
    cexProductUrl ||
    (inferredCexSku ? `https://uk.webuy.com/product-detail?id=${inferredCexSku}` : null);

  const ourNum = parseOurSale(ourSalePrice);
  const methodLabel =
    referenceData?.percentage_used != null && referenceData.percentage_used !== ''
      ? `${referenceData.percentage_used}%`
      : '—';

  const hasEbayResearch = Boolean(ebayData?.searchTerm || ebayData?.lastSearchedTerm);
  const hasCcResearch = Boolean(
    cashConvertersData?.searchTerm || cashConvertersData?.lastSearchedTerm
  );

  const showEbayBlock =
    showEbayCcResearchActions &&
    (typeof onOpenEbayResearch === 'function' || hasEbayResearch);
  const showCcBlock =
    showEbayCcResearchActions &&
    (typeof onOpenCashConvertersResearch === 'function' || hasCcResearch);

  const kv = (label, node) => (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap sm:text-sm">
        {label}
      </span>
      <span className="text-lg font-extrabold text-gray-900 tabular-nums leading-tight sm:text-xl">
        {node}
      </span>
    </span>
  );

  const Sep = () => (
    <span className="select-none px-1 text-xl font-extrabold text-gray-200 sm:px-2 sm:text-2xl" aria-hidden>
      |
    </span>
  );

  const cexSellNode =
    cexSalePrice != null ? (
      <LinkedPrice href={cexUrl}>{formatGBP(Number(cexSalePrice))}</LinkedPrice>
    ) : (
      <span className="text-lg font-bold text-gray-400 sm:text-xl">—</span>
    );

  const buyCashNode =
    cexBuyPrice != null ? (
      <LinkedPrice href={cexUrl}>{formatGBP(Number(cexBuyPrice))}</LinkedPrice>
    ) : (
      '—'
    );
  const buyVoucherNode =
    cexVoucherPrice != null ? (
      <LinkedPrice href={cexUrl}>{formatGBP(Number(cexVoucherPrice))}</LinkedPrice>
    ) : (
      '—'
    );

  const ourNode =
    ourNum != null ? (
      <span className="inline-flex items-center rounded-lg border-2 border-amber-300/90 bg-amber-50 px-3 py-1.5 text-xl font-extrabold text-amber-950 tabular-nums shadow-md sm:text-2xl">
        {formatGBP(ourNum)}
      </span>
    ) : (
      <span className="text-lg font-bold text-gray-400 sm:text-xl">—</span>
    );

  return (
    <div
      className="rounded-2xl border-2 border-gray-200/90 bg-gradient-to-r from-slate-50/95 via-white to-slate-50/80 px-4 py-4 shadow-md sm:px-6 sm:py-5"
      role="region"
      aria-label="Market pricing"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-3 sm:gap-y-3">
        {cexOutOfStock && (
          <span className="mr-1 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700 sm:text-sm">
            Out of stock
          </span>
        )}

        {kv('CeX sell', cexSellNode)}
        <Sep />
        {kv('Our sale', ourNode)}
        <Sep />
        {kv(
          'Method',
          <span className="text-lg font-bold text-gray-800 sm:text-xl">{methodLabel}</span>
        )}

        {!hideBuyInPrice && (
          <>
            <Sep />
            {kv('Buy cash', buyCashNode)}
            <Sep />
            {kv('Buy voucher', buyVoucherNode)}
          </>
        )}

        {showEbayBlock && (
          <>
            <Sep />
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
              {kv(
                'eBay',
                hasEbayResearch && ebayData?.stats?.median != null ? (
                  formatGBP(parseFloat(ebayData.stats.median))
                ) : (
                  <span className="text-base font-semibold text-gray-500 sm:text-lg">No data</span>
                )
              )}
              {typeof onOpenEbayResearch === 'function' && (
                <Button
                  variant={hasEbayResearch ? 'outline' : 'primary'}
                  size="sm"
                  icon={hasEbayResearch ? 'refresh' : 'search_insights'}
                  onClick={() => onOpenEbayResearch()}
                  className="!h-10 !min-h-0 !px-4 text-sm font-bold sm:!h-11 sm:!px-5 sm:text-base"
                >
                  {hasEbayResearch ? 'Refine' : 'Research'}
                </Button>
              )}
            </span>
          </>
        )}

        {showCcBlock && (
          <>
            <Sep />
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
              {kv(
                'Cash Conv.',
                hasCcResearch && cashConvertersData?.stats?.median != null ? (
                  formatGBP(parseFloat(cashConvertersData.stats.median))
                ) : (
                  <span className="text-base font-semibold text-gray-500 sm:text-lg">No data</span>
                )
              )}
              {typeof onOpenCashConvertersResearch === 'function' && (
                <Button
                  variant={hasCcResearch ? 'outline' : 'primary'}
                  size="sm"
                  icon={hasCcResearch ? 'refresh' : 'store'}
                  onClick={() => onOpenCashConvertersResearch()}
                  className="!h-10 !min-h-0 !px-4 text-sm font-bold sm:!h-11 sm:!px-5 sm:text-base"
                >
                  {hasCcResearch ? 'Refine' : 'Research'}
                </Button>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
