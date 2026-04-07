/**
 * Central toggles for CG Suite buyer / negotiation behaviour.
 *
 * **ENABLE_NOSPOS_STOCK_FIELD_AI** — When `true`, after a NosPos stock category is known,
 * the app calls the suggest-fields AI (`buildNosposStockFieldAiPayload`) to pre-fill linked
 * NosPos fields on request items. When `false`, category AI and manual/parked fills still run;
 * only the per-field LLM suggestion is skipped.
 *
 * Change this one constant to turn field AI on or off (dev server pick-up: save file / refresh).
 */
export const ENABLE_NOSPOS_STOCK_FIELD_AI = false;
