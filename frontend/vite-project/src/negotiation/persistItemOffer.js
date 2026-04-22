import { normalizeExplicitSalePrice } from '@/utils/helpers';
import { updateRequestItemOffer } from '@/services/api';

// Parse a GBP-ish user input ("£1,234.50", 1234.5, "1234") → number or null.
function parseGbp(value) {
  if (value == null || value === '') return null;
  const parsed = parseFloat(String(value).replace(/[£,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOffersJson(offers) {
  if (!Array.isArray(offers)) return [];
  return offers.map((o) => ({
    id: o.id,
    title: o.title,
    price: normalizeExplicitSalePrice(o.price),
  }));
}

/**
 * The ONE place offer persistence is formatted.
 *
 * Converts a UI-shape patch into the backend snake_case payload consumed by
 * PATCH /request-items/:id/update-offer/. Fields absent from `patch` are
 * absent from the payload (partial updates are supported).
 *
 * Supported UI-shape keys:
 *   - selectedOfferId        → selected_offer_id + manual_offer_used
 *   - manualOffer            → manual_offer_gbp (or cleared-to-null when blank)
 *   - ourSalePrice           → our_sale_price_at_negotiation (null if <= 0)
 *   - cashOffers / voucherOffers → cash_offers_json / voucher_offers_json
 *   - customerExpectation    → customer_expectation_gbp (null if blank)
 *   - quantity               → quantity
 *   - seniorMgmtApprovedBy   → senior_mgmt_approved_by
 *
 * Options:
 *   - manualOfferOnlyWhenSelected: if true (default), manual_offer_gbp is null
 *     unless selectedOfferId === 'manual'. Matches the jewellery workspace
 *     persistence contract. Set false for the "always echo the latest manual
 *     offer figure" pattern used by per-field edits in the store.
 */
export function buildItemOfferPayload(patch, { manualOfferOnlyWhenSelected = false } = {}) {
  if (!patch || typeof patch !== 'object') return {};
  const payload = {};

  if (patch.selectedOfferId !== undefined) {
    payload.selected_offer_id = patch.selectedOfferId;
    payload.manual_offer_used = patch.selectedOfferId === 'manual';
  }

  if (patch.manualOffer !== undefined) {
    if (patch.manualOffer === '' || patch.manualOffer == null) {
      payload.manual_offer_gbp = null;
    } else {
      const parsed = parseGbp(patch.manualOffer);
      if (manualOfferOnlyWhenSelected && patch.selectedOfferId !== 'manual') {
        payload.manual_offer_gbp = null;
      } else {
        payload.manual_offer_gbp = parsed != null ? normalizeExplicitSalePrice(parsed) : null;
      }
    }
  }

  if (patch.ourSalePrice !== undefined) {
    const parsed = parseGbp(patch.ourSalePrice);
    payload.our_sale_price_at_negotiation =
      parsed != null && parsed > 0 ? normalizeExplicitSalePrice(parsed) : null;
  }

  if (Array.isArray(patch.cashOffers)) {
    payload.cash_offers_json = normalizeOffersJson(patch.cashOffers);
  }
  if (Array.isArray(patch.voucherOffers)) {
    payload.voucher_offers_json = normalizeOffersJson(patch.voucherOffers);
  }

  if (patch.customerExpectation !== undefined) {
    const raw = String(patch.customerExpectation ?? '').replace(/[£,]/g, '').trim();
    if (raw === '') {
      payload.customer_expectation_gbp = null;
    } else {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        payload.customer_expectation_gbp = normalizeExplicitSalePrice(parsed);
      }
    }
  }

  if (patch.quantity !== undefined) {
    payload.quantity = patch.quantity;
  }
  if (patch.seniorMgmtApprovedBy !== undefined) {
    payload.senior_mgmt_approved_by = patch.seniorMgmtApprovedBy;
  }

  return payload;
}

/**
 * Persist an offer patch for a cart item. No-ops if the item has no
 * request_item_id (not yet created) or the resulting payload is empty.
 *
 * Fire-and-forget: errors are logged once but not thrown so callers can
 * optimistically update UI first. Await if you need to know it completed
 * (e.g. before navigating away).
 */
export async function persistItemOffer(item, patch, options = {}) {
  const id = item?.request_item_id;
  if (!id) return;
  const payload = buildItemOfferPayload(patch, options);
  if (Object.keys(payload).length === 0) return;
  try {
    await updateRequestItemOffer(id, payload);
  } catch (err) {
    console.error('[persistItemOffer]', err);
  }
}
