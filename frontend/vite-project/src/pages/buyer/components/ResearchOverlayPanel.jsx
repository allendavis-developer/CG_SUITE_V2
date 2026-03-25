import React from 'react';
import EbayResearchForm from '@/components/forms/EbayResearchForm';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm';
import { buildMarketComparisonContext, buildInitialSearchQuery } from '../hooks/useResearchOverlay';

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
  showManualOffer = false,
  useVoucherOffers = false,
  hideOfferCards = false,
}) {
  if (!researchItem && !cashConvertersResearchItem) return null;

  return (
    <div className="fixed left-0 right-80 bottom-0 z-[90] min-h-0" style={{ top: 'var(--workspace-overlay-top, 64px)' }}>
      <div className="relative h-full w-full min-h-0">
        {researchItem && (
          <EbayResearchForm
            mode="modal"
            containModalInParent
            category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
            savedState={researchItem.ebayResearchData}
            onComplete={onResearchComplete}
            initialHistogramState={true}
            readOnly={readOnly}
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            initialSearchQuery={buildInitialSearchQuery(researchItem)}
            useVoucherOffers={useVoucherOffers}
            marketComparisonContext={buildMarketComparisonContext(researchItem)}
            lineItemContext={researchItem}
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
            showManualOffer={showManualOffer}
            hideAddAction={true}
            hideOfferCards={hideOfferCards}
            useVoucherOffers={useVoucherOffers}
            initialSearchQuery={buildInitialSearchQuery(cashConvertersResearchItem)}
            marketComparisonContext={buildMarketComparisonContext(cashConvertersResearchItem)}
            lineItemContext={cashConvertersResearchItem}
          />
        )}
      </div>
    </div>
  );
}
