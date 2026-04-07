import { formatOfferPrice, roundOfferPrice, toVoucherOfferPrice } from '@/utils/helpers';

export const JEWELLERY_DEFAULT_TIER_MARGINS_PCT = [30, 20, 10, 5];
/** Backward export name for existing imports. */
export const JEWELLERY_TIER_MARGINS_PCT = JEWELLERY_DEFAULT_TIER_MARGINS_PCT;

const OFFER_TITLES = ['1st Offer', '2nd Offer', '3rd Offer', '4th Offer'];
export function resolveJewelleryTierMarginsPct(settingsOrMargins) {
  if (Array.isArray(settingsOrMargins) && settingsOrMargins.length >= 4) {
    const parsed = settingsOrMargins
      .slice(0, 4)
      .map((v, idx) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : JEWELLERY_DEFAULT_TIER_MARGINS_PCT[idx];
      });
    if (parsed[0] > parsed[1] && parsed[1] > parsed[2] && parsed[2] > parsed[3]) return parsed;
    return JEWELLERY_DEFAULT_TIER_MARGINS_PCT;
  }
  const fromSettings = [
    settingsOrMargins?.jewellery_offer_margin_1_pct,
    settingsOrMargins?.jewellery_offer_margin_2_pct,
    settingsOrMargins?.jewellery_offer_margin_3_pct,
    settingsOrMargins?.jewellery_offer_margin_4_pct,
  ];
  return resolveJewelleryTierMarginsPct(fromSettings);
}


function jewelleryCashOfferId(tierIndex) {
  return `jew-cash_${tierIndex + 1}`;
}

/**
 * Rebuild cash/voucher offer arrays from reference total and migrate legacy selectedOfferId
 * (jew-cash-30 / jew-v-jew-cash-30) to jew-cash_1 style so customer rules slot mapping works.
 */
export function rebuildJewelleryOffersForNegotiationItem(item, useVoucherOffers, jewelleryRuleSettings = null) {
  if (!item?.isJewelleryItem || item.referenceData?.jewellery_line !== true) return item;
  const total = parseFloat(item.referenceData.computed_total_gbp);
  if (!Number.isFinite(total) || total <= 0) return item;
  const tierMargins = resolveJewelleryTierMarginsPct(
    item.referenceData?.jewellery_offer_margins_pct || jewelleryRuleSettings
  );

  const cashOffers = tierMargins.map((p, idx) => ({
    id: jewelleryCashOfferId(idx),
    title: OFFER_TITLES[idx] || 'Offer',
    price: tierOfferGbpFromReference(total, p),
  }));
  const voucherOffers = cashOffers.map((o) => ({
    id: `jew-v-${o.id}`,
    title: o.title,
    price: toVoucherOfferPrice(o.price),
  }));
  const offers = useVoucherOffers ? voucherOffers : cashOffers;

  let selectedOfferId = item.selectedOfferId;
  if (selectedOfferId && selectedOfferId !== 'manual') {
    const s = String(selectedOfferId);
    const isVoucherPrefixed = s.startsWith('jew-v-');
    const core = isVoucherPrefixed ? s.slice('jew-v-'.length) : s;
    const newStyle = core.match(/^jew-cash_([1-4])$/);
    if (!newStyle) {
      const oldMargin = core.match(/^jew-cash-(\d+)$/);
      if (oldMargin) {
        const margin = Number(oldMargin[1]);
        const ti = tierMargins.indexOf(margin);
        if (ti >= 0) {
          const nid = jewelleryCashOfferId(ti);
          selectedOfferId = isVoucherPrefixed ? `jew-v-${nid}` : nid;
        }
      }
    }
  }

  if (selectedOfferId && selectedOfferId !== 'manual') {
    const s = String(selectedOfferId);
    const core = s.startsWith('jew-v-') ? s.slice('jew-v-'.length) : s;
    if (/^jew-cash_[1-4]$/.test(core)) {
      selectedOfferId = useVoucherOffers ? `jew-v-${core}` : core;
    }
  }

  return {
    ...item,
    referenceData: {
      ...(item.referenceData || {}),
      jewellery_offer_margins_pct: tierMargins,
    },
    cashOffers,
    voucherOffers,
    offers,
    selectedOfferId,
  };
}

/** Matches DB/reference labels (Gold Coins rows + `Coin` product). */
export function isJewelleryCoinLine(line) {
  if (!line || typeof line !== 'object') return false;
  const prod = String(line.productName ?? line.product_name ?? '').trim().toLowerCase();
  if (prod === 'coin') return true;
  const mg = String(line.materialGrade ?? line.material_grade ?? '').toLowerCase().trim();
  return mg === 'full sovereign' || mg === 'half sovereign' || mg === 'krugerrand';
}

/** Coin + Silver: one workspace unit = 1 troy oz (reference £/oz). */
export function isJewelleryCoinSilverOzLine(line) {
  if (!line || typeof line !== 'object') return false;
  const prod = String(line.productName ?? line.product_name ?? '').trim().toLowerCase();
  const mg = String(line.materialGrade ?? line.material_grade ?? '').trim().toLowerCase();
  return prod === 'coin' && mg === 'silver';
}

export function computeWorkspaceLineTotal(line) {
  if (line.sourceKind === 'UNIT') {
    const n = isJewelleryCoinLine(line) ? 1 : parseFloat(line.weight) || 0;
    return Math.round(n * (line.unitPrice || 0) * 100) / 100;
  }
  const w = parseFloat(line.weight) || 0;
  const rate = line.ratePerGram;
  if (rate == null || !Number.isFinite(rate)) return 0;
  const grams = line.weightUnit === 'kg' ? w * 1000 : w;
  return Math.round(grams * rate * 100) / 100;
}

export function tierOfferGbpFromReference(referenceTotalGbp, marginPct) {
  if (!Number.isFinite(referenceTotalGbp) || referenceTotalGbp <= 0) return 0;
  const raw = referenceTotalGbp * (1 - marginPct / 100);
  // Jewellery tiers should never round up to the next £2 bucket.
  return Math.max(0, Math.floor(raw / 2) * 2);
}

function buildJewelleryReferencePayload(line, total) {
  const ref = line.referenceEntry;
  const categoryLabel = line.categoryLabel || line.variantTitle || null;
  const itemName = line.itemName || categoryLabel;
  const coin = isJewelleryCoinLine(line);
  return {
    jewellery_line: true,
    variant_id: line.variantId,
    product_name: line.productName,
    material_grade: line.materialGrade,
    category_label: categoryLabel,
    item_name: itemName,
    line_title: line.variantTitle,
    reference_catalog_id: ref?.catalogId ?? null,
    reference_display_name: ref?.displayName ?? null,
    reference_section_title: ref?.sectionTitle ?? null,
    reference_price_source_kind: ref?.sourceKind ?? null,
    rate_per_gram: coin ? null : ref?.ratePerGram ?? null,
    unit_price: ref?.unitPrice ?? null,
    weight: coin ? '1' : line.weight,
    weight_unit: coin ? 'each' : line.weightUnit,
    computed_total_gbp: total,
  };
}

/**
 * Reference totals, rebuilt tier offers, and selection (tier vs manual) for a workspace row.
 * @param {object} line
 * @param {boolean} useVoucherOffers
 * @returns {{ referenceData: object, cashOffers: array, voucherOffers: array, offers: array, selectedOfferId: string|null, manualOffer: string, manualOfferUsed: boolean, ourSalePrice: number|null }}
 */
export function getJewelleryWorkspaceDerivedState(line, useVoucherOffers, jewelleryRuleSettings = null) {
  const total = computeWorkspaceLineTotal(line);
  const tierMargins = resolveJewelleryTierMarginsPct(jewelleryRuleSettings);
  const referenceData = buildJewelleryReferencePayload(line, total);
  referenceData.jewellery_offer_margins_pct = tierMargins;
  const cashOffers = tierMargins.map((p, idx) => ({
    id: jewelleryCashOfferId(idx),
    title: OFFER_TITLES[idx] || 'Offer',
    price: tierOfferGbpFromReference(total, p),
  }));
  const voucherOffers = cashOffers.map((o) => ({
    id: `jew-v-${o.id}`,
    title: o.title,
    price: toVoucherOfferPrice(o.price),
  }));
  const offers = useVoucherOffers ? voucherOffers : cashOffers;

  const manualRaw = String(line.manualOfferInput ?? '').trim();
  const manualVal = parseFloat(manualRaw.replace(/[£,]/g, ''));
  const hasManual = Number.isFinite(manualVal) && manualVal > 0;
  const pct = line.selectedOfferTierPct;
  const hasTier = pct != null && tierMargins.includes(pct);

  let selectedOfferId = null;
  let manualOffer = '';
  let manualOfferUsed = false;

  if (hasTier) {
    const ti = tierMargins.indexOf(pct);
    const cashId = jewelleryCashOfferId(ti);
    selectedOfferId = useVoucherOffers ? `jew-v-${cashId}` : cashId;
  } else if (hasManual) {
    const rounded = roundOfferPrice(manualVal);
    selectedOfferId = 'manual';
    manualOffer = formatOfferPrice(rounded);
    manualOfferUsed = true;
  }

  return {
    referenceData,
    cashOffers,
    voucherOffers,
    offers,
    selectedOfferId,
    manualOffer,
    manualOfferUsed,
    ourSalePrice: total > 0 ? Number(formatOfferPrice(total)) : null,
  };
}

/**
 * One workspace row → cart item for {@link handleAddNegotiationItem}.
 * Tier selection is optional: all four offers are still attached; `selectedOfferId` is set only when a tier was chosen.
 * @throws {Error} if reference total is not positive
 * @param {number|null} [fallbackJewelleryCategoryId] - DB leaf id for "Jewellery" from `/all-categories/` when line has no `jewelleryDbCategoryId`
 */
export function buildJewelleryNegotiationCartItem(
  line,
  useVoucherOffers,
  jewelleryRuleSettings = null,
  fallbackJewelleryCategoryId = null
) {
  const total = computeWorkspaceLineTotal(line);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Each jewellery item needs a positive reference total.');
  }
  const derived = getJewelleryWorkspaceDerivedState(line, useVoucherOffers, jewelleryRuleSettings);

  const categoryLabel = line.categoryLabel || line.variantTitle;
  const itemName = line.itemName || categoryLabel;
  const qtySubtitle = isJewelleryCoinSilverOzLine(line)
    ? '1 troy oz'
    : isJewelleryCoinLine(line)
      ? '1 coin'
      : `${line.weight}${line.weightUnit === 'each' ? ' ea' : line.weightUnit}`;
  const jewInternalId =
    line.jewelleryDbCategoryId != null && Number(line.jewelleryDbCategoryId) > 0
      ? Number(line.jewelleryDbCategoryId)
      : fallbackJewelleryCategoryId != null && Number(fallbackJewelleryCategoryId) > 0
        ? Number(fallbackJewelleryCategoryId)
        : null;
  const categoryObject =
    jewInternalId != null
      ? { id: jewInternalId, name: 'Jewellery', path: ['Jewellery'] }
      : { name: 'Jewellery', path: ['Jewellery'] };
  return {
    id: crypto.randomUUID?.() ?? `jew-neg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: itemName,
    subtitle: [line.referenceEntry?.displayName, qtySubtitle].filter(Boolean).join(' · '),
    quantity: 1,
    variantId: line.variantId,
    variantName: itemName,
    isJewelleryItem: true,
    referenceData: derived.referenceData,
    cashOffers: derived.cashOffers,
    voucherOffers: derived.voucherOffers,
    offers: derived.offers,
    selectedOfferId: derived.selectedOfferId,
    manualOffer: derived.manualOffer,
    manualOfferUsed: derived.manualOfferUsed,
    authorisedOfferSlots: Array.isArray(line.authorisedOfferSlots) ? line.authorisedOfferSlots : [],
    ourSalePrice: derived.ourSalePrice ?? Number(formatOfferPrice(total)),
    seniorMgmtApprovedBy: line.selectedOfferTierAuthBy || line.manualOfferAuthBy || undefined,
    category: 'Jewellery',
    categoryObject,
    request_item_id: null,
  };
}

export function buildJewelleryNegotiationCartItems(
  lines,
  useVoucherOffers,
  jewelleryRuleSettings = null,
  fallbackJewelleryCategoryId = null
) {
  return lines.map((line) =>
    buildJewelleryNegotiationCartItem(line, useVoucherOffers, jewelleryRuleSettings, fallbackJewelleryCategoryId)
  );
}
