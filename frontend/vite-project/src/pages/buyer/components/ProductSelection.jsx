import React, { useState, useEffect, useRef, useMemo } from 'react';

const PAGE_SIZE = 20;

const ProductSelection = ({ availableModels, setSelectedModel, isLoading = false }) => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);

  // Auto-focus search once models arrive
  useEffect(() => {
    if (!isLoading && availableModels.length > 0) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [isLoading, availableModels.length]);

  // Reset page when query changes
  useEffect(() => { setPage(1); }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter((m) => m.name.toLowerCase().includes(q));
  }, [availableModels, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleKey = (e) => {
    if (e.key === 'Enter' && pageItems.length === 1) {
      setSelectedModel(pageItems[0]);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
        <span className="material-symbols-outlined animate-spin text-3xl text-brand-blue">sync</span>
        <p className="text-sm">Loading models…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search bar */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
            search
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search models…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Models in this category</p>
              {filtered.length === availableModels.length ? (
                <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                  {availableModels.length}
                  <span className="ml-1.5 text-base font-bold text-gray-700">
                    {availableModels.length === 1 ? 'model' : 'models'}
                  </span>
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                    {filtered.length}
                    <span className="mx-1 text-lg font-bold text-gray-400">/</span>
                    <span className="text-xl font-bold text-gray-700">{availableModels.length}</span>
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-gray-600">
                    Showing matches for your search — {availableModels.length} total in category
                  </p>
                </>
              )}
            </div>
            {totalPages > 1 && (
              <p className="text-xs font-semibold text-gray-600">
                Page <span className="tabular-nums text-gray-900">{safePage}</span> of{' '}
                <span className="tabular-nums text-gray-900">{totalPages}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Model list */}
      <div className="flex-1 overflow-y-auto">
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-gray-500">
            <span className="material-symbols-outlined text-4xl mb-3 text-gray-400">
              {query.trim() ? 'search_off' : 'inventory_2'}
            </span>
            {query.trim() ? (
              <>
                <p className="text-sm font-semibold text-gray-800">No models match your search</p>
                <p className="mt-1 max-w-sm text-sm text-gray-600">
                  Try different keywords, or clear the search to see all {availableModels.length} model
                  {availableModels.length !== 1 ? 's' : ''} in this category.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-800">No models in this category</p>
                <p className="mt-1 max-w-sm text-sm text-gray-600">
                  There are no product models loaded for this category yet. Pick another category from the tree on the
                  left.
                </p>
              </>
            )}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {pageItems.map((model, i) => (
                <tr
                  key={model.product_id ?? model.name}
                  onClick={() => setSelectedModel(model)}
                  className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${
                    i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{model.name}</td>
                  <td className="px-4 py-3 text-right w-10">
                    <span className="material-symbols-outlined text-[20px] text-gray-400 align-middle">
                      chevron_right
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 border-t border-gray-200 bg-brand-blue/10 px-4 py-4 sm:justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">chevron_left</span>
            Prev
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '…' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-sm font-medium text-gray-500">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                      p === safePage
                        ? 'border-brand-blue bg-brand-blue text-white shadow-sm'
                        : 'border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
          </div>

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
            <span className="material-symbols-outlined text-[22px] leading-none">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductSelection;
