import React, { useState, useEffect } from 'react';
import { Icon, Button } from '@/components/ui/components';
import { useNavigate } from "react-router-dom";
import CustomerTransactionHeader from './CustomerTransactionHeader'

/**
 * Shopping cart sidebar component - No totals, non-selectable offers
 */
const CartSidebar = ({ 
  cartItems = [], 
  setCartItems = () => {}, 
  customerData,
  currentRequestId,
  onFinalize,
  onTransactionTypeChange,  // <--- add this
  onItemSelect = () => {},   // <--- new: callback when item is clicked
  selectedCartItemId = null  // <--- new: track which item is selected

}) => {
  const [isFinalizing, setIsFinalizing] = useState(false);

  const navigate = useNavigate();

  const TRANSACTION_DISPLAY = {
    sale: {
      label: 'Direct Sale',
      className: 'text-emerald-600'
    },
    buyback: {
      label: 'Buy Back',
      className: 'text-purple-600'
    },
    store_credit: {
      label: 'Store Credit',
      className: 'text-blue-600'
    }
  };

  const transactionMeta =
    TRANSACTION_DISPLAY[customerData.transactionType] || {
      label: 'Unknown',
      className: 'text-gray-400'
    };


  const removeItem = (id) => {
    setCartItems(cartItems.filter(item => item.id !== id));
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
        const itemMin = Math.min(...item.offers.map(o => o.price));
        const itemMax = Math.max(...item.offers.map(o => o.price));
        minTotal += itemMin * qty;
        maxTotal += itemMax * qty;
      }
    });

    // If cart is empty, return nulls
    if (cartItems.length === 0) {
      return { min: null, max: null };
    }

    return { min: minTotal, max: maxTotal };
  };

  const { min: offerMin, max: offerMax } = getOfferMinMax();


  return (
    <aside className="w-1/5 border-l border-blue-900/20 flex flex-col bg-white">
      {/* Customer Header */}
      <CustomerTransactionHeader
        customer={customerData}
        transactionType={customerData.transactionType}      // controlled by parent
        onTransactionChange={onTransactionTypeChange}      // call parent setter
        containerClassName="shadow-md shadow-blue-900/10"
      />



      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="shopping_cart" className="text-4xl text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No items in cart</p>
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
              className={`border rounded-lg p-3 cursor-pointer transition-all relative ${
                selectedCartItemId === item.id
                  ? 'border-blue-600 bg-blue-50 shadow-md'
                  : 'border-blue-900/10 bg-gray-50/30 hover:border-blue-400 hover:bg-blue-50/50'
              }`}
              onClick={() => onItemSelect(item)}
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
                    removeItem(item.id);
                  }}
                >
                  <Icon name="close" className="text-sm" />
                </Button>
              </div>

              {/* Quantity Controls */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">Qty:</span>
                <div className="flex items-center border border-blue-900/20 rounded-md overflow-hidden">
                  <Button
                    variant="ghost"
                    className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50"
                    onClick={() => decrementQuantity(item.id)}
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
                    className="w-12 h-7 text-center text-sm font-semibold text-blue-900 border-x border-blue-900/20 focus:outline-none focus:bg-blue-50"
                  />
                  <Button
                    variant="ghost"
                    className="h-7 w-7 p-0 min-w-0 rounded-none hover:bg-blue-50"
                    onClick={() => incrementQuantity(item.id)}
                  >
                    <Icon name="add" className="text-sm text-blue-900" />
                  </Button>
                </div>
              </div>

              {/* Read-only Offers Display */}
              <div className="mt-3 pt-2 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">
                  Valuation Options {customerData.transactionType === 'store_credit' ? '(Voucher)' : '(Cash)'}:
                </p>
                <div className="flex flex-wrap items-center text-xs text-gray-600">
                  {item.offers.map((offer, index) => (
                    <React.Fragment key={offer.id}>
                      <span className="font-medium">
                        £{offer.price.toFixed(2)}
                      </span>
                      {index < item.offers.length - 1 && (
                        <span className="mx-2 text-gray-300">|</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}
          </>
        )}
      </div>

     {/* Footer – Offer Range + Action */}
      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">
        
        {/* Offer Min / Max */}
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
        </div>


        {/* Negotiate Button */}
        <Button 
          variant="primary" 
          size="lg" 
          className="w-full group"
          onClick={() => {
            navigate('/negotiation', { 
              state: { 
                cartItems, 
                customerData,
                currentRequestId,
                offerMin,
                offerMax
              } 
            });
          }}
          disabled={isFinalizing || cartItems.length === 0}
        >
          {isFinalizing ? (
            <Icon name="sync" className="animate-spin" />
          ) : (
            <>
              Negotiate
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