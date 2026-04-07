import { fetchNosposCategories, fetchNosposCategoryMappings } from '@/services/api';
import { resolveNosposLeafCategoryIdForAgreementItem } from '@/utils/nosposCategoryMappings';
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
