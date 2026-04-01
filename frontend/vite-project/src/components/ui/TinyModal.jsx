import React from "react";

/** Shared tiny modal shell for negotiation/repricing flows */
const TinyModal = ({
  title,
  onClose,
  children,
  zClass = 'z-[120]',
  panelClassName = '',
  /** When false, panel grows with content; outer overlay scrolls (no inner scroll area). */
  bodyScroll = true,
  closeOnBackdrop = true,
  showCloseButton = true,
}) => (
  <div
    className={`fixed inset-0 ${zClass} flex justify-center ${
      bodyScroll ? 'items-center overflow-hidden' : 'items-start overflow-y-auto py-8'
    }`}
    onMouseDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
  >
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (closeOnBackdrop) onClose?.();
      }}
    />
    <div
      className={`relative mx-4 flex w-full max-w-sm flex-col rounded-2xl bg-white p-6 shadow-2xl ${
        bodyScroll ? 'max-h-[min(92vh,720px)] overflow-hidden' : 'my-2 shrink-0'
      } ${panelClassName}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>{title}</h3>
        {showCloseButton ? (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        ) : null}
      </div>
      <div
        className={
          bodyScroll
            ? 'min-h-0 min-w-0 flex-1 overflow-y-auto'
            : 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
        }
      >
        {children}
      </div>
    </div>
  </div>
);

export default TinyModal;
