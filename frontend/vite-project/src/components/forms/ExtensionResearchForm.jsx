import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { getDataFromListingPage, getDataFromRefine, cancelListingTab, isExtensionListingFlowAborted } from '@/services/extensionClient';
import ResearchFormShell from './ResearchFormShell';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import { calculateStats, calculateBuyOffers } from './researchStats';
import { buildOtherResearchChannelsSummaries } from './researchOtherChannelsSummary';
import useAppStore, { useEbayOfferMargins } from '@/store/useAppStore';
import { fetchAllCategoriesFlat } from '@/services/api';
import { matchCexCategoryNameToDb } from '@/utils/cexCategoryMatch';
import {
  summariseNegotiationItemForAi,
  runAiCategoryCascadeArrayTree,
  runNosposStockCategoryAiMatchBackground,
} from '@/services/aiCategoryPathCascade';

// ─── Category Picker (hierarchical; all DB categories including ready_for_builder=false) ──

/** Build nested `{ category_id, name, children }` from `/all-categories/` (flat) for eBay/CC pickers. */
function flatCategoriesToNestedRoots(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const byId = new Map();
  for (const row of flat) {
    const id = row.category_id;
    if (id == null) continue;
    byId.set(id, {
      category_id: id,
      name: row.name,
      parent_category_id: row.parent_category_id ?? null,
      children: [],
    });
  }
  const roots = [];
  for (const node of byId.values()) {
    const pid = node.parent_category_id;
    if (pid == null || !byId.has(pid)) {
      roots.push(node);
    } else {
      byId.get(pid).children.push(node);
    }
  }
  const sortName = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  function sortRec(n) {
    n.children.sort(sortName);
    n.children.forEach(sortRec);
  }
  roots.sort(sortName);
  roots.forEach(sortRec);
  return roots;
}

/** Placeholder DB row named "eBay" — used for skip/default margins; not listed in the table. */
function withoutEbayPickerPlaceholder(nodes) {
  return (nodes || []).filter((c) => String(c.name || '').trim().toLowerCase() !== 'ebay');
}

/**
 * Every category node with `pathNodes` / `pathNames` from root → node (same object refs as the nested tree).
 * Excludes the eBay placeholder; used for global search across all levels.
 */
function flattenCategoryTreeWithPaths(roots) {
  const rows = [];
  function walk(node, ancestorNodes) {
    const pathNodes = [...ancestorNodes, node];
    rows.push({
      node,
      pathNodes,
      pathNames: pathNodes.map((n) => String(n.name ?? '')),
      category_id: node.category_id,
    });
    const kids = withoutEbayPickerPlaceholder(node.children || []);
    for (const child of kids) {
      walk(child, pathNodes);
    }
  }
  for (const r of withoutEbayPickerPlaceholder(roots || [])) {
    walk(r, []);
  }
  return rows;
}

function resolveSkipCategoryFromFlat(flat) {
  const row = flat.find((c) => String(c.name || '').trim().toLowerCase() === 'ebay');
  if (!row) return null;
  const pathArr = String(row.path || row.name || 'eBay')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: row.category_id,
    name: row.name || 'eBay',
    path: pathArr.length ? pathArr : ['eBay'],
  };
}

function categoryPickerDisplayName(cat) {
  return cat?.name ?? '';
}

/** `aiSuggestion` — top-level only: optional strip above search (spinner / suggested row / error). */
function CategoryPickerList({
  items,
  isLoading,
  onSelect,
  query,
  setQuery,
  statsHeading,
  entitySingular,
  entityPlural,
  aiSuggestion = null,
  onSkip = null,
  onClose = null,
  globalSearchEntries = null,
  onPickGlobalSearch = null,
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
                    const subCount = withoutEbayPickerPlaceholder(entry.node.children || []).length;
                    return (
                      <tr
                        key={entry.node.category_id}
                        onClick={() => onPickGlobalSearch(entry)}
                        className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'}`}
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
                    const subCount = withoutEbayPickerPlaceholder(cat.children || []).length;
                    return (
                      <tr
                        key={cat.category_id}
                        onClick={() => onSelect(cat)}
                        className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'}`}
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

/**
 * Hierarchical category picker shown as a step inside the research form
 * when the item doesn't already have a known category id.
 */
function CategoryPickerStep({
  onSelect,
  onAiNosposStockCategoryReady,
  onClearAiNosposStockCategory,
  registerNosposBackgroundMatch,
  lineItemForAi = null,
  initialSearchQuery = null,
  categoryHint = null,
  onClose = null,
}) {
  const [allCategories, setAllCategories] = useState([]);
  const [skipCategoryPayload, setSkipCategoryPayload] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState([]); // stack of category nodes
  const [query, setQuery] = useState('');
  const [aiSlotPhase, setAiSlotPhase] = useState('waiting');
  const [aiBreadcrumb, setAiBreadcrumb] = useState('');
  const [aiAutoError, setAiAutoError] = useState(null);
  const onSelectRef = useRef(onSelect);
  const aiPendingSelectRef = useRef(null);
  const allCategoriesFlatRef = useRef([]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const itemSummaryForAi = useMemo(() => {
    if (lineItemForAi) return summariseNegotiationItemForAi(lineItemForAi);
    const q = initialSearchQuery != null && String(initialSearchQuery).trim();
    const name =
      (q && String(q).trim()) || categoryHint?.name || 'Unknown item';
    const dbCategory = Array.isArray(categoryHint?.path)
      ? categoryHint.path.join(' > ')
      : categoryHint?.name || null;
    const summary = {
      name: String(name).trim(),
      dbCategory: dbCategory != null && String(dbCategory).trim() !== '' ? String(dbCategory).trim() : null,
      attributes: {},
    };
    console.log('[CG Suite][AiCategory][Picker] fallback summary', { summary, initialSearchQuery, categoryHint });
    return summary;
  }, [lineItemForAi, initialSearchQuery, categoryHint]);

  useEffect(() => {
    let cancelled = false;
    fetchAllCategoriesFlat()
      .then((flat) => {
        if (cancelled) return;
        setLoading(false);
        if (!Array.isArray(flat) || flat.length === 0) {
          setLoadError('Could not load categories.');
          return;
        }
        allCategoriesFlatRef.current = flat;
        setSkipCategoryPayload(resolveSkipCategoryFromFlat(flat));
        setAllCategories(flatCategoriesToNestedRoots(flat));
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError('Could not load categories.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || loadError || !allCategories.length) return;

    let cancelled = false;
    aiPendingSelectRef.current = null;
    setAiSlotPhase('running');
    setAiAutoError(null);
    setAiBreadcrumb('');

    console.log('[CG Suite][AiCategory][Picker] auto-running cascade', {
      itemSummaryForAi,
      rootCount: allCategories.length,
    });

    (async () => {
      try {
        const res = await runAiCategoryCascadeArrayTree({
          rootNodes: allCategories,
          itemSummary: itemSummaryForAi,
          startPath: [],
          logTag: '[CG Suite][AiCategory][ExtensionPicker-auto]',
        });
        console.log('[CG Suite][AiCategory][Picker] auto cascade result', res);
        if (cancelled) return;
        if (!res.success || !res.leaf) {
          setAiSlotPhase('error');
          setAiAutoError(res.error?.message || 'Could not suggest a category. Choose below or use Skip.');
          return;
        }
        const crumb = res.path.join(' › ');
        aiPendingSelectRef.current = {
          id: res.leaf.category_id,
          name: res.leaf.name,
          path: res.path,
        };
        setAiBreadcrumb(crumb);
        setAiSlotPhase('ready');
        console.log('[CG Suite][AiCategory][Picker] suggestion ready — click blue bar to use', {
          breadcrumb: crumb,
          payload: aiPendingSelectRef.current,
        });
      } catch (e) {
        console.log('[CG Suite][AiCategory][Picker] auto cascade exception', e);
        if (cancelled) return;
        setAiSlotPhase('error');
        setAiAutoError(e?.message || 'AI request failed. Choose below or use Skip.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, loadError, allCategories, itemSummaryForAi]);

  const currentLevelItems = useMemo(() => {
    const raw =
      path.length === 0 ? allCategories : path[path.length - 1]?.children || [];
    return withoutEbayPickerPlaceholder(raw);
  }, [path, allCategories]);
  const currentCategory = path.length > 0 ? path[path.length - 1] : null;

  const globalSearchEntries = useMemo(
    () => flattenCategoryTreeWithPaths(allCategories),
    [allCategories]
  );

  const handleSelectItem = (cat) => {
    const kids = withoutEbayPickerPlaceholder(cat.children || []);
    if (kids.length > 0) {
      setPath([...path, cat]);
      setQuery('');
    } else {
      const resolvedPath = [...path.map((p) => p.name), cat.name];
      onSelect({ id: cat.category_id, name: cat.name, path: resolvedPath });
    }
  };

  const handleGlobalSearchPick = useCallback((entry) => {
    const { node, pathNames } = entry;
    const kids = withoutEbayPickerPlaceholder(node.children || []);
    setQuery('');
    if (kids.length > 0) {
      setPath(entry.pathNodes);
    } else {
      onSelect({ id: node.category_id, name: node.name, path: pathNames });
    }
  }, [onSelect]);

  const handleUseCurrentCategory = () => {
    if (!currentCategory) return;
    onSelect({ id: currentCategory.category_id, name: currentCategory.name, path: path.map((p) => p.name) });
  };

  const navigateTo = (index) => {
    setPath(path.slice(0, index + 1));
    setQuery('');
  };

  const handleAiSuggestedConfirm = useCallback(() => {
    const payload = aiPendingSelectRef.current;
    if (!payload) {
      console.log('[CG Suite][AiCategory][Picker] click but no pending payload');
      return;
    }
    console.log('[CG Suite][AiCategory][Picker] user confirmed AI category', payload);

    onClearAiNosposStockCategory?.();
    onSelect(payload, { awaitingAiNosposMatch: true });

    const flat = allCategoriesFlatRef.current;
    const run = (async () => {
      const match = await runNosposStockCategoryAiMatchBackground({
        internalCategoryId: payload.id,
        itemSummary: itemSummaryForAi,
        allCategoriesFlat: flat,
        logTag: '[CG Suite][NosposPathMatch]',
      });
      if (match) {
        onAiNosposStockCategoryReady?.({
          nosposId: match.nosposId,
          fullName: match.fullName,
          pathSegments: match.pathSegments,
        });
      }
    })();
    registerNosposBackgroundMatch?.(run);
  }, [
    onSelect,
    onClearAiNosposStockCategory,
    onAiNosposStockCategoryReady,
    registerNosposBackgroundMatch,
    itemSummaryForAi,
  ]);

  const listAiSuggestion =
    !loadError && path.length === 0 && !loading
      ? aiSlotPhase === 'running'
        ? { phase: 'running' }
        : aiSlotPhase === 'ready' && aiBreadcrumb
          ? { phase: 'ready', breadcrumb: aiBreadcrumb, onConfirm: handleAiSuggestedConfirm }
          : aiSlotPhase === 'error' && aiAutoError
            ? { phase: 'error', message: aiAutoError }
            : null
      : null;

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden p-2 sm:p-3">
      {/* Breadcrumb navigation */}
      {path.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 text-xs font-medium">
          <button type="button" onClick={() => { setPath([]); setQuery(''); }} className="text-brand-blue hover:underline">All Categories</button>
          {path.map((p, i) => (
            <React.Fragment key={p.category_id}>
              <span className="text-gray-400">›</span>
              {i < path.length - 1 ? (
                <button type="button" onClick={() => navigateTo(i)} className="text-brand-blue hover:underline">{categoryPickerDisplayName(p)}</button>
              ) : (
                <span className="font-bold text-gray-800">{categoryPickerDisplayName(p)}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* "Use this category" when drilled into a non-leaf */}
      {currentCategory && (currentCategory.children?.length > 0) && (
        <button
          type="button"
          onClick={handleUseCurrentCategory}
          className="shrink-0 flex items-center gap-1.5 rounded-md border border-brand-blue/30 bg-brand-blue/5 px-2 py-1.5 text-[11px] font-bold text-brand-blue transition-colors hover:bg-brand-blue/10 sm:text-xs"
        >
          <span className="material-symbols-outlined text-[15px]">check_circle</span>
          Use &ldquo;{categoryPickerDisplayName(currentCategory)}&rdquo; as category
        </button>
      )}

      {/* Back button + error */}
      {path.length > 0 && (
        <button type="button" onClick={() => { setPath(path.slice(0, -1)); setQuery(''); }} className="shrink-0 inline-flex w-fit items-center gap-1 text-xs font-bold text-brand-blue hover:underline">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
      )}

      {loadError && <p className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200">
        <CategoryPickerList
          items={currentLevelItems}
          isLoading={loading}
          onSelect={handleSelectItem}
          query={query}
          setQuery={setQuery}
          statsHeading={path.length === 0 ? 'Top-level categories' : `Sub-categories of "${currentCategory ? categoryPickerDisplayName(currentCategory) : ''}"`}
          entitySingular="category"
          entityPlural="categories"
          aiSuggestion={listAiSuggestion}
          onSkip={skipCategoryPayload ? () => onSelect(skipCategoryPayload) : null}
          onClose={onClose}
          globalSearchEntries={globalSearchEntries}
          onPickGlobalSearch={handleGlobalSearchPick}
        />
      </div>
    </div>
  );
}

const SOURCE_CONFIG = {
  eBay: {
    idPrefix: 'ebay',
    label: 'eBay',
    headerTitle: 'eBay Market Research',
    headerIcon: 'search_insights',
    getDataPrompt: 'Click below to open eBay in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.',
    enableAdvancedSoldDateFilter: true,
    supportsCancelRefine: true,
  },
  CashConverters: {
    idPrefix: 'cc',
    label: 'Cash Converters',
    headerTitle: 'Cash Converters Market Research',
    headerIcon: 'store',
    getDataPrompt: 'Click below to open Cash Converters in a new tab. Go to a page with multiple listings, then use the extension panel to confirm and send data back.',
    enableAdvancedSoldDateFilter: false,
    supportsCancelRefine: false,
  },
};

function ensureListingIds(items, prefix) {
  return items.map((item, idx) =>
    item._id ? item : { ...item, _id: `${prefix}-${Date.now()}-${idx}` }
  );
}

/** Canonical listing URL for links in the app (matches extension scrape pattern for id). */
const EBAY_UK_ITM_URL = (itemNumber) =>
  `https://www.ebay.co.uk/itm/${itemNumber}?nordt=true&orig_cvip=true`;

function extractEbayItemIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/itm\/(?:[^/?]+\/)?(\d{9,})/);
  return m ? m[1] : null;
}

function normalizeEbayListingItem(item) {
  if (!item || typeof item !== 'object') return item;
  let id = null;
  if (item.itemId != null && String(item.itemId).trim() !== '') {
    const digits = String(item.itemId).replace(/\D/g, '');
    if (digits.length >= 9) id = digits;
  }
  if (!id) id = extractEbayItemIdFromUrl(item.url);
  if (!id) return item;
  return {
    ...item,
    itemId: item.itemId != null && String(item.itemId).trim() !== '' ? item.itemId : id,
    url: EBAY_UK_ITM_URL(id),
  };
}

function prepareExtensionListingsForShell(source, results, idPrefix) {
  const items = Array.isArray(results) ? results : [];
  const mapped = source === 'eBay' ? items.map(normalizeEbayListingItem) : items;
  return ensureListingIds(mapped, idPrefix);
}

/**
 * Shared extension-driven research form supporting eBay and Cash Converters.
 * Source-specific behaviour is driven by the `source` prop.
 */
function ExtensionResearchForm({
  source = 'eBay',
  onComplete,
  category,
  mode = 'modal',
  savedState = null,
  initialHistogramState = null,
  readOnly = false,
  ephemeralSessionNotice = null,
  showManualOffer = false,
  initialSearchQuery = null,
  marketComparisonContext = null,
  resetDrillOnOpen = false,
  onAddNewItem = null,
  onOfferSelect = null,
  addActionLabel = 'Add to Cart',
  hideOfferCards = false,
  useVoucherOffers = false,
  onOffersChange = null,
  containModalInParent = false,
  hideAddAction = false,
  lineItemContext = null,
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  /** Called immediately when a category is selected (before search). Use to persist the
   *  category onto the item so other research forms for the same item skip the picker. */
  onCategoryResolved = null,
}) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.eBay;
  const isEbay = source === 'eBay';

  // resolvedCategory: either the category prop (if it has an id), one restored from saved state,
  // or one the user picks during this session
  const [resolvedCategory, setResolvedCategory] = useState(() => {
    if (category?.id != null) return category;
    if (savedState?.resolvedCategory?.id != null) return savedState.resolvedCategory;
    return null;
  });
  // Sync if the category prop changes externally (e.g. cart item updated)
  const prevCategoryIdRef = useRef(category?.id);
  useEffect(() => {
    if (category?.id != null && category.id !== prevCategoryIdRef.current) {
      prevCategoryIdRef.current = category?.id;
      setResolvedCategory(category);
    }
  }, [category]);

  const categoryId = resolvedCategory?.id ?? null;
  const ebayOfferMargins = useEbayOfferMargins(categoryId);
  useEffect(() => {
    if (categoryId) useAppStore.getState().loadEbayOfferMargins(categoryId);
  }, [categoryId]);
  useEffect(() => {
    if (!resolvedCategory) return;
    if (typeof console === 'undefined') return;
    console.log('[CG Suite][CategoryRule]', {
      context: `${source}-research-category-and-rule`,
      categoryName: resolvedCategory?.name ?? null,
      categoryId: resolvedCategory?.id ?? null,
      categoryPath: resolvedCategory?.path ?? null,
      rule: {
        source: 'ebay-offer-margins',
        margins: Array.isArray(ebayOfferMargins) ? ebayOfferMargins : null,
      },
    });
  }, [resolvedCategory, ebayOfferMargins, source]);

  const savedHasAnyResearch =
    Boolean(savedState?.listings?.length) ||
    Boolean(savedState?.buyOffers?.length) ||
    Boolean(savedState?.stats && typeof savedState.stats === 'object');

  // Show category picker when: not readOnly, no existing category id (from prop or saved state),
  // and no saved research yet
  const categoryKnown = (category?.id != null) || (savedState?.resolvedCategory?.id != null);
  const needsCategoryPick = !readOnly && !categoryKnown && !savedHasAnyResearch;
  const [step, setStep] = useState(() => {
    if (savedHasAnyResearch) return 'cards';
    if (needsCategoryPick) return 'category';
    return 'get-data';
  });

  const aiNosposInit = savedState?.aiSuggestedNosposStockCategory;
  const aiNosposStockCategoryRef = useRef(
    aiNosposInit && typeof aiNosposInit === 'object' ? { ...aiNosposInit } : null
  );

  /** In-flight {@link runNosposStockCategoryAiMatchBackground} from category step — await before OK/save. */
  const nosposBackgroundMatchRef = useRef(null);
  const registerNosposBackgroundMatch = useCallback((promise) => {
    if (!promise || typeof promise.then !== 'function') return;
    nosposBackgroundMatchRef.current = promise;
    promise.finally(() => {
      if (nosposBackgroundMatchRef.current === promise) {
        nosposBackgroundMatchRef.current = null;
      }
    });
  }, []);
  const awaitPendingNosposBackgroundMatch = useCallback(async () => {
    const p = nosposBackgroundMatchRef.current;
    if (!p) return;
    try {
      await p;
    } catch {
      /* errors logged in cascade */
    }
  }, []);

  // ─── Auto-resolve CeX category name to DB category ─────────────────────
  // Runs once when we land on the 'category' step with a named (non-id) category.
  // If we can match "Games / Xbox" → DB "Xbox", we skip the picker entirely.
  const [autoResolvingCategory, setAutoResolvingCategory] = useState(false);
  const autoResolveDoneRef = useRef(false);

  useEffect(() => {
    if (step !== 'category') return;
    if (autoResolveDoneRef.current) return;

    // Only attempt auto-resolution when there's a real CeX-sourced category name to match.
    // eBay items come in with "Other" or no category — skip straight to the manual picker.
    const cexName = category?.name;
    const GENERIC_NAMES = new Set([
      'cex',
      'ebay',
      'cash converters',
      'cashconverters',
      'other',
      'n/a',
      'unknown',
      '',
    ]);
    const isUsableName = cexName && !GENERIC_NAMES.has(cexName.toLowerCase().trim());

    if (!isUsableName || category?.id != null) {
      autoResolveDoneRef.current = true;
      return;
    }

    autoResolveDoneRef.current = true;
    let cancelled = false;
    let slowResolveTimer = null;
    setAutoResolvingCategory(true);
    slowResolveTimer = window.setTimeout(() => {
      if (!cancelled) setAutoResolvingCategory(false);
    }, 2500);
    fetchAllCategoriesFlat().then((flat) => {
      if (cancelled) return;
      const match = matchCexCategoryNameToDb(cexName, flat);
      if (match) {
        setResolvedCategory(match);
        if (typeof console !== 'undefined') {
          console.log('[CG Suite][CategoryRule]', {
            context: `${source}-auto-resolved-from-cex-name`,
            categoryName: match?.name ?? null,
            categoryId: match?.id ?? null,
            categoryPath: match?.path ?? null,
            rawCexCategoryName: cexName,
          });
        }
        onCategoryResolved?.(match);
        setStep('get-data');
      }
    }).catch(() => {
      /* silently fall through to manual picker */
    }).finally(() => {
      if (slowResolveTimer) window.clearTimeout(slowResolveTimer);
      if (!cancelled) setAutoResolvingCategory(false);
    });
    return () => {
      cancelled = true;
      if (slowResolveTimer) window.clearTimeout(slowResolveTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const [listings, setListings] = useState(() =>
    prepareExtensionListingsForShell(source, savedState?.listings ?? [], config.idPrefix)
  );
  const [dataVersion, setDataVersion] = useState(0);
  /** eBay: when false, rows with isRelevant === 'no' are omitted everywhere (list, histogram, stats, offers). Persisted in advancedFilterState. */
  const [includeEbayBroadMatchListings, setIncludeEbayBroadMatchListings] = useState(() =>
    source === 'eBay' && Boolean(savedState?.advancedFilterState?.includeEbayBroadMatchListings)
  );

  const skipBroadMatchResetOnMountRef = useRef(true);
  useEffect(() => {
    if (!isEbay) return;
    if (skipBroadMatchResetOnMountRef.current) {
      skipBroadMatchResetOnMountRef.current = false;
      return;
    }
    setIncludeEbayBroadMatchListings(false);
  }, [dataVersion, isEbay]);
  const [searchTerm, setSearchTerm] = useState(() => {
    if (savedState?.searchTerm != null && String(savedState.searchTerm).trim() !== '') {
      return String(savedState.searchTerm).trim();
    }
    if (initialSearchQuery != null && String(initialSearchQuery).trim() !== '') {
      return String(initialSearchQuery).trim();
    }
    return '';
  });
  const [listingPageUrl, setListingPageUrl] = useState(savedState?.listingPageUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const userCancelledRef = useRef(false);
  const [drillHistory, setDrillHistory] = useState(resetDrillOnOpen ? [] : (savedState?.drillHistory ?? []));
  const [showHistogram, setShowHistogram] = useState(
    savedState?.showHistogram ?? (initialHistogramState !== null ? initialHistogramState : mode === 'modal')
  );
  const [manualOffer, setManualOffer] = useState(savedState?.manualOffer ?? '');

  useEffect(() => {
    if (initialHistogramState !== null) setShowHistogram(initialHistogramState);
    else if (savedState?.showHistogram !== undefined) setShowHistogram(savedState.showHistogram);
    else if (mode === 'modal' && step === 'cards') setShowHistogram(true);
  }, [initialHistogramState, savedState?.showHistogram, mode, step]);

  // ─── Data fetching ──────────────────────────────────────────────────────
  const handleGetData = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromListingPage(source, initialSearchQuery || undefined, marketComparisonContext);
      if (isEbay && userCancelledRef.current) return;
      if (result?.success && Array.isArray(result.results)) {
        setListings(prepareExtensionListingsForShell(source, result.results, config.idPrefix));
        setDataVersion(v => v + 1);
        const term = (result.searchTerm != null && String(result.searchTerm).trim())
          ? String(result.searchTerm).trim()
          : (isEbay ? '' : (initialSearchQuery || ''));
        setSearchTerm(term);
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setStep('cards');
      } else if (isExtensionListingFlowAborted(result)) {
        if (mode === 'modal') onComplete?.({ cancel: true });
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked Yes.");
      }
    } catch (err) {
      if (isEbay && userCancelledRef.current) return;
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed and the tab open?');
    } finally {
      setLoading(false);
    }
  }, [source, isEbay, config.idPrefix, initialSearchQuery, marketComparisonContext, mode, onComplete]);

  const handleRefineSearch = useCallback(async () => {
    userCancelledRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const result = await getDataFromRefine(source, listingPageUrl, marketComparisonContext);
      if (isEbay && userCancelledRef.current) return;
      if (result?.success && Array.isArray(result.results)) {
        setListings(prepareExtensionListingsForShell(source, result.results, config.idPrefix));
        setDataVersion(v => v + 1);
        if (isEbay) {
          setSearchTerm((result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : '');
        } else {
          setSearchTerm(prev => (result.searchTerm != null && String(result.searchTerm).trim()) ? String(result.searchTerm).trim() : prev);
        }
        setListingPageUrl(result.listingPageUrl || null);
        setDrillHistory([]);
        setError(null);
      } else if (isExtensionListingFlowAborted(result)) {
        setError(null);
      } else {
        setError(result?.error || "No data returned. Make sure you're on a listings page and clicked the button.");
      }
    } catch (err) {
      if (isEbay && userCancelledRef.current) return;
      setError(err?.message || 'Extension communication failed. Is the Chrome extension installed?');
    } finally {
      setLoading(false);
    }
  }, [source, isEbay, config.idPrefix, listingPageUrl, marketComparisonContext]);

  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    // Only auto-trigger when we're actually on the get-data step (not category step)
    if (mode === 'modal' && step === 'get-data' && !readOnly && savedState == null && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleGetData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleCancelRefine = useCallback(() => {
    userCancelledRef.current = true;
    setError(null);
    cancelListingTab().catch(() => {});
  }, []);

  // ─── Listings / stats / offers ──────────────────────────────────────────
  const currentPriceRange = drillHistory.length > 0 ? drillHistory[drillHistory.length - 1] : null;

  const ebayHasBroadMatchListings = useMemo(() => {
    if (!isEbay) return false;
    if ((listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no')) return true;
    // Saved sessions (e.g. request overview) after older saves may lack per-row isRelevant; flag on advancedFilterState.
    return Boolean(savedState?.advancedFilterState?.ebayHadBroadMatchListings);
  }, [isEbay, listings, savedState?.advancedFilterState?.ebayHadBroadMatchListings]);

  const listingsForResearch = useMemo(() => {
    if (!isEbay || includeEbayBroadMatchListings) return listings;
    return (listings || []).filter((l) => String(l?.isRelevant || '').toLowerCase() !== 'no');
  }, [listings, isEbay, includeEbayBroadMatchListings]);

  const handleToggleExclude = useCallback((listingId) => {
    setListings(prev => prev.map(l => l._id === listingId ? { ...l, excluded: !l.excluded } : l));
  }, []);

  const handleClearAllExclusions = useCallback(() => {
    setListings(prev => prev.map(l => (l.excluded ? { ...l, excluded: false } : l)));
  }, []);

  const displayedListings = useMemo(() => {
    if (!listingsForResearch || listingsForResearch.length === 0) return null;
    if (!currentPriceRange) return listingsForResearch;
    return listingsForResearch.filter(item => {
      const p = typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) : item.price;
      return !isNaN(p) && p >= currentPriceRange.min && p <= currentPriceRange.max;
    });
  }, [listingsForResearch, currentPriceRange]);

  // Histogram drill can target a range that only has rows under a wider cohort (e.g. looser matches on).
  // When the cohort shrinks and that range is empty, snap back to root so the grid/histogram aren’t blank.
  useEffect(() => {
    if (drillHistory.length === 0) return;
    if (!listingsForResearch?.length) return;
    if (!displayedListings || displayedListings.length > 0) return;
    setDrillHistory([]);
  }, [drillHistory.length, listingsForResearch, displayedListings]);

  const resetDrillToRoot = useCallback(() => {
    setDrillHistory([]);
  }, []);

  const stats = useMemo(() => calculateStats(listingsForResearch.filter(l => !l.excluded)), [listingsForResearch]);
  const displayedStats = useMemo(() => {
    if (!displayedListings || displayedListings.length === 0) return stats;
    const relevant = displayedListings.filter(l => !l.excluded);
    if (relevant.length === 0) return stats;
    return calculateStats(relevant);
  }, [displayedListings, stats]);

  const buyOffers = useMemo(
    () => calculateBuyOffers(displayedStats.suggestedPrice, ebayOfferMargins),
    [displayedStats.suggestedPrice, ebayOfferMargins]
  );

  const otherResearchSummaries = useMemo(() => {
    if (!lineItemContext) return null;
    return buildOtherResearchChannelsSummaries(lineItemContext, source, { ebayOfferMargins, useVoucherOffers });
  }, [lineItemContext, source, ebayOfferMargins, useVoucherOffers]);

  // eBay-only: debounced onOffersChange when exclusions or offers change
  const onOffersChangeRef = useRef(onOffersChange);
  useEffect(() => { onOffersChangeRef.current = onOffersChange; });
  const offersChangeInitializedRef = useRef(false);
  // ─── Advanced filter state tracking (for persistence) ────────────────────
  const advancedFilterStateRef = useRef(savedState?.advancedFilterState ?? null);
  const handleAdvancedFilterChange = useCallback((filterState) => {
    const base = filterState && typeof filterState === 'object' ? filterState : {};
    advancedFilterStateRef.current = {
      ...base,
      ...(isEbay ? { includeEbayBroadMatchListings } : {}),
    };
  }, [isEbay, includeEbayBroadMatchListings]);

  useEffect(() => {
    if (!isEbay) return;
    const cur = advancedFilterStateRef.current;
    const base = cur && typeof cur === 'object' ? cur : {};
    const hasBroad = (listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no');
    advancedFilterStateRef.current = {
      ...base,
      includeEbayBroadMatchListings,
      ...(hasBroad ? { ebayHadBroadMatchListings: true } : {}),
    };
  }, [isEbay, includeEbayBroadMatchListings, listings]);

  const savedAdvInclude = savedState?.advancedFilterState?.includeEbayBroadMatchListings;
  useEffect(() => {
    if (source !== 'eBay') return;
    setIncludeEbayBroadMatchListings(Boolean(savedAdvInclude));
  }, [source, savedAdvInclude]);

  useEffect(() => {
    if (!isEbay) return;
    if (!offersChangeInitializedRef.current) {
      offersChangeInitializedRef.current = true;
      return;
    }
    const advSnapshot = {
      ...(advancedFilterStateRef.current && typeof advancedFilterStateRef.current === 'object'
        ? advancedFilterStateRef.current
        : {}),
      includeEbayBroadMatchListings,
    };
    const t = window.setTimeout(() => {
      onOffersChangeRef.current?.({
        buyOffers,
        listings: listingsForResearch,
        stats: displayedStats,
        advancedFilterState: advSnapshot,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [
    isEbay,
    listings,
    buyOffers,
    listingsForResearch,
    displayedStats,
    includeEbayBroadMatchListings,
  ]);

  // ─── Drill handlers ─────────────────────────────────────────────────────
  const handleDrillDown = useCallback((rangeStart, rangeEnd) => {
    setDrillHistory(prev => [...prev, { min: rangeStart, max: rangeEnd }]);
  }, []);

  const handleZoomOut = useCallback(() => {
    setDrillHistory(prev => prev.slice(0, -1));
  }, []);

  const handleNavigateToDrillLevel = useCallback((targetLevel) => {
    setDrillHistory(prev => prev.slice(0, targetLevel));
  }, []);

  const handleAiNosposStockCategoryReady = useCallback((payload) => {
    if (payload && typeof payload === 'object') {
      aiNosposStockCategoryRef.current = payload;
    }
  }, []);

  const handleClearAiNosposStockCategory = useCallback(() => {
    aiNosposStockCategoryRef.current = null;
  }, []);

  // ─── Completion helpers ─────────────────────────────────────────────────
  const buildPayload = useCallback((extras = {}) => {
    const prevAdv = advancedFilterStateRef.current;
    const advBase = prevAdv && typeof prevAdv === 'object' ? prevAdv : {};
    const hasBroadRows =
      isEbay &&
      (listings || []).some((l) => String(l?.isRelevant || '').toLowerCase() === 'no');
    const advancedFilterState = isEbay
      ? {
          ...advBase,
          includeEbayBroadMatchListings,
          ...(hasBroadRows || advBase.ebayHadBroadMatchListings
            ? { ebayHadBroadMatchListings: true }
            : {}),
        }
      : prevAdv;
    const n = aiNosposStockCategoryRef.current;
    let aiSuggestedNosposStockCategory = null;
    if (
      n &&
      typeof n === 'object' &&
      (n.nosposId != null ||
        (n.fullName != null && String(n.fullName).trim()) ||
        (Array.isArray(n.pathSegments) && n.pathSegments.length > 0))
    ) {
      aiSuggestedNosposStockCategory = {
        nosposId: n.nosposId != null ? Number(n.nosposId) : null,
        fullName: n.fullName != null ? String(n.fullName).trim() || null : null,
        pathSegments: Array.isArray(n.pathSegments) ? n.pathSegments : null,
        source: n.source || 'extension_research_ai',
        savedAt: new Date().toISOString(),
      };
    }
    return {
      listings,
      showHistogram,
      drillHistory,
      stats: displayedStats,
      buyOffers,
      searchTerm,
      listingPageUrl,
      selectedFilters: { basic: [], apiFilters: {} },
      filterOptions: [],
      manualOffer,
      advancedFilterState,
      // Pass along any category that was resolved during this research session
      resolvedCategory: resolvedCategory || null,
      ...(aiSuggestedNosposStockCategory ? { aiSuggestedNosposStockCategory } : {}),
      ...extras,
    };
  }, [listings, showHistogram, drillHistory, displayedStats, buyOffers, searchTerm, listingPageUrl, manualOffer, isEbay, includeEbayBroadMatchListings, resolvedCategory]);

  const handleComplete = useCallback(async () => {
    await awaitPendingNosposBackgroundMatch();
    onComplete?.(buildPayload());
  }, [onComplete, buildPayload, awaitPendingNosposBackgroundMatch]);

  /** Shell footer OK: view-only overlays close with cancel (no save). */
  const handleShellOnComplete = useCallback(async () => {
    if (readOnly) onComplete?.({ cancel: true });
    else await handleComplete();
  }, [readOnly, onComplete, handleComplete]);

  const handleCompleteWithSelection = useCallback(async (selectedOfferIndex, overrideManualOffer) => {
    await awaitPendingNosposBackgroundMatch();
    const state = buildPayload({ manualOffer: overrideManualOffer ?? manualOffer });
    if (showManualOffer) state.selectedOfferIndex = selectedOfferIndex;
    onComplete?.(state);
  }, [onComplete, buildPayload, manualOffer, showManualOffer, awaitPendingNosposBackgroundMatch]);

  const handleAddToCartWithOffer = useCallback(async (offerArg) => {
    let selectedOfferIndex = offerArg;
    let nextManualOffer = manualOffer;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferIndex = 'manual';
      const amount = Number(offerArg.amount);
      if (Number.isFinite(amount) && amount > 0) nextManualOffer = amount.toFixed(2);
    } else if (offerArg == null) {
      selectedOfferIndex = null;
      nextManualOffer = '';
    } else {
      selectedOfferIndex = offerArg;
      nextManualOffer = '';
    }
    await awaitPendingNosposBackgroundMatch();
    onComplete?.(buildPayload({ manualOffer: nextManualOffer, selectedOfferIndex }));
  }, [onComplete, buildPayload, manualOffer, awaitPendingNosposBackgroundMatch]);

  const handleOfferSelect = useCallback((offerArg) => {
    onOfferSelect?.(offerArg);
  }, [onOfferSelect]);

  const handleResetSearch = useCallback(() => {
    if (isEbay && loading) {
      userCancelledRef.current = true;
      cancelListingTab().catch(() => {});
    }
    setListings([]);
    setDataVersion(v => v + 1);
    setSearchTerm('');
    setListingPageUrl(null);
    setDrillHistory([]);
    setShowHistogram(initialHistogramState !== null ? initialHistogramState : (mode === 'modal'));
    setManualOffer('');
    setError(null);
    setLoading(false);
    aiNosposStockCategoryRef.current = null;
    nosposBackgroundMatchRef.current = null;
    setStep('get-data');
  }, [isEbay, loading, initialHistogramState, mode]);

  // ─── Category-pick step ─────────────────────────────────────────────────
  if (step === 'category') {
    const handleCategorySelected = (cat, opts) => {
      if (!opts?.awaitingAiNosposMatch) {
        aiNosposStockCategoryRef.current = null;
      }
      setResolvedCategory(cat);
      if (typeof console !== 'undefined') {
        console.log('[CG Suite][CategoryRule]', {
          context: `${source}-manual-category-selected`,
          categoryName: cat?.name ?? null,
          categoryId: cat?.id ?? null,
          categoryPath: cat?.path ?? null,
        });
      }
      // Immediately notify the parent so sibling research forms for the same item
      // don't re-ask for category (the category is now known for this item).
      onCategoryResolved?.(cat);
      setStep('get-data');
    };
    const categoryBody = (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {autoResolvingCategory ? (
          <div className="shrink-0 mx-4 mt-3 rounded-lg border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-xs text-brand-blue">
            Matching category from scraped data...
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CategoryPickerStep
            onSelect={handleCategorySelected}
            onAiNosposStockCategoryReady={handleAiNosposStockCategoryReady}
            onClearAiNosposStockCategory={handleClearAiNosposStockCategory}
            registerNosposBackgroundMatch={registerNosposBackgroundMatch}
            lineItemForAi={lineItemContext}
            initialSearchQuery={initialSearchQuery}
            categoryHint={category}
            onClose={mode === 'modal' ? () => onComplete?.({ cancel: true }) : null}
          />
        </div>
      </div>
    );

    if (mode === 'modal') {
      const wrapperClass = containModalInParent
        ? 'flex h-full min-h-0 w-full flex-col'
        : 'fixed inset-0 z-[100] flex items-start justify-center';
      return (
        <div className={wrapperClass}>
          {!containModalInParent && (
            <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/40" aria-hidden />
          )}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${!containModalInParent ? 'relative z-10 cg-animate-modal-panel' : ''}`}>
            {ephemeralSessionNotice && (
              <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-950" role="status">
                {ephemeralSessionNotice}
              </div>
            )}
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">{categoryBody}</main>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col bg-gray-50">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{categoryBody}</main>
      </div>
    );
  }

  // ─── Get-data step ──────────────────────────────────────────────────────
  if (step === 'get-data') {
    const getDataBody = (
      <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[200px] gap-4 p-6">
        <p className="text-gray-600 text-center">{config.getDataPrompt}</p>
        <button
          type="button"
          onClick={handleGetData}
          disabled={loading || readOnly}
          className="px-6 py-3 bg-brand-blue text-white font-semibold rounded-xl shadow-md hover:bg-brand-blue-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Waiting for you to get the data\u2026' : 'Get data'}
        </button>
        {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}
      </div>
    );

    if (mode === 'modal') {
      const wrapperClass = containModalInParent
        ? 'flex h-full min-h-0 w-full flex-col'
        : 'fixed inset-0 z-[100] flex items-start justify-center';
      return (
        <div className={wrapperClass}>
          {!containModalInParent && (
            <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/40" aria-hidden />
          )}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${!containModalInParent ? 'relative z-10 cg-animate-modal-panel' : ''}`}>
            <div className="flex shrink-0 items-center justify-end border-b border-[var(--ui-border)] bg-white px-2 py-1.5">
              <WorkspaceCloseButton
                title={`Close ${config.label} research`}
                onClick={() => onComplete?.({ cancel: true })}
              />
            </div>
            {ephemeralSessionNotice && (
              <div
                className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-950"
                role="status"
              >
                {ephemeralSessionNotice}
              </div>
            )}
            <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">{getDataBody}</main>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col bg-gray-50">
        <main className="flex flex-1 flex-col overflow-auto">{getDataBody}</main>
      </div>
    );
  }

  // ─── Cards step → ResearchFormShell ─────────────────────────────────────
  return (
    <ResearchFormShell
      searchTerm=""
      onSearchTermChange={() => {}}
      onSearch={() => {}}
      listings={listingsForResearch}
      displayedListings={displayedListings}
      filterOptions={[]}
      selectedFilters={{ basic: [], apiFilters: {} }}
      onBasicFilterChange={() => {}}
      onApiFilterChange={() => {}}
      loading={false}
      showHistogram={showHistogram}
      onShowHistogramChange={setShowHistogram}
      drillHistory={drillHistory}
      onDrillDown={handleDrillDown}
      onZoomOut={handleZoomOut}
      onNavigateToDrillLevel={handleNavigateToDrillLevel}
      onResetDrillToRoot={resetDrillToRoot}
      onComplete={handleShellOnComplete}
      onCompleteWithSelection={showManualOffer ? handleCompleteWithSelection : undefined}
      onAddToCartWithOffer={
        isEbay && !readOnly
          ? (onOfferSelect ? handleOfferSelect : (onComplete && !showManualOffer ? handleAddToCartWithOffer : undefined))
          : undefined
      }
      showInlineOfferAction={isEbay ? (mode === 'page' ? !onAddNewItem : !onOfferSelect) : undefined}
      enableRightClickManualOffer={isEbay && mode === 'page'}
      enableAdvancedSoldDateFilter={config.enableAdvancedSoldDateFilter}
      mode={mode}
      readOnly={readOnly}
      ephemeralSessionNotice={ephemeralSessionNotice}
      basicFilterOptions={[]}
      searchPlaceholder=""
      headerTitle={searchTerm || config.headerTitle}
      headerSubtitle={
        searchTerm
          ? (isEbay ? `eBay: ${searchTerm}` : `Cash Converters: ${searchTerm}`)
          : 'Real-time valuation lookup'
      }
      headerIcon={config.headerIcon}
      buyOffers={buyOffers}
      customControls={null}
      allowHistogramToggle={initialHistogramState !== false}
      manualOffer={manualOffer}
      onManualOfferChange={!readOnly && (showManualOffer || isEbay) ? setManualOffer : null}
      showManualOffer={showManualOffer}
      hideSearchAndFilters={true}
      onRefineSearch={handleRefineSearch}
      onCancelRefine={config.supportsCancelRefine ? handleCancelRefine : undefined}
      refineError={error}
      refineLoading={loading}
      onToggleExclude={!readOnly ? handleToggleExclude : undefined}
      onClearAllExclusions={!readOnly ? handleClearAllExclusions : undefined}
      onAddNewItem={onAddNewItem}
      onResetSearch={!readOnly ? handleResetSearch : null}
      addActionLabel={addActionLabel}
      hideOfferCards={hideOfferCards}
      useVoucherOffers={useVoucherOffers}
      containModalInParent={containModalInParent}
      hidePrimaryAddAction={hideAddAction}
      initialAdvancedFilterState={savedState?.advancedFilterState ?? null}
      onAdvancedFilterChange={handleAdvancedFilterChange}
      dataVersion={dataVersion}
      otherResearchSummaries={otherResearchSummaries}
      isEbayResearchSource={isEbay}
      ebayHasBroadMatchListings={ebayHasBroadMatchListings}
      includeEbayBroadMatchListings={includeEbayBroadMatchListings}
      onIncludeEbayBroadMatchChange={isEbay && !readOnly ? setIncludeEbayBroadMatchListings : undefined}
      blockedOfferSlots={blockedOfferSlots}
      onBlockedOfferClick={onBlockedOfferClick}
      lineItemContext={lineItemContext}
    />
  );
}

export default React.memo(ExtensionResearchForm);
