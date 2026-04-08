/**
 * Maps our jewellery `referenceData.material_grade` (AttributeValue labels in DB)
 * to exact NoSpos "Carat / Hallmark" `<select>` option **values**.
 *
 * NoSpos options (reference): 8k (333), 9k (375), … Silver (925), Silver (999),
 * Plat (950), Pal (950), Base Metal / Other, etc.
 *
 * DB labels after migration 0039 and coin migrations:
 *   9ct gold, 14ct gold, 18ct gold, 22ct gold, 24ct gold,
 *   Silver, Platinum, Palladium,
 *   Full Sovereign, Half Sovereign, Krugerrand (coin lines).
 *
 * Legacy scrape labels (pre-0039 / backfill) are included with lowercase keys.
 */
const ENTRIES = [
  // —— Current DB labels (Jewellery category material_grade) ————————————
  ['9ct gold', '9k (375)'],
  ['14ct gold', '14k (585)'],
  ['18ct gold', '18k (750)'],
  ['22ct gold', '22k (916)'],
  ['24ct gold', '24k (999)'],
  ['silver', 'Silver (925)'],
  ['platinum', 'Plat (950)'],
  ['palladium', 'Pal (950)'],
  ['full sovereign', '22k (916)'],
  ['half sovereign', '22k (916)'],
  ['krugerrand', '22k (916)'],
];

/** @type {Readonly<Record<string, string>>} */
const NORMALIZED_TO_NOSPOS = Object.fromEntries(
  ENTRIES.map(([k, v]) => [k.trim().toLowerCase(), v]),
);

/** Stable order for `<select>` options (matches typical NosPos carat list). */
const CARAT_HALLMARK_VALUE_ORDER = [
  '9k (375)',
  '14k (585)',
  '18k (750)',
  '22k (916)',
  '24k (999)',
  'Silver (925)',
  'Plat (950)',
  'Pal (950)',
];

const VALUE_ORDER_IDX = new Map(CARAT_HALLMARK_VALUE_ORDER.map((v, i) => [v, i]));

/** Unique NosPos option `value`s derived from {@link ENTRIES} only (single source of truth). */
function uniqueCaratHallmarkNosposValuesFromEntries() {
  return [...new Set(ENTRIES.map(([, v]) => v))];
}

/**
 * NosPos "Carat / Hallmark" options for field-AI (`control: 'select'`) — same values the material-grade map resolves to.
 * @returns {{ value: string, text: string }[]}
 */
export function nosposCaratHallmarkSelectOptions() {
  const sorted = uniqueCaratHallmarkNosposValuesFromEntries().sort(
    (a, b) => (VALUE_ORDER_IDX.get(a) ?? 999) - (VALUE_ORDER_IDX.get(b) ?? 999),
  );
  return sorted.map((v) => ({ value: v, text: v }));
}

/** Linked-field label is the NosPos Carat / Hallmark control (spacing/case-insensitive). */
export function isNosposCaratHallmarkStockFieldLabel(label) {
  return /carat\s*\/\s*hallmark/i.test(String(label ?? '').trim());
}

/**
 * @param {string} materialGrade - raw `referenceData.material_grade`
 * @returns {string|null} exact NoSpos option value, or null if unmapped
 */
export function nosposCaratHallmarkValueForMaterialGrade(materialGrade) {
  if (materialGrade == null) return null;
  const key = String(materialGrade).trim().toLowerCase();
  if (!key) return null;
  return NORMALIZED_TO_NOSPOS[key] ?? null;
}
