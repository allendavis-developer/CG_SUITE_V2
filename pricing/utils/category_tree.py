"""
Shared logic for product name prefix-based category tree building.
Used by categorise_products (dry-run) and split_android_phones (DB write).
"""

from collections import defaultdict


def get_prefix(name: str, word_count: int) -> str:
    """Return the first `word_count` words of `name`."""
    words = name.strip().split()
    return " ".join(words[:word_count]) if words else ""


def matches_prefix(name: str, prefix: str) -> bool:
    """True if the product name starts with the prefix (as full words)."""
    if not prefix:
        return True
    name_ws = name.strip()
    prefix_ws = prefix.strip()
    if not name_ws or not prefix_ws:
        return False
    return name_ws == prefix_ws or name_ws.startswith(prefix_ws + " ")


def build_category_tree(
    products: list[tuple[int, str]], parent_prefix: str, word_depth: int
) -> dict:
    """
    Recursively build a tree of proposed categories.

    products: list of (product_id, display_name)
    parent_prefix: prefix that products must match (empty at root)
    word_depth: how many words to consider for this level (1, 2, 3...)

    Returns dict with: children (list of category nodes), orphans (products at this level)
    """
    if parent_prefix:
        matching = [(pid, n) for pid, n in products if matches_prefix(n, parent_prefix)]
    else:
        matching = products

    if not matching:
        return {"children": [], "orphans": []}

    prefix_counts: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for pid, name in matching:
        prefix = get_prefix(name, word_depth)
        if prefix:
            prefix_counts[prefix].append((pid, name))

    children = []
    orphans: list[tuple[int, str]] = []

    for prefix in sorted(prefix_counts.keys()):
        items = prefix_counts[prefix]
        count = len(items)
        if count >= 2:
            max_words = max(len(n.strip().split()) for _, n in items)
            if max_words <= word_depth:
                orphans.extend(items)
                continue
            next_prefix_counts: dict[str, int] = defaultdict(int)
            for _pid, name in items:
                next_pref = get_prefix(name, word_depth + 1)
                if next_pref:
                    next_prefix_counts[next_pref] += 1
            has_child_category = any(c >= 2 for c in next_prefix_counts.values())
            if has_child_category:
                sub = build_category_tree(items, prefix, word_depth + 1)
                children.append({
                    "name": prefix,
                    "product_count": count,
                    "children": sub["children"],
                    "orphans": sub["orphans"],
                })
            else:
                orphans.extend(items)
        else:
            orphans.extend(items)

    return {"children": children, "orphans": orphans}


def build_one_level_categories(products: list[tuple[int, str]]) -> dict:
    """
    Single level only: first word, freq >= 2 → category. All matching products in that category.
    Returns {children: [{name, products}], orphans}.
    """
    prefix_counts: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for pid, name in products:
        prefix = get_prefix(name, 1)
        if prefix:
            prefix_counts[prefix].append((pid, name))

    children = []
    orphans: list[tuple[int, str]] = []
    for prefix in sorted(prefix_counts.keys()):
        items = prefix_counts[prefix]
        if len(items) >= 2:
            children.append({"name": prefix, "products": items})
        else:
            orphans.extend(items)

    return {"children": children, "orphans": orphans}
