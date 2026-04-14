import React from 'react';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm.jsx';

export default function CashConvertersCartItemView({ item, savedState, onDeselectCartItem, useVoucherOffers = false }) {
  return (
    <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <div className="flex items-center gap-3 py-4">
          <div className="bg-brand-blue p-1.5 rounded">
            <span className="material-symbols-outlined text-brand-orange text-sm">search_insights</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-brand-blue">Cash Converters Research Item</h2>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved research</p>
          </div>
        </div>
      </div>

      <div className="p-8">
        {savedState ? (
          <CashConvertersResearchForm
            mode="page"
            category={item.categoryObject || { name: 'Cash Converters', path: ['Cash Converters'] }}
            onComplete={() => {}}
            savedState={savedState}
            initialHistogramState={false}
            readOnly={true}
            resetDrillOnOpen={true}
            onAddNewItem={onDeselectCartItem}
            useVoucherOffers={useVoucherOffers}
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
