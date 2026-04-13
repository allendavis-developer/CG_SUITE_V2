import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { priceSourceZoneShortLabel } from '../utils/negotiationHelpers';

/**
 * Compact cell: shows current source label; click opens a portaled menu (avoids table row :hover bleed-through).
 * @param {'negotiate'|'view'} mode
 * @param {string|null} currentZone — NEGOTIATION_ROW_CONTEXT value
 * @param {{ zone: string, label: string }[]} options
 * @param {(zone: string) => void} onSelectZone
 */
export default function NegotiationPriceSourcePickerCell({
  mode,
  currentZone,
  options = [],
  onSelectZone,
  titlePrefix = 'Source',
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  const updateMenuPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const label = currentZone ? priceSourceZoneShortLabel(currentZone) : '—';
  const canPick = mode === 'negotiate' && options.length > 0 && typeof onSelectZone === 'function';

  const menuPortal =
    open && options.length > 0
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[280] min-w-[10rem] rounded-lg border border-[var(--ui-border)] bg-white py-1 shadow-xl"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              transform: 'translateX(-50%)',
            }}
            role="menu"
          >
            {options.map(({ zone, label: optLabel }) => (
              <button
                key={zone}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-brand-blue/5"
                style={{ color: 'var(--brand-blue)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectZone(zone);
                  close();
                }}
              >
                <span className="material-symbols-outlined text-[16px]">price_check</span>
                {optLabel}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  if (mode === 'view') {
    return (
      <td className="align-top text-center text-[11px] font-semibold text-gray-700">
        {label}
      </td>
    );
  }

  return (
    <td className="align-top p-0" style={{ verticalAlign: 'middle' }}>
      <div className="px-1 py-1">
        <button
          ref={anchorRef}
          type="button"
          disabled={!canPick}
          onClick={(e) => {
            e.stopPropagation();
            if (!canPick) return;
            setOpen((v) => !v);
          }}
          title={
            canPick
              ? `${titlePrefix}: ${label}. Click to change.`
              : 'No other scraped sources available for this row.'
          }
          className={`flex w-full min-h-[2.25rem] items-center justify-center rounded-md px-2 py-1.5 text-center text-[11px] font-extrabold uppercase tracking-wide transition-colors ${
            canPick
              ? 'border border-dashed border-gray-300 bg-gray-50 text-brand-blue hover:bg-brand-blue/5'
              : 'cursor-default border border-transparent text-gray-400'
          }`}
        >
          {label}
        </button>
        {menuPortal}
      </div>
    </td>
  );
}
