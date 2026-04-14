import React from 'react';
import TinyModal from '@/components/ui/TinyModal';

export function UnverifiedBarcodeModal({ entries, onClose }) {
  if (!entries) return null;
  return (
    <div className="fixed inset-0 z-[130] relative flex items-center justify-center p-4">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="cg-animate-modal-panel relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden">
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">
                Manual Verification Required
              </p>
              <p className="text-sm mt-1 font-semibold" style={{ color: 'var(--text-main)' }}>
                {entries.length} barcode{entries.length !== 1 ? 's' : ''} couldn't be automatically verified after saving.
              </p>
              <p className="text-xs mt-1" style={{ color: '#475569' }}>
                The price was likely saved correctly — NosPos just didn't confirm it in time.
                Please open each link below and double-check the retail price is set correctly.
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3 overflow-y-auto max-h-[55vh]">
          {entries.map((entry, index) => (
            <div key={`${entry.itemId}-${entry.barcodeIndex}-${index}`} className="rounded-xl border p-4" style={{ borderColor: 'rgba(247,185,24,0.4)', background: '#fffbeb' }}>
              <p className="text-sm font-bold mb-3" style={{ color: 'var(--brand-blue)' }}>
                {entry.itemTitle}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>Typed Barcode</p>
                  <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                    {entry.barcode || '—'}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>NosPos Barcode</p>
                  <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                    {entry.stockBarcode || '—'}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>NosPos Link</p>
                  {entry.stockUrl ? (
                    <a
                      href={entry.stockUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold bg-white hover:bg-brand-blue/5 transition-colors"
                      style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
                    >
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      Open in NosPos
                    </a>
                  ) : (
                    <div className="px-3 py-2 rounded-lg border text-sm bg-white text-slate-400 italic" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
                      No link available
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
          <p className="text-xs" style={{ color: '#64748b' }}>
            The price was saved in NosPos — this is just a confirmation check that timed out.
          </p>
          <button
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
            style={{ background: 'var(--brand-blue)', color: 'white' }}
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function AmbiguousBarcodeModal({ modal, onClose, onChange, onRetry }) {
  if (!modal) return null;
  return (
    <div className="fixed inset-0 z-[130] relative flex items-center justify-center p-4">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="cg-animate-modal-panel relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden">
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>
                Specific Barcodes Required
              </p>
              <p className="text-sm mt-1" style={{ color: '#475569' }}>
                These barcodes only opened the stock search page, so NoSpos could not jump straight to a stock item.
                Type more specific barcodes, then retry only those rows.
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[55vh]">
          {modal.entries.map((entry, index) => (
            <div key={`${entry.itemId}-${entry.barcodeIndex}-${index}`} className="rounded-xl border p-4" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
              <p className="text-sm font-bold mb-2" style={{ color: 'var(--brand-blue)' }}>
                {entry.itemTitle}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>Old Typed Barcode</p>
                  <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                    {entry.oldBarcode || '—'}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>More Specific Barcode</p>
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
                    style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
                    type="text"
                    placeholder="Type a more specific barcode"
                    value={entry.replacementBarcode}
                    onChange={(e) => onChange(index, e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
          <p className="text-xs" style={{ color: '#64748b' }}>
            Clicking outside skips these for now and keeps them out of repricing history.
          </p>
          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--brand-blue-alpha-20)', color: 'var(--brand-blue)', background: 'white' }}
              onClick={onClose}
            >
              Close
            </button>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                modal.isRetrying ? 'opacity-70 cursor-wait' : ''
              }`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={onRetry}
              disabled={modal.isRetrying}
            >
              {modal.isRetrying ? 'Retrying…' : 'Retry Typed Barcodes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ZeroSalePriceModal({ modal, onClose }) {
  if (!modal) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="cg-animate-modal-panel relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
          <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">
            Cannot Update Sale Price
          </p>
          <p className="text-sm mt-2" style={{ color: '#475569' }}>
            Sale price is £0 based on current data, so this item cannot be updated in NoSpos.
          </p>
        </div>
        <div className="px-6 py-4">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
            Affected item{modal.itemTitles.length !== 1 ? 's' : ''}
          </p>
          <ul className="space-y-1 max-h-36 overflow-y-auto">
            {modal.itemTitles.map((title, idx) => (
              <li key={`${title}-${idx}`} className="text-xs font-semibold text-brand-blue">
                {title}
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 py-4 border-t flex justify-end" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
          <button
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
            style={{ background: 'var(--brand-blue)', color: 'white' }}
            onClick={onClose}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function RepricingBarcodeModal({
  barcodeModal,
  barcodes,
  barcodeInput,
  setBarcodeInput,
  nosposLookups,
  nosposResultsPanel,
  setNosposResultsPanel,
  completedBarcodes,
  maxBarcodesPerItem = Number.POSITIVE_INFINITY,
  onClose,
  onAddBarcode,
  onRemoveBarcode,
  onRunNosposLookup,
  onSelectNosposResult,
  onSkipNosposLookup,
}) {
  if (!barcodeModal) return null;
  const modalItem = barcodeModal.item;
  const itemBarcodes = barcodes[modalItem.id] || [];
  const singleBarcode = Number.isFinite(maxBarcodesPerItem) && maxBarcodesPerItem === 1;

  return (
    <TinyModal title={singleBarcode ? 'Barcode' : 'Barcodes'} onClose={onClose}>
      <p className="text-xs font-semibold mb-4" style={{ color: 'var(--brand-blue)' }}>
        {modalItem.title}
      </p>

      {itemBarcodes.length > 0 ? (
        <div className="space-y-2 mb-4 max-h-96 overflow-y-auto">
          {itemBarcodes.map((code, idx) => {
            const isComplete = (completedBarcodes[modalItem.id] || []).includes(idx);
            const lookupKey = `${modalItem.id}_${idx}`;
            const lookup = nosposLookups[lookupKey];
            const isPanelOpen = nosposResultsPanel?.itemId === modalItem.id && nosposResultsPanel?.barcodeIndex === idx;

            return (
              <div key={idx} className="rounded-lg border overflow-hidden" style={{ borderColor: isComplete ? '#a7f3d0' : 'var(--brand-blue-alpha-15)' }}>
                <div className={`flex items-center gap-2 px-3 py-1.5 ${isComplete ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <span className="flex-1 text-xs font-mono font-semibold flex items-center gap-1.5" style={{ color: 'var(--brand-blue)' }}>
                    {isComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                    {code}
                  </span>

                  {lookup?.status === 'searching' && (
                    <span className="text-[10px] font-semibold text-brand-blue/80 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px] animate-spin">refresh</span>
                      Searching…
                    </span>
                  )}
                  {lookup?.status === 'selected' && (
                    <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 min-w-0">
                      <span className="material-symbols-outlined text-[12px]">check_circle</span>
                      <span className="truncate">
                        <a href={lookup.stockUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" title={lookup.stockBarcode}>
                          {lookup.stockBarcode}
                        </a>
                        {lookup.stockName ? (
                          <>
                            {' · '}
                            <a href={lookup.stockUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" title={lookup.stockName}>
                              {lookup.stockName}
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                  )}
                  {lookup?.status === 'found' && (
                    <button
                      className="text-[10px] font-semibold text-brand-blue hover:text-brand-blue-hover flex items-center gap-1 transition-colors"
                      onClick={() => setNosposResultsPanel(isPanelOpen ? null : { itemId: modalItem.id, barcodeIndex: idx })}
                    >
                      <span className="material-symbols-outlined text-[12px]">list</span>
                      {lookup.results.length} result{lookup.results.length !== 1 ? 's' : ''} — pick one
                    </button>
                  )}
                  {lookup?.status === 'not_found' && (
                    <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">search_off</span>
                      Not found
                    </span>
                  )}
                  {lookup?.status === 'skipped' && (
                    <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">skip_next</span>
                      Skipped
                    </span>
                  )}
                  {lookup?.status === 'error' && (
                    <span className="text-[10px] font-semibold text-red-400" title={lookup.error}>
                      <span className="material-symbols-outlined text-[12px]">warning</span>
                    </span>
                  )}

                  {(lookup?.status === 'not_found' || lookup?.status === 'error') && (
                    <button
                      className="text-[10px] font-semibold text-brand-blue hover:text-brand-blue-hover transition-colors flex items-center gap-0.5"
                      onClick={() => onRunNosposLookup(code, idx)}
                      title="Retry NosPos lookup"
                    >
                      <span className="material-symbols-outlined text-[12px]">refresh</span>
                      Retry
                    </button>
                  )}

                  {(lookup?.status === 'not_found' || lookup?.status === 'found' || lookup?.status === 'error') && (
                    <button
                      className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-0.5"
                      onClick={() => { onSkipNosposLookup(lookupKey); setNosposResultsPanel(null); }}
                      title="Skip this barcode"
                    >
                      Skip
                    </button>
                  )}

                  <button
                    onClick={() => onRemoveBarcode(code)}
                    className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                    title="Remove barcode"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>

                {isPanelOpen && lookup?.results?.length > 0 && (
                  <div className="border-t" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
                    <div className="px-2 py-1.5 bg-brand-blue/5">
                      <p className="text-[10px] font-semibold text-brand-blue mb-1">Select the matching item on NosPos:</p>
                      <div className="space-y-1">
                        {lookup.results.map((result, ri) => (
                          <div
                            key={ri}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white border hover:border-brand-blue/30 hover:bg-brand-blue/5 transition-colors cursor-pointer group"
                            style={{ borderColor: 'var(--brand-blue-alpha-15)' }}
                          >
                            <div className="flex-1 min-w-0">
                              <a
                                href={`https://nospos.com${result.href}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-[11px] font-mono font-bold text-brand-blue hover:underline leading-tight"
                                onClick={() => onSelectNosposResult(lookupKey, result)}
                              >
                                {result.barserial}
                              </a>
                              <a
                                href={`https://nospos.com${result.href}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-[10px] text-slate-500 truncate leading-tight mt-0.5 hover:underline"
                                onClick={() => onSelectNosposResult(lookupKey, result)}
                              >
                                {result.name}
                              </a>
                              <p className="text-[10px] text-slate-400 leading-tight">
                                Cost {result.costPrice} · Retail {result.retailPrice} · Qty {result.quantity}
                              </p>
                            </div>
                            <button
                              className="flex-shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-colors"
                              style={{ background: 'var(--brand-blue)', color: 'white' }}
                              onClick={() => onSelectNosposResult(lookupKey, result)}
                            >
                              Select
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className="mt-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                        onClick={() => setNosposResultsPanel(null)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic mb-4">No barcodes added yet.</p>
      )}

      {singleBarcode && itemBarcodes.length > 0 ? (
        <p className="text-[10px] text-slate-500 mb-2">Add replaces the current barcode.</p>
      ) : null}
      <div className="flex gap-2 mb-4">
        <input
          autoFocus
          className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
          style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
          type="text"
          placeholder="Enter barcode"
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onAddBarcode(); }}
        />
        <button
          className="px-3 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
          style={{ background: 'var(--brand-blue)', color: 'white' }}
          onClick={onAddBarcode}
        >
          {singleBarcode && itemBarcodes.length > 0 ? 'Replace' : 'Add'}
        </button>
      </div>

      <button
        className="w-full py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
        style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
        onClick={onClose}
      >
        OK
      </button>
    </TinyModal>
  );
}
