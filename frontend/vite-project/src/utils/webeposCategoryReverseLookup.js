/**
 * Map a scraped Web EPOS category path (the selected labels from `#catLevel1`,
 * `#catLevel2`, …) onto a CG category from `/all-categories/`.
 *
 * Mirrors the forward-fill matching strategy in
 * `chrome-extension/bg/webepos-new-product-fill-page.js`:
 *   1. Normalise (collapse whitespace, lowercase, decode `&amp;`).
 *   2. Exact match against the current level's siblings.
 *   3. Bidirectional substring match as a fallback.
 *
 * Walks the tree level by level starting from roots and descends into the
 * matched child — so "Electronics" → "Mobile Phones" → "Smartphones" resolves
 * to the deepest node that still matches. Returns the deepest match (may be
 * less deep than the input when Web EPOS has extra sub-categories that don't
 * exist on CG). Returns `null` if nothing matches at level 1.
 *
 * @param {string[]} webeposLabels - labels from catLevel1..N, in order
 * @param {Array<{ category_id: number|string, parent_category_id: number|string|null, name: string, path?: string }>} allCategoriesFlat
 * @returns {{ id: number|string, name: string, path: string[] } | null}
 */
export function reverseLookupWebEposCategory(webeposLabels, allCategoriesFlat) {
  if (!Array.isArray(webeposLabels) || webeposLabels.length === 0) return null;
  if (!Array.isArray(allCategoriesFlat) || allCategoriesFlat.length === 0) return null;

  const childrenByParent = new Map();
  for (const row of allCategoriesFlat) {
    const id = row.category_id ?? row.id;
    if (id == null) continue;
    const parentKey = row.parent_category_id ?? null;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(row);
  }

  let parentKey = null;
  let deepest = null;
  const pathNames = [];

  for (const rawLabel of webeposLabels) {
    const want = normalize(rawLabel);
    if (!want) break;

    const siblings = childrenByParent.get(parentKey) || [];
    const matched = pickMatch(siblings, want);
    if (!matched) break;

    deepest = matched;
    pathNames.push(matched.name);
    parentKey = matched.category_id ?? matched.id ?? null;
  }

  if (!deepest) return null;
  return {
    id: deepest.category_id ?? deepest.id,
    name: deepest.name,
    path: pathNames,
  };
}

function pickMatch(candidates, wantNorm) {
  for (const c of candidates) {
    if (normalize(c.name) === wantNorm) return c;
  }
  for (const c of candidates) {
    const cn = normalize(c.name);
    if (cn && (cn.includes(wantNorm) || wantNorm.includes(cn))) return c;
  }
  return null;
}

function normalize(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
