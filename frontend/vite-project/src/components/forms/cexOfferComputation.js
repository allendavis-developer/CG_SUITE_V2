/**
 * CeX first / second / third offers: % of CeX trade-in (cash or voucher reference)
 * when pricing rules set first/second offer %; otherwise same absolute margin vs our
 * sale as CeX, then midpoint. Mirrors `pricing.views_v2.variant_prices` / `cex_product_prices`.
 */

import { roundOfferPrice } from '@/utils/helpers';

const TIER_LABELS = ['1st offer', '2nd offer', '3rd offer'];

function marginPctVsOurSale(offerPrice, ourSalePrice) {
  const sale = Number(ourSalePrice);
  const offer = Number(offerPrice);
  if (!Number.isFinite(sale) || sale <= 0 || !Number.isFinite(offer)) return null;
  return Math.round(((sale - offer) / sale) * 1000) / 10;
}

/**
 * @param {{
 *   cexReferenceBuyPrice: number,
 *   cexSalePrice: number|null|undefined,
 *   ourSalePrice: number|null|undefined,
 *   firstOfferPctOfCex: number|null|undefined,
 *   secondOfferPctOfCex: number|null|undefined,
 * }} p
 */
export function computeCexThreeTiersForReference(p) {
  const ref = Number(p.cexReferenceBuyPrice);
  if (!Number.isFinite(ref) || ref <= 0) return null;

  const cexSale = Number(p.cexSalePrice);
  const ourSale = Number(p.ourSalePrice);
  const offer3 = ref;

  let offer1raw;
  /** @type {string} */
  let tier1Basis;
  /** @type {boolean} */
  let tier1FromRule = false;
  if (p.firstOfferPctOfCex != null && Number.isFinite(Number(p.firstOfferPctOfCex))) {
    const pct = Number(p.firstOfferPctOfCex);
    offer1raw = Math.max(ref * (pct / 100), 0);
    tier1Basis = `${trimPct(pct)}% of CeX trade-in`;
    tier1FromRule = true;
  } else {
    const cexAbsMargin = Number.isFinite(cexSale) && cexSale > 0 ? cexSale - ref : 0;
    offer1raw = Math.max((Number.isFinite(ourSale) ? ourSale : 0) - cexAbsMargin, 0);
    tier1Basis = 'Same £ margin vs our sale as CeX';
  }

  const rounded1 = roundOfferPrice(offer1raw);
  const rounded3 = offer3;

  let rounded2;
  /** @type {string} */
  let tier2Basis;
  /** @type {boolean} */
  let tier2FromRule = false;
  if (p.secondOfferPctOfCex != null && Number.isFinite(Number(p.secondOfferPctOfCex))) {
    const p2 = Number(p.secondOfferPctOfCex);
    rounded2 = roundOfferPrice(Math.max(ref * (p2 / 100), 0));
    if (rounded2 === rounded1) {
      rounded2 = Math.round((rounded1 + rounded3) / 2);
      tier2Basis = 'Midpoint (after rounding collision)';
    } else {
      tier2Basis = `${trimPct(p2)}% of CeX trade-in`;
      tier2FromRule = true;
    }
  } else {
    rounded2 = Math.round((rounded1 + rounded3) / 2);
    tier2Basis = 'Midpoint of 1st & 3rd';
  }

  const prices = [rounded1, rounded2, rounded3];
  const pctOfCex = prices.map((px, idx) => pctOfCexForTier(ref, px, idx, {
    tier1FromRule,
    tier2FromRule,
    firstPct: p.firstOfferPctOfCex,
    secondPct: p.secondOfferPctOfCex,
  }));

  return {
    prices,
    tierBases: [tier1Basis, tier2Basis, 'Matches CeX trade-in'],
    marginVsOurSale: prices.map((px) => marginPctVsOurSale(px, ourSale)),
    pctOfCex,
  };
}

/**
 * % of CeX trade-in reference for this tier (rule % when applicable, else derived from rounded £).
 * @param {number} ref
 * @param {number} px
 * @param {number} idx 0..2
 */
function pctOfCexForTier(ref, px, idx, ruleMeta) {
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(px)) return null;
  if (idx === 2) return 100;
  if (idx === 0 && ruleMeta.tier1FromRule && ruleMeta.firstPct != null && Number.isFinite(Number(ruleMeta.firstPct))) {
    return Math.round(Number(ruleMeta.firstPct) * 100) / 100;
  }
  if (idx === 1 && ruleMeta.tier2FromRule && ruleMeta.secondPct != null && Number.isFinite(Number(ruleMeta.secondPct))) {
    return Math.round(Number(ruleMeta.secondPct) * 100) / 100;
  }
  return Math.round((px / ref) * 1000) / 10;
}

function trimPct(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v);
}

/**
 * Resolved pricing inputs from a cart / negotiation line item.
 * @param {object} item
 */
export function resolveCexPricingInputs(item) {
  const ref =
    item.referenceData ||
    item.cexProductData?.referenceData ||
    item.cexProductData?.reference_data ||
    {};

  const tradeinCash =
    pickNum(item.cexBuyPrice) ??
    pickNum(ref.cex_tradein_cash);

  const tradeinVoucher =
    pickNum(item.cexVoucherPrice) ??
    pickNum(ref.cex_tradein_voucher);

  const cexSale =
    pickNum(item.cexSellPrice) ??
    pickNum(ref.cex_sale_price);

  const ourSale =
    pickNum(item.ourSalePrice) ??
    pickNum(ref.cex_based_sale_price) ??
    pickNum(ref.our_sale_price);

  const firstPct = pickNum(ref.first_offer_pct_of_cex) ?? pickNum(ref.firstOfferPctOfCex);
  const secondPct = pickNum(ref.second_offer_pct_of_cex) ?? pickNum(ref.secondOfferPctOfCex);

  return {
    tradeinCash,
    tradeinVoucher,
    cexSale,
    ourSale,
    firstOfferPctOfCex: firstPct,
    secondOfferPctOfCex: secondPct,
  };
}

function pickNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @returns {Array<{ kind: 'cexDual', metric: string, cash: string|null, voucher: string|null, basis: string, marginVsOurSale: number|null, pctCash?: number|null, pctVoucher?: number|null }>} */
export function buildComputedCexOfferRows(item) {
  const ctx = resolveCexPricingInputs(item);
  const cashSet =
    ctx.tradeinCash != null && ctx.tradeinCash > 0
      ? computeCexThreeTiersForReference({
          cexReferenceBuyPrice: ctx.tradeinCash,
          cexSalePrice: ctx.cexSale,
          ourSalePrice: ctx.ourSale,
          firstOfferPctOfCex: ctx.firstOfferPctOfCex,
          secondOfferPctOfCex: ctx.secondOfferPctOfCex,
        })
      : null;

  const voucherSet =
    ctx.tradeinVoucher != null && ctx.tradeinVoucher > 0
      ? computeCexThreeTiersForReference({
          cexReferenceBuyPrice: ctx.tradeinVoucher,
          cexSalePrice: ctx.cexSale,
          ourSalePrice: ctx.ourSale,
          firstOfferPctOfCex: ctx.firstOfferPctOfCex,
          secondOfferPctOfCex: ctx.secondOfferPctOfCex,
        })
      : null;

  if (!cashSet && !voucherSet) return [];

  const rows = [];
  for (let i = 0; i < 3; i++) {
    const cPx = cashSet?.prices[i];
    const vPx = voucherSet?.prices[i];
    const basis = cashSet?.tierBases[i] ?? voucherSet?.tierBases[i] ?? '';
    const marginHint = cashSet?.marginVsOurSale[i] ?? voucherSet?.marginVsOurSale[i];
    const pctCash = cashSet?.pctOfCex[i] ?? null;
    const pctVoucher = voucherSet?.pctOfCex[i] ?? null;
    rows.push({
      kind: 'cexDual',
      metric: TIER_LABELS[i],
      cash: cPx != null && Number.isFinite(cPx) ? cPx.toFixed(2) : null,
      voucher: vPx != null && Number.isFinite(vPx) ? vPx.toFixed(2) : null,
      basis,
      marginVsOurSale: marginHint != null ? marginHint : null,
      pctCash,
      pctVoucher,
    });
  }
  return rows;
}

/**
 * Zip API / DB-persisted CeX offer arrays (same shape as backend `cash_offers` / `voucher_offers`).
 * @param {Array<{ price?: number, margin?: number, title?: string }>|null|undefined} cashOffers
 * @param {Array<{ price?: number, margin?: number, title?: string }>|null|undefined} voucherOffers
 */
function pctOfCexReference(offerPrice, tradeInRef) {
  const px = Number(offerPrice);
  const ref = Number(tradeInRef);
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref <= 0) return null;
  return Math.round((px / ref) * 1000) / 10;
}

/**
 * @param {{ tradeinCash?: number|null, tradeinVoucher?: number|null }} [tradeInRefs]
 */
export function zipPersistedCexOfferRows(cashOffers, voucherOffers, tradeInRefs = {}) {
  const cash = Array.isArray(cashOffers) ? cashOffers : [];
  const vouch = Array.isArray(voucherOffers) ? voucherOffers : [];
  if (cash.length === 0 && vouch.length === 0) return [];

  const refCash = tradeInRefs.tradeinCash;
  const refVouch = tradeInRefs.tradeinVoucher;

  const n = Math.min(3, Math.max(cash.length, vouch.length));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = cash[i];
    const v = vouch[i];
    const cPx = c?.price != null ? Number(c.price) : null;
    const vPx = v?.price != null ? Number(v.price) : null;
    const margin = c?.margin ?? v?.margin;
    let basis = 'CeX offer tier';
    if (margin != null && Number.isFinite(Number(margin))) {
      basis = `${Number(margin)}% margin vs our sale`;
    }
    rows.push({
      kind: 'cexDual',
      metric: TIER_LABELS[i],
      cash: Number.isFinite(cPx) ? cPx.toFixed(2) : null,
      voucher: Number.isFinite(vPx) ? vPx.toFixed(2) : null,
      basis,
      pctCash: pctOfCexReference(cPx, refCash),
      pctVoucher: pctOfCexReference(vPx, refVouch),
    });
  }
  return rows;
}
