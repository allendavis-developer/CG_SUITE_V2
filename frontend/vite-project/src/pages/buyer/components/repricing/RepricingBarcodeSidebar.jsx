import React from 'react';

export default function RepricingBarcodeSidebar({
  activeItems,
  barcodes,
  isItemReadyForRepricing,
  allItemsReadyForRepricing,
  isRepricingFinished,
  isBackgroundRepricingRunning,
  completedItemsData,
  headerWorkspaceOpen,
  researchItem,
  cashConvertersResearchItem,
  onProceed,
  onOpenBarcodePrintTab,
  onNewRepricing,
}) {
  return (
    <aside
      className="w-80 border-l flex flex-col bg-white shrink-0"
      style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
    >
      <div className="px-5 py-4 border-b bg-brand-blue" style={{ borderColor: 'var(--brand-blue-alpha-20)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-brand-orange text-2xl">sell</span>
            <div>
              <p className="text-sm font-black uppercase tracking-wider text-white">Reprice List</p>
              <p className="text-xs text-white/70">
                {activeItems.length} item{activeItems.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onNewRepricing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Clear reprice list and start a new repricing session"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            New Repricing
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <p
            className="text-[10px] font-black uppercase tracking-wider mb-3"
            style={{ color: 'var(--brand-blue)' }}
          >
            Barcode Status
          </p>
          <div className="space-y-2">
            {activeItems.map(i => {
              const count = (barcodes[i.id] || []).length;
              const itemComplete = isItemReadyForRepricing(i.id);
              return (
                <div key={i.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1 flex items-center gap-1" style={{ color: '#64748b' }}>
                    {itemComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                    {i.title}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      itemComplete ? 'bg-emerald-200 text-emerald-800' : count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {count === 0 ? 'missing' : itemComplete ? 'verified' : 'needs review'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="p-6 bg-white border-t space-y-4"
        style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
      >
        <button
          className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
            headerWorkspaceOpen || researchItem || cashConvertersResearchItem || !allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          style={{
            background: 'var(--brand-orange)',
            color: 'var(--brand-blue)',
            boxShadow: '0 10px 15px -3px rgba(247,185,24,0.3)'
          }}
          onClick={onProceed}
          disabled={headerWorkspaceOpen || researchItem || cashConvertersResearchItem || !allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning}
        >
          <span className="text-base uppercase tracking-tight">
            {isRepricingFinished ? 'Repricing Finished' : isBackgroundRepricingRunning ? 'Repricing Running in Background' : 'Proceed with Repricing'}
          </span>
          {!isRepricingFinished && !isBackgroundRepricingRunning && (
            <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
          )}
          {isBackgroundRepricingRunning && (
            <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
          )}
        </button>
        {!allItemsReadyForRepricing && !isRepricingFinished && (
          <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
            Verify a NoSpos barcode for every item before proceeding
          </p>
        )}
        {isRepricingFinished && completedItemsData.length > 0 && (
          <button
            onClick={() => onOpenBarcodePrintTab(completedItemsData)}
            className="w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
            style={{ background: 'var(--brand-blue)', color: '#fff' }}
          >
            <span className="material-symbols-outlined text-xl">print</span>
            <span className="text-sm uppercase tracking-tight">Print Barcodes</span>
          </button>
        )}
        {isRepricingFinished && completedItemsData.length === 0 && (
          <p className="text-[10px] text-center text-emerald-700 font-semibold -mt-2">
            Repricing finished
          </p>
        )}
      </div>
    </aside>
  );
}
