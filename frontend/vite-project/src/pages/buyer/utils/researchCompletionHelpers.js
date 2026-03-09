/**
 * Shared logic for research completion flows (Negotiation + RepricingNegotiation).
 * When research returns a new suggested sale price, decide whether to show the
 * "Keep current or update?" modal.
 *
 * @param {Object} updatedState - Research form result (e.g. { stats: { suggestedPrice } })
 * @param {Object|null} currentItem - The item being updated
 * @param {Object} researchItem - The item that was researched (for itemId)
 * @param {Function} setSalePriceConfirmModal - State setter for modal
 * @param {Function} resolveOurSalePrice - (item) => number|null
 * @param {'ebay'|'cashConverters'} source
 */
export function maybeShowSalePriceConfirm(
  updatedState,
  currentItem,
  researchItem,
  setSalePriceConfirmModal,
  resolveOurSalePrice,
  source
) {
  const oldSalePricePerUnit = currentItem ? resolveOurSalePrice(currentItem) : null;
  const newSalePricePerUnit =
    updatedState?.stats?.suggestedPrice != null
      ? Number(updatedState.stats.suggestedPrice)
      : null;

  if (newSalePricePerUnit == null || Number.isNaN(newSalePricePerUnit)) return;

  const hasMeaningfulChange =
    oldSalePricePerUnit == null || Math.abs(newSalePricePerUnit - oldSalePricePerUnit) > 0.0005;

  if (hasMeaningfulChange) {
    setSalePriceConfirmModal({
      itemId: researchItem.id,
      oldPricePerUnit: oldSalePricePerUnit,
      newPricePerUnit: newSalePricePerUnit,
      source,
    });
  }
}
