/**
 * AI-powered NosPos category suggestion service.
 *
 * Calls the backend which uses Groq (meta-llama/llama-4-scout-17b-16e-instruct)
 * to suggest the best category option at each hierarchy level.
 */
import { getCSRFToken } from '../utils/helpers';

const ENDPOINT = '/api/ai/suggest-category/';

/**
 * @typedef {Object} ItemSummary
 * @property {string}              name        - Display name of the item
 * @property {string|null}         dbCategory  - Category from our database
 * @property {Record<string,string>} attributes - Key/value attribute pairs
 */

/**
 * @typedef {Object} CategorySuggestion
 * @property {string} suggested   - One of the exact strings from availableOptions
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} reasoning   - One-sentence explanation
 */

/**
 * Ask the AI to suggest the best NosPos category option at a given hierarchy level.
 *
 * Fires as soon as that level's options are known — before the user has interacted.
 *
 * @param {object}   params
 * @param {ItemSummary} params.item            - Summarised item details
 * @param {number}   params.levelIndex         - 0-based hierarchy depth
 * @param {string[]} params.availableOptions   - Sorted option labels at this level
 * @param {string[]} params.previousPath       - Already-selected segments above this level
 * @returns {Promise<CategorySuggestion>}
 */
export async function suggestNosposCategory({ item, levelIndex, availableOptions, previousPath }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    body: JSON.stringify({ item, levelIndex, availableOptions, previousPath }),
  });

  if (!res.ok) {
    let msg = `AI category suggestion failed (${res.status})`;
    try { const err = await res.json(); msg = err.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  return res.json();
}

// ---------------------------------------------------------------------------

const FIELDS_ENDPOINT = '/api/ai/suggest-fields/';

/**
 * @typedef {Object} FieldEntry
 * @property {string} name
 * @property {string} label
 * @property {string} control       - 'text' | 'select' | 'number' | etc.
 * @property {{ value: string, text: string }[]} options
 */

/**
 * Fields that require physical inspection or store-specific knowledge.
 * The AI should never attempt to fill these.
 */
const SKIP_PATTERN =
  /description|serial|imei|barcode|ean|isbn|upc|location|address|postcode|post.?code|notes?|comments?|memo|remarks?|condition|password|\bpin\b|\brate\b/i;

/**
 * Returns true if the field should be excluded from AI auto-fill.
 * @param {{ name: string, label: string }} field
 */
export function shouldSkipAiFill(field) {
  return (
    SKIP_PATTERN.test(String(field.label || '')) ||
    SKIP_PATTERN.test(String(field.name || ''))
  );
}

/** Last `[segment]` in a NosPos form name, e.g. DraftAgreementItem[105118][grade] → grade */
function lastBracketSegment(formName) {
  const ms = [...String(formName).matchAll(/\[([^\]]+)\]/g)];
  return ms.length ? ms[ms.length - 1][1] : '';
}

/**
 * Map model keys (often "grade" / "Grade") to real form `name` attributes.
 * @param {Record<string, unknown>|null|undefined} rawFields
 * @param {FieldEntry[]} fieldsList
 * @returns {Record<string, string>}
 */
export function normalizeAiFieldResponseKeys(rawFields, fieldsList) {
  if (!rawFields || typeof rawFields !== 'object') return {};
  const fields = fieldsList || [];
  const nameSet = new Set(fields.map((f) => f.name).filter(Boolean));
  const aliasToName = new Map();

  for (const f of fields) {
    const fn = f.name;
    if (!fn) continue;
    aliasToName.set(String(fn).toLowerCase(), fn);
    const lab = String(f.label || '').trim();
    if (lab) {
      aliasToName.set(lab.toLowerCase(), fn);
      const slug = lab.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (slug) aliasToName.set(slug, fn);
    }
    const tail = lastBracketSegment(fn);
    if (tail) aliasToName.set(tail.toLowerCase(), fn);
  }

  const out = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (v == null || String(v).trim() === '') continue;
    const val = String(v).trim();
    const ks = String(k).trim();
    if (nameSet.has(ks)) {
      out[ks] = val;
      continue;
    }
    const kl = ks.toLowerCase();
    const slug = kl.replace(/[^a-z0-9]+/g, '');
    const canon = aliasToName.get(kl) || aliasToName.get(slug);
    if (canon) {
      out[canon] = val;
    }
  }
  return out;
}

/**
 * Ask the AI to suggest values for a set of NosPos form fields.
 * Called after the final category is committed and NosPos has returned
 * the fully-populated form snapshot.
 *
 * @param {object}       params
 * @param {ItemSummary}  params.item    - Summarised item details
 * @param {FieldEntry[]} params.fields  - Fields to fill (already filtered)
 * @returns {Promise<{ fields: Record<string, string> }>}
 */
export async function suggestFieldValues({ item, fields }) {
  const res = await fetch(FIELDS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    body: JSON.stringify({ item, fields }),
  });

  if (!res.ok) {
    let msg = `AI field suggestion failed (${res.status})`;
    try { const err = await res.json(); msg = err.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  return res.json();
}
