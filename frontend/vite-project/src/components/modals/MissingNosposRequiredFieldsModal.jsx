import React, { useEffect, useState, useCallback } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';

/**
 * Shown when booking for testing while some lines still lack required NosPos stock field values.
 * Cannot be dismissed until `onRecheckContinue` succeeds (all required fields populated in CG).
 */
export default function MissingNosposRequiredFieldsModal({ lines, onRecheckContinue }) {
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
      title="Complete NosPos fields"
      onClose={() => {}}
      closeOnBackdrop={false}
      showCloseButton={false}
      panelClassName="max-w-2xl"
      zClass="z-[200]"
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <p className="mb-3 text-[11px] leading-snug text-slate-600">
        These items still have <span className="font-semibold text-brand-blue">required</span> NosPos stock
        fields with no value. You must complete every listed field in CG Suite (e.g. line raw data /
        park flow) before you can continue. This dialog cannot be closed until verification passes.
      </p>
      <div className="max-h-[min(50vh,320px)] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full spreadsheet-table border-collapse text-left text-xs">
          <thead>
            <tr>
              <th className="min-w-[140px]">Item</th>
              <th>Required fields to fill</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((row) => (
              <tr key={row.itemId}>
                <td className="align-top font-semibold text-gray-900">{row.itemName}</td>
                <td className="align-top text-gray-700">
                  <ul className="list-inside list-disc space-y-0.5">
                    {row.missingFieldLabels.map((label, li) => (
                      <li key={`${row.itemId}-${li}-${label}`}>{label}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={busy}
          className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? 'Checking…' : 'Continue — verify fields'}
        </button>
      </div>
    </TinyModal>
  );
}
