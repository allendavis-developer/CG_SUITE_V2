import React from 'react';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';
import OfferSelection from './OfferSelection';

const EBAY_TOP_LEVEL_CATEGORY = { name: 'eBay', path: ['eBay'] };

export default function EbayCartItemView({
  item,
  isRepricing,
  useVoucherOffers,
  onOfferPriceChange,
  onSelectedOfferChange,
  onEbayResearchComplete,
  onDeselectCartItem,
}) {
  const displayOffers = useVoucherOffers ? (item.voucherOffers || []) : (item.cashOffers || []);
  const offerReferenceData = item.ourSalePrice != null ? { our_sale_price: item.ourSalePrice } : null;

  return (
    <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <div className="flex items-center gap-3 py-4">
          <div className="bg-blue-900 p-1.5 rounded">
            <span className="material-symbols-outlined text-yellow-400 text-sm">analytics</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-blue-900">eBay Research Item</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved research</p>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {!isRepricing && displayOffers.length > 0 && (
          <OfferSelection
            variant="ebay" offers={displayOffers} referenceData={offerReferenceData}
            offerType={useVoucherOffers ? 'voucher' : 'cash'}
            initialSelectedOfferId={item?.selectedOfferId ?? null} editMode={true}
            syncKey={`${item?.id ?? 'ebay'}:${useVoucherOffers ? 'voucher' : 'cash'}`}
            onOfferPriceChange={onOfferPriceChange} onSelectedOfferChange={onSelectedOfferChange}
          />
        )}
        {item.ebayResearchData ? (
          <EbayResearchForm
            key={item.id}
            mode="page" category={EBAY_TOP_LEVEL_CATEGORY}
            onComplete={onEbayResearchComplete} savedState={item.ebayResearchData}
            initialHistogramState={false} showManualOffer={false} resetDrillOnOpen={true}
            onAddNewItem={onDeselectCartItem}
            addActionLabel={isRepricing ? 'Add to Reprice List' : 'Add to Cart'} hideOfferCards={true}
          />
        ) : (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-4xl text-gray-300 mb-2">search_off</span>
            <p className="text-sm text-gray-500">No research data available</p>
          </div>
        )}
      </div>
    </section>
  );
}
