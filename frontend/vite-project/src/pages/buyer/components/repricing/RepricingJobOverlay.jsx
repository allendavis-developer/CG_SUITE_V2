import React from 'react';

export default function RepricingJobOverlay({
  workspace = 'repricing',
  repricingJob,
  activeCartKey,
  onCancel = null,
}) {
  const isUpload = workspace === 'upload';
  const eyebrow = isUpload ? 'Background upload in progress' : 'Background Repricing In Progress';
  const headline = isUpload
    ? 'Please wait while CG Suite completes your upload'
    : 'Please wait while CG Suite updates NoSpos';
  const subline = isUpload
    ? 'The rest of this screen is locked while a minimised Web EPOS tab fills each product, saves it, and moves to the next line.'
    : 'The rest of this screen is locked while the hidden NoSpos worker is running so the process stays consistent.';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* No backdrop-filter: full-viewport blur is very expensive over the negotiation table (jank). */}
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-slate-950/60" aria-hidden />
      <div className="cg-animate-modal-panel relative z-10 w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl bg-white shadow-2xl border" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
        <div className="px-6 py-5 border-b bg-brand-blue" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
          <div className="flex items-start gap-4">
            <span className="material-symbols-outlined text-brand-orange text-3xl animate-spin">progress_activity</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">{eyebrow}</p>
              <h3 className="text-xl font-black text-white mt-1">{headline}</h3>
              <p className="text-sm text-white/80 mt-2">
                {subline}
              </p>
            </div>
            {typeof onCancel === 'function' && (
              <button
                type="button"
                onClick={() => onCancel(activeCartKey)}
                className="shrink-0 px-4 py-2 rounded-lg font-bold text-sm bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Current Status</p>
            <p className="text-sm font-bold text-slate-800 mt-1">{repricingJob?.message || 'Working…'}</p>
            <p className="text-xs text-slate-500 mt-2">
              {repricingJob?.currentItemTitle ? `Item: ${repricingJob.currentItemTitle}` : 'Waiting for first item'}
              {repricingJob?.currentBarcode ? ` · Barcode: ${repricingJob.currentBarcode}` : ''}
            </p>
          </div>

          <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Progress</p>
              <p className="text-xs font-bold text-slate-600">
                {repricingJob?.completedBarcodeCount || 0} / {repricingJob?.totalBarcodes || 0}{' '}
                {isUpload ? 'products completed' : 'barcodes completed'}
              </p>
            </div>
            <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${repricingJob?.totalBarcodes ? Math.min(100, ((repricingJob.completedBarcodeCount || 0) / repricingJob.totalBarcodes) * 100) : 0}%`,
                  background: 'var(--brand-blue)'
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
            <div className="px-4 py-3 bg-slate-50 border-b" style={{ borderColor: 'var(--brand-blue-alpha-08)' }}>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Detailed Process Stack</p>
              <p className="text-xs text-slate-500 mt-1">This stays in order from start to finish so you can follow each item and barcode step-by-step.</p>
            </div>
            <div className="max-h-[38vh] overflow-y-auto buyer-panel-scroll p-4 space-y-2 bg-white">
              {[...(repricingJob?.logs || [])].slice(-40).map((entry, index) => (
                <div key={`${entry.timestamp || 'log'}-${index}`} className="rounded-xl border px-3 py-2.5 bg-slate-50" style={{ borderColor: 'var(--brand-blue-alpha-08)' }}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Step {index + 1}</p>
                  <p className="text-[11px] font-semibold text-slate-700 leading-relaxed">{entry.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
