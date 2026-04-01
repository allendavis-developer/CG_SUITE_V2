/**
 * When Mastermelt reference sections change, remap workspace lines and negotiation rows
 * to new rates while preserving tier index (selectedOfferId / selectedOfferTierPct).
 */

import { normalizeExplicitSalePrice } from '@/utils/helpers';
import {
  isJewelleryCoinLine,
  isJewelleryCoinSilverOzLine,
  rebuildJewelleryOffersForNegotiationItem,
} from './jewelleryNegotiationCart';
import { troyOzSilverReferenceFromCatalog } from './jewellerySilverCoinReference';

function normalizeSourceUnit(unitRaw) {
  const s = String(unitRaw || '').toLowerCase();
  if (s.includes('kg')) return 'PER_KG';
  if (s.includes('gm') || /\bper g\b/.test(s)) return 'PER_G';
  return 'UNIT';
}

function parsePriceNumber(raw) {
  return parseFloat(String(raw ?? '').replace(/,/g, '')) || 0;
}

function ratePerGramFromPrice(sourceKind, priceNumeric) {
  if (!Number.isFinite(priceNumeric) || priceNumeric <= 0) return null;
  if (sourceKind === 'PER_G') return priceNumeric;
  if (sourceKind === 'PER_KG') return priceNumeric / 1000;
  return null;
}

function isGoldCoinsSection(sectionTitle) {
  const t = String(sectionTitle || '').toLowerCase().trim();
  return t === 'gold coins' || t.includes('gold coin');
}

export function buildJewelleryScrapeCatalog(sections) {
  const out = [];
  (sections || []).forEach((sec) => {
    (sec?.rows || []).forEach((r, i) => {
      let sourceKind = normalizeSourceUnit(r.unit);
      const priceNumeric = parsePriceNumber(r.priceGbp);
      const coinRow = isGoldCoinsSection(sec.title) && priceNumeric > 0;
      if (coinRow) sourceKind = 'UNIT';
      const catalogId = `${sec.title}::${r.label}::${i}`;
      out.push({
        catalogId,
        sectionTitle: sec.title,
        displayName: `${sec.title} — ${r.label}`,
        sourceKind,
        ratePerGram: coinRow ? null : ratePerGramFromPrice(sourceKind, priceNumeric),
        unitPrice: coinRow ? priceNumeric : sourceKind === 'UNIT' ? priceNumeric : null,
      });
    });
  });
  return out;
}

function sectionNorm(s) {
  return String(s || '')
    .toLowerCase()
    .trim();
}

function catalogSliceForMaterialGrade(catalog, materialGrade) {
  const raw = String(materialGrade || '').trim();
  if (!raw || !catalog.length) return catalog;

  const exact = raw.toLowerCase();
  const bySection = (needle) =>
    catalog.filter((c) => {
      const t = sectionNorm(c.sectionTitle);
      return t === needle || t.includes(needle);
    });

  if (exact === 'silver') return bySection('silver');
  if (exact === 'platinum') return bySection('platinum');
  if (exact === 'palladium') return bySection('palladium');
  if (
    exact === 'full sovereign' ||
    exact === 'half sovereign' ||
    exact === 'krugerrand'
  ) {
    return bySection('gold coins');
  }
  if (/\d+ct\s*gold/i.test(raw)) return bySection('gold');

  return catalog;
}

function suggestReferenceEntries(catalog, materialGrade) {
  if (!materialGrade || !catalog.length) return catalog;
  const slice = catalogSliceForMaterialGrade(catalog, materialGrade);
  const pool = slice.length ? slice : catalog;
  const mg = materialGrade.toLowerCase().trim();
  const tokens = mg.split(/[\s/]+/).filter((t) => t.length >= 2);
  const scored = pool
    .map((c) => {
      const d = c.displayName.toLowerCase();
      let score = 0;
      if (d.includes(mg)) score += 10;
      for (const t of tokens) {
        if (d.includes(t)) score += 2;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored.map((x) => x.c) : slice.length ? slice : catalog;
}

function bestReferenceEntry(catalog, materialGrade, productName) {
  if (!catalog.length) return null;
  const prod = String(productName ?? '').trim().toLowerCase();
  const mg = String(materialGrade ?? '').trim().toLowerCase();
  if (prod === 'coin' && mg === 'silver') {
    const oz = troyOzSilverReferenceFromCatalog(catalog);
    if (oz) return oz;
  }
  const ranked = suggestReferenceEntries(catalog, materialGrade);
  return ranked[0] ?? catalog[0] ?? null;
}

function resolveWorkspaceReferenceEntry(line, catalog) {
  const cid = line.referenceEntry?.catalogId;
  if (cid) {
    const byId = catalog.find((c) => c.catalogId === cid);
    if (byId) return byId;
  }
  return bestReferenceEntry(catalog, line.materialGrade, line.productName);
}

/**
 * @param {Array} lines - workspace line objects
 * @param {Array} sections - Mastermelt scrape sections
 */
export function remapJewelleryWorkspaceLines(lines, sections) {
  const catalog = buildJewelleryScrapeCatalog(sections);
  if (!catalog.length || !Array.isArray(lines)) return lines;
  return lines.map((line) => {
    const ref = resolveWorkspaceReferenceEntry(line, catalog);
    if (!ref) return line;
    const coin = isJewelleryCoinLine(line);
    const nextWeightUnit =
      ref.sourceKind === 'UNIT'
        ? 'each'
        : line.weightUnit === 'each'
          ? 'g'
          : line.weightUnit === 'kg'
            ? 'kg'
            : 'g';
    return {
      ...line,
      referenceEntry: ref,
      sourceKind: ref.sourceKind,
      ratePerGram: ref.ratePerGram,
      unitPrice: ref.unitPrice,
      weightUnit: coin ? 'each' : nextWeightUnit,
      weight: coin ? '1' : line.weight,
    };
  });
}

function negotiationTotalFromRefEntry(refEntry, weightRaw, weightUnitRaw) {
  if (!refEntry) return 0;
  if (refEntry.sourceKind === 'UNIT') {
    const n = parseFloat(weightRaw) || 0;
    return Math.round(n * (refEntry.unitPrice || 0) * 100) / 100;
  }
  const w = parseFloat(weightRaw) || 0;
  const rate = refEntry.ratePerGram;
  if (rate == null || !Number.isFinite(rate)) return 0;
  const grams = weightUnitRaw === 'kg' ? w * 1000 : w;
  return Math.round(grams * rate * 100) / 100;
}

/**
 * @param {object} item - negotiation cart row
 * @param {Array} sections
 * @param {boolean} useVoucherOffers
 */
export function applyJewelleryScrapeToNegotiationItem(item, sections, useVoucherOffers, jewelleryRuleSettings = null) {
  if (!item?.isJewelleryItem || !item.referenceData?.jewellery_line) return item;
  const catalog = buildJewelleryScrapeCatalog(sections);
  if (!catalog.length) return item;

  const rd = item.referenceData;
  const cid = rd.reference_catalog_id;
  const refEntry =
    (cid ? catalog.find((c) => c.catalogId === cid) : null) ||
    bestReferenceEntry(catalog, rd.material_grade, rd.product_name);
  if (!refEntry) return item;

  const isCoin = isJewelleryCoinLine({ productName: rd.product_name, materialGrade: rd.material_grade });
  const isSilverOz = isJewelleryCoinSilverOzLine({ productName: rd.product_name, materialGrade: rd.material_grade });
  const weight = isCoin ? '1' : rd.weight;
  const wu = isCoin ? 'each' : rd.weight_unit === 'each' ? 'each' : rd.weight_unit || 'g';
  const total = negotiationTotalFromRefEntry(refEntry, weight, wu);

  const displayWu = isCoin ? (isSilverOz ? 't oz' : 'coin') : wu === 'each' ? 'ea' : wu;
  const subtitle = [
    refEntry.displayName,
    isCoin
      ? isSilverOz
        ? '1 troy oz'
        : '1 coin'
      : weight != null && weight !== ''
        ? `${weight}${displayWu}`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const referenceData = {
    ...rd,
    reference_catalog_id: refEntry.catalogId,
    reference_display_name: refEntry.displayName,
    reference_section_title: refEntry.sectionTitle,
    reference_price_source_kind: refEntry.sourceKind,
    rate_per_gram: isCoin ? null : refEntry.ratePerGram,
    unit_price: refEntry.unitPrice,
    weight: isCoin ? '1' : rd.weight,
    weight_unit: isCoin ? 'each' : rd.weight_unit,
    computed_total_gbp: total,
  };

  const rawData =
    item.rawData != null && typeof item.rawData === 'object'
      ? { ...item.rawData, referenceData }
      : { referenceData };

  const base = {
    ...item,
    subtitle,
    ourSalePrice: total > 0 ? normalizeExplicitSalePrice(total) : item.ourSalePrice,
    referenceData,
    rawData,
    isJewelleryItem: true,
  };
  return rebuildJewelleryOffersForNegotiationItem(base, useVoucherOffers, jewelleryRuleSettings);
}
