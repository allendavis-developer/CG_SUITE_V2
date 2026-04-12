/**
 * Shared logic for research completion flows (Negotiation + RepricingNegotiation).
 *
 * Architecture: one function decides both (a) whether the row's committed pricing (tiers +
 * selection) must wait for SalePriceConfirmModal and (b) whether / how to open that modal.
 * Negotiation uses the same result to choose research merge mode (`dataOnly` vs `full`), so
 * the modal and merge path cannot drift.
 */

/**
 * @param {Object} updatedState - Research form result (e.g. { stats: { suggestedPrice } })
 * @param {Object|null} currentItem - The row before this merge
 * @param {Function} resolveOurSalePrice - (item) => number|null
 * @returns {{ deferCommittedPricing: boolean, modalSpec: Object|null }}
 *   `modalSpec` is spread into modal state (parent adds itemId + source).
 */
export function getResearchCompleteSalePriceFollowUp(
  updatedState,
  currentItem,
  resolveOurSalePrice
) {
  const oldSalePricePerUnit = currentItem ? resolveOurSalePrice(currentItem) : null;
  const newSalePricePerUnit =
    updatedState?.stats?.suggestedPrice != null
      ? Number(updatedState.stats.suggestedPrice)
      : null;

  if (newSalePricePerUnit == null || Number.isNaN(newSalePricePerUnit)) {
    return { deferCommittedPricing: false, modalSpec: null };
  }
  if (newSalePricePerUnit <= 0) {
    return {
      deferCommittedPricing: false,
      modalSpec: {
        zeroSuggestedPrice: true,
        oldPricePerUnit: oldSalePricePerUnit,
        newPricePerUnit: newSalePricePerUnit,
      },
    };
  }
  const hasMeaningfulChange =
    oldSalePricePerUnit == null || Math.abs(newSalePricePerUnit - oldSalePricePerUnit) > 0.0005;
  if (hasMeaningfulChange) {
    return {
      deferCommittedPricing: true,
      modalSpec: {
        oldPricePerUnit: oldSalePricePerUnit,
        newPricePerUnit: newSalePricePerUnit,
      },
    };
  }
  return { deferCommittedPricing: false, modalSpec: null };
}

/**
 * Opens the sale-price confirm modal when getResearchCompleteSalePriceFollowUp returned modalSpec.
 */
export function openSalePriceConfirmModalFromFollowUp(
  followUp,
  researchItem,
  source,
  setSalePriceConfirmModal
) {
  if (!followUp?.modalSpec || !researchItem) return;
  setSalePriceConfirmModal({
    itemId: researchItem.id,
    source,
    ...followUp.modalSpec,
  });
}
