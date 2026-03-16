import React, { useState, useRef, useEffect } from 'react';
import { quickRepriceLookup } from '@/services/api';

/**
 * Parses a block of barcode text into game_sku / nospos_barcode pairs.
 *
 * Rules:
 *  - Lines are trimmed and blanks are ignored.
 *  - NoSpos barcodes start with "bb" (case-insensitive).
 *  - Any line that does NOT start with "bb" is treated as a Game SKU.
 *  - If a Game SKU is immediately followed by a "bb" line, they form a pair.
 *  - If consecutive Game SKUs appear, each starts a new pair (nospos treated as empty).
 *  - Orphan "bb" lines (no preceding Game SKU) are skipped.
 */
function parseBarcodeText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const pairs = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.toLowerCase().startsWith('bb')) {
      const game_sku = line;
      const next = lines[i + 1];
      if (next && next.toLowerCase().startsWith('bb')) {
        pairs.push({ cex_sku: game_sku, nospos_barcode: next });
        i += 2;
      } else {
        pairs.push({ cex_sku: game_sku, nospos_barcode: '' });
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  return pairs;
}

const QuickRepriceModal = ({ onClose, onAddItems }) => {
  const [phase, setPhase] = useState('input'); // 'input' | 'loading' | 'results'
  const [barcodeText, setBarcodeText] = useState('');
  const [results, setResults] = useState(null); // { found, not_found }
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (phase === 'input' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [phase]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const parsedPairs = parseBarcodeText(barcodeText);

  const handleLookup = async () => {
    if (!parsedPairs.length) return;
    setError(null);
    setPhase('loading');
    try {
      const data = await quickRepriceLookup(parsedPairs);
      setResults(data);
      setPhase('results');
    } catch (err) {
      setError(err.message || 'Lookup failed');
      setPhase('input');
    }
  };

  const handleAddToList = () => {
    if (!results?.found?.length) return;
    onAddItems(results.found);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 bg-blue-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-yellow-400 text-xl">bolt</span>
            <div>
              <p className="text-sm font-black uppercase tracking-wider text-white">Quick Reprice (Games)</p>
              <p className="text-xs text-blue-200">For games only – scan or paste barcode pairs to bulk-add items</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── Input phase ── */}
          {(phase === 'input' || phase === 'loading') && (
            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-800 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">info</span>
                  Format (games only)
                </p>
                <p className="text-xs text-blue-700 leading-relaxed">
                  Enter barcodes for <span className="font-semibold">games only</span>, one per line in pairs:<br />
                  <span className="font-mono font-bold">1234567890</span>
                  <span className="text-blue-500"> ← Game SKU</span><br />
                  <span className="font-mono font-bold">BB12CD345</span>
                  <span className="text-blue-500"> ← NoSpos barcode (starts with BB)</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">
                  Barcodes
                </label>
                <textarea
                  ref={textareaRef}
                  className="w-full h-56 resize-none font-mono text-sm border border-blue-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-800 placeholder-gray-400"
                  placeholder={"1234567890\nAB12CD345\n9876543210\nXY98ZW001"}
                  value={barcodeText}
                  onChange={(e) => setBarcodeText(e.target.value)}
                  spellCheck={false}
                />
              </div>

              {parsedPairs.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-bold text-blue-900">{parsedPairs.length}</span> pair{parsedPairs.length !== 1 ? 's' : ''} detected
                  {parsedPairs.filter(p => !p.nospos_barcode).length > 0 && (
                    <span className="text-amber-600 ml-2">
                      ({parsedPairs.filter(p => !p.nospos_barcode).length} missing NoSpos barcode)
                    </span>
                  )}
                </p>
              )}

              {error && (
                <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {error}
                </p>
              )}
            </div>
          )}

          {/* ── Results phase ── */}
          {phase === 'results' && results && (
            <div className="p-6 space-y-5">

              {results.found.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-blue-900 mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
                    Found ({results.found.length})
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {results.found.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg"
                      >
                        <span className="material-symbols-outlined text-emerald-600 text-base shrink-0 mt-0.5">
                          {item.in_db ? 'inventory_2' : 'public'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-blue-900 truncate">{item.title}</p>
                          {item.subtitle && (
                            <p className="text-[11px] text-gray-500 truncate">{item.subtitle}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[11px] font-mono text-gray-400">{item.cex_sku}</span>
                            {item.nospos_barcode && (
                              <span className="text-[11px] font-mono text-blue-600">→ {item.nospos_barcode}</span>
                            )}
                            <span className="text-[11px] font-semibold text-emerald-700 ml-auto">
                              £{Number(item.our_sale_price).toFixed(2)}
                            </span>
                          </div>
                          {!item.in_db && (
                            <span className="inline-block mt-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                              Not in DB — from CeX live
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.not_found.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">error</span>
                    Not Found ({results.not_found.length})
                  </p>
                  <div className="space-y-1.5">
                    {results.not_found.map((sku, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg"
                      >
                        <span className="material-symbols-outlined text-red-400 text-sm">barcode_scanner</span>
                        <span className="text-xs font-mono font-semibold text-red-700">{sku}</span>
                        <span className="text-[11px] text-red-500 ml-1">Not found in DB or CeX</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.found.length === 0 && results.not_found.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No results returned.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center gap-3 shrink-0">
          {phase === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLookup}
                disabled={parsedPairs.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-900 text-white text-sm font-bold rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">search</span>
                Look Up {parsedPairs.length > 0 ? `${parsedPairs.length} Pair${parsedPairs.length !== 1 ? 's' : ''}` : 'Barcodes'}
              </button>
            </>
          )}

          {phase === 'loading' && (
            <div className="flex-1 flex items-center justify-center gap-2 py-1">
              <span className="material-symbols-outlined text-blue-900 animate-spin text-base">sync</span>
              <span className="text-sm font-semibold text-blue-900">Looking up barcodes…</span>
            </div>
          )}

          {phase === 'results' && (
            <>
              <button
                onClick={() => { setPhase('input'); setResults(null); }}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleAddToList}
                disabled={!results?.found?.length}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-blue-900 text-sm font-bold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-yellow-500/20"
              >
                <span className="material-symbols-outlined text-sm">add_shopping_cart</span>
                Add {results?.found?.length ?? 0} Item{(results?.found?.length ?? 0) !== 1 ? 's' : ''} to Reprice List
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickRepriceModal;
