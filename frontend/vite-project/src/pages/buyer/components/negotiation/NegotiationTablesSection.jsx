import React from 'react';
import JewelleryNegotiationSlimTable from '@/components/jewellery/JewelleryNegotiationSlimTable';
import NegotiationItemRow from '../NegotiationItemRow';

export default function NegotiationTablesSection({
  mode,
  actualRequestId,
  researchSandboxBookedView,
  jewelleryNegotiationItems,
  jewelleryReferenceScrape,
  setShowJewelleryReferenceModal,
  handleSelectOffer,
  setContextMenu,
  setItemOfferModal,
  handleCustomerExpectationChange,
  handleJewelleryItemNameChange,
  handleJewelleryWeightChange,
  blockedOfferSlots,
  handleBlockedOfferClick,
  parkExcludedItems,
  handleToggleParkExcludeItem,
  mainNegotiationItems,
  handleQuantityChange,
  handleOurSalePriceChange,
  handleOurSalePriceBlur,
  handleOurSalePriceFocus,
  handleRefreshCeXData,
  setResearchItem,
  setCashConvertersResearchItem,
  useVoucherOffers,
  nosposCategoriesResults,
  nosposCategoryMappings,
  onOpenNosposRequiredFieldsEditor,
  hideNosposRequiredColumn = false,
}) {
  const colSpan =
    (researchSandboxBookedView ? 17 : 16) + (hideNosposRequiredColumn ? 0 : 1);

  return (
    <section className="flex-1 bg-white flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        {jewelleryNegotiationItems.length > 0 ? (
          <div className="bg-white">
            <div className="sticky top-0 z-[5] bg-white px-6 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">Jewellery</h3>
                {mode === 'view' && jewelleryReferenceScrape?.sections?.length ? (
                  <button
                    type="button"
                    onClick={() => setShowJewelleryReferenceModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-blue shadow-sm transition-colors hover:bg-gray-50"
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">table_view</span>
                    View reference table
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 text-[11px] text-gray-600">
                Workspace-style columns plus manual offer and customer expectation. Grand total includes these lines.
              </p>
            </div>
            <JewelleryNegotiationSlimTable
              items={jewelleryNegotiationItems}
              mode={mode}
              useVoucherOffers={useVoucherOffers}
              hideNosposRequiredColumn={hideNosposRequiredColumn}
              nosposCategoriesResults={nosposCategoriesResults}
              nosposCategoryMappings={nosposCategoryMappings}
              requestId={actualRequestId}
              onOpenNosposRequiredFieldsEditor={onOpenNosposRequiredFieldsEditor}
              onSelectOffer={handleSelectOffer}
              onRowContextMenu={(e, it, zone) =>
                setContextMenu({ x: e.clientX, y: e.clientY, item: it, zone })
              }
              onSetManualOffer={(it) => setItemOfferModal({ item: it })}
              onCustomerExpectationChange={handleCustomerExpectationChange}
              onJewelleryItemNameChange={handleJewelleryItemNameChange}
              onJewelleryWeightChange={handleJewelleryWeightChange}
              blockedOfferSlots={blockedOfferSlots}
              onBlockedOfferClick={(slot, offer, bItem) => handleBlockedOfferClick(slot, offer, bItem)}
              testingPassedColumnMode={null}
              parkExcludedItems={researchSandboxBookedView ? parkExcludedItems : null}
              onToggleParkExcludeItem={researchSandboxBookedView ? handleToggleParkExcludeItem : null}
            />
          </div>
        ) : null}
        <div className="px-6 pt-4 pb-6">
          <div className="pb-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">Items</h3>
            <p className="text-[11px] text-gray-600">Phones, CeX, eBay, and other catalogue lines.</p>
          </div>
          <table className="w-full spreadsheet-table border-collapse text-left">
            <thead>
              <tr>
                <th className="w-12 text-center">Qty</th>
                <th className="w-36">Category</th>
                <th className="min-w-[160px] max-w-[240px]">NosPos category</th>
                {!hideNosposRequiredColumn ? (
                  <th className="min-w-[130px] max-w-[160px] text-[10px]">NosPos required</th>
                ) : null}
                <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                <th className="w-24 spreadsheet-th-cex">Sell</th>
                <th className="w-24 spreadsheet-th-cex">Voucher</th>
                <th className="w-24 spreadsheet-th-cex">Cash</th>
                <th className="w-24 spreadsheet-th-offer-tier">1st</th>
                <th className="w-24 spreadsheet-th-offer-tier">2nd</th>
                <th className="w-24 spreadsheet-th-offer-tier">3rd</th>
                <th className="w-24 spreadsheet-th-offer-tier">4th</th>
                <th className="w-36">Manual</th>
                <th className="w-32">Customer Expectation</th>
                <th className="w-24">Our RRP</th>
                <th className="w-36">eBay Price</th>
                <th className="w-36">Cash Converters</th>
                {researchSandboxBookedView ? (
                  <th className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-amber-600">
                    Skip NosPos
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="text-xs">
              {mainNegotiationItems.map((item, index) => (
                <NegotiationItemRow
                  key={item.id || `main-${index}`}
                  item={item}
                  index={index}
                  mode={mode}
                  allowResearchSandboxInView={researchSandboxBookedView}
                  useVoucherOffers={useVoucherOffers}
                  onQuantityChange={handleQuantityChange}
                  onSelectOffer={handleSelectOffer}
                  onRowContextMenu={(e, it, zone) =>
                    setContextMenu({ x: e.clientX, y: e.clientY, item: it, zone })}
                  onSetManualOffer={(it) => setItemOfferModal({ item: it })}
                  onCustomerExpectationChange={handleCustomerExpectationChange}
                  onOurSalePriceChange={handleOurSalePriceChange}
                  onOurSalePriceBlur={handleOurSalePriceBlur}
                  onOurSalePriceFocus={handleOurSalePriceFocus}
                  onRefreshCeXData={handleRefreshCeXData}
                  onReopenResearch={setResearchItem}
                  onReopenCashConvertersResearch={setCashConvertersResearchItem}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => handleBlockedOfferClick(slot, offer, item)}
                  testingPassedColumnMode={null}
                  parkExcluded={researchSandboxBookedView ? parkExcludedItems.has(item.id) : false}
                  onToggleParkExclude={researchSandboxBookedView ? () => handleToggleParkExcludeItem(item.id) : null}
                  nosposCategoriesResults={nosposCategoriesResults}
                  nosposCategoryMappings={nosposCategoryMappings}
                  actualRequestId={actualRequestId}
                  onOpenNosposRequiredFieldsEditor={onOpenNosposRequiredFieldsEditor}
                  hideNosposRequiredColumn={hideNosposRequiredColumn}
                />
              ))}
              <tr className="h-10 opacity-50">
                <td colSpan={colSpan}></td>
              </tr>
              <tr className="h-10 opacity-50">
                <td colSpan={colSpan}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
