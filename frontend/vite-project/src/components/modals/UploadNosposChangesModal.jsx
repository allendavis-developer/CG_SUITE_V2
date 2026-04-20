import React from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';

/**
 * Upload workspace: view-only table of rows scraped from the NosPos stock edit “Changes” card.
 */
export default function UploadNosposChangesModal({ open, onClose, rows = [], titleLine = '' }) {
  if (!open) return null;
  const list = Array.isArray(rows) ? rows : [];
  return (
    <TinyModal
      title="NosPos changes"
      zClass="z-[220]"
      panelClassName="!max-w-5xl !h-[min(92vh,860px)]"
      onClose={onClose}
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      {titleLine ? (
        <p className="mb-3 text-[12px] font-semibold text-slate-700 line-clamp-2" title={titleLine}>
          {titleLine}
        </p>
      ) : null}
      <div className="min-h-0 max-h-[min(78vh,720px)] overflow-auto rounded border border-slate-200">
        <table className="spreadsheet-table w-full min-w-[640px] border-collapse text-left text-[11px]">
          <thead>
            <tr>
              <th className="w-24">ID</th>
              <th className="min-w-[7rem]">Field</th>
              <th className="min-w-[5rem]">Old value</th>
              <th className="min-w-[5rem]">New value</th>
              <th className="min-w-[10rem]">Changed</th>
              <th className="min-w-[6rem]">Changed by</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No change rows were returned for this stock line.
                </td>
              </tr>
            ) : (
              list.map((r, i) => (
                <tr key={`${r.changeEntryId || i}-${i}`}>
                  <td className="tabular-nums text-slate-800">{r.changeEntryId != null ? `#${String(r.changeEntryId).replace(/^#/, '')}` : '—'}</td>
                  <td className="font-medium text-slate-900">{r.columnName || '—'}</td>
                  <td className="text-slate-700">{r.oldValue ?? '—'}</td>
                  <td className="text-slate-700">{r.newValue ?? '—'}</td>
                  <td className="text-slate-600">{r.changedAt || '—'}</td>
                  <td className="text-slate-700">{r.changedBy || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </TinyModal>
  );
}
