import { useState, useCallback } from 'react';
import {
  getResearchCompleteSalePriceFollowUp,
  openSalePriceConfirmModalFromFollowUp,
  finalizeResearchRowAfterApply,
} from '../utils/researchCompletionHelpers';
import { buildItemSpecs, buildInitialSearchQuery, logCategoryRuleDecision } from '../utils/negotiationHelpers';

/**
 * Shared state and handlers for the eBay / Cash Converters research overlay panel
 * used by both Negotiation and RepricingNegotiation.
 *
 * @param {Object} opts
 * @param {Array} opts.items - Current negotiation/reprice items array
 * @param {Function} opts.setItems - State setter for items
 * @param {Function} opts.applyEbayResearch - `(item, updatedState) => newItem` (merge research + row pricing when applicable).
 * @param {Function} opts.applyCCResearch - Same contract as applyEbayResearch.
 * @param {Function} opts.applyCGResearch - Same contract as applyEbayResearch (Cash Generator).
 * @param {Function} opts.resolveSalePrice - Sale price resolver; drives getResearchCompleteSalePriceFollowUp.
 * @param {boolean} [opts.readOnly=false] - Reserved for read-only overlay behaviour.
 * @param {boolean} [opts.persistResearchOnComplete=true] - When false, OK/complete does not apply research back to `items` (sandbox / preview).
 * @param {Function} [opts.onResearchPersisted=null] - Optional: `(mergedItem) => void` after `setItems` merges research (e.g. Negotiation manual-offer modals).
 * @param {Function} [opts.onAfterResearchMerge=null] - Optional: `(mergedItem, source) => void` after research is merged and finalized (`source`: `ebay` | `cashConverters` | `cashGenerator`).
 */
export function useResearchOverlay({
  items,
  setItems,
  applyEbayResearch,
  applyCCResearch,
  applyCGResearch = null,
  resolveSalePrice,
  readOnly = false,
  persistResearchOnComplete = true,
  onResearchPersisted = null,
  onAfterResearchMerge = null,
}) {
  void readOnly;
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [cgResearchItem, setCgResearchItem] = useState(null);
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null);

  /**
   * Called immediately when either research form resolves a category (before search starts).
   * Stamps the category onto the item so sibling research forms skip the picker.
   */
  const handleResearchItemCategoryResolved = useCallback((itemId, category) => {
    if (!itemId || !category?.id) return;
    setItems((prev) => prev.map((i) => {
      if (i.id !== itemId) return i;
      // Only update if the item doesn't already have a category id
      if (i.categoryObject?.id) return i;
      const nextItem = { ...i, categoryObject: category };
      logCategoryRuleDecision({
        context: 'research-category-resolved',
        item: nextItem,
        categoryObject: category,
        rule: { source: 'pending-category-margin-load' },
      });
      return nextItem;
    }));
  }, [setItems]);

  const handleResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setResearchItem(null); return; }
    if (updatedState && researchItem && persistResearchOnComplete) {
      const currentItem = items.find(i => i.id === researchItem.id);
      const followUp = getResearchCompleteSalePriceFollowUp(updatedState, currentItem, resolveSalePrice);
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== researchItem.id) return i;
          const afterApply = applyEbayResearch(i, updatedState);
          return finalizeResearchRowAfterApply(
            afterApply,
            updatedState,
            currentItem,
            resolveSalePrice,
            'ebay'
          );
        })
      );
      openSalePriceConfirmModalFromFollowUp(followUp, researchItem, 'ebay', setSalePriceConfirmModal);
      const mergedItem = currentItem
        ? finalizeResearchRowAfterApply(
            applyEbayResearch(currentItem, updatedState),
            updatedState,
            currentItem,
            resolveSalePrice,
            'ebay'
          )
        : null;
      if (mergedItem) {
        onResearchPersisted?.(mergedItem);
        onAfterResearchMerge?.(mergedItem, 'ebay');
      }
    }
    setResearchItem(null);
  }, [researchItem, items, persistResearchOnComplete, setItems, applyEbayResearch, resolveSalePrice, onResearchPersisted, onAfterResearchMerge]);

  const handleCashConvertersResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setCashConvertersResearchItem(null); return; }
    if (updatedState && cashConvertersResearchItem && persistResearchOnComplete) {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);
      const followUp = getResearchCompleteSalePriceFollowUp(updatedState, currentItem, resolveSalePrice);
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== cashConvertersResearchItem.id) return i;
          const afterApply = applyCCResearch(i, updatedState);
          return finalizeResearchRowAfterApply(
            afterApply,
            updatedState,
            currentItem,
            resolveSalePrice,
            'cashConverters'
          );
        })
      );
      openSalePriceConfirmModalFromFollowUp(
        followUp,
        cashConvertersResearchItem,
        'cashConverters',
        setSalePriceConfirmModal
      );
      const mergedItem = currentItem
        ? finalizeResearchRowAfterApply(
            applyCCResearch(currentItem, updatedState),
            updatedState,
            currentItem,
            resolveSalePrice,
            'cashConverters'
          )
        : null;
      if (mergedItem) {
        onResearchPersisted?.(mergedItem);
        onAfterResearchMerge?.(mergedItem, 'cashConverters');
      }
    }
    setCashConvertersResearchItem(null);
  }, [cashConvertersResearchItem, items, persistResearchOnComplete, setItems, applyCCResearch, resolveSalePrice, onResearchPersisted, onAfterResearchMerge]);

  const handleCashGeneratorResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setCgResearchItem(null); return; }
    if (updatedState && cgResearchItem && persistResearchOnComplete && typeof applyCGResearch === 'function') {
      const currentItem = items.find(i => i.id === cgResearchItem.id);
      const followUp = getResearchCompleteSalePriceFollowUp(updatedState, currentItem, resolveSalePrice);
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== cgResearchItem.id) return i;
          const afterApply = applyCGResearch(i, updatedState);
          return finalizeResearchRowAfterApply(
            afterApply,
            updatedState,
            currentItem,
            resolveSalePrice,
            'cashGenerator'
          );
        })
      );
      openSalePriceConfirmModalFromFollowUp(
        followUp,
        cgResearchItem,
        'cashGenerator',
        setSalePriceConfirmModal
      );
      const mergedItem = currentItem
        ? finalizeResearchRowAfterApply(
            applyCGResearch(currentItem, updatedState),
            updatedState,
            currentItem,
            resolveSalePrice,
            'cashGenerator'
          )
        : null;
      if (mergedItem) {
        onResearchPersisted?.(mergedItem);
        onAfterResearchMerge?.(mergedItem, 'cashGenerator');
      }
    }
    setCgResearchItem(null);
  }, [cgResearchItem, items, persistResearchOnComplete, setItems, applyCGResearch, resolveSalePrice, onResearchPersisted, onAfterResearchMerge]);

  return {
    researchItem,
    setResearchItem,
    cashConvertersResearchItem,
    setCashConvertersResearchItem,
    cgResearchItem,
    setCgResearchItem,
    salePriceConfirmModal,
    setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
    handleCashGeneratorResearchComplete,
    handleResearchItemCategoryResolved,
  };
}

/**
 * Build the marketComparisonContext object shared by both Negotiation and RepricingNegotiation
 * for the EbayResearchForm / CashConvertersResearchForm overlays.
 */
export function buildMarketComparisonContext(item) {
  if (!item) return {};
  return {
    cexSalePrice: item.cexSellPrice ?? null,
    ourSalePrice: item.ourSalePrice ?? null,
    ebaySalePrice: item.ebayResearchData?.stats?.median ?? null,
    cashConvertersSalePrice: item.cashConvertersResearchData?.stats?.median ?? null,
    cashGeneratorSalePrice: item.cgResearchData?.stats?.median ?? null,
    itemTitle: item.title || null,
    itemCondition: item.condition || null,
    itemSpecs: item.isCustomCeXItem ? null : buildItemSpecs(item),
    cexSpecs: item.isCustomCeXItem ? buildItemSpecs(item) : null,
    ebaySearchTerm: item.ebayResearchData?.searchTerm || null,
    cashConvertersSearchTerm: item.cashConvertersResearchData?.searchTerm || null,
    cashGeneratorSearchTerm: item.cgResearchData?.searchTerm || null,
  };
}

/**
 * Shared sale-price blur handler factory. Both Negotiation and RepricingNegotiation
 * use identical logic to normalize the user's typed sale price on blur.
 */
export function makeSalePriceBlurHandler(setItems, normalizeExplicitSalePrice, showNotification) {
  return (item) => {
    const quantity = item.quantity || 1;
    setItems(prev => prev.map(i => {
      if (i.id !== item.id) return i;
      const raw = (i.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
      const parsedTotal = parseFloat(raw);
      const next = { ...i };
      delete next.ourSalePriceInput;
      if (raw === '') {
        next.ourSalePrice = '';
      } else if (Number.isNaN(parsedTotal) || parsedTotal <= 0) {
        // Keep prior persisted value and reject invalid/non-positive input.
      } else {
        next.ourSalePrice = String(normalizeExplicitSalePrice(parsedTotal / quantity));
      }
      return next;
    }));
    const rawEntered = String(item.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
    if (rawEntered !== '') {
      const parsedEntered = parseFloat(rawEntered);
      if (!Number.isFinite(parsedEntered) || parsedEntered <= 0) {
        showNotification('Our sale price must be greater than £0', 'error');
      }
    }
  };
}

// Re-export buildInitialSearchQuery for convenience so consumers don't need a second import.
export { buildInitialSearchQuery };
