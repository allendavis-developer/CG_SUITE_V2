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
        next[l.id] = {
          itemName: l.itemName ?? l.categoryLabel ?? l.variantTitle ?? '',
          weight: coin ? '' : String(l.weight ?? ''),
          coinUnits: coin ? String(l.coinUnits ?? '0') : '',
        };
      }
      setSessionOrder(order);
      setDraftById(next);
    }
  }, [open, lines]);

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
            Weighed rows need a weight greater than 0 (minimum{' '}
            <span className="font-semibold text-gray-800">{MIN_JEWELLERY_WEIGHT}</span>). You can clear the weight field
            while typing.
          </>
        ) : null}
        {hasWeighedPending && hasCoinPending ? ' ' : null}
        {hasCoinPending ? (
          <>Coin rows need a whole number of units (1 or more), not a fraction.</>
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
            return (
              <div key={id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-4 text-xs shadow-sm">
                <p className="font-bold text-brand-blue">{lineMeta.categoryLabel || lineMeta.variantTitle || 'Item'}</p>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">Item name</label>
                  <input
                    type="text"
                    value={d.itemName}
                    onChange={(e) => setDraft(id, { itemName: e.target.value })}
                    onKeyDown={onFieldEnter}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                    aria-label={`Item name for ${lineMeta.categoryLabel || 'row'}`}
                  />
                </div>
                {coin ? (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                      How many units
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={d.coinUnits}
                      onChange={(e) => setDraft(id, { coinUnits: sanitizeJewelleryCoinUnitsInput(e.target.value) })}
                      onKeyDown={onFieldEnter}
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
                      type="text"
                      inputMode="decimal"
                      value={d.weight}
                      onChange={(e) => setDraft(id, { weight: e.target.value })}
                      onKeyDown={onFieldEnter}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                      aria-label={`Weight for ${lineMeta.categoryLabel || 'row'}`}
                    />
                    <p className="mt-1 text-[10px] text-gray-500">
                      Must be greater than 0 (min {MIN_JEWELLERY_WEIGHT})
                    </p>
                  </div>
                )}
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
