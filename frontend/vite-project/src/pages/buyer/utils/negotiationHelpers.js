import { normalizeExplicitSalePrice, roundOfferPrice, roundSalePrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import { slimCexNegotiationOfferRows } from '@/utils/cexOfferMapping';
import { mapRequestItemsToCartItems } from '@/utils/requestToCartMapping';
import { calculateBuyOffers, titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { NEGOTIATION_ROW_CONTEXT } from '../rowContextZones';
import { rebuildJewelleryOffersForNegotiationItem } from '@/components/jewellery/jewelleryNegotiationCart';

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

export function buildInitialSearchQuery(item) {
  // Saved research, then explicit variant line / subtitle, then title only (no spec concatenation).
  if (!item) return undefined;
  const fromResearch =
    item.ebayResearchData?.searchTerm
    || item.ebayResearchData?.lastSearchedTerm;
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
 * Rows that carry CeX trade/sell context must keep CeX-sourced 1st/2nd/3rd offers in the table;
 * eBay / Cash Converters research must not replace them.
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
 * Default RRP/offers source highlight when unset: CeX-backed rows → Sell column;
 * eBay-primary rows → eBay column (custom eBay lines or eBay research without CeX context).
 */
export function withDefaultRrpOffersSource(item) {
  if (!item) return item;
  if (item.rrpOffersSource != null && item.rrpOffersSource !== '') return item;
  if (isCeXBackedNegotiationItem(item)) {
    return { ...item, rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL };
  }
  if (
    item.isCustomEbayItem === true ||
    (item.ebayResearchData && !item.isCustomCashConvertersItem)
  ) {
    return { ...item, rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY };
  }
  return item;
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

/** Exclude eBay / CC buy-offer rows so we do not re-slim those as CeX tiers. */
function rowOffersLookLikeCexTiers(offers) {
  if (!Array.isArray(offers) || !offers.length) return false;
  return !offers.some((o) => {
    const id = o?.id != null ? String(o.id) : '';
    return id.startsWith('ebay-') || id.startsWith('cc-') || id.includes('ebay-rrp') || id.includes('cc-rrp');
  });
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
  const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;

  let selectedOfferId;
  let manualOffer;
  if (item.selectedOfferId === 'manual') {
    selectedOfferId = 'manual';
    manualOffer = item.manualOffer ?? '';
  } else if (item.selectedOfferId != null && item.selectedOfferId !== '') {
    const prevDisplay = getDisplayOffers(item, useVoucherOffers);
    const prevIdx = prevDisplay.findIndex((o) => o.id === item.selectedOfferId);
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

  const next = { ...item };
  delete next.ourSalePriceInput;
  return {
    ...next,
    ourSalePrice: formatOfferPrice(rrp),
    useResearchSuggestedPrice: false,
    cashOffers,
    voucherOffers,
    offers: displayOffers,
    selectedOfferId,
    manualOffer,
    rrpOffersSource: rrpOffersSource ?? null,
  };
}

/**
 * Right-click "Use as RRP/offers source": set explicit RRP and tier-1/2/3 offers from CeX reference, eBay, or CC research.
 * @returns {{ item: object, errorMessage?: string }}
 */
export function applyRrpAndOffersFromPriceSource(item, zone, useVoucherOffers) {
  if (!item) return { item: null, errorMessage: 'No item selected.' };

  switch (zone) {
    case NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL: {
      const ref = item.referenceData || {};
      const raw = item.rawData || item.cexProductData || {};
      const rawRef = raw.referenceData || raw.reference_data || {};
      const rrp = resolveCexRrpFromItemLayers(item, ref, raw, rawRef);
      if (rrp == null || rrp <= 0) {
        return {
          item,
          errorMessage: 'No CeX-based RRP on this row. Refresh CeX data or check reference data.',
        };
      }
      const cashRaw = firstNonEmptyOfferArray(
        ref.cash_offers,
        rawRef.cash_offers,
        raw.cash_offers,
        rowOffersLookLikeCexTiers(item.cashOffers) ? item.cashOffers : null,
      );
      const voucherRaw = firstNonEmptyOfferArray(
        ref.voucher_offers,
        rawRef.voucher_offers,
        raw.voucher_offers,
        rowOffersLookLikeCexTiers(item.voucherOffers) ? item.voucherOffers : null,
      );
      let cashOffers = slimCexNegotiationOfferRows(cashRaw);
      let voucherOffers = slimCexNegotiationOfferRows(voucherRaw);
      if (useVoucherOffers && !voucherOffers.length && cashOffers.length) {
        voucherOffers = cashOffers.map((o) => ({
          id: `cex-v-${o.id}`,
          title: o.title,
          price: toVoucherOfferPrice(o.price),
        }));
      } else if (!useVoucherOffers && !cashOffers.length && voucherOffers.length) {
        cashOffers = voucherOffers.map((o) => ({
          id: `cex-c-${o.id}`,
          title: o.title,
          price: roundOfferPrice(Number(o.price) / 1.1),
        }));
      }
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
    default:
      return { item, errorMessage: 'Unsupported price source.' };
  }
}

export function getDisplayOffers(item, useVoucherOffers) {
  // Prefer non-empty typed arrays so an accidental [] does not mask aligned `offers`,
  // and CeX-backed rows still resolve to real tier offers when cash/voucher stayed in sync.
  if (useVoucherOffers) {
    if (item.voucherOffers?.length) return item.voucherOffers;
    return item.offers || [];
  }
  if (item.cashOffers?.length) return item.cashOffers;
  return item.offers || [];
}

function getItemOfferTotal(item, useVoucherOffers) {
  if (item.isRemoved) return 0;
  const qty = item.quantity || 1;
  if (item.selectedOfferId === 'manual' && item.manualOffer) {
    return (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) * qty;
  }
  const selected = getDisplayOffers(item, useVoucherOffers)?.find(o => o.id === item.selectedOfferId);
  return selected ? selected.price * qty : 0;
}

export function calculateItemTargetContribution(itemId, items, targetOffer, useVoucherOffers) {
  const parsedTarget = parseFloat(targetOffer);
  if (!parsedTarget || parsedTarget <= 0) return null;
  const otherTotal = items
    .filter(i => !i.isRemoved && i.id !== itemId)
    .reduce((sum, i) => sum + getItemOfferTotal(i, useVoucherOffers), 0);
  return parsedTarget - otherTotal;
}

export function calculateTotalOfferPrice(items, useVoucherOffers) {
  return items.reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

/** Sum of selected/manual offers for jewellery lines only (for negotiation sidebar breakdown). */
export function calculateJewelleryOfferTotal(items, useVoucherOffers) {
  return items
    .filter((i) => !i.isRemoved && i.isJewelleryItem === true)
    .reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

/** Sum for non-jewellery lines (catalogue / CeX / eBay etc.). */
export function calculateNonJewelleryOfferTotal(items, useVoucherOffers) {
  return items
    .filter((i) => !i.isRemoved && i.isJewelleryItem !== true)
    .reduce((sum, item) => sum + getItemOfferTotal(item, useVoucherOffers), 0);
}

// ─── Payload builders ──────────────────────────────────────────────────────

export function buildFinishPayload(
  items,
  totalExpectation,
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
      } else if (item.ebayResearchData) {
        const ebay = item.ebayResearchData;
        for (const key of Object.keys(ebay)) {
          if (ebay[key] !== undefined) rawData[key] = ebay[key];
        }
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
      if (Array.isArray(item.authorisedOfferSlots) && item.authorisedOfferSlots.length > 0) {
        rawData.authorisedOfferSlots = item.authorisedOfferSlots;
      }

      const cexBuyCash = item.cexBuyPrice != null ? Number(item.cexBuyPrice) : null;
      const cexBuyVoucher = item.cexVoucherPrice != null ? Number(item.cexVoucherPrice) : null;
      const cexSell = item.cexSellPrice != null ? Number(item.cexSellPrice) : null;

      return {
        request_item_id: item.request_item_id,
        quantity,
        selected_offer_id: item.selectedOfferId,
        manual_offer_gbp: item.manualOffer ? (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) : null,
        manual_offer_used: item.selectedOfferId === 'manual',
        senior_mgmt_approved_by: item.seniorMgmtApprovedBy || null,
        customer_expectation_gbp: item.customerExpectation ? (parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0) : null,
        negotiated_price_gbp: negotiatedPrice * quantity,
        our_sale_price_at_negotiation: ourSalePrice,
        cash_offers_json: item.cashOffers || [],
        voucher_offers_json: item.voucherOffers || [],
        raw_data: rawData,
        cash_converters_data: item.cashConvertersResearchData || {},
        ...(cexBuyCash != null && { cex_buy_cash_at_negotiation: cexBuyCash }),
        ...(cexBuyVoucher != null && { cex_buy_voucher_at_negotiation: cexBuyVoucher }),
        ...(cexSell != null && { cex_sell_at_negotiation: cexSell }),
      };
    });

  const overallExpectationValue = parseFloat(totalExpectation.replace(/[£,]/g, '')) || 0;
  const targetOfferValue = parseFloat(targetOffer) || null;

  return {
    items_data: itemsData,
    overall_expectation_gbp: overallExpectationValue,
    negotiated_grand_total_gbp: totalOfferPrice,
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
  const isEbayPayload = !!(item.ebayResearchData?.stats && item.ebayResearchData?.selectedFilters);
  const cexName = item.variant_details?.title
    || (!isEbayPayload && (item.ebayResearchData?.title || item.ebayResearchData?.modelName))
    || (item.isCustomCeXItem && item.title) || null;
  const isCexItem = !!(cexName || item.isCustomCeXItem || (item.cexBuyPrice != null || item.cexSellPrice != null));
  let next = item;
  if (isCexItem) {
    // Prefer explicit variantName first (e.g. CeX add-from-browser: title + specs for eBay search).
    // For custom CeX items subtitle is often only category — it must not overwrite variantName.
    // Legacy buyer cart used subtitle as the specific variant line when variantName was unset.
    const variantName =
      item.variantName
      || item.subtitle
      || cexName
      || item.title
      || null;
    next = { ...item, title: cexName || item.title, variantName, subtitle: '' };
  } else if (
    !item.variantName &&
    item.subtitle != null &&
    String(item.subtitle).trim() !== '' &&
    // eBay-primary rows use title as the search term; subtitle is often "eBay Research" or filters — must not replace the displayed name.
    !(isEbayPayload && !isCexItem)
  ) {
    // Internal DB / header builder: variant line is often only in subtitle; copy for research queries.
    next = { ...item, variantName: String(item.subtitle).trim() };
  }
  return withDefaultRrpOffersSource({ ...next, selectedOfferId: resolvedSelectedOfferId });
}

// ─── Research completion → offer recalculation ─────────────────────────────

/**
 * Apply ebay research results to a negotiation item.
 * Returns the updated item (immutable).
 */
export function applyEbayResearchToItem(item, updatedState, useVoucherOffers) {
  const cexBacked = isCeXBackedNegotiationItem(item);
  const isEbayOnlyItem =
    item.isCustomEbayItem === true ||
    (!cexBacked && item.ebayResearchData?.stats && item.ebayResearchData?.selectedFilters);

  let newCashOffers = item.cashOffers || [];
  let newVoucherOffers = item.voucherOffers || [];

  if (updatedState.buyOffers && updatedState.buyOffers.length > 0) {
    if (isEbayOnlyItem) {
      newCashOffers = updatedState.buyOffers.map((o, idx) => ({
        id: `ebay-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(o.price),
      }));
      newVoucherOffers = newCashOffers.map(offer => ({
        id: `ebay-voucher-${offer.id}`,
        title: offer.title,
        price: toVoucherOfferPrice(offer.price),
      }));
    } else if (!cexBacked) {
      const hasExistingOffers =
        (item.cashOffers?.length > 0) || (item.voucherOffers?.length > 0) || (item.offers?.length > 0);
      if (!hasExistingOffers) {
        newCashOffers = updatedState.buyOffers.map((o, idx) => ({
          id: `ebay-cash_${idx + 1}`,
          title: titleForEbayCcOfferIndex(idx),
          price: roundOfferPrice(o.price),
        }));
        newVoucherOffers = newCashOffers.map(offer => ({
          id: `ebay-voucher-${offer.id}`,
          title: offer.title,
          price: toVoucherOfferPrice(offer.price),
        }));
      }
    }
  }

  const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;
  let newSelectedOfferId = item.selectedOfferId;
  let newManualOffer = item.manualOffer;

  if (updatedState.selectedOfferIndex !== undefined && updatedState.selectedOfferIndex !== null) {
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
    if (updatedState.manualOffer !== undefined) newManualOffer = updatedState.manualOffer;
    const prevOffers = getDisplayOffers(item, useVoucherOffers);
    const prevIdx = prevOffers?.findIndex(o => o.id === item.selectedOfferId);
    if (prevIdx >= 0 && displayOffers[prevIdx]) newSelectedOfferId = displayOffers[prevIdx].id;
  }

  const aiNos = updatedState?.aiSuggestedNosposStockCategory;
  const hasAiNosposHint =
    aiNos &&
    typeof aiNos === 'object' &&
    (aiNos.nosposId != null ||
      (aiNos.fullName != null && String(aiNos.fullName).trim() !== '') ||
      (Array.isArray(aiNos.pathSegments) && aiNos.pathSegments.length > 0));

  const nextItem = {
    ...item,
    ebayResearchData: updatedState,
    cashOffers: newCashOffers,
    voucherOffers: newVoucherOffers,
    offers: displayOffers,
    manualOffer: newManualOffer,
    selectedOfferId: newSelectedOfferId,
    // If the user picked a category during this research session, persist it onto the item
    // so subsequent research panels don't ask again.
    ...(updatedState.resolvedCategory ? { categoryObject: updatedState.resolvedCategory } : {}),
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
    context: 'ebay-research-complete',
    item: nextItem,
    categoryObject: nextItem.categoryObject,
    rule: {
      source: 'ebay-offer-margins',
      margins: Array.isArray(updatedState?.buyOffers) ? 'buyOffers-computed' : null,
    },
  });
  return nextItem;
}

/**
 * Apply Cash Converters research results to a negotiation item.
 * Returns the updated item (immutable).
 */
export function applyCashConvertersResearchToItem(item, updatedState, useVoucherOffers) {
  let newManualOffer = item.manualOffer;
  let newSelectedOfferId = item.selectedOfferId;

  if (updatedState.selectedOfferIndex !== undefined && updatedState.selectedOfferIndex !== null) {
    if (updatedState.selectedOfferIndex === 'manual') {
      newManualOffer = updatedState.manualOffer || item.manualOffer;
      newSelectedOfferId = 'manual';
    } else if (typeof updatedState.selectedOfferIndex === 'number') {
      const currentDisplayOffers = useVoucherOffers ? (item.voucherOffers || []) : (item.cashOffers || []);
      const selectedOffer = currentDisplayOffers[updatedState.selectedOfferIndex];
      if (selectedOffer) {
        newSelectedOfferId = selectedOffer.id;
        newManualOffer = '';
      }
    }
  } else if (updatedState.manualOffer) {
    newManualOffer = updatedState.manualOffer;
    newSelectedOfferId = 'manual';
  }

  const hasExistingOffers =
    (item.cashOffers?.length > 0) || (item.voucherOffers?.length > 0) || (item.offers?.length > 0);

  let newCashOffers = item.cashOffers || [];
  let newVoucherOffers = item.voucherOffers || [];
  if (!isCeXBackedNegotiationItem(item) && !hasExistingOffers && updatedState.buyOffers?.length > 0) {
    newCashOffers = updatedState.buyOffers.map((o, idx) => ({
      id: `cc-cash_${idx + 1}`,
      title: titleForEbayCcOfferIndex(idx),
      price: Number(o.price),
    }));
    newVoucherOffers = newCashOffers.map(offer => ({
      id: `cc-voucher-${offer.id}`,
      title: offer.title,
      price: toVoucherOfferPrice(offer.price),
    }));
  }
  const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;

  const nextItem = {
    ...item,
    cashConvertersResearchData: updatedState,
    cashOffers: newCashOffers,
    voucherOffers: newVoucherOffers,
    offers: displayOffers,
    manualOffer: newManualOffer,
    selectedOfferId: newSelectedOfferId,
    // If the user picked a category during this research session, persist it onto the item
    // so subsequent research panels don't ask again.
    ...(updatedState.resolvedCategory ? { categoryObject: updatedState.resolvedCategory } : {}),
  };
  logCategoryRuleDecision({
    context: 'cashconverters-research-complete',
    item: nextItem,
    categoryObject: nextItem.categoryObject,
    rule: {
      source: 'category-based-margins',
      margins: Array.isArray(updatedState?.buyOffers) ? 'buyOffers-computed' : null,
    },
  });
  return nextItem;
}

/**
 * Apply "Add from CeX" product data onto an existing negotiation/repricing row.
 * Keeps manual selections intact while replacing CeX prices and tier offers.
 */
export function applyCeXProductDataToItem(item, cexProductData, useVoucherOffers) {
  if (!item || !cexProductData) return item;
  const refData = cexProductData.referenceData || {};
  const cashOffers = slimCexNegotiationOfferRows(refData.cash_offers || cexProductData.cash_offers || []);
  const voucherOffers = slimCexNegotiationOfferRows(refData.voucher_offers || cexProductData.voucher_offers || []);
  const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
  const prevDisplayOffers = getDisplayOffers(item, useVoucherOffers);
  const prevSelectedIndex = prevDisplayOffers.findIndex((o) => o.id === item.selectedOfferId);

  let nextSelectedOfferId = item.selectedOfferId;
  if (item.selectedOfferId === 'manual') {
    nextSelectedOfferId = 'manual';
  } else if (prevSelectedIndex >= 0 && displayOffers.length) {
    const idx = Math.min(prevSelectedIndex, displayOffers.length - 1);
    nextSelectedOfferId = displayOffers[idx]?.id ?? null;
  } else {
    nextSelectedOfferId = null;
  }
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
    // Preserve current research payloads on the row when they already exist.
    ...(item.ebayResearchData ? { ebayResearchData: item.ebayResearchData } : {}),
    ...(item.cashConvertersResearchData ? { cashConvertersResearchData: item.cashConvertersResearchData } : {}),
  };

  // Use the fully resolved categoryObject from cexProductData when available (it already has a DB id).
  // Fall back to building a text-only object only if cexProductData has no resolved object.
  const newCategory = cexProductData.category || item.category;
  const prevCategoryName = String(item.category || item.categoryObject?.name || '').trim().toLowerCase();
  const nextCategoryName = String(newCategory || '').trim().toLowerCase();
  const categoryChanged = Boolean(nextCategoryName) && prevCategoryName !== nextCategoryName;

  // Prefer the DB-resolved object from the incoming cexProductData (which has the correct id
  // after handleAddFromCeX runs matchCexCategoryNameToDb). Only fall back to the existing item
  // categoryObject when the category hasn't changed and it already has a DB id.
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
    cashOffers,
    voucherOffers,
    offers: displayOffers,
    selectedOfferId: nextSelectedOfferId,
    ...(cexBasedRounded != null ? { ourSalePrice: String(cexBasedRounded) } : {}),
    cexSellPrice: refData.cex_sale_price != null ? Number(refData.cex_sale_price) : item.cexSellPrice,
    cexBuyPrice: refData.cex_tradein_cash != null ? Number(refData.cex_tradein_cash) : item.cexBuyPrice,
    cexVoucherPrice: refData.cex_tradein_voucher != null ? Number(refData.cex_tradein_voucher) : item.cexVoucherPrice,
    cexOutOfStock: cexProductData.isOutOfStock ?? item.cexOutOfStock ?? false,
    cexSku: cexProductData.id ?? item.cexSku ?? null,
    cexUrl: cexProductData.id ? `https://uk.webuy.com/product-detail?id=${cexProductData.id}` : item.cexUrl ?? null,
    cexProductData: cexProductData,
    referenceData: mergedReferenceData,
    rawData: mergedRawData,
    rrpOffersSource: NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
    category: newCategory || item.category,
    categoryObject: newCategoryObject,
  };
  logCategoryRuleDecision({
    context: categoryChanged ? 'cex-pencil-refresh-category-changed' : 'cex-data-applied',
    item: nextItem,
    categoryObject: nextItem.categoryObject,
    categoryName: newCategory || null,
    rule: {
      source: 'cex-reference-rule',
      ...buildRuleSnapshotFromReferenceData(mergedReferenceData),
    },
    notes: categoryChanged ? 'Cleared stale category id because CeX category changed.' : null,
  });
  return nextItem;
}
