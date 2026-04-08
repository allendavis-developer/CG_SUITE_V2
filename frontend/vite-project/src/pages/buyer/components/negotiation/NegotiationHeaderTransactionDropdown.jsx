import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Select for the negotiation metrics strip (dark text trigger, white menu).
 */
export default function NegotiationHeaderTransactionDropdown({ value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const wrapRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        setMenuPos({
          top: r.bottom + 4,
          left: r.left,
          width: Math.max(r.width, 168),
        });
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = options.filter((o) => o !== value);
  const menu =
    open &&
    menuPos &&
    filtered.length > 0 &&
    createPortal(
      <div
        ref={menuRef}
        className="cg-portal-dropdown-menu cg-animate-modal-panel fixed z-[9999] max-h-60 overflow-y-auto rounded-lg border border-gray-200/90 bg-white py-1 shadow-lg"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, minWidth: 168 }}
      >
        {filtered.map((opt) => (
          <button
            key={opt}
            type="button"
            className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
            onClick={() => {
              onChange(opt);
              setOpen(false);
            }}
          >
            {opt}
          </button>
        ))}
      </div>,
      document.body
    );

  return (
    <div ref={wrapRef} className="flex min-w-0">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex h-9 min-w-[9rem] max-w-[14rem] items-center justify-between gap-2 border-0 bg-transparent px-2.5 text-left text-sm font-semibold text-brand-blue outline-none transition-colors hover:bg-gray-100/90 focus-visible:bg-gray-100/90 focus-visible:ring-2 focus-visible:ring-brand-blue/30 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <span
          className={`material-symbols-outlined shrink-0 text-[22px] text-brand-blue/55 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>
      {menu}
    </div>
  );
}
