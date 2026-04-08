import React, { useEffect, useState, useCallback, useMemo } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import { buildRequiredNosposFieldEditorModel } from '@/pages/buyer/utils/nosposAgreementFirstItemFill';
import { negotiationItemDisplayName } from '@/pages/buyer/utils/negotiationMissingNosposRequired';

/**
 * Shown when booking for testing while some lines still lack required NosPos stock field values.
 * Users can fill fields inline; cannot dismiss until `onRecheckContinue` succeeds.
 */
export default function MissingNosposRequiredFieldsModal({
  lines,
  items,
  nosposCategoriesResults,
  nosposCategoryMappings,
  useVoucherOffers,
  actualRequestId,
  onSaveLineFields,
  onRecheckContinue,
}) {
  const [busy, setBusy] = useState(false);
  const [saveBusyId, setSaveBusyId] = useState(null);
  const [draftByItemId, setDraftByItemId] = useState({});

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

  const lineEditors = useMemo(() => {
    if (!lines?.length || !Array.isArray(items) || nosposCategoriesResults == null) return [];
    const maps = Array.isArray(nosposCategoryMappings) ? nosposCategoryMappings : [];
    return lines.map((line) => {
      const item = items.find((it) => it.id === line.itemId);
      const negotiationIndex = items.findIndex((it) => it.id === line.itemId);
      if (!item || negotiationIndex < 0) {
        return { line, item: null, model: null, editRows: [], reqId: null };
      }
      const model = buildRequiredNosposFieldEditorModel(item, negotiationIndex, {
        useVoucherOffers,
        categoriesResults: nosposCategoriesResults,
        categoryMappings: maps,
        requestId: actualRequestId,
      });
      const missingSet = new Set((line.missingFieldLabels || []).map((l) => String(l).trim()));
      const editRows = model.requiredRows.filter(
        (r) => missingSet.has(String(r.label).trim()) && !r.satisfiedByPreset
      );
      return {
        line,
        item,
        model,
        editRows,
        reqId: item.request_item_id != null && String(item.request_item_id).trim() !== '' ? item.request_item_id : null,
      };
    });
  }, [lines, items, nosposCategoriesResults, nosposCategoryMappings, useVoucherOffers, actualRequestId]);

  useEffect(() => {
    setDraftByItemId((prev) => {
      const next = { ...prev };
      for (const row of lineEditors) {
        if (!row.item || !row.editRows.length) continue;
        const id = row.item.id;
        const existing = next[id] && typeof next[id] === 'object' ? next[id] : {};
        const merged = { ...existing };
        for (const er of row.editRows) {
          const nextVal = er.value || '';
          const prevVal = merged[er.nosposFieldId];
          const prevEmpty = prevVal === undefined || prevVal === null || String(prevVal).trim() === '';
          const nextNonEmpty = String(nextVal).trim() !== '';
          if (prevVal === undefined || prevVal === null) {
            merged[er.nosposFieldId] = nextVal;
          } else if (prevEmpty && nextNonEmpty) {
            merged[er.nosposFieldId] = nextVal;
          }
        }
        next[id] = merged;
      }
      return next;
    });
  }, [lineEditors]);

  const handleContinue = useCallback(async () => {
    if (!onRecheckContinue || busy) return;
    setBusy(true);
    try {
      await onRecheckContinue();
    } finally {
      setBusy(false);
    }
  }, [onRecheckContinue, busy]);

  const handleSaveRow = useCallback(
    async (entry) => {
      const { item, model, editRows, reqId } = entry;
      if (!item || model?.stockAssessment !== 'ready' || !model?.leafNosposId || !editRows.length || !onSaveLineFields)
        return;
      if (!reqId) return;
      const draft = draftByItemId[item.id] || {};
      const draftByFieldId = {};
      for (const er of editRows) {
        draftByFieldId[er.nosposFieldId] = String(draft[er.nosposFieldId] ?? '').trim();
      }
      const missing = editRows.some((er) => !String(draft[er.nosposFieldId] ?? '').trim());
      if (missing) return;
      setSaveBusyId(item.id);
      try {
        await onSaveLineFields({
          item,
          leafNosposId: model.leafNosposId,
          draftByFieldId,
        });
      } finally {
        setSaveBusyId(null);
      }
    },
    [draftByItemId, onSaveLineFields]
  );

  if (!lines?.length) return null;

  const schemaPending = nosposCategoriesResults == null;

  return (
    <TinyModal
      title="Complete NosPos fields"
      onClose={() => {}}
      closeOnBackdrop={false}
      showCloseButton={false}
      panelClassName="max-w-3xl"
      zClass="z-[200]"
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <p className="mb-3 text-[11px] leading-snug text-slate-600">
        These items still have <span className="font-semibold text-brand-blue">required</span> NosPos stock
        fields with no value. Fill the fields below (saved to the line like raw data / stock field AI), then
        use <span className="font-semibold">Continue — verify fields</span> when everything is complete. This
        dialog cannot be closed until verification passes.
      </p>

      {schemaPending ? (
        <p className="mb-3 text-[11px] text-amber-800">Loading NosPos field definitions…</p>
      ) : null}

      <div className="max-h-[min(60vh,480px)] space-y-5 overflow-auto pr-1">
        {lineEditors.map((entry) => {
          const { line, item, model, editRows, reqId } = entry;
          if (!item) {
            return (
              <div
                key={line.itemId}
                className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900"
              >
                <span className="font-semibold">{line.itemName}</span> — line not found in the current list.
              </div>
            );
          }
          if (model?.stockAssessment !== 'ready' || !model?.leafNosposId || !editRows.length) {
            return (
              <div
                key={line.itemId}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700"
              >
                <span className="font-semibold text-gray-900">{negotiationItemDisplayName(item)}</span>
                <p className="mt-1 text-slate-600">
                  Could not resolve editable fields (category or definitions may have changed). Try again from the
                  negotiation table.
                </p>
              </div>
            );
          }

          const draft = draftByItemId[item.id] || {};
          const rowIncomplete = editRows.some((er) => !String(draft[er.nosposFieldId] ?? '').trim());
          const saving = saveBusyId === item.id;

          return (
            <div key={line.itemId} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand-blue">
                  {negotiationItemDisplayName(item)}
                </p>
                {!reqId ? (
                  <p className="mt-1 text-[10px] font-semibold text-amber-800">
                    This line has no request_item_id yet — save the quote line first, then fill NosPos fields from
                    the table.
                  </p>
                ) : null}
              </div>
              <div className="overflow-x-auto px-2 pb-2">
                <table className="w-full spreadsheet-table border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      <th className="min-w-[120px]">Field</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editRows.map((er) => (
                      <tr key={er.nosposFieldId}>
                        <td className="align-top font-semibold text-gray-900">{er.label}</td>
                        <td className="align-top">
                          <input
                            type="text"
                            className="w-full min-w-[180px] rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                            value={draft[er.nosposFieldId] ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDraftByItemId((prev) => ({
                                ...prev,
                                [item.id]: { ...(prev[item.id] || {}), [er.nosposFieldId]: v },
                              }));
                            }}
                            placeholder="Required"
                            disabled={!reqId || saving}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end border-t border-slate-100 px-3 py-2">
                <button
                  type="button"
                  disabled={!reqId || saving || rowIncomplete || busy}
                  onClick={() => void handleSaveRow(entry)}
                  className="rounded-lg bg-brand-blue px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save fields for this line'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={busy || schemaPending}
          className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? 'Checking…' : 'Continue — verify fields'}
        </button>
      </div>
    </TinyModal>
  );
}
