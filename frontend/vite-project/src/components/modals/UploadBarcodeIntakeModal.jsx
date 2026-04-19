import React from 'react';

/**
 * Upload workspace gate: NosPos barcode composer until all lines verify, then Continue.
 */
export default function UploadBarcodeIntakeModal({
  open,
  slotIds,
  isItemReadyForRepricing,
  onDone,
  inlineBarcodeEditor = null,
}) {
  const allReady = slotIds.length > 0 && slotIds.every((id) => isItemReadyForRepricing(id));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-4 sm:p-6">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />

      <div className="cg-animate-modal-panel relative z-10 flex max-h-[min(94vh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="shrink-0 bg-brand-blue px-6 py-5 text-white sm:px-8 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-brand-orange text-3xl shrink-0">barcode_scanner</span>
            <div className="min-w-0">
              <h2 className="text-lg font-black uppercase tracking-wide leading-tight sm:text-xl">
                Upload — scan barcodes
              </h2>
              <p className="mt-1 text-sm text-white/80">
                Verify each barcode on NosPos. When every line is ready, continue to add products.
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">{inlineBarcodeEditor}</div>

        {allReady ? (
          <div className="shrink-0 border-t border-slate-200 p-0">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-none rounded-b-2xl py-4 text-sm font-black uppercase tracking-tight transition-all hover:opacity-95 sm:py-5 sm:text-base"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={onDone}
            >
              Continue to products
              <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
