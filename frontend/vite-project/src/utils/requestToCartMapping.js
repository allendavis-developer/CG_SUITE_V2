/**
 * Maps a request (from API) to Buyer page state (cartItems, customerData, etc.)
 * Used when opening a QUOTE request from Requests Overview to continue editing.
 */

import { normalizeExplicitSalePrice, roundOfferPrice, roundSalePrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import { resolvePersistedResearchCategory } from '@/utils/researchPersistence';

/** Inline mirror of {@link negotiationHelpers.withDefaultRrpOffersSource} for CC/CG-only mapped rows (module load order). */
function hasUsableResearchRrpFromStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  if (stats.suggestedPrice != null && stats.suggestedPrice !== '') {
    const n = Number(stats.suggestedPrice);
    if (Number.isFinite(n) && n > 0) return true;
  }
  if (stats.median != null && stats.median !== '') {
    const m = Number(stats.median);
    if (Number.isFinite(m) && m > 0) return true;
  }
  return false;
}

function normalizedRequestItemQuantity(item) {
  const q = Math.floor(Number(item?.quantity));
  return Number.isFinite(q) && q >= 1 ? q : 1;
}

/** DB → cart: default source highlight when `raw_data` has no `rrpOffersSource` (see `withDefaultRrpOffersSource`). */
function applyDefaultRrpSourceToMappedCartItem(cartItem) {
  let next = { ...cartItem };
  if (next.offersSource == null || next.offersSource === '') {
    if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
      next.offersSource = next.rrpOffersSource;
    }
  }
  if (next.rrpOffersSource != null && next.rrpOffersSource !== '') {
    return next;
  }
  if (next.isJewelleryItem === true) {
    const z = NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER;
    return { ...next, rrpOffersSource: z, offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z };
  }
  const cexBacked =
    next.isCustomCeXItem === true ||
    (next.variantId != null && next.variantId !== '') ||
    (next.cexSku != null && next.cexSku !== '') ||
    (next.cexBuyPrice != null && next.cexBuyPrice !== '') ||
    (next.cexVoucherPrice != null && next.cexVoucherPrice !== '') ||
    (next.cexSellPrice != null && next.cexSellPrice !== '');
  if (cexBacked) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
    return { ...next, rrpOffersSource: z, offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z };
  }
  if (
    next.isCustomEbayItem === true ||
    (next.ebayResearchData && !next.isCustomCashConvertersItem)
  ) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
    return { ...next, rrpOffersSource: z, offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z };
  }
  if (
    next.isCustomCashGeneratorItem === true &&
    next.cgResearchData &&
    hasUsableResearchRrpFromStats(next.cgResearchData.stats)
  ) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_GENERATOR;
    return { ...next, rrpOffersSource: z, offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z };
  }
  if (
    next.isCustomCashConvertersItem === true &&
    next.cashConvertersResearchData &&
    hasUsableResearchRrpFromStats(next.cashConvertersResearchData.stats)
  ) {
    const z = NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
    return { ...next, rrpOffersSource: z, offersSource: next.offersSource != null && next.offersSource !== '' ? next.offersSource : z };
  }
  return next;
}

/**
 * Map request items from API to cart item format for Buyer/MainContent
 * @param {Array} items - request.items from API
 * @param {string} transactionType - 'sale' | 'buyback' | 'store_credit'
 */
/** Map Django Request.intent to transaction type used by {@link mapRequestItemsToCartItems}. */
export function intentToBuyerTransactionType(intent) {
  if (intent === 'DIRECT_SALE') return 'sale';
  if (intent === 'BUYBACK') return 'buyback';
  return 'store_credit';
}

/**
 * Comma-separated line titles for a request (same labels as the Buyer negotiation table).
 * @param {{ items?: unknown[], intent?: string } | null | undefined} request
 * @returns {string}
 */
export function formatRequestItemNamesList(request) {
  const items = request?.items;
  if (!Array.isArray(items) || items.length === 0) return '';
  const tx = intentToBuyerTransactionType(request?.intent);
  const cartItems = mapRequestItemsToCartItems(items, tx);
  return cartItems
    .map((c) => {
      const t = c.title != null && String(c.title).trim() !== '' ? String(c.title).trim() : '';
      return t || 'Item';
    })
    .join(', ');
}

export function mapRequestItemsToCartItems(items, transactionType) {
  if (!items || !Array.isArray(items)) return [];

  const useVoucher = transactionType === 'store_credit';

  return items.map((item) => {
    const rawData = item.raw_data || null;
    const embeddedEbayResearchData = rawData?.ebayResearchData || null;
    const rawDataHasExtensionResearchSignals = !!(
      rawData &&
      (
        rawData.listings?.length > 0 ||
        rawData.buyOffers?.length > 0 ||
        (rawData.stats && typeof rawData.stats === 'object')
      )
    );
    /**
     * Prefer nested eBay blob; else top-level when it has filters; else flat raw_data when API omitted
     * `selectedFilters` but listings/stats still exist (saved quotes).
     */
    let ebayResearchBlob =
      rawData?.stats && rawData?.selectedFilters
        ? rawData
        : embeddedEbayResearchData;
    if (!ebayResearchBlob && rawDataHasExtensionResearchSignals && !embeddedEbayResearchData) {
      ebayResearchBlob = rawData;
    }
    const hasPersistedExtensionEbayResearch = !!(
      ebayResearchBlob &&
      (
        ebayResearchBlob.listings?.length > 0 ||
        ebayResearchBlob.buyOffers?.length > 0 ||
        (ebayResearchBlob.stats && typeof ebayResearchBlob.stats === 'object')
      )
    );
    const nosposHintTop = rawData?.aiSuggestedNosposStockCategory;
    if (
      nosposHintTop &&
      typeof nosposHintTop === 'object' &&
      ebayResearchBlob &&
      typeof ebayResearchBlob === 'object' &&
      !ebayResearchBlob.aiSuggestedNosposStockCategory
    ) {
      ebayResearchBlob = { ...ebayResearchBlob, aiSuggestedNosposStockCategory: nosposHintTop };
    }
    const cashConvertersResearchData = item.cash_converters_data || rawData?.cashConvertersResearchData || null;
    const cgResearchData = item.cg_data || rawData?.cgResearchData || null;

    let savedCashOffers = item.cash_offers_json || [];
    let savedVoucherOffers = item.voucher_offers_json || [];
    savedCashOffers = (savedCashOffers || []).map((offer) => ({
      ...offer,
      price: normalizeExplicitSalePrice(offer?.price),
    }));
    savedVoucherOffers = (savedVoucherOffers || []).map((offer) => ({
      ...offer,
      price: normalizeExplicitSalePrice(offer?.price),
    }));

    const jewelleryRef = rawData?.referenceData;
    if (jewelleryRef && jewelleryRef.jewellery_line === true) {
      let cash = savedCashOffers;
      let voucher = savedVoucherOffers;
      if (!cash.length) {
        const t = Number(jewelleryRef.computed_total_gbp ?? 0);
        cash = [
          {
            id: 'jewellery-ref',
            title: 'Reference offer',
            price: normalizeExplicitSalePrice(t),
          },
        ];
      }
      if (!voucher.length) {
        voucher = cash.map((o) => ({
          id: `jewellery-v-${o.id}`,
          title: o.title,
          price: normalizeExplicitSalePrice(toVoucherOfferPrice(o.price)),
        }));
      }
      const displayOffers = useVoucher ? voucher : cash;
      const variantId = item.variant_details?.variant_id ?? jewelleryRef.variant_id ?? null;
      const title =
        jewelleryRef.item_name ||
        jewelleryRef.category_label ||
        jewelleryRef.line_title ||
        item.variant_details?.title ||
        [jewelleryRef.product_name, jewelleryRef.material_grade].filter(Boolean).join(' — ') ||
        'Jewellery';
      const wu = jewelleryRef.weight_unit === 'each' ? 'ea' : jewelleryRef.weight_unit || 'g';
      const subtitle = [
        jewelleryRef.reference_display_name ??
          jewelleryRef[['master', 'melt', '_display_name'].join('')],
        jewelleryRef.weight != null && jewelleryRef.weight !== ''
          ? `${jewelleryRef.weight}${wu}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const cartItem = {
        id: item.request_item_id,
        request_item_id: item.request_item_id,
        rawData,
        aiSuggestedNosposStockCategory: rawData?.aiSuggestedNosposStockCategory ?? null,
        aiSuggestedNosposStockFieldValues: rawData?.aiSuggestedNosposStockFieldValues ?? null,
        authorisedOfferSlots: Array.isArray(rawData?.authorisedOfferSlots) ? rawData.authorisedOfferSlots : [],
        title,
        subtitle,
        quantity: normalizedRequestItemQuantity(item),
        selectedOfferId: item.selected_offer_id,
        manualOffer: item.manual_offer_gbp != null ? formatOfferPrice(item.manual_offer_gbp) : '',
        manualOfferUsed: item.manual_offer_used ?? item.selected_offer_id === 'manual',
        seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
        customerExpectation: item.customer_expectation_gbp?.toString() || '',
        ebayResearchData: null,
        cashConvertersResearchData: null,
        cgResearchData: null,
        cashOffers: cash,
        voucherOffers: voucher,
        offers: displayOffers,
        cexBuyPrice: null,
        cexVoucherPrice: null,
        cexSellPrice: null,
        cexOutOfStock: false,
        ourSalePrice:
          item.our_sale_price_at_negotiation != null
            ? normalizeExplicitSalePrice(parseFloat(item.our_sale_price_at_negotiation))
            : jewelleryRef.computed_total_gbp != null
              ? normalizeExplicitSalePrice(Number(jewelleryRef.computed_total_gbp))
              : null,
        rrpOffersSource: rawData?.rrpOffersSource ?? null,
        offersSource: rawData?.offersSource ?? null,
        variantId,
        model: title,
        category: 'Jewellery',
        categoryObject: { name: 'Jewellery', path: ['Jewellery'] },
        attributeValues: {
          material_grade: jewelleryRef.material_grade,
        },
        isJewelleryItem: true,
        isCustomCeXItem: false,
        isCustomEbayItem: false,
        isCustomCashConvertersItem: false,
        referenceData: jewelleryRef,
      };
      return applyDefaultRrpSourceToMappedCartItem(cartItem);
    }

    // Add from CeX: raw_data has id, title, and either CeX structure or no eBay fields
    // Include items with stats/selectedFilters (eBay research merged) when CeX structure is present
    const hasCeXStructure = !!(
      rawData?.id != null &&
      rawData?.title != null &&
      (Array.isArray(rawData?.cash_offers) || Array.isArray(rawData?.voucher_offers) || rawData?.category)
    );
    const isPureCeX = rawData?.id != null && rawData?.title != null && !rawData?.stats && !rawData?.selectedFilters;
    const isAddFromCeXPayload = hasCeXStructure || isPureCeX;

    if (isAddFromCeXPayload) {
      // Prefer persisted request-item offers so post-edit values survive reopen/New Buy.
      // Fall back to raw_data for older records where JSON offer fields were never saved.
      if (!Array.isArray(savedCashOffers) || savedCashOffers.length === 0) {
        savedCashOffers = rawData.cash_offers || savedCashOffers;
      }
      if (!Array.isArray(savedVoucherOffers) || savedVoucherOffers.length === 0) {
        savedVoucherOffers = rawData.voucher_offers || savedVoucherOffers;
      }
      savedCashOffers = (savedCashOffers || []).map((offer) => ({
        ...offer,
        price: normalizeExplicitSalePrice(offer?.price),
      }));
      savedVoucherOffers = (savedVoucherOffers || []).map((offer) => ({
        ...offer,
        price: normalizeExplicitSalePrice(offer?.price),
      }));
    }

    const isEbayResearchPayload = !!(
      ebayResearchBlob?.stats && ebayResearchBlob?.selectedFilters
    );

    const cexTitle = item.variant_details?.title;
    const rawCeXTitle = (!isEbayResearchPayload || isAddFromCeXPayload)
      ? rawData?.title || rawData?.modelName
      : null;
    const isCexItem = !!(cexTitle || rawCeXTitle || isAddFromCeXPayload);

    if (
      !isCexItem &&
      (isEbayResearchPayload || hasPersistedExtensionEbayResearch) &&
      savedCashOffers.length === 0 &&
      Array.isArray(ebayResearchBlob?.buyOffers)
    ) {
      savedCashOffers = ebayResearchBlob.buyOffers.map((offer, idx) => ({
        id: `ebay-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(offer.price),
      }));
    }

    if (
      (isEbayResearchPayload || hasPersistedExtensionEbayResearch) &&
      savedCashOffers.length > 0 &&
      savedVoucherOffers.length === 0
    ) {
      savedVoucherOffers = savedCashOffers.map((offer) => ({
        id: `ebay-voucher-${offer.id}`,
        title: offer.title,
        price: toVoucherOfferPrice(offer.price),
      }));
    }

    const displayOffers = useVoucher ? savedVoucherOffers : savedCashOffers;

    const savedDisplayTitle = rawData?.display_title ?? ebayResearchBlob?.display_title;
    const savedDisplaySubtitle = rawData?.display_subtitle ?? ebayResearchBlob?.display_subtitle;
    const hasSavedDisplay =
      savedDisplayTitle != null && savedDisplayTitle !== '';

    const variantId = item.variant_details?.variant_id ?? null;
    const rawEbayTitle =
      isEbayResearchPayload || hasPersistedExtensionEbayResearch
        ? ebayResearchBlob?.searchTerm || ebayResearchBlob?.title || null
        : null;
    const cashConvertersTitle =
      cashConvertersResearchData?.searchTerm ||
      cashConvertersResearchData?.title ||
      null;
    const cgTitle =
      cgResearchData?.searchTerm ||
      cgResearchData?.title ||
      null;

    const ebaySubtitleFromFilters =
      isEbayResearchPayload || hasPersistedExtensionEbayResearch
        ? (isEbayResearchPayload
            ? (Object.values(ebayResearchBlob?.selectedFilters?.apiFilters || {})
                .flat()
                .join(' / ') ||
              ebayResearchBlob?.selectedFilters?.basic?.join(' / ') ||
              'eBay Filters')
            : '')
        : null;

    const cexSku = item.variant_details?.cex_sku || rawData?.id || null;
    const productName = item.variant_details?.product_name || null;
    const categoryId = item.variant_details?.category_id ?? null;
    const categoryName = item.variant_details?.category_name || null;
    const attributeValues = item.variant_details?.attribute_values || rawData?.attribute_values || {};
    const attributeLabels =
      item.variant_details?.attribute_labels || rawData?.attribute_labels || {};
    const condition = item.variant_details?.condition || null;

    const cexBuyPrice =
      item.cex_buy_cash_at_negotiation != null
        ? parseFloat(item.cex_buy_cash_at_negotiation)
        : item.variant_details?.tradein_cash != null
          ? parseFloat(item.variant_details.tradein_cash)
          : isAddFromCeXPayload && rawData?.tradeInCash != null
            ? parseFloat(rawData.tradeInCash)
            : null;
    const cexVoucherPrice =
      item.cex_buy_voucher_at_negotiation != null
        ? parseFloat(item.cex_buy_voucher_at_negotiation)
        : item.variant_details?.tradein_voucher != null
          ? parseFloat(item.variant_details.tradein_voucher)
          : isAddFromCeXPayload && rawData?.tradeInVoucher != null
            ? parseFloat(rawData.tradeInVoucher)
            : null;
    const cexSellPrice =
      item.cex_sell_at_negotiation != null
        ? parseFloat(item.cex_sell_at_negotiation)
        : item.variant_details?.current_price_gbp != null
          ? parseFloat(item.variant_details.current_price_gbp)
          : isAddFromCeXPayload && (rawData?.sellPrice ?? rawData?.price) != null
            ? parseFloat(rawData.sellPrice ?? rawData.price)
            : null;

    const rawOurSale =
      item.our_sale_price_at_negotiation != null
        ? parseFloat(item.our_sale_price_at_negotiation)
        : rawData?.referenceData?.cex_based_sale_price != null
          ? parseFloat(rawData.referenceData.cex_based_sale_price)
          : ebayResearchBlob?.stats?.suggestedPrice != null
            ? parseFloat(ebayResearchBlob.stats.suggestedPrice)
            : null;
    const ourSalePrice =
      rawOurSale != null && !Number.isNaN(rawOurSale) && rawOurSale > 0
        ? (item.our_sale_price_at_negotiation != null
            ? normalizeExplicitSalePrice(rawOurSale)
            : roundSalePrice(rawOurSale))
        : null;

    const title = hasSavedDisplay
      ? savedDisplayTitle
      : isCexItem
        ? cexTitle || rawCeXTitle || 'N/A'
        : rawEbayTitle || cashConvertersTitle || cgTitle || 'N/A';
    const subtitle = hasSavedDisplay
      ? savedDisplaySubtitle ?? ''
      : isCexItem
        ? (rawData?.category ?? '')
        : ebaySubtitleFromFilters || 'No details';

    const cartItem = {
      id: item.request_item_id,
      request_item_id: item.request_item_id,
      rawData,
      aiSuggestedNosposStockCategory:
        rawData?.aiSuggestedNosposStockCategory ?? ebayResearchBlob?.aiSuggestedNosposStockCategory ?? null,
      aiSuggestedNosposStockFieldValues:
        rawData?.aiSuggestedNosposStockFieldValues ?? ebayResearchBlob?.aiSuggestedNosposStockFieldValues ?? null,
      authorisedOfferSlots: Array.isArray(rawData?.authorisedOfferSlots) ? rawData.authorisedOfferSlots : [],
      title,
      subtitle,
      quantity: normalizedRequestItemQuantity(item),
      selectedOfferId: item.selected_offer_id,
      manualOffer: item.manual_offer_gbp != null ? formatOfferPrice(item.manual_offer_gbp) : '',
      manualOfferUsed: item.manual_offer_used ?? item.selected_offer_id === 'manual',
      seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
      customerExpectation: item.customer_expectation_gbp?.toString() || '',
      isOtherNosposManualItem:
        rawData?.other_workspace_manual_item === true || rawData?.otherWorkspaceManualItem === true,
      ebayResearchData: hasPersistedExtensionEbayResearch ? ebayResearchBlob : null,
      cashConvertersResearchData,
      cgResearchData,
      cashOffers: savedCashOffers,
      voucherOffers: savedVoucherOffers,
      offers: displayOffers,
      cexBuyPrice,
      cexVoucherPrice,
      cexSellPrice,
      cexOutOfStock: item.variant_details?.cex_out_of_stock ?? rawData?.isOutOfStock ?? false,
      ourSalePrice,
      rrpOffersSource: rawData?.rrpOffersSource ?? null,
      offersSource: rawData?.offersSource ?? null,
    };

    if (isAddFromCeXPayload) {
      cartItem.variantId = null;
      cartItem.isCustomCeXItem = true;
      cartItem.isCustomEbayItem = false;
      cartItem.isCustomCashConvertersItem = false;
      cartItem.isCustomCashGeneratorItem = false;
      cartItem.category = rawData?.category || 'CeX';
      cartItem.categoryObject = rawData?.category
        ? { name: rawData.category, path: [rawData.category] }
        : { name: 'CeX', path: ['CeX'] };
      cartItem.cexSku = rawData?.id ?? null;
      cartItem.cexUrl = rawData?.id
        ? `https://uk.webuy.com/product-detail?id=${rawData.id}`
        : null;
      cartItem.referenceData = rawData?.referenceData || rawData?.reference_data || {};
      cartItem.cexProductData = {
        id: rawData.id,
        title: rawData.title,
        category: rawData.category,
        image: rawData.image,
        specifications: rawData.specifications || {},
        isOutOfStock: rawData.isOutOfStock,
        stockStatus: rawData.stockStatus,
        ...rawData,
      };
      cartItem.image = rawData?.image || null;
    } else if (variantId && item.variant_details) {
      cartItem.variantId = variantId;
      cartItem.cexSku = cexSku;
      cartItem.model = productName || title;
      cartItem.category = categoryName || '';
      cartItem.categoryObject = categoryId != null
        ? { id: categoryId, name: categoryName || '', path: [categoryName || ''] }
        : null;
      cartItem.attributeValues = attributeValues;
      cartItem.attributeLabels = attributeLabels;
      cartItem.condition = condition || cartItem.condition || null;
      cartItem.isCustomCeXItem = false;
      cartItem.isCustomEbayItem = false;
      cartItem.isCustomCashConvertersItem = false;
      cartItem.isCustomCashGeneratorItem = false;
      cartItem.referenceData = {
          cex_sale_price: cexSellPrice,
          cex_tradein_cash: cexBuyPrice,
          cex_tradein_voucher: cexVoucherPrice,
          cex_out_of_stock: item.variant_details?.cex_out_of_stock ?? false,
          cex_sku: cexSku,
          id: cexSku,
          cash_offers: savedCashOffers,
          voucher_offers: savedVoucherOffers,
          our_sale_price: ourSalePrice,
          cex_based_sale_price: ourSalePrice,
          percentage_used: item.variant_details?.percentage_used ?? rawData?.referenceData?.percentage_used ?? null,
          ...(rawData?.referenceData?.cex_image_urls ? { cex_image_urls: rawData.referenceData.cex_image_urls } : {}),
        };
    } else if (isEbayResearchPayload) {
      const persistedCategoryObject = resolvePersistedResearchCategory(ebayResearchBlob);
      const persistedCategoryName = ebayResearchBlob?.category || persistedCategoryObject?.name || 'Other';
      cartItem.variantId = null;
      cartItem.isCustomEbayItem = true;
      cartItem.isCustomCeXItem = false;
      cartItem.isCustomCashConvertersItem = false;
      cartItem.isCustomCashGeneratorItem = false;
      cartItem.category = persistedCategoryName;
      cartItem.categoryObject = persistedCategoryObject || { name: persistedCategoryName, path: [persistedCategoryName] };
    } else if (cashConvertersResearchData) {
      cartItem.variantId = null;
      cartItem.isCustomEbayItem = false;
      cartItem.isCustomCeXItem = false;
      cartItem.isCustomCashConvertersItem = true;
      cartItem.isCustomCashGeneratorItem = false;
      cartItem.category = cashConvertersResearchData?.category || 'Other';
    } else if (cgResearchData) {
      cartItem.variantId = null;
      cartItem.isCustomEbayItem = false;
      cartItem.isCustomCeXItem = false;
      cartItem.isCustomCashConvertersItem = false;
      cartItem.isCustomCashGeneratorItem = rawData?.isCustomCashGeneratorItem === true;
      cartItem.category = cgResearchData?.category || 'Other';
    } else {
      cartItem.variantId = variantId;
      cartItem.cexSku = cexSku;
      cartItem.model = productName || title;
      cartItem.category = categoryName || '';
      cartItem.categoryObject = categoryId != null
        ? { id: categoryId, name: categoryName || '', path: [categoryName || ''] }
        : null;
      cartItem.attributeValues = attributeValues;
      cartItem.attributeLabels = attributeLabels;
      cartItem.condition = condition || cartItem.condition || null;
      cartItem.isCustomEbayItem = false;
      cartItem.isCustomCeXItem = !!isCexItem;
      cartItem.isCustomCashConvertersItem = false;
      cartItem.isCustomCashGeneratorItem = false;
      if (cexSellPrice != null || cexBuyPrice != null) {
        cartItem.referenceData = {
          cex_sale_price: cexSellPrice,
          cex_tradein_cash: cexBuyPrice,
          cex_tradein_voucher: cexVoucherPrice,
          cex_out_of_stock: item.variant_details?.cex_out_of_stock ?? false,
          cex_sku: cexSku,
          id: cexSku,
          cash_offers: savedCashOffers,
          voucher_offers: savedVoucherOffers,
          our_sale_price: ourSalePrice,
          cex_based_sale_price: ourSalePrice,
          percentage_used: item.variant_details?.percentage_used ?? rawData?.referenceData?.percentage_used ?? null,
          ...(rawData?.referenceData?.cex_image_urls ? { cex_image_urls: rawData.referenceData.cex_image_urls } : {}),
        };
      }
    }

    // Fallback: ensure Add from CeX items always have cexProductData for display
    // (handles edge cases where raw_data has CeX fields but didn't hit the Add from CeX block)
    if (cartItem.isCustomCeXItem && !cartItem.cexProductData && rawData?.id != null && rawData?.title != null) {
      cartItem.cexProductData = {
        id: rawData.id,
        title: rawData.title,
        category: rawData.category,
        image: rawData.image,
        specifications: rawData.specifications || {},
        isOutOfStock: rawData.isOutOfStock,
        stockStatus: rawData.stockStatus,
        ...rawData,
      };
      if (!cartItem.categoryObject && rawData?.category) {
        cartItem.categoryObject = { name: rawData.category, path: [rawData.category] };
      }
      if (cartItem.image == null) cartItem.image = rawData?.image || null;
      if (!cartItem.cexSku) cartItem.cexSku = rawData?.id ?? null;
    }

    if (!cartItem.cexUrl) {
      const rd = cartItem.referenceData || {};
      const rawRd = rawData?.referenceData || rawData?.reference_data;
      const skuForUrl =
        cartItem.cexSku ??
        rd.cex_sku ??
        rd.id ??
        rawRd?.cex_sku ??
        rawRd?.id ??
        item.variant_details?.cex_sku ??
        (cartItem.isCustomCeXItem && rawData?.id != null ? rawData.id : null);
      if (skuForUrl != null && String(skuForUrl).trim() !== '') {
        cartItem.cexUrl = `https://uk.webuy.com/product-detail?id=${skuForUrl}`;
      }
    }

    return applyDefaultRrpSourceToMappedCartItem(cartItem);
  });
}

/**
 * Map request to customerData format for Buyer
 * Merges customer_details (from API) with customer_enrichment_json (NoSpos rates, dates, etc.)
 */
export function mapRequestToCustomerData(request) {
  const cd = request.customer_details || request.customer;
  const enrichment = request.customer_enrichment_json || {};
  const transactionType = intentToBuyerTransactionType(request.intent);

  return {
    id: cd?.customer_id ?? cd?.id ?? enrichment.id ?? null,
    name: cd?.name ?? enrichment.name ?? 'Unknown',
    cancelRate: cd?.cancel_rate ?? enrichment.cancelRate ?? 0,
    transactionType,
    nospos_customer_id: cd?.nospos_customer_id ?? enrichment.nospos_customer_id ?? null,
    phone: cd?.phone ?? enrichment.phone ?? null,
    email: cd?.email ?? enrichment.email ?? null,
    address: cd?.address ?? enrichment.address ?? null,
    isNewCustomer: enrichment.isNewCustomer ?? false,
    joined: enrichment.joined ?? null,
    lastTransacted: enrichment.lastTransacted ?? null,
    buyBackRate: enrichment.buyBackRate ?? null,
    buyBackRateRaw: enrichment.buyBackRateRaw ?? null,
    renewRate: enrichment.renewRate ?? null,
    renewRateRaw: enrichment.renewRateRaw ?? null,
    cancelRateStr: enrichment.cancelRateStr ?? null,
    cancelRateRaw: enrichment.cancelRateRaw ?? null,
    faultyRate: enrichment.faultyRate ?? null,
    faultyRateRaw: enrichment.faultyRateRaw ?? null,
    buyingCount: enrichment.buyingCount ?? null,
    salesCount: enrichment.salesCount ?? null,
    bypassReason: enrichment.bypassReason ?? null,
    // Preserve negotiation-level values so reopening a QUOTE restores
    // the top-row fields in Negotiation (total expectation / target).
    // Omit when unset so finish/draft payloads can fall back to sum of line expectations.
    ...(request.overall_expectation_gbp != null
      ? { overall_expectation_gbp: Number(request.overall_expectation_gbp) }
      : {}),
    target_offer_gbp:
      request.target_offer_gbp != null ? Number(request.target_offer_gbp) : null,
  };
}
