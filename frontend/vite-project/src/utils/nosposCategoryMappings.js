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
