import React from 'react';
import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';
import { getNosposCategoryHierarchyLabelFromItem } from '@/utils/nosposCategoryMappings';
import { resolveOurSalePrice, getDisplayOffers } from '../utils/negotiationHelpers';
import { NEGOTIATION_ROW_CONTEXT, RRP_SOURCE_CELL_CLASS } from '../rowContextZones';
import { isBlockedForItem, offerIdToSlot, manualSlotCommitRequiresAuthorisation } from '@/utils/customerOfferRules';
import TestingPassedCell from './TestingPassedCell';
import NosposRequiredFieldsColumnCell, {
  NosposRequiredFieldsEditorTriggerButton,
  NosposSchemaCellSpinner,
} from './NosposRequiredFieldsColumnCell';

// ─── Reusable offer cell (1st / 2nd / 3rd / 4th) ─────────────────────────────

function OfferCell({ offer, item, quantity, mode, isSelected, onSelect, ourSalePrice, onContextMenu, blockedOfferSlots, onBlockedOfferClick }) {
  const margin = ourSalePrice && offer ? ((ourSalePrice - offer.price) / ourSalePrice) * 100 : null;
  const slot = offer ? offerIdToSlot(offer.id) : null;
  const isBlocked = isBlockedForItem(slot, blockedOfferSlots, item);
  const authorisedSlots = Array.isArray(item?.authorisedOfferSlots) ? item.authorisedOfferSlots : [];
  const isAuthorisedSelected = Boolean(isSelected && slot && authorisedSlots.includes(slot) && item?.seniorMgmtApprovedBy);

  const handleClick = () => {
    if (!offer || mode === 'view') return;
    if (isBlocked) {
      onBlockedOfferClick?.(slot, offer, item);
    } else {
      onSelect(offer.id);
    }
  };

  if (!offer) {
    return <td className="align-top text-[13px] text-gray-300" onContextMenu={onContextMenu}>—</td>;
  }

  return (
    <td
      className={`align-top font-semibold text-[13px] leading-snug relative ${mode === 'view' ? '' : 'cursor-pointer'}`}
      style={
        isSelected && !isBlocked
          ? { background: 'rgba(34, 197, 94, 0.15)', fontWeight: 'bold', color: '#166534' }
          : isBlocked
          ? { background: 'rgba(239,68,68,0.06)', color: '#9ca3af' }
          : {}
      }
      onClick={handleClick}
      onContextMenu={isBlocked ? undefined : onContextMenu}
      title={isBlocked ? 'Blocked — requires senior management authorisation' : undefined}
    >
      <div className={isBlocked ? 'opacity-60' : ''}>
        <div>£{(offer.price * quantity).toFixed(2)}</div>
        {margin !== null && (
          <div className="text-[9px] font-medium" style={{ color: isBlocked ? '#9ca3af' : margin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
            {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
          </div>
        )}
        {quantity > 1 && (
          <div className="text-[9px]" style={{ color: isBlocked ? '#9ca3af' : 'var(--text-muted)' }}>
            (£{offer.price.toFixed(2)} × {quantity})
          </div>
        )}
        {isAuthorisedSelected && (
          <div className="text-[9px] mt-1 font-semibold" style={{ color: isBlocked ? '#9ca3af' : '#b91c1c' }}>
            Approved by: {item.seniorMgmtApprovedBy}
          </div>
        )}
      </div>
      {isBlocked && mode !== 'view' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined text-red-400 text-[18px] opacity-70">lock</span>
        </div>
      )}
    </td>
  );
}

// ─── Price cell with optional link ─────────────────────────────────────────

function PriceCell({ value, quantity, className, href, onContextMenu, sourceHighlight }) {
  const tdClass = [className, 'align-top', sourceHighlight ? RRP_SOURCE_CELL_CLASS : ''].filter(Boolean).join(' ');
  if (value == null) return <td className={tdClass} onContextMenu={onContextMenu}>—</td>;
  const total = (value * quantity).toFixed(2);
  const inner = (
    <div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-inherit underline decoration-dotted">£{total}</a>
      ) : (
        <div>£{total}</div>
      )}
      {quantity > 1 && <div className="text-[9px] opacity-70">(£{value.toFixed(2)} × {quantity})</div>}
    </div>
  );
  return <td className={tdClass} onContextMenu={onContextMenu}>{inner}</td>;
}

// ─── Main row component ────────────────────────────────────────────────────

export default function NegotiationItemRow({
  item,
  index,
  mode,
  /** When true (booked-for-testing view), eBay/CC research buttons stay usable as an unsaved preview. */
  allowResearchSandboxInView = false,
  useVoucherOffers,
  onQuantityChange,
  onSelectOffer,
  onRowContextMenu,
  onSetManualOffer,
  onCustomerExpectationChange,
  onOurSalePriceChange,
  onOurSalePriceBlur,
  onOurSalePriceFocus,
  onRefreshCeXData,
  onReopenResearch,
  onReopenCashConvertersResearch,
  /** Set<string> of blocked offer slot keys, e.g. new Set(['offer1','offer2','manual']) */
  blockedOfferSlots = null,
  /** Called when user clicks a blocked offer: (slot, offer) => void */
  onBlockedOfferClick = null,
  showNosposAction = false,
  nosposAction = null,
  /** null | 'booked' | 'complete' — per-line testing column in request view */
  testingPassedColumnMode = null,
  onTestingPassedChange = null,
  testingPassedSavingId = null,
  /** When provided, shows a "Skip NosPos" checkbox column. */
  parkExcluded = false,
  onToggleParkExclude = null,
  nosposCategoriesResults = null,
  nosposCategoryMappings = null,
  actualRequestId = null,
  onOpenNosposRequiredFieldsEditor = null,
  onOpenNosposCategoryPicker = null,
  hideNosposRequiredColumn = false,
}) {
  const quantity = item.quantity || 1;
  const displayOffers = getDisplayOffers(item, useVoucherOffers);
  const offer1 = displayOffers?.[0];
  const offer2 = displayOffers?.[1];
  const offer3 = displayOffers?.[2];
  const offer4 = displayOffers?.[3];
  const isViewMode = mode === 'view';
  const researchButtonsDisabled = isViewMode && !allowResearchSandboxInView;
  const ebayData = item.ebayResearchData;
  const cashConvertersData = item.cashConvertersResearchData;
  const ourSalePrice = resolveOurSalePrice(item);
  const cexOutOfStock = item.cexOutOfStock || item.cexProductData?.isOutOfStock || false;
  const primaryItemName = item.variantName || item.title || 'N/A';

  const manualValue = item.manualOffer ? parseFloat(item.manualOffer.replace(/[£,]/g, '')) : null;
  const manualMargin = manualValue && ourSalePrice ? ((ourSalePrice - manualValue) / ourSalePrice) * 100 : null;
  const manualExceedsSale = ourSalePrice && manualValue && manualValue > ourSalePrice;
  const manualOpenNeedsAuth = mode === 'negotiate' && manualSlotCommitRequiresAuthorisation(blockedOfferSlots, item);

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

  const openRowContext = (e, zone) => {
    e.preventDefault();
    if (mode !== 'negotiate' || !onRowContextMenu) return;
    onRowContextMenu(e, item, zone);
  };

  const ctxRemoveOnly =
    mode === 'negotiate' && onRowContextMenu
      ? (e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.ITEM_META)
      : undefined;

  const hlCexSource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
  const hlEbaySource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
  const hlCcSource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
  const resolvedLeafCategory =
    (Array.isArray(item.categoryObject?.path) && item.categoryObject.path.length > 0
      ? item.categoryObject.path[item.categoryObject.path.length - 1]
      : null) ||
    item.categoryObject?.name ||
    item.category ||
    '—';
  const nosposCategoryBreadcrumb = getNosposCategoryHierarchyLabelFromItem(item);

  return (
    <tr
      key={item.id || index}
      className={item.isRemoved ? 'opacity-60' : ''}
      style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
    >
      {/* Qty */}
      <td className="text-center" onContextMenu={ctxRemoveOnly}>
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

      {/* Resolved child category */}
      <td className="align-top" onContextMenu={ctxRemoveOnly}>
        <div className="text-[11px] font-semibold leading-snug" style={{ color: 'var(--text-muted)' }}>
          {resolvedLeafCategory}
        </div>
      </td>

      {/* AI-resolved NosPos stock category (breadcrumb) — clickable to change in negotiate mode */}
      <td className="align-top max-w-[220px]" onContextMenu={ctxRemoveOnly} title={nosposCategoryBreadcrumb || undefined}>
        {item.isRemoved ? (
          <div className="text-[10px] text-slate-400">—</div>
        ) : nosposCategoriesResults == null ? (
          <div className="py-1">
            <NosposSchemaCellSpinner />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {mode === 'negotiate' && onOpenNosposCategoryPicker ? (
              <button
                type="button"
                onClick={() => onOpenNosposCategoryPicker(item)}
                className={`group flex w-full items-start gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-100 ${
                  nosposCategoryBreadcrumb ? '' : 'border border-dashed border-amber-300 bg-amber-50/60 hover:bg-amber-50'
                }`}
                title={nosposCategoryBreadcrumb ? `Change NosPos category (current: ${nosposCategoryBreadcrumb})` : 'No NosPos category — click to set one'}
              >
                {nosposCategoryBreadcrumb ? (
                  <>
                    <span className="min-w-0 flex-1 break-words text-[10px] font-medium leading-snug" style={{ color: 'var(--text-muted)' }}>
                      {nosposCategoryBreadcrumb}
                    </span>
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                      edit
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] font-semibold leading-snug text-amber-700">
                    No category set
                  </span>
                )}
              </button>
            ) : (
              <div className="text-[10px] font-medium leading-snug break-words" style={{ color: 'var(--text-muted)' }}>
                {nosposCategoryBreadcrumb || '—'}
              </div>
            )}
            {hideNosposRequiredColumn ? (
              <NosposRequiredFieldsEditorTriggerButton
                item={item}
                negotiationIndex={index}
                nosposCategoriesResults={nosposCategoriesResults}
                nosposCategoryMappings={nosposCategoryMappings}
                useVoucherOffers={useVoucherOffers}
                requestId={actualRequestId}
                onOpenEditor={onOpenNosposRequiredFieldsEditor}
              />
            ) : null}
          </div>
        )}
      </td>

      {!hideNosposRequiredColumn ? (
        <NosposRequiredFieldsColumnCell
          item={item}
          negotiationIndex={index}
          nosposCategoriesResults={nosposCategoriesResults}
          nosposCategoryMappings={nosposCategoryMappings}
          useVoucherOffers={useVoucherOffers}
          requestId={actualRequestId}
          onOpenEditor={onOpenNosposRequiredFieldsEditor}
          onContextMenu={ctxRemoveOnly}
        />
      ) : null}

      {/* Item Name & Attributes */}
      <td className="align-top" onContextMenu={ctxRemoveOnly}>
        <div className="flex items-start gap-2">
          <span
            className="min-w-0 flex-1 break-words font-bold text-[13px] leading-snug"
            style={{ color: 'var(--brand-blue)' }}
          >
            {primaryItemName}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {item.isRemoved && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                Removed from cart
              </span>
            )}
            {cexOutOfStock && (
              <span className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-red-700">
                CeX out of stock
              </span>
            )}
          </div>
        </div>
      </td>

      {/* CeX Sell / Buy (Voucher) / Buy (Cash) — same order as CeX listings */}
      {isViewMode ? (
        <PriceCell
          value={item.cexSellPrice}
          quantity={quantity}
          className={hlCexSource ? 'font-medium text-white' : 'font-medium text-red-700'}
          href={item.cexUrl}
          sourceHighlight={hlCexSource}
        />
      ) : (
        <td
          className={[
            'font-medium align-top',
            hlCexSource ? `text-white ${RRP_SOURCE_CELL_CLASS}` : 'text-red-700',
          ].join(' ')}
          onContextMenu={mode === 'negotiate' && onRowContextMenu ? (e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL) : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              {item.cexSellPrice != null ? (
                <div>
                  {item.cexUrl ? (
                    <a
                      href={item.cexUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={hlCexSource ? 'text-white underline decoration-dotted' : 'text-red-700 underline decoration-dotted'}
                    >
                      £{(item.cexSellPrice * quantity).toFixed(2)}
                    </a>
                  ) : (
                    <div>£{(item.cexSellPrice * quantity).toFixed(2)}</div>
                  )}
                  {quantity > 1 && <div className="text-[9px] opacity-70">(£{item.cexSellPrice.toFixed(2)} × {quantity})</div>}
                </div>
              ) : '—'}
            </div>
            <button
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={() => onRefreshCeXData(item)}
              title="Refresh CeX prices"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </button>
          </div>
        </td>
      )}
      <PriceCell value={item.cexVoucherPrice} quantity={quantity} className="font-medium text-red-700" onContextMenu={ctxRemoveOnly} />
      <PriceCell value={item.cexBuyPrice} quantity={quantity} className="font-medium text-red-700" onContextMenu={ctxRemoveOnly} />

      {/* Customer Expectation */}
      <td className="p-0" onContextMenu={ctxRemoveOnly}>
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

      {/* 1st / 2nd / 3rd / 4th Offer */}
      <OfferCell offer={offer1} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer1?.id} onSelect={(id) => onSelectOffer(item.id, id)} onContextMenu={ctxRemoveOnly}
        blockedOfferSlots={blockedOfferSlots} onBlockedOfferClick={onBlockedOfferClick} />
      <OfferCell offer={offer2} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer2?.id} onSelect={(id) => onSelectOffer(item.id, id)} onContextMenu={ctxRemoveOnly}
        blockedOfferSlots={blockedOfferSlots} onBlockedOfferClick={onBlockedOfferClick} />
      <OfferCell offer={offer3} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer3?.id} onSelect={(id) => onSelectOffer(item.id, id)} onContextMenu={ctxRemoveOnly}
        blockedOfferSlots={blockedOfferSlots} onBlockedOfferClick={onBlockedOfferClick} />
      <OfferCell offer={offer4} item={item} quantity={quantity} mode={mode} ourSalePrice={ourSalePrice}
        isSelected={item.selectedOfferId === offer4?.id} onSelect={(id) => onSelectOffer(item.id, id)} onContextMenu={ctxRemoveOnly}
        blockedOfferSlots={blockedOfferSlots} onBlockedOfferClick={onBlockedOfferClick} />

      {/* Manual Offer */}
      <td
        className={`relative ${mode === 'negotiate' ? 'cursor-pointer' : ''}`}
        onClick={mode === 'negotiate' ? (e) => {
          e.stopPropagation();
          if (manualOpenNeedsAuth) {
            onBlockedOfferClick?.('manual', null, item);
          } else {
            onSetManualOffer(item);
          }
        } : undefined}
        role={mode === 'negotiate' ? 'button' : undefined}
        tabIndex={mode === 'negotiate' ? 0 : undefined}
        onKeyDown={mode === 'negotiate' ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (manualOpenNeedsAuth) {
              onBlockedOfferClick?.('manual', null, item);
            } else {
              onSetManualOffer(item);
            }
          }
        } : undefined}
        title={manualOpenNeedsAuth ? 'Blocked — requires senior management authorisation' : undefined}
        style={manualOpenNeedsAuth ? { background: 'rgba(239,68,68,0.06)' } : {}}
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
          <div className="text-center text-slate-400 text-[11px] relative">
            {mode === 'negotiate' ? (
              manualOpenNeedsAuth ? (
                <span className="flex items-center justify-center gap-1 text-red-300">
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                  <span className="italic text-[10px]">Auth required</span>
                </span>
              ) : (
                <span className="italic">Click to set</span>
              )
            ) : '—'}
          </div>
        )}
      </td>

      {/* Our RRP (explicit per-unit retail; was fed by research or CeX reference) */}
      <td className="font-medium text-red-700" onContextMenu={ctxRemoveOnly}>
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
      <td
        className={hlEbaySource ? RRP_SOURCE_CELL_CLASS : undefined}
        onContextMenu={mode === 'negotiate' && onRowContextMenu ? (e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY) : undefined}
      >
        {ebayData?.stats?.median ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div
                className="text-[13px] font-bold"
                style={{ color: hlEbaySource ? '#fff' : 'var(--brand-blue)' }}
              >
                £{(Number(ebayData.stats.median) * quantity).toFixed(2)}
              </div>
              {quantity > 1 && (
                <div
                  className="text-[9px]"
                  style={{ color: hlEbaySource ? 'rgba(255,255,255,0.88)' : 'var(--text-muted)' }}
                >
                  (£{Number(ebayData.stats.median).toFixed(2)} × {quantity})
                </div>
              )}
            </div>
            <button
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={researchButtonsDisabled ? undefined : () => onReopenResearch(item)}
              title={researchButtonsDisabled ? 'View-only: research locked' : 'View/Refine Research'}
              disabled={researchButtonsDisabled}
            >
              <span className="material-symbols-outlined text-[16px]">edit_note</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[13px] font-medium"
              style={{ color: hlEbaySource ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}
            >
              —
            </span>
            <button
              className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${researchButtonsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={researchButtonsDisabled ? undefined : () => onReopenResearch(item)}
              title={researchButtonsDisabled ? 'View-only: research locked' : (!ebayData ? 'Research' : 'View/Refine Research')}
              disabled={researchButtonsDisabled}
            >
              <span className="material-symbols-outlined text-[16px]">search_insights</span>
            </button>
          </div>
        )}
      </td>

      {/* Cash Converters */}
      <td
        className={hlCcSource ? RRP_SOURCE_CELL_CLASS : undefined}
        onContextMenu={mode === 'negotiate' && onRowContextMenu ? (e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS) : undefined}
      >
        {cashConvertersData?.stats?.median ? (
          <div className="flex items-center justify-between gap-2">
            <div
              className="text-[13px] font-medium"
              style={{ color: hlCcSource ? '#fff' : 'var(--brand-blue)' }}
            >
              <div>£{(Number(cashConvertersData.stats.median) * quantity).toFixed(2)}</div>
              {quantity > 1 && (
                <div
                  className="text-[9px]"
                  style={{ opacity: hlCcSource ? 0.88 : 0.7 }}
                >
                  (£{Number(cashConvertersData.stats.median).toFixed(2)} × {quantity})
                </div>
              )}
            </div>
            <button
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={researchButtonsDisabled ? undefined : () => onReopenCashConvertersResearch(item)}
              title={researchButtonsDisabled ? 'View-only: research locked' : 'View/Refine Research'}
              disabled={researchButtonsDisabled}
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[13px] font-medium"
              style={{ color: hlCcSource ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}
            >
              —
            </span>
            <button
              className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${researchButtonsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={researchButtonsDisabled ? undefined : () => onReopenCashConvertersResearch(item)}
              title={researchButtonsDisabled ? 'View-only: research locked' : (!cashConvertersData ? 'Research' : 'View/Refine Research')}
              disabled={researchButtonsDisabled}
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
            </button>
          </div>
        )}
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

      {onToggleParkExclude != null ? (
        <td className="align-top text-center">
          <label className="inline-flex cursor-pointer items-center gap-1 select-none" title={parkExcluded ? 'Re-include in NosPos park run' : 'Skip this item when parking to NosPos'}>
            <input
              type="checkbox"
              checked={parkExcluded}
              onChange={onToggleParkExclude}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-[var(--brand-blue)]"
            />
            {parkExcluded ? (
              <span className="text-[10px] font-semibold text-amber-600">Skip</span>
            ) : null}
          </label>
        </td>
      ) : null}
    </tr>
  );
}
