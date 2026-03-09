import React, { useState, useRef, useEffect } from 'react';
import { OfferCard, Icon } from '@/components/ui/components';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component.
 * When onAddToCart is provided: clicking an offer adds with that offer selected;
 * Add to Cart button adds with no offer selected.
 * Right-click on an offer card opens a context menu to pick an offer and add to cart on Enter.
 */
const OfferSelection = ({
  variant,
  offers = [],
  referenceData,
  offerType = 'cash',
  onAddToCart = null
}) => {
  const [contextMenu, setContextMenu] = useState(null); // { x, y, baseIndex, value }
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const didInitialFocusRef = useRef(false);

  if (!variant || !offers || offers.length === 0) return null;

  const headerText = offerType === 'voucher'
    ? 'Available Voucher Valuations'
    : 'Available Trade-In Valuations';

  const ourSalePrice = referenceData?.our_sale_price;
  const showAddToCart = Boolean(onAddToCart);

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

  const closeContextMenu = () => setContextMenu(null);

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

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        {headerText}
      </h3>

      <div className={`grid gap-4 ${showAddToCart ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {offers.map((offer, index) => {
          const recalculatedMargin = ourSalePrice
            ? calculateMargin(offer.price, ourSalePrice)
            : null;

          return (
            <div
              key={offer.id}
              onContextMenu={showAddToCart ? (e) => openContextMenu(e, index) : undefined}
            >
              <OfferCard
                title={offer.title}
                price={formatGBP(parseFloat(offer.price))}
                margin={recalculatedMargin}
                isHighlighted={false}
                onClick={onAddToCart ? () => onAddToCart(offer.id) : null}
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