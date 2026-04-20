/**
 * Shared logic for research completion flows (Negotiation + RepricingNegotiation).
 *
 * Architecture: one function decides both (a) whether the row's committed pricing (tiers +
 * selection) must wait for SalePriceConfirmModal and (b) whether / how to open that modal.
 * Negotiation uses the same result to choose research merge mode (`dataOnly` vs `full`), so
 * the modal and merge path cannot drift.
 */

import { roundSalePrice, normalizeExplicitSalePrice } from '@/utils/helpers';
import { NEGOTIATION_ROW_CONTEXT } from '../rowContextZones';

/** One-shot per completion: typed upload/repricing RRP from research shell (not persisted in research blob). */
function parsedUploadRrpOverridePerUnit(updatedState) {
  const v = updatedState?.uploadRrpOverridePerUnit;
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function rrpZoneFromResearchCompleteSource(source) {
  if (source === 'ebay') return NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
  if (source === 'cashGenerator') return NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR;
  return NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
}

/**
 * After merging research `stats` onto the row: if there is no confirm modal (including when the
 * row had no committed sale price yet), stamp suggested RRP + RRP source from this channel.
 *
 * @param {Object} itemRow - Row after `apply*Research`
 * @param {Object} updatedState - Research result with `stats.suggestedPrice`
 * @param {Object|null} priorItemBeforeApply - Row before this merge (for prior committed price)
 * @param {Function} resolveSalePrice - (item) => number|null
 * @param {'ebay'|'cashConverters'|'cashGenerator'} source
 */
export function finalizeResearchRowAfterApply(
  itemRow,
  updatedState,
  priorItemBeforeApply,
  resolveSalePrice,
  source
) {
  const followUp = getResearchCompleteSalePriceFollowUp(updatedState, priorItemBeforeApply, resolveSalePrice);
  if (followUp.modalSpec != null) return itemRow;

  const override = parsedUploadRrpOverridePerUnit(updatedState);
  if (override != null) {
    const next = {
      ...itemRow,
      ourSalePrice: String(normalizeExplicitSalePrice(override)),
      rrpOffersSource: rrpZoneFromResearchCompleteSource(source),
    };
    delete next.ourSalePriceInput;
    return next;
  }

  const sp = updatedState?.stats?.suggestedPrice;
  if (sp == null) return itemRow;
  const n = Number(sp);
  if (!Number.isFinite(n) || n <= 0) return itemRow;
  const hadPriorCommitted =
    priorItemBeforeApply != null && resolveSalePrice(priorItemBeforeApply) != null;
  if (hadPriorCommitted) return itemRow;
  const next = {
    ...itemRow,
    ourSalePrice: String(roundSalePrice(n)),
    rrpOffersSource: rrpZoneFromResearchCompleteSource(source),
  };
  delete next.ourSalePriceInput;
  return next;
}

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
  if (parsedUploadRrpOverridePerUnit(updatedState) != null) {
    return { deferCommittedPricing: false, modalSpec: null };
  }

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
        priorRrpOffersSource: currentItem?.rrpOffersSource,
        priorOffersSource: currentItem?.offersSource,
      },
    };
  }
  /** No committed sale price: apply suggested research RRP in-row without confirmation modal. */
  if (oldSalePricePerUnit == null) {
    return { deferCommittedPricing: false, modalSpec: null };
  }
  const hasMeaningfulChange = Math.abs(newSalePricePerUnit - oldSalePricePerUnit) > 0.0005;
  if (hasMeaningfulChange) {
    return {
      deferCommittedPricing: true,
      modalSpec: {
        oldPricePerUnit: oldSalePricePerUnit,
        newPricePerUnit: newSalePricePerUnit,
        priorRrpOffersSource: currentItem?.rrpOffersSource,
        priorOffersSource: currentItem?.offersSource,
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
