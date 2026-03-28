import React from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/pages/buyer/spreadsheetTableStyles';
import {
  getDisplayOffers,
  resolveOurSalePrice,
} from '@/pages/buyer/utils/negotiationHelpers';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import { formatOfferPrice } from '@/utils/helpers';

function SlimOfferCell({
  offer,
  quantity,
  mode,
  isSelected,
  onSelect,
  ourSalePrice,
  onContextMenu,
}) {
  const margin = ourSalePrice && offer ? ((ourSalePrice - offer.price) / ourSalePrice) * 100 : null;
  const isView = mode === 'view';
  return (
    <td
      className={`align-top text-[13px] leading-snug text-gray-900 ${isView ? '' : 'cursor-pointer'}`}
      style={
        isSelected
          ? {
              background: 'rgba(34, 197, 94, 0.15)',
              fontWeight: 700,
              color: '#166534',
            }
          : { fontWeight: 600 }
      }
      onClick={() => {
        if (offer && !isView) onSelect(offer.id);
      }}
      onContextMenu={onContextMenu}
    >
      {offer ? (
        <div>
          <div>£{formatOfferPrice((offer.price ?? 0) * quantity)}</div>
          {margin != null && (
            <div
              className={`text-[9px] font-medium ${isSelected ? 'text-green-800' : 'text-brand-blue'}`}
            >
              {margin >= 0 ? '+' : ''}
              {margin.toFixed(1)}% margin
            </div>
          )}
        </div>
      ) : (
        '—'
      )}
    </td>
  );
}

/**
 * Jewellery quote rows — workspace-style columns plus manual offer & customer expectation (same behaviour as main items).
 */
export default function JewelleryNegotiationSlimTable({
  items,
  mode,
  useVoucherOffers,
  onSelectOffer,
  onRowContextMenu,
  onSetManualOffer,
  onCustomerExpectationChange,
}) {
  const isView = mode === 'view';

  const openRowContext = (e, item, zone) => {
    e.preventDefault();
    if (mode !== 'negotiate' || !onRowContextMenu) return;
    onRowContextMenu(e, item, zone);
  };

  const ctxRemoveOnly = (item) =>
    mode === 'negotiate' && onRowContextMenu
      ? (e) => openRowContext(e, item, NEGOTIATION_ROW_CONTEXT.ITEM_META)
      : undefined;

  return (
    <>
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <table className="w-full spreadsheet-table border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="min-w-[140px]">
              Item
            </th>
            <th scope="col" className="min-w-[120px]">
              Reference
            </th>
            <th scope="col" className="w-24">
              Weight
            </th>
            <th scope="col" className="w-24">
              Unit
            </th>
            <th scope="col" className="w-28">
              Total
            </th>
            <th scope="col" className="w-24 spreadsheet-th-offer-tier">
              1st
            </th>
            <th scope="col" className="w-24 spreadsheet-th-offer-tier">
              2nd
            </th>
            <th scope="col" className="w-24 spreadsheet-th-offer-tier">
              3rd
            </th>
            <th scope="col" className="w-36">
              Manual
            </th>
            <th scope="col" className="w-32">
              Customer Expectation
            </th>
          </tr>
        </thead>
        <tbody className="text-xs">
          {items.map((item, index) => {
            const ref = item.referenceData || {};
            const quantity = item.quantity || 1;
            const displayOffers = getDisplayOffers(item, useVoucherOffers);
            const offer1 = displayOffers[0];
            const offer2 = displayOffers[1];
            const offer3 = displayOffers[2];
            const ourSalePrice = resolveOurSalePrice(item);
            const totalGbp =
              ref.computed_total_gbp != null
                ? Number(ref.computed_total_gbp)
                : ourSalePrice != null
                  ? ourSalePrice * quantity
                  : null;
            const unitLabel =
              ref.weight_unit === 'each' ? 'each' : ref.weight_unit || '—';

            const manualValue = item.manualOffer
              ? parseFloat(String(item.manualOffer).replace(/[£,]/g, ''))
              : null;
            const manualMargin =
              manualValue != null && !Number.isNaN(manualValue) && ourSalePrice
                ? ((ourSalePrice - manualValue) / ourSalePrice) * 100
                : null;
            const manualExceedsSale =
              ourSalePrice && manualValue != null && !Number.isNaN(manualValue) && manualValue > ourSalePrice;

            return (
              <tr
                key={item.id || `jew-q-${index}`}
                className={item.isRemoved ? 'opacity-60' : ''}
                style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
              >
                <td className="break-words font-medium text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  <div>{item.variantName || item.title || '—'}</div>
                  {mode === 'negotiate' && (
                    <div className="text-[9px] mt-1 text-slate-400 italic">
                      Click manual offer field or right-click to set
                    </div>
                  )}
                </td>
                <td className="break-words text-gray-600" onContextMenu={ctxRemoveOnly(item)}>
                  {ref.reference_display_name ?? '—'}
                </td>
                <td className="tabular-nums text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  {ref.weight ?? '—'}
                </td>
                <td className="text-gray-600" onContextMenu={ctxRemoveOnly(item)}>
                  {unitLabel}
                </td>
                <td className="font-semibold tabular-nums text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  {totalGbp != null && totalGbp > 0 ? `£${formatOfferPrice(totalGbp)}` : '—'}
                </td>
                <SlimOfferCell
                  offer={offer1}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer1?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                />
                <SlimOfferCell
                  offer={offer2}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer2?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                />
                <SlimOfferCell
                  offer={offer3}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer3?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                />
                <td
                  className={`relative ${mode === 'negotiate' ? 'cursor-pointer' : ''}`}
                  onContextMenu={
                    mode === 'negotiate' && onRowContextMenu
                      ? (e) => openRowContext(e, item, NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER)
                      : undefined
                  }
                  onClick={
                    mode === 'negotiate' && onSetManualOffer
                      ? (e) => {
                          e.stopPropagation();
                          onSetManualOffer(item);
                        }
                      : undefined
                  }
                  role={mode === 'negotiate' ? 'button' : undefined}
                  tabIndex={mode === 'negotiate' ? 0 : undefined}
                  onKeyDown={
                    mode === 'negotiate' && onSetManualOffer
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSetManualOffer(item);
                          }
                        }
                      : undefined
                  }
                >
                  {item.manualOffer && item.selectedOfferId === 'manual' ? (
                    <div
                      className="rounded px-2 py-1.5 text-xs font-bold text-center"
                      style={{
                        background: manualExceedsSale ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.15)',
                        color: manualExceedsSale ? '#dc2626' : '#166534',
                        border: manualExceedsSale
                          ? '1px solid rgba(239,68,68,0.3)'
                          : '1px solid rgba(34,197,94,0.4)',
                      }}
                    >
                      {isView && (item.manualOfferUsed || item.selectedOfferId === 'manual') && (
                        <div className="text-[9px] font-normal opacity-80 mb-0.5" style={{ color: 'inherit' }}>
                          Manual offer
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-1">
                        £{formatOfferPrice((manualValue || 0) * quantity)}
                        {manualExceedsSale && (
                          <span
                            className="material-symbols-outlined text-red-500 text-[14px]"
                            title={
                              item.seniorMgmtApprovedBy
                                ? `Exceeds sale price — approved by ${item.seniorMgmtApprovedBy}`
                                : 'Exceeds sale price — approved by senior management'
                            }
                          >
                            warning
                          </span>
                        )}
                      </div>
                      {quantity > 1 && (
                        <div className="text-[9px] opacity-70 mt-0.5">
                          (£{formatOfferPrice(manualValue || 0)} × {quantity})
                        </div>
                      )}
                      {manualMargin != null && (
                        <div
                          className="text-[9px] font-semibold mt-0.5"
                          style={{ color: manualMargin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}
                        >
                          {manualMargin >= 0 ? '+' : ''}
                          {manualMargin.toFixed(1)}% margin
                          {ourSalePrice &&
                            ` (£${formatOfferPrice(Math.abs(ourSalePrice - (manualValue || 0)))})`}
                        </div>
                      )}
                      {(item.seniorMgmtApprovedBy || (manualExceedsSale && isView)) && (
                        <div
                          className="text-[9px] mt-1 font-semibold"
                          style={{ color: manualExceedsSale ? '#b91c1c' : 'var(--text-muted)' }}
                        >
                          {item.seniorMgmtApprovedBy
                            ? `Approved by: ${item.seniorMgmtApprovedBy}`
                            : 'Approved by senior management'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-slate-400 text-[11px]">
                      {mode === 'negotiate' ? <span className="italic">Click or right-click to set</span> : '—'}
                    </div>
                  )}
                </td>
                <td className="p-0" onContextMenu={ctxRemoveOnly(item)}>
                  <input
                    className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
                    style={{ background: '#f8fafc', outline: 'none' }}
                    placeholder="£0.00"
                    type="text"
                    value={item.customerExpectation || ''}
                    onChange={isView ? undefined : (e) => onCustomerExpectationChange(item.id, e.target.value)}
                    onKeyDown={
                      isView
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }
                    }
                    readOnly={isView}
                  />
                </td>
              </tr>
            );
          })}
          <tr className="h-10 opacity-50">
            <td colSpan="10" />
          </tr>
        </tbody>
      </table>
    </>
  );
}
