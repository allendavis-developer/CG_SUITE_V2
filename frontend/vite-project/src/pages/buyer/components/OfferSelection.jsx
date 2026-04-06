import React, { useState, useRef, useEffect } from 'react';
import { OfferCard, Icon } from '@/components/ui/components';
import { formatGBP, calculateMargin, formatOfferPrice, normalizeExplicitSalePrice } from '@/utils/helpers';

/**
 * Offer selection component.
 * When onAddToCart is provided: clicking an offer adds with that offer selected;
 * Add to Cart button adds with no offer selected.
 * Right-click on an offer card opens a context menu to pick an offer and add to cart on Enter.
 * When showAddActionCard is false: keeps card interactions but hides Add to Cart action card.
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
}) => {
  const formatPriceInput = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatOfferPrice(parsed) : '';
  };

  const [selectedOfferId, setSelectedOfferId] = useState(initialSelectedOfferId);
  const [localPrices, setLocalPrices] = useState({});
  const [contextMenu, setContextMenu] = useState(null); // { x, y, baseIndex, value }
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const didInitialFocusRef = useRef(false);
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

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeContextMenu();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      didInitialFocusRef.current = false;
      return;
    }
    if (!didInitialFocusRef.current && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      didInitialFocusRef.current = true;
    }
  }, [contextMenu]);

  if (!variant || !offers || offers.length === 0) return null;

  const headerText = offerType === 'voucher'
    ? 'Available Voucher Valuations'
    : 'Available Trade-In Valuations';

  const ourSalePrice = referenceData?.our_sale_price;
  const showAddToCart = Boolean(onAddToCart) && !editMode;
  const showAddAction = showAddToCart && showAddActionCard;

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

  const openContextMenu = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onAddToCart) return;
    const baseOffer = offers[index];
    const basePrice = baseOffer ? parseFloat(baseOffer.price) : NaN;
    const initialValue = !Number.isNaN(basePrice) && basePrice > 0 ? formatOfferPrice(basePrice) : '';
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      baseIndex: index,
      value: initialValue
    });
  };

  const applyManualAndAddToCart = () => {
    if (!onAddToCart || !contextMenu) return;
    const raw = String(contextMenu.value || '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed <= 0) {
      closeContextMenu();
      return;
    }
    if (blockedOfferSlots?.has('manual')) {
      onBlockedOfferClick?.('manual', null, {
        type: 'manual',
        amount: parsed,
        baseOfferId: offers[contextMenu.baseIndex]?.id ?? null,
      });
      closeContextMenu();
      return;
    }
    onAddToCart({
      type: 'manual',
      amount: parsed,
      baseOfferId: offers[contextMenu.baseIndex]?.id ?? null,
    });
    closeContextMenu();
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
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        {headerText}
      </h3>

      <div className="space-y-4">
      <div className={`grid gap-4 ${offersOnlyGridCols}`}>
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

          return (
            <div
              key={offer.id}
              onContextMenu={showAddToCart ? (e) => openContextMenu(e, index) : undefined}
              className={isBlocked ? 'relative cg-animate-list-item' : 'cg-animate-list-item'}
              title={isBlocked ? 'Blocked — requires senior management authorisation' : undefined}
            >
              <OfferCard
                title={offer.title}
                price={formatGBP(parseFloat(offer.price))}
                margin={recalculatedMargin}
                isHighlighted={isHighlighted}
                onClick={onAddToCart ? () => handleOfferClick(offer.id) : null}
              />
              {isBlocked ? <div className="absolute inset-0 rounded-xl bg-red-50/55 pointer-events-none" /> : null}
              {isBlocked ? (
                <div className="pointer-events-none -mt-6 mb-2 flex items-center justify-center">
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                    <span className="material-symbols-outlined text-[12px]">lock</span>
                    Auth required
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
        {showAddAction && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onAddToCart(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(null); } }}
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

      {contextMenu && (
        <div
          ref={menuRef}
          className="cg-animate-popover fixed z-[100] w-72 bg-white rounded-lg border border-gray-200 shadow-xl p-3"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="dialog"
          aria-label="Set manual offer"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-2">
            Custom offer for this item
          </p>
          <p className="text-[11px] text-gray-500 mb-3">
            Type a per-item offer amount and press Enter or click Okay to apply this manual offer.
          </p>
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-blue">£</span>
              <input
                ref={inputRef}
                type="number"
                min="0"
                step="0.01"
                className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25 focus:border-brand-blue"
                placeholder="0.00"
                value={contextMenu.value}
                onChange={(e) => {
                  const val = e.target.value;
                  setContextMenu((prev) => (prev ? { ...prev, value: val } : prev));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyManualAndAddToCart();
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2.5 text-sm font-semibold text-white bg-brand-blue rounded-lg hover:bg-brand-blue-hover shrink-0"
              onClick={applyManualAndAddToCart}
            >
              Okay
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 rounded-lg hover:bg-gray-50"
              onClick={closeContextMenu}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferSelection;
