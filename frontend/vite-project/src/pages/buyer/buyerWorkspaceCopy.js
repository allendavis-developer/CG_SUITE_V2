import { useMemo } from 'react';
import useAppStore from '@/store/useAppStore';
import { BUYER_WORKSPACE_BUYING, BUYER_WORKSPACE_UPLOAD } from '@/pages/buyer/buyerWorkspaceConstants';

export { BUYER_WORKSPACE_BUYING, BUYER_WORKSPACE_UPLOAD };

/** Upload module: same flows as buying, but UI copy references RRP tiers only (no “offer” wording). */
export function isUploadBuyerWorkspaceSnapshot(state) {
  return state.mode === 'buyer' && state.buyerWorkspaceKind === 'upload';
}

export function buyerNegotiationHomePath(state = null) {
  const s = state ?? useAppStore.getState();
  return isUploadBuyerWorkspaceSnapshot(s) ? '/upload' : '/buyer';
}

export function useIsUploadBuyerWorkspace() {
  return useAppStore(isUploadBuyerWorkspaceSnapshot);
}

function o(isUpload, offersText, rrpText) {
  return isUpload ? rrpText : offersText;
}

/**
 * Central UI strings for buyer vs upload workspace.
 * @param {boolean} isUpload
 */
export function getBuyerWorkspaceUiCopy(isUpload) {
  return {
    isUpload,
    totalPrimaryLabel: o(isUpload, 'Total Offer', 'Total RRP'),
    priceSourceColumnShort: o(isUpload, 'Offer source', 'RRP source'),
    useAsRrpSourceAction: o(isUpload, 'Use as RRP/offers source', 'Use as RRP source'),
    targetTotalLabel: o(isUpload, 'Target offer', 'Target RRP total'),
    offerMinShort: o(isUpload, 'Offer Min', 'RRP Min'),
    offerMaxShort: o(isUpload, 'Offer Max', 'RRP Max'),
    targetOfferStripLabel: o(isUpload, 'Target Offer', 'Target RRP'),
    targetHintSet: o(isUpload, 'Exact total offer required', 'Exact total RRP required'),
    targetClickTitle: o(isUpload, 'Click to set target offer', 'Click to set target RRP total'),
    negotiationTableHint: o(
      isUpload,
      'Workspace-style columns plus manual offer and customer expectation. Grand total includes these lines.',
      'Workspace-style columns plus manual RRP. Grand total includes these lines.'
    ),
    manualTierShort: o(isUpload, 'Manual offer', 'Manual RRP'),
    clickManualHint: o(isUpload, 'Click manual offer to set', 'Click manual RRP to set'),
    noTiersForAdd: o(isUpload, 'No offers available.', 'No RRP tiers available.'),
    loadingCashTiers: o(isUpload, 'Loading cash offers…', 'Loading cash RRP tiers…'),
    loadingVoucherTiers: o(isUpload, 'Loading voucher offers…', 'Loading credit RRP tiers…'),
    valuationsHeaderCash: o(isUpload, 'Available Trade-In Valuations', 'Available RRP tiers (cash)'),
    valuationsHeaderVoucher: o(isUpload, 'Available Voucher Valuations', 'Available RRP tiers (credit)'),
    ariaManualAmount: o(isUpload, 'Manual offer amount', 'Manual RRP amount'),
    loadingTierRows: o(isUpload, 'Loading offers…', 'Loading RRP tiers…'),
    headerEbayBlurb: o(isUpload, 'RRP, and offer.', 'RRP tiers from research.'),
    otherNosposLeafHint: o(
      isUpload,
      'select a bottom-level row (phone icon, no chevron)—only then can you enter an item name, RRP, and offer.',
      'select a bottom-level row (phone icon, no chevron)—only then can you enter an item name and RRP tiers.'
    ),
    setTargetModalTitle: o(isUpload, 'Set Target Total Offer', 'Set Target Total RRP'),
    setTargetModalBody: o(
      isUpload,
      'What is the target total offer you want to achieve across all items?',
      'What is the target total RRP you want across all items?'
    ),
    setManualModalTitle: o(isUpload, 'Set Manual Offer', 'Set Manual RRP'),
    currentSelectedTierLabel: o(isUpload, 'Current selected offer:', 'Current selected RRP tier:'),
    exceedsSaleModalTitle: o(isUpload, 'Offer exceeds sale price', 'RRP exceeds sale price'),
    exceedsSaleModalLead: o(isUpload, 'Offer exceeds sale price', 'RRP exceeds sale price'),
    proposedAmountLabel: o(isUpload, 'Proposed offer:', 'Proposed RRP:'),
    seniorMgmtManualHint: o(
      isUpload,
      'This is not allowed, enter a new manual offer or cancel.',
      'This is not allowed, enter a new manual RRP or cancel.'
    ),
    enterNewManualCta: o(isUpload, 'Enter new manual offer', 'Enter new manual RRP'),
    marginAppliedTitle: o(isUpload, 'Manual Offer Applied', 'Manual RRP applied'),
    marginAppliedManualLabel: o(isUpload, 'Manual offer', 'Manual RRP'),
    blockedRestrictedLead: o(isUpload, 'Offer restricted for this customer', 'RRP tier restricted'),
    blockedValueLabel: o(isUpload, 'Offer value:', 'RRP value:'),
    manualOfferCardLabel: o(isUpload, 'Manual Offer', 'Manual RRP'),
    addWithTierTitle: o(isUpload, 'Add item with this offer', 'Add item with this RRP tier'),
    selectTierTitle: o(isUpload, 'Select this offer', 'Select this RRP tier'),
    researchManualBlockedTitle: o(isUpload, 'Manual offer', 'Manual RRP'),
    finalizeMissingRequest: o(
      isUpload,
      'Cannot finalize: Request ID is missing. Please return to the buyer page and start a new negotiation.',
      'Cannot finalize: Request ID is missing. Please return to the upload workspace and start again.'
    ),
    finalizeAlreadyDone: o(
      isUpload,
      'This request has already been finalized. Please start a new negotiation from the buyer page.',
      'This request has already been finalized. Please start again from the upload workspace.'
    ),
    applyManualNotAllowed: o(
      isUpload,
      'This is not allowed, enter a new manual offer or cancel.',
      'This is not allowed, enter a new manual RRP or cancel.'
    ),
    resetModuleToast: o(isUpload, 'Buying module reset', 'Upload module reset'),
    switchCopyVoucherBold: o(isUpload, 'credit pricing', 'voucher prices'),
    switchCopyCashBold: o(isUpload, 'cash pricing', 'cash prices'),
    switchCopyLead: o(
      isUpload,
      'This will switch all offers to',
      'This will switch all RRP tiers to'
    ),
    transactionInfoEbayVoucherNote: o(
      isUpload,
      'eBay items: Cash offers +10%',
      'eBay items: Cash RRP tiers +10%'
    ),
 };
}

export function blockedAuthSlotLabels(isUpload) {
  return isUpload
    ? {
        offer1: '1st RRP',
        offer2: '2nd RRP',
        offer3: '3rd RRP',
        offer4: '4th RRP',
        manual: 'Manual RRP entry',
      }
    : {
        offer1: '1st Offer',
        offer2: '2nd Offer',
        offer3: '3rd Offer',
        offer4: '4th Offer',
        manual: 'Manual Offer Entry',
      };
}

export function cexDefaultTierTitles(isUpload) {
  return isUpload ? ['1st RRP', '2nd RRP', '3rd RRP'] : ['First Offer', 'Second Offer', 'Third Offer'];
}

export function finalizePickTierMessage(isUpload, itemTitle) {
  const t = itemTitle || 'Unknown Item';
  return isUpload
    ? `Please select an RRP tier for item: ${t}`
    : `Please select an offer for item: ${t}`;
}

export function finalizeManualInvalidMessage(isUpload, itemTitle) {
  const t = itemTitle || 'Unknown Item';
  return isUpload
    ? `Please enter a valid manual RRP for item: ${t}`
    : `Please enter a valid manual offer for item: ${t}`;
}

export function finalizeTargetMismatchMessage(isUpload, totalOfferPrice, relationText, targetFixed) {
  return isUpload
    ? `Cannot book for testing: grand total £${totalOfferPrice.toFixed(2)} ${relationText} the target RRP total of £${targetFixed.toFixed(2)}.`
    : `Cannot book for testing: grand total £${totalOfferPrice.toFixed(2)} ${relationText} the target offer of £${targetFixed.toFixed(2)}.`;
}

export function finalizeMissingRequestMessage(isUpload) {
  return getBuyerWorkspaceUiCopy(isUpload).finalizeMissingRequest;
}

export function finalizeAlreadyDoneMessage(isUpload) {
  return getBuyerWorkspaceUiCopy(isUpload).finalizeAlreadyDone;
}

export function useBuyerWorkspaceUiCopy() {
  const isUpload = useIsUploadBuyerWorkspace();
  return useMemo(() => getBuyerWorkspaceUiCopy(isUpload), [isUpload]);
}
