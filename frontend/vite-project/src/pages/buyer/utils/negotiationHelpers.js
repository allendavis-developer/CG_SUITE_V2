import { normalizeExplicitSalePrice, roundOfferPrice, roundSalePrice, toVoucherOfferPrice } from '@/utils/helpers';
import { mapRequestItemsToCartItems } from '@/utils/requestToCartMapping';

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

export function getDisplayOffers(item, useVoucherOffers) {
  return useVoucherOffers
    ? (item.voucherOffers || item.offers)
    : (item.cashOffers || item.offers);
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

// ─── Payload builders ──────────────────────────────────────────────────────

export function buildFinishPayload(items, totalExpectation, targetOffer, useVoucherOffers, totalOfferPrice, customerData = null) {
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
  };
}

// ─── Data mapping: API response → negotiation item shape ───────────────────

export function mapApiItemToNegotiationItem(item, transactionType, mode) {
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
      customerExpectation: item.customer_expectation_gbp?.toString() || '',
      ebayResearchData: null,
      cashConvertersResearchData: null,
      offers: [],
      cashOffers: [],
      voucherOffers: [],
    };
  }

  const ebayResearchData =
    cartItem.ebayResearchData
    || cartItem.rawData?.ebayResearchData
    || (cartItem.rawData?.stats && cartItem.rawData?.selectedFilters ? cartItem.rawData : null);

  let next = normalizeCartItemForNegotiation({
    ...cartItem,
    seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
  });

  const resolveOurSaleFromApi = () => {
    const rawSaved =
      item.our_sale_price_at_negotiation != null && item.our_sale_price_at_negotiation !== ''
        ? parseFloat(item.our_sale_price_at_negotiation)
        : null;
    if (rawSaved != null && !Number.isNaN(rawSaved) && rawSaved > 0) {
      return normalizeExplicitSalePrice(rawSaved);
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
    };
  }

  const vd = item.variant_details;
  return {
    ...next,
    cexBuyPrice: vd?.tradein_cash != null ? parseFloat(vd.tradein_cash) : next.cexBuyPrice,
    cexVoucherPrice: vd?.tradein_voucher != null ? parseFloat(vd.tradein_voucher) : next.cexVoucherPrice,
    cexSellPrice: vd?.current_price_gbp != null ? parseFloat(vd.current_price_gbp) : next.cexSellPrice,
    ourSalePrice: resolveOurSaleFromApi(),
  };
}

/** Normalize a cart item from the buyer store into the shape the negotiation page expects. */
export function normalizeCartItemForNegotiation(item) {
  const isEbayPayload = !!(item.ebayResearchData?.stats && item.ebayResearchData?.selectedFilters);
  const cexName = item.variant_details?.title
    || (!isEbayPayload && (item.ebayResearchData?.title || item.ebayResearchData?.modelName))
    || (item.isCustomCeXItem && item.title) || null;
  const isCexItem = !!(cexName || item.isCustomCeXItem || (item.cexBuyPrice != null || item.cexSellPrice != null));
  const resolvedSelectedOfferId = (item.selectedOfferId != null && item.selectedOfferId !== '')
    ? item.selectedOfferId
    : null;
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
  return { ...next, selectedOfferId: resolvedSelectedOfferId };
}

// ─── Research completion → offer recalculation ─────────────────────────────

/**
 * Apply ebay research results to a negotiation item.
 * Returns the updated item (immutable).
 */
export function applyEbayResearchToItem(item, updatedState, useVoucherOffers) {
  const hasCeXBasedOffers = (item.variantId != null && item.variantId !== '') || item.isCustomCeXItem === true;
  const isEbayOnlyItem =
    item.isCustomEbayItem === true ||
    (!hasCeXBasedOffers && item.ebayResearchData?.stats && item.ebayResearchData?.selectedFilters);

  let newCashOffers = item.cashOffers || [];
  let newVoucherOffers = item.voucherOffers || [];

  if (updatedState.buyOffers && updatedState.buyOffers.length > 0) {
    if (isEbayOnlyItem) {
      newCashOffers = updatedState.buyOffers.map((o, idx) => ({
        id: `ebay-cash-${Date.now()}-${idx}`,
        title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
        price: roundOfferPrice(o.price),
      }));
      newVoucherOffers = newCashOffers.map(offer => ({
        id: `ebay-voucher-${offer.id}`,
        title: offer.title,
        price: toVoucherOfferPrice(offer.price),
      }));
    } else if (!hasCeXBasedOffers) {
      const hasExistingOffers =
        (item.cashOffers?.length > 0) || (item.voucherOffers?.length > 0) || (item.offers?.length > 0);
      if (!hasExistingOffers) {
        newCashOffers = updatedState.buyOffers.map((o, idx) => ({
          id: `ebay-cash-${Date.now()}-${idx}`,
          title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
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
      if (hasCeXBasedOffers) {
        const clickedPrice = updatedState.buyOffers?.[updatedState.selectedOfferIndex]?.price;
        if (clickedPrice != null) {
          const effectivePrice = useVoucherOffers ? toVoucherOfferPrice(clickedPrice) : clickedPrice;
          newManualOffer = Number(effectivePrice).toFixed(2);
          newSelectedOfferId = 'manual';
        }
      } else {
        const selectedOffer = displayOffers[updatedState.selectedOfferIndex];
        if (selectedOffer) newSelectedOfferId = selectedOffer.id;
      }
    }
  } else {
    if (updatedState.manualOffer !== undefined) newManualOffer = updatedState.manualOffer;
    const prevOffers = useVoucherOffers ? (item.voucherOffers || item.offers) : (item.cashOffers || item.offers);
    const prevIdx = prevOffers?.findIndex(o => o.id === item.selectedOfferId);
    if (prevIdx >= 0 && displayOffers[prevIdx]) newSelectedOfferId = displayOffers[prevIdx].id;
  }

  return {
    ...item,
    ebayResearchData: updatedState,
    cashOffers: newCashOffers,
    voucherOffers: newVoucherOffers,
    offers: displayOffers,
    manualOffer: newManualOffer,
    selectedOfferId: newSelectedOfferId,
  };
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
      const clickedPrice = updatedState.buyOffers?.[updatedState.selectedOfferIndex]?.price;
      if (clickedPrice != null) {
        const effectivePrice = useVoucherOffers ? toVoucherOfferPrice(clickedPrice) : clickedPrice;
        newManualOffer = Number(effectivePrice).toFixed(2);
        newSelectedOfferId = 'manual';
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
  if (!hasExistingOffers && updatedState.buyOffers?.length > 0) {
    newCashOffers = updatedState.buyOffers.map((o, idx) => ({
      id: `cc-cash-${Date.now()}-${idx}`,
      title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
      price: Number(o.price),
    }));
    newVoucherOffers = newCashOffers.map(offer => ({
      id: `cc-voucher-${offer.id}`,
      title: offer.title,
      price: toVoucherOfferPrice(offer.price),
    }));
  }
  const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;

  return {
    ...item,
    cashConvertersResearchData: updatedState,
    cashOffers: newCashOffers,
    voucherOffers: newVoucherOffers,
    offers: displayOffers,
    manualOffer: newManualOffer,
    selectedOfferId: newSelectedOfferId,
  };
}
