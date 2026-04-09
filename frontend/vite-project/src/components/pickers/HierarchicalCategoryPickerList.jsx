import React, { useMemo, useRef, useEffect } from 'react';

export function categoryPickerDisplayName(cat) {
  return cat?.name ?? '';
}

/**
 * Search + scrollable table for one level or global "all nodes" search (same UX as eBay research category step).
 *
 * @param {(nodes: object[]) => object[]} filterChildren - applied to `items` children counts and global walk
 * @param {number|string|null} currentSelectionCategoryId - optional highlight for the active node id (`category_id`)
 */
export default function HierarchicalCategoryPickerList({
  items,
  isLoading,
  onSelect,
  query,
  setQuery,
  statsHeading,
  entitySingular = 'category',
  entityPlural = 'categories',
  aiSuggestion = null,
  onSkip = null,
  onClose = null,
  globalSearchEntries = null,
  onPickGlobalSearch = null,
  filterChildren = (x) => x,
  currentSelectionCategoryId = null,
}) {
  const searchRef = useRef(null);

  const searchQ = query.trim().toLowerCase();
  const isGlobalSearch = Boolean(searchQ && globalSearchEntries?.length && onPickGlobalSearch);

  useEffect(() => {
    if (isLoading) return;
    if (items.length > 0 || (globalSearchEntries && globalSearchEntries.length > 0)) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [isLoading, items.length, globalSearchEntries?.length]);

  const filteredLevelItems = useMemo(() => {
    if (!searchQ) return items;
    return items.filter((c) => {
      const name = String(c.name || '').toLowerCase();
      const label = categoryPickerDisplayName(c).toLowerCase();
      return name.includes(searchQ) || label.includes(searchQ);
    });
  }, [items, searchQ]);

  const filteredGlobalEntries = useMemo(() => {
    if (!searchQ || !globalSearchEntries?.length) return [];
    const matches = globalSearchEntries.filter((entry) => {
      const name = String(entry.node?.name || '').toLowerCase();
      if (name.includes(searchQ)) return true;
      if (entry.pathNames.some((p) => String(p).toLowerCase().includes(searchQ))) return true;
      return entry.pathNames.join(' ').toLowerCase().includes(searchQ);
    });
    matches.sort((a, b) =>
      a.pathNames.join('\u0000').localeCompare(b.pathNames.join('\u0000'), undefined, { sensitivity: 'base' })
    );
    return matches;
  }, [globalSearchEntries, searchQ]);

  const visibleRows = isGlobalSearch ? filteredGlobalEntries : filteredLevelItems;

  const isRowCurrent = (categoryId) =>
    currentSelectionCategoryId != null &&
    categoryId != null &&
    Number(categoryId) === Number(currentSelectionCategoryId);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-gray-500">
        <span className="material-symbols-outlined animate-spin text-2xl text-brand-blue">sync</span>
        <p className="text-xs">Loading categories…</p>
      </div>
    );
  }

  const listHeading = isGlobalSearch ? 'Search results' : statsHeading;
  const countLabel = isGlobalSearch
    ? `${filteredGlobalEntries.length} match${filteredGlobalEntries.length === 1 ? '' : 'es'} of ${globalSearchEntries.length} ${entityPlural}`
    : filteredLevelItems.length === items.length
      ? `${items.length} ${items.length === 1 ? entitySingular : entityPlural}`
      : `${filteredLevelItems.length} match${filteredLevelItems.length === 1 ? '' : 'es'} of ${items.length}`;

  const rowMinH = 'min-h-[2.75rem]';
  const sharedText = 'text-xs font-semibold leading-snug sm:text-sm';

  const showSuggestionBar = Boolean(aiSuggestion || onSkip || onClose);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {showSuggestionBar ? (
        <div
          className={`flex w-full shrink-0 items-stretch gap-2 border-b border-brand-blue/20 bg-brand-blue/[0.07] px-2 py-1.5 sm:gap-2.5 sm:px-3 sm:py-2 ${aiSuggestion ? '' : 'justify-end'}`}
        >
          {aiSuggestion ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center" aria-live="polite">
              {aiSuggestion.phase === 'running' ? (
                <div
                  className={`flex ${rowMinH} items-center gap-1.5 rounded-md border border-transparent px-2 text-brand-blue ${sharedText}`}
                >
                  <span
                    className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-blue border-t-transparent"
                    aria-hidden
                  />
                  Finding suggested category…
                </div>
              ) : null}
              {aiSuggestion.phase === 'ready' && aiSuggestion.breadcrumb ? (
                <button
                  type="button"
                  onClick={aiSuggestion.onConfirm}
                  className={`flex ${rowMinH} w-full cursor-pointer items-center gap-2 rounded-md border border-brand-blue bg-brand-blue px-2 text-left text-xs font-semibold leading-snug text-white shadow-sm transition-colors hover:bg-brand-blue-hover sm:px-3 sm:text-sm`}
                  aria-label={`Use suggested category: ${aiSuggestion.breadcrumb}`}
                >
                  <span className="shrink-0 whitespace-nowrap uppercase tracking-wide text-white">
                    Suggested
                  </span>
                  <span className="min-w-0 flex-1 truncate text-white">
                    {aiSuggestion.breadcrumb}
                  </span>
                  <span className="material-symbols-outlined shrink-0 text-[18px] leading-none text-white/90">chevron_right</span>
                </button>
              ) : null}
              {aiSuggestion.phase === 'error' && aiSuggestion.message ? (
                <p className={`${rowMinH} flex items-center px-2 text-amber-900 ${sharedText}`}>{aiSuggestion.message}</p>
              ) : null}
            </div>
          ) : null}
          {(onSkip || onClose) ? (
            <div className="flex shrink-0 items-stretch gap-2">
              {onSkip ? (
                <button
                  type="button"
                  onClick={onSkip}
                  className={`flex ${rowMinH} shrink-0 items-center justify-center self-stretch rounded-md border-2 border-gray-500 bg-white px-3 font-bold text-gray-900 shadow-sm transition-colors hover:border-brand-blue hover:bg-brand-blue/5 hover:text-brand-blue sm:px-4 ${sharedText}`}
                >
                  Skip — default margins
                </button>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close research"
                  title="Close research"
                  className={`flex ${rowMinH} min-w-[2.75rem] shrink-0 items-center justify-center self-stretch rounded-md bg-red-500 px-3 text-white shadow-sm transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400/70 focus:ring-offset-2 focus:ring-offset-white`}
                >
                  <span className="material-symbols-outlined text-[20px] leading-none">close</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="shrink-0 border-b border-gray-200 bg-white px-2 py-2 sm:px-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-gray-400">search</span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (isGlobalSearch) {
                if (filteredGlobalEntries.length === 1) onPickGlobalSearch(filteredGlobalEntries[0]);
              } else if (filteredLevelItems.length === 1) {
                onSelect(filteredLevelItems[0]);
              }
            }}
            placeholder="Search categories…"
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-xs text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-orange sm:text-sm"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600">
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] leading-tight text-gray-600">
          <span className="min-w-0 shrink font-bold uppercase tracking-wide text-gray-500">{listHeading}</span>
          <span className="shrink-0 tabular-nums">
            <span className="font-semibold text-brand-blue">{countLabel}</span>
          </span>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]">
        {visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-gray-500">
            <span className="material-symbols-outlined mb-2 text-3xl text-gray-400">{query.trim() ? 'search_off' : 'category'}</span>
            {query.trim() ? (
              <>
                <p className="text-xs font-semibold text-gray-800">No matches</p>
                <p className="mt-0.5 max-w-sm text-xs text-gray-600">Try different keywords or clear the search.</p>
              </>
            ) : (
              <p className="text-xs font-semibold text-gray-800">Nothing to show</p>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-xs sm:text-sm">
            <tbody>
              {isGlobalSearch
                ? filteredGlobalEntries.map((entry, i) => {
                    const names = entry.pathNames;
                    const ancestors = names.slice(0, -1);
                    const leaf = names.length > 0 ? names[names.length - 1] : '';
                    const subCount = filterChildren(entry.node.children || []).length;
                    const current = isRowCurrent(entry.node.category_id);
                    return (
                      <tr
                        key={`${entry.node.category_id}-${i}`}
                        onClick={() => onPickGlobalSearch(entry)}
                        className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'} ${current ? 'bg-blue-50 ring-1 ring-inset ring-brand-blue/25' : ''}`}
                      >
                        <td className="px-2 py-1.5 pl-3 leading-snug sm:px-3 sm:py-2">
                          <span className="text-gray-900">
                            {ancestors.length > 0 ? (
                              <span className="text-gray-500">{ancestors.join(' › ')} › </span>
                            ) : null}
                            <span className="font-medium">{leaf}</span>
                            {subCount > 0 ? (
                              <span className="ml-1.5 text-[10px] font-normal text-gray-400 sm:text-[11px]">
                                {subCount} sub-{subCount === 1 ? 'category' : 'categories'}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="w-8 px-1 py-1.5 text-right sm:w-9 sm:px-2 sm:py-2">
                          <span className="material-symbols-outlined align-middle text-[18px] text-gray-400 sm:text-[19px]">chevron_right</span>
                        </td>
                      </tr>
                    );
                  })
                : filteredLevelItems.map((cat, i) => {
                    const subCount = filterChildren(cat.children || []).length;
                    const current = isRowCurrent(cat.category_id);
                    return (
                      <tr
                        key={cat.category_id}
                        onClick={() => onSelect(cat)}
                        className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'} ${current ? 'bg-blue-50 ring-1 ring-inset ring-brand-blue/25' : ''}`}
                      >
                        <td className="px-2 py-1.5 pl-3 font-medium leading-snug text-gray-900 sm:px-3 sm:py-2">
                          {categoryPickerDisplayName(cat)}
                          {subCount > 0 ? (
                            <span className="ml-1.5 text-[10px] font-normal text-gray-400 sm:text-[11px]">
                              {subCount} sub-{subCount === 1 ? 'category' : 'categories'}
                            </span>
                          ) : null}
                        </td>
                        <td className="w-8 px-1 py-1.5 text-right sm:w-9 sm:px-2 sm:py-2">
                          <span className="material-symbols-outlined align-middle text-[18px] text-gray-400 sm:text-[19px]">chevron_right</span>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
