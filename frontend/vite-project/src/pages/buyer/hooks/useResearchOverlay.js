import { useState, useCallback } from 'react';
import { maybeShowSalePriceConfirm } from '../utils/researchCompletionHelpers';
import { buildItemSpecs, buildInitialSearchQuery } from '../utils/negotiationHelpers';

/**
 * Shared state and handlers for the eBay / Cash Converters research overlay panel
 * used by both Negotiation and RepricingNegotiation.
 *
 * @param {Object} opts
 * @param {Array} opts.items - Current negotiation/reprice items array
 * @param {Function} opts.setItems - State setter for items
 * @param {Function} opts.applyEbayResearch - (item, updatedState) => newItem. Called to merge eBay research data.
 * @param {Function} opts.applyCCResearch - (item, updatedState) => newItem. Called to merge CC research data.
 * @param {Function} opts.resolveSalePrice - Sale price resolver function for maybeShowSalePriceConfirm.
 * @param {boolean} [opts.readOnly=false] - Whether the overlay is read-only (no in-form edits).
 * @param {boolean} [opts.persistResearchOnComplete=true] - When false, OK/complete does not apply research back to `items` (sandbox / preview).
 */
export function useResearchOverlay({
  items,
  setItems,
  applyEbayResearch,
  applyCCResearch,
  resolveSalePrice,
  readOnly = false,
  persistResearchOnComplete = true,
}) {
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null);

  const handleResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setResearchItem(null); return; }
    if (updatedState && researchItem && persistResearchOnComplete) {
      const currentItem = items.find(i => i.id === researchItem.id);
      setItems(prev => prev.map(i => {
        if (i.id !== researchItem.id) return i;
        return applyEbayResearch(i, updatedState);
      }));
      maybeShowSalePriceConfirm(updatedState, currentItem, researchItem, setSalePriceConfirmModal, resolveSalePrice, 'ebay');
    }
    setResearchItem(null);
  }, [researchItem, items, persistResearchOnComplete, setItems, applyEbayResearch, resolveSalePrice]);

  const handleCashConvertersResearchComplete = useCallback((updatedState) => {
    if (updatedState?.cancel) { setCashConvertersResearchItem(null); return; }
    if (updatedState && cashConvertersResearchItem && persistResearchOnComplete) {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);
      setItems(prev => prev.map(i => {
        if (i.id !== cashConvertersResearchItem.id) return i;
        return applyCCResearch(i, updatedState);
      }));
      maybeShowSalePriceConfirm(updatedState, currentItem, cashConvertersResearchItem, setSalePriceConfirmModal, resolveSalePrice, 'cashConverters');
    }
    setCashConvertersResearchItem(null);
  }, [cashConvertersResearchItem, items, persistResearchOnComplete, setItems, applyCCResearch, resolveSalePrice]);

  return {
    researchItem,
    setResearchItem,
    cashConvertersResearchItem,
    setCashConvertersResearchItem,
    salePriceConfirmModal,
    setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
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
