import React from 'react';
import RequestItemTestingPassedCheckbox from './RequestItemTestingPassedCheckbox';

/**
 * Per-line testing gate in request view: toggles while BOOKED_FOR_TESTING, read-only after COMPLETE.
 * Uses the same {@link TableCheckbox} styling as repricing session tables.
 * Removed lines do not participate (parent footer ignores them).
 */
export default function TestingPassedCell({
  item,
  /** null = column not shown (parent omits th/td) */
  columnMode,
  onToggle,
  saving,
}) {
  if (!columnMode) return null;

  const requestItemId = item.request_item_id ?? item.id;
  const isRemoved = Boolean(item.isRemoved);
  const checked = Boolean(item.testingPassed);
  const isSaving = saving != null && saving === requestItemId;

  if (isRemoved) {
    return (
      <td className="align-middle text-center text-[11px] text-gray-400 tabular-nums" aria-label="Not applicable">
        —
      </td>
    );
  }

  const ariaLabel =
    columnMode === 'complete'
      ? checked
        ? 'Testing passed'
        : 'Testing not recorded'
      : `Testing passed for line ${requestItemId}`;

  return (
    <td className="align-middle text-center px-2 py-2">
      <RequestItemTestingPassedCheckbox
        checked={checked}
        readOnly={columnMode === 'complete'}
        disabled={isSaving}
        onCheckedChange={(next) => onToggle?.(item, next)}
        aria-label={ariaLabel}
      />
    </td>
  );
}
