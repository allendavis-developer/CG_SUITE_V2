import React, { useState } from 'react';
import JewelleryNegotiationSlimTable from '@/components/jewellery/JewelleryNegotiationSlimTable';
import NegotiationItemRow from '../NegotiationItemRow';

export default function NegotiationTablesSection({
  mode,
  actualRequestId,
  researchSandboxBookedView,
  jewelleryNegotiationItems,
  handleSelectOffer,
  setContextMenu,
  setItemOfferModal,
  handleCustomerExpectationChange,
  handleJewelleryItemNameChange,
  handleJewelleryWeightChange,
  handleJewelleryCoinUnitsChange,
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
  handleApplyRrpPriceSource,
  handleApplyOffersPriceSource,
  setResearchItem,
  setCashConvertersResearchItem,
  setCgResearchItem,
  useVoucherOffers,
  nosposCategoriesResults,
  nosposCategoryMappings,
  onOpenNosposRequiredFieldsEditor,
  onOpenNosposCategoryPicker,
  hideNosposRequiredColumn = false,
  /** When true, hide the NosPos category column and inline field-AI trigger (upload workspace). */
  hideNosposCategoryColumn = false,
  /** When true, hide the Qty column (upload workspace). */
  hideQuantityColumn = false,
  /** When true, hide CeX Voucher and Cash columns; Sell remains (upload workspace). */
  hideCexVoucherCashColumns = false,
  hideOfferColumns = false,
  hideCustomerExpectation = false,
  salePriceLabel = 'Our RRP',
  renderRowSuffix = null,
}) {
  const [categoryColumnsExpanded, setCategoryColumnsExpanded] = useState(false);

  const visibleColumnCount = (() => {
    let count = 0;
    if (!hideQuantityColumn) count += 1; // Qty
    count += categoryColumnsExpanded ? (hideNosposCategoryColumn ? 1 : 2) : 1; // category (+ optional NosPos) columns
    if (!hideNosposRequiredColumn) count += 1;
    count += 1; // Item Name
    count += hideCexVoucherCashColumns ? 1 : 3; // CeX Sell / optional Voucher+Cash
    if (!hideCustomerExpectation) count += 1;
    if (!hideOfferColumns) count += 6; // Offer source + 4 tiers + Manual
    count += 1; // Our RRP / Sale Price
    count += 1; // RRP source
    count += 3; // eBay + CC + CG
    if (researchSandboxBookedView) count += 1; // Skip NosPos
    if (renderRowSuffix) count += 1; // extra column slot
    return count;
  })();

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto buyer-panel-scroll">
        {jewelleryNegotiationItems.length > 0 ? (
          <div className="bg-white">
            <div className="sticky top-0 z-[5] bg-white px-6 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">Jewellery</h3>
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
              hideNosposCategoryColumn={hideNosposCategoryColumn}
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
              onJewelleryCoinUnitsChange={handleJewelleryCoinUnitsChange}
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
                {!hideQuantityColumn ? <th className="w-12 text-center">Qty</th> : null}
                {categoryColumnsExpanded ? (
                  <>
                    <th className="w-36 min-w-0">
                      <div className="flex items-center gap-1 pr-1">
                        <button
                          type="button"
                          onClick={() => setCategoryColumnsExpanded(false)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/95 transition-colors hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-blue)]"
                          aria-expanded
                          title={
                            hideNosposCategoryColumn
                              ? 'Hide Category column'
                              : 'Hide Category and NosPos columns'
                          }
                        >
                          <span className="material-symbols-outlined text-[20px] leading-none">keyboard_double_arrow_left</span>
                        </button>
                        <span className="min-w-0 truncate">Category</span>
                      </div>
                    </th>
                    {!hideNosposCategoryColumn ? (
                      <th className="min-w-[160px] max-w-[240px]">NosPos category</th>
                    ) : null}
                  </>
                ) : (
                  <th className="w-10 px-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => setCategoryColumnsExpanded(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-blue)]"
                      aria-expanded={false}
                      title={
                        hideNosposCategoryColumn
                          ? 'Show Category column'
                          : 'Show Category and NosPos columns'
                      }
                    >
                      <span className="material-symbols-outlined text-[20px] leading-none">keyboard_double_arrow_right</span>
                    </button>
                  </th>
                )}
                {!hideNosposRequiredColumn ? (
                  <th className="min-w-[130px] max-w-[160px] text-[10px]">NosPos required</th>
                ) : null}
                <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                <th className="w-24 spreadsheet-th-cex">Sell</th>
                {!hideCexVoucherCashColumns ? (
                  <>
                    <th className="w-24 spreadsheet-th-cex">Voucher</th>
                    <th className="w-24 spreadsheet-th-cex">Cash</th>
                  </>
                ) : null}
                {!hideCustomerExpectation ? (
                  <th className="w-32">Customer Expectation</th>
                ) : null}
                {!hideOfferColumns ? (
                  <>
                    <th className="w-[5.5rem] min-w-[5rem] text-[9px] leading-tight">Offer source</th>
                    <th className="w-24 spreadsheet-th-offer-tier">1st</th>
                    <th className="w-24 spreadsheet-th-offer-tier">2nd</th>
                    <th className="w-24 spreadsheet-th-offer-tier">3rd</th>
                    <th className="w-24 spreadsheet-th-offer-tier">4th</th>
                    <th className="w-36">Manual</th>
                  </>
                ) : null}
                <th className="w-24">{salePriceLabel}</th>
                <th className="w-[5.5rem] min-w-[5rem] text-[9px] leading-tight">RRP source</th>
                <th className="w-24 px-1 text-left">eBay</th>
                <th className="w-24 px-1 text-left">CC</th>
                <th className="w-24 px-1 text-left">CG</th>
                {researchSandboxBookedView ? (
                  <th className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-amber-600">
                    Skip NosPos
                  </th>
                ) : null}
                {renderRowSuffix ? <th className="w-44">Barcodes</th> : null}
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
                  onApplyRrpPriceSource={handleApplyRrpPriceSource}
                  onApplyOffersPriceSource={handleApplyOffersPriceSource}
                  onReopenResearch={setResearchItem}
                  onReopenCashConvertersResearch={setCashConvertersResearchItem}
                  onReopenCashGeneratorResearch={setCgResearchItem}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer) => handleBlockedOfferClick(slot, offer, item)}
                  testingPassedColumnMode={null}
                  parkExcluded={researchSandboxBookedView ? parkExcludedItems.has(item.id) : false}
                  onToggleParkExclude={researchSandboxBookedView ? () => handleToggleParkExcludeItem(item.id) : null}
                  nosposCategoriesResults={nosposCategoriesResults}
                  nosposCategoryMappings={nosposCategoryMappings}
                  actualRequestId={actualRequestId}
                  onOpenNosposRequiredFieldsEditor={onOpenNosposRequiredFieldsEditor}
                  onOpenNosposCategoryPicker={onOpenNosposCategoryPicker}
                  hideNosposRequiredColumn={hideNosposRequiredColumn}
                  hideNosposCategoryColumn={hideNosposCategoryColumn}
                  hideQuantityColumn={hideQuantityColumn}
                  hideCexVoucherCashColumns={hideCexVoucherCashColumns}
                  categoryColumnsExpanded={categoryColumnsExpanded}
                  hideOfferColumns={hideOfferColumns}
                  hideCustomerExpectation={hideCustomerExpectation}
                  renderSuffix={renderRowSuffix ? () => renderRowSuffix(item) : null}
                />
              ))}
              <tr className="h-10 opacity-50">
                <td colSpan={visibleColumnCount}></td>
              </tr>
              <tr className="h-10 opacity-50">
                <td colSpan={visibleColumnCount}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
