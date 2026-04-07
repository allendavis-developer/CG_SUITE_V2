import React from 'react';
import JewelleryNegotiationSlimTable from '@/components/jewellery/JewelleryNegotiationSlimTable';
import NegotiationItemRow from '../NegotiationItemRow';
import { formatOfferPrice } from '@/utils/helpers';

export default function NegotiationTablesSection({
  mode,
  totalExpectation,
  setTotalExpectation,
  offerMin,
  offerMax,
  parsedTarget,
  setShowTargetModal,
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
}) {
  const colSpan = researchSandboxBookedView ? 17 : 16;

  return (
    <section className="flex-1 bg-white flex flex-col overflow-hidden">
      <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(247, 185, 24, 0.5)', background: 'rgba(247, 185, 24, 0.05)' }}>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--brand-blue)' }}>
                  Customer Total Expectation
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                  <input
                    className="w-full pl-8 pr-3 py-2.5 bg-white rounded-lg text-lg font-bold focus:ring-2"
                    style={{ border: '1px solid rgba(247, 185, 24, 0.3)', color: 'var(--brand-blue)', outline: 'none' }}
                    type="text"
                    value={totalExpectation}
                    onChange={(e) => setTotalExpectation(e.target.value)}
                    onKeyDown={mode === 'negotiate' ? (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    } : undefined}
                    placeholder="0.00"
                    readOnly={mode === 'view'}
                  />
                </div>
              </div>

              <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.15)', background: 'rgba(20, 69, 132, 0.02)' }}>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>
                  Offer Min
                </label>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-bold text-base" style={{ color: 'var(--brand-blue)' }}>£</span>
                  <span className="text-xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                    {offerMin !== null ? formatOfferPrice(offerMin) : '—'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.15)', background: 'rgba(20, 69, 132, 0.02)' }}>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>
                  Offer Max
                </label>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-bold text-base" style={{ color: 'var(--brand-blue)' }}>£</span>
                  <span className="text-xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                    {offerMax !== null ? formatOfferPrice(offerMax) : '—'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.2)', background: 'rgba(20, 69, 132, 0.02)' }}>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>Target Offer</label>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  {parsedTarget > 0 ? 'Exact total offer required' : 'Not set'}
                </p>
                <div
                  className={`flex items-baseline gap-1 ${mode === 'negotiate' ? 'cursor-pointer rounded-lg p-2 -mx-2 -mb-2 hover:bg-brand-blue/5 transition-colors group' : ''}`}
                  onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
                  role={mode === 'negotiate' ? 'button' : undefined}
                  title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
                >
                  <span className="font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                  <span className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                    {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
                  </span>
                  {mode === 'negotiate' && (
                    <span className="material-symbols-outlined ml-1 text-brand-blue/45 group-hover:text-brand-blue transition-colors align-middle" style={{ fontSize: '1.5rem' }}>edit</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Request ID</p>
            <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>#{actualRequestId || 'N/A'}</p>
            {mode === 'view' && (
              researchSandboxBookedView ? (
                <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-800">
                  <span className="material-symbols-outlined text-[12px]">science</span>
                  In-store testing — Park Agreement opens NoSpos and fills the first line category when CG Suite has one
                </p>
              ) : (
                <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-red-600">
                  <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                  View Only
                </p>
              )
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {jewelleryNegotiationItems.length > 0 ? (
          <div
            className="border-b-2 bg-white"
            style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}
          >
            <div
              className="sticky top-0 z-[5] border-b bg-white px-6 py-3"
              style={{ borderColor: 'var(--ui-border)' }}
            >
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
