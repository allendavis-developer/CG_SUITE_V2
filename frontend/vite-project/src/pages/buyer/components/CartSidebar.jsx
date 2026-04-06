import React, { useRef, useEffect, useState } from 'react';
import { Icon, Button } from '@/components/ui/components';
import { useNavigate } from 'react-router-dom';
import { formatOfferPrice } from '@/utils/helpers';
import useAppStore, { useCartItems, useCustomerData, useOfferTotals, useIsRepricing } from '@/store/useAppStore';
import TinyModal from '@/components/ui/TinyModal';

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
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);

  const handleConfirmNewSession = () => {
    setShowNewSessionConfirm(false);
    resetBuyer();
    navigate(isRepricing ? '/repricing' : '/buyer');
  };

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
  // In repricing mode, we don't want users to hit the "proceed" action again.
  const disableProceed = cartItems.length === 0 || isRepricing;

  return (
    <aside className="w-1/5 min-w-0 min-h-0 shrink-0 border-l border-brand-blue/20 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-brand-blue/20 bg-brand-blue shadow-md shadow-brand-blue/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-orange text-base">
              {isRepricing ? 'sell' : 'shopping_cart'}
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-white">
                {isRepricing ? 'Reprice List' : 'Cart'}
              </p>
              <p className="text-[10px] text-white/70">
                {cartItems.length} item{cartItems.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {!isRepricing ? (
            <button
              type="button"
              onClick={() => setShowNewSessionConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear cart, customer, and start fresh"
            >
              <Icon name="refresh" className="text-sm" />
              New Buy
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewSessionConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear reprice list and start a new repricing session"
            >
              <Icon name="refresh" className="text-sm" />
              New Repricing
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
            <div className="mb-3 p-2 bg-brand-blue/5 border border-brand-blue/20 rounded-md">
              <p className="text-xs text-brand-blue text-center flex items-center justify-center gap-1">
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
      <div className="p-6 bg-white border-t border-brand-blue/20 space-y-4">
        {!isRepricing && allItemsHaveOffer && (
          <div className="flex justify-between items-baseline">
            <div className="flex flex-col">
              <span className="text-2xl font-black uppercase tracking-widest text-brand-blue">Total Offer</span>
              <span className="text-[9px] text-gray-500 font-bold">
                {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}
              </span>
            </div>
            <span className="text-3xl font-black text-brand-blue tabular-nums">£{totalOffer.toFixed(2)}</span>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full group disabled:opacity-50 disabled:cursor-not-allowed"
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
          disabled={disableProceed}
        >
          {isRepricing ? 'View Reprice List' : 'Proceed'}
          <Icon name="arrow_forward" className="ml-2 text-sm group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>

      {showNewSessionConfirm && (
        <TinyModal
          title={isRepricing ? "Start a new repricing?" : "Start a new buy?"}
          onClose={() => setShowNewSessionConfirm(false)}
        >
          <p className="text-xs text-slate-600 mb-5">
            This will clear your current {isRepricing ? "reprice list" : "cart"} and start fresh.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: "white", color: "var(--text-muted)", border: "1px solid var(--ui-border)" }}
              onClick={() => setShowNewSessionConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: "var(--brand-orange)", color: "var(--brand-blue)" }}
              onClick={handleConfirmNewSession}
            >
              Yes, start new
            </button>
          </div>
        </TinyModal>
      )}
    </aside>
  );
};

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
      className={`cg-animate-list-item border rounded-lg p-3 cursor-pointer transition-all relative select-none ${
        isSelected
          ? 'border-brand-blue bg-brand-blue/5 shadow-md'
          : 'border-brand-blue/10 bg-gray-50/30 hover:border-brand-blue/40 hover:bg-brand-blue/5/50'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <Icon name="check_circle" className="text-brand-blue text-base" />
        </div>
      )}
      <div className="flex justify-between items-start">
        <div className="flex-1 pr-6">
          <h4 className="font-bold text-sm text-brand-blue">{item.title}</h4>
          <p className="text-xs text-brand-blue/60">{item.subtitle}</p>
        </div>
        <Button variant="ghost" className="h-6 w-6 p-0 min-w-0" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="close" className="text-sm" />
        </Button>
      </div>

      {!isRepricing && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Qty:</span>
          <div className="flex items-center border border-brand-blue/20 rounded-md overflow-hidden">
            <Button variant="ghost" className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-brand-blue/5" onClick={(e) => { e.stopPropagation(); onDecrement(); }}>
              <Icon name="remove" className="text-sm text-brand-blue" />
            </Button>
            <input
              type="number"
              min="1"
              value={item.quantity || 1}
              onChange={(e) => onQuantityChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="w-12 h-7 text-center text-sm font-semibold text-brand-blue border-x border-brand-blue/20 focus:outline-none focus:bg-brand-blue/5"
            />
            <Button variant="ghost" className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-brand-blue/5" onClick={(e) => { e.stopPropagation(); onIncrement(); }}>
              <Icon name="add" className="text-sm text-brand-blue" />
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
                    item.selectedOfferId === offer.id ? 'bg-brand-blue text-white' : ''
                  }`}
                >
                  £{formatOfferPrice(offer.price)}
                </span>
                {(idx < displayOffers.length - 1 || hasManualSelected) && <span className="text-gray-300">|</span>}
              </React.Fragment>
            ))}
            {hasManualSelected && (
              <span className="font-medium px-2 py-0.5 rounded bg-brand-blue text-white">
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
