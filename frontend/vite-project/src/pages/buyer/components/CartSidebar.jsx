import React, { useState, useRef, useEffect } from 'react';
import { Icon, Button } from '@/components/ui/components';
import { useNavigate } from "react-router-dom";

/**
 * Shopping cart sidebar component - No totals, non-selectable offers.
 * Customer details (name, cancel rate, transaction type) are shown in the cart area for buyer mode.
 */
const CartSidebar = ({ 
  cartItems = [], 
  setCartItems = () => {}, 
  onRemoveItem = null,
  onResetBuy = null,
  customerData,
  currentRequestId,
  onFinalize,
  onItemSelect = () => {},
  selectedCartItemId = null,
  onTransactionTypeChange = null,
  mode = 'buyer'
}) => {
  const isRepricing = mode === 'repricing';
  const [isFinalizing, setIsFinalizing] = useState(false);
  const cartListRef = useRef(null);
  const prevCartLengthRef = useRef(cartItems.length);

  const navigate = useNavigate();

  // Auto-scroll to bottom when a new item is added (so user sees it was added)
  useEffect(() => {
    if (cartItems.length > prevCartLengthRef.current) {
      prevCartLengthRef.current = cartItems.length;
      requestAnimationFrame(() => {
        const el = cartListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } else {
      prevCartLengthRef.current = cartItems.length;
    }
  }, [cartItems.length]);

  const removeItem = (idOrItem) => {
    const item = typeof idOrItem === 'object' ? idOrItem : cartItems.find(i => i.id === idOrItem);
    if (!item) return;
    if (onRemoveItem) {
      onRemoveItem(item);
    } else {
      setCartItems(cartItems.filter(i => i.id !== item.id));
    }
  };

  const updateQuantity = (id, newQuantity) => {
    if (newQuantity < 1) {
      removeItem(id);
      return;
    }
    
    setCartItems(cartItems.map(item => 
      item.id === id 
        ? { ...item, quantity: newQuantity }
        : item
    ));
  };

  const incrementQuantity = (id) => {
    const item = cartItems.find(item => item.id === id);
    if (item) {
      updateQuantity(id, (item.quantity || 1) + 1);
    }
  };

  const decrementQuantity = (id) => {
    const item = cartItems.find(item => item.id === id);
    if (item) {
      updateQuantity(id, (item.quantity || 1) - 1);
    }
  };

  const getOfferMinMax = () => {
    let minTotal = 0;
    let maxTotal = 0;

    cartItems.forEach(item => {
      const qty = item.quantity || 1;
      if (item.offers && item.offers.length > 0) {
        const prices = item.offers.map(o => Number(o.price)).filter(p => !isNaN(p) && p >= 0);
        if (prices.length > 0) {
          const itemMin = Math.min(...prices);
          const itemMax = Math.max(...prices);
          minTotal += itemMin * qty;
          maxTotal += itemMax * qty;
        }
      }
    });

    // If cart is empty, return nulls
    if (cartItems.length === 0) {
      return { min: null, max: null };
    }

    return { min: minTotal, max: maxTotal };
  };

  const { min: offerMin, max: offerMax } = getOfferMinMax();

  const getTotalOffer = () => {
    let total = 0;
    for (const item of cartItems) {
      const qty = item.quantity || 1;
      if (item.selectedOfferId === 'manual' && item.manualOffer != null) {
        total += Number(item.manualOffer) * qty;
      } else if (item.selectedOfferId && item.offers?.length > 0) {
        const selected = item.offers.find(o => o.id === item.selectedOfferId);
        if (selected) total += Number(selected.price) * qty;
        else return null; // not all items have valid selection
      } else {
        return null; // item has no offer selected
      }
    }
    return cartItems.length > 0 ? total : null;
  };

  const totalOffer = getTotalOffer();
  const allItemsHaveOffer = cartItems.length > 0 && totalOffer !== null;

  return (
    <aside className="w-1/5 min-w-0 min-h-0 shrink-0 border-l border-blue-900/20 flex flex-col bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-blue-900/20 bg-blue-900 shadow-md shadow-blue-900/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-yellow-400 text-base">
              {isRepricing ? 'sell' : 'shopping_cart'}
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-white">
                {isRepricing ? 'Reprice List' : 'Cart'}
              </p>
              <p className="text-[10px] text-blue-200">
                {cartItems.length} item{cartItems.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {onResetBuy && (
            <button
              type="button"
              onClick={onResetBuy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-blue-200 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear cart, customer, and start fresh"
            >
              <Icon name="refresh" className="text-sm" />
              New Buy
            </button>
          )}
        </div>
      </div>


      {/* Cart Items List */}
      <div ref={cartListRef} className="flex-1 min-h-0 overflow-y-auto buyer-panel-scroll p-4 space-y-3 bg-white">
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
            <Icon name={isRepricing ? 'sell' : 'shopping_cart'} className="text-4xl text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No items in {isRepricing ? 'reprice list' : 'cart'}</p>
          </div>
        ) : (
          <>
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-xs text-blue-700 text-center flex items-center justify-center gap-1">
                <Icon name="info" className="text-sm" />
                Click any item to view details
              </p>
            </div>
            {cartItems.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              className={`border rounded-lg p-3 cursor-pointer transition-all relative select-none ${
                selectedCartItemId === item.id
                  ? 'border-blue-600 bg-blue-50 shadow-md'
                  : 'border-blue-900/10 bg-gray-50/30 hover:border-blue-400 hover:bg-blue-50/50'
              }`}
              onClick={() => onItemSelect(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onItemSelect(item);
                }
              }}
            >
              {selectedCartItemId === item.id && (
                <div className="absolute top-2 right-2">
                  <Icon name="check_circle" className="text-blue-600 text-base" />
                </div>
              )}
              <div className="flex justify-between items-start">
                <div className="flex-1 pr-6">
                  <h4 className="font-bold text-sm text-blue-900">
                    {item.title}
                  </h4>
                  <p className="text-xs text-blue-900/60">
                    {item.subtitle}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-6 w-6 p-0 min-w-0"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent item selection when removing
                    removeItem(item);
                  }}
                >
                  <Icon name="close" className="text-sm" />
                </Button>
              </div>

              {!isRepricing && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-medium">Qty:</span>
                  <div className="flex items-center border border-blue-900/20 rounded-md overflow-hidden">
                    <Button
                      variant="ghost"
                      className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        decrementQuantity(item.id);
                      }}
                    >
                      <Icon name="remove" className="text-sm text-blue-900" />
                    </Button>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity || 1}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        updateQuantity(item.id, value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-12 h-7 text-center text-sm font-semibold text-blue-900 border-x border-blue-900/20 focus:outline-none focus:bg-blue-50"
                    />
                    <Button
                      variant="ghost"
                      className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        incrementQuantity(item.id);
                      }}
                    >
                      <Icon name="add" className="text-sm text-blue-900" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Read-only Offers Display — hidden in repricing mode. Show when we have offers or manual offer (from any flow: CeX, eBay, DB). */}
              {!isRepricing && (() => {
                const displayOffers = item.offers?.length
                  ? item.offers
                  : (customerData?.transactionType === 'store_credit' ? item.voucherOffers : item.cashOffers) || [];
                const hasManualSelected = item.selectedOfferId === 'manual' && item.manualOffer != null && item.manualOffer !== '';
                const showSection = displayOffers.length > 0 || hasManualSelected;
                if (!showSection) return null;
                return (
                  <div className="mt-3 pt-2 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">
                      Valuation Options {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}:
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                      {displayOffers.map((offer, index) => (
                        <React.Fragment key={offer.id}>
                          <span
                            className={`font-medium px-2 py-0.5 rounded ${
                              item.selectedOfferId === offer.id
                                ? 'bg-blue-600 text-white'
                                : ''
                            }`}
                          >
                            £{Number(offer.price).toFixed(2)}
                          </span>
                          {index < displayOffers.length - 1 || hasManualSelected ? (
                            <span className="text-gray-300">|</span>
                          ) : null}
                        </React.Fragment>
                      ))}
                      {hasManualSelected && (
                        <span className="font-medium px-2 py-0.5 rounded bg-blue-600 text-white">
                          Manual £{Number(item.manualOffer).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
          </>
        )}
      </div>

      {/* Footer – Offer Range (buyer only) + Action */}
      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">

        {/* Offer Min / Max — hidden in repricing mode */}
        {!isRepricing && (
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <div className="flex flex-col">
                <span className="text-2xl font-black uppercase tracking-widest text-blue-900">
                  Offer Min
                </span>
                <span className="text-[9px] text-gray-500 font-bold">
                  {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}
                </span>
              </div>
              <span className="text-3xl font-black text-blue-900 tabular-nums">
                {offerMin !== null ? `£${offerMin.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <div className="flex flex-col">
                <span className="text-2xl font-black uppercase tracking-widest text-blue-900">
                  Offer Max
                </span>
                <span className="text-[9px] text-gray-500 font-bold">
                  {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}
                </span>
              </div>
              <span className="text-3xl font-black text-blue-900 tabular-nums">
                {offerMax !== null ? `£${offerMax.toFixed(2)}` : '—'}
              </span>
            </div>
            {allItemsHaveOffer && (
              <div className="flex justify-between items-baseline pt-2 border-t border-blue-900/10">
                <div className="flex flex-col">
                  <span className="text-2xl font-black uppercase tracking-widest text-blue-900">
                    Total Offer
                  </span>
                  <span className="text-[9px] text-gray-500 font-bold">
                    {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}
                  </span>
                </div>
                <span className="text-3xl font-black text-blue-900 tabular-nums">
                  £{totalOffer.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Proceed Button */}
        <Button 
          variant="primary" 
          size="lg" 
          className="w-full group"
          onClick={() => {
            navigate(isRepricing ? '/repricing-negotiation' : '/negotiation', { 
              state: { 
                cartItems, 
                customerData,
                currentRequestId,
                offerMin,
                offerMax,
                totalOffer: allItemsHaveOffer ? totalOffer : null
              } 
            });
          }}
          disabled={isFinalizing || cartItems.length === 0}
        >
          {isFinalizing ? (
            <Icon name="sync" className="animate-spin" />
          ) : (
            <>
              {isRepricing ? 'View Reprice List' : 'Negotiate'}
              <Icon
                name="arrow_forward"
                className="ml-2 text-sm group-hover:translate-x-1 transition-transform"
              />
            </>
          )}
        </Button>
      </div>

    </aside>
  );
};

export default CartSidebar;