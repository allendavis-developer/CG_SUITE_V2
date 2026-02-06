import React from 'react';
import { OfferCard } from '@/components/ui/components';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component - Now read-only (Selection Disabled)
 */
const OfferSelection = ({ 
  variant, 
  offers = [], // Default to empty array to prevent undefined errors
  referenceData,
  offerType = 'cash' // 'cash' or 'voucher'
}) => {
  // Don't render if no variant selected or offers still loading
  if (!variant || !offers || offers.length === 0) return null;

  // Determine the header text based on offer type
  const headerText = offerType === 'voucher' 
    ? 'Available Voucher Valuations' 
    : 'Available Trade-In Valuations';

  // Get our sale price from referenceData
  const ourSalePrice = referenceData?.our_sale_price;

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        {headerText}
      </h3>

      <div className="grid grid-cols-3 gap-4 opacity-90">
        {offers.map((offer) => {
          const recalculatedMargin = ourSalePrice 
            ? calculateMargin(offer.price, ourSalePrice)
            : null;
          
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