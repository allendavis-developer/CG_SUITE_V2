import { priceForCexNegotiationTier, roundSalePrice } from '@/utils/helpers';

/** Apply tier rules to CeX API offer rows (1–2: £ grid, 3: exact trade-in). */
export function normalizeCeXOfferArrayFromApi(offers) {
  return (offers || []).map((o, idx) => ({
    ...o,
    price: priceForCexNegotiationTier(o, idx),
  }));
}

/** Merge reference fields and normalized offer arrays from `fetchVariantPrices` / `fetchCeXProductPrices` response. */
export function referenceDataWithNormalizedCexOffers(data) {
  const base = { ...(data?.referenceData || {}) };
  const cash_offers = normalizeCeXOfferArrayFromApi(data?.cash_offers);
  const voucher_offers = normalizeCeXOfferArrayFromApi(data?.voucher_offers);
  const cexBased = base.cex_based_sale_price;
  return {
    ...base,
    cash_offers,
    voucher_offers,
    our_sale_price:
      cexBased != null && Number.isFinite(Number(cexBased))
        ? roundSalePrice(Number(cexBased))
        : null,
  };
}

/** Cart / negotiation line: `{ id, title, price }` with tier rules (safe if reference rows are already normalized). */
export function slimCexNegotiationOfferRows(offers) {
  return (offers || []).map((o, idx) => {
    const row = {
      id: o.id,
      title: o.title,
      price: priceForCexNegotiationTier(o, idx),
    };
    if (o.isMatchCex === true) row.isMatchCex = true;
    return row;
  });
}

/** Controlled input string for “our sale” from variant price API. */
export function ourSalePriceFieldFromVariantResponse(data) {
  const cexBased = data?.referenceData?.cex_based_sale_price;
  if (cexBased != null && Number.isFinite(Number(cexBased))) {
    return String(roundSalePrice(Number(cexBased)));
  }
  return '';
}
