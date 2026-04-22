import {
  normalizeExplicitSalePrice,
  normalizeRequestTotalGbp,
  roundOfferPrice,
  roundSalePrice,
  toVoucherOfferPrice,
  formatOfferPrice,
} from '@/utils/helpers';
import { slimCexNegotiationOfferRows } from '@/utils/cexOfferMapping';
import { mapRequestItemsToCartItems } from '@/utils/requestToCartMapping';
import { calculateBuyOffers, titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { NEGOTIATION_ROW_CONTEXT } from '../rowContextZones';
import { rebuildJewelleryOffersForNegotiationItem } from '@/components/jewellery/jewelleryNegotiationCart';
import {
  getAiSuggestedNosposStockCategoryFromItem,
  getAiSuggestedNosposStockFieldValuesFromItem,
} from '@/utils/nosposCategoryMappings';
import { MARKETPLACE_DESCRIPTORS } from '@/marketplace/descriptors';
import {
  mergeResearchDataIntoItem,
  applyResearchCommittedPricingToItem,
  applyResearchToItem,
} from '@/marketplace/research';
import { getDisplayOffers } from '@/negotiation/offerMath';

// ─── Pure helper functions for Negotiation page ─────────────────────────────

export function buildItemSpecs(item) {
  if (!item) return null;
  if (item.cexProductData?.specifications && Object.keys(item.cexProductData.specifications).length > 0) {
    return item.cexProductData.specifications;
  }
  if (item.attributeValues && Object.values(item.attributeValues).some(v => v)) {
    return Object.fromEntries(
      Object.entries(item.attributeValues)
        .filter(([, v]) => v)
        .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])
    );
  }
  const specs = {};
  if (item.storage)   specs.Storage   = item.storage;
  if (item.color)     specs.Colour    = item.color;
  if (item.network)   specs.Network   = item.network;
  if (item.condition) specs.Condition = item.condition;
  return Object.keys(specs).length > 0 ? specs : null;
}

/** True if this line already has a search string saved from eBay or Cash Converters research. */
export function lineItemHasCommittedMarketplaceSearchTerm(item) {
  if (!item) return false;
  const eb = item.ebayResearchData?.searchTerm || item.ebayResearchData?.lastSearchedTerm;
  if (eb != null && String(eb).trim() !== '') return true;
  const cc = item.cashConvertersResearchData?.searchTerm || item.cashConvertersResearchData?.lastSearchedTerm;
  if (cc != null && String(cc).trim() !== '') return true;
  const cg = item.cgResearchData?.searchTerm || item.cgResearchData?.lastSearchedTerm;
  if (cg != null && String(cg).trim() !== '') return true;
  return false;
}

export function buildInitialSearchQuery(item) {
  // Saved research, then explicit variant line / subtitle, then title only (no spec concatenation).
  if (!item) return undefined;
  const fromResearch =
    item.ebayResearchData?.searchTerm
    || item.ebayResearchData?.lastSearchedTerm
    || item.cashConvertersResearchData?.searchTerm
    || item.cashConvertersResearchData?.lastSearchedTerm
    || item.cgResearchData?.searchTerm
    || item.cgResearchData?.lastSearchedTerm;
  if (fromResearch) return fromResearch;

  const variantLine = item.variantName != null && String(item.variantName).trim() !== '' ? String(item.variantName).trim() : null;
  if (variantLine) return variantLine;

  const subtitle = item.subtitle != null && String(item.subtitle).trim() !== '' ? String(item.subtitle).trim() : null;
  if (subtitle) return subtitle;

  const base = item.title != null && String(item.title).trim() !== '' ? String(item.title).trim() : '';
  return base || undefined;
}

/** Initial eBay/CC search string for a live CeX extension product (add-from-CeX panel). Title only. */
export function buildCeXProductResearchInitialQuery(cex) {
  if (!cex) return undefined;
  const base = String(cex.title || cex.modelName || '').trim();
  return base || undefined;
}

function buildRuleSnapshotFromReferenceData(referenceData) {
  if (!referenceData || typeof referenceData !== 'object') return null;
  return {
    firstOfferPctOfCex: referenceData.first_offer_pct_of_cex ?? referenceData.firstOfferPctOfCex ?? null,
    secondOfferPctOfCex: referenceData.second_offer_pct_of_cex ?? referenceData.secondOfferPctOfCex ?? null,
    thirdOfferPctOfCex: referenceData.third_offer_pct_of_cex ?? referenceData.thirdOfferPctOfCex ?? null,
    cexBasedSalePrice: referenceData.cex_based_sale_price ?? null,
  };
}

export function logCategoryRuleDecision({
  context,
  item,
  categoryObject = null,
  categoryName = null,
  rule = null,
  notes = null,
}) {
  if (typeof console === 'undefined') return;
  if (
    import.meta.env.DEV !== true ||
    import.meta.env.VITE_CG_SUITE_VERBOSE_LOGS !== '1'
  ) {
    return;
  }
  console.log('[CG Suite][CategoryRule]', {
    context,
    itemId: item?.id ?? null,
    title: item?.title ?? null,
    categoryName: categoryName ?? categoryObject?.name ?? item?.category ?? null,
    categoryId: categoryObject?.id ?? null,
    categoryPath: categoryObject?.path ?? null,
    rule,
    notes,
  });
}

export function resolveOurSalePrice(item) {
  let n = null;
  let explicit = false;
  if (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== '') {
    n = Number(item.ourSalePrice);
    explicit = true;
  } else if (item.useResearchSuggestedPrice !== false && item.ebayResearchData?.stats?.suggestedPrice != null) {
    n = Number(item.ebayResearchData.stats.suggestedPrice);
  }
  if (n == null || Number.isNaN(n) || n <= 0) return null;
  return explicit ? normalizeExplicitSalePrice(n) : roundSalePrice(n);
}

/**
 * Rows that carry CeX trade/sell context usually keep CeX tiers unless the row's offer source
 * is eBay or Cash Converters (`resolveOffersSource`), in which case research rebuilds those tiers.
 */
export function isCeXBackedNegotiationItem(item) {
  if (!item) return false;
  if (item.isCustomCeXItem === true) return true;
  if (item.variantId != null && item.variantId !== '') return true;
  if (item.cexSku != null && item.cexSku !== '') return true;
  if (item.cexBuyPrice != null && item.cexBuyPrice !== '') return true;
  if (item.cexVoucherPrice != null && item.cexVoucherPrice !== '') return true;
  if (item.cexSellPrice != null && item.cexSellPrice !== '') return true;
  return false;
}

/**
 * Default RRP + offer-tier source when unset: CeX-backed rows → Sell column;
 * eBay-primary rows → eBay column. `offersSource` mirrors `rrpOffersSource` unless set explicitly.
 */
export function withDefaultRrpOffersSource(item) {
  if (!item) return item;
  let next = { ...item };
  if (next.offersSource == null || next.offersSource === '') {
    if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
      next.offersSource = next.rrpOffersSource;
    }
  }
  if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
    return next;
  }
  if (isCeXBackedNegotiationItem(next)) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
    return {
      ...next,
      rrpOffersSource: z,
      offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z,
    };
  }
  if (
    next.isCustomEbayItem === true ||
    (next.ebayResearchData && !next.isCustomCashConvertersItem)
  ) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
    return {
      ...next,
      rrpOffersSource: z,
      offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z,
    };
  }
  const soleRrpZones = getAvailableRrpZonesForNegotiationItem(next);
  if (soleRrpZones.length === 1) {
    const z = soleRrpZones[0].zone;
    const { item: applied, errorMessage } = applyRrpOnlyFromPriceSource(next, z);
    if (!errorMessage && applied) {
      const offersSource =
        next.offersSource != null && next.offersSource !== '' ? next.offersSource : z;
      return { ...applied, offersSource };
    }
  }
  return next;
}

// ─── Upload workspace: NosPos stock snapshot + fill-empty merge from catalog ───

/** True when a catalog merge should treat the value as missing and allow an overlay. */
export function isEmptyForUploadMerge(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** True when merged NosPos stock snapshot has any column or change-log rows to show. */
export function uploadNosposStockSnapshotIsNonEmpty(stock) {
  if (!stock) return false;
  for (const k of ['costPrice', 'retailPrice', 'boughtBy', 'createdAt']) {
    if (stock[k] != null && String(stock[k]).trim() !== '') return true;
  }
  return Array.isArray(stock.changeLog) && stock.changeLog.length > 0;
}

/** Normalise NosPos stock-edit scrape payload for upload table columns (cost, retail, buyer, date, change log). */
export function uploadNosposStockSnapshotFromScrape(scraped) {
  if (!scraped || scraped.loading || scraped.error) return null;
  const changeLog = Array.isArray(scraped.changeLog) ? scraped.changeLog : [];
  const out = {
    costPrice:
      scraped.costPrice != null && scraped.costPrice !== ''
        ? String(scraped.costPrice).trim()
        : '',
    retailPrice:
      scraped.retailPrice != null && scraped.retailPrice !== ''
        ? String(scraped.retailPrice).trim()
        : '',
    boughtBy: scraped.boughtBy != null ? String(scraped.boughtBy).trim() : '',
    createdAt: scraped.createdAt != null ? String(scraped.createdAt).trim() : '',
    changeLog,
  };
  return uploadNosposStockSnapshotIsNonEmpty(out) ? out : null;
}

/** Fill only blank stock-edit fields from a newer scrape patch. */
export function mergeUploadNosposStockFieldLevel(existing, patch) {
  if (!patch) return existing || null;
  const base = {
    costPrice: '',
    retailPrice: '',
    boughtBy: '',
    createdAt: '',
    changeLog: [],
    ...(existing || {}),
  };
  const out = { ...base };
  if (!Array.isArray(out.changeLog)) out.changeLog = [];
  for (const k of ['costPrice', 'retailPrice', 'boughtBy', 'createdAt']) {
    const cur = out[k];
    const curEmpty = cur == null || String(cur).trim() === '';
    const pv = patch[k];
    const patchVal = pv != null ? String(pv).trim() : '';
    if (curEmpty && patchVal !== '') out[k] = patchVal;
  }
  if (Array.isArray(patch.changeLog) && patch.changeLog.length > 0) {
    out.changeLog = patch.changeLog.slice();
  }
  return out;
}

/**
 * Upload workspace “Item name & attributes” column: same text as the table (`variantName` || `title`),
 * unless the user set {@link uploadTableItemName} on the row (then that value wins for Web EPOS too).
 */
export function resolveUploadTableItemName(item) {
  const custom = item?.uploadTableItemName;
  if (custom != null) {
    const t = String(custom).trim();
    if (t !== "") return t.slice(0, 500);
  }
  const base = String(item?.variantName || item?.title || "").trim();
  return base.slice(0, 500) || "—";
}

const UPLOAD_QUEUE_MERGE_SKIP_KEYS = new Set([
  'id',
  'nosposBarcodes',
  'isRemoved',
  'uploadNosposStockFromBarcode',
  'isUploadBarcodeQueuePlaceholder',
  'uploadTableItemName',
  'webeposRrp',
]);

/**
 * Generic barcode → value lookup for audit intake maps. Tries each typed barcode
 * in order and returns the first hit. Used by `resolveWebeposRrpForSlot` and
 * `resolveCgCategoryForSlot` — both are seeded when the user enters audit mode
 * from the hub and are empty for fresh uploads.
 */
function resolveAuditMapValue(mapByBarcode, typedCodes) {
  if (!mapByBarcode) return null;
  for (const code of typedCodes) {
    const key = String(code ?? '').trim();
    if (key && mapByBarcode[key] != null) return mapByBarcode[key];
  }
  return null;
}

const resolveWebeposRrpForSlot = resolveAuditMapValue;
const resolveCgCategoryForSlot = resolveAuditMapValue;

/**
 * One upload table row right after barcode intake: id matches the pending slot id,
 * NosPos barcodes embedded, optional NosPos stock-edit snapshot, optional Web EPOS
 * RRP (audit-only), optional CG categoryObject reverse-derived from the Web EPOS
 * product's `#catLevel{N}` selects (audit-only).
 */
export function buildUploadBarcodeQueuePlaceholderItem(slotId, {
  barcodes,
  nosposLookups,
  uploadStockDetailsBySlotId,
  webeposRrpByBarcode = null,
  cgCategoryByBarcode = null,
}) {
  const lk = nosposLookups[`${slotId}_0`];
  const typedCodes = barcodes[slotId] || [];
  const stockBarcode = String(lk?.stockBarcode || typedCodes[0] || '').trim();

  let nosposBarcodes = [];
  if (lk?.status === 'selected' && stockBarcode) {
    nosposBarcodes = [{
      barserial: stockBarcode,
      href: (lk.stockUrl || '').replace(/^https:\/\/nospos\.com/i, '') || '',
      name: lk?.stockName || '',
    }];
  } else if (typedCodes[0]) {
    nosposBarcodes = [{ barserial: String(typedCodes[0]).trim(), href: '', name: '' }];
  }

  const nosposStockSnapshot = uploadNosposStockSnapshotFromScrape(uploadStockDetailsBySlotId[slotId]);
  const webeposRrp = resolveWebeposRrpForSlot(webeposRrpByBarcode, typedCodes);
  const cgCategory = resolveCgCategoryForSlot(cgCategoryByBarcode, typedCodes);
  const titleFromNos = (lk?.stockName || '').trim();
  const title =
    titleFromNos ||
    (stockBarcode ? `Add product (${stockBarcode})` : 'Add product from header');

  return withUploadListRrpSourceDefaults({
    id: slotId,
    isUploadBarcodeQueuePlaceholder: true,
    title,
    subtitle: '',
    quantity: 1,
    category: cgCategory?.name || '',
    categoryObject: cgCategory || null,
    offers: [],
    cashOffers: [],
    voucherOffers: [],
    selectedOfferId: null,
    ebayResearchData: null,
    cashConvertersResearchData: null,
    cgResearchData: null,
    referenceData: null,
    variantId: null,
    cexSku: null,
    cexSellPrice: null,
    cexBuyPrice: null,
    cexVoucherPrice: null,
    cexUrl: null,
    cexOutOfStock: false,
    attributeValues: {},
    condition: null,
    image: null,
    ourSalePrice: null,
    nosposBarcodes,
    isRemoved: false,
    isCustomCeXItem: false,
    ...(nosposStockSnapshot ? { uploadNosposStockFromBarcode: nosposStockSnapshot } : {}),
    ...(webeposRrp != null ? { webeposRrp } : {}),
  });
}

/**
 * Re-apply barcode intake snapshots onto an existing upload row (add-more flow) without clobbering a filled CeX/catalog title.
 */
export function applyUploadBarcodeIntakeSnapshotToRow(row, slotId, ctx) {
  if (!row) return row;
  const fresh = buildUploadBarcodeQueuePlaceholderItem(slotId, ctx);
  const t = row.title != null ? String(row.title).trim() : '';
  const preserveCatalogTitle =
    Boolean(row.cexSku != null && String(row.cexSku).trim() !== '') ||
    row.isCustomCeXItem === true ||
    (row.isUploadBarcodeQueuePlaceholder === false && t !== '' && !/^Add product\b/i.test(t));
  const nextTitle = preserveCatalogTitle ? row.title : fresh.title;
  return {
    ...row,
    title: nextTitle,
    nosposBarcodes: fresh.nosposBarcodes,
    ...(fresh.uploadNosposStockFromBarcode != null
      ? { uploadNosposStockFromBarcode: fresh.uploadNosposStockFromBarcode }
      : {}),
  };
}

/**
 * Merge a builder / CeX cart line onto the barcode-queue row: only fills fields that are still empty,
 * keeps NosPos stock-edit values unless a field was still blank and the scrape supplies it.
 */
export function mergeCatalogIntoUploadQueueRow(queueRow, cartItem, { nosposBarcodes, scraped }) {
  if (!queueRow || !cartItem) return queueRow;
  const newId =
    cartItem.id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `upload-item-${Date.now()}`);
  const patch = uploadNosposStockSnapshotFromScrape(scraped);
  const mergedStock = mergeUploadNosposStockFieldLevel(queueRow.uploadNosposStockFromBarcode, patch);
  const hasAnyStock = uploadNosposStockSnapshotIsNonEmpty(mergedStock);

  let next = {
    ...queueRow,
    id: newId,
    nosposBarcodes,
    isRemoved: false,
    isUploadBarcodeQueuePlaceholder: false,
    ...(hasAnyStock ? { uploadNosposStockFromBarcode: mergedStock } : {}),
  };
  if (!hasAnyStock && queueRow.uploadNosposStockFromBarcode) {
    next = { ...next, uploadNosposStockFromBarcode: queueRow.uploadNosposStockFromBarcode };
  }

  for (const key of Object.keys(cartItem)) {
    if (UPLOAD_QUEUE_MERGE_SKIP_KEYS.has(key)) continue;
    const incoming = cartItem[key];
    if (incoming === undefined) continue;
    if (isEmptyForUploadMerge(next[key]) && !isEmptyForUploadMerge(incoming)) {
      next[key] = incoming;
    }
  }
  const qFromCart = Number(cartItem.quantity);
  if (Number.isFinite(qFromCart) && qFromCart > 0) {
    next.quantity = qFromCart;
  } else if (next.quantity == null || Number(next.quantity) < 1) {
    next.quantity = 1;
  }
  return withUploadListRrpSourceDefaults(next);
}

/** Which price-source zone drives the 1st–4th offer columns (falls back to legacy `rrpOffersSource`). */
export function resolveOffersSource(item) {
  if (!item) return null;
  if (item.offersSource != null && item.offersSource !== '') return item.offersSource;
  return item.rrpOffersSource ?? null;
}

export function priceSourceZoneShortLabel(zone) {
  switch (zone) {
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL:
      return 'CeX';
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY:
      return 'eBay';
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS:
      return 'Cash Conv.';
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR:
      return 'CG';
    case NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER:
      return 'Manual';
    default:
      return '—';
  }
}

/** Top-level product category headers shown in the header builder (excludes eBay + Jewellery). */
export function filterProductCategoriesForBuilderTopHeaders(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.filter((cat) => {
    const n = String(cat?.name || '').toLowerCase();
    if (n === 'ebay') return false;
    if (n === 'jewellery' || n === 'jewelry') return false;
    return true;
  });
}

/** Zones that have a usable RRP for this row (CeX reference, eBay stats, or CC stats). */
export function getAvailableRrpZonesForNegotiationItem(item) {
  const out = [];
  if (!item) return out;
  if (isCeXBackedNegotiationItem(item)) {
    const rrp = resolvePersistedCexRrp(item);
    if (rrp != null && rrp > 0) {
      out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL, label: 'CeX' });
    }
  }
  const eb = item.ebayResearchData;
  if (eb?.stats && resolveSuggestedRetailFromResearchStats(eb.stats) != null) {
    out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY, label: 'eBay' });
  }
  const cc = item.cashConvertersResearchData;
  if (cc?.stats && resolveSuggestedRetailFromResearchStats(cc.stats) != null) {
    out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS, label: 'CC' });
  }
  const cg = item.cgResearchData;
  if (cg?.stats && resolveSuggestedRetailFromResearchStats(cg.stats) != null) {
    out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR, label: 'CG' });
  }
  return out;
}

/**
 * Upload list workspace: when exactly one RRP column has data, commit the same values as
 * “Use as RRP source” — `rrpOffersSource`, mirror `offersSource` when blank, and **Upload RRP**
 * (`ourSalePrice`) from that column. Same row reference if nothing would change.
 * @returns {object} Same row reference if unchanged.
 */
export function applySoleRrpSourceToUploadRow(row) {
  if (!row || row.isRemoved) return row;
  /** User is typing in Upload RRP — never clobber in-progress input (see upload list `items` effect). */
  if (row.ourSalePriceInput !== undefined) return row;
  const zones = getAvailableRrpZonesForNegotiationItem(row);
  if (zones.length !== 1) return row;
  const z = zones[0].zone;
  /** Already committed to the only available source — keep manual RRP edits (buying-style). */
  if (row.rrpOffersSource === z) return row;
  const { item: applied, errorMessage } = applyRrpOnlyFromPriceSource(row, z);
  if (errorMessage || !applied) return row;
  const offersSource =
    row.offersSource != null && row.offersSource !== '' ? row.offersSource : z;
  const next = { ...applied, offersSource };
  const researchFlagEqual =
    (row.useResearchSuggestedPrice ?? false) === (next.useResearchSuggestedPrice ?? false);
  if (
    row.rrpOffersSource === next.rrpOffersSource &&
    row.offersSource === next.offersSource &&
    String(row.ourSalePrice ?? '').trim() === String(next.ourSalePrice ?? '').trim() &&
    researchFlagEqual
  ) {
    return row;
  }
  return next;
}

/** Upload: {@link withDefaultRrpOffersSource} then {@link applySoleRrpSourceToUploadRow}. */
export function withUploadListRrpSourceDefaults(item) {
  if (!item) return item;
  return applySoleRrpSourceToUploadRow(withDefaultRrpOffersSource(item));
}

/** Zones that have a usable tier-offer set for this row. */
export function getAvailableOfferZonesForNegotiationItem(item, useVoucherOffers) {
  const out = [];
  if (!item) return out;
  if (isCeXBackedNegotiationItem(item)) {
    const { cashOffers, voucherOffers } = resolvePersistedCexOfferRows(item);
    const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
    if (displayOffers.length > 0) {
      out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL, label: 'CeX' });
    }
  }
  const eb = item.ebayResearchData;
  if (eb?.stats) {
    const rrp = resolveSuggestedRetailFromResearchStats(eb.stats);
    if (rrp != null && rrp > 0) {
      out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY, label: 'eBay' });
    }
  }
  const cc = item.cashConvertersResearchData;
  if (cc?.stats) {
    const rrp = resolveSuggestedRetailFromResearchStats(cc.stats);
    if (rrp != null && rrp > 0) {
      out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS, label: 'CC' });
    }
  }
  const cg = item.cgResearchData;
  if (cg?.stats) {
    const rrpCg = resolveSuggestedRetailFromResearchStats(cg.stats);
    if (rrpCg != null && rrpCg > 0) {
      out.push({ zone: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR, label: 'CG' });
    }
  }
  return out;
}

/**
 * After CeX pencil lookup on a row that still treats eBay (or another source) as primary for RRP,
 * prompt before switching highlight + committed tiers to CeX.
 *
 * When the row is already committed to CeX as RRP source, repeat pencil runs must refresh merged
 * CeX data + re-apply tiers without this prompt — even if eBay stats still exist or
 * `useResearchSuggestedPrice` was left inconsistent.
 */
export function shouldPromptCeXPencilRrpSource(item) {
  if (!item) return false;
  if (item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL) {
    return false;
  }
  const ebayDrivesDisplayedRrp =
    item.useResearchSuggestedPrice !== false &&
    item.ebayResearchData?.stats?.suggestedPrice != null &&
    Number(item.ebayResearchData.stats.suggestedPrice) > 0;
  if (ebayDrivesDisplayedRrp) return true;
  return item.rrpOffersSource !== NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
}

/** Suggested retail from saved research stats (matches ResearchFormShell / median−£1 rule when needed). */
export function resolveSuggestedRetailFromResearchStats(stats) {
  if (!stats) return null;
  if (stats.suggestedPrice != null && stats.suggestedPrice !== '') {
    const n = Number(stats.suggestedPrice);
    if (Number.isFinite(n) && n > 0) return roundSalePrice(n);
  }
  if (stats.median != null && stats.median !== '') {
    const m = Number(stats.median);
    if (Number.isFinite(m) && m > 0) return roundSalePrice(Math.max(m - 1, 0));
  }
  return null;
}

function firstNonEmptyOfferArray(...candidates) {
  for (const a of candidates) {
    if (Array.isArray(a) && a.length > 0) return a;
  }
  return [];
}

/** Exclude eBay / CC / CG buy-offer rows so we do not re-slim those as CeX tiers. */
function rowOffersLookLikeCexTiers(offers) {
  if (!Array.isArray(offers) || !offers.length) return false;
  return !offers.some((o) => {
    const id = o?.id != null ? String(o.id) : '';
    return (
      id.startsWith('ebay-') ||
      id.startsWith('cc-') ||
      id.startsWith('cg-') ||
      id.includes('ebay-rrp') ||
      id.includes('cc-rrp') ||
      id.includes('cg-rrp')
    );
  });
}

function resolvePersistedCexOfferRows(item) {
  const ref = item?.referenceData || {};
  const rawData = item?.rawData && typeof item.rawData === 'object' ? item.rawData : {};
  const rawRef = rawData.referenceData || rawData.reference_data || {};
  const cexData = item?.cexProductData && typeof item.cexProductData === 'object' ? item.cexProductData : {};
  const cexRef = cexData.referenceData || cexData.reference_data || {};

  let cashOffers = slimCexNegotiationOfferRows(
    firstNonEmptyOfferArray(
      ref.cash_offers,
      rawRef.cash_offers,
      rawData.cash_offers,
      cexRef.cash_offers,
      cexData.cash_offers,
      rowOffersLookLikeCexTiers(item?.cashOffers) ? item.cashOffers : null,
    )
  );
  let voucherOffers = slimCexNegotiationOfferRows(
    firstNonEmptyOfferArray(
      ref.voucher_offers,
      rawRef.voucher_offers,
      rawData.voucher_offers,
      cexRef.voucher_offers,
      cexData.voucher_offers,
      rowOffersLookLikeCexTiers(item?.voucherOffers) ? item.voucherOffers : null,
    )
  );

  if (!cashOffers.length && voucherOffers.length) {
    cashOffers = voucherOffers.map((o) => ({
      id: `cex-c-${o.id}`,
      title: o.title,
      price: roundOfferPrice(Number(o.price) / 1.1),
    }));
  } else if (!voucherOffers.length && cashOffers.length) {
    voucherOffers = cashOffers.map((o) => ({
      id: `cex-v-${o.id}`,
      title: o.title,
      price: toVoucherOfferPrice(o.price),
    }));
  }

  return { cashOffers, voucherOffers };
}

/** CeX sell / reference-based RRP used when committing tiers or list-workspace pipelines. */
export function resolvePersistedCexRrp(item) {
  const ref = item?.referenceData || {};
  const rawLayers = [item?.rawData, item?.cexProductData].filter(
    (layer) => layer && typeof layer === 'object'
  );
  for (const raw of rawLayers) {
    const rawRef = raw.referenceData || raw.reference_data || {};
    const rrp = resolveCexRrpFromItemLayers(item, ref, raw, rawRef);
    if (rrp != null && rrp > 0) return rrp;
  }
  return resolveCexRrpFromItemLayers(item, ref, {}, {});
}

function persistCexOfferRowsOnItem(item) {
  if (!isCeXBackedNegotiationItem(item)) return item;
  const { cashOffers, voucherOffers } = resolvePersistedCexOfferRows(item);
  if (!cashOffers.length && !voucherOffers.length) return item;

  const next = { ...item };
  const ref = item.referenceData && typeof item.referenceData === 'object' ? item.referenceData : {};
  next.referenceData = {
    ...ref,
    ...(cashOffers.length ? { cash_offers: cashOffers } : {}),
    ...(voucherOffers.length ? { voucher_offers: voucherOffers } : {}),
  };

  if (item.cexProductData && typeof item.cexProductData === 'object') {
    const cexRef =
      item.cexProductData.referenceData && typeof item.cexProductData.referenceData === 'object'
        ? item.cexProductData.referenceData
        : {};
    next.cexProductData = {
      ...item.cexProductData,
      referenceData: {
        ...cexRef,
        ...(cashOffers.length ? { cash_offers: cashOffers } : {}),
        ...(voucherOffers.length ? { voucher_offers: voucherOffers } : {}),
      },
    };
  }

  if (item.rawData && typeof item.rawData === 'object') {
    const rawRef =
      item.rawData.referenceData && typeof item.rawData.referenceData === 'object'
        ? item.rawData.referenceData
        : item.rawData.reference_data && typeof item.rawData.reference_data === 'object'
          ? item.rawData.reference_data
          : {};
    next.rawData = {
      ...item.rawData,
      ...(cashOffers.length ? { cash_offers: cashOffers } : {}),
      ...(voucherOffers.length ? { voucher_offers: voucherOffers } : {}),
      referenceData: {
        ...rawRef,
        ...(cashOffers.length ? { cash_offers: cashOffers } : {}),
        ...(voucherOffers.length ? { voucher_offers: voucherOffers } : {}),
      },
    };
  }

  return next;
}

/**
 * CeX RRP + tier rows live in different places depending on flow (internal variant vs Add-from-CeX vs saved quote).
 */
function resolveCexRrpFromItemLayers(item, ref, raw, rawRef) {
  const candidates = [
    ref.cex_based_sale_price,
    ref.our_sale_price,
    rawRef.cex_based_sale_price,
    rawRef.our_sale_price,
    raw.cex_based_sale_price,
    raw.our_sale_price,
  ];
  for (const c of candidates) {
    if (c != null && c !== '' && Number.isFinite(Number(c))) {
      const n = roundSalePrice(Number(c));
      if (n > 0) return n;
    }
  }
  if (item.ourSalePrice != null && item.ourSalePrice !== '') {
    const n = Number(item.ourSalePrice);
    if (Number.isFinite(n) && n > 0) return normalizeExplicitSalePrice(n);
  }
  return null;
}

function nextItemWithExplicitRrpAndOffers(item, { rrp, cashOffers, voucherOffers, useVoucherOffers, rrpOffersSource }) {
  const baseItem = persistCexOfferRowsOnItem(item);
  const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;

  let selectedOfferId;
  let manualOffer;
  if (baseItem.selectedOfferId === 'manual') {
    selectedOfferId = 'manual';
    manualOffer = baseItem.manualOffer ?? '';
  } else if (baseItem.selectedOfferId != null && baseItem.selectedOfferId !== '') {
    const prevDisplay = getDisplayOffers(baseItem, useVoucherOffers);
    const prevIdx = prevDisplay.findIndex((o) => o.id === baseItem.selectedOfferId);
    if (prevIdx >= 0 && displayOffers.length) {
      const idx = Math.min(prevIdx, displayOffers.length - 1);
      selectedOfferId = displayOffers[idx].id;
    } else {
      selectedOfferId = null;
    }
    manualOffer = '';
  } else {
    selectedOfferId = null;
    manualOffer = '';
  }

  const next = { ...baseItem };
  delete next.ourSalePriceInput;
  const src = rrpOffersSource ?? null;
  return {
    ...next,
    ourSalePrice: formatOfferPrice(rrp),
    useResearchSuggestedPrice: false,
    cashOffers,
    voucherOffers,
    offers: displayOffers,
    selectedOfferId,
    manualOffer,
    rrpOffersSource: src,
    offersSource: src,
  };
}

function nextItemWithExplicitOffersOnly(item, { cashOffers, voucherOffers, useVoucherOffers, offersSource }) {
  const baseItem = persistCexOfferRowsOnItem(item);
  const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;

  let selectedOfferId;
  let manualOffer;
  if (baseItem.selectedOfferId === 'manual') {
    selectedOfferId = 'manual';
    manualOffer = baseItem.manualOffer ?? '';
  } else if (baseItem.selectedOfferId != null && baseItem.selectedOfferId !== '') {
    const prevDisplay = getDisplayOffers(baseItem, useVoucherOffers);
    const prevIdx = prevDisplay.findIndex((o) => o.id === baseItem.selectedOfferId);
    if (prevIdx >= 0 && displayOffers.length) {
      const idx = Math.min(prevIdx, displayOffers.length - 1);
      selectedOfferId = displayOffers[idx].id;
    } else {
      selectedOfferId = null;
    }
    manualOffer = '';
  } else {
    selectedOfferId = null;
    manualOffer = '';
  }

  const next = { ...baseItem };
  delete next.ourSalePriceInput;
  return {
    ...next,
    cashOffers,
    voucherOffers,
    offers: displayOffers,
    selectedOfferId,
    manualOffer,
    offersSource: offersSource ?? null,
  };
}

/**
 * Set only Our RRP (and RRP source highlight) from a scraped column; leave tier offers unchanged.
 * @returns {{ item: object, errorMessage?: string }}
 */
export function applyRrpOnlyFromPriceSource(item, zone) {
  if (!item) return { item: null, errorMessage: 'No item selected.' };

  switch (zone) {
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL: {
      const rrp = resolvePersistedCexRrp(item);
      if (rrp == null || rrp <= 0) {
        return {
          item,
          errorMessage: 'No CeX-based RRP on this row. Refresh CeX data or check reference data.',
        };
      }
      const next = { ...item };
      delete next.ourSalePriceInput;
      return {
        item: {
          ...next,
          ourSalePrice: formatOfferPrice(rrp),
          useResearchSuggestedPrice: false,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
        },
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY: {
      const eb = item.ebayResearchData;
      if (!eb?.stats) {
        return { item, errorMessage: 'Run eBay research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(eb.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from eBay research.' };
      }
      const next = { ...item };
      delete next.ourSalePriceInput;
      return {
        item: {
          ...next,
          ourSalePrice: formatOfferPrice(rrp),
          useResearchSuggestedPrice: false,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY,
        },
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS: {
      const cc = item.cashConvertersResearchData;
      if (!cc?.stats) {
        return { item, errorMessage: 'Run Cash Converters research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cc.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Converters research.' };
      }
      const next = { ...item };
      delete next.ourSalePriceInput;
      return {
        item: {
          ...next,
          ourSalePrice: formatOfferPrice(rrp),
          useResearchSuggestedPrice: false,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS,
        },
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR: {
      const cg = item.cgResearchData;
      if (!cg?.stats) {
        return { item, errorMessage: 'Run Cash Generator research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cg.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Generator research.' };
      }
      const next = { ...item };
      delete next.ourSalePriceInput;
      return {
        item: {
          ...next,
          ourSalePrice: formatOfferPrice(rrp),
          useResearchSuggestedPrice: false,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR,
        },
      };
    }
    default:
      return { item, errorMessage: 'Unsupported price source.' };
  }
}

/**
 * Set only 1st–4th tier offers (and offer source) from a column; leave Our RRP unchanged.
 * @returns {{ item: object, errorMessage?: string }}
 */
export function applyOffersOnlyFromPriceSource(item, zone, useVoucherOffers) {
  if (!item) return { item: null, errorMessage: 'No item selected.' };

  switch (zone) {
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL: {
      const { cashOffers, voucherOffers } = resolvePersistedCexOfferRows(item);
      const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
      if (!displayOffers.length) {
        return {
          item,
          errorMessage: 'No CeX tier offers on this row. Refresh CeX data.',
        };
      }
      return {
        item: nextItemWithExplicitOffersOnly(item, {
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          offersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY: {
      const eb = item.ebayResearchData;
      if (!eb?.stats) {
        return { item, errorMessage: 'Run eBay research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(eb.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from eBay research.' };
      }
      let buyOffers = Array.isArray(eb.buyOffers) ? eb.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `ebay-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `ebay-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitOffersOnly(item, {
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          offersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS: {
      const cc = item.cashConvertersResearchData;
      if (!cc?.stats) {
        return { item, errorMessage: 'Run Cash Converters research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cc.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Converters research.' };
      }
      let buyOffers = Array.isArray(cc.buyOffers) ? cc.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `cc-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `cc-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitOffersOnly(item, {
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          offersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR: {
      const cg = item.cgResearchData;
      if (!cg?.stats) {
        return { item, errorMessage: 'Run Cash Generator research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cg.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Generator research.' };
      }
      let buyOffers = Array.isArray(cg.buyOffers) ? cg.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `cg-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `cg-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitOffersOnly(item, {
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          offersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR,
        }),
      };
    }
    default:
      return { item, errorMessage: 'Unsupported price source.' };
  }
}

/**
 * Right-click "Use as RRP/offers source": set explicit RRP and tier-1/2/3 offers from CeX reference, eBay, or CC research.
 * @returns {{ item: object, errorMessage?: string }}
 */
export function applyRrpAndOffersFromPriceSource(item, zone, useVoucherOffers) {
  if (!item) return { item: null, errorMessage: 'No item selected.' };

  switch (zone) {
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL: {
      const rrp = resolvePersistedCexRrp(item);
      if (rrp == null || rrp <= 0) {
        return {
          item,
          errorMessage: 'No CeX-based RRP on this row. Refresh CeX data or check reference data.',
        };
      }
      const { cashOffers, voucherOffers } = resolvePersistedCexOfferRows(item);
      const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
      if (!displayOffers.length) {
        return {
          item,
          errorMessage: 'No CeX tier offers on this row. Refresh CeX data.',
        };
      }
      return {
        item: nextItemWithExplicitRrpAndOffers(item, {
          rrp,
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY: {
      const eb = item.ebayResearchData;
      if (!eb?.stats) {
        return { item, errorMessage: 'Run eBay research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(eb.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from eBay research.' };
      }
      let buyOffers = Array.isArray(eb.buyOffers) ? eb.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `ebay-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `ebay-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitRrpAndOffers(item, {
          rrp,
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS: {
      const cc = item.cashConvertersResearchData;
      if (!cc?.stats) {
        return { item, errorMessage: 'Run Cash Converters research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cc.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Converters research.' };
      }
      let buyOffers = Array.isArray(cc.buyOffers) ? cc.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `cc-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `cc-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitRrpAndOffers(item, {
          rrp,
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS,
        }),
      };
    }
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR: {
      const cg = item.cgResearchData;
      if (!cg?.stats) {
        return { item, errorMessage: 'Run Cash Generator research on this row first.' };
      }
      const rrp = resolveSuggestedRetailFromResearchStats(cg.stats);
      if (rrp == null || rrp <= 0) {
        return { item, errorMessage: 'Could not determine RRP from Cash Generator research.' };
      }
      let buyOffers = Array.isArray(cg.buyOffers) ? cg.buyOffers : [];
      if (!buyOffers.length) {
        buyOffers = calculateBuyOffers(rrp, null);
      }
      const cashOffers = buyOffers.slice(0, 4).map((o, idx) => ({
        id: `cg-rrp_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(Number(o.price)),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `cg-rrp-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      return {
        item: nextItemWithExplicitRrpAndOffers(item, {
          rrp,
          cashOffers,
          voucherOffers,
          useVoucherOffers,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR,
        }),
      };
    }
    default:
      return { item, errorMessage: 'Unsupported price source.' };
  }
}

// Barrel re-exports — implementations moved to focused modules.
export {
  getDisplayOffers,
  sumOfferMinMaxForNegotiationItems,
  offerMinMaxFromCexProductData,
  offerMinMaxFromResearchBuyOffers,
  offerMinMaxFromWorkspaceOfferRows,
  calculateItemTargetContribution,
  calculateTotalOfferPrice,
  calculateJewelleryOfferTotal,
  calculateNonJewelleryOfferTotal,
} from '@/negotiation/offerMath';

export {
  isNegotiationJewelleryLine,
  isNegotiationCexWorkspaceLine,
  isNegotiationBuilderWorkspaceLine,
  isNegotiationMarketplaceWorkspaceLine,
  isNegotiationEbayWorkspaceLine,
  isNegotiationCashConvertersWorkspaceLine,
  isNegotiationCashGeneratorWorkspaceLine,
} from '@/negotiation/lineTypes';

export {
  HEADER_EBAY_CUSTOMER_EXPECTATION_KEY,
  HEADER_CC_CUSTOMER_EXPECTATION_KEY,
  HEADER_CG_CUSTOMER_EXPECTATION_KEY,
  HEADER_OTHER_CUSTOMER_EXPECTATION_KEY,
  getNegotiationOtherNosposScopeLine,
  resolveCustomerExpectationDraftForAdd,
  formatSumLineCustomerExpectations,
} from '@/negotiation/customerExpectation';

export function buildFinishPayload(
  items,
  targetOffer,
  useVoucherOffers,
  totalOfferPrice,
  customerData = null,
  jewelleryReferenceScrape = null
) {
  const itemsData = items
    .filter(item => !item.isRemoved && item.request_item_id)
    .map(item => {
      const quantity = item.quantity || 1;
      let negotiatedPrice = 0;

      if (item.selectedOfferId === 'manual' && item.manualOffer) {
        negotiatedPrice = parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0;
      } else {
        const selected = getDisplayOffers(item, useVoucherOffers)?.find(o => o.id === item.selectedOfferId);
        negotiatedPrice = selected ? selected.price : 0;
      }

      const rawInput = item.ourSalePriceInput;
      const parsedFromInput = rawInput !== undefined && rawInput !== ''
        ? parseFloat(String(rawInput).replace(/[£,]/g, ''))
        : NaN;
      const fromActiveInput = !Number.isNaN(parsedFromInput) && parsedFromInput > 0;
      const ourSalePriceRaw = fromActiveInput
        ? parsedFromInput / quantity
        : (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
            ? Number(item.ourSalePrice)
            : (item.ebayResearchData?.stats?.suggestedPrice != null
                ? Number(item.ebayResearchData.stats.suggestedPrice)
                : null));
      const fromExplicit =
        fromActiveInput ||
        (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== '');
      const ourSalePrice =
        ourSalePriceRaw != null && !Number.isNaN(ourSalePriceRaw) && ourSalePriceRaw > 0
          ? (fromExplicit ? normalizeExplicitSalePrice(ourSalePriceRaw) : roundSalePrice(ourSalePriceRaw))
          : null;

      const rawDataSource =
        item.rawData ||
        (item.isCustomCeXItem ? item.cexProductData : null) ||
        item.ebayResearchData ||
        {};
      const rawData = { ...rawDataSource };
      // Overlay live research from React state: `item.rawData` is the API snapshot from load and does not
      // update when the user changes eBay advanced filters, price/date drill, or listings in the overlay.
      if (item.isCustomCeXItem) {
        if (item.ebayResearchData) rawData.ebayResearchData = item.ebayResearchData;
        if (item.cashConvertersResearchData) {
          rawData.cashConvertersResearchData = item.cashConvertersResearchData;
        }
        if (item.cgResearchData) {
          rawData.cgResearchData = item.cgResearchData;
        }
      } else if (item.ebayResearchData) {
        const ebay = item.ebayResearchData;
        for (const key of Object.keys(ebay)) {
          if (ebay[key] !== undefined) rawData[key] = ebay[key];
        }
      } else if (item.isCustomCashConvertersItem && item.cashConvertersResearchData) {
        const cc = item.cashConvertersResearchData;
        for (const key of Object.keys(cc)) {
          if (cc[key] !== undefined) rawData[key] = cc[key];
        }
      } else if (item.isCustomCashGeneratorItem && item.cgResearchData) {
        const cg = item.cgResearchData;
        for (const key of Object.keys(cg)) {
          if (cg[key] !== undefined) rawData[key] = cg[key];
        }
        rawData.isCustomCashGeneratorItem = true;
      }
      // Always embed referenceData (with percentage_used etc.) so it survives round-trips
      if (item.referenceData && !rawData.referenceData && !rawData.reference_data) {
        rawData.referenceData = item.referenceData;
      }
      rawData.display_title = item.title ?? '';
      rawData.display_subtitle = item.subtitle ?? '';
      if (item.rrpOffersSource != null && item.rrpOffersSource !== '') {
        rawData.rrpOffersSource = item.rrpOffersSource;
      }
      if (item.offersSource != null && item.offersSource !== '') {
        rawData.offersSource = item.offersSource;
      }
      if (Array.isArray(item.authorisedOfferSlots) && item.authorisedOfferSlots.length > 0) {
        rawData.authorisedOfferSlots = item.authorisedOfferSlots;
      }

      // Ensure NosPos hints + saved stock fields survive book/draft even when only on item top-level
      // or nested under ebayResearchData (getters merge all candidate locations).
      const nosposCatHint = getAiSuggestedNosposStockCategoryFromItem(item);
      if (nosposCatHint) {
        rawData.aiSuggestedNosposStockCategory = nosposCatHint;
      }
      const nosposFieldBlob = getAiSuggestedNosposStockFieldValuesFromItem(item);
      if (nosposFieldBlob) {
        rawData.aiSuggestedNosposStockFieldValues = nosposFieldBlob;
      }

      const cexBuyCash =
        item.cexBuyPrice != null ? normalizeExplicitSalePrice(Number(item.cexBuyPrice)) : null;
      const cexBuyVoucher =
        item.cexVoucherPrice != null ? normalizeExplicitSalePrice(Number(item.cexVoucherPrice)) : null;
      const cexSell =
        item.cexSellPrice != null ? normalizeExplicitSalePrice(Number(item.cexSellPrice)) : null;

      return {
        request_item_id: item.request_item_id,
        quantity,
        selected_offer_id: item.selectedOfferId,
        manual_offer_gbp: item.manualOffer
          ? normalizeExplicitSalePrice(parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0)
          : null,
        manual_offer_used: item.selectedOfferId === 'manual',
        senior_mgmt_approved_by: item.seniorMgmtApprovedBy || null,
        customer_expectation_gbp: item.customerExpectation
          ? normalizeExplicitSalePrice(parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0)
          : null,
        negotiated_price_gbp: normalizeExplicitSalePrice(negotiatedPrice * quantity),
        our_sale_price_at_negotiation: ourSalePrice,
        cash_offers_json: item.cashOffers || [],
        voucher_offers_json: item.voucherOffers || [],
        raw_data: rawData,
        cash_converters_data: item.cashConvertersResearchData || {},
        cg_data: item.cgResearchData || {},
        ...(cexBuyCash != null && { cex_buy_cash_at_negotiation: cexBuyCash }),
        ...(cexBuyVoucher != null && { cex_buy_voucher_at_negotiation: cexBuyVoucher }),
        ...(cexSell != null && { cex_sell_at_negotiation: cexSell }),
      };
    });

  const overallExpectationValue = normalizeRequestTotalGbp(
    itemsData.reduce((acc, row) => acc + (Number(row.customer_expectation_gbp) || 0), 0)
  );
  const targetOfferRaw = parseFloat(String(targetOffer ?? '').replace(/[£,]/g, '').trim());
  const targetOfferValue =
    Number.isFinite(targetOfferRaw) && targetOfferRaw > 0
      ? normalizeRequestTotalGbp(targetOfferRaw)
      : null;

  return {
    items_data: itemsData,
    overall_expectation_gbp: overallExpectationValue,
    negotiated_grand_total_gbp: normalizeRequestTotalGbp(totalOfferPrice),
    ...(targetOfferValue && { target_offer_gbp: targetOfferValue }),
    ...(customerData && { customer_enrichment: customerData }),
    ...(jewelleryReferenceScrape != null &&
      typeof jewelleryReferenceScrape === 'object' &&
      Array.isArray(jewelleryReferenceScrape.sections) &&
      jewelleryReferenceScrape.sections.length > 0 && {
        jewellery_reference_scrape: jewelleryReferenceScrape,
      }),
  };
}

/** True when a quote draft POST should run (line items and/or persisted jewellery reference). */
export function isQuoteDraftPayloadSaveable(payload) {
  if (!payload) return false;
  if ((payload.items_data?.length ?? 0) > 0) return true;
  if ((payload.jewellery_reference_scrape?.sections?.length ?? 0) > 0) return true;
  return false;
}

// ─── Data mapping: API response → negotiation item shape ───────────────────

export function mapApiItemToNegotiationItem(item, transactionType, mode) {
  const testingPassed = Boolean(item.testing_passed);
  const [cartItem] = mapRequestItemsToCartItems([item], transactionType);
  if (!cartItem) {
    return {
      id: item.request_item_id,
      request_item_id: item.request_item_id,
      title: 'N/A',
      subtitle: '',
      quantity: item.quantity || 1,
      selectedOfferId: item.selected_offer_id,
      manualOffer: item.manual_offer_gbp?.toString() || '',
      manualOfferUsed: item.manual_offer_used ?? (item.selected_offer_id === 'manual'),
      seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
      authorisedOfferSlots: Array.isArray(item?.raw_data?.authorisedOfferSlots) ? item.raw_data.authorisedOfferSlots : [],
      customerExpectation: item.customer_expectation_gbp?.toString() || '',
      ebayResearchData: null,
      cashConvertersResearchData: null,
      cgResearchData: null,
      offers: [],
      cashOffers: [],
      voucherOffers: [],
      testingPassed,
    };
  }

  const ebayResearchData =
    cartItem.ebayResearchData
    || cartItem.rawData?.ebayResearchData
    || (cartItem.rawData?.stats && cartItem.rawData?.selectedFilters ? cartItem.rawData : null);

  const useVoucherFromTx = transactionType === 'store_credit';
  let next = normalizeCartItemForNegotiation(
    {
      ...cartItem,
      seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
      authorisedOfferSlots: Array.isArray(item?.raw_data?.authorisedOfferSlots)
        ? item.raw_data.authorisedOfferSlots
        : cartItem.authorisedOfferSlots,
    },
    useVoucherFromTx
  );

  const resolveOurSaleFromApi = () => {
    const rawSaved =
      item.our_sale_price_at_negotiation != null && item.our_sale_price_at_negotiation !== ''
        ? parseFloat(item.our_sale_price_at_negotiation)
        : null;
    if (rawSaved != null && !Number.isNaN(rawSaved) && rawSaved > 0) {
      return normalizeExplicitSalePrice(rawSaved);
    }
    const jewRef = cartItem.referenceData || cartItem.rawData?.referenceData;
    if (cartItem.isJewelleryItem && jewRef?.computed_total_gbp != null && jewRef?.jewellery_line === true) {
      const jt = parseFloat(jewRef.computed_total_gbp);
      if (!Number.isNaN(jt) && jt > 0) return normalizeExplicitSalePrice(jt);
    }
    const refRaw =
      ebayResearchData?.referenceData?.cex_based_sale_price ??
      ebayResearchData?.reference_data?.cex_based_sale_price ??
      cartItem.rawData?.referenceData?.cex_based_sale_price ??
      cartItem.rawData?.reference_data?.cex_based_sale_price;
    const fromRef =
      refRaw != null && refRaw !== '' ? parseFloat(refRaw) : null;
    if (fromRef != null && !Number.isNaN(fromRef) && fromRef > 0) {
      return roundSalePrice(fromRef);
    }
    const fromSuggested =
      ebayResearchData?.stats?.suggestedPrice != null
        ? parseFloat(ebayResearchData.stats.suggestedPrice)
        : null;
    return fromSuggested != null && !Number.isNaN(fromSuggested) && fromSuggested > 0
      ? roundSalePrice(fromSuggested)
      : null;
  };

  if (mode === 'view') {
    if (next.isJewelleryItem === true) {
      return {
        ...next,
        ourSalePrice: resolveOurSaleFromApi(),
        cexBuyPrice: null,
        cexVoucherPrice: null,
        cexSellPrice: null,
        cexUrl: null,
        testingPassed,
      };
    }
    const ref = next.referenceData || {};
    const rawRef = next.rawData?.referenceData || next.rawData?.reference_data;
    const cexSkuForUrl =
      next.cexSku ??
      ref.cex_sku ??
      ref.id ??
      rawRef?.cex_sku ??
      rawRef?.id ??
      item.variant_details?.cex_sku ??
      (next.isCustomCeXItem ? next.rawData?.id : null) ??
      null;
    const cexUrl =
      next.cexUrl ??
      (cexSkuForUrl != null && String(cexSkuForUrl).trim() !== ''
        ? `https://uk.webuy.com/product-detail?id=${cexSkuForUrl}`
        : null);
    return {
      ...next,
      cexBuyPrice: (item.cex_buy_cash_at_negotiation != null && item.cex_buy_cash_at_negotiation !== '')
        ? parseFloat(item.cex_buy_cash_at_negotiation)
        : next.cexBuyPrice,
      cexVoucherPrice: (item.cex_buy_voucher_at_negotiation != null && item.cex_buy_voucher_at_negotiation !== '')
        ? parseFloat(item.cex_buy_voucher_at_negotiation)
        : next.cexVoucherPrice,
      cexSellPrice: (item.cex_sell_at_negotiation != null && item.cex_sell_at_negotiation !== '')
        ? parseFloat(item.cex_sell_at_negotiation)
        : next.cexSellPrice,
      cexOutOfStock: item.variant_details?.cex_out_of_stock ?? next.cexOutOfStock,
      ourSalePrice: resolveOurSaleFromApi(),
      cexUrl,
      testingPassed,
    };
  }

  if (next.isJewelleryItem === true) {
    return {
      ...next,
      cexBuyPrice: null,
      cexVoucherPrice: null,
      cexSellPrice: null,
      ourSalePrice: resolveOurSaleFromApi(),
      testingPassed,
    };
  }

  const vd = item.variant_details;
  return {
    ...next,
    cexBuyPrice: vd?.tradein_cash != null ? parseFloat(vd.tradein_cash) : next.cexBuyPrice,
    cexVoucherPrice: vd?.tradein_voucher != null ? parseFloat(vd.tradein_voucher) : next.cexVoucherPrice,
    cexSellPrice: vd?.current_price_gbp != null ? parseFloat(vd.current_price_gbp) : next.cexSellPrice,
    ourSalePrice: resolveOurSaleFromApi(),
    testingPassed,
  };
}

/**
 * True when the row carries persisted eBay research (aligned with `mapRequestItemsToCartItems` in
 * `requestToCartMapping.js`). Must not require `selectedFilters`: it is sometimes absent on older or
 * API-round-tripped blobs while stats/listings/offers remain — otherwise we misclassify eBay rows and
 * copy subtitle ("eBay Research") into variantName, which wins over title in the negotiation table.
 */
function negotiationItemHasMergedEbayResearch(item) {
  const b = item.ebayResearchData;
  if (item.isCustomEbayItem === true) return true;
  if (!b || typeof b !== 'object') return false;
  return !!(
    (Array.isArray(b.listings) && b.listings.length > 0) ||
    (Array.isArray(b.buyOffers) && b.buyOffers.length > 0) ||
    (b.stats != null && typeof b.stats === 'object')
  );
}

/** Normalize a cart item from the buyer store into the shape the negotiation page expects. */
export function normalizeCartItemForNegotiation(item, useVoucherOffers = false) {
  const resolvedSelectedOfferId = (item.selectedOfferId != null && item.selectedOfferId !== '')
    ? item.selectedOfferId
    : null;
  if (item.isJewelleryItem === true) {
    const withId = { ...item, selectedOfferId: resolvedSelectedOfferId };
    const rebuilt = rebuildJewelleryOffersForNegotiationItem(withId, useVoucherOffers);
    return withDefaultRrpOffersSource(rebuilt);
  }
  const hasMergedEbayResearch = negotiationItemHasMergedEbayResearch(item);
  const ebayBlob = item.ebayResearchData;
  const cexName = item.variant_details?.title
    || (!hasMergedEbayResearch && (ebayBlob?.title || ebayBlob?.modelName))
    || (item.isCustomCeXItem && item.title) || null;
  const isCexItem = !!(cexName || item.isCustomCeXItem || (item.cexBuyPrice != null || item.cexSellPrice != null));
  let next = item;
  if (isCexItem) {
    // Prefer explicit variantName first (e.g. CeX add-from-browser: research query / title).
    // Subtitle is almost always CeX category — it must not win over cexName/title when variantName is unset
    // (otherwise AI marketplace search + summaries see category as the product name).
    const variantName =
      item.variantName
      || cexName
      || item.title
      || item.subtitle
      || null;
    next = { ...item, title: cexName || item.title, variantName, subtitle: '' };
  } else if (
    !item.variantName &&
    item.subtitle != null &&
    String(item.subtitle).trim() !== '' &&
    // eBay / CC / CG custom research rows: title is the marketplace search term; subtitle is a fixed channel label — must not become variantName.
    !(hasMergedEbayResearch && !isCexItem) &&
    item.isCustomCashConvertersItem !== true &&
    item.isCustomCashGeneratorItem !== true
  ) {
    // Internal DB / header builder: variant line is often only in subtitle; copy for research queries.
    next = { ...item, variantName: String(item.subtitle).trim() };
  }
  return withDefaultRrpOffersSource({ ...next, selectedOfferId: resolvedSelectedOfferId });
}

// ─── Research completion: merge saved research vs committed row pricing ─────
//
// Two phases so Negotiation can persist listings/stats immediately while deferring tier
// offers + selection until SalePriceConfirmModal ("Yes" applies RRP/offers via modal).

/**
 * Persist eBay research payload (listings, stats, buyOffers, filters, …) and side metadata.
 * Does not change cashOffers / voucherOffers / offers / selectedOfferId / manualOffer.
 */
export function mergeEbayResearchDataIntoItem(item, updatedState) {
  return mergeResearchDataIntoItem(item, updatedState, MARKETPLACE_DESCRIPTORS.ebay);
}

export function applyEbayResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers) {
  return applyResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.ebay);
}

export function applyEbayResearchToItem(item, updatedState, useVoucherOffers) {
  return applyResearchToItem(item, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.ebay);
}

export function mergeCashConvertersResearchDataIntoItem(item, updatedState) {
  return mergeResearchDataIntoItem(item, updatedState, MARKETPLACE_DESCRIPTORS.cashConverters);
}

export function applyCashConvertersResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers) {
  return applyResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.cashConverters);
}

export function applyCashConvertersResearchToItem(item, updatedState, useVoucherOffers) {
  return applyResearchToItem(item, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.cashConverters);
}

export function mergeCashGeneratorResearchDataIntoItem(item, updatedState) {
  return mergeResearchDataIntoItem(item, updatedState, MARKETPLACE_DESCRIPTORS.cashGenerator);
}

export function applyCashGeneratorResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers) {
  return applyResearchCommittedPricingToItem(preMergeItem, mergedItem, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.cashGenerator);
}

export function applyCashGeneratorResearchToItem(item, updatedState, useVoucherOffers) {
  return applyResearchToItem(item, updatedState, useVoucherOffers, MARKETPLACE_DESCRIPTORS.cashGenerator);
}

/**
 * Merge CeX pencil / lookup onto the row: CeX column prices, SKU, URL, product blob, category,
 * and reference layers (including CeX tier rows in reference for a later "Use CeX as RRP" apply).
 * Does not change committed RRP column, tier cards, or rrpOffersSource — use
 * applyRrpAndOffersFromPriceSource(PRICE_SOURCE_CEX_SELL) or applyCeXProductDataToItem for that.
 * @param {{ log?: boolean }} [options] - Pass `{ log: false }` when this merge is immediately followed by a full CeX RRP apply (avoids duplicate category logs).
 */
export function mergeCeXPencilLookupIntoItem(item, cexProductData, options = {}) {
  const { log: shouldLog = true } = options;
  if (!item || !cexProductData) return item;
  const refData = cexProductData.referenceData || {};
  const cashOffers = slimCexNegotiationOfferRows(refData.cash_offers || cexProductData.cash_offers || []);
  const voucherOffers = slimCexNegotiationOfferRows(refData.voucher_offers || cexProductData.voucher_offers || []);

  const mergedReferenceData = {
    ...(item.referenceData || {}),
    ...(refData || {}),
    cash_offers: cashOffers,
    voucher_offers: voucherOffers,
    ...(cexProductData.id != null ? { cex_sku: cexProductData.id, id: cexProductData.id } : {}),
  };
  const cexBasedRaw = mergedReferenceData.cex_based_sale_price;
  const cexBasedRounded =
    cexBasedRaw != null && Number.isFinite(Number(cexBasedRaw))
      ? roundSalePrice(Number(cexBasedRaw))
      : null;
  if (cexBasedRounded != null) {
    mergedReferenceData.our_sale_price = cexBasedRounded;
  }
  const mergedRawData = {
    ...(item.rawData || {}),
    ...cexProductData,
    referenceData: mergedReferenceData,
    ...(item.ebayResearchData ? { ebayResearchData: item.ebayResearchData } : {}),
    ...(item.cashConvertersResearchData ? { cashConvertersResearchData: item.cashConvertersResearchData } : {}),
    ...(item.cgResearchData ? { cgResearchData: item.cgResearchData } : {}),
  };

  const newCategory = cexProductData.category || item.category;
  const prevCategoryName = String(item.category || item.categoryObject?.name || '').trim().toLowerCase();
  const nextCategoryName = String(newCategory || '').trim().toLowerCase();
  const categoryChanged = Boolean(nextCategoryName) && prevCategoryName !== nextCategoryName;

  const newCategoryObject =
    cexProductData.categoryObject?.id != null
      ? cexProductData.categoryObject
      : cexProductData.categoryObject || (categoryChanged
          ? { name: newCategory, path: [newCategory] }
          : item.categoryObject?.id != null
            ? item.categoryObject
            : newCategory
              ? { name: newCategory, path: [newCategory] }
              : item.categoryObject);

  const nextItem = {
    ...item,
    cexSellPrice: refData.cex_sale_price != null ? Number(refData.cex_sale_price) : item.cexSellPrice,
    cexBuyPrice: refData.cex_tradein_cash != null ? Number(refData.cex_tradein_cash) : item.cexBuyPrice,
    cexVoucherPrice: refData.cex_tradein_voucher != null ? Number(refData.cex_tradein_voucher) : item.cexVoucherPrice,
    cexOutOfStock: cexProductData.isOutOfStock ?? item.cexOutOfStock ?? false,
    cexSku: cexProductData.id ?? item.cexSku ?? null,
    cexUrl: cexProductData.id ? `https://uk.webuy.com/product-detail?id=${cexProductData.id}` : item.cexUrl ?? null,
    cexProductData: cexProductData,
    referenceData: mergedReferenceData,
    rawData: mergedRawData,
    category: newCategory || item.category,
    categoryObject: newCategoryObject,
  };
  if (shouldLog) {
    logCategoryRuleDecision({
      context: categoryChanged ? 'cex-pencil-lookup-category-changed' : 'cex-pencil-lookup-metadata',
      item: nextItem,
      categoryObject: nextItem.categoryObject,
      categoryName: newCategory || null,
      rule: {
        source: 'cex-reference-rule',
        ...buildRuleSnapshotFromReferenceData(mergedReferenceData),
      },
      notes: categoryChanged ? 'Cleared stale category id because CeX category changed.' : null,
    });
  }
  return nextItem;
}

function applyCeXCommittedPricingLegacy(preLookupItem, mergedItem, cexProductData, useVoucherOffers) {
  const refData = cexProductData.referenceData || {};
  const cashOffers = slimCexNegotiationOfferRows(refData.cash_offers || cexProductData.cash_offers || []);
  const voucherOffers = slimCexNegotiationOfferRows(refData.voucher_offers || cexProductData.voucher_offers || []);
  const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
  const prevDisplayOffers = getDisplayOffers(preLookupItem, useVoucherOffers);
  const prevSelectedIndex = prevDisplayOffers.findIndex((o) => o.id === preLookupItem.selectedOfferId);

  let nextSelectedOfferId = preLookupItem.selectedOfferId;
  if (preLookupItem.selectedOfferId === 'manual') {
    nextSelectedOfferId = 'manual';
  } else if (prevSelectedIndex >= 0 && displayOffers.length) {
    const idx = Math.min(prevSelectedIndex, displayOffers.length - 1);
    nextSelectedOfferId = displayOffers[idx]?.id ?? null;
  } else {
    nextSelectedOfferId = null;
  }

  const ref = mergedItem.referenceData || {};
  const cexBasedRaw = ref.cex_based_sale_price;
  const cexBasedRounded =
    cexBasedRaw != null && Number.isFinite(Number(cexBasedRaw))
      ? roundSalePrice(Number(cexBasedRaw))
      : null;

  const cexZ = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
  const nextItem = {
    ...mergedItem,
    cashOffers,
    voucherOffers,
    offers: displayOffers,
    selectedOfferId: nextSelectedOfferId,
    ...(cexBasedRounded != null ? { ourSalePrice: String(cexBasedRounded) } : {}),
    rrpOffersSource: cexZ,
    offersSource: cexZ,
  };
  logCategoryRuleDecision({
    context: 'cex-data-applied',
    item: nextItem,
    categoryObject: nextItem.categoryObject,
    categoryName: mergedItem.category || null,
    rule: {
      source: 'cex-reference-rule',
      ...buildRuleSnapshotFromReferenceData(mergedItem.referenceData || {}),
    },
    notes: null,
  });
  return nextItem;
}

/**
 * Apply "Add from CeX" product data onto an existing negotiation/repricing row (metadata + CeX as RRP source).
 */
export function applyCeXProductDataToItem(item, cexProductData, useVoucherOffers) {
  if (!item || !cexProductData) return item;
  const merged = mergeCeXPencilLookupIntoItem(item, cexProductData, { log: false });
  const { item: applied, errorMessage } = applyRrpAndOffersFromPriceSource(
    merged,
    NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
    useVoucherOffers
  );
  if (!errorMessage) {
    logCategoryRuleDecision({
      context: 'cex-data-applied',
      item: applied,
      categoryObject: applied.categoryObject,
      categoryName: applied.category || null,
      rule: {
        source: 'cex-reference-rule',
        ...buildRuleSnapshotFromReferenceData(applied.referenceData || {}),
      },
      notes: null,
    });
    return applied;
  }
  return applyCeXCommittedPricingLegacy(item, merged, cexProductData, useVoucherOffers);
}
