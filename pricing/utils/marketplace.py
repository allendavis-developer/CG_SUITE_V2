"""Shared marketplace category mapping used by eBay and Cash Converters filters."""

MARKETPLACE_CATEGORY_MAP = {
    "phones": "9355",
    "games": "139973",
    "tablets": "58058",
    "laptops": "175672",
    "gaming consoles": "139971",
    "guitars & basses": "3858",
    "smartphones and mobile": "9355",
    "games (discs & cartridges)": "139973",
    "cameras": "31388",
    "headphones": "15052",
    "smartwatches": "178893",
}


def resolve_marketplace_category(category_path, category_map=None):
    """Right-to-left scan for the most specific category match."""
    if not category_path or not isinstance(category_path, list):
        return None
    mapping = category_map or MARKETPLACE_CATEGORY_MAP
    for i in range(len(category_path) - 1, -1, -1):
        segment = category_path[i].lower()
        if segment in mapping:
            return mapping[segment]
    return None


def normalize_filter_id(value):
    return value.lower().replace(" ", "_").replace("&", "").replace("/", "_")
