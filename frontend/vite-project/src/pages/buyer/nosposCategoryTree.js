/**
 * Build a small tree from NosPos category option labels like "A > B > C".
 */

export function categoryOptionsAreHierarchical(options) {
  if (!Array.isArray(options)) return false;
  return options.some((o) => String(o.text || '').includes('>'));
}

export function buildCategoryTree(options) {
  const root = { children: new Map(), leafValues: [] };
  for (const opt of options || []) {
    const val = opt.value != null ? String(opt.value) : '';
    if (val === '') continue;
    const text = String(opt.text || '').trim();
    const parts = text.split(/\s*>\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!node.children.has(seg)) {
        node.children.set(seg, { children: new Map(), leafValues: [] });
      }
      node = node.children.get(seg);
    }
    node.leafValues.push({ value: val, text: text || val });
  }
  return root;
}

/** Segment path from root to the leaf with this option value. */
export function findPathForCategoryValue(root, value) {
  if (value === '' || value == null) return [];
  const want = String(value);
  const out = [];

  function dfs(node, segments) {
    for (const leaf of node.leafValues) {
      if (leaf.value === want) {
        out.push(...segments);
        return true;
      }
    }
    for (const [seg, child] of node.children) {
      if (dfs(child, [...segments, seg])) return true;
    }
    return false;
  }

  dfs(root, []);
  return out;
}
