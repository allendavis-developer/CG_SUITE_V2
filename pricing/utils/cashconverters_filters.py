"""Utility functions for Cash Converters filter extraction."""

from pricing.utils.marketplace import (
    MARKETPLACE_CATEGORY_MAP,
    resolve_marketplace_category,
    normalize_filter_id,
)

CASH_CONVERTERS_CATEGORY_MAP = MARKETPLACE_CATEGORY_MAP


def resolve_cashconverters_category(category_path):
    return resolve_marketplace_category(category_path)

def build_cashconverters_url(search_term, category_path=None):
    """
    Build Cash Converters search URL
    
    Args:
        search_term: Search query string
        category_path: Optional category path array
    
    Returns:
        URL string for Cash Converters API
    """
    base_url = "https://www.cashconverters.co.uk/c3api/search/results"
    
    params = {
        "Sort": "default",
        "page": "1",
        "query": search_term.replace(" ", "%20")
    }
    
    # TODO: Add category parameter when Cash Converters API supports it in URL
    # For now, category_path is resolved but not added to URL
    # category_id = resolve_cashconverters_category(category_path) if category_path else None
    # if category_id:
    #     params["category"] = category_id
    
    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    return f"{base_url}?{query_string}"


def convert_facet_groups_to_filters(upper_facets, lower_facets):
    """
    Convert Cash Converters facet groups to eBay-style filter format
    
    Args:
        upper_facets: List of upper facet groups
        lower_facets: List of lower facet groups
    
    Returns:
        List of filters in eBay format: [{ name, id, type, options: [{ label, value, count }] }]
    """
    filters = []
    
    # Process both upper and lower facet groups
    all_facet_groups = (upper_facets or []) + (lower_facets or [])
    
    for group in all_facet_groups:
        group_name = group.get("Name") or group.get("GroupName")
        if not group_name:
            continue
        
        facet_items = group.get("FacetItems", [])
        if not facet_items:
            continue
        
        # Convert facet items to options
        options = []
        for item in facet_items:
            term = item.get("Term")
            count = item.get("Count", 0)
            
            if term:
                options.append({
                    "label": term,
                    "value": term,  # Cash Converters uses term as value
                    "count": count
                })
        
        if options:
            filter_id = normalize_filter_id(group_name)
            
            filters.append({
                "name": group_name,
                "id": filter_id,
                "type": "checkbox",
                "options": sorted(options, key=lambda x: x.get("count", 0), reverse=True)
            })
    
    return filters
