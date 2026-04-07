import React from 'react';
import CustomerTransactionHeader from '../CustomerTransactionHeader';

export default function NegotiationSidebarPanel({
  customerData,
  transactionType,
  setTransactionType,
  setStoreTransactionType,
  mode,
  setShowNewBuyConfirm,
  jewelleryOfferTotal,
  otherItemsOfferTotal,
  totalOfferPrice,
  hasTarget,
  targetMatched,
  parsedTarget,
  targetShortfall,
  targetExcess,
  setTargetOffer,
  researchSandboxBookedView,
  persistedNosposUrl,
  handleParkAgreementOpenNospos,
  handleViewParkedAgreement,
  headerWorkspaceOpen,
  researchItem,
  cashConvertersResearchItem,
  handleFinalizeTransaction,
}) {
  return (
    <aside className="w-80 border-l flex flex-col bg-white shrink-0" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
      <CustomerTransactionHeader
        customer={customerData?.id ? customerData : { name: 'No customer selected' }}
        transactionType={transactionType}
        onTransactionChange={(nextType) => {
          setTransactionType(nextType);
          setStoreTransactionType(nextType);
        }}
        readOnly={mode === 'view'}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <button
          type="button"
          onClick={() => setShowNewBuyConfirm(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-bold text-sm transition-all"
          style={{
            borderColor: 'rgba(20, 69, 132, 0.25)',
            color: 'var(--brand-blue)',
            background: 'rgba(20, 69, 132, 0.03)',
          }}
          title="Clear cart/customer and start a fresh buying session"
        >
          <span className="material-symbols-outlined text-lg">refresh</span>
          New Buy
        </button>
      </div>

      <div className="p-6 bg-white border-t space-y-4" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
        <div className="space-y-2.5">
          <div className="flex justify-between items-baseline gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{ color: 'var(--brand-blue)' }}>
              Jewellery
            </span>
            <span className="text-lg font-black tabular-nums tracking-tight text-right" style={{ color: 'var(--brand-blue)' }}>
              £{jewelleryOfferTotal.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-baseline gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{ color: 'var(--brand-blue)' }}>
              Other items
            </span>
            <span className="text-lg font-black tabular-nums tracking-tight text-right" style={{ color: 'var(--brand-blue)' }}>
              £{otherItemsOfferTotal.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="pt-2 border-t flex justify-between items-end gap-3" style={{ borderColor: 'rgba(20, 69, 132, 0.15)' }}>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>Grand Total</span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Based on selected offers
            </span>
          </div>
          <div className="text-right text-3xl font-black tracking-tighter leading-none shrink-0" style={{ color: 'var(--brand-blue)' }}>
            <span>£{totalOfferPrice.toFixed(2)}</span>
          </div>
        </div>

        {hasTarget && (
          <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${targetMatched ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-wider ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>Target Offer</div>
              {!targetMatched && (
                <div className="text-[9px] text-red-600 font-medium">
                  {totalOfferPrice < parsedTarget
                    ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                    : `Grand total is too high by £${targetExcess.toFixed(2)}`}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-xl font-black ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>£{parsedTarget.toFixed(2)}</span>
              <span className={`material-symbols-outlined text-[20px] ${targetMatched ? 'text-emerald-600' : 'text-red-500'}`}>
                {targetMatched ? 'check_circle' : 'cancel'}
              </span>
              {mode === 'negotiate' && (
                <button onClick={(e) => { e.stopPropagation(); setTargetOffer(""); }} className="text-slate-400 hover:text-red-500 transition-colors" title="Remove target">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
          </div>
        )}

        {researchSandboxBookedView ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98]"
              style={{
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)',
                boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)',
              }}
              onClick={handleParkAgreementOpenNospos}
            >
              <span className="material-symbols-outlined text-xl" aria-hidden>task_alt</span>
              <span className="text-base uppercase tracking-tight">
                {persistedNosposUrl ? 'Rerun Park Agreement' : 'Park Agreement'}
              </span>
              <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform" aria-hidden>arrow_forward</span>
            </button>
            {persistedNosposUrl && (
              <button
                type="button"
                className="w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98]"
                style={{
                  background: 'var(--brand-blue)',
                  color: '#fff',
                  boxShadow: '0 6px 15px -3px rgba(0,0,0,0.25)',
                }}
                onClick={handleViewParkedAgreement}
              >
                <span className="material-symbols-outlined text-xl" aria-hidden>open_in_new</span>
                <span className="text-base uppercase tracking-tight">View Parked Agreement</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <button
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)', boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)' }}
              onClick={
                mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched)
                  ? undefined
                  : () => {
                      void handleFinalizeTransaction();
                    }
              }
              disabled={mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched)}
            >
              <span className="text-base uppercase tracking-tight">Book for Testing</span>
              <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
            {hasTarget && !targetMatched && mode === 'negotiate' && (
              <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
                {totalOfferPrice < parsedTarget
                  ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                  : `Grand total is too high by £${targetExcess.toFixed(2)}`}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
