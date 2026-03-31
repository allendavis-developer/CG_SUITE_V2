export function getCategoryPath(categoryId, nodes, path = []) {
  for (const cat of nodes || []) {
    const nextPath = [...path, cat.name];
    if (String(cat.category_id) === String(categoryId)) return nextPath;
    if (cat.children?.length) {
      const found = getCategoryPath(categoryId, cat.children, nextPath);
      if (found) return found;
    }
  }
  return null;
}

export function filterCategoryTree(nodes, query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return nodes || [];
  const needle = trimmed.toLowerCase();
  return (nodes || []).reduce((acc, node) => {
    const filteredChildren = node.children?.length
      ? filterCategoryTree(node.children, query)
      : [];
    const matchesSelf = String(node.name || '').toLowerCase().includes(needle);
    if (matchesSelf || filteredChildren.length > 0) {
      acc.push({
        ...node,
        children: matchesSelf ? (node.children || []) : filteredChildren,
      });
    }
    return acc;
  }, []);
}

export function collectLeafCategories(nodes, path = []) {
  return (nodes || []).flatMap((node) => {
    const newPath = [...path, node.name];
    if (node.children?.length) return collectLeafCategories(node.children, newPath);
    return [{ category: node, path: newPath }];
  });
}

