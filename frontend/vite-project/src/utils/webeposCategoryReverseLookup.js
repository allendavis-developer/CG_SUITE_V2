/**
 * Reverse-map Web EPOS category labels to a CG `categoryObject`.
 *
 * Web EPOS categories start at what CG calls the second level — CG paths have "All Categories" as
 * their root, Web EPOS does not. To match, strip "All Categories" from CG paths before comparing.
 */

function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, '&');
}

function parsePathString(raw) {
  return String(raw || '')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripAllCategoriesRoot(segments) {
  if (segments.length === 0) return segments;
  return /^all categories$/i.test(segments[0]) ? segments.slice(1) : segments;
}

function normalizeWebEposLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((x) => String(x ?? '').trim())
    .filter((s) => s && !/^all categories$/i.test(s));
}

/**
 * @param {{uuid:string,label:string}[] | string[]} webeposLevels — output of `scrapeWebEposEditPageForAudit`
 *   (or an already-extracted labels array)
 * @param {Array<{category_id:number, name:string, path?:string, parent_category_id?:number|null}>} allCategoriesFlat
 * @returns {{ id:number, name:string, path:string[] } | null}
 */
export function reverseLookupWebEposCategory(webeposLevels, allCategoriesFlat) {
  if (!Array.isArray(webeposLevels) || webeposLevels.length === 0) return null;
  if (!Array.isArray(allCategoriesFlat) || allCategoriesFlat.length === 0) return null;

  const labels = webeposLevels.every((x) => typeof x === 'string')
    ? webeposLevels
    : webeposLevels.map((lvl) => lvl?.label ?? '');
  const webLabels = normalizeWebEposLabels(labels);
  if (webLabels.length === 0) return null;

  const webNormed = webLabels.map(norm);

  let exact = null;
  let prefix = null;

  for (const row of allCategoriesFlat) {
    if (!row || row.category_id == null) continue;
    const pathSegs = stripAllCategoriesRoot(parsePathString(row.path));
    if (pathSegs.length === 0) continue;
    const rowNormed = pathSegs.map(norm);

    if (rowNormed.length === webNormed.length && rowNormed.every((s, i) => s === webNormed[i])) {
      exact = { row, path: pathSegs };
      break;
    }

    if (
      !prefix &&
      rowNormed.length >= webNormed.length &&
      webNormed.every((s, i) => s === rowNormed[i])
    ) {
      // Web EPOS label chain is a prefix of a CG path — accept if no full match found.
      prefix = { row, path: pathSegs.slice(0, webNormed.length) };
    }
  }

  const match = exact || prefix;
  if (!match) return null;

  return {
    id: match.row.category_id,
    name: match.path[match.path.length - 1],
    path: ['All Categories', ...match.path],
  };
}

/**
 * Inverse: given a CG `categoryObject` (path rooted at "All Categories"), produce the Web EPOS
 * category labels the fill script will match against `#catLevel{N}` option text.
 */
export function cgCategoryObjectToWebEposLabels(categoryObject) {
  if (!categoryObject) return [];
  const path = Array.isArray(categoryObject.path) ? categoryObject.path : [];
  return stripAllCategoriesRoot(path.map((x) => String(x ?? '').trim()).filter(Boolean));
}
