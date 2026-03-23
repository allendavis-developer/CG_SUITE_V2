import React from 'react';
import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';
import { resolveOurSalePrice, getDisplayOffers } from '../utils/negotiationHelpers';

// ─── Reusable offer cell (1st / 2nd / 3rd) ────────────────────────────────

function OfferCell({ offer, item, quantity, mode, isSelected, onSelect, ourSalePrice }) {
  const margin = ourSalePrice && offer ? ((ourSalePrice - offer.price) / ourSalePrice) * 100 : null;

  return (
    <td
      className={`align-top font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
      style={isSelected ? { background: 'rgba(34, 197, 94, 0.15)', fontWeight: 'bold', color: '#166534' } : {}}
      onClick={() => { if (offer && mode !== 'view') onSelect(offer.id); }}
    >
      {offer ? (
        <div>
          <div>£{(offer.price * quantity).toFixed(2)}</div>
          {margin !== null && (
            <div className="text-[9px] font-medium" style={{ color: margin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
              {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
            </div>
          )}
          {quantity > 1 && (
            <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>(£{offer.price.toFixed(2)} × {quantity})</div>
          )}
        </div>
      ) : '-'}
    </td>
  );
}

// ─── Price cell with optional link ─────────────────────────────────────────

function PriceCell({ value, quantity, className, href }) {
  if (value == null) return <td className={className}>—</td>;
  const total = (value * quantity).toFixed(2);
  const inner = (
    <div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted">£{total}</a>
      ) : (
        <div>£{total}</div>
      )}
      {quantity > 1 && <div className="text-[9px] opacity-70">(£{value.toFixed(2)} × {quantity})</div>}
    </div>
  );
  return <td className={`${className} align-top`}>{inner}</td>;
}

// ─── Main row component ────────────────────────────────────────────────────

export default function NegotiationItemRow({
  item,
  index,
  mode,
  useVoucherOffers,
  onQuantityChange,
  onSelectOffer,
  onContextMenu,
  onSetManualOffer,
  onCustomerExpectationChange,
  onOurSalePriceChange,
  onOurSalePriceBlur,
  onOurSalePriceFocus,
  onReopenResearch,
  onReopenCashConvertersResearch,
}) {
  const quantity = item.quantity || 1;
  const displayOffers = getDisplayOffers(item, useVoucherOffers);
  const offer1 = displayOffers?.[0];
  const offer2 = displayOffers?.[1];
  const offer3 = displayOffers?.[2];
  const isViewMode = mode === 'view';
  const ebayData = item.ebayResearchData;
  const cashConvertersData = item.cashConvertersResearchData;
  const ourSalePrice = resolveOurSalePrice(item);
  const cexOutOfStock = item.cexOutOfStock || item.cexProductData?.isOutOfStock || false;

  const manualValue = item.manualOffer ? parseFloat(item.manualOffer.replace(/[£,]/g, '')) : null;
  const manualMargin = manualValue && ourSalePrice ? ((ourSalePrice - manualValue) / ourSalePrice) * 100 : null;
  const manualExceedsSale = ourSalePrice && manualValue && manualValue > ourSalePrice;

  // Our sale price editing
  const perUnitOurPriceRaw =
    item.ourSalePrice === ''
      ? null
      : (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
          ? Number(item.ourSalePrice)
          : (item.useResearchSuggestedPrice !== false && item.ebayResearchData?.stats?.suggestedPrice != null
              ? Number(item.ebayResearchData.stats.suggestedPrice)
              : null));
  const fromExplicitOurSale =
    item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== '';
  const perUnitOurPrice =
    perUnitOurPriceRaw != null && !Number.isNaN(perUnitOurPriceRaw) && perUnitOurPriceRaw > 0
      ? (fromExplicitOurSale ? normalizeExplicitSalePrice(perUnitOurPriceRaw) : roundSalePrice(perUnitOurPriceRaw))
      : null;
  const totalOurPrice = perUnitOurPrice != null && !Number.isNaN(perUnitOurPrice) ? perUnitOurPrice * quantity : null;
  const isEditingRowTotal = item.ourSalePriceInput !== undefined;
  const salePriceInputValue = isEditingRowTotal
    ? item.ourSalePriceInput
    : (totalOurPrice != null && !Number.isNaN(totalOurPrice) ? totalOurPrice.toFixed(2) : '');

  return (
    <tr
      key={item.id || index}
      className={item.isRemoved ? 'opacity-60' : ''}
      style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
      onContextMenu={mode === 'negotiate' ? (e) => { e.preventDefault(); onContextMenu(e, item); } : undefined}
    >
      {/* Qty */}
      <td className="text-center">
        {isViewMode ? (
          <span className="font-bold">{quantity}</span>
        ) : (
          <input
            className="w-12 text-center border rounded px-1 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              onQuantityChange(item.id, Number.isNaN(parsed) || parsed <= 0 ? 1 : parsed);
            }}
          />
        )}
      </td>

      {/* Item Name & Attributes */}
      <td>
        <div className="font-bold text-[13px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--brand-blue)' }}>
          {item.title || 'N/A'}
          {item.isRemoved && (
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700">
              Removed from cart
            </span>
          )}
          {cexOutOfStock && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
              CeX out of stock
            </span>
          )}
        </div>
        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {(item.cexBuyPrice != null || item.cexSellPrice != null) ? (item.subtitle || '') : (item.subtitle || item.category || 'No details')} {item.model && `| ${item.model}`}
        </div>
        {mode === 'negotiate' && (
          <div className="text-[9px] mt-1 text-slate-400 italic">Click manual offer field or right-click to set</div>
        )}
      </td>

      {/* CeX Buy Cash / Voucher / Sell */}
      <PriceCell value={item.cexBuyPrice} quantity={quantity} className="font-medium text-emerald-700" />
      <PriceCell value={item.cexVoucherPrice} quantity={quantity} className="font-medium text-amber-700" />
      <PriceCell value={item.cexSellPrice} quantity={quantity} className="font-medium text-blue-800" href={item.cexUrl} />

      {/* 1st / 2nd / 3rd Offer */}
      <OfferCell offer={offer1} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer1?.id} onSelect={(id) => onSelectOffer(item.id, id)} />
      <OfferCell offer={offer2} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer2?.id} onSelect={(id) => onSelectOffer(item.id, id)} />
      <OfferCell offer={offer3} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer3?.id} onSelect={(id) => onSelectOffer(item.id, id)} />

      {/* Manual Offer */}
      <td
        className={`relative ${mode === 'negotiate' ? 'cursor-pointer' : ''}`}
        onClick={mode === 'negotiate' ? (e) => { e.stopPropagation(); onSetManualOffer(item); } : undefined}
        role={mode === 'negotiate' ? 'button' : undefined}
        tabIndex={mode === 'negotiate' ? 0 : undefined}
        onKeyDown={mode === 'negotiate' ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetManualOffer(item); } } : undefined}
      >
        {item.manualOffer && item.selectedOfferId === 'manual' ? (
          <div
            className="rounded px-2 py-1.5 text-xs font-bold text-center"
            style={{
              background: manualExceedsSale ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.15)',
              color: manualExceedsSale ? '#dc2626' : '#166534',
              border: manualExceedsSale ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.4)',
            }}
          >
            {isViewMode && (item.manualOfferUsed || item.selectedOfferId === 'manual') && (
              <div className="text-[9px] font-normal opacity-80 mb-0.5" style={{ color: 'inherit' }}>Manual offer</div>
            )}
            <div className="flex items-center justify-center gap-1">
              £{(parseFloat(item.manualOffer) * quantity).toFixed(2)}
              {manualExceedsSale && (
                <span className="material-symbols-outlined text-red-500 text-[14px]"
                  title={item.seniorMgmtApprovedBy ? `Exceeds sale price — approved by ${item.seniorMgmtApprovedBy}` : 'Exceeds sale price — approved by senior management'}>
                  warning
                </span>
              )}
            </div>
            {quantity > 1 && (
              <div className="text-[9px] opacity-70 mt-0.5">(£{parseFloat(item.manualOffer).toFixed(2)} × {quantity})</div>
            )}
            {manualMargin !== null && (
              <div className="text-[9px] font-semibold mt-0.5" style={{ color: manualMargin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
                {manualMargin >= 0 ? '+' : ''}{manualMargin.toFixed(1)}% margin
                {ourSalePrice && ` (£${Math.abs(ourSalePrice - parseFloat(item.manualOffer)).toFixed(2)})`}
              </div>
            )}
            {(item.seniorMgmtApprovedBy || (manualExceedsSale && isViewMode)) && (
              <div className="text-[9px] mt-1 font-semibold" style={{ color: manualExceedsSale ? '#b91c1c' : 'var(--text-muted)' }}>
                {item.seniorMgmtApprovedBy ? `Approved by: ${item.seniorMgmtApprovedBy}` : 'Approved by senior management'}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-slate-400 text-[11px]">
            {mode === 'negotiate' ? <span className="italic">Click or right-click to set</span> : '—'}
          </div>
        )}
      </td>

      {/* Customer Expectation */}
      <td className="p-0">
        <input
          className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
          style={{ background: '#f8fafc', outline: 'none' }}
          placeholder="£0.00"
          type="text"
          value={item.customerExpectation || ''}
          onChange={isViewMode ? undefined : (e) => onCustomerExpectationChange(item.id, e.target.value)}
          onKeyDown={isViewMode ? undefined : (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          readOnly={isViewMode}
        />
      </td>

      {/* Our Sale Price */}
      <td className="font-medium text-purple-700">
        {isViewMode ? (
          perUnitOurPrice != null ? (
            <div>
              <div>£{(perUnitOurPrice * quantity).toFixed(2)}</div>
              {quantity > 1 && <div className="text-[9px] opacity-70">(£{perUnitOurPrice.toFixed(2)} × {quantity})</div>}
            </div>
          ) : '—'
        ) : (
          <div>
            <input
              className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0 bg-white rounded"
              placeholder="£0.00"
              type="text"
              value={salePriceInputValue}
              onChange={(e) => onOurSalePriceChange(item.id, e.target.value.replace(/[£,]/g, '').trim())}
              onBlur={() => onOurSalePriceBlur(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onFocus={() => {
                if (item.ourSalePriceInput === undefined && salePriceInputValue !== '') {
                  onOurSalePriceFocus(item.id, salePriceInputValue);
                }
              }}
            />
            {!isEditingRowTotal && totalOurPrice != null && !Number.isNaN(totalOurPrice) && (
              <div className="text-[9px] opacity-70 mt-0.5">
                £{totalOurPrice.toFixed(2)}
                {quantity > 1 && (
                  <span>{` ( £${perUnitOurPrice != null && !Number.isNaN(perUnitOurPrice) ? perUnitOurPrice.toFixed(2) : '0.00'} × ${quantity} )`}</span>
                )}
              </div>
            )}
          </div>
        )}
      </td>

      {/* eBay Research */}
      <td>
        {ebayData?.stats?.median ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold" style={{ color: 'var(--brand-blue)' }}>
                £{(Number(ebayData.stats.median) * quantity).toFixed(2)}
              </div>
              {quantity > 1 && (
                <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>(£{Number(ebayData.stats.median).toFixed(2)} × {quantity})</div>
              )}
            </div>
            <button
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={() => onReopenResearch(item)}
              title={isViewMode ? 'View eBay Research (Read-only)' : 'View/Refine Research'}
            >
              <span className="material-symbols-outlined text-[16px]">edit_note</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
            <button
              className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!ebayData && isViewMode ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={(!ebayData && isViewMode) ? undefined : () => onReopenResearch(item)}
              title={(!ebayData && isViewMode) ? 'No research available' : (!ebayData ? 'Research' : 'View eBay Research (Read-only)')}
              disabled={!ebayData && isViewMode}
            >
              <span className="material-symbols-outlined text-[16px]">search_insights</span>
            </button>
          </div>
        )}
      </td>

      {/* Cash Converters */}
      <td>
        {cashConvertersData?.stats?.median ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-medium" style={{ color: 'var(--brand-blue)' }}>
              <div>£{(Number(cashConvertersData.stats.median) * quantity).toFixed(2)}</div>
              {quantity > 1 && (
                <div className="text-[9px] opacity-70">(£{Number(cashConvertersData.stats.median).toFixed(2)} × {quantity})</div>
              )}
            </div>
            <button
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={() => onReopenCashConvertersResearch(item)}
              title={isViewMode ? 'View Cash Converters Research (Read-only)' : 'View/Refine Research'}
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
            <button
              className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!cashConvertersData && isViewMode ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={(!cashConvertersData && isViewMode) ? undefined : () => onReopenCashConvertersResearch(item)}
              title={(!cashConvertersData && isViewMode) ? 'No research available' : (!cashConvertersData ? 'Research' : 'View Cash Converters Research (Read-only)')}
              disabled={!cashConvertersData && isViewMode}
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
