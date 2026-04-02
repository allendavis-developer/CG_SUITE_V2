import React from 'react';
import { TableCheckbox } from '@/components/ui/components';

/**
 * Repricing-style {@link TableCheckbox} for request-line testing passed (booked = editable, complete = read-only).
 */
export default function RequestItemTestingPassedCheckbox({
  checked,
  /** BOOKED_FOR_TESTING: user can toggle */
  readOnly = false,
  disabled = false,
  onCheckedChange,
  'aria-label': ariaLabel,
}) {
  const locked = readOnly || disabled;

  return (
    <div className="inline-flex items-center justify-center">
      <TableCheckbox
        checked={Boolean(checked)}
        disabled={locked}
        aria-label={ariaLabel}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
    </div>
  );
}
