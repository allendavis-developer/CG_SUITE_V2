import React, { useEffect, useRef } from 'react';

export const OfferCard = ({ title, price, margin, isHighlighted, onClick, size = 'default' }) => {
  const compact = size === 'compact';
  return (
    <div
      onClick={onClick}
      className={`
        ${compact ? 'p-3 h-full min-h-0 flex flex-col justify-center' : 'p-5'} rounded-xl bg-white cursor-pointer text-center relative overflow-hidden group
        border transition-all duration-200 ease-out select-none
        ${
          isHighlighted
            ? `border-brand-blue shadow-lg shadow-brand-blue/10
               ring-2 ring-brand-blue/20 ring-offset-1 ring-offset-white
               hover:border-emerald-500 hover:bg-emerald-50/50 hover:shadow-emerald-200/60
               ${compact ? 'scale-[1.02]' : 'scale-[1.03]'}`
            : `border-slate-200 shadow-sm
               hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-md hover:shadow-emerald-100`
        }
      `}
    >
      <div
        className={`absolute top-0 left-0 w-full transition-all duration-200 ${
          isHighlighted
            ? 'h-[3px] bg-brand-orange'
            : 'h-[2px] bg-slate-200 group-hover:bg-emerald-400 group-hover:h-[3px]'
        }`}
      />

      <h4
        className={`font-bold uppercase tracking-wider ${
          isHighlighted ? 'text-brand-blue' : 'text-slate-500 group-hover:text-emerald-700'
        } ${compact ? 'text-[9px] mb-1.5' : 'text-[10px] mb-3'}`}
      >
        {title}
      </h4>

      <p
        className={`font-extrabold tabular-nums ${
          isHighlighted ? 'text-brand-blue' : 'text-slate-800 group-hover:text-emerald-700'
        } ${compact ? 'text-xl mb-1' : 'text-3xl mb-2'}`}
      >
        {price}
      </p>

      <div className="flex items-center justify-center gap-1">
        <span className="text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide">Margin</span>
        <span
          className={`text-[11px] font-extrabold ${
            isHighlighted ? 'text-brand-orange' : 'text-slate-600 group-hover:text-emerald-600'
          }`}
        >
          {margin}%
        </span>
      </div>
    </div>
  );
};

/**
 * Styled checkbox for use inside table rows and headers.
 * Matches the brand-blue / yellow system palette (same control as repricing session tables).
 *
 * Props: checked, onChange, indeterminate (header "select-all"), disabled (view-only / saving), aria-label
 */
export const TableCheckbox = ({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  'aria-label': ariaLabel,
}) => {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const showChecked = checked || indeterminate;

  return (
    <label
      className={`inline-flex items-center justify-center group ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={disabled ? undefined : onChange}
        aria-label={ariaLabel}
        className="sr-only"
      />
      <span
        className={`
          flex items-center justify-center w-4 h-4 transition-all
          ${
            showChecked
              ? 'bg-brand-blue border-2 border-brand-blue'
              : `bg-white border-2 border-black ${disabled ? '' : 'group-hover:border-brand-blue'}`
          }
          ${disabled ? 'opacity-80' : ''}
        `}
      >
        {checked && !indeterminate && (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-white fill-none stroke-current stroke-[1.5]">
            <polyline points="1 4 3.5 6.5 9 1" />
          </svg>
        )}
        {indeterminate && <span className="block w-2 h-0.5 bg-white rounded" />}
      </span>
    </label>
  );
};
