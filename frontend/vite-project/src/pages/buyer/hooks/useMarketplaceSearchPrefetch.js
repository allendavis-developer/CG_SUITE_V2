import { useEffect, useRef } from 'react';
import { summariseNegotiationItemForAi } from '@/services/aiCategoryPathCascade';
import { suggestMarketplaceResearchSearchTerm } from '@/services/aiCategoryService';

/**
 * For lines that are not add-from-eBay, precomputes a marketplace search hint in the background
 * as soon as the row exists on the quote, and stores it on the item as
 * `marketplaceSuggestedSearchPrefetch: { state, term?, error? }`.
 * The search-confirm dialog reads this so the user does not wait on open.
 */
export function useMarketplaceSearchPrefetch(items, setItems) {
  const inflightIdsRef = useRef(new Set());

  useEffect(() => {
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      if (!item?.id || item.isRemoved) continue;
      if (item.isCustomEbayItem === true) continue;
      if (item.isCustomCashConvertersItem === true) continue;
      if (item.isCustomCashGeneratorItem === true) continue;

      const p = item.marketplaceSuggestedSearchPrefetch;
      if (p?.state === 'ready' || p?.state === 'error' || p?.state === 'pending') continue;

      const idStr = String(item.id);
      if (inflightIdsRef.current.has(idStr)) continue;

      inflightIdsRef.current.add(idStr);

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, marketplaceSuggestedSearchPrefetch: { state: 'pending' } } : i
        )
      );

      const itemId = item.id;
      (async () => {
        try {
          const summary = summariseNegotiationItemForAi(item);
          const res = await suggestMarketplaceResearchSearchTerm({ item: summary });
          const term = res.searchTerm != null ? String(res.searchTerm).trim() : '';
          if (
            typeof console !== 'undefined' &&
            import.meta.env.DEV === true &&
            import.meta.env.VITE_CG_SUITE_VERBOSE_LOGS === '1'
          ) {
            console.log('[CG Suite][MarketplaceSearchTerm]', {
              provider: res.provider,
              promptSystem: res.debug?.systemPrompt ?? null,
              promptUser: res.debug?.userPrompt ?? null,
              rawModelOutput: res.debug?.rawModelOutput ?? null,
              searchTerm: term || null,
              prefetch: true,
            });
          }
          if (!term) {
            setItems((prev) =>
              prev.map((i) =>
                i.id === itemId
                  ? {
                      ...i,
                      marketplaceSuggestedSearchPrefetch: {
                        state: 'error',
                        error: 'No suggestion returned.',
                      },
                    }
                  : i
              )
            );
            return;
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? { ...i, marketplaceSuggestedSearchPrefetch: { state: 'ready', term } }
                : i
            )
          );
        } catch (e) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    marketplaceSuggestedSearchPrefetch: {
                      state: 'error',
                      error: e?.message || 'Could not load suggestion.',
                    },
                  }
                : i
            )
          );
        } finally {
          inflightIdsRef.current.delete(idStr);
        }
      })();
    }
  }, [items, setItems]);
}
