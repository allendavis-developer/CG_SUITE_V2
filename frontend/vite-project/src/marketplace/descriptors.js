import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';

/**
 * One descriptor per "external listing" marketplace (eBay / Cash Converters /
 * Cash Generator / CeX). These drive the apply/merge/predicate logic so that
 * per-platform behaviour is data, not copy-pasted code paths.
 *
 * Field reference:
 *   id                    — short id used in log contexts + generated offer ids
 *   label                 — human-readable name
 *   researchDataKey       — key on a cart/negotiation item holding research state
 *   rawDataKey            — backend snake_case key on RequestItem for this research
 *   customItemFlag        — legacy boolean flag on cart items (for triplication-back-compat)
 *   itemSourceValue       — value for the unified `item.source` field
 *   rrpPriceSourceZone    — NEGOTIATION_ROW_CONTEXT zone selected by this marketplace
 *   offerIdPrefix         — tier offer id prefix (e.g. "ebay", "cc", "cg")
 *   logContextComplete    — log context string used by logCategoryRuleDecision
 *   ruleSourceLabel       — "rule.source" label used when logging apply/merge
 */
export const MARKETPLACE_DESCRIPTORS = {
  ebay: Object.freeze({
    id: 'ebay',
    label: 'eBay',
    researchDataKey: 'ebayResearchData',
    rawDataKey: 'raw_data',
    customItemFlag: 'isCustomEbayItem',
    itemSourceValue: 'ebay',
    rrpPriceSourceZone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY,
    offerIdPrefix: 'ebay',
    logContextComplete: 'ebay-research-complete',
    ruleSourceLabel: 'ebay-offer-margins',
  }),
  cashConverters: Object.freeze({
    id: 'cashConverters',
    label: 'Cash Converters',
    researchDataKey: 'cashConvertersResearchData',
    rawDataKey: 'cash_converters_data',
    customItemFlag: 'isCustomCashConvertersItem',
    itemSourceValue: 'cashConverters',
    rrpPriceSourceZone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS,
    offerIdPrefix: 'cc',
    logContextComplete: 'cashconverters-research-complete',
    ruleSourceLabel: 'category-based-margins',
  }),
  cashGenerator: Object.freeze({
    id: 'cashGenerator',
    label: 'Cash Generator',
    researchDataKey: 'cgResearchData',
    rawDataKey: 'cg_data',
    customItemFlag: 'isCustomCashGeneratorItem',
    itemSourceValue: 'cashGenerator',
    rrpPriceSourceZone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR,
    offerIdPrefix: 'cg',
    logContextComplete: 'cashgenerator-research-complete',
    ruleSourceLabel: 'category-based-margins',
  }),
  cex: Object.freeze({
    id: 'cex',
    label: 'CeX',
    researchDataKey: null,
    rawDataKey: null,
    customItemFlag: 'isCustomCeXItem',
    itemSourceValue: 'cex',
    rrpPriceSourceZone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
    offerIdPrefix: 'cex',
    logContextComplete: 'cex-product-loaded',
    ruleSourceLabel: 'cex-reference-rule',
  }),
};

/** Descriptors used for research-style marketplaces (eBay/CC/CG). Excludes CeX. */
export const RESEARCH_MARKETPLACE_DESCRIPTORS = [
  MARKETPLACE_DESCRIPTORS.ebay,
  MARKETPLACE_DESCRIPTORS.cashConverters,
  MARKETPLACE_DESCRIPTORS.cashGenerator,
];

/**
 * Resolve a descriptor from any of: descriptor object, id string ("ebay"),
 * legacy type string ("cg" ≡ "cashGenerator"), or rrpPriceSourceZone constant.
 */
export function resolveMarketplaceDescriptor(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.id && MARKETPLACE_DESCRIPTORS[value.id]) {
    return MARKETPLACE_DESCRIPTORS[value.id];
  }
  if (typeof value === 'string') {
    if (MARKETPLACE_DESCRIPTORS[value]) return MARKETPLACE_DESCRIPTORS[value];
    if (value === 'cg') return MARKETPLACE_DESCRIPTORS.cashGenerator;
    if (value === 'cc') return MARKETPLACE_DESCRIPTORS.cashConverters;
    for (const d of Object.values(MARKETPLACE_DESCRIPTORS)) {
      if (d.rrpPriceSourceZone === value) return d;
    }
  }
  return null;
}

/** True if the item carries this marketplace's custom-line flag OR source === descriptor.itemSourceValue. */
export function itemIsCustomForDescriptor(item, descriptor) {
  if (!item || !descriptor) return false;
  if (item.source === descriptor.itemSourceValue) return true;
  return Boolean(item[descriptor.customItemFlag]);
}

/** True if the item carries research state for the descriptor (with stats + selectedFilters). */
export function itemHasResearchForDescriptor(item, descriptor) {
  if (!item || !descriptor?.researchDataKey) return false;
  const data = item[descriptor.researchDataKey];
  return Boolean(data?.stats && data?.selectedFilters);
}
