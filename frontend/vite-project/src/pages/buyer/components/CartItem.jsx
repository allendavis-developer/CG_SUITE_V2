import React from 'react';
import { Icon, Button } from '@/components/ui/components';

const CartItem = ({ item, removeItem, updateQuantity, incrementQuantity, decrementQuantity }) => {
  return (
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
  );
};

export default CartItem;