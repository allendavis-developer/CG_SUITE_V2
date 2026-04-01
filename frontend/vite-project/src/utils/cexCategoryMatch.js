/**
 * Match a CeX-scraped category string against the flat list of internal DB categories.
 * CeX names often differ from DB names in spacing and capitalisation
 * (e.g. "Playstation5 Consoles" vs "PlayStation 5 Consoles"), so we use three passes
 * in order from most-specific to least:
 *
 *   1. Exact match (case-insensitive)
 *   2. Normalised match: strip all non-alphanumeric chars then compare
 *   3. Substring containment (either direction) on the normalised form
 *
 * For slash-separated CeX paths ("Games / Xbox") we split, reverse, and check
 * the most-specific segment first.
 *
 * Returns { id, name, path } or null.
 */

const GENERIC_NAMES = new Set([
  'cex',
  'ebay',
  'cash converters',
  'cashconverters',
  'other',
  'n/a',
  'unknown',
  '',
]);

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function matchCexCategoryNameToDb(cexName, flatCategories) {
  if (!cexName || !flatCategories?.length) return null;
  if (GENERIC_NAMES.has(String(cexName).toLowerCase().trim())) return null;

  const parts = String(cexName)
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse(); // most-specific first

  const toResult = (cat) => {
    const pathParts = cat.path ? cat.path.split(' > ') : [cat.name];
    return { id: cat.category_id, name: cat.name, path: pathParts };
  };

  // Pass 1: exact name match (case-insensitive)
  for (const part of parts) {
    const lower = part.toLowerCase();
    const match = flatCategories.find((c) => String(c.name || '').toLowerCase() === lower);
    if (match) return toResult(match);
  }

  // Pass 2: normalised match — strips spaces, hyphens, punctuation
  // "Playstation5 Consoles" → "playstation5consoles" == "PlayStation 5 Consoles" → "playstation5consoles"
  for (const part of parts) {
    const norm = normalize(part);
    if (!norm) continue;
    const match = flatCategories.find((c) => normalize(c.name) === norm);
    if (match) return toResult(match);
  }

  // Pass 3: normalised substring — DB name contains part OR part contains DB name
  for (const part of parts) {
    const norm = normalize(part);
    if (!norm) continue;
    const match = flatCategories.find((c) => {
      const n = normalize(c.name);
      return n.includes(norm) || norm.includes(n);
    });
    if (match) return toResult(match);
  }

  return null;
}

export { GENERIC_NAMES };
