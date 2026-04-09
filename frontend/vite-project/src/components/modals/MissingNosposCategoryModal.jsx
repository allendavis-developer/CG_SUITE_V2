import React, { useEffect, useState, useCallback } from 'react';
import TinyModal from '@/components/ui/TinyModal';

/**
 * Shown when booking for testing while some lines still have no resolved NosPos category.
 * Cannot be dismissed until all listed items have a category assigned.
 *
 * @param {{ itemId: string, itemName: string }[]} lines - items missing a category
 * @param {function} onSetCategory - called with itemId when user clicks "Set category" for a line
 * @param {function} onRecheckContinue - async callback; checks current state and proceeds if clear
 */
export default function MissingNosposCategoryModal({
  lines,
  onSetCategory,
  onRecheckContinue,
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const blockEscape = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', blockEscape, true);
    return () => window.removeEventListener('keydown', blockEscape, true);
  }, []);

  const handleContinue = useCallback(async () => {
    if (!onRecheckContinue || busy) return;
    setBusy(true);
    try {
      await onRecheckContinue();
    } finally {
      setBusy(false);
    }
  }, [onRecheckContinue, busy]);

  if (!lines?.length) return null;

  return (
    <TinyModal
      title="NosPos Category Required"
      onClose={() => {}}
      closeOnBackdrop={false}
      showCloseButton={false}
      panelClassName="max-w-lg"
      zClass="z-[200]"
      bodyScroll={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <p className="shrink-0 text-[11px] leading-snug text-slate-600">
          The following items have <span className="font-semibold text-brand-blue">no NosPos category</span> assigned.
          A NosPos category is required before booking for testing. Click <span className="font-semibold">Set category</span> to
          assign one, then use <span className="font-semibold">Continue — verify</span> once all items are updated.
          This dialog cannot be closed until verification passes.
        </p>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          {lines.map((line) => (
            <div
              key={line.itemId}
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-amber-900">{line.itemName}</p>
                {line.currentCategory ? (
                  <p className="mt-0.5 text-[10px] text-amber-700">
                    Current: {line.currentCategory}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] text-amber-600">No category set</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onSetCategory?.(line.itemId)}
                className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800 transition-colors hover:bg-amber-50 hover:border-amber-500"
              >
                Set category
              </button>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={busy}
            className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? 'Checking…' : 'Continue — verify'}
          </button>
        </div>
      </div>
    </TinyModal>
  );
}
