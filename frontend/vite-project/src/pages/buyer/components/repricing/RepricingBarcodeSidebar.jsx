import React from 'react';

const DEFAULT_WORKSPACE_LABELS = {
  newButton: 'New Repricing',
  newButtonTitle: 'Clear reprice list and start a new repricing session',
  proceedIdle: 'Proceed with Repricing',
  proceedRunning: 'Repricing Running in Background',
  proceedDone: 'Repricing Finished',
  finishedNote: 'Repricing finished',
  verifyHint: 'Verify a NoSpos barcode for every item before proceeding',
};

function RepricingActionsBlock({
  headerWorkspaceOpen,
  researchItem,
  cashConvertersResearchItem,
  cgResearchItem,
  allItemsReadyForRepricing,
  isRepricingFinished,
  isBackgroundRepricingRunning,
  completedItemsData,
  onProceed,
  onOpenBarcodePrintTab,
  onNewRepricing,
  onViewWebEposProducts,
  viewWebEposProductsDisabled,
  onViewWebEposCategories,
  viewWebEposCategoriesDisabled,
  layout = 'vertical',
  labels = DEFAULT_WORKSPACE_LABELS,
}) {
  const proceedDisabled =
    headerWorkspaceOpen ||
    researchItem ||
    cashConvertersResearchItem ||
    cgResearchItem ||
    !allItemsReadyForRepricing ||
    isRepricingFinished ||
    isBackgroundRepricingRunning;

  const btnClassProceed = `font-bold rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
    proceedDisabled ? 'opacity-50 cursor-not-allowed' : ''
  } ${layout === 'vertical' ? 'w-full py-4' : 'px-6 py-3 whitespace-nowrap'}`;

  return (
    <div className={layout === 'vertical' ? 'p-6 bg-white border-t space-y-4' : 'flex flex-wrap items-center justify-between gap-3 w-full'} style={{ borderColor: 'var(--brand-blue-alpha-20)' }}>
      {layout === 'horizontal' && (
        <button
          type="button"
          onClick={onNewRepricing}
          title={labels.newButtonTitle}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors"
          style={{ borderColor: 'var(--brand-blue-alpha-20)', color: 'var(--brand-blue)' }}
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          {labels.newButton}
        </button>
      )}
      <div
        className={
          layout === 'horizontal'
            ? 'flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0'
            : 'flex flex-col gap-3 w-full'
        }
      >
        {(onViewWebEposProducts || onViewWebEposCategories) && (
          <div
            className={
              onViewWebEposProducts && onViewWebEposCategories
                ? layout === 'vertical'
                  ? 'flex w-full flex-row gap-2'
                  : 'flex flex-row flex-wrap items-center justify-end gap-2'
                : 'flex w-full flex-col gap-2'
            }
          >
            {onViewWebEposProducts && (
              <button
                type="button"
                className={`font-semibold rounded-xl transition-all flex items-center justify-center gap-2 border-2 active:scale-[0.98] ${
                  viewWebEposProductsDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                } ${
                  layout === 'vertical'
                    ? onViewWebEposCategories
                      ? 'flex-1 min-w-0 py-3'
                      : 'w-full py-3'
                    : 'px-4 py-2.5 whitespace-nowrap'
                }`}
                style={{ borderColor: 'var(--brand-blue)', color: 'var(--brand-blue)' }}
                onClick={onViewWebEposProducts}
                disabled={viewWebEposProductsDisabled}
              >
                <span className="material-symbols-outlined text-[18px]">table_rows</span>
                <span className={layout === 'vertical' ? 'text-sm uppercase tracking-tight' : 'text-xs uppercase tracking-tight'}>
                  View products
                </span>
              </button>
            )}
            {onViewWebEposCategories && (
              <button
                type="button"
                className={`font-semibold rounded-xl transition-all flex items-center justify-center gap-2 border-2 active:scale-[0.98] ${
                  viewWebEposCategoriesDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                } ${
                  layout === 'vertical'
                    ? onViewWebEposProducts
                      ? 'flex-1 min-w-0 py-3'
                      : 'w-full py-3'
                    : 'px-4 py-2.5 whitespace-nowrap'
                }`}
                style={{ borderColor: 'var(--brand-blue)', color: 'var(--brand-blue)' }}
                onClick={onViewWebEposCategories}
                disabled={viewWebEposCategoriesDisabled}
              >
                <span className="material-symbols-outlined text-[18px]">category</span>
                <span className={layout === 'vertical' ? 'text-sm uppercase tracking-tight' : 'text-xs uppercase tracking-tight'}>
                  View categories
                </span>
              </button>
            )}
          </div>
        )}
        <button
          className={btnClassProceed}
          style={{
            background: 'var(--brand-orange)',
            color: 'var(--brand-blue)',
            boxShadow: layout === 'vertical' ? '0 10px 15px -3px rgba(247,185,24,0.3)' : undefined,
          }}
          onClick={onProceed}
          disabled={proceedDisabled}
        >
          <span className={`uppercase tracking-tight ${layout === 'vertical' ? 'text-base' : 'text-sm'}`}>
            {isRepricingFinished ? labels.proceedDone : isBackgroundRepricingRunning ? labels.proceedRunning : labels.proceedIdle}
          </span>
          {!isRepricingFinished && !isBackgroundRepricingRunning && (
            <span className={`material-symbols-outlined group-hover:translate-x-1 transition-transform ${layout === 'vertical' ? 'text-xl' : 'text-lg'}`}>
              arrow_forward
            </span>
          )}
          {isBackgroundRepricingRunning && (
            <span className={`material-symbols-outlined animate-spin ${layout === 'vertical' ? 'text-xl' : 'text-lg'}`}>progress_activity</span>
          )}
        </button>
        {!allItemsReadyForRepricing && !isRepricingFinished && layout === 'vertical' && (
          <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
            {labels.verifyHint}
          </p>
        )}
        {isRepricingFinished && completedItemsData.length > 0 && (
          <button
            onClick={() => onOpenBarcodePrintTab(completedItemsData)}
            className={`font-bold rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${layout === 'vertical' ? 'w-full py-3' : 'px-5 py-3'}`}
            style={{ background: 'var(--brand-blue)', color: '#fff' }}
          >
            <span className="material-symbols-outlined text-xl">print</span>
            <span className={`uppercase tracking-tight ${layout === 'vertical' ? 'text-sm' : 'text-xs'}`}>Print Barcodes</span>
          </button>
        )}
        {isRepricingFinished && completedItemsData.length === 0 && layout === 'vertical' && (
          <p className="text-[10px] text-center text-emerald-700 font-semibold -mt-2">
            {labels.finishedNote}
          </p>
        )}
      </div>
      {!allItemsReadyForRepricing && !isRepricingFinished && layout === 'horizontal' && (
        <p className="text-[10px] text-red-600 font-semibold w-full text-right">
          {labels.verifyHint}
        </p>
      )}
    </div>
  );
}

export default function RepricingBarcodeSidebar({
  variant = 'sidebar',
  workspace = 'repricing',
  activeItems,
  /** When set (upload barcode scan phase), show this count instead of active item rows. */
  uploadScanSlotCount,
  /** Upload: true while full-screen barcode intake is open. */
  uploadBarcodeIntakeOpen = false,
  barcodes,
  isItemReadyForRepricing,
  allItemsReadyForRepricing,
  isRepricingFinished,
  isBackgroundRepricingRunning,
  completedItemsData,
  headerWorkspaceOpen,
  researchItem,
  cashConvertersResearchItem,
  cgResearchItem,
  onProceed,
  onOpenBarcodePrintTab,
  onNewRepricing,
  onViewWebEposProducts,
  viewWebEposProductsDisabled,
  onViewWebEposCategories,
  viewWebEposCategoriesDisabled,
}) {
  const labels =
    workspace === 'upload'
      ? {
          headerTitle: 'Upload list',
          headerIcon: 'upload',
          newButton: 'New upload',
          newButtonTitle: 'Clear upload list and start a new upload session',
          proceedIdle: 'Proceed with upload',
          proceedRunning: 'Upload running in background',
          proceedDone: 'Upload finished',
          finishedNote: 'Upload finished',
          verifyHint: uploadBarcodeIntakeOpen
            ? 'Complete the barcode intake dialog first — nothing else is available until then.'
            : uploadScanSlotCount != null && uploadScanSlotCount > 0
              ? 'Add items from the header until every barcode in the queue is assigned to a line.'
              : 'Verify a NoSpos barcode for every item before proceeding',
        }
      : {
          headerTitle: 'Reprice List',
          headerIcon: 'sell',
          ...DEFAULT_WORKSPACE_LABELS,
        };

  if (variant === 'actionsOnly') {
    return (
      <div
        className="shrink-0 border-t flex flex-col gap-2 px-4 py-3 bg-white"
        style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
      >
        <RepricingActionsBlock
          headerWorkspaceOpen={headerWorkspaceOpen}
          researchItem={researchItem}
          cashConvertersResearchItem={cashConvertersResearchItem}
          cgResearchItem={cgResearchItem}
          allItemsReadyForRepricing={allItemsReadyForRepricing}
          isRepricingFinished={isRepricingFinished}
          isBackgroundRepricingRunning={isBackgroundRepricingRunning}
          completedItemsData={completedItemsData}
          onProceed={onProceed}
          onOpenBarcodePrintTab={onOpenBarcodePrintTab}
          onNewRepricing={onNewRepricing}
          onViewWebEposProducts={onViewWebEposProducts}
          viewWebEposProductsDisabled={viewWebEposProductsDisabled}
          onViewWebEposCategories={onViewWebEposCategories}
          viewWebEposCategoriesDisabled={viewWebEposCategoriesDisabled}
          layout="horizontal"
          labels={labels}
        />
      </div>
    );
  }

  return (
    <aside
      className="w-80 border-l flex flex-col bg-white shrink-0"
      style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
    >
      <div className="px-5 py-4 border-b bg-brand-blue" style={{ borderColor: 'var(--brand-blue-alpha-20)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-brand-orange text-2xl">{labels.headerIcon}</span>
            <div>
              <p className="text-sm font-black uppercase tracking-wider text-white">{labels.headerTitle}</p>
              <p className="text-xs text-white/70">
                {uploadScanSlotCount != null
                  ? uploadBarcodeIntakeOpen
                    ? `${uploadScanSlotCount} line${uploadScanSlotCount !== 1 ? 's' : ''} in intake`
                    : `${uploadScanSlotCount} barcode${uploadScanSlotCount !== 1 ? 's' : ''} left to assign`
                  : `${activeItems.length} item${activeItems.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onNewRepricing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={labels.newButtonTitle}
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            {labels.newButton}
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

      <RepricingActionsBlock
        headerWorkspaceOpen={headerWorkspaceOpen}
        researchItem={researchItem}
        cashConvertersResearchItem={cashConvertersResearchItem}
        cgResearchItem={cgResearchItem}
        allItemsReadyForRepricing={allItemsReadyForRepricing}
        isRepricingFinished={isRepricingFinished}
        isBackgroundRepricingRunning={isBackgroundRepricingRunning}
        completedItemsData={completedItemsData}
        onProceed={onProceed}
        onOpenBarcodePrintTab={onOpenBarcodePrintTab}
        onNewRepricing={onNewRepricing}
        onViewWebEposProducts={onViewWebEposProducts}
        viewWebEposProductsDisabled={viewWebEposProductsDisabled}
        onViewWebEposCategories={onViewWebEposCategories}
        viewWebEposCategoriesDisabled={viewWebEposCategoriesDisabled}
        layout="vertical"
        labels={labels}
      />
    </aside>
  );
}
