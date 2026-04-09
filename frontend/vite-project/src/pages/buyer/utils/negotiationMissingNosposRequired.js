import { fetchNosposCategories, fetchNosposCategoryMappings } from '@/services/api';
import {
  resolveNosposLeafCategoryIdForAgreementItem,
  getAiSuggestedNosposStockFieldValuesFromItem,
  getNosposCategoryHierarchyLabelFromItem,
} from '@/utils/nosposCategoryMappings';
import { buildNosposAgreementFirstItemFillPayload } from './nosposAgreementFirstItemFill';

/** Human-readable line label for negotiation tables and modals. */
export function negotiationItemDisplayName(item) {
  if (!item) return 'Unknown item';
  const v = String(item.variantName || item.title || '').trim();
  return v || 'Unknown item';
}

/**
 * Lines that have a resolved NosPos leaf category and at least one **required** linked
 * stock field with no value in CG (mirroring `buildNosposAgreementFirstItemFillPayload`).
 *
 * @param {object[]} items
 * @param {object[]|null|undefined} categoriesResults - `GET /nospos-categories/` `results`
 * @param {{ useVoucherOffers?: boolean, categoryMappings?: object[]|null }} [options]
 * @returns {{ itemId: string, itemName: string, missingFieldLabels: string[] }[]}
 */
export function listNegotiationLinesWithMissingRequiredNosposFields(items, categoriesResults, options = {}) {
  const useVoucherOffers = options.useVoucherOffers === true;
  const categoryMappings = Array.isArray(options.categoryMappings) ? options.categoryMappings : null;
  const results = Array.isArray(categoriesResults) ? categoriesResults : [];
  const out = [];
  if (!Array.isArray(items)) return out;

  items.forEach((item, index) => {
    if (!item || item.isRemoved) return;
    const catId = resolveNosposLeafCategoryIdForAgreementItem(item, {
      categoryMappings,
      nosposCategoriesResults: results,
    });
    if (catId == null || Number(catId) <= 0) return;

    const payload = buildNosposAgreementFirstItemFillPayload(item, index, {
      useVoucherOffers,
      categoriesResults: results,
      categoryMappings,
    });
    const missing = payload?.stockCoverage?.requiredMissing;
    if (!Array.isArray(missing) || missing.length === 0) return;

    out.push({
      itemId: item.id,
      itemName: negotiationItemDisplayName(item),
      missingFieldLabels: [...missing],
    });
  });

  return out;
}

/**
 * Loads NosPos categories + internal↔NosPos mappings and returns lines with missing required stock fields.
 * @param {object[]} items
 * @param {boolean} useVoucherOffers
 * @returns {Promise<{ itemId: string, itemName: string, missingFieldLabels: string[] }[]>}
 */
export async function fetchMissingRequiredNosposLines(items, useVoucherOffers) {
  const [catRes, mapRes] = await Promise.all([fetchNosposCategories(), fetchNosposCategoryMappings()]);
  const nosposCategoriesResults = Array.isArray(catRes?.results) ? catRes.results : [];
  const categoryMappings = Array.isArray(mapRes) ? mapRes : [];
  return listNegotiationLinesWithMissingRequiredNosposFields(items, nosposCategoriesResults, {
    useVoucherOffers,
    categoryMappings,
  });
}

/**
 * Lines that have NO resolved NosPos leaf category.
 * Jewellery items (`isJewelleryItem === true`) are excluded.
 *
 * @param {object[]} items
 * @param {object[]|null|undefined} categoriesResults
 * @param {{ categoryMappings?: object[]|null }} [options]
 * @returns {{ itemId: string, itemName: string, currentCategory: string|null }[]}
 */
export function listNegotiationLinesWithNoNosposCategory(items, categoriesResults, options = {}) {
  const categoryMappings = Array.isArray(options.categoryMappings) ? options.categoryMappings : null;
  const results = Array.isArray(categoriesResults) ? categoriesResults : [];
  const out = [];
  if (!Array.isArray(items)) return out;

  items.forEach((item) => {
    if (!item || item.isRemoved || item.isJewelleryItem === true) return;
    const catId = resolveNosposLeafCategoryIdForAgreementItem(item, {
      categoryMappings,
      nosposCategoriesResults: results,
    });
    if (catId == null || Number(catId) <= 0) {
      out.push({
        itemId: item.id,
        itemName: negotiationItemDisplayName(item),
        currentCategory: getNosposCategoryHierarchyLabelFromItem(item) || null,
      });
    }
  });

  return out;
}

/**
 * Loads NosPos categories + mappings and returns lines with no resolved NosPos category.
 * @param {object[]} items
 * @returns {Promise<{ itemId: string, itemName: string, currentCategory: string|null }[]>}
 */
export async function fetchLinesWithNoNosposCategory(items) {
  const [catRes, mapRes] = await Promise.all([fetchNosposCategories(), fetchNosposCategoryMappings()]);
  const nosposCategoriesResults = Array.isArray(catRes?.results) ? catRes.results : [];
  const categoryMappings = Array.isArray(mapRes) ? mapRes : [];
  return listNegotiationLinesWithNoNosposCategory(items, nosposCategoriesResults, { categoryMappings });
}

/**
 * Merge manual / AI blob for `raw_data.aiSuggestedNosposStockFieldValues` (same shape as field-AI save).
 *
 * @param {object} item - negotiation line (for existing blob)
 * @param {number|string} leafNosposId
 * @param {Record<string, string>} draftByFieldId - field id -> value (only edited keys required)
 * @returns {object} aiSuggestedNosposStockFieldValues
 */
export function buildMergedNosposStockFieldValuesBlob(item, leafNosposId, draftByFieldId) {
  const existing = getAiSuggestedNosposStockFieldValuesFromItem(item);
  const prevBy =
    existing?.byNosposFieldId && typeof existing.byNosposFieldId === 'object'
      ? { ...existing.byNosposFieldId }
      : {};
  const mergedBy = { ...prevBy };
  for (const [k, v] of Object.entries(draftByFieldId || {})) {
    const s = String(v ?? '').trim();
    if (s) mergedBy[String(k)] = s;
  }
  return {
    nosposCategoryId: Number(leafNosposId),
    byNosposFieldId: mergedBy,
    source: existing?.source || 'manual_required_editor',
    savedAt: new Date().toISOString(),
  };
}

/**
 * @param {object[]} items
 * @param {string} itemId - `item.id`
 * @param {object} aiSuggestedNosposStockFieldValues
 * @returns {object[]} next items list
 */
export function applyNosposStockFieldBlobToNegotiationItems(items, itemId, aiSuggestedNosposStockFieldValues) {
  if (!Array.isArray(items)) return items;
  return items.map((row) => {
    if (row.id !== itemId) return row;
    const nextRaw =
      row.rawData != null && typeof row.rawData === 'object'
        ? { ...row.rawData, aiSuggestedNosposStockFieldValues }
        : { aiSuggestedNosposStockFieldValues };
    const base = {
      ...row,
      aiSuggestedNosposStockFieldValues,
      rawData: nextRaw,
    };
    if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
      return {
        ...base,
        ebayResearchData: {
          ...row.ebayResearchData,
          aiSuggestedNosposStockFieldValues,
        },
      };
    }
    return base;
  });
}
