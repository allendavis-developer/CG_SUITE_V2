import React from 'react';
import useAppStore, { useOfferMetricDisplay } from '@/store/useAppStore';

/**
 * Segmented toggle for offer metric display: "Margin" vs "% sale".
 * Reads + writes the global offerMetricDisplay state.
 * variant="dark" styles for brand-blue strip (white-on-blue).
 */
export default function OfferMetricToggle({ className = '', size = 'md', variant = 'light' }) {
  const value = useOfferMetricDisplay();
  const setOfferMetricDisplay = useAppStore((s) => s.setOfferMetricDisplay);

  const isMargin = value === 'margin';

  const sizeClasses =
    size === 'sm'
      ? 'text-[10px] px-3'
      : 'text-[11px] px-3.5';

  const isDark = variant === 'dark';
  const wrapperClasses = isDark
    ? 'inline-flex h-9 shrink-0 items-stretch rounded-md border border-white/25 bg-white/10 p-0.5'
    : 'inline-flex h-8 shrink-0 items-stretch rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm';

  const activeClasses = isDark
    ? 'bg-white text-brand-blue shadow-sm'
    : 'bg-brand-blue text-white shadow-sm';
  const inactiveClasses = isDark
    ? 'text-white/80 hover:text-white'
    : 'text-gray-500 hover:text-brand-blue';

  const buttonBase = isDark ? 'rounded-[4px]' : 'rounded-[6px]';

  return (
    <div
      className={`${wrapperClasses} ${className}`.trim()}
      role="group"
      aria-label="Offer metric display"
    >
      <button
        type="button"
        onClick={() => setOfferMetricDisplay('margin')}
        aria-pressed={isMargin}
        className={`flex flex-1 items-center justify-center font-bold uppercase tracking-wider transition-colors ${buttonBase} ${sizeClasses} ${
          isMargin ? activeClasses : inactiveClasses
        }`}
      >
        Margin
      </button>
      <button
        type="button"
        onClick={() => setOfferMetricDisplay('pctOfSale')}
        aria-pressed={!isMargin}
        className={`flex flex-1 items-center justify-center font-bold uppercase tracking-wider transition-colors ${buttonBase} ${sizeClasses} ${
          !isMargin ? activeClasses : inactiveClasses
        }`}
      >
        % Sale
      </button>
    </div>
  );
}
