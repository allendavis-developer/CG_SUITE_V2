import React from 'react';
import { OfferCard, Button } from '@/components/ui/components';
import { formatGBP, calculateMargin } from '@/utils/helpers';

/**
 * Offer selection component.
 * When onAddToCart is provided: clicking an offer adds with that offer selected;
 * Add to Cart button adds with no offer selected.
 */
const OfferSelection = ({
  variant,
  offers = [],
  referenceData,
  offerType = 'cash',
  onAddToCart = null
}) => {
  if (!variant || !offers || offers.length === 0) return null;

  const headerText = offerType === 'voucher'
    ? 'Available Voucher Valuations'
    : 'Available Trade-In Valuations';

  const ourSalePrice = referenceData?.our_sale_price;
  const showAddToCart = Boolean(onAddToCart);

  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
        {headerText}
      </h3>

      <div className={`grid gap-4 ${showAddToCart ? 'grid-cols-4' : 'grid-cols-3'}`}>
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
              isHighlighted={false}
              onClick={onAddToCart ? () => onAddToCart(offer.id) : null}
            />
          );
        })}
        {showAddToCart && (
          <div className="p-6 rounded-xl bg-white text-center relative overflow-hidden border-2 border-blue-900/40 flex flex-col items-center justify-center h-full min-h-0">
            <div className="h-1 bg-yellow-500/60 w-full absolute top-0 left-0" />
            <Button
              variant="primary"
              icon="add_shopping_cart"
              className="w-full justify-center py-3 font-bold"
              onClick={() => onAddToCart(null)}
            >
              Add to Cart
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfferSelection;