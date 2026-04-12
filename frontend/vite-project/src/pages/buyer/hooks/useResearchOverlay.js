import { useState, useCallback } from 'react';
import {
  getResearchCompleteSalePriceFollowUp,
  openSalePriceConfirmModalFromFollowUp,
} from '../utils/researchCompletionHelpers';
import { buildItemSpecs, buildInitialSearchQuery, logCategoryRuleDecision } from '../utils/negotiationHelpers';

/** @typedef {'full' | 'dataOnly'} ResearchMergeMode */

/**
 * Shared state and handlers for the eBay / Cash Converters research overlay panel
 * used by both Negotiation and RepricingNegotiation.
 *
 * @param {Object} opts
 * @param {Array} opts.items - Current negotiation/reprice items array
 * @param {Function} opts.setItems - State setter for items
 * @param {Function} opts.applyEbayResearch - `(item, updatedState, mode?) => newItem`. Negotiation passes `dataOnly` (research blob only) or `full` (blob + tiers); repricing ignores mode.
 * @param {Function} opts.applyCCResearch - Same contract as applyEbayResearch.
 * @param {Function} opts.resolveSalePrice - Sale price resolver; drives getResearchCompleteSalePriceFollowUp.
 * @param {boolean} [opts.readOnly=false] - Reserved for read-only overlay behaviour.
 * @param {boolean} [opts.persistResearchOnComplete=true] - When false, OK/complete does not apply research back to `items` (sandbox / preview).
 * @param {Function} [opts.onResearchPersisted=null] - Optional: `(mergedItem) => void` after `setItems` merges research (e.g. Negotiation manual-offer modals).
 * @param {Function} [opts.onAfterEbayResearchMerge=null] - Optional: `(mergedItem) => void` after eBay research is merged (e.g. NosPos stock AI).
 */
export function useResearchOverlay({
  items,
  setItems,
  applyEbayResearch,
  applyCCResearch,
  resolveSalePrice,
  readOnly = false,
  persistResearchOnComplete = true,
  onResearchPersisted = null,
  onAfterEbayResearchMerge = null,
}) {
  void readOnly;
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
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
      /** @type {ResearchMergeMode} */
      const mode = followUp.deferCommittedPricing ? 'dataOnly' : 'full';
      const mergedItem = currentItem ? applyEbayResearch(currentItem, updatedState, mode) : null;
      setItems(prev => prev.map(i => {
        if (i.id !== researchItem.id) return i;
        return applyEbayResearch(i, updatedState, mode);
      }));
      openSalePriceConfirmModalFromFollowUp(followUp, researchItem, 'ebay', setSalePriceConfirmModal);
      if (mergedItem) {
        onResearchPersisted?.(mergedItem);
        onAfterEbayResearchMerge?.(mergedItem);
      }
    }
    setResearchItem(null);
  }, [researchItem, items, persistResearchOnComplete, setItems, applyEbayResearch, resolveSalePrice, onResearchPersisted, onAfterEbayResearchMerge]);

  const handleCashConvertersResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setCashConvertersResearchItem(null); return; }
    if (updatedState && cashConvertersResearchItem && persistResearchOnComplete) {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);
      const followUp = getResearchCompleteSalePriceFollowUp(updatedState, currentItem, resolveSalePrice);
      /** @type {ResearchMergeMode} */
      const mode = followUp.deferCommittedPricing ? 'dataOnly' : 'full';
      const mergedItem = currentItem ? applyCCResearch(currentItem, updatedState, mode) : null;
      setItems(prev => prev.map(i => {
        if (i.id !== cashConvertersResearchItem.id) return i;
        return applyCCResearch(i, updatedState, mode);
      }));
      openSalePriceConfirmModalFromFollowUp(
        followUp,
        cashConvertersResearchItem,
        'cashConverters',
        setSalePriceConfirmModal
      );
      if (mergedItem) onResearchPersisted?.(mergedItem);
    }
    setCashConvertersResearchItem(null);
  }, [cashConvertersResearchItem, items, persistResearchOnComplete, setItems, applyCCResearch, resolveSalePrice, onResearchPersisted]);

  return {
    researchItem,
    setResearchItem,
    cashConvertersResearchItem,
    setCashConvertersResearchItem,
    salePriceConfirmModal,
    setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
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
    itemTitle: item.title || null,
    itemCondition: item.condition || null,
    itemSpecs: item.isCustomCeXItem ? null : buildItemSpecs(item),
    cexSpecs: item.isCustomCeXItem ? buildItemSpecs(item) : null,
    ebaySearchTerm: item.ebayResearchData?.searchTerm || null,
    cashConvertersSearchTerm: item.cashConvertersResearchData?.searchTerm || null,
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
