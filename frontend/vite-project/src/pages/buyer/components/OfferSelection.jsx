import React from 'react';
import { OfferCard } from '@/components/ui/components';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component - Now read-only (Selection Disabled)
 */
const OfferSelection = ({ 
  variant, 
  offers, 
  ourSalePrice 
}) => {
  if (!variant || offers.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        Available Trade-In Valuations
      </h3>

      <div className="grid grid-cols-3 gap-4 opacity-90">
        {offers.map((offer) => {
          const recalculatedMargin = calculateMargin(offer.price, ourSalePrice);
          
          return (
            <OfferCard
              key={offer.id}
              title={offer.title}
              price={formatGBP(parseFloat(offer.price))}
              margin={recalculatedMargin}
              // Selection logic removed:
              isHighlighted={false} 
              onClick={null} 
              className="cursor-default hover:border-gray-200" // Prevents pointer cursor
            />
          );
        })}
      </div>
    </div>
  );
};

export default OfferSelection;