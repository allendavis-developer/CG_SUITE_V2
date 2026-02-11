from urllib.parse import urlparse, parse_qsl

# eBay category mapping - maps category path segments to eBay category IDs
EBAY_CATEGORY_MAP = {
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

def resolve_ebay_category(category_path):
    """
    Finds the most specific eBay category ID by checking path items from right-to-left
    
    Args:
        category_path: List of category path segments, e.g., ["Electronics", "Mobile Phones", "Smartphones"]
    
    Returns:
        eBay category ID string or None
    """
    if not category_path or not isinstance(category_path, list):
        return None
    
    # Search from most specific (end of array) to most general (start)
    for i in range(len(category_path) - 1, -1, -1):
        segment = category_path[i].lower()
        if segment in EBAY_CATEGORY_MAP:
            return EBAY_CATEGORY_MAP[segment]
    
    return None

def build_ebay_search_url(search_term, category_path=None):
    """
    Build eBay search URL with optional category
    
    Args:
        search_term: Search query string
        category_path: Optional category path array
    
    Returns:
        eBay search URL string
    """
    category_id = resolve_ebay_category(category_path) if category_path else None
    
    if category_id:
        base_url = f"https://www.ebay.co.uk/sch/{category_id}/i.html"
    else:
        base_url = "https://www.ebay.co.uk/sch/i.html"
    
    params = {
        "_nkw": search_term.replace(" ", "+"),
        "_from": "R40"
    }
    
    if not category_id:
        params["_sacat"] = "0"
    
    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    return f"{base_url}?{query_string}"

def extract_ebay_search_params(ebay_url: str) -> dict:
    parsed = urlparse(ebay_url)
    # Use parse_qsl to get raw values without automatic decoding
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))

    # Ensure required defaults
    params.setdefault("_sacat", "0")
    params.setdefault("_fsrp", "1")
    params.setdefault("rt", "nc")

    return params

def extract_checkbox_options(entries):
    options = []

    for entry in entries:
        if entry.get("_type") != "TextualSelection":
            continue

        value = entry.get("paramValue")
        label = extract_label(entry)

        if not value or not label:
            continue

        options.append({
            "value": value,
            "label": label,
            "count": extract_count(entry)
        })

    return options

import re

def extract_count(entry):
    # ebay count is stored in secondaryLabel like " (3,542)"
    secondary = entry.get("secondaryLabel", {})
    spans = secondary.get("textSpans", [])

    if spans:
        text = spans[0].get("text", "")
        match = re.search(r"\(([\d,]+)\)", text)
        if match:
            return int(match.group(1).replace(",", ""))

    return None


def contains_range(entries):
    return any(e.get("_type") == "RangeValueSelection" for e in entries)


def extract_range_filter(group, label):
    min_value = group.get("minValue")
    max_value = group.get("maxValue")

    if min_value is None or max_value is None:
        return None

    return {
        "name": label,
        "id": normalize_id(group.get("fieldId") or label),
        "type": "range",
        "min": min_value,
        "max": max_value
    }


def normalize_id(value):
    return (
        value
        .lower()
        .replace(" ", "_")
        .replace("&", "")
    )


def extract_label(group):
    label = group.get("label", {})
    spans = label.get("textSpans", [])
    if spans:
        return spans[0].get("text")
    return None


def extract_group_as_filter(group):
    field_id = group.get("fieldId")
    param_key = group.get("paramKey")

    # skip category
    if field_id == "category" or param_key == "_sacat":
        return None

    label = extract_label(group)
    entries = group.get("entries", [])

    if not label or not entries:
        return None

    # range?
    if contains_range(entries):
        return extract_range_filter(group, label)

    # checkbox?
    options = extract_checkbox_options(entries)
    if options:
        return {
            "name": label,
            "id": normalize_id(label),
            "type": "checkbox",
            "options": options
        }

    return None


def extract_filters(ebay_raw):
    filters = []

    for group in ebay_raw.get("group", []):

        # 🚪 aspect drawer
        if group.get("fieldId") == "aspectlist":
            for aspect_group in group.get("entries", []):
                extracted = extract_group_as_filter(aspect_group)
                if extracted:
                    filters.append(extracted)
            continue

        # normal top-level filter
        extracted = extract_group_as_filter(group)
        if extracted:
            filters.append(extracted)

    return filters
