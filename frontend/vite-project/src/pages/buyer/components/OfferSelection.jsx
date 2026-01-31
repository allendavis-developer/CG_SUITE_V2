import React from 'react';
import { OfferCard } from '@/components/ui/components';
import ManualOfferCard from './ManualOfferCard';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component
 */
const OfferSelection = ({ 
  variant, 
  offers, 
  ourSalePrice, 
  selectedOfferId, 
  setSelectedOfferId,
  manualOfferPrice,
  setManualOfferPrice
}) => {
  if (!variant || offers.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
        Suggested Trade-In Offers
      </h3>

      <div className="grid grid-cols-4 gap-4">
        {offers.map((offer) => {
          const recalculatedMargin = calculateMargin(offer.price, ourSalePrice);
          
          return (
            <OfferCard
              key={offer.id}
              title={offer.title}
              price={formatGBP(parseFloat(offer.price))}
              margin={recalculatedMargin}
              isHighlighted={selectedOfferId === offer.id}
              onClick={() => setSelectedOfferId(offer.id)}
            />
          );
        })}
        
        <ManualOfferCard
          isHighlighted={selectedOfferId === 'manual'}
          onClick={() => setSelectedOfferId('manual')}
          manualPrice={manualOfferPrice}
          setManualPrice={setManualOfferPrice}
        />
      </div>
    </div>
  );
};

export default OfferSelection;