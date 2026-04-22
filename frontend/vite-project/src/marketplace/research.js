import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { roundOfferPrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import {
  isCeXBackedNegotiationItem,
  resolveOffersSource,
  resolveSuggestedRetailFromResearchStats,
  logCategoryRuleDecision,
  getDisplayOffers,
} from '@/pages/buyer/utils/negotiationHelpers';
import { itemIsCustomForDescriptor } from './descriptors';

/**
 * Merge a marketplace research payload onto a negotiation item — stores the
 * platform's research state, optionally bumps categoryObject, and (for eBay)
 * propagates AI NosPos suggestions onto the row.
 *
 * This is the single implementation that replaces:
 *   - mergeEbayResearchDataIntoItem
 *   - mergeCashConvertersResearchDataIntoItem
 *   - mergeCashGeneratorResearchDataIntoItem
 */
export function mergeResearchDataIntoItem(item, updatedState, descriptor) {
  if (!descriptor?.researchDataKey) return item;

  const aiNos = updatedState?.aiSuggestedNosposStockCategory;
  const hasAiNosposHint =
    descriptor.id === 'ebay' &&
    aiNos &&
    typeof aiNos === 'object' &&
    (aiNos.nosposId != null ||
      (aiNos.fullName != null && String(aiNos.fullName).trim() !== '') ||
      (Array.isArray(aiNos.pathSegments) && aiNos.pathSegments.length > 0));

  const nextItem = {
    ...item,
    [descriptor.researchDataKey]: updatedState,
    ...(updatedState?.resolvedCategory ? { categoryObject: updatedState.resolvedCategory } : {}),
    ...(hasAiNosposHint
      ? {
          aiSuggestedNosposStockCategory: aiNos,
          rawData:
            item.rawData != null && typeof item.rawData === 'object'
              ? { ...item.rawData, aiSuggestedNosposStockCategory: aiNos }
              : { aiSuggestedNosposStockCategory: aiNos },
        }
      : {}),
  };

  logCategoryRuleDecision({
    context: descriptor.logContextComplete,
    item: nextItem,
    categoryObject: nextItem.categoryObject,
    rule: {
      source: descriptor.ruleSourceLabel,
      margins: Array.isArray(updatedState?.buyOffers) ? 'buyOffers-computed' : null,
    },
  });
  return nextItem;
}

/**
 * Rebuild tier offers + selection from a research result, using the row as it was
 * before this research session for classification (`preMergeItem`).
 *
 * Single implementation that replaces applyEbay/CC/CG*CommittedPricingToItem.
 */
export function applyResearchCommittedPricingToItem(
  preMergeItem,
  mergedItem,
  updatedState,
  useVoucherOffers,
  descriptor
) {
  const item = preMergeItem;
  const cexBacked = isCeXBackedNegotiationItem(item);
  const isEbay = descriptor.id === 'ebay';

  // eBay keeps the "only item" short-circuit that forces tier rebuild even when
  // existing offers are present. CC/CG stay conservative (only rebuild when the
  // row currently has no offers).
  const isPlatformOnlyItem =
    isEbay &&
    (itemIsCustomForDescriptor(item, descriptor) ||
      (!cexBacked &&
        item[descriptor.researchDataKey]?.stats &&
        item[descriptor.researchDataKey]?.selectedFilters));

  let newCashOffers = item.cashOffers || [];
  let newVoucherOffers = item.voucherOffers || [];

  const usePlatformOfferTiers =
    resolveOffersSource(item) === descriptor.rrpPriceSourceZone &&
    updatedState?.buyOffers?.length > 0;

  const prefix = descriptor.offerIdPrefix;

  if (usePlatformOfferTiers) {
    newCashOffers = updatedState.buyOffers.slice(0, 4).map((o, idx) => ({
      id: `${prefix}-rrp_${idx + 1}`,
      title: titleForEbayCcOfferIndex(idx),
      price: roundOfferPrice(Number(o.price)),
    }));
    newVoucherOffers = newCashOffers.map((offer) => ({
      id: `${prefix}-rrp-v-${offer.id}`,
      title: offer.title,
      price: toVoucherOfferPrice(offer.price),
    }));
  } else if (updatedState?.buyOffers?.length > 0) {
    const hasExistingOffers =
      (item.cashOffers?.length > 0) || (item.voucherOffers?.length > 0) || (item.offers?.length > 0);

    if (isPlatformOnlyItem) {
      // eBay-only items rebuild regardless of existing offers; price is rounded.
      newCashOffers = updatedState.buyOffers.map((o, idx) => ({
        id: `${prefix}-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(o.price),
      }));
      newVoucherOffers = newCashOffers.map((offer) => ({
        id: `${prefix}-voucher-${offer.id}`,
        title: offer.title,
        price: toVoucherOfferPrice(offer.price),
      }));
    } else if (!cexBacked && !hasExistingOffers) {
      // CC/CG/eBay no-offers-yet path. eBay rounds the price; CC/CG keep raw.
      newCashOffers = updatedState.buyOffers.map((o, idx) => ({
        id: `${prefix}-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: isEbay ? roundOfferPrice(o.price) : Number(o.price),
      }));
      newVoucherOffers = newCashOffers.map((offer) => ({
        id: `${prefix}-voucher-${offer.id}`,
        title: offer.title,
        price: toVoucherOfferPrice(offer.price),
      }));
    }
  }

  const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;
  let newSelectedOfferId = item.selectedOfferId;
  let newManualOffer = item.manualOffer;

  if (updatedState?.selectedOfferIndex !== undefined && updatedState?.selectedOfferIndex !== null) {
    if (updatedState.selectedOfferIndex === 'manual') {
      newSelectedOfferId = 'manual';
      newManualOffer = updatedState.manualOffer || item.manualOffer;
    } else if (typeof updatedState.selectedOfferIndex === 'number') {
      const selectedOffer = displayOffers[updatedState.selectedOfferIndex];
      if (selectedOffer) {
        newSelectedOfferId = selectedOffer.id;
        newManualOffer = '';
      }
    }
  } else {
    if (updatedState?.manualOffer !== undefined) newManualOffer = updatedState.manualOffer;
    const prevOffers = getDisplayOffers(item, useVoucherOffers);
    const prevIdx = prevOffers?.findIndex((o) => o.id === item.selectedOfferId);
    if (prevIdx >= 0 && displayOffers[prevIdx]) newSelectedOfferId = displayOffers[prevIdx].id;
  }

  let next = {
    ...mergedItem,
    cashOffers: newCashOffers,
    voucherOffers: newVoucherOffers,
    offers: displayOffers,
    manualOffer: newManualOffer,
    selectedOfferId: newSelectedOfferId,
  };

  if (item.rrpOffersSource === descriptor.rrpPriceSourceZone) {
    const rrp = resolveSuggestedRetailFromResearchStats(updatedState?.stats);
    if (rrp != null && rrp > 0) {
      next = {
        ...next,
        ourSalePrice: formatOfferPrice(rrp),
        useResearchSuggestedPrice: false,
      };
    }
  }

  return next;
}

/** Full apply (merge + rebuild offers) for a research result. */
export function applyResearchToItem(item, updatedState, useVoucherOffers, descriptor) {
  const merged = mergeResearchDataIntoItem(item, updatedState, descriptor);
  return applyResearchCommittedPricingToItem(item, merged, updatedState, useVoucherOffers, descriptor);
}
