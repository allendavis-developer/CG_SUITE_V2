import React, { useRef, useEffect } from 'react';

const ListingCard = React.memo(function ListingCard({ item, origIdx, sortedIdx, displayIdx, onExcludeClick, onExcludeContextMenu, showExcludeButton, readOnly, isPivot }) {
  const handleExcludeClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExcludeClick?.(sortedIdx);
  };
  const handleExcludeContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExcludeContextMenu?.(e, sortedIdx);
  };
  const animDelay = Math.min(displayIdx * 8, 80);
  const hasPlayedEntryAnimationRef = useRef(false);
  useEffect(() => {
    hasPlayedEntryAnimationRef.current = true;
  }, []);
  const entryAnimationStyle = !hasPlayedEntryAnimationRef.current && animDelay > 0
    ? { animationDelay: `${animDelay}ms`, opacity: 0, animation: 'fadeInUp 0.25s ease-out forwards' }
    : undefined;
  return (
    <div className={`relative group ${item.excluded ? 'opacity-60' : ''}`} onContextMenu={handleExcludeContextMenu}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex gap-4 rounded-xl border p-4 hover:shadow-md transition-[background-color,border-color,box-shadow] duration-150 ${
          item.excluded ? 'bg-orange-50/60 border-orange-300' : 'bg-white border-gray-200'
        }`}
        style={entryAnimationStyle}
      >
        <div className="w-32 h-32 bg-gray-200 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
          {item.image ? (
            <img src={item.image} alt={item.title || "listing"} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <span className="text-xs text-gray-500">No image</span>
          )}
        </div>
        <div className="flex flex-col justify-between flex-1 min-w-0">
          <div>
            <h4 className="text-sm font-bold text-brand-blue line-clamp-2 leading-tight cursor-pointer hover:underline">{item.title}</h4>
            {item.shop && <p className="text-[11px] text-gray-500 mt-0.5">Shop: {item.shop}</p>}
            {item.sold && <p className="text-[11px] text-green-600 font-bold mt-1">{item.sold}</p>}
            {item.sellerInfo && (
              <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                <span className="font-medium text-gray-500">Seller:</span> {item.sellerInfo}
              </p>
            )}
          </div>
          <div className="flex items-end justify-between mt-2">
            <p className="text-lg font-extrabold text-gray-900 leading-none">£{item.price}</p>
            {item.itemId && <span className="text-[9px] text-gray-400 font-mono tabular-nums">#{item.itemId}</span>}
          </div>
        </div>
      </a>
      {item.excluded && (
        <div className="absolute top-2 left-3 z-10 pointer-events-none">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 tracking-wider border border-orange-200">Excluded</span>
        </div>
      )}
      {showExcludeButton && (
        <button
          className={`absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-[background-color,border-color,color,box-shadow] duration-75 ${
            isPivot ? 'bg-brand-blue text-white shadow-md ring-2 ring-brand-blue/35' : item.excluded ? 'bg-orange-500 text-white shadow-sm hover:bg-orange-600' : 'bg-white text-gray-600 border border-gray-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-300'
          }`}
          onClick={handleExcludeClick}
          title={isPivot ? 'Click to exclude · Click another item to select range' : item.excluded ? 'Click to re-include' : 'Click to set pivot'}
          aria-label={item.excluded ? 'Re-include listing in stats' : 'Exclude listing from stats'}
        >
          <span className="material-symbols-outlined text-[14px]">{isPivot ? 'swap_vert' : item.excluded ? 'undo' : 'block'}</span>
          <span>{isPivot ? 'Pivot' : item.excluded ? 'Excluded' : 'Exclude'}</span>
        </button>
      )}
    </div>
  );
});

export default ListingCard;
