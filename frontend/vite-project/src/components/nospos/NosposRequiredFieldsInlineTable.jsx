import React from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import { getBoundedNosposStockFieldSelect } from '@/pages/buyer/utils/nosposStockFieldBoundedSelects';
import { SearchablePortalSelect } from '@/components/ui/components';

export const NOSPOS_STOCK_FIELD_BOUNDED_PLACEHOLDER = 'Choose…';

/**
 * Shared Field / Value grid used by {@link NosposRequiredFieldsEditorModal} and inline flows (e.g. Other workspace).
 *
 * @param {object[]} requiredRows - from {@link buildRequiredNosposFieldEditorModel}
 * @param {Record<string, string>} draft - nosposFieldId -> value
 * @param {(fieldId: string, value: string) => void} onChange
 * @param {string} [tableClassName] - extra classes on the scroll wrapper
 * @param {string} [boundedSelectPlaceholder] - passed to {@link SearchablePortalSelect}
 * @param {string} [textInputPlaceholder] - free-text stock fields
 */
export default function NosposRequiredFieldsInlineTable({
  requiredRows,
  draft,
  onChange,
  tableClassName = '',
  boundedSelectPlaceholder = '',
  textInputPlaceholder = '',
}) {
  if (!Array.isArray(requiredRows) || requiredRows.length === 0) return null;

  return (
    <>
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div className={`overflow-auto rounded-lg border border-slate-200 ${tableClassName}`.trim()}>
        <table className="w-full spreadsheet-table border-collapse text-left text-xs">
          <thead>
            <tr>
              <th className="min-w-[120px]">Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {requiredRows.map((row) => (
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
                      const portalOptions = bounded.options.map((o) => ({
                        value: String(o.value ?? '').trim(),
                        label: String(o.text ?? o.value ?? '').trim(),
                      }));
                      return (
                        <div className="min-w-[160px] max-w-full">
                          <SearchablePortalSelect
                            value={rawVal}
                            options={portalOptions}
                            placeholder={boundedSelectPlaceholder}
                            onChange={(v) => onChange(String(row.nosposFieldId), v)}
                          />
                        </div>
                      );
                    }
                    return (
                      <input
                        type="text"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                        value={draft[row.nosposFieldId] ?? ''}
                        onChange={(e) => onChange(String(row.nosposFieldId), e.target.value)}
                        placeholder={textInputPlaceholder}
                      />
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
