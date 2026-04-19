/**
 * Reusable AI-driven category path completion (same backend as NosPos mirror / request item).
 * Uses {@link suggestNosposCategory} at each hierarchy level.
 */

import { suggestNosposCategory } from './aiCategoryService';
import { fetchAllCategoriesFlat, fetchNosposCategories, fetchCashGeneratorRetailCategories } from './api';
import { flatCategoriesToNestedRoots } from '@/utils/categoryPickerTree';

/**
 * Walk `parent_category_id` to the DB root and return whether that root is `ready_for_builder`.
 * Negotiation only runs {@link runNosposStockCategoryAiMatchBackground} when this is true; the extension
 * picker may still invoke the cascade for any internal category.
 *
 * @param {Array<{ category_id: number, parent_category_id: number|null, ready_for_builder?: boolean }>} flat - from `/all-categories/`
 * @param {number} categoryId - selected leaf (or any) internal category id
 * @returns {{ rootCategoryId: number, rootName: string|null, ready_for_builder: boolean }|null}
 */
export function getInternalProductCategoryRootMeta(flat, categoryId) {
  if (!Array.isArray(flat) || flat.length === 0 || categoryId == null) return null;
  const byId = new Map(flat.map((r) => [r.category_id, r]));
  let id = categoryId;
  let step = 0;
  while (id != null && step++ < 500) {
    const row = byId.get(id);
    if (!row) return null;
    if (row.parent_category_id == null) {
      return {
        rootCategoryId: id,
        rootName: row.name != null ? String(row.name) : null,
        ready_for_builder: row.ready_for_builder === true,
      };
    }
    id = row.parent_category_id;
  }
  return null;
}

/**
 * @returns {boolean}
 */
export function isProductCategoryRootReadyForBuilder(flat, categoryId) {
  const m = getInternalProductCategoryRootMeta(flat, categoryId);
  return Boolean(m?.ready_for_builder);
}

/** Last segment of a NosPos-style `fullName` ("A > B > C" → "C"). */
function lastSegmentOfPath(fullName) {
  const parts = String(fullName || '')
    .split(/\s*>\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(fullName || '').trim();
}

/**
 * Build `{ category_id, name, children, nosposId, fullName }[]` roots from GET /nospos-categories/ `results`.
 * Each level only sees its children’s `name` (last path segment), matching the mirror / AI contract.
 *
 * @param {Array<{ nosposId: number, parentNosposId: number|null, fullName: string, level?: number }>} results
 * @returns {object[]}
 */
export function nosposApiResultsToAiTreeRoots(results) {
  const rows = Array.isArray(results) ? results : [];
  const byId = new Map();

  for (const r of rows) {
    const nid = r.nosposId;
    if (nid == null || Number(nid) <= 0) continue;
    byId.set(Number(nid), {
      category_id: Number(nid),
      nosposId: Number(nid),
      fullName: String(r.fullName || '').trim(),
      name: lastSegmentOfPath(r.fullName),
      level: r.level,
      children: [],
    });
  }

  const roots = [];
  for (const r of rows) {
    const nid = r.nosposId;
    if (nid == null || !byId.has(Number(nid))) continue;
    const node = byId.get(Number(nid));
    const pid = r.parentNosposId;
    if (pid == null || !byId.has(Number(pid))) {
      roots.push(node);
    } else {
      byId.get(Number(pid)).children.push(node);
    }
  }

  const sortName = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  function sortRec(n) {
    n.children.sort(sortName);
    n.children.forEach(sortRec);
  }
  roots.sort(sortName);
  roots.forEach(sortRec);

  return roots;
}

/**
 * Build the item payload expected by /api/ai/suggest-category/.
 * Kept in sync with negotiation / request-item shapes.
 *
 * @param {object|null|undefined} item
 * @returns {import('./aiCategoryService').ItemSummary}
 */
export function summariseNegotiationItemForAi(item) {
  if (!item) {
    return { name: 'Unknown item', dbCategory: null, attributes: {} };
  }
  const ref = item.referenceData || {};
  const cexProductTitle =
    item.isCustomCeXItem && item.cexProductData && typeof item.cexProductData === 'object'
      ? String(item.cexProductData.title || item.cexProductData.modelName || '').trim()
      : '';
  const name = item.isJewelleryItem
    ? (ref.item_name || ref.line_title || ref.reference_display_name || ref.product_name || item.variantName || item.title || 'Unknown item')
    : item.isCustomCeXItem
      ? (
          item.title ||
          cexProductTitle ||
          item.variantName ||
          ref.product_name ||
          item.subtitle ||
          'Unknown item'
        )
      : (item.variantName || item.title || ref.product_name || item.subtitle || 'Unknown item');
  const dbCategory =
    item.categoryName ||
    item.category ||
    ref.category_label ||
    (Array.isArray(item.categoryObject?.path) ? item.categoryObject.path.join(' > ') : null) ||
    item.categoryObject?.name ||
    null;

  const attributes = {};
  const labels = item.attributeLabels || {};
  for (const [code, val] of Object.entries(item.attributeValues || {})) {
    if (val != null && String(val).trim()) attributes[labels[code] || code] = String(val).trim();
  }

  // Saved negotiation rows / API mapping: attributes sometimes only live on variant_details.
  const vd = item.variant_details;
  if (vd && typeof vd === 'object') {
    const vdVals = vd.attribute_values ?? vd.attributeValues;
    const vdLabs = vd.attribute_labels ?? vd.attributeLabels ?? {};
    if (vdVals && typeof vdVals === 'object') {
      for (const [code, val] of Object.entries(vdVals)) {
        if (val == null || !String(val).trim()) continue;
        const key = String(vdLabs[code] || labels[code] || code).trim();
        if (!key) continue;
        if (attributes[key] === undefined) attributes[key] = String(val).trim();
      }
    }
  }

  // CeX variant price blob — specifications / attribute_values may duplicate or extend cart attrs.
  const refAttrVals = ref.attribute_values ?? ref.attributeValues;
  const refAttrLabs = ref.attribute_labels ?? ref.attributeLabels ?? {};
  if (refAttrVals && typeof refAttrVals === 'object') {
    for (const [code, val] of Object.entries(refAttrVals)) {
      if (val == null || !String(val).trim()) continue;
      const key = String(refAttrLabs[code] || labels[code] || code).trim();
      if (!key) continue;
      if (attributes[key] === undefined) attributes[key] = String(val).trim();
    }
  }
  const refSpecs = ref.specifications ?? ref.specs;
  if (refSpecs && typeof refSpecs === 'object') {
    for (const [k, v] of Object.entries(refSpecs)) {
      if (v == null || !String(v).trim()) continue;
      const key = String(k).trim();
      if (!key || attributes[key] !== undefined) continue;
      attributes[key] = String(v).trim();
    }
  }

  if (item.isJewelleryItem) {
    for (const [k, v] of [
      ['Material grade', ref.material_grade],
      ['Product', ref.product_name],
      ['Stone', ref.stone],
      ['Finger size', ref.finger_size],
      ['Carat', ref.carat],
      ['Hallmark', ref.hallmark],
    ]) {
      if (v != null && String(v).trim()) attributes[k] = String(v).trim();
    }
  }
  if (item.isCustomCeXItem) {
    for (const [k, v] of Object.entries(item.cexProductData?.specifications || {})) {
      if (v != null && String(v).trim() && attributes[k] === undefined) attributes[k] = String(v).trim();
    }
  }

  return {
    name: String(name).trim(),
    dbCategory: dbCategory != null && String(dbCategory).trim() !== '' ? String(dbCategory).trim() : null,
    attributes,
  };
}

function buildInternalCategoryObjectFromFlatRow(row, fallbackPath = []) {
  if (!row || row.category_id == null) return null;
  const path = String(row.path || '')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: row.category_id,
    name: row.name,
    path: path.length ? path : fallbackPath,
  };
}

/**
 * Same internal product-category AI cascade used by the eBay category picker,
 * exposed for non-picker flows like Add from CeX.
 *
 * @param {object} params
 * @param {object|null} [params.item]
 * @param {import('./aiCategoryService').ItemSummary|null} [params.itemSummary]
 * @param {Array<{ category_id: number, name: string, path?: string }>|null} [params.allCategoriesFlat]
 * @param {string} [params.logTag]
 * @returns {Promise<{ categoryObject: { id: number, name: string, path: string[] }, itemSummary: import('./aiCategoryService').ItemSummary, flat: object[] }|null>}
 */
export async function resolveInternalProductCategoryByAi({
  item = null,
  itemSummary = null,
  allCategoriesFlat = null,
  logTag = '[CG Suite][AiCategory][InternalProductResolver]',
}) {
  const summary = itemSummary || summariseNegotiationItemForAi(item);
  let flat = allCategoriesFlat;
  if (!Array.isArray(flat) || flat.length === 0) {
    flat = await fetchAllCategoriesFlat();
  }
  if (!Array.isArray(flat) || flat.length === 0) return null;

  const roots = flatCategoriesToNestedRoots(flat);
  if (!Array.isArray(roots) || roots.length === 0) return null;

  const res = await runAiCategoryCascadeArrayTree({
    rootNodes: roots,
    itemSummary: summary,
    startPath: [],
    logTag,
  });
  if (!res.success || !res.leaf?.category_id) return null;

  const row = flat.find((entry) => Number(entry.category_id) === Number(res.leaf.category_id));
  const categoryObject = buildInternalCategoryObjectFromFlatRow(row, res.path);
  if (!categoryObject?.id) return null;

  return {
    categoryObject,
    itemSummary: summary,
    flat,
  };
}

/**
 * @param {{ name: string, children?: unknown[] }} children
 * @param {string} suggested
 */
function pickChildByAiSuggestion(children, suggested) {
  if (!suggested || !children?.length) return null;
  const s = String(suggested).trim();
  let c = children.find((x) => x.name === s);
  if (c) return c;
  const sl = s.toLowerCase();
  c = children.find((x) => String(x.name || '').toLowerCase() === sl);
  return c || null;
}

function findArrayTreeNodeAtPath(roots, segments) {
  let current = null;
  let list = roots;
  for (const seg of segments) {
    const next =
      list.find((n) => n.name === seg) ||
      list.find((n) => String(n.name || '').toLowerCase() === String(seg).toLowerCase());
    if (!next) return null;
    current = next;
    list = next.children || [];
  }
  return current;
}

/**
 * Walk a ProductCategory-style tree: nodes `{ category_id, name, children: [] }`.
 *
 * @param {object} params
 * @param {object[]} params.rootNodes
 * @param {import('./aiCategoryService').ItemSummary} params.itemSummary
 * @param {string[]} [params.startPath]
 * @param {string} [params.logTag]
 * @returns {Promise<{ success: boolean, path: string[], leaf?: object, error?: Error }>}
 */
export async function runAiCategoryCascadeArrayTree({
  rootNodes,
  itemSummary,
  startPath = [],
  logTag = '[CG Suite][AiCategory][InternalProductTree]',
  quiet = false,
}) {
  if (!quiet) {
    console.log(logTag, 'start', {
      itemSummary,
      startPath,
      rootCount: rootNodes?.length ?? 0,
    });
  }

  let pathSegments = [...startPath];
  let current = startPath.length ? findArrayTreeNodeAtPath(rootNodes, startPath) : null;

  if (startPath.length && !current) {
    const err = new Error('Invalid start path for product category tree');
    if (!quiet) console.log(logTag, 'invalid startPath', { startPath });
    return { success: false, path: pathSegments, error: err };
  }

  let childList = current ? (current.children || []) : rootNodes || [];

  try {
    while (childList.length > 0) {
      const levelIndex = pathSegments.length;
      const availableOptions = [...new Set(childList.map((c) => c.name).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      );
      if (!quiet) {
        console.log(logTag, 'suggest request', {
          levelIndex,
          availableOptions,
          previousPath: pathSegments,
        });
      }

      const result = await suggestNosposCategory({
        item: itemSummary,
        levelIndex,
        availableOptions,
        previousPath: pathSegments,
      });

      if (!quiet) console.log(logTag, 'suggest response', result);

      const next = pickChildByAiSuggestion(childList, result.suggested);
      if (!next) {
        const err = new Error(`AI suggestion not in tree: ${result.suggested}`);
        if (!quiet) {
          console.log(logTag, 'no matching child', {
            suggested: result.suggested,
            availableOptions,
          });
        }
        return { success: false, path: pathSegments, error: err };
      }

      pathSegments = [...pathSegments, next.name];
      current = next;
      childList = next.children || [];
    }
  } catch (e) {
    if (!quiet) console.log(logTag, 'cascade error', e);
    return { success: false, path: pathSegments, error: e instanceof Error ? e : new Error(String(e)) };
  }

  if (!current) {
    if (!quiet) console.log(logTag, 'no leaf resolved');
    return { success: false, path: pathSegments, error: new Error('Empty tree') };
  }

  if (!quiet) {
    console.log(logTag, 'done', {
      path: pathSegments,
      leafId: current.category_id,
      leafName: current.name,
    });
  }

  return { success: true, path: pathSegments, leaf: current };
}

/** Max attempts (initial + retries) for level-by-level AI category walks (NosPos + CG retail). */
export const CATEGORY_AI_MAX_ATTEMPTS = 3;

/**
 * Load roots, run {@link runAiCategoryCascadeArrayTree}, retry on failure (same pattern as stock NosPos + CG).
 *
 * @param {object} params
 * @param {() => Promise<object[]>} params.loadRootNodes
 * @param {import('./aiCategoryService').ItemSummary} params.itemSummary
 * @param {string} [params.logTag]
 * @param {number} [params.maxAttempts]
 * @param {boolean} [params.quiet]
 * @returns {Promise<{ success: boolean, path: string[], leaf?: object, lastErrorMsg?: string }>}
 */
export async function runAiCategoryCascadeArrayTreeWithRetries({
  loadRootNodes,
  itemSummary,
  logTag = '[CG Suite][AiCategory][retries]',
  maxAttempts = CATEGORY_AI_MAX_ATTEMPTS,
  quiet = true,
}) {
  let lastErrorMsg = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    try {
      const rootNodes = await loadRootNodes();
      if (!Array.isArray(rootNodes) || rootNodes.length === 0) {
        lastErrorMsg = 'empty_tree';
        if (attempt < maxAttempts - 1) {
          console.warn(`${logTag} empty tree (${attempt + 1}/${maxAttempts}), retrying…`);
        }
        continue;
      }
      const res = await runAiCategoryCascadeArrayTree({
        rootNodes,
        itemSummary,
        startPath: [],
        logTag: `${logTag}[try${attempt + 1}]`,
        quiet,
      });
      if (res.success && res.leaf) {
        return { success: true, path: res.path || [], leaf: res.leaf };
      }
      lastErrorMsg = res.error?.message ?? 'cascade_incomplete';
      if (attempt < maxAttempts - 1) {
        console.warn(`${logTag} category AI incomplete (${attempt + 1}/${maxAttempts}), retrying…`, lastErrorMsg);
      }
    } catch (e) {
      lastErrorMsg = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts - 1) {
        console.warn(`${logTag} category AI error (${attempt + 1}/${maxAttempts}), retrying…`, lastErrorMsg);
      }
    }
  }
  return { success: false, path: [], leaf: undefined, lastErrorMsg };
}

/**
 * Build `{ category_id, name, children, fullName }[]` roots from GET /cash-generator/retail-categories/ rows.
 *
 * @param {Array<{ cgCategoryId?: number, categoryName?: string, categoryPath?: string, parentCategoryId?: number|null }>} rows
 * @returns {object[]}
 */
export function cgFlatRowsToAiTreeRoots(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map();
  for (const r of list) {
    const id = Number(r.cgCategoryId ?? r.cg_category_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(r.categoryName || '').trim();
    if (!name) continue;
    byId.set(id, {
      category_id: id,
      name,
      fullName: String(r.categoryPath || name).trim(),
      children: [],
    });
  }
  for (const node of byId.values()) {
    node.children = [];
  }
  const roots = [];
  for (const r of list) {
    const id = Number(r.cgCategoryId ?? r.cg_category_id);
    if (!Number.isFinite(id) || !byId.has(id)) continue;
    const node = byId.get(id);
    const pid = r.parentCategoryId ?? r.parent_category_id;
    if (pid == null || !Number.isFinite(Number(pid)) || !byId.has(Number(pid))) {
      roots.push(node);
    } else {
      byId.get(Number(pid)).children.push(node);
    }
  }
  const sortName = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  function sortRec(n) {
    n.children.sort(sortName);
    n.children.forEach(sortRec);
  }
  roots.sort(sortName);
  roots.forEach(sortRec);
  return roots;
}

/**
 * Walk CG retail categories (cg_categories) with the same per-level AI as NosPos stock.
 *
 * @param {object} params
 * @param {import('./aiCategoryService').ItemSummary} params.itemSummary
 * @param {string} [params.logTag]
 * @returns {Promise<{ cgCategoryId: number, categoryPath: string, pathSegments: string[]|null }|null>}
 */
export async function runCgStockCategoryAiMatchBackground({
  itemSummary,
  logTag = '[CG Suite][CgPathMatch][background]',
}) {
  const itemName = itemSummary?.name ?? null;
  const cascade = await runAiCategoryCascadeArrayTreeWithRetries({
    itemSummary,
    async loadRootNodes() {
      const data = await fetchCashGeneratorRetailCategories();
      const rowList = Array.isArray(data?.rows) ? data.rows : [];
      return cgFlatRowsToAiTreeRoots(rowList);
    },
    logTag,
    maxAttempts: CATEGORY_AI_MAX_ATTEMPTS,
    quiet: true,
  });
  if (!cascade.success || !cascade.leaf) {
    console.log('[CG Suite][CgPathMatch] category', {
      context: logTag,
      item: itemName,
      outcome: 'failed_after_retries',
      error: cascade.lastErrorMsg ?? null,
    });
    return null;
  }
  const leaf = cascade.leaf;
  return {
    cgCategoryId: leaf.category_id,
    categoryPath: leaf.fullName || (cascade.path || []).join(' › '),
    pathSegments: Array.isArray(cascade.path) ? cascade.path : null,
  };
}

/**
 * NosPos mirror option tree: root `{ children: Map<string, Node>, leafValues: [] }`.
 *
 * @param {object} params
 * @param {object} params.tree
 * @param {import('./aiCategoryService').ItemSummary} params.itemSummary
 * @param {string[]} [params.startPath]
 * @param {string} [params.logTag]
 * @returns {Promise<{ success: boolean, path: string[], leafNode?: object, error?: Error }>}
 */
export async function runAiCategoryCascadeMapTree({
  tree,
  itemSummary,
  startPath = [],
  logTag = '[CG Suite][AiCategory][NosposMapTree]',
  quiet = false,
}) {
  if (!quiet) console.log(logTag, 'start', { itemSummary, startPath });

  let currentPath = [...startPath];
  let node = tree;

  for (const seg of currentPath) {
    node = node.children.get(seg);
    if (!node) {
      if (!quiet) console.log(logTag, 'invalid startPath segment', seg);
      return { success: false, path: currentPath, error: new Error('invalid start path') };
    }
  }

  try {
    while (node.children.size > 0) {
      const levelIndex = currentPath.length;
      const availableOptions = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
      if (!quiet) {
        console.log(logTag, 'suggest request', {
          levelIndex,
          availableOptions,
          previousPath: currentPath,
        });
      }

      const result = await suggestNosposCategory({
        item: itemSummary,
        levelIndex,
        availableOptions,
        previousPath: currentPath,
      });

      if (!quiet) console.log(logTag, 'suggest response', result);

      const nextNode = node.children.get(result.suggested);
      if (!nextNode) {
        if (!quiet) console.log(logTag, 'missing child', { suggested: result.suggested });
        return { success: false, path: currentPath, error: new Error('AI suggestion missing') };
      }

      currentPath = [...currentPath, result.suggested];
      node = nextNode;
    }
  } catch (e) {
    if (!quiet) console.log(logTag, 'cascade error', e);
    return { success: false, path: currentPath, error: e instanceof Error ? e : new Error(String(e)) };
  }

  if (!quiet) console.log(logTag, 'done', { path: currentPath });
  return { success: true, path: currentPath, leafNode: node };
}

function logNosposPathCategoryOnce({
  logTag,
  itemName,
  internalCategoryId,
  productCategoryRoot,
  outcome,
  nospos = null,
  error = null,
}) {
  console.log('[CG Suite][NosposPathMatch] category', {
    context: logTag,
    item: itemName ?? null,
    internalCategoryId: internalCategoryId ?? null,
    productCategoryRoot,
    outcome,
    nospos,
    error,
  });
}

/**
 * Same level-by-level AI as the eBay extension category picker: walk the NosposCategory tree
 * using {@link suggestNosposCategory} at each depth. Fire-and-forget from UI; results are for
 * persistence / mirror prefill only.
 *
 * @param {object} params
 * @param {number|null|undefined} params.internalCategoryId - ProductCategory id (leaf or any ancestor)
 * @param {import('./aiCategoryService').ItemSummary} params.itemSummary
 * @param {Array<{ category_id: number, parent_category_id: number|null, ready_for_builder?: boolean }>|null} [params.allCategoriesFlat]
 * @param {string} [params.logTag]
 * @returns {Promise<{ nosposId: number, fullName: string, pathSegments: string[]|null }|null>}
 *   Retries use {@link CATEGORY_AI_MAX_ATTEMPTS}.
 */
export async function runNosposStockCategoryAiMatchBackground({
  internalCategoryId,
  itemSummary,
  allCategoriesFlat = null,
  logTag = '[CG Suite][NosposPathMatch][background]',
}) {
  const itemName = itemSummary?.name ?? null;
  let flat = allCategoriesFlat;
  if (!Array.isArray(flat) || flat.length === 0) {
    try {
      flat = await fetchAllCategoriesFlat();
    } catch (e) {
      logNosposPathCategoryOnce({
        logTag,
        itemName,
        internalCategoryId,
        productCategoryRoot: null,
        outcome: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }
  const productCategoryRoot =
    internalCategoryId != null ? getInternalProductCategoryRootMeta(flat, internalCategoryId) : null;

  const cascade = await runAiCategoryCascadeArrayTreeWithRetries({
    itemSummary,
    async loadRootNodes() {
      const data = await fetchNosposCategories();
      const results = Array.isArray(data?.results) ? data.results : [];
      return nosposApiResultsToAiTreeRoots(results);
    },
    logTag: `${logTag}[perLevel]`,
    maxAttempts: CATEGORY_AI_MAX_ATTEMPTS,
    quiet: true,
  });

  if (!cascade.success || !cascade.leaf) {
    logNosposPathCategoryOnce({
      logTag,
      itemName,
      internalCategoryId,
      productCategoryRoot,
      outcome: 'failed_after_retries',
      error: cascade.lastErrorMsg,
    });
    return null;
  }

  const res = cascade;
  const fullName = res.leaf.fullName || (res.path || []).join(' › ');
  const nosposId = res.leaf.nosposId ?? res.leaf.category_id;
  const pathSegments = Array.isArray(res.path) ? res.path : null;
  logNosposPathCategoryOnce({
    logTag,
    itemName,
    internalCategoryId,
    productCategoryRoot,
    outcome: 'matched',
    nospos: { nosposId, fullName, pathSegments },
  });
  return {
    nosposId,
    fullName,
    pathSegments,
  };
}
