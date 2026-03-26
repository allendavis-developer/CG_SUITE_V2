import React from 'react';

const BLUE_TINT_BG = 'var(--brand-blue-alpha-08)';
const BLUE_TINT_STRONG = 'var(--brand-blue-alpha-14)';
const BLUE_BORDER = 'var(--brand-blue-alpha-18)';
const BLUE_ROW_DIVIDER = 'var(--brand-blue-alpha-10)';
const BLUE_PANEL_SHADOW = 'var(--brand-shadow-panel)';

function ValueCell({ value, valueVariant }) {
  if (valueVariant === 'boolean') {
    const isTrue = value === 'true';
    return (
      <span
        className="inline-block rounded-md border px-2.5 py-1 text-sm font-bold tabular-nums"
        style={{
          background: isTrue ? BLUE_TINT_STRONG : BLUE_TINT_BG,
          borderColor: BLUE_BORDER,
          color: 'var(--brand-blue)',
        }}
      >
        {isTrue ? 'true' : 'false'}
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--brand-blue)' }}>
      {value}
    </span>
  );
}

/**
 * Summary of the non-active research channel(s). Uses --brand-blue and blue tints only.
 * @param {'inline' | 'popover'} [variant='inline'] — `inline` flows with listing cards; `popover` is the legacy anchored popup.
 */
export default function ResearchOthersModal({ summaries, className = '', variant = 'inline' }) {
  if (!summaries?.blocks?.length) return null;

  const isPopover = variant === 'popover';
  const shellClass = isPopover
    ? `absolute z-[200] flex w-[min(calc(100vw-1.5rem),22rem)] min-w-[14rem] flex-col overflow-visible rounded-xl border-2 bg-white shadow-2xl ${className}`
    : `flex w-full min-w-0 flex-col rounded-xl border-2 bg-white shadow-md ${className}`;

  return (
    <div
      role={isPopover ? 'dialog' : 'region'}
      aria-modal={isPopover ? 'true' : undefined}
      aria-labelledby="research-others-title"
      className={shellClass}
      style={{
        borderColor: BLUE_BORDER,
        boxShadow: isPopover ? BLUE_PANEL_SHADOW : undefined,
      }}
    >
      <div
        className="w-full shrink-0 border-b px-4 py-3.5"
        style={{
          background: 'var(--brand-blue)',
          borderColor: BLUE_BORDER,
        }}
      >
        <h2
          id="research-others-title"
          className="text-xs font-black uppercase tracking-[0.14em] text-white"
        >
          Other data
        </h2>
      </div>
      <div className="w-full flex-1">
        <div className="flex min-w-0 w-full flex-col">
          {summaries.blocks.map((b, blockIdx) => (
            <section
              key={`${b.title}-${blockIdx}`}
              className={`min-w-0 px-3 py-3 sm:px-4 ${blockIdx > 0 ? 'border-t' : ''}`}
              style={{
                borderColor: BLUE_BORDER,
                background: BLUE_TINT_BG,
              }}
            >
              <h3
                className="mb-3 rounded-md px-3 py-2.5 text-xs font-black uppercase tracking-wider"
                style={{
                  color: 'var(--brand-blue)',
                  background: 'rgba(255, 255, 255, 0.85)',
                  border: `1px solid ${BLUE_BORDER}`,
                }}
              >
                {b.title}
              </h3>
              <table className="w-full border-collapse table-fixed">
                <tbody>
                  {b.rows.map((r, idx) => (
                    <tr
                      key={`${b.title}-${r.metric}-${r.kind}-${idx}`}
                      className="border-b last:border-0"
                      style={{ borderColor: BLUE_ROW_DIVIDER }}
                    >
                      <td
                        className="w-1/2 py-1.5 pr-2 align-middle text-sm font-medium leading-snug break-words"
                        style={{ color: 'var(--text-muted, #475569)' }}
                      >
                        {r.metric}
                      </td>
                      <td className="w-1/2 py-1.5 text-right align-middle">
                        <ValueCell value={r.value} valueVariant={r.valueVariant} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
