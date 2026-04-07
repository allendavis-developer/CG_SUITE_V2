import React from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/pages/buyer/spreadsheetTableStyles';
import {
  getDisplayOffers,
  resolveOurSalePrice,
} from '@/pages/buyer/utils/negotiationHelpers';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import { formatOfferPrice } from '@/utils/helpers';
import {
  isJewelleryCoinLine,
  isJewelleryCoinSilverOzLine,
} from '@/components/jewellery/jewelleryNegotiationCart';
import { isBlockedForItem, offerIdToSlot } from '@/utils/customerOfferRules';
import TestingPassedCell from '@/pages/buyer/components/TestingPassedCell';
import TestingPassedColumnHeader from '@/pages/buyer/components/TestingPassedColumnHeader';
import { getNosposCategoryHierarchyLabelFromItem } from '@/utils/nosposCategoryMappings';

function SlimOfferCell({
  offer,
  item,
  quantity,
  mode,
  isSelected,
  onSelect,
  ourSalePrice,
  onContextMenu,
  blockedOfferSlots,
  onBlockedOfferClick,
}) {
  const margin = ourSalePrice && offer ? ((ourSalePrice - offer.price) / ourSalePrice) * 100 : null;
  const isView = mode === 'view';
  const slot = offer ? offerIdToSlot(offer.id) : null;
  const isBlocked = isBlockedForItem(slot, blockedOfferSlots, item);
  const authorisedSlots = Array.isArray(item?.authorisedOfferSlots) ? item.authorisedOfferSlots : [];
  const isAuthorisedSelected = Boolean(isSelected && slot && authorisedSlots.includes(slot) && item?.seniorMgmtApprovedBy);

  const handleClick = () => {
    if (!offer || isView) return;
    if (isBlocked) onBlockedOfferClick?.(slot, offer);
    else onSelect(offer.id);
  };

  if (!offer) {
    return <td className="align-top text-[13px] text-gray-300" onContextMenu={onContextMenu}>—</td>;
  }

  return (
    <td
      className={`align-top text-[13px] leading-snug relative ${isView ? '' : 'cursor-pointer'}`}
      style={
        isSelected && !isBlocked
          ? {
              background: 'rgba(34, 197, 94, 0.15)',
              fontWeight: 700,
              color: '#166534',
            }
          : isBlocked
            ? { background: 'rgba(239,68,68,0.06)', color: '#9ca3af', fontWeight: 600 }
            : { fontWeight: 600, color: '#111827' }
      }
      onClick={handleClick}
      onContextMenu={isBlocked ? undefined : onContextMenu}
      title={isBlocked ? 'Blocked — requires senior management authorisation' : undefined}
    >
      <div className={isBlocked ? 'opacity-60' : ''}>
        <div>£{formatOfferPrice((offer.price ?? 0) * quantity)}</div>
        {margin != null && (
          <div
            className={`text-[9px] font-medium ${isBlocked ? 'text-gray-400' : isSelected ? 'text-green-800' : 'text-brand-blue'}`}
          >
            {margin >= 0 ? '+' : ''}
            {margin.toFixed(1)}% margin
          </div>
        )}
        {isAuthorisedSelected && (
          <div className={`text-[9px] mt-1 font-semibold ${isBlocked ? 'text-gray-400' : 'text-red-700'}`}>
            Approved by: {item.seniorMgmtApprovedBy}
          </div>
        )}
      </div>
      {isBlocked && !isView && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined text-red-400 text-[18px] opacity-70">lock</span>
        </div>
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
  onJewelleryItemNameChange,
  onJewelleryWeightChange,
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  showNosposAction = false,
  getNosposAction = null,
  testingPassedColumnMode = null,
  onTestingPassedChange = null,
  testingPassedSavingId = null,
  /** Set<string> of excluded item IDs — shows a Skip NosPos checkbox column. */
  parkExcludedItems = null,
  onToggleParkExcludeItem = null,
}) {
  const showParkExclude = parkExcludedItems != null && typeof onToggleParkExcludeItem === 'function';
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
            <th scope="col" className="w-40">
              Category
            </th>
            <th scope="col" className="min-w-[140px] max-w-[220px]">
              NosPos category
            </th>
            <th scope="col" className="min-w-[120px]">
              Item Name
            </th>
            <th scope="col" className="w-24">
              Weight
            </th>
            <th scope="col" className="w-24">
              Unit
            </th>
            <th scope="col" className="w-28">
              Scrap
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
            <th scope="col" className="w-24 spreadsheet-th-offer-tier">
              4th
            </th>
            <th scope="col" className="w-36">
              Manual
            </th>
            <th scope="col" className="w-28">
              Total
            </th>
            <th scope="col" className="w-32">
              Customer Expectation
            </th>
            {showNosposAction ? (
              <th scope="col" className="w-40">
                NoSpos
              </th>
            ) : null}
            {testingPassedColumnMode ? <TestingPassedColumnHeader /> : null}
            {showParkExclude ? (
              <th scope="col" className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-amber-600">
                Skip NosPos
              </th>
            ) : null}
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
            const offer4 = displayOffers[3];
            const ourSalePrice = resolveOurSalePrice(item);
            const totalGbp =
              ref.computed_total_gbp != null
                ? Number(ref.computed_total_gbp)
                : ourSalePrice != null
                  ? ourSalePrice * quantity
                  : null;
            const unitLabel =
              ref.weight_unit === 'each' ? 'each' : ref.weight_unit || '—';
            const isCoinRow = isJewelleryCoinLine({
              productName: ref.product_name,
              materialGrade: ref.material_grade,
            });
            const isSilverOzCoin = isJewelleryCoinSilverOzLine({
              productName: ref.product_name,
              materialGrade: ref.material_grade,
            });
            const refSrc = ref.reference_price_source_kind;
            const scrapRate = ref.rate_per_gram != null ? Number(ref.rate_per_gram) : null;
            const scrapUnit =
              ref.unit_price != null ? Number(ref.unit_price) : null;
            const isUnitPricedRow =
              refSrc === 'UNIT' || ref.weight_unit === 'each';

            const manualValue = item.manualOffer
              ? parseFloat(String(item.manualOffer).replace(/[£,]/g, ''))
              : null;
            const manualMargin =
              manualValue != null && !Number.isNaN(manualValue) && ourSalePrice
                ? ((ourSalePrice - manualValue) / ourSalePrice) * 100
                : null;
            const manualExceedsSale =
              ourSalePrice && manualValue != null && !Number.isNaN(manualValue) && manualValue > ourSalePrice;
            const nosposAction = getNosposAction?.(item) || null;
            const nosposCategoryBreadcrumb = getNosposCategoryHierarchyLabelFromItem(item);

            return (
              <tr
                key={item.id || `jew-q-${index}`}
                className={item.isRemoved ? 'opacity-60' : ''}
                style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
              >
                <td className="break-words font-medium text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  <div>{ref.category_label || ref.line_title || item.variantName || item.title || '—'}</div>
                  {mode === 'negotiate' && (
                    <div className="text-[9px] mt-1 text-slate-400 italic">
                      Click manual offer to set
                    </div>
                  )}
                </td>
                <td
                  className="align-top max-w-[220px] break-words text-[10px] font-medium text-gray-600"
                  onContextMenu={ctxRemoveOnly(item)}
                  title={nosposCategoryBreadcrumb || undefined}
                >
                  {nosposCategoryBreadcrumb || '—'}
                </td>
                <td className="break-words text-gray-600" onContextMenu={ctxRemoveOnly(item)}>
                  {isView ? (
                    ref.item_name || ref.category_label || ref.line_title || item.variantName || item.title || '—'
                  ) : (
                    <input
                      className="h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                      type="text"
                      value={ref.item_name || ref.category_label || ref.line_title || item.variantName || item.title || ''}
                      onChange={(e) => onJewelleryItemNameChange?.(item, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  )}
                </td>
                <td className="tabular-nums text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  {isCoinRow ? (
                    '1 unit'
                  ) : isView ? (
                    ref.weight ?? '—'
                  ) : (
                    <input
                      className="h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                      type="number"
                      min="0"
                      step="any"
                      value={ref.weight ?? ''}
                      onChange={(e) => onJewelleryWeightChange?.(item, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  )}
                </td>
                <td className="text-gray-600" onContextMenu={ctxRemoveOnly(item)}>
                  {isCoinRow ? (isSilverOzCoin ? 't oz' : 'coin') : unitLabel}
                </td>
                <td
                  className="font-semibold tabular-nums text-gray-900"
                  onContextMenu={ctxRemoveOnly(item)}
                  title={
                    isUnitPricedRow
                      ? 'Reference price per item'
                      : 'Reference price per gram'
                  }
                >
                  {isUnitPricedRow ? (
                    scrapUnit != null && Number.isFinite(scrapUnit) && scrapUnit > 0 ? (
                      <>
                        £{formatOfferPrice(scrapUnit)}
                        <span className="ml-0.5 text-[10px] font-medium text-gray-500">
                          {isSilverOzCoin ? '/oz' : isCoinRow ? '/unit' : 'ea'}
                        </span>
                      </>
                    ) : (
                      '—'
                    )
                  ) : scrapRate != null && Number.isFinite(scrapRate) && scrapRate > 0 ? (
                    <>
                      £{formatOfferPrice(scrapRate)}
                      <span className="ml-0.5 text-[10px] font-medium text-gray-500">/g</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <SlimOfferCell
                  offer={offer1}
                  item={item}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer1?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => onBlockedOfferClick?.(slot, offer, item)}
                />
                <SlimOfferCell
                  offer={offer2}
                  item={item}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer2?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => onBlockedOfferClick?.(slot, offer, item)}
                />
                <SlimOfferCell
                  offer={offer3}
                  item={item}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer3?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => onBlockedOfferClick?.(slot, offer, item)}
                />
                <SlimOfferCell
                  offer={offer4}
                  item={item}
                  quantity={quantity}
                  mode={mode}
                  ourSalePrice={ourSalePrice}
                  isSelected={item.selectedOfferId === offer4?.id}
                  onSelect={(id) => onSelectOffer(item.id, id)}
                  onContextMenu={ctxRemoveOnly(item)}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => onBlockedOfferClick?.(slot, offer, item)}
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
                          if (isBlockedForItem('manual', blockedOfferSlots, item)) {
                            onBlockedOfferClick?.('manual', null, item);
                          } else {
                            onSetManualOffer(item);
                          }
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
                            if (isBlockedForItem('manual', blockedOfferSlots, item)) {
                              onBlockedOfferClick?.('manual', null, item);
                            } else {
                              onSetManualOffer(item);
                            }
                          }
                        }
                      : undefined
                  }
                  title={isBlockedForItem('manual', blockedOfferSlots, item) && mode === 'negotiate' ? 'Blocked — requires senior management authorisation' : undefined}
                  style={isBlockedForItem('manual', blockedOfferSlots, item) && mode === 'negotiate' ? { background: 'rgba(239,68,68,0.06)' } : {}}
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
                      {mode === 'negotiate' ? (
                        isBlockedForItem('manual', blockedOfferSlots, item) ? (
                          <span className="flex items-center justify-center gap-1 text-red-300">
                            <span className="material-symbols-outlined text-[14px]">lock</span>
                            <span className="italic text-[10px]">Auth required</span>
                          </span>
                        ) : (
                          <span className="italic">Click or right-click to set</span>
                        )
                      ) : (
                        '—'
                      )}
                    </div>
                  )}
                </td>
                <td className="font-semibold tabular-nums text-gray-900" onContextMenu={ctxRemoveOnly(item)}>
                  {totalGbp != null && totalGbp > 0 ? `£${formatOfferPrice(totalGbp)}` : '—'}
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
                {showNosposAction ? (
                  <td className="align-top">
                    {nosposAction ? (
                      <div>
                        <button
                          type="button"
                          disabled={nosposAction.disabled}
                          onClick={nosposAction.onClick}
                          className={`rounded px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide transition ${
                            nosposAction.tone === 'done'
                              ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : nosposAction.tone === 'danger'
                                ? 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                              : nosposAction.tone === 'primary'
                                ? 'bg-brand-orange text-brand-blue hover:bg-brand-orange-hover'
                                : 'border border-slate-200 bg-slate-100 text-slate-500'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {nosposAction.label}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                ) : null}
                {testingPassedColumnMode ? (
                  <TestingPassedCell
                    item={item}
                    columnMode={testingPassedColumnMode}
                    onToggle={onTestingPassedChange}
                    saving={testingPassedSavingId}
                  />
                ) : null}
                {showParkExclude ? (
                  <td className="align-top text-center">
                    <label
                      className="inline-flex cursor-pointer items-center gap-1 select-none"
                      title={parkExcludedItems.has(item.id) ? 'Re-include in NosPos park run' : 'Skip this item when parking to NosPos'}
                    >
                      <input
                        type="checkbox"
                        checked={parkExcludedItems.has(item.id)}
                        onChange={() => onToggleParkExcludeItem(item.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-[var(--brand-blue)]"
                      />
                      {parkExcludedItems.has(item.id) ? (
                        <span className="text-[10px] font-semibold text-amber-600">Skip</span>
                      ) : null}
                    </label>
                  </td>
                ) : null}
              </tr>
            );
          })}
          <tr className="h-10 opacity-50">
            <td colSpan={12 + (showNosposAction ? 1 : 0) + (testingPassedColumnMode ? 1 : 0) + (showParkExclude ? 1 : 0)} />
          </tr>
        </tbody>
      </table>
    </>
  );
}
