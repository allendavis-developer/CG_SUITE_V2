import React, { useRef, useEffect } from 'react';
import { Icon, Button } from '@/components/ui/components';
import { useNavigate } from 'react-router-dom';
import { formatOfferPrice } from '@/utils/helpers';
import useAppStore, { useCartItems, useCustomerData, useOfferTotals, useIsRepricing } from '@/store/useAppStore';

const CartSidebar = ({ mode = 'buyer', onTransactionTypeChange = null }) => {
  const isRepricing = useIsRepricing();
  const cartItems = useCartItems();
  const customerData = useCustomerData();
  const request = useAppStore((s) => s.request);
  const selectedCartItemId = useAppStore((s) => s.selectedCartItemId);
  const selectCartItem = useAppStore((s) => s.selectCartItem);
  const removeFromCart = useAppStore((s) => s.removeFromCart);
  const updateCartItem = useAppStore((s) => s.updateCartItem);
  const resetBuyer = useAppStore((s) => s.resetBuyer);
  const { offerMin, offerMax, totalOffer } = useOfferTotals();

  const cartListRef = useRef(null);
  const prevCartLengthRef = useRef(cartItems.length);
  const navigate = useNavigate();

  useEffect(() => {
    if (cartItems.length > prevCartLengthRef.current) {
      requestAnimationFrame(() => {
        const el = cartListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
    prevCartLengthRef.current = cartItems.length;
  }, [cartItems.length]);

  const updateQuantity = (id, newQty) => {
    if (newQty < 1) {
      const item = cartItems.find((i) => i.id === id);
      if (item) removeFromCart(item);
      return;
    }
    updateCartItem(id, { quantity: newQty });
  };

  const allItemsHaveOffer = cartItems.length > 0 && totalOffer !== null;

  return (
    <aside className="w-1/5 min-w-0 min-h-0 shrink-0 border-l border-blue-900/20 flex flex-col bg-white overflow-hidden">
      {/* Header */}
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
          {!isRepricing && (
            <button
              type="button"
              onClick={() => resetBuyer()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-blue-200 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear cart, customer, and start fresh"
            >
              <Icon name="refresh" className="text-sm" />
              New Buy
            </button>
          )}
        </div>
      </div>

      {/* Cart Items */}
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
              <CartItemCard
                key={item.id}
                item={item}
                isSelected={selectedCartItemId === item.id}
                isRepricing={isRepricing}
                customerData={customerData}
                onSelect={() => selectCartItem(item)}
                onRemove={() => removeFromCart(item)}
                onIncrement={() => updateQuantity(item.id, (item.quantity || 1) + 1)}
                onDecrement={() => updateQuantity(item.id, (item.quantity || 1) - 1)}
                onQuantityChange={(val) => updateQuantity(item.id, parseInt(val) || 1)}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">
        {!isRepricing && (
          <div className="space-y-1">
            <OfferRow label="Offer Min" value={offerMin} type={customerData.transactionType} />
            <OfferRow label="Offer Max" value={offerMax} type={customerData.transactionType} />
            {allItemsHaveOffer && (
              <div className="flex justify-between items-baseline pt-2 border-t border-blue-900/10">
                <div className="flex flex-col">
                  <span className="text-2xl font-black uppercase tracking-widest text-blue-900">Total Offer</span>
                  <span className="text-[9px] text-gray-500 font-bold">
                    {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}
                  </span>
                </div>
                <span className="text-3xl font-black text-blue-900 tabular-nums">£{totalOffer.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full group"
          onClick={() => {
            const repricingSessionId = isRepricing ? useAppStore.getState().repricingSessionId : null;
            navigate(isRepricing ? '/repricing-negotiation' : '/negotiation', {
              state: {
                cartItems,
                customerData,
                currentRequestId: request?.request_id,
                offerMin,
                offerMax,
                totalOffer: allItemsHaveOffer ? totalOffer : null,
                ...(repricingSessionId ? { sessionId: repricingSessionId } : {}),
              },
            });
          }}
          disabled={cartItems.length === 0}
        >
          {isRepricing ? 'View Reprice List' : 'Negotiate'}
          <Icon name="arrow_forward" className="ml-2 text-sm group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </aside>
  );
};

function OfferRow({ label, value, type }) {
  return (
    <div className="flex justify-between items-baseline">
      <div className="flex flex-col">
        <span className="text-2xl font-black uppercase tracking-widest text-blue-900">{label}</span>
        <span className="text-[9px] text-gray-500 font-bold">
          {type === 'store_credit' ? '(Voucher)' : '(Cash)'}
        </span>
      </div>
      <span className="text-3xl font-black text-blue-900 tabular-nums">
        {value !== null ? `£${formatOfferPrice(value)}` : '—'}
      </span>
    </div>
  );
}

function CartItemCard({ item, isSelected, isRepricing, customerData, onSelect, onRemove, onIncrement, onDecrement, onQuantityChange }) {
  const displayOffers = item.offers?.length
    ? item.offers
    : (customerData?.transactionType === 'store_credit' ? item.voucherOffers : item.cashOffers) || [];
  const hasManualSelected = item.selectedOfferId === 'manual' && item.manualOffer != null && item.manualOffer !== '';
  const showOffers = !isRepricing && (displayOffers.length > 0 || hasManualSelected);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`border rounded-lg p-3 cursor-pointer transition-all relative select-none ${
        isSelected
          ? 'border-blue-600 bg-blue-50 shadow-md'
          : 'border-blue-900/10 bg-gray-50/30 hover:border-blue-400 hover:bg-blue-50/50'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <Icon name="check_circle" className="text-blue-600 text-base" />
        </div>
      )}
      <div className="flex justify-between items-start">
        <div className="flex-1 pr-6">
          <h4 className="font-bold text-sm text-blue-900">{item.title}</h4>
          <p className="text-xs text-blue-900/60">{item.subtitle}</p>
        </div>
        <Button variant="ghost" className="h-6 w-6 p-0 min-w-0" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="close" className="text-sm" />
        </Button>
      </div>

      {!isRepricing && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Qty:</span>
          <div className="flex items-center border border-blue-900/20 rounded-md overflow-hidden">
            <Button variant="ghost" className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50" onClick={(e) => { e.stopPropagation(); onDecrement(); }}>
              <Icon name="remove" className="text-sm text-blue-900" />
            </Button>
            <input
              type="number"
              min="1"
              value={item.quantity || 1}
              onChange={(e) => onQuantityChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="w-12 h-7 text-center text-sm font-semibold text-blue-900 border-x border-blue-900/20 focus:outline-none focus:bg-blue-50"
            />
            <Button variant="ghost" className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50" onClick={(e) => { e.stopPropagation(); onIncrement(); }}>
              <Icon name="add" className="text-sm text-blue-900" />
            </Button>
          </div>
        </div>
      )}

      {showOffers && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">
            Valuation Options {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}:
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            {displayOffers.map((offer, idx) => (
              <React.Fragment key={offer.id}>
                <span
                  className={`font-medium px-2 py-0.5 rounded ${
                    item.selectedOfferId === offer.id ? 'bg-blue-600 text-white' : ''
                  }`}
                >
                  £{formatOfferPrice(offer.price)}
                </span>
                {(idx < displayOffers.length - 1 || hasManualSelected) && <span className="text-gray-300">|</span>}
              </React.Fragment>
            ))}
            {hasManualSelected && (
              <span className="font-medium px-2 py-0.5 rounded bg-blue-600 text-white">
                Manual £{formatOfferPrice(item.manualOffer)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CartSidebar;
