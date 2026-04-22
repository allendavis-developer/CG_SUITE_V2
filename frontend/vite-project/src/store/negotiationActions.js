import {
  fetchAllCategoriesFlat,
  fetchCeXProductPrices,
} from '@/services/api';
import { getDataFromListingPage } from '@/services/extensionClient';
import { matchCexCategoryNameToDb } from '@/utils/cexCategoryMatch';
import { resolveInternalProductCategoryByAi } from '@/services/aiCategoryPathCascade';
import { getActiveHandler } from '@/workspace/handlers';

/**
 * Async workspace lifecycles extracted from useAppStore so the store is state
 * first and side-effect second. Each function takes the store's `{ set, get }`
 * as its first argument.
 *
 * These are the two biggest offenders the SYSTEM_MAP flagged:
 *   - handleAddFromCeX: 140 lines of AI category cascade + price fetch + UI sync
 *   - selectCartItem:   ~130 lines of per-item-kind price hydration
 */

export async function runHandleAddFromCeX(
  { set },
  { showNotification, searchQuery, awaitPricing = true } = {}
) {
  const trimmedQuery =
    searchQuery != null && String(searchQuery).trim() !== ''
      ? String(searchQuery).trim()
      : undefined;
  set({ cexLoading: true, cexProductData: null });
  try {
    const data = await getDataFromListingPage('CeX', trimmedQuery);
    if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
      const product = data.results[0];
      let categoryObject = product?.category
        ? { name: product.category, path: [product.category] }
        : null;
      let aiInternalCategoryFromCascade = false;
      try {
        const flat = await fetchAllCategoriesFlat();
        const aiResolved = await resolveInternalProductCategoryByAi({
          item: {
            title: product?.title || 'CeX Product',
            subtitle: product?.category || '',
            variantName: product?.title || undefined,
            category: product?.category || 'CeX',
            categoryObject,
            isCustomCeXItem: true,
            cexProductData: product,
          },
          allCategoriesFlat: flat,
          logTag: '[CG Suite][AiCategory][CeXAddFromExtension]',
        });
        if (aiResolved?.categoryObject?.id != null) {
          categoryObject = aiResolved.categoryObject;
          aiInternalCategoryFromCascade = true;
          if (typeof console !== 'undefined') {
            console.log('[CG Suite][CategoryRule]', {
              context: 'cex-auto-resolved-via-ai-cascade',
              categoryName: categoryObject?.name ?? null,
              categoryId: categoryObject?.id ?? null,
              categoryPath: categoryObject?.path ?? null,
              rawCexCategoryName: product?.category ?? null,
            });
          }
        } else {
          const matched = matchCexCategoryNameToDb(product?.category, flat);
          if (matched) categoryObject = matched;
        }
      } catch {
        // best effort: keep category text-only object
      }

      const listingPageUrl = data.listingPageUrl;
      const baseMerged = {
        ...product,
        categoryObject,
        aiInternalCategoryFromCascade,
        listingPageUrl,
      };

      set({ cexProductData: baseMerged, cexLoading: false });

      const payload = {
        sellPrice: product.sellPrice ?? product.price,
        tradeInCash: product.tradeInCash ?? 0,
        tradeInVoucher: product.tradeInVoucher ?? 0,
        title: product.title,
        category: product.category,
        categoryId: categoryObject?.id ?? null,
        image: product.image,
        id: product.id,
      };

      const logCexMerged = (merged) => {
        if (typeof console === 'undefined') return;
        const ref = merged?.referenceData || {};
        console.log('[CG Suite][CategoryRule]', {
          context: 'cex-product-loaded-from-extension',
          categoryName: merged?.categoryObject?.name ?? merged?.category ?? null,
          categoryId: merged?.categoryObject?.id ?? null,
          categoryPath: merged?.categoryObject?.path ?? (merged?.category ? [merged.category] : null),
          rule: {
            source: 'cex-reference-rule',
            firstOfferPctOfCex: ref.first_offer_pct_of_cex ?? ref.firstOfferPctOfCex ?? null,
            secondOfferPctOfCex: ref.second_offer_pct_of_cex ?? ref.secondOfferPctOfCex ?? null,
            thirdOfferPctOfCex: ref.third_offer_pct_of_cex ?? ref.thirdOfferPctOfCex ?? null,
            cexBasedSalePrice: ref.cex_based_sale_price ?? null,
          },
        });
      };

      const applyPricing = async () => {
        const priceData = await fetchCeXProductPrices(payload);
        const merged = {
          ...product,
          ...priceData,
          categoryObject,
          aiInternalCategoryFromCascade,
          listingPageUrl,
        };
        set((state) => {
          const cur = state.cexProductData;
          if (cur?.id != null && product?.id != null && String(cur.id) !== String(product.id)) {
            return state;
          }
          return { cexProductData: merged };
        });
        logCexMerged(merged);
        return merged;
      };

      if (awaitPricing) {
        try {
          const merged = await applyPricing();
          showNotification?.('CeX product loaded', 'success');
          return merged;
        } catch (err) {
          console.error('[Store] fetchCeXProductPrices error:', err);
          showNotification?.(err?.message || 'Could not load pricing rules', 'warning');
          return baseMerged;
        }
      }

      showNotification?.('CeX product loaded', 'success');
      void applyPricing().catch((err) => {
        console.error('[Store] fetchCeXProductPrices error:', err);
        showNotification?.(err?.message || 'Could not load pricing rules — offers may be incomplete', 'warning');
      });
      return baseMerged;
    } else if (data?.cancelled) {
      return null;
    } else {
      showNotification?.(data?.error || 'No data returned', 'error');
      return null;
    }
  } catch (err) {
    console.error('[Store] handleAddFromCeX error:', err);
    showNotification?.(err?.message || 'Extension communication failed', 'error');
    return null;
  } finally {
    set({ cexLoading: false });
  }
}

/**
 * Thin dispatcher: cart-item selection differs between buyer (toggle-off on
 * re-click, full clear) and list workspaces (no toggle). Each module owns
 * its own selectCartItem implementation in /workspace/handlers/.
 */
export async function runSelectCartItem({ set, get }, item) {
  await getActiveHandler(get()).selectCartItem({ set, get }, item);
}
