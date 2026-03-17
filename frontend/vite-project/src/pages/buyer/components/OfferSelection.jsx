import React, { useState, useRef, useEffect } from 'react';
import { OfferCard, Icon } from '@/components/ui/components';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component.
 * When onAddToCart is provided: clicking an offer adds with that offer selected;
 * Add to Cart button adds with no offer selected.
 * Right-click on an offer card opens a context menu to pick an offer and add to cart on Enter.
 * When editMode is true: shows editable price inputs; hides Add to Cart card.
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
}) => {
  const formatPriceInput = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
  };

  const [selectedOfferId, setSelectedOfferId] = useState(initialSelectedOfferId);
  const [localPrices, setLocalPrices] = useState({});
  const [contextMenu, setContextMenu] = useState(null); // { x, y, baseIndex, value }
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const didInitialFocusRef = useRef(false);

  // Sync selected offer when external value changes (e.g. loading a cart item)
  useEffect(() => {
    setSelectedOfferId(initialSelectedOfferId);
  }, [initialSelectedOfferId]);

  // Sync local editable prices when offers change
  useEffect(() => {
    const prices = {};
    offers.forEach(o => { prices[o.id] = formatPriceInput(o.price); });
    setLocalPrices(prices);
  }, [offers]);

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

  const handleOfferClick = (offerId) => {
    setSelectedOfferId(offerId);
    onAddToCart?.(offerId);
  };

  const openContextMenu = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onAddToCart) return;
    const baseOffer = offers[index];
    const basePrice = baseOffer ? parseFloat(baseOffer.price) : NaN;
    const initialValue = !Number.isNaN(basePrice) && basePrice > 0 ? basePrice.toFixed(2) : '';
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
    onAddToCart({
      type: 'manual',
      amount: parsed,
      baseOfferId: offers[contextMenu.baseIndex]?.id ?? null,
    });
    closeContextMenu();
  };

  const commitPriceChange = (offerId) => {
    if (!onOfferPriceChange) return;
    const raw = String(localPrices[offerId] || '').replace(/[£,]/g, '').trim();
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const normalized = Number(parsed.toFixed(2));
      setLocalPrices(prev => ({ ...prev, [offerId]: normalized.toFixed(2) }));
      onOfferPriceChange(offerId, normalized);
    }
  };

  const gridCols = showAddToCart ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        {headerText}
      </h3>

      <div className={`grid gap-4 ${gridCols}`}>
        {offers.map((offer, index) => {
          const displayPrice = editMode
            ? parseFloat(localPrices[offer.id] ?? offer.price)
            : parseFloat(offer.price);
          const recalculatedMargin = ourSalePrice
            ? calculateMargin(displayPrice, ourSalePrice)
            : null;
          const isHighlighted = offer.id === selectedOfferId;

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
                  p-6 rounded-xl bg-white text-center relative overflow-hidden border-2 cursor-pointer
                  transition-all duration-200 ease-out
                  ${isHighlighted
                    ? 'border-blue-900 ring-2 ring-blue-900 ring-offset-2 ring-offset-white shadow-xl shadow-blue-900/10 scale-[1.03]'
                    : 'border-blue-900/40 hover:border-blue-900/70'
                  }
                `}
              >
                <div className={`absolute top-0 left-0 w-full ${isHighlighted ? 'h-1.5 bg-yellow-500' : 'h-1 bg-yellow-500/60'}`} />
                <h4 className="text-[10px] font-black uppercase text-blue-900 mb-3 tracking-wider">
                  {offer.title}
                </h4>
                <div className="relative mb-3" onClick={(e) => e.stopPropagation()}>
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-blue-900">£</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full pl-7 pr-3 py-2 border-2 border-blue-900/30 rounded-lg text-lg font-extrabold text-blue-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-900"
                    value={localPrices[offer.id] ?? formatPriceInput(offer.price)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocalPrices(prev => ({ ...prev, [offer.id]: val }));
                    }}
                    onBlur={() => commitPriceChange(offer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitPriceChange(offer.id);
                        e.target.blur();
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Margin</span>
                  <span className="text-xs font-extrabold text-yellow-500">{recalculatedMargin}%</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={offer.id}
              onContextMenu={showAddToCart ? (e) => openContextMenu(e, index) : undefined}
            >
              <OfferCard
                title={offer.title}
                price={formatGBP(parseFloat(offer.price))}
                margin={recalculatedMargin}
                isHighlighted={isHighlighted}
                onClick={onAddToCart ? () => handleOfferClick(offer.id) : null}
              />
            </div>
          );
        })}
        {showAddToCart && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onAddToCart(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(null); } }}
            className="p-6 rounded-xl bg-yellow-500 cursor-pointer text-center relative overflow-hidden border-2 border-yellow-500 transition-all duration-200 ease-out hover:bg-yellow-400 hover:border-yellow-400 shadow-md shadow-yellow-500/10 active:scale-[0.98]"
          >
            <h4 className="text-[10px] font-black uppercase text-blue-900 mb-4 tracking-wider">
              Action
            </h4>
            <p className="text-4xl font-extrabold text-blue-900 mb-2 flex items-center justify-center gap-2">
              <Icon name="add_shopping_cart" className="text-3xl" />
              Add to Cart
            </p>
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] w-72 bg-white rounded-lg border border-gray-200 shadow-xl p-3"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="dialog"
          aria-label="Set manual offer and add to cart"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-2">
            Custom offer for this item
          </p>
          <p className="text-[11px] text-gray-500 mb-3">
            Type a per-item offer amount and press Enter or click Okay to add to cart with this manual offer.
          </p>
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-blue-900">£</span>
              <input
                ref={inputRef}
                type="number"
                min="0"
                step="0.01"
                className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-900"
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
              className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 shrink-0"
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
