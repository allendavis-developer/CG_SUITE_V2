import React from 'react';

/** Square red close control — same shape (rounded-lg) as other header/workspace actions. */
export default function WorkspaceCloseButton({
  onClick,
  title = 'Close',
  className = '',
  disabled = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`
        inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg
        border-0 bg-red-500 text-white shadow-sm
        transition-colors hover:bg-red-600
        focus:outline-none focus:ring-2 focus:ring-red-400/70 focus:ring-offset-2 focus:ring-offset-white
        disabled:cursor-not-allowed disabled:opacity-50
        ${className}
      `}
    >
      <span className="material-symbols-outlined text-[22px] leading-none">close</span>
    </button>
  );
}
