/**
 * Pure utility helpers for NoSpos category mappings.
 * Data is now stored in the database — see api.js for
 * fetchNosposCategoryMappings / createNosposCategoryMapping / etc.
 *
 * Each mapping object shape (as returned by the API):
 *   { id, internalCategoryId, internalCategoryName, nosposPath }
 */

/**
 * Find the first mapping that matches by category ID (preferred) or name.
 * Accepts the mappings array explicitly so callers control where the data
 * comes from (API response, component state, etc.).
 *
 * @param {number|string|null} categoryId
 * @param {string|null} categoryName
 * @param {Array} mappings  - array of mapping objects from the API
 * @returns {object|null}
 */
export function findNosposMappingForCategory(categoryId, categoryName, mappings) {
  if (!Array.isArray(mappings) || !mappings.length) return null;

  if (categoryId != null) {
    const byId = mappings.find(
      (m) => m.internalCategoryId != null && Number(m.internalCategoryId) === Number(categoryId),
    );
    if (byId) return byId;
  }

  if (categoryName) {
    const nameLower = String(categoryName).trim().toLowerCase();
    const byName = mappings.find(
      (m) => String(m.internalCategoryName || '').trim().toLowerCase() === nameLower,
    );
    if (byName) return byName;
  }

  return null;
}

/** Split a nospos path string into segments, trimming whitespace. */
export function parseNosposPath(pathString) {
  return String(pathString || '')
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Segments for matching against the NoSpos option tree (from AI research persistence).
 *
 * @param {object|null|undefined} hint - `{ fullName?, pathSegments?, nosposId? }`
 * @returns {string[]|null}
 */
export function nosposBreadcrumbSegmentsFromHint(hint) {
  if (!hint || typeof hint !== 'object') return null;
  if (Array.isArray(hint.pathSegments) && hint.pathSegments.length > 0) {
    return hint.pathSegments.map((s) => String(s).trim()).filter(Boolean);
  }
  if (hint.fullName != null && String(hint.fullName).trim()) {
    return parseNosposPath(hint.fullName);
  }
  return null;
}

/**
 * Resolve persisted AI NosPos stock hint from a negotiation/cart line (several shapes).
 *
 * @param {object|null|undefined} item
 * @returns {object|null}
 */
export function getAiSuggestedNosposStockCategoryFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.aiSuggestedNosposStockCategory,
    item.ebayResearchData?.aiSuggestedNosposStockCategory,
    item.rawData?.aiSuggestedNosposStockCategory,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && (c.fullName || c.nosposId != null || (Array.isArray(c.pathSegments) && c.pathSegments.length > 0))) {
      return c;
    }
  }
  return null;
}

/**
 * Persisted AI NosPos stock field values (by global field id), from negotiation raw_data.
 *
 * @param {object|null|undefined} item
 * @returns {object|null}
 */
export function getAiSuggestedNosposStockFieldValuesFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.aiSuggestedNosposStockFieldValues,
    item.rawData?.aiSuggestedNosposStockFieldValues,
    item.ebayResearchData?.aiSuggestedNosposStockFieldValues,
  ];
  for (const c of candidates) {
    if (
      c &&
      typeof c === 'object' &&
      c.byNosposFieldId &&
      typeof c.byNosposFieldId === 'object' &&
      Object.keys(c.byNosposFieldId).length > 0
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Match a configured mapping path (`nosposPath` from API) to a row in `GET /nospos-categories/` results.
 *
 * @param {string|null|undefined} nosposPath
 * @param {Array<{ fullName?: string, nosposId?: number }>} categoriesResults
 * @returns {number|null}
 */
export function matchNosposPathToLeafNosposId(nosposPath, categoriesResults) {
  if (!Array.isArray(categoriesResults) || categoriesResults.length === 0) return null;
  const raw = String(nosposPath || '').trim();
  if (!raw) return null;

  const canonical = (s) =>
    String(s || '')
      .replace(/\u00a0/g, ' ')
      .split(/\s*>\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
      .join(' > ');

  const target = canonical(raw);
  const targetLower = target.toLowerCase();

  for (const r of categoriesResults) {
    const fn = canonical(r.fullName || '');
    if (!fn) continue;
    if (fn === target || fn.toLowerCase() === targetLower) {
      const id = Number(r.nosposId ?? r.nospos_id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return null;
}

/**
 * Leaf NosPos stock category id for agreement / park / fill (matches option value).
 *
 * @param {object|null|undefined} item
 * @param {{
 *   categoryMappings?: Array<{ internalCategoryId?: number, internalCategoryName?: string, nosposPath?: string }>|null,
 *   nosposCategoriesResults?: Array<{ fullName?: string, nosposId?: number }>|null,
 * }} [extras] - When set, falls back to internal `categoryObject` → DB NosPos path mapping.
 */
export function resolveNosposLeafCategoryIdForAgreementItem(item, extras = {}) {
  if (!item || typeof item !== 'object') return null;
  const fv = getAiSuggestedNosposStockFieldValuesFromItem(item);
  const fromFv = fv?.nosposCategoryId;
  if (fromFv != null && Number(fromFv) > 0) return Number(fromFv);
  const hint = getAiSuggestedNosposStockCategoryFromItem(item);
  const fromHint = hint?.nosposId ?? hint?.category_id;
  if (fromHint != null && Number(fromHint) > 0) return Number(fromHint);

  const { categoryMappings = null, nosposCategoriesResults = null } = extras;
  if (
    Array.isArray(categoryMappings) &&
    categoryMappings.length > 0 &&
    Array.isArray(nosposCategoriesResults) &&
    nosposCategoriesResults.length > 0
  ) {
    const internalId = item.categoryObject?.id ?? null;
    const pathLeaf =
      Array.isArray(item.categoryObject?.path) && item.categoryObject.path.length > 0
        ? item.categoryObject.path[item.categoryObject.path.length - 1]
        : null;
    const internalName = item.categoryObject?.name ?? pathLeaf ?? item.category ?? null;
    const map = findNosposMappingForCategory(internalId, internalName, categoryMappings);
    if (map?.nosposPath) {
      const fromPath = matchNosposPathToLeafNosposId(map.nosposPath, nosposCategoriesResults);
      if (fromPath != null && Number(fromPath) > 0) return fromPath;
    }
  }

  return null;
}

/** Human-readable hierarchy for UI (AI hint). */
export function getNosposCategoryHierarchyLabelFromItem(item) {
  const hint = getAiSuggestedNosposStockCategoryFromItem(item);
  if (!hint || typeof hint !== 'object') return null;
  if (hint.fullName != null && String(hint.fullName).trim()) return String(hint.fullName).trim();
  const segs = nosposBreadcrumbSegmentsFromHint(hint);
  if (segs?.length) return segs.join(' > ');
  return null;
}

/** Normalise a persisted `byNosposFieldId` entry (string or `{ value }`). */
export function normalizePersistedNosposFieldValue(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const x = v.value;
    if (x == null) return '';
    return String(x).trim();
  }
  return String(v).trim();
}

/** @returns {Record<string, string>} nosposFieldId string -> suggested value */
export function nosposFieldValueMapFromPersisted(item) {
  const blob = getAiSuggestedNosposStockFieldValuesFromItem(item);
  if (!blob?.byNosposFieldId || typeof blob.byNosposFieldId !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(blob.byNosposFieldId)) {
    const s = normalizePersistedNosposFieldValue(v);
    if (s) out[String(k)] = s;
  }
  return out;
}

/** Resolve NosPos field id from extension snapshot or DB mirror synthetic `field_<id>` names. */
export function extractNosposFieldIdFromMirrorField(field) {
  if (field?.nosposFieldId != null) {
    const n = Number(field.nosposFieldId);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const m = String(field?.name || '').match(/\[field_(\d+)\]/i);
  return m ? Number(m[1]) : null;
}
