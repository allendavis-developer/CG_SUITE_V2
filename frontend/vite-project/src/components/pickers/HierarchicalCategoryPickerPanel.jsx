import React, { useState, useMemo, useCallback, useEffect } from 'react';
import HierarchicalCategoryPickerList, { categoryPickerDisplayName } from './HierarchicalCategoryPickerList';
import { flattenCategoryTreeWithPaths } from '@/utils/categoryPickerTree';

/**
 * Drill-down + global search category picker (same behaviour as eBay research `CategoryPickerStep` body).
 *
 * @param {object[]} roots - nested `{ category_id, name, children, ... }`
 * @param {boolean} isLoading
 * @param {string|null} loadError
 * @param {(nodes: object[]) => object[]} filterChildren
 * @param {(selection: { node: object, pathNames: string[] }) => void} onSelect - leaf or "use this category" picks
 * @param {number|string|null} currentSelectionCategoryId
 * @param props forwarded to list: aiSuggestion, onSkip, onClose
 */
export default function HierarchicalCategoryPickerPanel({
  roots,
  isLoading,
  loadError = null,
  filterChildren = (x) => x,
  onSelect,
  currentSelectionCategoryId = null,
  aiSuggestion = null,
  onSkip = null,
  onClose = null,
  entitySingular = 'category',
  entityPlural = 'categories',
  /** Fired when drill-down depth changes (0 = top level). Used to hide e.g. AI suggestion when not at root. */
  onPathDepthChange = null,
}) {
  const [path, setPath] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setPath([]);
    setQuery('');
  }, [roots]);

  useEffect(() => {
    onPathDepthChange?.(path.length);
  }, [path.length, onPathDepthChange]);

  const currentLevelItems = useMemo(() => {
    const raw = path.length === 0 ? roots : path[path.length - 1]?.children || [];
    return filterChildren(raw);
  }, [path, roots, filterChildren]);

  const currentCategory = path.length > 0 ? path[path.length - 1] : null;

  const globalSearchEntries = useMemo(
    () => flattenCategoryTreeWithPaths(roots, filterChildren),
    [roots, filterChildren]
  );

  const navigateTo = useCallback((index) => {
    setPath(path.slice(0, index + 1));
    setQuery('');
  }, [path]);

  const handleSelectItem = useCallback(
    (cat) => {
      const kids = filterChildren(cat.children || []);
      if (kids.length > 0) {
        setPath((p) => [...p, cat]);
        setQuery('');
      } else {
        const pathNames = [...path.map((p) => p.name), cat.name];
        onSelect?.({ node: cat, pathNames });
      }
    },
    [path, onSelect, filterChildren]
  );

  const handleGlobalSearchPick = useCallback(
    (entry) => {
      const { node, pathNames, pathNodes } = entry;
      const kids = filterChildren(node.children || []);
      setQuery('');
      if (kids.length > 0) {
        setPath(pathNodes);
      } else {
        onSelect?.({ node, pathNames });
      }
    },
    [onSelect, filterChildren]
  );

  const handleUseCurrentCategory = useCallback(() => {
    if (!currentCategory) return;
    const pathNames = path.map((p) => p.name);
    onSelect?.({ node: currentCategory, pathNames });
  }, [currentCategory, path, onSelect]);

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden p-2 sm:p-3">
      {path.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setPath([]);
              setQuery('');
            }}
            className="text-brand-blue hover:underline"
          >
            All Categories
          </button>
          {path.map((p, i) => (
            <React.Fragment key={p.category_id}>
              <span className="text-gray-400">›</span>
              {i < path.length - 1 ? (
                <button type="button" onClick={() => navigateTo(i)} className="text-brand-blue hover:underline">
                  {categoryPickerDisplayName(p)}
                </button>
              ) : (
                <span className="font-bold text-gray-800">{categoryPickerDisplayName(p)}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

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

      {path.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setPath(path.slice(0, -1));
            setQuery('');
          }}
          className="shrink-0 inline-flex w-fit items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
      )}

      {loadError && (
        <p className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200">
        <HierarchicalCategoryPickerList
          items={currentLevelItems}
          isLoading={isLoading}
          onSelect={handleSelectItem}
          query={query}
          setQuery={setQuery}
          statsHeading={
            path.length === 0
              ? 'Top-level categories'
              : `Sub-categories of "${currentCategory ? categoryPickerDisplayName(currentCategory) : ''}"`
          }
          entitySingular={entitySingular}
          entityPlural={entityPlural}
          aiSuggestion={aiSuggestion}
          onSkip={onSkip}
          onClose={onClose}
          globalSearchEntries={globalSearchEntries}
          onPickGlobalSearch={handleGlobalSearchPick}
          filterChildren={filterChildren}
          currentSelectionCategoryId={currentSelectionCategoryId}
        />
      </div>
    </div>
  );
}
