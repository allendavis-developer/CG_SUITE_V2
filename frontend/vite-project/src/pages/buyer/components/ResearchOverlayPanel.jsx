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
}) {
  if (!researchItem && !cashConvertersResearchItem) return null;

  return (
    <div className="fixed left-0 right-80 bottom-0 z-[90] min-h-0" style={{ top: 'var(--workspace-overlay-top, 64px)' }}>
      <div className="relative h-full w-full min-h-0">
        {researchItem && (
          <EbayResearchForm
            key={researchItem.request_item_id ?? researchItem.id ?? 'ebay-research'}
            mode="modal"
            containModalInParent
            category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
            savedState={resolvedEbaySavedState(researchItem)}
            onComplete={onResearchComplete}
            initialHistogramState={true}
            readOnly={readOnly}
            ephemeralSessionNotice={ephemeralSessionNotice}
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            initialSearchQuery={buildInitialSearchQuery(researchItem)}
            useVoucherOffers={useVoucherOffers}
            marketComparisonContext={buildMarketComparisonContext(researchItem)}
            lineItemContext={researchItem}
            blockedOfferSlots={blockedOfferSlots}
            onBlockedOfferClick={(payload) => onBlockedOfferClick?.(payload, researchItem)}
            onCategoryResolved={onCategoryResolved ? (cat) => onCategoryResolved(researchItem.id, cat) : null}
          />
        )}
        {cashConvertersResearchItem && (
          <CashConvertersResearchForm
            mode="modal"
            containModalInParent
            category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
            savedState={cashConvertersResearchItem.cashConvertersResearchData}
            onComplete={onCashConvertersResearchComplete}
            initialHistogramState={true}
            readOnly={readOnly}
            ephemeralSessionNotice={ephemeralSessionNotice}
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            useVoucherOffers={useVoucherOffers}
            initialSearchQuery={buildInitialSearchQuery(cashConvertersResearchItem)}
            marketComparisonContext={buildMarketComparisonContext(cashConvertersResearchItem)}
            lineItemContext={cashConvertersResearchItem}
            blockedOfferSlots={blockedOfferSlots}
            onBlockedOfferClick={(payload) => onBlockedOfferClick?.(payload, cashConvertersResearchItem)}
            onCategoryResolved={onCategoryResolved ? (cat) => onCategoryResolved(cashConvertersResearchItem.id, cat) : null}
          />
        )}
      </div>
    </div>
  );
}
