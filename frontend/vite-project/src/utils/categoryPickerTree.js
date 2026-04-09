/**
 * Tree helpers for hierarchical category pickers (eBay DB tree, NosPos API tree).
 */

/** Build nested `{ category_id, name, children }` from `/all-categories/` (flat) for eBay/CC pickers. */
export function flatCategoriesToNestedRoots(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const byId = new Map();
  for (const row of flat) {
    const id = row.category_id;
    if (id == null) continue;
    byId.set(id, {
      category_id: id,
      name: row.name,
      parent_category_id: row.parent_category_id ?? null,
      children: [],
    });
  }
  const roots = [];
  for (const node of byId.values()) {
    const pid = node.parent_category_id;
    if (pid == null || !byId.has(pid)) {
      roots.push(node);
    } else {
      byId.get(pid).children.push(node);
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

/** Placeholder DB row named "eBay" — used for skip/default margins; not listed in the picker. */
export function ebayPickerFilterChildren(nodes) {
  return (nodes || []).filter((c) => String(c.name || '').trim().toLowerCase() !== 'ebay');
}

/**
 * Every tree node with `pathNodes` / `pathNames` from root → node (same object refs as the nested tree).
 * @param {object[]} roots
 * @param {(nodes: object[]) => object[]} filterChildren - trim children at each level (e.g. ebayPickerFilterChildren)
 */
export function flattenCategoryTreeWithPaths(roots, filterChildren = (x) => x) {
  const rows = [];
  function walk(node, ancestorNodes) {
    const pathNodes = [...ancestorNodes, node];
    rows.push({
      node,
      pathNodes,
      pathNames: pathNodes.map((n) => String(n.name ?? '')),
      category_id: node.category_id,
    });
    const kids = filterChildren(node.children || []);
    for (const child of kids) {
      walk(child, pathNodes);
    }
  }
  for (const r of filterChildren(roots || [])) {
    walk(r, []);
  }
  return rows;
}

export function resolveSkipCategoryFromFlat(flat) {
  const row = flat.find((c) => String(c.name || '').trim().toLowerCase() === 'ebay');
  if (!row) return null;
  const pathArr = String(row.path || row.name || 'eBay')
    .split(' > ')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: row.category_id,
    name: row.name || 'eBay',
    path: pathArr.length ? pathArr : ['eBay'],
  };
}

/**
 * NosPos GET /nospos-categories/ `results` → same tree shape as eBay: `{ category_id, name, children, _sourceRow }`.
 * Uses `parentNosposId` / `parent_nospos_id` when present; otherwise may produce a flat forest.
 */
export function nosposCategoriesToNestedRoots(results) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const byNosposId = new Map();

  for (const row of results) {
    const id = row.nosposId ?? row.nospos_id;
    if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) continue;
    const st = row.status;
    if (st && st !== 'active' && st !== 'Active') continue;

    const fullName = String(row.fullName || '').trim();
    const segs = fullName.split(/\s*>\s*/).map((s) => s.trim()).filter(Boolean);
    const name = segs.length > 0 ? segs[segs.length - 1] : fullName || `NosPos ${id}`;

    byNosposId.set(Number(id), {
      category_id: Number(id),
      name,
      parent_nospos_id: row.parentNosposId ?? row.parent_nospos_id ?? null,
      children: [],
      _sourceRow: row,
    });
  }

  const roots = [];
  for (const node of byNosposId.values()) {
    const pid = node.parent_nospos_id;
    if (pid == null || !byNosposId.has(Number(pid))) {
      roots.push(node);
    } else {
      byNosposId.get(Number(pid)).children.push(node);
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
