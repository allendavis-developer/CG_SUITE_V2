/**
 * CeX first / second / third offers: each configured tier is a % of the CeX cash/voucher
 * trade-in reference when the pricing rule sets that tier; otherwise same absolute margin
 * vs our sale as CeX (1st) or midpoint (2nd). The 3rd tier is only included when explicitly
 * configured — no fallback to 100%. The last tier is always the raw CeX trade-in (Match CeX).
 * Mirrors variant_prices / cex_product_prices backend behaviour.
 */

import { roundOfferPrice } from '@/utils/helpers';

const TIER_LABELS = ['1st offer', '2nd offer', '3rd offer', '4th offer'];

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
 *   thirdOfferPctOfCex: number|null|undefined,
 * }} p
 */
export function computeCexThreeTiersForReference(p) {
  const ref = Number(p.cexReferenceBuyPrice);
  if (!Number.isFinite(ref) || ref <= 0) return null;

  const cexSale = Number(p.cexSalePrice);
  const ourSale = Number(p.ourSalePrice);

  // Match CeX = always the raw trade-in reference
  const offer4 = ref;

  // 3rd offer is only included when explicitly set in the rule — no 100% fallback
  const hasThird = p.thirdOfferPctOfCex != null && Number.isFinite(Number(p.thirdOfferPctOfCex));
  let rounded3 = null;
  let tier3Basis = null;
  if (hasThird) {
    const p3 = Number(p.thirdOfferPctOfCex);
    rounded3 = roundOfferPrice(Math.max(ref * (p3 / 100), 0));
    tier3Basis = `${trimPct(p3)}% of CeX trade-in`;
  }

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

  // Midpoint anchors to 3rd offer when present, else to Match CeX
  const midpointAnchor = hasThird ? rounded3 : offer4;

  let rounded2;
  /** @type {string} */
  let tier2Basis;
  /** @type {boolean} */
  let tier2FromRule = false;
  if (p.secondOfferPctOfCex != null && Number.isFinite(Number(p.secondOfferPctOfCex))) {
    const p2 = Number(p.secondOfferPctOfCex);
    rounded2 = roundOfferPrice(Math.max(ref * (p2 / 100), 0));
    if (rounded2 === rounded1) {
      rounded2 = Math.round((rounded1 + midpointAnchor) / 2);
      tier2Basis = 'Midpoint (after rounding collision)';
    } else {
      tier2Basis = `${trimPct(p2)}% of CeX trade-in`;
      tier2FromRule = true;
    }
  } else {
    rounded2 = Math.round((rounded1 + midpointAnchor) / 2);
    tier2Basis = hasThird ? 'Midpoint of 1st & 3rd' : 'Midpoint of 1st & Match CeX';
  }

  const prices = hasThird
    ? [rounded1, rounded2, rounded3, offer4]
    : [rounded1, rounded2, offer4];
  const tierBases = hasThird
    ? [tier1Basis, tier2Basis, tier3Basis, 'CeX trade-in reference']
    : [tier1Basis, tier2Basis, 'CeX trade-in reference'];
  const pctOfCex = prices.map((px, idx) => pctOfCexForTier(ref, px, idx, {
    tier1FromRule,
    tier2FromRule,
    firstPct: p.firstOfferPctOfCex,
    secondPct: p.secondOfferPctOfCex,
    hasThird,
  }));

  return {
    prices,
    tierBases,
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
  // Last tier is always Match CeX (100%); its index is 3 when 3rd offer present, else 2
  const matchCexIdx = ruleMeta.hasThird ? 3 : 2;
  if (idx === matchCexIdx) return 100;
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
  const thirdPct = pickNum(ref.third_offer_pct_of_cex) ?? pickNum(ref.thirdOfferPctOfCex);

  return {
    tradeinCash,
    tradeinVoucher,
    cexSale,
    ourSale,
    firstOfferPctOfCex: firstPct,
    secondOfferPctOfCex: secondPct,
    thirdOfferPctOfCex: thirdPct,
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
          thirdOfferPctOfCex: ctx.thirdOfferPctOfCex,
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
          thirdOfferPctOfCex: ctx.thirdOfferPctOfCex,
        })
      : null;

  if (!cashSet && !voucherSet) return [];

  const numTiers = Math.max(cashSet?.prices?.length ?? 0, voucherSet?.prices?.length ?? 0);
  const rows = [];
  for (let i = 0; i < numTiers; i++) {
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

  const n = Math.min(4, Math.max(cash.length, vouch.length));
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
