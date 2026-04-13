import React, { useCallback, useEffect, useRef, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import {
  finalizeJewelleryWeightInput,
  isJewelleryCoinLine,
  isJewelleryCoinSilverOzLine,
  lineNeedsJewelleryWorkspaceDetail,
  MIN_JEWELLERY_WEIGHT,
  sanitizeJewelleryCoinUnitsInput,
} from '@/components/jewellery/jewelleryNegotiationCart';

/** Same rules as save — name can stay disabled until this is true. */
function isPrimaryMetricComplete(draft, lineMeta) {
  if (!draft || !lineMeta) return false;
  const coin = isJewelleryCoinLine(lineMeta);
  if (coin) {
    const uRaw = String(draft.coinUnits ?? '').trim();
    const n = Number(uRaw);
    return uRaw !== '' && Number.isInteger(n) && n >= 1;
  }
  const wTrim = String(draft.weight ?? '').trim();
  if (wTrim === '') return false;
  const n = parseFloat(wTrim.replace(/,/g, ''));
  return Number.isFinite(n) && n >= MIN_JEWELLERY_WEIGHT;
}

/**
 * @typedef {{ id: string; itemName: string; weight?: string; coinUnits?: string }} JewelleryDetailsCommit
 */

/**
 * Blocking modal: edit name + weight (or coin units) in local drafts only; parent updates when the user saves.
 * @param {(commits: JewelleryDetailsCommit[]) => void} onCommitLines
 */
export default function JewelleryLineDetailsBlockingModal({
  open,
  onClose,
  lines,
  onCommitLines,
  showNotification = null,
  zClass = 'z-[310]',
  panelClassName = 'max-w-lg',
}) {
  const wasOpenRef = useRef(false);
  const [sessionOrder, setSessionOrder] = useState([]);
  /** @type {Record<string, { itemName: string; weight: string; coinUnits: string }>} */
  const [draftById, setDraftById] = useState({});
  /** Weight or coin-units input per row — focus first on open; tab stays here until valid. */
  const primaryFieldRefs = useRef({});

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setSessionOrder([]);
      setDraftById({});
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      const pending = (Array.isArray(lines) ? lines : []).filter(lineNeedsJewelleryWorkspaceDetail);
      const order = pending.map((l) => l.id);
      const next = {};
      for (const l of pending) {
        const coin = isJewelleryCoinLine(l);
        const wTrim = String(l.weight ?? '').trim();
        const cTrim = String(l.coinUnits ?? '').trim();
        next[l.id] = {
          itemName: l.itemName ?? l.categoryLabel ?? l.variantTitle ?? '',
          weight: coin ? '' : wTrim === '' || wTrim === '0' ? '' : String(l.weight ?? ''),
          coinUnits: coin ? (cTrim === '' || cTrim === '0' ? '' : cTrim) : '',
        };
      }
      setSessionOrder(order);
      setDraftById(next);
    }
  }, [open, lines]);

  useEffect(() => {
    if (!open) {
      primaryFieldRefs.current = {};
      return;
    }
    if (sessionOrder.length === 0) return;
    const firstId = sessionOrder[0];
    const raf = requestAnimationFrame(() => {
      primaryFieldRefs.current[firstId]?.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, sessionOrder]);

  const setDraft = useCallback((id, patch) => {
    setDraftById((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }, []);

  const handleSave = useCallback(() => {
    if (sessionOrder.length === 0) {
      onClose?.();
      return;
    }
    /** @type {JewelleryDetailsCommit[]} */
    const commits = [];
    for (const id of sessionOrder) {
      const d = draftById[id];
      const lineMeta = (Array.isArray(lines) ? lines : []).find((l) => l.id === id);
      if (!d || !lineMeta) continue;
      const coin = isJewelleryCoinLine(lineMeta);
      const nameTrim = String(d.itemName ?? '').trim();
      if (!nameTrim) {
        showNotification?.('Enter an item name for every row.', 'error');
        return;
      }
      if (coin) {
        const uRaw = String(d.coinUnits ?? '').trim();
        const n = Number(uRaw);
        if (uRaw === '' || !Number.isInteger(n) || n < 1) {
          showNotification?.('Enter a whole number of units (1 or more) for every coin row.', 'error');
          return;
        }
        commits.push({ id, itemName: nameTrim, coinUnits: String(n) });
        continue;
      }
      const wTrim = String(d.weight ?? '').trim();
      if (wTrim === '') {
        showNotification?.('Enter a weight greater than 0 for every weighed row.', 'error');
        return;
      }
      const n = parseFloat(wTrim.replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) {
        showNotification?.('Weight must be greater than 0.', 'error');
        return;
      }
      if (n < MIN_JEWELLERY_WEIGHT) {
        showNotification?.(`Weight must be at least ${MIN_JEWELLERY_WEIGHT}.`, 'error');
        return;
      }
      commits.push({
        id,
        itemName: nameTrim,
        weight: finalizeJewelleryWeightInput(wTrim, false),
      });
    }
    onCommitLines?.(commits);
    onClose?.();
  }, [draftById, lines, onClose, onCommitLines, sessionOrder, showNotification]);

  const onFieldEnter = useCallback(
    (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      handleSave();
    },
    [handleSave]
  );

  if (!open) return null;

  const hasWeighedPending = sessionOrder.some((id) => {
    const lineMeta = (Array.isArray(lines) ? lines : []).find((l) => l.id === id);
    return lineMeta && !isJewelleryCoinLine(lineMeta);
  });
  const hasCoinPending = sessionOrder.some((id) => {
    const lineMeta = (Array.isArray(lines) ? lines : []).find((l) => l.id === id);
    return lineMeta && isJewelleryCoinLine(lineMeta);
  });

  return (
    <TinyModal
      title="Jewellery item details"
      zClass={zClass}
      panelClassName={panelClassName}
      closeOnBackdrop={false}
      showCloseButton={false}
      onClose={() => {}}
    >
      <p className="mb-4 text-xs text-gray-600">
        {hasWeighedPending ? (
          <>
            Enter <span className="font-semibold text-gray-800">weight</span> first (minimum{' '}
            <span className="font-semibold text-gray-800">{MIN_JEWELLERY_WEIGHT}</span>
            ). Item name stays disabled until weight is valid; Tab cannot leave the weight field until then.
          </>
        ) : null}
        {hasWeighedPending && hasCoinPending ? ' ' : null}
        {hasCoinPending ? (
          <>
            Coin rows: enter <span className="font-semibold text-gray-800">how many units</span> first (whole number, 1 or
            more); item name stays disabled until then.
          </>
        ) : null}
        {!hasWeighedPending && !hasCoinPending ? (
          <>Enter the details below for each row.</>
        ) : null}
      </p>
      <div className="flex max-h-[min(52vh,420px)] flex-col gap-6 overflow-y-auto pr-1">
        {sessionOrder.length === 0 ? (
          <p className="text-xs text-gray-500">No rows in this session.</p>
        ) : (
          sessionOrder.map((id) => {
            const lineMeta = (Array.isArray(lines) ? lines : []).find((l) => l.id === id);
            const d = draftById[id];
            if (!lineMeta || !d) return null;
            const coin = isJewelleryCoinLine(lineMeta);
            const isUnit = lineMeta.sourceKind === 'UNIT';
            const unitHint = coin
              ? isJewelleryCoinSilverOzLine(lineMeta)
                ? 't oz (fixed)'
                : 'coin (fixed)'
              : isUnit
                ? 'each'
                : lineMeta.weightUnit || 'g';
            const primaryOk = isPrimaryMetricComplete(d, lineMeta);
            const primaryKeyDown = (e) => {
              if (e.key === 'Enter') {
                onFieldEnter(e);
                return;
              }
              if (e.key === 'Tab' && !primaryOk) {
                e.preventDefault();
              }
            };
            return (
              <div key={id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-4 text-xs shadow-sm">
                <p className="font-bold text-brand-blue">{lineMeta.categoryLabel || lineMeta.variantTitle || 'Item'}</p>
                {coin ? (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                      How many units
                    </label>
                    <input
                      ref={(el) => {
                        if (el) primaryFieldRefs.current[id] = el;
                        else delete primaryFieldRefs.current[id];
                      }}
                      type="text"
                      inputMode="numeric"
                      value={d.coinUnits}
                      onChange={(e) => setDraft(id, { coinUnits: sanitizeJewelleryCoinUnitsInput(e.target.value) })}
                      onKeyDown={primaryKeyDown}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                      aria-label={`Unit count for ${lineMeta.categoryLabel || 'row'}`}
                    />
                    <p className="mt-1 text-[10px] text-gray-500">Whole number only (1 or more). Reference: 1 {unitHint}.</p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                      Weight ({unitHint})
                    </label>
                    <input
                      ref={(el) => {
                        if (el) primaryFieldRefs.current[id] = el;
                        else delete primaryFieldRefs.current[id];
                      }}
                      type="text"
                      inputMode="decimal"
                      value={d.weight}
                      onChange={(e) => setDraft(id, { weight: e.target.value })}
                      onKeyDown={primaryKeyDown}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                      aria-label={`Weight for ${lineMeta.categoryLabel || 'row'}`}
                      placeholder="e.g. 12.5"
                    />
                    <p className="mt-1 text-[10px] text-gray-500">
                      Must be greater than 0 (min {MIN_JEWELLERY_WEIGHT})
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">Item name</label>
                  <input
                    type="text"
                    disabled={!primaryOk}
                    value={d.itemName}
                    onChange={(e) => setDraft(id, { itemName: e.target.value })}
                    onKeyDown={onFieldEnter}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    aria-label={`Item name for ${lineMeta.categoryLabel || 'row'}`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-6 flex justify-end border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-xl px-6 py-2.5 text-xs font-extrabold uppercase tracking-wide text-white shadow-md"
          style={{ background: 'var(--brand-blue)' }}
        >
          Save
        </button>
      </div>
    </TinyModal>
  );
}
