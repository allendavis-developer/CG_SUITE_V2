import React, { useState, useRef, useEffect, useMemo } from 'react';
import { OfferCard, Icon } from '@/components/ui/components';
import { formatGBP, calculateMargin, formatOfferPrice, normalizeExplicitSalePrice } from '@/utils/helpers';

/**
 * Offer selection component.
 * When onAddToCart is provided: clicking an offer adds with that offer selected.
 * Add to Cart: if the Manual Offer field has a valid amount, adds with that manual offer; otherwise adds with no tier selected.
 * When showAddActionCard is false: keeps tier + manual field but hides Add to Cart (Enter in the manual field still applies manual).
 */
const OfferSelection = ({
  variant,
  offers = [],
  referenceData,
  offerType = 'cash',
  onAddToCart = null,
  initialSelectedOfferId = null,
  editMode = false,
  onOfferPriceChange = null,
  onSelectedOfferChange = null,
  syncKey = null,
  showAddActionCard = true,
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  /** Compact cards in a horizontal row; Add to Cart matches card height (builder / CeX workspace). */
  toolbarLayout = false,
  /** Omit the “Available … Valuations” heading (use beside title/model name; region has aria-label). */
  hideSectionHeader = false,
  /** With toolbarLayout: let offer + cart cells grow to fill the row (no max-width cap per cell). */
  toolbarFillWidth = false,
  className = '',
}) => {
  const formatPriceInput = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatOfferPrice(parsed) : '';
  };

  const [selectedOfferId, setSelectedOfferId] = useState(initialSelectedOfferId);
  const [localPrices, setLocalPrices] = useState({});
  const [manualOfferInput, setManualOfferInput] = useState('');
  const manualOfferInputRef = useRef(null);
  // Track which input (by offer id) currently has focus so we never clobber it mid-type.
  const focusedOfferIdRef = useRef(null);
  // Track the last syncKey we initialised prices for, so we reset when the item changes.
  const lastSyncKeyRef = useRef(null);

  // Sync selected offer when external value changes (e.g. loading a cart item)
  useEffect(() => {
    setSelectedOfferId(initialSelectedOfferId);
  }, [initialSelectedOfferId]);

  // Initialise / reset local editable prices when the item context changes or offers first load.
  // Never overwrite a price that is currently being typed (focused).
  useEffect(() => {
    const itemChanged = syncKey !== lastSyncKeyRef.current;
    if (editMode) {
      lastSyncKeyRef.current = syncKey;
    }
    setLocalPrices(prev => {
      const next = { ...prev };
      offers.forEach(o => {
        // Skip the focused input unless the item itself changed, to preserve in-progress typing.
        if (!itemChanged && editMode && focusedOfferIdRef.current === o.id) return;
        next[o.id] = formatPriceInput(o.price);
      });
      return next;
    });
  }, [offers, editMode, syncKey]);

  const offersResetKey = `${syncKey ?? ''}|${offers.map((o) => o.id).join('|')}`;
  useEffect(() => {
    setManualOfferInput('');
  }, [offersResetKey]);

  if (!variant || !offers || offers.length === 0) return null;

  const headerText = offerType === 'voucher'
    ? 'Available Voucher Valuations'
    : 'Available Trade-In Valuations';

  const ourSalePrice = referenceData?.our_sale_price;
  const showAddToCart = Boolean(onAddToCart) && !editMode;
  const showAddAction = showAddToCart && showAddActionCard;
  const useToolbarLayout = toolbarLayout && !editMode;
  const showInlineManualOffer = showAddToCart;

  const manualPctOfSale = useMemo(() => {
    const sale = Number(ourSalePrice);
    if (!Number.isFinite(sale) || sale <= 0 || !manualOfferInput) return null;
    const clean = parseFloat(String(manualOfferInput).replace(/[£,]/g, ''));
    if (!Number.isFinite(clean) || clean <= 0) return null;
    return Math.round((clean / sale) * 100);
  }, [ourSalePrice, manualOfferInput]);

  const handleOfferClick = (offerId) => {
    const slot = offerId ? `offer${String(offerId).match(/_(\d)$/)?.[1] || ''}` : null;
    if (slot && blockedOfferSlots?.has(slot)) {
      const blockedOffer = offers.find((o) => o.id === offerId) || null;
      onBlockedOfferClick?.(slot, blockedOffer, offerId);
      return;
    }
    setSelectedOfferId(offerId);
    onAddToCart?.(offerId);
  };

  const parseManualOfferAmount = () => {
    const raw = String(manualOfferInput || '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return parsed;
  };

  /** Returns true if a manual add was triggered (including blocked). */
  const tryAddWithManualOfferFromField = () => {
    if (!onAddToCart) return false;
    const parsed = parseManualOfferAmount();
    if (parsed == null) return false;
    if (blockedOfferSlots?.has('manual')) {
      onBlockedOfferClick?.('manual', null, {
        type: 'manual',
        amount: parsed,
        baseOfferId: null,
      });
      return true;
    }
    onAddToCart({
      type: 'manual',
      amount: parsed,
      baseOfferId: null,
    });
    setManualOfferInput('');
    return true;
  };

  const handlePrimaryAddToCart = () => {
    if (!onAddToCart) return;
    if (tryAddWithManualOfferFromField()) return;
    onAddToCart(null);
  };

  const commitPriceChange = (offerId, rawValue) => {
    if (!onOfferPriceChange) return;
    const raw = String(rawValue ?? localPrices[offerId] ?? '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const normalized = normalizeExplicitSalePrice(parsed);
      setLocalPrices(prev => ({ ...prev, [offerId]: formatOfferPrice(normalized) }));
      onOfferPriceChange(offerId, normalized);
    }
  };

  const offersOnlyGridCols =
    editMode || !showAddAction
      ? 'grid-cols-3'
      : offers.length >= 4
        ? 'grid-cols-2 sm:grid-cols-4'
        : offers.length === 3
          ? 'grid-cols-3'
          : offers.length === 2
            ? 'grid-cols-2'
            : 'grid-cols-1 max-w-sm mx-auto sm:mx-0';

  return (
    <div className={className || undefined} role="region" aria-label={headerText}>
      {!hideSectionHeader && (
        <h3
          className={`text-xs font-bold text-gray-400 uppercase tracking-widest ${
            useToolbarLayout ? 'mb-2' : 'mb-4'
          }`}
        >
          {headerText}
        </h3>
      )}

      <div className={useToolbarLayout ? '' : 'space-y-4'}>
      <div
        className={
          useToolbarLayout
            ? 'flex min-w-0 w-full items-center gap-2 flex-wrap'
            : `grid gap-4 ${offersOnlyGridCols}`
        }
      >
        {offers.map((offer, index) => {
          const displayPrice = editMode
            ? parseFloat(localPrices[offer.id] ?? offer.price)
            : parseFloat(offer.price);
          const recalculatedMargin = ourSalePrice
            ? calculateMargin(displayPrice, ourSalePrice)
            : null;
          const isHighlighted = offer.id === selectedOfferId;
          const slotMatch = String(offer.id || '').match(/_(\d)$/);
          const slot = slotMatch ? `offer${slotMatch[1]}` : null;
          const isBlocked = slot && blockedOfferSlots?.has(slot);

          if (editMode) {
            return (
              <div
                key={offer.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedOfferId(offer.id);
                  onSelectedOfferChange?.(offer.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedOfferId(offer.id);
                    onSelectedOfferChange?.(offer.id);
                  }
                }}
                className={`
                  cg-animate-list-item p-6 rounded-xl bg-white text-center relative overflow-hidden border-2 cursor-pointer
                  transition-all duration-200 ease-out
                  ${isHighlighted
                    ? 'border-brand-blue ring-2 ring-brand-blue ring-offset-2 ring-offset-white shadow-xl shadow-brand-blue/10 scale-[1.03]'
                    : 'border-brand-blue/40 hover:border-brand-blue/70'
                  }
                `}
              >
                <div className={`absolute top-0 left-0 w-full ${isHighlighted ? 'h-1.5 bg-brand-orange' : 'h-1 bg-brand-orange/60'}`} />
                <h4 className="text-[10px] font-black uppercase text-brand-blue mb-3 tracking-wider">
                  {offer.title}
                </h4>
                <div className="relative mb-3" onClick={(e) => e.stopPropagation()}>
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-blue">£</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full pl-7 pr-3 py-2 border-2 border-brand-blue/30 rounded-lg text-lg font-extrabold text-brand-blue text-center focus:outline-none focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue"
                    value={localPrices[offer.id] ?? formatPriceInput(offer.price)}
                    onFocus={() => { focusedOfferIdRef.current = offer.id; }}
                    onChange={(e) => {
                      setLocalPrices(prev => ({ ...prev, [offer.id]: e.target.value }));
                    }}
                    onBlur={(e) => {
                      focusedOfferIdRef.current = null;
                      commitPriceChange(offer.id, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitPriceChange(offer.id, e.currentTarget.value);
                        e.target.blur();
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Margin</span>
                  <span className="text-xs font-extrabold text-brand-orange">{recalculatedMargin}%</span>
                </div>
              </div>
            );
          }

          if (useToolbarLayout) {
            const priceNumber = Number.parseFloat(offer.price);
            const displayPrice = Number.isFinite(priceNumber) ? formatOfferPrice(priceNumber) : '0.00';
            const content = (
              <>
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">
                  {offer.title}
                </span>
                <span className="text-lg font-extrabold leading-tight text-inherit">
                  £{displayPrice}
                </span>
                {recalculatedMargin != null ? (
                  <span className="text-[10px] font-bold text-brand-orange-hover">{recalculatedMargin}% sale</span>
                ) : null}
              </>
            );

            return (
              <React.Fragment key={offer.id}>
                {index > 0 && <div className="w-px h-8 bg-gray-200 shrink-0" />}
                <div
                  className="relative shrink-0"
                  title={isBlocked ? 'Blocked — requires senior management authorisation' : undefined}
                >
                  {onAddToCart ? (
                    <button
                      type="button"
                      className={`flex flex-col text-left transition-all focus:outline-none rounded-lg border px-2.5 py-1.5 shadow-sm ${
                        isBlocked
                          ? 'cursor-not-allowed bg-red-50/70 border-red-200/70 opacity-70 text-brand-blue'
                          : isHighlighted
                          ? 'ring-2 ring-brand-blue bg-brand-blue/10 border-brand-blue/30 cursor-pointer text-brand-blue hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700'
                          : 'bg-brand-blue/5 border-brand-blue/20 text-brand-blue hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 active:scale-[0.99] cursor-pointer'
                      }`}
                      onClick={() => handleOfferClick(offer.id)}
                    >
                      {content}
                      {isBlocked && (
                        <span className="text-[9px] font-bold text-red-500 flex items-center gap-0.5 mt-0.5">
                          <span className="material-symbols-outlined text-[11px]">lock</span>
                          Auth required
                        </span>
                      )}
                    </button>
                  ) : (
                    <div
                      className={`flex flex-col rounded-lg border px-2.5 py-1.5 shadow-sm ${
                        isBlocked
                          ? 'cursor-not-allowed bg-red-50/70 border-red-200/70 opacity-70 text-brand-blue'
                          : isHighlighted
                          ? 'ring-2 ring-brand-blue bg-brand-blue/10 border-brand-blue/30 text-brand-blue hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700'
                          : 'bg-brand-blue/5 border-brand-blue/20 text-brand-blue'
                      }`}
                    >
                      {content}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          }

          const offerWrapClass = [
            isBlocked ? 'relative cg-animate-list-item' : 'cg-animate-list-item',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={offer.id}
              className={offerWrapClass}
              title={isBlocked ? 'Blocked — requires senior management authorisation' : undefined}
            >
              <OfferCard
                title={offer.title}
                price={formatGBP(parseFloat(offer.price))}
                margin={recalculatedMargin}
                isHighlighted={isHighlighted}
                onClick={onAddToCart ? () => handleOfferClick(offer.id) : null}
                size="default"
              />
              {isBlocked ? <div className="absolute inset-0 rounded-xl bg-red-50/55 pointer-events-none" /> : null}
              {isBlocked ? (
                <div
                  className={`pointer-events-none flex items-center justify-center ${
                    useToolbarLayout ? 'mt-1.5' : '-mt-6 mb-2'
                  }`}
                >
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                    <span className="material-symbols-outlined text-[12px]">lock</span>
                    Auth required
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
        {showInlineManualOffer && useToolbarLayout && (
          <>
            <div className="w-px h-8 bg-gray-200 shrink-0" />
            <div
              className="flex min-w-0 flex-col cursor-text rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-2.5 py-1.5 shadow-sm transition-all hover:bg-brand-blue/10 hover:border-brand-blue/30 active:scale-[0.99] min-h-[56px] shrink-0"
              onClick={() => manualOfferInputRef.current?.focus()}
            >
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none">
                Manual Offer
              </span>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-lg font-extrabold leading-tight text-brand-blue">£</span>
                <input
                  ref={manualOfferInputRef}
                  type="text"
                  className="min-w-[4.5rem] w-20 border-b-2 border-brand-blue/20 bg-transparent text-lg font-extrabold leading-tight text-brand-blue outline-none focus:border-brand-blue/40"
                  placeholder="0.00"
                  value={manualOfferInput}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setManualOfferInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (showAddAction) {
                      handlePrimaryAddToCart();
                      return;
                    }
                    tryAddWithManualOfferFromField();
                  }}
                  aria-label="Manual offer amount"
                />
              </div>
              {manualPctOfSale != null ? (
                <span className="text-[10px] font-bold text-brand-orange-hover">{manualPctOfSale}% sale</span>
              ) : null}
            </div>
          </>
        )}
        {showAddAction && useToolbarLayout && (
          <>
            <div className="w-px h-8 bg-gray-200 shrink-0" />
            <button
              type="button"
              onClick={handlePrimaryAddToCart}
              title="Add to cart"
              aria-label="Add to cart"
              className="flex min-h-[56px] min-w-11 shrink-0 cursor-pointer items-center justify-center self-stretch rounded-lg bg-brand-orange px-4 text-brand-blue shadow-lg shadow-brand-orange/30 transition-all hover:bg-brand-orange-hover active:scale-[0.99]"
            >
              <Icon name="add_shopping_cart" className="text-[22px]" aria-hidden />
            </button>
          </>
        )}
      </div>
        {showInlineManualOffer && !useToolbarLayout && (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex min-w-0 max-w-md flex-1 flex-col cursor-text rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-4 py-3 shadow-sm transition-all hover:bg-brand-blue/10 hover:border-brand-blue/30 active:scale-[0.99]"
              onClick={() => manualOfferInputRef.current?.focus()}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Manual Offer
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xl font-extrabold text-brand-blue">£</span>
                <input
                  ref={manualOfferInputRef}
                  type="text"
                  className="min-w-[6rem] flex-1 border-b-2 border-brand-blue/20 bg-transparent text-xl font-extrabold text-brand-blue outline-none focus:border-brand-blue/40 sm:max-w-xs"
                  placeholder="0.00"
                  value={manualOfferInput}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setManualOfferInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (showAddAction) {
                      handlePrimaryAddToCart();
                      return;
                    }
                    tryAddWithManualOfferFromField();
                  }}
                  aria-label="Manual offer amount"
                />
              </div>
              {manualPctOfSale != null ? (
                <span className="mt-1 text-[10px] font-bold text-brand-orange-hover">{manualPctOfSale}% sale</span>
              ) : null}
            </div>
          </div>
        )}
        {showAddAction && !useToolbarLayout && (
          <div
            role="button"
            tabIndex={0}
            onClick={handlePrimaryAddToCart}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handlePrimaryAddToCart();
              }
            }}
            className="w-full min-w-0 p-6 rounded-xl bg-brand-orange cursor-pointer text-center relative overflow-hidden border-2 border-brand-orange transition-all duration-200 ease-out hover:bg-brand-orange-hover hover:border-brand-orange shadow-md shadow-brand-orange/10 active:scale-[0.98]"
          >
            <h4 className="text-[10px] font-black uppercase text-brand-blue mb-4 tracking-wider">
              Action
            </h4>
            <p className="text-4xl font-extrabold text-brand-blue mb-2 flex items-center justify-center gap-2">
              <Icon name="add_shopping_cart" className="text-3xl" />
              Add to Cart
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfferSelection;
