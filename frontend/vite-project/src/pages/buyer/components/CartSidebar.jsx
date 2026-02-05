import React, { useState } from 'react';
import { Icon, Button } from '@/components/ui/components';
import { useNavigate } from "react-router-dom";

/**
 * Shopping cart sidebar component - No totals, non-selectable offers
 */
const CartSidebar = ({ 
  cartItems = [], 
  setCartItems = () => {}, 
  customerData,
  currentRequestId,
  onFinalize
}) => {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const navigate = useNavigate();

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
      <div className="bg-white p-6 shadow-md shadow-blue-900/10">
        <h1 className="text-blue-900 text-xl font-extrabold tracking-tight">
          {customerData.name}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <p className="text-blue-900/80 text-sm font-medium">
            Cancel Rate: {customerData.cancelRate}%
          </p>
          <span className="text-blue-900/40">•</span>
          <p className={`text-sm font-bold ${
            customerData.transactionType === 'sale' 
              ? 'text-emerald-600' 
              : 'text-purple-600'
          }`}>
            {customerData.transactionType === 'sale' ? 'Direct Sale' : 'Buy Back'}
          </p>
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="shopping_cart" className="text-4xl text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No items in cart</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.id}
              className="border border-blue-900/10 rounded-lg p-3 bg-gray-50/30"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
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
                  onClick={() => removeItem(item.id)}
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
                  Valuation Options:
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
          ))
        )}
      </div>

     {/* Footer – Offer Range + Action */}
      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">
        
        {/* Offer Min / Max */}
        <div className="space-y-1">
          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-black uppercase tracking-widest text-blue-900">
              Offer Min
            </span>
            <span className="text-3xl font-black text-blue-900 tabular-nums">
              {offerMin !== null ? `£${offerMin.toFixed(2)}` : '—'}
            </span>
          </div>

          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-black uppercase tracking-widest text-blue-900">
              Offer Max
            </span>
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