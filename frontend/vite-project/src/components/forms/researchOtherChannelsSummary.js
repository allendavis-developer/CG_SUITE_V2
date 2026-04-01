/**
 * Build read-only numeric summaries for research channels other than the one open.
 * Used by the negotiation research overlay "Others" action.
 * Only includes data that was actually saved for that channel (no synthetic offers from
 * category margins or computed CeX tiers).
 *
 * CeX offers use category pricing rules (% of CeX cash/voucher reference or margin-matched); see `cexOfferComputation.js`.
 * eBay / Cash Converters offers are % of suggested sale; see `calculateBuyOffers`.
 */

import { toVoucherOfferPrice } from '@/utils/helpers';
import { calculateBuyOffers, EBAY_CC_RESEARCH_LABELS_CASH, EBAY_CC_RESEARCH_LABELS_VOUCHER } from './researchStats';
import { resolveCexPricingInputs, zipPersistedCexOfferRows } from './cexOfferComputation';

/**
 * eBay / Cash Converters research maps buy-offer tiers onto `item.cashOffers` & `item.voucherOffers`
 * (ids like `ebay-cash_1`, legacy `ebay-cash-0`, `cc-cash_1`). Not CeX trade-in tiers — do not show under CeX in Others.
 */
function itemTopLevelOffersAreEbayOrCashConvertersTiers(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isCustomEbayItem === true || item.isCustomCashConvertersItem === true) return true;
  const sample = item.cashOffers?.[0] ?? item.voucherOffers?.[0];
  const id = sample?.id != null ? String(sample.id) : '';
  return /^ebay-(cash|voucher)[_-]|^cc-(cash|voucher)[_-]/.test(id);
}

function fmtMoney(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toFixed(2);
}

function fmtPctOfCex(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Math.round(Number(n) * 100) / 100;
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 10) / 10).toString();
}

/**
 * @param {number|null|undefined} suggestedPrice
 * @param {[number, number, number, number] | null | undefined} ebayOfferMargins
 * @param {{ price: number, pctOfSale: number }[] | null | undefined} savedBuyOffers
 * @param {boolean} [useVoucherOffers]
 */
function offerRowsFromSuggestedSale(
  suggestedPrice,
  ebayOfferMargins,
  savedBuyOffers,
  useVoucherOffers = false,
  /** When true, never invent offers from category margins (Others panel = saved research only). */
  noSyntheticFallback = false
) {
  let offers = [];
  if (Array.isArray(savedBuyOffers) && savedBuyOffers.length > 0) {
    offers = savedBuyOffers.slice(0, 4);
  } else {
    if (noSyntheticFallback) return [];
    const sp = suggestedPrice != null ? Number(suggestedPrice) : NaN;
    if (Number.isFinite(sp) && sp > 0) {
      offers = calculateBuyOffers(sp, ebayOfferMargins);
    }
  }
  if (!offers.length) return [];
  const labels = useVoucherOffers ? EBAY_CC_RESEARCH_LABELS_VOUCHER : EBAY_CC_RESEARCH_LABELS_CASH;
  return offers.map((o, i) => {
    const raw = Number(o.price);
    const display = useVoucherOffers && Number.isFinite(raw) ? toVoucherOfferPrice(raw) : raw;
    return {
      kind: 'keyValue',
      metric: labels[i] || (useVoucherOffers ? `Voucher offer ${i + 1}` : `Cash offer ${i + 1}`),
      value: `${fmtMoney(display)} · ${Math.round(Number(o.pctOfSale))}% of sale price`,
    };
  });
}

/** @returns {{ kind: 'keyValue', metric: string, value: string }[]} */
function tableRowsFromResearchSnapshot(
  data,
  ebayOfferMargins,
  useVoucherOffers,
  /** Only rows backed by saved listings or saved buy offers (no margin-synthesized offers or orphan stats). */
  persistedResearchOnly = false
) {
  if (!data || typeof data !== 'object') return [];
  const listings = data.listings;
  const listingCount = Array.isArray(listings) ? listings.length : 0;
  const savedOffers = Array.isArray(data.buyOffers) ? data.buyOffers : [];
  if (persistedResearchOnly) {
    if (listingCount === 0 && savedOffers.length === 0) return [];
  }

  const rows = [];
  const s = data.stats;
  const showStats = !persistedResearchOnly || listingCount > 0;
  if (showStats && s && typeof s === 'object') {
    const avg = fmtMoney(s.average);
    if (avg) rows.push({ kind: 'keyValue', metric: 'Average (£)', value: avg });
    const med = fmtMoney(s.median);
    if (med) rows.push({ kind: 'keyValue', metric: 'Median (£)', value: med });
    const sug = fmtMoney(s.suggestedPrice);
    if (sug) rows.push({ kind: 'keyValue', metric: 'Suggested (£)', value: sug });
  }
  const sugRaw = s?.suggestedPrice;
  rows.push(
    ...offerRowsFromSuggestedSale(sugRaw, ebayOfferMargins, data.buyOffers, useVoucherOffers, persistedResearchOnly)
  );
  if (Array.isArray(listings) && (!persistedResearchOnly || listingCount > 0)) {
    rows.push({ kind: 'keyValue', metric: 'Listings (n)', value: String(listings.length) });
  }
  return rows;
}

function cexStatRows(item, useVoucherOffers) {
  const has =
    item.isCustomCeXItem ||
    item.cexSku ||
    item.cexProductData ||
    item.cexSellPrice != null ||
    item.cexBuyPrice != null;
  if (!has) return [];

  const rows = [];
  const sell = fmtMoney(item.cexSellPrice);
  if (sell) rows.push({ kind: 'keyValue', metric: 'Sell (£)', value: sell });
  const buyCash = fmtMoney(item.cexBuyPrice);
  const buyVouch = fmtMoney(item.cexVoucherPrice);
  if (!useVoucherOffers && buyCash) {
    rows.push({ kind: 'keyValue', metric: 'CeX cash (£)', value: buyCash });
  }
  if (useVoucherOffers && buyVouch) {
    rows.push({ kind: 'keyValue', metric: 'CeX voucher (£)', value: buyVouch });
  }
  if (
    sell ||
    buyCash ||
    buyVouch ||
    item.cexOutOfStock != null ||
    item.cexProductData?.isOutOfStock != null
  ) {
    const oos = !!(item.cexOutOfStock || item.cexProductData?.isOutOfStock);
    rows.push({
      kind: 'keyValue',
      metric: 'Out of stock',
      value: oos ? 'true' : 'false',
      valueVariant: 'boolean',
    });
  }
  return rows;
}

/** @returns {SummaryRow[]} */
function resolveCexOfferSectionRows(item) {
  const { tradeinCash, tradeinVoucher } = resolveCexPricingInputs(item);
  const tradeInRefs = { tradeinCash, tradeinVoucher };
  const zipped = itemTopLevelOffersAreEbayOrCashConvertersTiers(item)
    ? []
    : zipPersistedCexOfferRows(item.cashOffers, item.voucherOffers, tradeInRefs);
  if (zipped.length > 0) return zipped;

  const raw = item.rawData;
  if (raw && (Array.isArray(raw.cash_offers) || Array.isArray(raw.voucher_offers))) {
    const z = zipPersistedCexOfferRows(raw.cash_offers, raw.voucher_offers, tradeInRefs);
    if (z.length > 0) return z;
  }

  const pd = item.cexProductData;
  if (pd && (Array.isArray(pd.cash_offers) || Array.isArray(pd.voucher_offers))) {
    const z = zipPersistedCexOfferRows(pd.cash_offers, pd.voucher_offers, tradeInRefs);
    if (z.length > 0) return z;
  }
  const ref = pd?.referenceData || pd?.reference_data;
  if (ref && (Array.isArray(ref.cash_offers) || Array.isArray(ref.voucher_offers))) {
    const z = zipPersistedCexOfferRows(ref.cash_offers, ref.voucher_offers, tradeInRefs);
    if (z.length > 0) return z;
  }

  const topRef = item.referenceData;
  if (topRef && (Array.isArray(topRef.cash_offers) || Array.isArray(topRef.voucher_offers))) {
    return zipPersistedCexOfferRows(topRef.cash_offers, topRef.voucher_offers, tradeInRefs);
  }

  return [];
}

/**
 * One line per tier: amount · % of CeX cash|voucher (matches selected offer mode).
 * @param {SummaryRow[]} rows
 */
function narrowCexDualOfferRowsForSelection(rows, useVoucherOffers) {
  const cexRefLabel = useVoucherOffers ? 'CeX voucher' : 'CeX cash';
  const out = [];
  for (const r of rows) {
    if (r.kind !== 'cexDual') {
      out.push(r);
      continue;
    }
    const priceStr = useVoucherOffers ? r.voucher : r.cash;
    const pctNum = useVoucherOffers ? r.pctVoucher : r.pctCash;
    if (priceStr == null && pctNum == null) continue;
    const money = priceStr != null ? fmtMoney(Number(priceStr)) : null;
    const pctStr = fmtPctOfCex(pctNum);
    let value = '';
    if (money && pctStr != null) {
      value = `${money} · ${pctStr}% of ${cexRefLabel}`;
    } else if (money) {
      value = money;
    } else if (pctStr != null) {
      value = `${pctStr}% of ${cexRefLabel}`;
    }
    if (!value) continue;
    out.push({ kind: 'keyValue', metric: r.metric, value });
  }
  return out;
}

/** @returns {SummaryRow[]} */
function tableRowsFromCeX(item, useVoucherOffers) {
  const stats = cexStatRows(item, useVoucherOffers);
  const offers = narrowCexDualOfferRowsForSelection(
    resolveCexOfferSectionRows(item),
    useVoucherOffers
  );
  return [...stats, ...offers];
}

/**
 * @param {object|null|undefined} item
 * @param {'eBay'|'CashConverters'} activeResearchSource
 * @param {{ ebayOfferMargins?: [number, number, number] | null, useVoucherOffers?: boolean }} [options]
 * @returns {{ blocks: { title: string, rows: SummaryRow[] }[] } | null}
 */
export function buildOtherResearchChannelsSummaries(item, activeResearchSource, options = {}) {
  if (!item) return null;
  const { ebayOfferMargins = null, useVoucherOffers = false } = options;
  const blocks = [];

  const cexRows = tableRowsFromCeX(item, useVoucherOffers);
  if (cexRows.length) blocks.push({ title: 'CeX', rows: cexRows });

  if (activeResearchSource === 'eBay') {
    const rows = tableRowsFromResearchSnapshot(
      item.cashConvertersResearchData,
      ebayOfferMargins,
      useVoucherOffers,
      true
    );
    if (rows.length) blocks.push({ title: 'Cash Converters', rows });
  } else {
    const rows = tableRowsFromResearchSnapshot(
      item.ebayResearchData,
      ebayOfferMargins,
      useVoucherOffers,
      true
    );
    if (rows.length) blocks.push({ title: 'eBay', rows });
  }

  if (!blocks.length) return null;
  return { blocks };
}

/**
 * @typedef {(
 *   | { kind: 'keyValue', metric: string, value: string, valueVariant?: 'boolean' }
 *   | { kind: 'cexDual', metric: string, cash: string|null, voucher: string|null, basis: string, pctCash?: number|null, pctVoucher?: number|null }
 * )} SummaryRow
 */

/** Stable key for open-state: invalidates when summary content changes without a new object identity. */
export function otherResearchSummariesSignature(summaries) {
  if (!summaries?.blocks?.length) return '';
  return summaries.blocks
    .map((b) => `${b.title}:${b.rows.map(rowSignature).join('\t')}`)
    .join('|');
}

function rowSignature(r) {
  if (r.kind === 'cexDual') {
    return `${r.metric}:cash=${r.cash}:vouch=${r.voucher}:pc=${r.pctCash}:pv=${r.pctVoucher}:${r.basis}`;
  }
  return `${r.metric}:${r.value}`;
}
