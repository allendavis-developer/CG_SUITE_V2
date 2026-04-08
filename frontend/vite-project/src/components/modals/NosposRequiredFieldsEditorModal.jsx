import React, { useMemo, useState, useCallback, useEffect } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import { buildRequiredNosposFieldEditorModel } from '@/pages/buyer/utils/nosposAgreementFirstItemFill';
import { negotiationItemDisplayName } from '@/pages/buyer/utils/negotiationMissingNosposRequired';
import { getBoundedNosposStockFieldSelect } from '@/pages/buyer/utils/nosposStockFieldBoundedSelects';
import { CustomDropdown } from '@/components/ui/components';

const BOUNDED_FIELD_PLACEHOLDER = 'Choose…';

/**
 * Small spreadsheet-style editor for required NosPos stock field values on a negotiation line.
 * When the category has no required linked fields, the table is empty and only Close is shown.
 */
export default function NosposRequiredFieldsEditorModal({
  item,
  negotiationIndex,
  nosposSiteCategories,
  nosposCategoryMappings,
  useVoucherOffers,
  requestId,
  onSave,
  onClose,
  /** When true (buying / hidden column flow): cannot dismiss until all editable required fields are filled and saved. */
  requireCompletionUntilSave = false,
}) {
  const model = useMemo(
    () =>
      buildRequiredNosposFieldEditorModel(item, negotiationIndex, {
        useVoucherOffers,
        categoriesResults: nosposSiteCategories || [],
        categoryMappings: nosposCategoryMappings || [],
        requestId,
      }),
    [item, negotiationIndex, useVoucherOffers, nosposSiteCategories, nosposCategoryMappings, requestId]
  );

  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = {};
    for (const r of model.requiredRows) {
      if (!r.satisfiedByPreset) m[r.nosposFieldId] = r.value || '';
    }
    setDraft(m);
  }, [item?.id, model.leafNosposId, model.stockAssessment]); // sync when line or leaf changes (not every model ref)

  const handleSave = useCallback(async () => {
    const missing = model.requiredRows.filter(
      (r) => !r.satisfiedByPreset && !String(draft[r.nosposFieldId] ?? '').trim()
    );
    if (missing.length > 0) {
      return;
    }
    setBusy(true);
    try {
      await onSave?.({
        item,
        leafNosposId: model.leafNosposId,
        draftByFieldId: draft,
        labelByFieldId: Object.fromEntries(model.requiredRows.map((r) => [r.nosposFieldId, r.label])),
      });
    } finally {
      setBusy(false);
    }
  }, [model, draft, item, onSave]);

  if (!item || model.stockAssessment !== 'ready' || !model.leafNosposId) {
    return null;
  }

  const hasEditableRequired = model.requiredRows.some((r) => !r.satisfiedByPreset);
  const saveBlocked =
    hasEditableRequired &&
    model.requiredRows.some((r) => !r.satisfiedByPreset && !String(draft[r.nosposFieldId] ?? '').trim());

  const dismissLocked = Boolean(
    busy || (requireCompletionUntilSave && saveBlocked && hasEditableRequired)
  );

  return (
    <TinyModal
      title="NosPos stock fields"
      onClose={onClose}
      panelClassName="max-w-xl"
      zClass="z-[200]"
      closeOnBackdrop={!dismissLocked}
      showCloseButton={!dismissLocked}
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <p className="mb-2 text-[11px] text-slate-600">
        <span className="font-semibold text-brand-blue">{negotiationItemDisplayName(item)}</span>
        <span className="text-slate-500">
          {' '}
          — values are saved to this request line (same as stock field AI).
        </span>
      </p>
      {model.requiredRows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-8 text-center text-[12px] text-slate-600">
          No required stock fields for this NosPos category.
        </p>
      ) : (
        <div className="max-h-[min(55vh,380px)] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full spreadsheet-table border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="min-w-[120px]">Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {model.requiredRows.map((row) => (
                <tr key={row.nosposFieldId}>
                  <td className="align-top font-semibold text-gray-900">{row.label}</td>
                  <td className="align-top">
                    {row.satisfiedByPreset ? (
                      <span
                        className="text-[11px] text-slate-600"
                        title="Filled from workspace / line data — read only"
                      >
                        {row.value || '—'}
                      </span>
                    ) : (() => {
                      const bounded = getBoundedNosposStockFieldSelect(row.label);
                      const rawVal = String(draft[row.nosposFieldId] ?? '').trim();
                      if (bounded?.options?.length) {
                        const optionLabels = bounded.options.map((o) =>
                          String(o.text ?? o.value ?? '').trim()
                        );
                        const selectedOpt = bounded.options.find(
                          (o) => String(o.value ?? '').trim() === rawVal
                        );
                        const selectedLabel = selectedOpt
                          ? String(selectedOpt.text ?? selectedOpt.value ?? '').trim()
                          : '';
                        const valueOk =
                          Boolean(selectedLabel) && optionLabels.includes(selectedLabel);
                        return (
                          <div className="w-full min-w-[160px]">
                            <CustomDropdown
                              value={valueOk ? selectedLabel : BOUNDED_FIELD_PLACEHOLDER}
                              options={optionLabels}
                              onChange={(label) => {
                                const found = bounded.options.find(
                                  (o) =>
                                    String(o.text ?? '').trim() === label ||
                                    String(o.value ?? '').trim() === label
                                );
                                if (found) {
                                  setDraft((d) => ({
                                    ...d,
                                    [row.nosposFieldId]: String(found.value ?? '').trim(),
                                  }));
                                }
                              }}
                              labelPosition="top"
                            />
                          </div>
                        );
                      }
                      return (
                        <input
                          type="text"
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                          value={draft[row.nosposFieldId] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [row.nosposFieldId]: e.target.value }))
                          }
                          placeholder="Required"
                        />
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {saveBlocked ? (
        <p className="mt-2 text-[10px] font-semibold text-amber-800">Fill every editable required field to save.</p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        {!dismissLocked ? (
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {model.requiredRows.length === 0 ? 'Close' : 'Cancel'}
          </button>
        ) : null}
        {model.requiredRows.length > 0 ? (
          <button
            type="button"
            disabled={busy || saveBlocked}
            onClick={() => void handleSave()}
            className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </div>
    </TinyModal>
  );
}
