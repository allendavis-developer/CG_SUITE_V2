/**
 * Module feature registry.
 *
 * Each key declares which UI capabilities a module uses. Shared components
 * read these flags to show/hide columns, panels, and actions — so adding a
 * new module is just a new entry here, not a fork of 2 000 lines of JSX.
 */
export const MODULE_FEATURES = {
  buying: {
    hasCustomer: true,
    hasOffers: true,
    hasTarget: true,
    hasJewellery: true,
    hasParkAgreement: true,
    hasNosposAgreement: true,
    hasFinalize: true,
    hasMetricsBar: true,
    hasBarcodes: false,
    hasSessionPersistence: false,
    hasExtensionRepricing: false,
    hasQuickReprice: false,
    useVoucherOffers: 'dynamic',
    salePriceLabel: 'Our RRP',
    hideOfferCards: false,
  },
  repricing: {
    hasCustomer: false,
    hasOffers: false,
    hasTarget: false,
    hasJewellery: false,
    hasParkAgreement: false,
    hasNosposAgreement: false,
    hasFinalize: false,
    hasMetricsBar: false,
    hasBarcodes: true,
    hasSessionPersistence: true,
    hasExtensionRepricing: true,
    hasQuickReprice: true,
    /** Right-hand reprice list + barcode status rail */
    hasRepriceListSidebar: true,
    /** Infinity = unlimited; upload uses 1 */
    maxBarcodesPerItem: Number.POSITIVE_INFINITY,
    useVoucherOffers: false,
    salePriceLabel: 'New Sale Price',
    hideOfferCards: true,
  },
  /** Same flow as repricing: single barcode per item, no quick reprice, no right rail */
  upload: {
    hasCustomer: false,
    hasOffers: false,
    hasTarget: false,
    hasJewellery: false,
    hasParkAgreement: false,
    hasNosposAgreement: false,
    hasFinalize: false,
    hasMetricsBar: false,
    hasBarcodes: true,
    hasSessionPersistence: true,
    hasExtensionRepricing: true,
    hasQuickReprice: false,
    hasRepriceListSidebar: false,
    maxBarcodesPerItem: 1,
    useVoucherOffers: false,
    salePriceLabel: 'New Sale Price',
    hideOfferCards: true,
  },
};

export function getModuleFeatures(moduleKey) {
  return MODULE_FEATURES[moduleKey] || MODULE_FEATURES.buying;
}
