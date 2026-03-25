import React from 'react';

/**
 * Shared dual-handle range sliders for the research form advanced filter panel.
 * Global CSS for `.dual-range-input` is injected by ResearchFormShell on first load.
 */

/** Two-handle price range slider. */
export function DualRangeSlider({ min, max, valueMin, valueMax, onMinChange, onMaxChange, stepOverride = null }) {
  const range = max - min;
  const step = stepOverride != null
    ? stepOverride
    : range > 500 ? 5 : range > 100 ? 1 : range > 20 ? 0.5 : 0.01;
  const pctMin = range > 0 ? ((valueMin - min) / range) * 100 : 0;
  const pctMax = range > 0 ? ((valueMax - min) / range) * 100 : 100;

  return (
    <div className="px-1 select-none">
      <div className="relative h-8 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 bg-gray-200 rounded-full pointer-events-none" />
        <div
          className="absolute h-1.5 bg-brand-blue rounded-full pointer-events-none"
          style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
        />
        <input
          type="range" min={min} max={max} step={step} value={valueMin}
          onChange={e => { const v = parseFloat(e.target.value); if (v < valueMax) onMinChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 3 }}
        />
        <input
          type="range" min={min} max={max} step={step} value={valueMax}
          onChange={e => { const v = parseFloat(e.target.value); if (v > valueMin) onMaxChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          £{valueMin.toFixed(2)}
        </span>
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          £{valueMax.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function formatSoldDateMs(ms) {
  if (!Number.isFinite(ms)) return '';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dt = new Date(ms);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** Two-handle date slider in UTC ms, stepping 1 calendar day. */
export function DualDateRangeSlider({ minMs, maxMs, valueMinMs, valueMaxMs, onMinChange, onMaxChange }) {
  const stepMs = 24 * 60 * 60 * 1000;
  const range = maxMs - minMs;
  const pctMin = range > 0 ? ((valueMinMs - minMs) / range) * 100 : 0;
  const pctMax = range > 0 ? ((valueMaxMs - minMs) / range) * 100 : 100;

  return (
    <div className="px-1 select-none">
      <div className="relative h-8 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 bg-gray-200 rounded-full pointer-events-none" />
        <div
          className="absolute h-1.5 bg-brand-blue rounded-full pointer-events-none"
          style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
        />
        <input
          type="range" min={minMs} max={maxMs} step={stepMs} value={valueMinMs}
          onChange={e => { const v = parseFloat(e.target.value); if (v < valueMaxMs) onMinChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 3 }}
        />
        <input
          type="range" min={minMs} max={maxMs} step={stepMs} value={valueMaxMs}
          onChange={e => { const v = parseFloat(e.target.value); if (v > valueMinMs) onMaxChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          {formatSoldDateMs(valueMinMs)}
        </span>
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          {formatSoldDateMs(valueMaxMs)}
        </span>
      </div>
    </div>
  );
}

/** Two-handle discrete (integer) slider for index ranges. */
export function DualIndexRangeSlider({ min, max, valueMin, valueMax, onMinChange, onMaxChange, getLabel }) {
  const range = max - min;
  const pctMin = range > 0 ? ((valueMin - min) / range) * 100 : 0;
  const pctMax = range > 0 ? ((valueMax - min) / range) * 100 : 100;

  return (
    <div className="px-1 select-none">
      <div className="relative h-8 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 bg-gray-200 rounded-full pointer-events-none" />
        <div
          className="absolute h-1.5 bg-brand-blue rounded-full pointer-events-none"
          style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
        />
        <input
          type="range" min={min} max={max} step={1} value={valueMin}
          onChange={e => { const v = parseInt(e.target.value, 10); if (v < valueMax) onMinChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 3 }}
        />
        <input
          type="range" min={min} max={max} step={1} value={valueMax}
          onChange={e => { const v = parseInt(e.target.value, 10); if (v > valueMin) onMaxChange(v); }}
          className="dual-range-input"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          {getLabel(valueMin)}
        </span>
        <span className="text-[11px] font-bold text-brand-blue bg-brand-blue/5 border border-brand-blue/20 rounded px-1.5 py-0.5">
          {getLabel(valueMax)}
        </span>
      </div>
    </div>
  );
}
