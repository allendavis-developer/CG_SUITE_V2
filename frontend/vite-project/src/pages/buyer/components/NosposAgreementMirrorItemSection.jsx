import React from 'react';
import { buildCardFieldKey } from '../utils/nosposMirrorKeys';

export default function NosposAgreementMirrorItemSection({
  rowIdx,
  cardItem,
  card,
  compactCardIdx,
  requiredCategoryFields,
  requiredOtherFields,
  isAdded,
  isExpanded,
  canAddThisRow,
  rowBusy,
  categoryReloading,
  hasRequiredCategoryComplete,
  rowTitle,
  rowMeta,
  rowAttributesSummary,
  aiRunningForRow,
  rowHasMissingRequired,
  statusTone,
  statusLabel,
  addedCardCount,
  autoAddSelectedIfMissing,
  touched,
  activeValidationErrors,
  values,
  notifyCategoryAiRunning,
  setAiFilledFieldKeys,
  aiFilledFieldKeys,
  aiManualFallbackCards,
  getMirrorFieldControlId,
  handleCategoryFieldChange,
  handleFieldChange,
  MirrorField: FieldRenderer,
  nosposMappings,
  prefillStepVersion,
  onToggle,
}) {
  return (
    <section
      className="mb-4 overflow-hidden rounded-[var(--radius)] border border-[var(--ui-border)] bg-[var(--ui-bg)] last:mb-0 [content-visibility:auto] [contain-intrinsic-size:auto_200px]"
      key={card?.cardId || cardItem?.id || `mirror-row-${rowIdx}`}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-[var(--ui-border)] bg-[var(--ui-card)] px-4 py-3 text-left transition hover:bg-white"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-xs font-black uppercase tracking-wider text-[var(--brand-blue)]">
              {rowTitle}
            </h3>
            {rowAttributesSummary ? (
              <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                {rowAttributesSummary}
              </span>
            ) : null}
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone}`}>
              {statusLabel}
            </span>
            {rowBusy && (!Number.isInteger(compactCardIdx) || !categoryReloading) ? (
              <span className="text-[10px] font-bold text-[var(--brand-blue)]">
                {categoryReloading
                  ? 'Updating category…'
                  : aiRunningForRow
                    ? 'AI filling…'
                    : 'Syncing to NoSpos…'}
              </span>
            ) : null}
          </div>
          {rowMeta ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {rowMeta}
            </p>
          ) : null}
        </div>
        <span
          className={`material-symbols-outlined shrink-0 text-[20px] text-[var(--brand-blue)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {isExpanded ? (
        isAdded ? (
          <div data-mirror-focus-chain>
            {requiredCategoryFields.length > 0 ? (
              <div className="border-b border-[var(--ui-border)] bg-[var(--brand-blue-alpha-05)] px-4 py-4">
                <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--ui-border)] bg-white">
                  <table className="spreadsheet-table w-full min-w-[20rem] border-collapse text-left spreadsheet-table--static-header">
                    <thead>
                      <tr>
                        <th className="w-[32%] max-w-[14rem]">Field</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requiredCategoryFields.map((field) => {
                        const fid = getMirrorFieldControlId(field);
                        const aiFilled = Number.isInteger(compactCardIdx)
                          ? aiFilledFieldKeys.has(buildCardFieldKey(compactCardIdx, field.name))
                          : false;
                        return (
                          <tr key={field.name}>
                            <td className="align-top bg-slate-50/90">
                              <label
                                htmlFor={fid}
                                className="block text-xs font-extrabold uppercase tracking-wide text-[var(--text-main)]"
                              >
                                {field.label || field.name}
                                {field.required ? <span className="text-red-600"> *</span> : null}
                                {aiFilled ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" aria-label="AI filled" /> : null}
                              </label>
                            </td>
                            <td className="align-top">
                              {React.createElement(FieldRenderer, {
                                layout: 'tableCell',
                                field,
                                value: values[field.name] ?? '',
                                onChange: handleCategoryFieldChange(field.name, compactCardIdx, card.cardId || null),
                                showError: touched && field.required && activeValidationErrors.has(field.name),
                                item: cardItem,
                                onCategoryAiRunningChange: notifyCategoryAiRunning,
                                nosposMappings,
                                onAiFilled: () => {
                                  setAiFilledFieldKeys((prev) => {
                                    const next = new Set(prev);
                                    next.add(buildCardFieldKey(compactCardIdx, field.name));
                                    return next;
                                  });
                                },
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {isAdded &&
            !categoryReloading &&
            requiredCategoryFields.length > 0 &&
            hasRequiredCategoryComplete &&
            (card?.fields || []).some((field) => field?.name && activeValidationErrors.has(field.name)) ? (
              <div
                className="border-b border-amber-200 bg-amber-50 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold leading-snug text-amber-950">
                    You&apos;ve set the category for this item, but NoSpos still needs required fields.
                  </p>
                  <p className="text-xs font-semibold text-amber-900">
                    AI help runs automatically when available. You can still edit required fields manually below.
                  </p>
                </div>
              </div>
            ) : null}

            {categoryReloading ? (
              <div className="border-b border-[var(--ui-border)] bg-white px-4 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
                  <span className="text-xs font-bold text-[var(--brand-blue)]">
                    Waiting for NoSpos to reload category fields…
                  </span>
                </div>
              </div>
            ) : hasRequiredCategoryComplete ? (
              <div
                className="border-b border-[var(--ui-border)] bg-white px-4 py-3"
                data-prefill-step-ver={prefillStepVersion}
              >
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    Required fields are auto-prefilled from negotiation first, then AI help runs automatically
                    for anything still missing.
                  </p>
                  {aiRunningForRow ? (
                    <p className="text-xs font-semibold text-[var(--brand-blue)]">
                      Running AI help…
                    </p>
                  ) : null}
                  {Number.isInteger(compactCardIdx) && aiManualFallbackCards.has(compactCardIdx) && rowHasMissingRequired ? (
                    <p className="text-xs font-medium text-amber-800">
                      AI could not complete this row. Enter the remaining values manually — every field
                      below stays editable.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!categoryReloading && hasRequiredCategoryComplete ? (
              <div className="p-4">
                {requiredOtherFields.length > 0 ? (
                  <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--ui-border)] bg-white">
                    <table className="spreadsheet-table w-full min-w-[20rem] border-collapse text-left spreadsheet-table--static-header">
                      <thead>
                        <tr>
                          <th className="w-[32%] max-w-[14rem]">Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requiredOtherFields.map((field) => {
                          const fid = getMirrorFieldControlId(field);
                          const aiFilled = Number.isInteger(compactCardIdx)
                            ? aiFilledFieldKeys.has(buildCardFieldKey(compactCardIdx, field.name))
                            : false;
                          return (
                            <tr key={field.name}>
                              <td className="align-top bg-slate-50/90">
                                <label
                                  htmlFor={fid}
                                  className="block text-xs font-extrabold uppercase tracking-wide text-[var(--text-main)]"
                                >
                                  {field.label || field.name}
                                  {field.required ? <span className="text-red-600"> *</span> : null}
                                  {aiFilled ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" aria-label="AI filled" /> : null}
                                </label>
                              </td>
                              <td className="align-top">
                                {React.createElement(FieldRenderer, {
                                  layout: 'tableCell',
                                  field,
                                  value: values[field.name] ?? '',
                                  onChange: handleFieldChange(field.name, compactCardIdx, card.cardId || null),
                                  showError: touched && field.required && activeValidationErrors.has(field.name),
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-sm text-[var(--text-main)]">
              {autoAddSelectedIfMissing
                ? 'This item has not been added to NoSpos yet. We are adding it to NoSpos automatically and will continue when the page refreshes.'
                : 'This item has not been added to NoSpos yet. Add it from the row action to continue.'}
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-blue)]">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-blue-alpha-15)] border-t-[var(--brand-blue)]" aria-hidden />
              {canAddThisRow
                ? 'Adding this item now…'
                : Number.isInteger(compactCardIdx) && compactCardIdx < addedCardCount
                  ? 'This item is already in NoSpos.'
                  : 'Waiting for previous item to finish.'}
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
