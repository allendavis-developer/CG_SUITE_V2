import React from 'react';
import { isNegotiationPriceSourceZone } from '../rowContextZones';

const DEFAULT_REMOVE_LABEL = 'Remove from negotiation';

/**
 * Right-click menu for spreadsheet rows. Actions depend on {@link NEGOTIATION_ROW_CONTEXT} `zone`.
 */
export default function NegotiationRowContextMenu({
  x,
  y,
  zone,
  onClose,
  onRemove,
  /** No args — parent closes over `item` and `zone` from menu state. */
  onUseAsRrpOffersSource,
  removeLabel = DEFAULT_REMOVE_LABEL,
}) {
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const showUseAsRrp = isNegotiationPriceSourceZone(zone) && onUseAsRrpOffersSource;
  const showDividerBeforeRemove = showUseAsRrp;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] py-1 border shadow-xl bg-white rounded-lg"
      style={{ left: x, top: y, borderColor: 'var(--ui-border)' }}
    >
      {showUseAsRrp && (
        <button
          type="button"
          className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-brand-blue/5 transition-colors flex items-center gap-2"
          style={{ color: 'var(--brand-blue)' }}
          onClick={() => {
            onUseAsRrpOffersSource();
            onClose();
          }}
        >
          <span className="material-symbols-outlined text-[16px]">price_check</span>
          Use as RRP/offers source
        </button>
      )}
      {showDividerBeforeRemove && (
        <div className="border-t my-1" style={{ borderColor: 'var(--ui-border)' }} />
      )}
      <button
        type="button"
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-2 text-red-600"
        onClick={() => {
          onRemove();
          onClose();
        }}
      >
        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
        {removeLabel}
      </button>
    </div>
  );
}
