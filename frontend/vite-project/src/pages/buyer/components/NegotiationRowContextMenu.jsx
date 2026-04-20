import React from 'react';
import { isNegotiationPriceSourceZone } from '../rowContextZones';

const DEFAULT_REMOVE_LABEL = 'Remove from negotiation';

/**
 * @typedef {object} GetDataFromDatabaseMenu
 * @property {string} menuLabel
 * @property {string} flyoutTitle
 * @property {string} loadingLabel
 * @property {Array<{ category_id: string|number, name: string }>} categories
 * @property {(categoryId: string|number) => void} onPickCategory
 */

/**
 * Right-click menu for spreadsheet rows. Actions depend on {@link NEGOTIATION_ROW_CONTEXT} `zone`.
 * @param {GetDataFromDatabaseMenu | null | undefined} getDataFromDatabase — Upload: hover flyout + open builder top category.
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
  getDataFromDatabase = null,
}) {
  const menuRef = React.useRef(null);
  const [dbFlyoutOpen, setDbFlyoutOpen] = React.useState(false);

  React.useEffect(() => {
    setDbFlyoutOpen(false);
  }, [x, y, zone]);

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
  const showGetDataDb = Boolean(getDataFromDatabase);
  const showDividerBeforeDb = showUseAsRrp && showGetDataDb;
  const showDividerBeforeRemove = showUseAsRrp || showGetDataDb;

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
      {showDividerBeforeDb && (
        <div className="border-t my-1" style={{ borderColor: 'var(--ui-border)' }} />
      )}
      {showGetDataDb && (
        <div
          className="relative"
          onMouseEnter={() => setDbFlyoutOpen(true)}
          onMouseLeave={() => setDbFlyoutOpen(false)}
        >
          <div
            className="flex w-full cursor-default items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            role="menuitem"
          >
            <span className="material-symbols-outlined text-[16px] text-brand-blue">database</span>
            <span className="flex-1">{getDataFromDatabase.menuLabel}</span>
            <span className="material-symbols-outlined text-[16px] text-slate-400">chevron_right</span>
          </div>
          {dbFlyoutOpen ? (
            <div
              className="absolute left-full top-0 z-[60] ml-1 w-[min(22rem,calc(100vw-4rem))] rounded-lg border border-slate-200 bg-white py-2 shadow-xl"
              onMouseEnter={() => setDbFlyoutOpen(true)}
              onMouseLeave={() => setDbFlyoutOpen(false)}
            >
              <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                {getDataFromDatabase.flyoutTitle}
              </p>
              {!getDataFromDatabase.categories?.length ? (
                <p className="px-3 py-2 text-xs text-slate-500">{getDataFromDatabase.loadingLabel}</p>
              ) : (
                <ul className="max-h-[min(22rem,50vh)] overflow-y-auto">
                  {getDataFromDatabase.categories.map((cat) => (
                    <li key={String(cat.category_id)}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand-blue hover:bg-brand-blue/5"
                        onClick={() => {
                          getDataFromDatabase.onPickCategory(cat.category_id);
                          onClose();
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px] shrink-0 opacity-80">folder</span>
                        <span className="min-w-0 truncate">{cat.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
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
