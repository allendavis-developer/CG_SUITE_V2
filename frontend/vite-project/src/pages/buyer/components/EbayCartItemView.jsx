import React from 'react';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';

const EBAY_TOP_LEVEL_CATEGORY = { name: 'eBay', path: ['eBay'] };

export default function EbayCartItemView({
  item,
  isRepricing,
  useVoucherOffers,
  onSelectOfferForCartItem,
  onEbayResearchComplete,
  onDeselectCartItem,
  onOffersChange,
}) {
  const displayOffers = useVoucherOffers ? (item.voucherOffers || []) : (item.cashOffers || []);
  const handleOfferSelect = (offerArg) => {
    if (!onSelectOfferForCartItem) return;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      onSelectOfferForCartItem(offerArg);
      return;
    }
    if (typeof offerArg === 'number') {
      const selected = displayOffers[offerArg];
      if (selected?.id) onSelectOfferForCartItem(selected.id);
      return;
    }
  };

  return (
    <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-hidden buyer-panel-scroll">
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40 shrink-0">
        <div className="flex items-center gap-3 py-4">
          <div className="bg-blue-900 p-1.5 rounded">
            <span className="material-symbols-outlined text-yellow-400 text-sm">analytics</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-blue-900">{item.title || 'eBay Research Item'}</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved research</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-8">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          {item.ebayResearchData ? (
            <EbayResearchForm
              key={item.id}
              mode="page" category={EBAY_TOP_LEVEL_CATEGORY}
              onComplete={onEbayResearchComplete} savedState={item.ebayResearchData}
              initialHistogramState={false} showManualOffer={false} resetDrillOnOpen={true}
              onAddNewItem={onDeselectCartItem}
              onOfferSelect={handleOfferSelect}
              addActionLabel={isRepricing ? 'Add to Reprice List' : 'Add to Cart'} hideOfferCards={false}
              useVoucherOffers={useVoucherOffers}
              onOffersChange={onOffersChange}
            />
          ) : (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-4xl text-gray-300 mb-2">search_off</span>
              <p className="text-sm text-gray-500">No research data available</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
