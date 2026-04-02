import {
  isJewelleryCoinLine,
  isJewelleryCoinSilverOzLine,
} from '@/components/jewellery/jewelleryNegotiationCart';
import {
  buildItemSpecs,
  getDisplayOffers,
  resolveOurSalePrice,
} from './negotiationHelpers';

const TROY_OZ_GRAMS = 31.1034768;
const AV_OZ_GRAMS = 28.3495;

function isNosposCategoryField(f) {
  return /\[category\]/i.test(f?.name || '') || String(f?.label || '').toLowerCase() === 'category';
}

function normalizeMatchKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Last `[segment]` in a form control name, e.g. DraftAgreementItem[1][colour] → colour */
function lastFormNameSegment(fieldName) {
  const m = String(fieldName || '').match(/\[([^\[\]]+)\]\s*$/);
  return m ? m[1] : '';
}

/**
 * Map our attribute text to the NosPos `<select>` option value when options exist (value is often an id).
 */
function resolvePrefillValueForField(field, displayValue) {
  const raw = String(displayValue ?? '').trim();
  if (!raw) return raw;
  if (field.control !== 'select' || !Array.isArray(field.options) || !field.options.length) {
    return raw;
  }
  const norm = normalizeMatchKey(raw);
  for (const o of field.options) {
    const t = String(o.text ?? '').replace(/\s+/g, ' ').trim();
    const tv = String(o.value ?? '').trim();
    if (raw === t || raw === tv) return tv !== '' ? tv : t;
  }
  for (const o of field.options) {
    const t = String(o.text ?? '').replace(/\s+/g, ' ').trim();
    const tv = String(o.value ?? '').trim();
    if (normalizeMatchKey(t) === norm || normalizeMatchKey(tv) === norm) return tv !== '' ? tv : t;
  }
  const rawLower = raw.toLowerCase();
  for (const o of field.options) {
    const t = String(o.text ?? '').replace(/\s+/g, ' ').trim();
    const tv = String(o.value ?? '').trim();
    const tl = t.toLowerCase();
    if (tl && (tl === rawLower || tl.includes(rawLower) || rawLower.includes(tl))) return tv !== '' ? tv : t;
  }
  return raw;
}

function humanizeCodeAsFallback(code) {
  if (code == null) return '';
  const s = String(code).replace(/_/g, ' ').trim();
  if (!s) return String(code);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Same labels as AttributeConfiguration dropdowns: `attributeLabels[code]` === `attr.name` (API label).
 * Keys are never derived from title-cased codes or spec keys — always code → builder label lookup.
 */
function buildBuilderStyleAttributesLog(item) {
  if (!item) return {};
  const labels = item.attributeLabels || {};
  const av = item.attributeValues || {};
  const out = {};

  for (const [code, val] of Object.entries(av)) {
    if (val == null || String(val).trim() === '') continue;
    const name = labels[code] || humanizeCodeAsFallback(code);
    out[name] = String(val).trim();
  }

  if (item.isJewelleryItem) {
    const ref = item.referenceData || {};
    const pairs = [
      ['Material grade', ref.material_grade],
      ['Product', ref.product_name],
      ['Category', ref.category_label],
      ['Stone', ref.stone],
      ['Finger size', ref.finger_size],
      ['Carat', ref.carat],
      ['Hallmark', ref.hallmark],
      ['Item name', ref.item_name],
    ];
    for (const [k, v] of pairs) {
      if (v == null || String(v).trim() === '') continue;
      out[k] = String(v).trim();
    }
  }

  const specs = item.cexProductData?.specifications;
  if (specs && typeof specs === 'object' && item.isCustomCeXItem) {
    for (const [k, v] of Object.entries(specs)) {
      if (v == null || String(v).trim() === '') continue;
      if (out[k] !== undefined) continue;
      out[k] = String(v).trim();
    }
  }

  return out;
}

/** DraftAgreementItem / stock fields — category excluded. */
export function inferNosposMirrorFieldRole(field) {
  if (isNosposCategoryField(field)) return 'category';
  const n = field.name || '';
  const lab = String(field.label || '').toLowerCase();

  if (/\[name\]$/.test(n) && !/(category|subcategory|producttype|type_name)/i.test(n)) return 'item_name';
  if ((lab === 'item name' || lab === 'name') && !/category/i.test(n)) return 'item_name';

  if (/\[quantity\]$/.test(n) || lab === 'quantity') return 'quantity';

  if (/\[retail_price\]$/.test(n) || (lab.includes('retail') && lab.includes('price'))) {
    return 'retail_price';
  }

  if (
    /\[bought_for\]$/.test(n) ||
    /\bbought\s*for\b/i.test(lab) ||
    (lab.includes('offer') && (lab.includes('£') || lab.includes('gbp')))
  ) {
    return 'offer';
  }

  // Gram-weight only. NosPos uses StockSpecification[…] for many specs (Storage, Colour, …) — do not treat all as weight.
  if (
    lab.includes('weight') &&
    (/\(g\)/i.test(lab) || /\bgrams?\b/i.test(lab))
  ) {
    return 'weight_g';
  }

  return 'other';
}

function parseNumericWeight(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Jewellery negotiation row → grams for NosPos "Weight (g)" style fields.
 * Silver coin lines: one unit = 1 troy oz. Other coin lines: no guess unless a non-each unit is present.
 */
export function jewelleryWeightGramsForNospos(item) {
  if (!item?.isJewelleryItem) return null;
  const ref = item.referenceData || {};
  const probe = {
    productName: ref.product_name,
    materialGrade: ref.material_grade,
  };
  const coin = isJewelleryCoinLine(probe);
  const silverOz = isJewelleryCoinSilverOzLine(probe);

  const unitRaw = String(ref.weight_unit || 'g').toLowerCase().trim();
  const n = parseNumericWeight(ref.weight);

  if (silverOz && (unitRaw === 'each' || coin)) {
    const units = n != null && n > 0 ? n : 1;
    const g = units * TROY_OZ_GRAMS;
    return String(Math.round(g * 1000) / 1000);
  }

  if (coin && !silverOz) {
    if (n != null && unitRaw && unitRaw !== 'each') {
      return convertWeightToGramsString(n, unitRaw, { preferTroy: false });
    }
    return null;
  }

  if (unitRaw === 'each' && !coin) {
    return null;
  }

  if (n == null) return null;

  const preferTroy =
    unitRaw.includes('troy') || unitRaw === 't oz' || unitRaw === 'toz' || unitRaw === 'oz t';
  if (unitRaw === 'g' || unitRaw === 'gram' || unitRaw === 'grams' || unitRaw === '') {
    return String(Math.round(n * 1000) / 1000);
  }
  return convertWeightToGramsString(n, unitRaw, { preferTroy });
}

function convertWeightToGramsString(value, unitRaw, { preferTroy }) {
  const u = unitRaw.toLowerCase().trim();
  if (u === 'g' || u === 'gram' || u === 'grams') {
    return String(Math.round(value * 1000) / 1000);
  }
  if (u === 'kg') {
    return String(Math.round(value * 1000 * 1000) / 1000);
  }
  if (u.includes('troy') || u === 't oz' || u === 'toz' || u === 'oz t') {
    return String(Math.round(value * TROY_OZ_GRAMS * 1000) / 1000);
  }
  if (u === 'oz' || u.endsWith(' oz')) {
    const factor = preferTroy ? TROY_OZ_GRAMS : AV_OZ_GRAMS;
    return String(Math.round(value * factor * 1000) / 1000);
  }
  return null;
}

function resolveSelectedOfferPerUnit(item, useVoucherOffers) {
  if (!item) return null;
  if (item.selectedOfferId === 'manual' && item.manualOffer) {
    const n = parseFloat(String(item.manualOffer).replace(/[£,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const offers = getDisplayOffers(item, useVoucherOffers);
  const sel = offers?.find((o) => o.id === item.selectedOfferId);
  return sel != null && Number.isFinite(Number(sel.price)) ? Number(sel.price) : null;
}

function itemDisplayName(item) {
  if (!item) return 'Item';
  const ref = item.referenceData || {};
  if (item.isJewelleryItem) {
    const n =
      ref.item_name ||
      ref.line_title ||
      ref.reference_display_name ||
      ref.product_name;
    if (n) return String(n).trim();
  }
  const v = item.variantName || item.title;
  return String(v || 'Item').trim() || 'Item';
}

function buildAttributeEntriesForMatching(item) {
  if (!item) return [];
  const entries = [];
  const seen = new Set();

  const push = (k, v) => {
    if (v == null) return;
    const s = String(v).trim();
    if (!s) return;
    const key = String(k).trim();
    if (!key) return;
    const sig = `${normalizeMatchKey(key)}\0${s}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    entries.push([key, s]);
  };

  if (item.isJewelleryItem) {
    const ref = item.referenceData || {};
    const pairs = [
      ['Material grade', ref.material_grade],
      ['Material', ref.material_grade],
      ['Product', ref.product_name],
      ['Category', ref.category_label],
      ['Stone', ref.stone],
      ['Finger size', ref.finger_size],
      ['Carat', ref.carat],
      ['Hallmark', ref.hallmark],
      ['Item name', ref.item_name],
    ];
    for (const [k, v] of pairs) {
      push(k, v);
    }
  }

  const labels = item.attributeLabels || {};
  if (item.attributeValues) {
    for (const [code, v] of Object.entries(item.attributeValues)) {
      if (v == null || String(v).trim() === '') continue;
      const builderLabel = labels[code];
      if (builderLabel) push(builderLabel, v);
      push(code, v);
      const cap = code.charAt(0).toUpperCase() + code.slice(1);
      if (cap !== code) push(cap, v);
      const human = humanizeCodeAsFallback(code);
      if (human && human !== code && human !== cap && human !== builderLabel) push(human, v);
    }
  }

  const specs = buildItemSpecs(item);
  if (specs) {
    for (const [k, v] of Object.entries(specs)) {
      push(k, v);
    }
  }

  return entries;
}

/**
 * Generic score: how well a NosPos field (label + name segment) matches an attribute key.
 * Higher is better; no product-specific cases.
 */
function scoreFieldAgainstAttributeKey(fieldLabel, nameSegment, entryKey) {
  const fl = normalizeMatchKey(fieldLabel);
  const fs = normalizeMatchKey(nameSegment);
  const nk = normalizeMatchKey(entryKey);
  if (!nk) return 0;

  const candidates = [fl, fs].filter(Boolean);
  let best = 0;
  for (const f of candidates) {
    if (f === nk) best = Math.max(best, 1000);
    else if (f.length >= 2 && nk.length >= 2 && (f.includes(nk) || nk.includes(f))) {
      best = Math.max(best, 500 + Math.min(f.length, nk.length));
    }
  }
  if (best > 0) return best;

  const toks = new Set();
  for (const part of [fieldLabel, nameSegment.replace(/_/g, ' ')]) {
    for (const t of String(part).toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3) toks.add(t);
    }
  }
  const keyToks = String(entryKey)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  let overlap = 0;
  for (const t of keyToks) {
    if (toks.has(t)) overlap++;
  }
  if (overlap > 0) return 100 + overlap * 50;

  return best;
}

const MIN_ATTRIBUTE_MATCH_SCORE = 80;

function findBestAttributeMatch(field, entries) {
  const label = field.label || '';
  const seg = lastFormNameSegment(field.name || '');
  const segPretty = /^\d+$/.test(seg) ? '' : seg.replace(/_/g, ' ');

  let bestValue = null;
  let bestKey = null;
  let bestScore = 0;

  for (const [k, v] of entries) {
    const sLabel = scoreFieldAgainstAttributeKey(label, segPretty, k);
    const sSeg = scoreFieldAgainstAttributeKey(label, seg, k);
    const s = Math.max(sLabel, sSeg);
    if (s > bestScore) {
      bestScore = s;
      bestValue = v;
      bestKey = k;
    }
  }

  if (bestScore < MIN_ATTRIBUTE_MATCH_SCORE) return null;
  return { value: bestValue, matchedKey: bestKey, score: bestScore };
}

function buildPrefillForCard(item, card, useVoucherOffers) {
  const out = {};
  const fields = card?.fields || [];
  const coreFilled = new Set();

  for (const f of fields) {
    if (!f?.name) continue;
    const role = inferNosposMirrorFieldRole(f);
    if (role === 'category') continue;

    let val = null;
    if (role === 'item_name') {
      val = itemDisplayName(item);
    } else if (role === 'quantity') {
      val = String(Math.max(1, Math.floor(Number(item.quantity)) || 1));
    } else if (role === 'retail_price') {
      const p = resolveOurSalePrice(item);
      val = p != null ? String(p) : '';
    } else if (role === 'offer') {
      const p = resolveSelectedOfferPerUnit(item, useVoucherOffers);
      val = p != null ? String(p) : '';
    } else if (role === 'weight_g') {
      const g = jewelleryWeightGramsForNospos(item);
      val = g != null ? g : null;
    }

    if (val != null && String(val).trim() !== '') {
      out[f.name] = String(val);
      coreFilled.add(f.name);
    }
  }

  const attrEntries = buildAttributeEntriesForMatching(item);
  const fieldMatchLog = [];

  for (const f of fields) {
    if (!f?.name) continue;
    if (coreFilled.has(f.name)) continue;
    const role = inferNosposMirrorFieldRole(f);
    if (role !== 'other') {
      fieldMatchLog.push({
        fieldName: f.name,
        label: f.label ?? '',
        role,
        action: 'skipped_role',
      });
      continue;
    }
    if (isNosposCategoryField(f)) {
      fieldMatchLog.push({
        fieldName: f.name,
        label: f.label ?? '',
        action: 'skipped_category',
      });
      continue;
    }

    const hit = findBestAttributeMatch(f, attrEntries);
    if (!hit || String(hit.value).trim() === '') {
      fieldMatchLog.push({
        fieldName: f.name,
        label: f.label ?? '',
        nameSegment: lastFormNameSegment(f.name || ''),
        action: 'no_match',
        minScore: MIN_ATTRIBUTE_MATCH_SCORE,
      });
      continue;
    }
    const resolved = resolvePrefillValueForField(f, hit.value);
    out[f.name] = String(resolved);
    fieldMatchLog.push({
      fieldName: f.name,
      label: f.label ?? '',
      nameSegment: lastFormNameSegment(f.name || ''),
      matchedAttributeKey: hit.matchedKey,
      score: hit.score,
      itemValue: String(hit.value),
      appliedValue: String(resolved),
      action: 'filled',
    });
  }

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('[CG Suite][NosPos mirror] Attribute match pass', {
      nosposCardTitle: card?.title,
      itemId: item?.id ?? null,
      requestItemId: item?.request_item_id ?? null,
      displayName: itemDisplayName(item),
      attributes: buildBuilderStyleAttributesLog(item),
      matchEntryKeys: [...new Set(attrEntries.map(([k]) => k))],
      fieldMatches: fieldMatchLog,
    });
  }

  return out;
}

/**
 * Map NosPos field names → values from negotiation lines (same card order: jewellery rows, then main rows).
 */
export function computeNosposMirrorPrefill(snapshot, sourceLines, useVoucherOffers) {
  const cards = snapshot?.cards || [];
  const out = {};
  for (let i = 0; i < cards.length; i++) {
    const item = sourceLines?.[i];
    if (!item) continue;
    Object.assign(out, buildPrefillForCard(item, cards[i], useVoucherOffers));
  }
  return out;
}
