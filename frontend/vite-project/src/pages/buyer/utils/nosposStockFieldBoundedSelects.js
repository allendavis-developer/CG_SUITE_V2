/**
 * NosPos stock fields whose agreement UI is a &lt;select&gt; with a fixed set of option **values**
 * (mirrors NosPos HTML). The category API does not ship these options — we keep them here so field-AI
 * only sees allowed values for matching labels.
 *
 * Jewellery "Carat / Hallmark" and weight are **not** listed here: Carat is preset via
 * `jewelleryNosposMaterialGradeMap` + `shouldSkipAiFill`, and other jewellery lines use free text / AI as today.
 */

/** @param {string} label */
function normLabelKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function optionsFromValues(values) {
  return values.map((v) => {
    const s = String(v).trim();
    return { value: s, text: s };
  });
}

/** Storage — option value strings from NosPos StockSpecification (example field 87677). */
const STORAGE_OPTION_VALUES = [
  '1GB',
  '1TB',
  '2GB',
  '2TB',
  '3TB',
  '4GB',
  '4TB',
  '5TB',
  '8GB',
  '16GB',
  '16MB',
  '32GB',
  '32MB',
  '64GB',
  '64MB',
  '80GB',
  '128GB',
  '128MB',
  '160GB',
  '220GB',
  '250GB',
  '256GB',
  '256MB',
  '500GB',
  '512GB',
  '512MB',
  '825GB',
];

/** Network — option value strings from NosPos (example field 87676). */
const NETWORK_OPTION_VALUES = [
  'Unlocked/Open',
  'EE',
  'Three',
  'O2',
  'Vodafone',
  'Other',
  'WIFI Only',
];

/** label key (trim, lower, single spaces) → option value list */
const LABEL_TO_OPTION_VALUES = {
  storage: STORAGE_OPTION_VALUES,
  network: NETWORK_OPTION_VALUES,
};

/**
 * If this linked field label uses a fixed NosPos &lt;select&gt;, return { options } for AI (`control: 'select'`).
 * @param {string} fieldLabel - `linkedField.name` from NosPos category mirror
 * @returns {{ options: { value: string, text: string }[] } | null}
 */
export function getBoundedNosposStockFieldSelect(fieldLabel) {
  const key = normLabelKey(fieldLabel);
  const values = LABEL_TO_OPTION_VALUES[key];
  if (!values?.length) return null;
  return { options: optionsFromValues(values) };
}

/**
 * Map model output to an exact option `value`; returns null if no safe match (caller should drop the fill).
 *
 * @param {unknown} raw
 * @param {{ value: string, text: string }[]} options
 * @returns {string|null}
 */
export function snapAiValueToBoundedSelectOptions(raw, options) {
  if (!options?.length) return null;
  const r0 = String(raw ?? '').trim();
  if (!r0) return null;
  const rNorm = r0.toLowerCase().replace(/\s+/g, '');

  for (const o of options) {
    const v = String(o.value ?? '').trim();
    const t = String(o.text ?? o.value ?? '').trim();
    if (!v && !t) continue;
    if (v === r0 || t === r0) return v;
    const vNorm = v.toLowerCase().replace(/\s+/g, '');
    const tNorm = t.toLowerCase().replace(/\s+/g, '');
    if (rNorm === vNorm || rNorm === tNorm) return v;
  }
  return null;
}
