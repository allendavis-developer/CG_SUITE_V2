import React, { useState } from 'react';
import { Icon, Button, CartItem } from '@/components/ui/components';

/**
 * Shopping cart sidebar component
 */
const CartSidebar = ({ 
  cartItems = [], 
  setCartItems = () => {}, 
  customerData,
  currentRequestId,
  onFinalize
}) => {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [overallExpectation, setOverallExpectation] = useState('');

  const removeItem = (id) => {
    setCartItems(cartItems.filter(item => item.id !== id));
  };

  const total = cartItems.reduce((sum, item) => {
    const numericPrice = Number(item.price.replace(/[^0-9.]/g, ''));
    return sum + numericPrice;
  }, 0);

  const handleFinalize = async () => {
    if (!currentRequestId || cartItems.length === 0) {
      alert('No items in cart to finalize');
      return;
    }

    setIsFinalizing(true);
    try {
      await onFinalize();
    } catch (error) {
      console.error('Error finalizing transaction:', error);
      alert('Failed to finalize transaction. Please try again.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <aside className="w-1/5 border-l border-blue-900/20 flex flex-col bg-white">
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
        <div className="flex items-center gap-2 mt-3">
          <p className="text-blue-900/60 text-[11px] font-bold uppercase tracking-widest">
            {cartItems.length} Items
          </p>
          {currentRequestId && (
            <>
              <span className="text-blue-900/40">•</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Icon name="receipt_long" className="text-xs text-blue-900/60" />
                  <span className="text-blue-900/60 text-[11px] font-bold">
                    Request #{currentRequestId}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        {currentRequestId && (
          <div className="mt-3">
            <label className="text-blue-900/60 text-[10px] font-bold uppercase tracking-widest block mb-1">
              Overall Expectation
            </label>
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-xs">£</span>
              <input 
                className="w-full pl-5 pr-2 py-1.5 border border-blue-900/30 rounded text-sm font-bold text-blue-900 focus:ring-1 focus:ring-blue-900 focus:border-blue-900 bg-white" 
                placeholder="0.00" 
                type="number"
                step="0.01"
                value={overallExpectation}
                onChange={(e) => setOverallExpectation(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="shopping_cart" className="text-4xl text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No items in cart</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <CartItem
              key={item.id}
              title={item.title}
              subtitle={item.subtitle}
              price={item.price}
              isHighlighted={false}
              onRemove={() => removeItem(item.id)}
            />
          ))
        )}
      </div>

      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">
              Offer Total
            </span>
            <span className="font-bold text-blue-900">
              £{total.toFixed(2)}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">
              Adjustments
            </span>
            <span className="font-bold text-blue-900/40">
              £0.00
            </span>
          </div>
        </div>

        <div className="pt-4 border-t border-blue-900/20 flex justify-between items-end">
          <span className="text-xs font-bold text-blue-900 uppercase tracking-widest">
            Grand Total
          </span>
          <span className="text-2xl font-black text-blue-900 tracking-tighter">
            £{total.toFixed(2)}
          </span>
        </div>

        <Button 
          variant="primary" 
          size="lg" 
          className="w-full group"
          onClick={handleFinalize}
          disabled={isFinalizing || cartItems.length === 0}
        >
          {isFinalizing ? (
            <>
              <Icon name="sync" className="text-sm animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              Finalize Transaction
              <Icon
                name="arrow_forward"
                className="text-sm group-hover:translate-x-1 transition-transform"
              />
            </>
          )}
        </Button>
      </div>
    </aside>
  );
};

export default CartSidebar;