import React from 'react';
import EbayResearchForm from '@/components/forms/EbayResearchForm';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm';
import { buildMarketComparisonContext, buildInitialSearchQuery } from '../hooks/useResearchOverlay';

/** Align with ExtensionResearchForm + mapRequestItemsToCartItems (quotes may omit `selectedFilters`). */
function resolvedEbaySavedState(item) {
  if (!item) return null;
  if (item.ebayResearchData) return item.ebayResearchData;
  const raw = item.rawData;
  if (!raw) return null;
  if (raw.stats && raw.selectedFilters) return raw;
  if (raw.ebayResearchData) return raw.ebayResearchData;
  if (
    raw.listings?.length > 0 ||
    raw.buyOffers?.length > 0 ||
    (raw.stats && typeof raw.stats === 'object')
  ) {
    return raw;
  }
  return null;
}

/**
 * Fixed overlay panel rendering eBay and/or Cash Converters research forms.
 * Shared between Negotiation and RepricingNegotiation to eliminate duplicate JSX.
 */
export default function ResearchOverlayPanel({
  researchItem,
  cashConvertersResearchItem,
  /** When set, eBay/CC `lineItemContext` is merged from this array by id so async fields (e.g. prefetch) stay fresh. */
  items = null,
  onResearchComplete,
  onCashConvertersResearchComplete,
  readOnly = false,
  /** Shown at top of research UI when edits are intentionally not persisted (e.g. booked-for-testing preview). */
  ephemeralSessionNotice = null,
  showManualOffer = false,
  useVoucherOffers = false,
  hideOfferCards = false,
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  /** Called immediately when a category is picked inside either research form (before search starts).
   *  Signature: (itemId, category) => void. Use to stamp the category onto the item so sibling
   *  research forms (eBay ↔ CC) skip the picker. */
  onCategoryResolved = null,
  /** When true, leave viewport space for a fixed right rail (e.g. repricing negotiation sidebar). */
  reserveRightSidebar = true,
  /** Pixels to inset from the viewport bottom (e.g. buying module totals footer). */
  bottomInsetPx = 0,
  /** Live tier rows from the open eBay research form (for metrics bar min/max while overlay is open). */
  onEbayResearchOffersLiveChange = null,
  onCashConvertersResearchOffersLiveChange = null,
}) {
  if (!researchItem && !cashConvertersResearchItem) return null;

  const ebayLine =
    researchItem && Array.isArray(items)
      ? items.find((i) => i.id === researchItem.id) ?? researchItem
      : researchItem;
  const ccLine =
    cashConvertersResearchItem && Array.isArray(items)
      ? items.find((i) => i.id === cashConvertersResearchItem.id) ?? cashConvertersResearchItem
      : cashConvertersResearchItem;

  return (
    <div
      className={`fixed left-0 z-[90] min-h-0 ${reserveRightSidebar ? 'right-80' : 'right-0'}`}
      style={{
        top: 'var(--workspace-overlay-top, 64px)',
        bottom: bottomInsetPx > 0 ? `${bottomInsetPx}px` : 0,
      }}
    >
      <div className="relative h-full w-full min-h-0">
        {researchItem && (
          <EbayResearchForm
            key={ebayLine.request_item_id ?? ebayLine.id ?? 'ebay-research'}
            mode="modal"
            containModalInParent
            category={ebayLine.categoryObject || { path: [ebayLine.category], name: ebayLine.category }}
            savedState={resolvedEbaySavedState(ebayLine)}
            onComplete={onResearchComplete}
            initialHistogramState={true}
            readOnly={readOnly}
            ephemeralSessionNotice={ephemeralSessionNotice}
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            initialSearchQuery={buildInitialSearchQuery(ebayLine)}
            useVoucherOffers={useVoucherOffers}
            marketComparisonContext={buildMarketComparisonContext(ebayLine)}
            lineItemContext={ebayLine}
            blockedOfferSlots={blockedOfferSlots}
            onBlockedOfferClick={(payload) => onBlockedOfferClick?.(payload, ebayLine)}
            onCategoryResolved={onCategoryResolved ? (cat) => onCategoryResolved(ebayLine.id, cat) : null}
            onOffersChange={onEbayResearchOffersLiveChange}
          />
        )}
        {cashConvertersResearchItem && (
          <CashConvertersResearchForm
            mode="modal"
            containModalInParent
            category={ccLine.categoryObject || { path: [ccLine.category], name: ccLine.category }}
            savedState={ccLine.cashConvertersResearchData}
            onComplete={onCashConvertersResearchComplete}
            initialHistogramState={true}
            readOnly={readOnly}
            ephemeralSessionNotice={ephemeralSessionNotice}
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            useVoucherOffers={useVoucherOffers}
            initialSearchQuery={buildInitialSearchQuery(ccLine)}
            marketComparisonContext={buildMarketComparisonContext(ccLine)}
            lineItemContext={ccLine}
            blockedOfferSlots={blockedOfferSlots}
            onBlockedOfferClick={(payload) => onBlockedOfferClick?.(payload, ccLine)}
            onCategoryResolved={onCategoryResolved ? (cat) => onCategoryResolved(ccLine.id, cat) : null}
            onOffersChange={onCashConvertersResearchOffersLiveChange}
          />
        )}
      </div>
    </div>
  );
}
