/**
 * Cash Generator retail category hints on negotiation / upload lines (mirrors NosPos hint shape).
 */

/**
 * @param {object|null|undefined} item
 * @returns {object|null}
 */
export function getAiSuggestedCgStockCategoryFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.aiSuggestedCgStockCategory,
    item.rawData?.aiSuggestedCgStockCategory,
    item.ebayResearchData?.aiSuggestedCgStockCategory,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && (c.cgCategoryId != null || (c.categoryPath != null && String(c.categoryPath).trim()))) {
      return c;
    }
  }
  return null;
}

/**
 * @param {object|null|undefined} item
 * @returns {string}
 */
export function getCgCategoryHierarchyLabelFromItem(item) {
  const hint = getAiSuggestedCgStockCategoryFromItem(item);
  if (!hint) return '';
  if (hint.categoryPath != null && String(hint.categoryPath).trim()) {
    return String(hint.categoryPath).trim();
  }
  if (Array.isArray(hint.pathSegments) && hint.pathSegments.length > 0) {
    return ['All Categories', ...hint.pathSegments.map((s) => String(s).trim()).filter(Boolean)].join(' › ');
  }
  return hint.categoryName != null ? String(hint.categoryName).trim() : '';
}

/**
 * Merge CG AI / manual pick onto a workspace or negotiation line (top-level + rawData + ebayResearchData).
 *
 * @param {object} row
 * @param {object} aiSuggestedCgStockCategory
 */
/** Remove CG AI hint so a fresh {@link runCgStockCategoryAiMatchBackground} can run (e.g. after upload RRP changes). */
export function clearCgAiSuggestionFromNegotiationRow(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.aiSuggestedCgStockCategory;
  if (next.rawData != null && typeof next.rawData === 'object') {
    const nr = { ...next.rawData };
    delete nr.aiSuggestedCgStockCategory;
    next.rawData = nr;
  }
  if (next.ebayResearchData != null && typeof next.ebayResearchData === 'object') {
    const eb = { ...next.ebayResearchData };
    delete eb.aiSuggestedCgStockCategory;
    next.ebayResearchData = eb;
  }
  return next;
}

export function mergeCgAiOntoNegotiationRow(row, aiSuggestedCgStockCategory) {
  const nextRaw =
    row.rawData != null && typeof row.rawData === 'object'
      ? { ...row.rawData, aiSuggestedCgStockCategory }
      : { aiSuggestedCgStockCategory };
  const next = {
    ...row,
    aiSuggestedCgStockCategory,
    rawData: nextRaw,
  };
  if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
    return {
      ...next,
      ebayResearchData: { ...row.ebayResearchData, aiSuggestedCgStockCategory },
    };
  }
  return next;
}
