import React from 'react';
import { OfferCard, Icon } from '@/components/ui/components';
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
          <div
            role="button"
            tabIndex={0}
            onClick={() => onAddToCart(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(null); } }}
            className="p-6 rounded-xl bg-yellow-500 cursor-pointer text-center relative overflow-hidden border-2 border-yellow-500 transition-all duration-200 ease-out hover:bg-yellow-400 hover:border-yellow-400 shadow-md shadow-yellow-500/10 active:scale-[0.98]"
          >
            <h4 className="text-[10px] font-black uppercase text-blue-900 mb-4 tracking-wider">
              Action
            </h4>
            <p className="text-4xl font-extrabold text-blue-900 mb-2 flex items-center justify-center gap-2">
              <Icon name="add_shopping_cart" className="text-3xl" />
              Add to Cart
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfferSelection;