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

function leafNosposIdFromPersistedFieldValuesBlob(item) {
  const fv = getAiSuggestedNosposStockFieldValuesFromItem(item);
  const id = fv?.nosposCategoryId;
  if (id != null && Number(id) > 0) return Number(id);
  return null;
}

/** AI hint carries a real NosPos leaf id (not an internal-category mirror row). */
function leafNosposIdFromAuthoritativeCategoryHint(hint) {
  if (!hint || hint.fromInternalProductCategory === true) return null;
  const raw = hint.nosposId ?? hint.category_id;
  if (raw != null && Number(raw) > 0) return Number(raw);
  return null;
}

function leafNosposIdFromDbCategoryMappingRows(item, categoryMappings, categoriesResults) {
  if (!Array.isArray(categoryMappings) || categoryMappings.length === 0) return null;
  if (!Array.isArray(categoriesResults) || categoriesResults.length === 0) return null;
  const internalId = item.categoryObject?.id ?? null;
  const pathLeaf =
    Array.isArray(item.categoryObject?.path) && item.categoryObject.path.length > 0
      ? item.categoryObject.path[item.categoryObject.path.length - 1]
      : null;
  const internalName = item.categoryObject?.name ?? pathLeaf ?? item.category ?? null;
  const map = findNosposMappingForCategory(internalId, internalName, categoryMappings);
  if (!map?.nosposPath) return null;
  const id = matchNosposPathToLeafNosposId(map.nosposPath, categoriesResults);
  if (id != null && Number(id) > 0) return id;
  return null;
}

/**
 * When the saved hint mirrors the internal product tree (`fromInternalProductCategory`), the NosPos leaf
 * is found by matching hint / product breadcrumb strings to `GET /nospos-categories/` `fullName` values.
 */
function leafNosposIdFromMirroredProductCategoryPaths(item, hint, categoriesResults) {
  if (!hint || hint.fromInternalProductCategory !== true) return null;
  if (!Array.isArray(categoriesResults) || categoriesResults.length === 0) return null;

  let pathStr = '';
  if (hint.fullName != null && String(hint.fullName).trim()) {
    pathStr = String(hint.fullName).trim();
  } else if (Array.isArray(hint.pathSegments) && hint.pathSegments.length > 0) {
    pathStr = hint.pathSegments.map((s) => String(s).trim()).filter(Boolean).join(' > ');
  }
  if (pathStr) {
    const id = matchNosposPathToLeafNosposId(pathStr, categoriesResults);
    if (id != null && Number(id) > 0) return id;
  }

  const co = item?.categoryObject;
  const pathSegs = Array.isArray(co?.path)
    ? co.path.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const productPathString =
    pathSegs.length > 0
      ? pathSegs.join(' > ')
      : co?.name != null && String(co.name).trim()
        ? String(co.name).trim()
        : '';
  if (!productPathString) return null;
  const id2 = matchNosposPathToLeafNosposId(productPathString, categoriesResults);
  if (id2 != null && Number(id2) > 0) return id2;
  return null;
}

/**
 * NosPos stock leaf id for linked fields, extension fill, and negotiation UI.
 *
 * Resolution order (first hit wins):
 * 1. Persisted `aiSuggestedNosposStockFieldValues.nosposCategoryId`
 * 2. AI category hint `nosposId` when not an internal-product mirror
 * 3. DB nospos-category-mapping for this internal category
 * 4. Internal-mirror hint + product path matched to NosPos `fullName` rows
 *
 * @param {object|null|undefined} item
 * @param {{
 *   categoryMappings?: Array<{ internalCategoryId?: number, internalCategoryName?: string, nosposPath?: string }>|null,
 *   nosposCategoriesResults?: Array<{ fullName?: string, nosposId?: number }>|null,
 * }} [extras]
 * @returns {number|null}
 */
export function resolveNosposStockLeafIdForNegotiationLine(item, extras = {}) {
  if (!item || typeof item !== 'object') return null;

  const fromFv = leafNosposIdFromPersistedFieldValuesBlob(item);
  if (fromFv != null) return fromFv;

  const hint = getAiSuggestedNosposStockCategoryFromItem(item);
  const fromHint = leafNosposIdFromAuthoritativeCategoryHint(hint);
  if (fromHint != null) return fromHint;

  const { categoryMappings = null, nosposCategoriesResults = null } = extras;
  const categoriesResults = Array.isArray(nosposCategoriesResults) ? nosposCategoriesResults : [];

  const fromMap = leafNosposIdFromDbCategoryMappingRows(item, categoryMappings, categoriesResults);
  if (fromMap != null) return fromMap;

  const fromMirror = leafNosposIdFromMirroredProductCategoryPaths(item, hint, categoriesResults);
  if (fromMirror != null) return fromMirror;

  return null;
}

/** @see resolveNosposStockLeafIdForNegotiationLine */
export function resolveNosposLeafCategoryIdForAgreementItem(item, extras = {}) {
  return resolveNosposStockLeafIdForNegotiationLine(item, extras);
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
