import React, { useState, useRef, useEffect, useMemo } from 'react';
import { quickRepriceLookup } from '@/services/api';
import { searchNosposBarcode } from '@/services/extensionClient';

/**
 * Parses a block of barcode text into groups.
 *
 * Rules:
 *  - Lines are trimmed and blanks are ignored.
 *  - NoSpos barcodes start with "bb" (case-insensitive).
 *  - Any line that does NOT start with "bb" starts a new item group (Game SKU).
 *  - All consecutive BB lines after a Game SKU belong to that item.
 *  - Orphan BB lines before any Game SKU are skipped.
 *
 * Returns: [{ cex_sku: string, nospos_barcodes: string[] }]
 */
function parseBarcodeText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const groups = [];
  let currentGroup = null;

  for (const line of lines) {
    if (!line.toLowerCase().startsWith('bb')) {
      currentGroup = { cex_sku: line, nospos_barcodes: [] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.nospos_barcodes.push(line);
    }
  }

  return groups;
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

  const parsedGroups = parseBarcodeText(barcodeText);

  /**
   * Looks up a single raw barcode on NoSpos and returns a result object.
   * { status: 'verified'|'not_found'|'multiple'|'login_required'|'error', barserial, href, name, matches, message }
   */
  const lookupOneBarcode = async (rawBarcode) => {
    try {
      const response = await searchNosposBarcode(rawBarcode);
      if (response?.loginRequired) {
        return { status: 'login_required', original: rawBarcode, message: 'Log in to NoSpos, then retry' };
      }
      if (!response?.ok) {
        return { status: 'error', original: rawBarcode, message: response?.error || 'NoSpos lookup failed' };
      }
      const matches = response.results || [];
      if (matches.length === 1) {
        return {
          status: 'verified',
          original: rawBarcode,
          barserial: matches[0].barserial,
          href: `https://nospos.com${matches[0].href}`,
          name: matches[0].name || '',
          matches,
          message: matches[0].name ? `${matches[0].barserial} · ${matches[0].name}` : matches[0].barserial,
        };
      }
      if (matches.length === 0) {
        return { status: 'not_found', original: rawBarcode, matches: [], message: 'No NoSpos match found' };
      }
      return { status: 'multiple', original: rawBarcode, matches, message: `${matches.length} matches found — pick one` };
    } catch (err) {
      return { status: 'error', original: rawBarcode, message: err?.message || 'NoSpos lookup failed' };
    }
  };

  /**
   * For each found item, verify all its nospos_barcodes in parallel.
   * Item-level status:
   *   'missing'       – no barcodes supplied
   *   'verified'      – every barcode resolved to a single match
   *   'login_required'– at least one barcode needs a login
   *   'partial'       – some barcodes unresolvable (not_found / multiple / error)
   */
  const verifyNosposItems = async (foundItems) => {
    const verified = await Promise.all((foundItems || []).map(async (item) => {
      const barcodes = item.nospos_barcodes || [];
      if (!barcodes.length) {
        return {
          ...item,
          nosposVerification: { status: 'missing', message: 'No NoSpos barcode supplied', barcodeResults: [] }
        };
      }

      const barcodeResults = await Promise.all(barcodes.map(lookupOneBarcode));

      const hasLoginRequired = barcodeResults.some(r => r.status === 'login_required');
      const allVerified = barcodeResults.every(r => r.status === 'verified');

      let overallStatus;
      if (allVerified) overallStatus = 'verified';
      else if (hasLoginRequired) overallStatus = 'login_required';
      else overallStatus = 'partial';

      const nosposBarcodes = allVerified
        ? barcodeResults.map(r => ({ barserial: r.barserial, href: r.href, name: r.name }))
        : [];

      const verifiedCount = barcodeResults.filter(r => r.status === 'verified').length;
      const message = allVerified
        ? `${verifiedCount} barcode${verifiedCount !== 1 ? 's' : ''} verified`
        : hasLoginRequired
          ? 'Log in to NoSpos, then retry'
          : `${verifiedCount}/${barcodes.length} barcodes verified`;

      return {
        ...item,
        nosposBarcodes,
        nosposVerification: { status: overallStatus, message, barcodeResults }
      };
    }));

    return verified;
  };

  const handleLookup = async () => {
    if (!parsedGroups.length) return;
    setError(null);
    setPhase('loading');
    try {
      // The API only needs cex_sku; nospos_barcode is not used for DB lookup
      const apiPairs = parsedGroups.map(g => ({ cex_sku: g.cex_sku, nospos_barcode: '' }));
      const data = await quickRepriceLookup(apiPairs);
      // Re-attach the scanned barcodes to each found item
      const foundWithBarcodes = (data?.found || []).map(item => {
        const group = parsedGroups.find(g => g.cex_sku === item.cex_sku);
        return { ...item, nospos_barcodes: group?.nospos_barcodes || [] };
      });
      const verifiedFound = await verifyNosposItems(foundWithBarcodes);
      setResults({ ...data, found: verifiedFound });
      setPhase('results');
    } catch (err) {
      setError(err.message || 'Lookup failed');
      setPhase('input');
    }
  };

  const handleAddToList = () => {
    const verifiedItems = (results?.found || []).filter((item) => item?.nosposVerification?.status === 'verified');
    if (!verifiedItems.length) return;
    // Each item carries nosposBarcodes: [{ barserial, href, name }]
    onAddItems(verifiedItems);
    onClose();
  };

  const handleRetryNosposVerification = async () => {
    if (!results?.found?.length) return;
    setError(null);
    setPhase('loading');
    try {
      const verifiedFound = await verifyNosposItems(results.found);
      setResults((prev) => ({ ...(prev || {}), found: verifiedFound, not_found: prev?.not_found || [] }));
      setPhase('results');
    } catch (err) {
      setError(err.message || 'NoSpos verification failed');
      setPhase('results');
    }
  };

  const verifiedFoundItems = useMemo(
    () => (results?.found || []).filter((item) => item?.nosposVerification?.status === 'verified'),
    [results]
  );

  const unverifiedFoundItems = useMemo(
    () => (results?.found || []).filter((item) => item?.nosposVerification?.status !== 'verified'),
    [results]
  );

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
                  Enter barcodes for <span className="font-semibold">games only</span>. Each non-BB line starts a new item; all BB lines after it belong to that item:<br />
                  <span className="font-mono font-bold">1234567890</span>
                  <span className="text-blue-500"> ← Game SKU</span><br />
                  <span className="font-mono font-bold">BB12CD345</span>
                  <span className="text-blue-500"> ← NoSpos barcode #1</span><br />
                  <span className="font-mono font-bold">BB98ZW001</span>
                  <span className="text-blue-500"> ← NoSpos barcode #2 (same item)</span><br />
                  <span className="font-mono font-bold">9876543210</span>
                  <span className="text-blue-500"> ← next item</span>
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

              {parsedGroups.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-bold text-blue-900">{parsedGroups.length}</span> item{parsedGroups.length !== 1 ? 's' : ''} detected
                  {' · '}
                  <span className="font-bold text-blue-900">
                    {parsedGroups.reduce((n, g) => n + g.nospos_barcodes.length, 0)}
                  </span> NoSpos barcode{parsedGroups.reduce((n, g) => n + g.nospos_barcodes.length, 0) !== 1 ? 's' : ''}
                  {parsedGroups.filter(g => g.nospos_barcodes.length === 0).length > 0 && (
                    <span className="text-amber-600 ml-2">
                      ({parsedGroups.filter(g => g.nospos_barcodes.length === 0).length} item{parsedGroups.filter(g => g.nospos_barcodes.length === 0).length !== 1 ? 's' : ''} missing BB barcode)
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

              {verifiedFoundItems.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-blue-900 mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
                    Verified ({verifiedFoundItems.length})
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {verifiedFoundItems.map((item, idx) => (
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
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-[11px] font-mono text-gray-400">{item.cex_sku}</span>
                            <span className="text-[11px] font-semibold text-emerald-700 ml-auto">
                              £{Number(item.our_sale_price).toFixed(2)}
                            </span>
                          </div>
                          {(item.nosposBarcodes || []).length > 0 && (
                            <div className="mt-1 flex flex-col gap-0.5">
                              {item.nosposBarcodes.map((b, bi) => (
                                <a
                                  key={bi}
                                  href={b.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] font-mono text-blue-600 hover:underline truncate"
                                >
                                  {b.barserial}{b.name ? ` · ${b.name}` : ''}
                                </a>
                              ))}
                            </div>
                          )}
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

              {unverifiedFoundItems.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    Needs NoSpos Verification ({unverifiedFoundItems.length})
                  </p>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {unverifiedFoundItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
                      >
                        <div className="flex items-start gap-3">
                          <span className="material-symbols-outlined text-amber-600 text-base shrink-0 mt-0.5">barcode_scanner</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-blue-900 truncate">{item.title}</p>
                            <span className="text-[11px] font-mono text-gray-400">{item.cex_sku}</span>
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              {item?.nosposVerification?.message || 'Needs NoSpos verification'}
                            </p>
                            {(item?.nosposVerification?.barcodeResults || []).filter(r => r.status !== 'verified').map((r, ri) => (
                              <p key={ri} className="text-[10px] text-red-600 font-mono mt-0.5">
                                {r.original}: {r.message}
                              </p>
                            ))}
                          </div>
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

              {verifiedFoundItems.length === 0 && unverifiedFoundItems.length === 0 && results.not_found.length === 0 && (
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
                disabled={parsedGroups.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-900 text-white text-sm font-bold rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">search</span>
                Look Up {parsedGroups.length > 0 ? `${parsedGroups.length} Item${parsedGroups.length !== 1 ? 's' : ''}` : 'Barcodes'}
              </button>
            </>
          )}

          {phase === 'loading' && (
            <div className="flex-1 flex items-center justify-center gap-2 py-1">
              <span className="material-symbols-outlined text-blue-900 animate-spin text-base">sync</span>
              <span className="text-sm font-semibold text-blue-900">Looking up and verifying NoSpos barcodes…</span>
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
              {unverifiedFoundItems.length > 0 && (
                <button
                  onClick={handleRetryNosposVerification}
                  className="px-4 py-2 text-sm font-bold text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  Retry NoSpos Check
                </button>
              )}
              <button
                onClick={handleAddToList}
                disabled={!verifiedFoundItems.length}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-blue-900 text-sm font-bold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-yellow-500/20"
              >
                <span className="material-symbols-outlined text-sm">add_shopping_cart</span>
                Add {verifiedFoundItems.length} Verified Item{verifiedFoundItems.length !== 1 ? 's' : ''} to Reprice List
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickRepriceModal;
