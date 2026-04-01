/**
 * Customer offer rules utility.
 *
 * Determines which offer slots require senior-management authorisation
 * based on customer type (new / low / mid / high cancel rate).
 */

export const OFFER_SLOTS = ['offer1', 'offer2', 'offer3', 'offer4', 'manual'];

export const CUSTOMER_TYPE_LABELS = {
  new_customer: 'New Customer',
  low_cr: 'Low Cancel Rate',
  mid_cr: 'Mid Cancel Rate',
  high_cr: 'High Cancel Rate',
};

/**
 * Classify a customer into one of the 4 types based on their data and the
 * configured cancel-rate thresholds.
 *
 * @param {object} customerData  - Merged customer object (from Negotiation state)
 * @param {object} settings      - CustomerRuleSettings: { low_cr_max_pct, mid_cr_max_pct }
 * @returns {'new_customer'|'low_cr'|'mid_cr'|'high_cr'}
 */
export function getCustomerType(customerData, settings) {
  if (customerData?.isNewCustomer) return 'new_customer';

  const cr = parseFloat(customerData?.cancelRate ?? 0);
  const lowMax = parseFloat(settings?.low_cr_max_pct ?? 20);
  const midMax = parseFloat(settings?.mid_cr_max_pct ?? 40);

  if (cr <= lowMax) return 'low_cr';
  if (cr <= midMax) return 'mid_cr';
  return 'high_cr';
}

/**
 * Return the set of offer slot keys that are blocked (require authorisation)
 * for the given customer.
 *
 * @param {object} customerData
 * @param {object} rules   - { new_customer: {...}, low_cr: {...}, ... }
 * @param {object} settings
 * @returns {Set<string>}  - e.g. new Set(['offer1', 'offer2', 'manual'])
 */
export function getBlockedOfferSlots(customerData, rules, settings) {
  if (!rules || !settings) return new Set();

  const type = getCustomerType(customerData, settings);
  const rule = rules[type];
  if (!rule) return new Set();

  const blocked = new Set();
  if (!rule.allow_offer_1) blocked.add('offer1');
  if (!rule.allow_offer_2) blocked.add('offer2');
  if (!rule.allow_offer_3) blocked.add('offer3');
  if (!rule.allow_offer_4) blocked.add('offer4');
  if (!rule.allow_manual) blocked.add('manual');
  return blocked;
}

/**
 * Map an offer object's id (e.g. "cash_1", "voucher_2") to its slot key.
 * Also handles "manual" directly.
 */
export function offerIdToSlot(offerId) {
  if (!offerId) return null;
  if (offerId === 'manual') return 'manual';
  const s = String(offerId);
  // Offer ids are like "cash_1", "voucher_3", "ebay-cash_4", "jew-cash_2"
  const match = s.match(/_(\d)$/);
  if (match) return `offer${match[1]}`;
  // Legacy: ebay-cash-0, ebay-cash-173-2, cc-cash-… (0-based index before _4 suffix migration)
  const legacy = s.match(/^(?:ebay|cc)-(?:cash|voucher)-(?:(\d+)-)?(\d+)$/);
  if (legacy) {
    const idx = Number(legacy[2]);
    if (Number.isFinite(idx)) return `offer${idx + 1}`;
  }
  return null;
}

/**
 * True when a slot is globally blocked for the customer AND not already
 * authorised for this specific item.
 */
export function isBlockedForItem(slot, blockedOfferSlots, item) {
  if (!slot || !blockedOfferSlots?.has?.(slot)) return false;
  const authorised = Array.isArray(item?.authorisedOfferSlots) ? item.authorisedOfferSlots : [];
  return !authorised.includes(slot);
}

/**
 * True when committing a manual offer (e.g. from research) must go through senior auth first.
 * - Not authorised for `manual`, or
 * - Item already has a persisted manual offer selected (re-auth before changing / re-applying).
 *
 * When `item` is null (no line context), returns false so flows without a handler can still commit.
 */
export function manualSlotCommitRequiresAuthorisation(blockedOfferSlots, item) {
  if (!blockedOfferSlots?.has('manual')) return false;
  if (!item) return false;
  const authorised = Array.isArray(item.authorisedOfferSlots) && item.authorisedOfferSlots.includes('manual');
  if (!authorised) return true;
  const hasExistingManual =
    item.selectedOfferId === 'manual' &&
    item.manualOffer != null &&
    String(item.manualOffer).trim() !== '';
  return Boolean(hasExistingManual);
}

/**
 * Manual-slot senior auth is only valid while manual is the selected offer.
 * When switching to any tier offer, revoke `manual` from authorised slots so
 * entering manual again requires a new approval.
 *
 * @returns {Record<string, unknown>} Fields to merge onto the item (may be empty)
 */
export function revokeManualOfferAuthorisationIfSwitchingAway(item, nextSelectedOfferId) {
  if (!item || nextSelectedOfferId === 'manual') return {};
  const slots = Array.isArray(item.authorisedOfferSlots) ? item.authorisedOfferSlots : [];
  if (!slots.includes('manual')) return {};
  const authorisedOfferSlots = slots.filter((s) => s !== 'manual');
  const patch = { authorisedOfferSlots };
  if (authorisedOfferSlots.length === 0) patch.seniorMgmtApprovedBy = null;
  return patch;
}
