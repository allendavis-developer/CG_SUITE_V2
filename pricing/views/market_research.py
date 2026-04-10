import re
import logging
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import requests as http_requests
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from pricing.utils.ebay_filters import (
    extract_filters,
    extract_ebay_search_params,
    build_ebay_search_url,
)
from pricing.utils.cashconverters_filters import (
    build_cashconverters_url,
    convert_facet_groups_to_filters,
)

logger = logging.getLogger(__name__)


@api_view(['GET'])
def get_ebay_filters(request):
    search_term = request.GET.get("q", "").strip()
    ebay_search_url = request.GET.get("url", "").strip()
    category_path = request.GET.getlist("category_path")

    if not search_term and not ebay_search_url:
        return Response(
            {"success": False, "error": "Provide either q or url"},
            status=status.HTTP_400_BAD_REQUEST
        )

    ebay_url = "https://www.ebay.co.uk/sch/ajax/refine"

    if ebay_search_url:
        try:
            params = extract_ebay_search_params(ebay_search_url)
        except Exception:
            return Response(
                {"success": False, "error": "Invalid eBay URL"},
                status=status.HTTP_400_BAD_REQUEST
            )
    else:
        if category_path:
            ebay_search_url = build_ebay_search_url(search_term, category_path)
            try:
                params = extract_ebay_search_params(ebay_search_url)
            except Exception:
                params = {"_nkw": search_term, "_sacat": 0, "_fsrp": 1, "rt": "nc"}
        else:
            params = {"_nkw": search_term, "_sacat": 0, "_fsrp": 1, "rt": "nc"}

    params.update({"modules": "SEARCH_REFINEMENTS_MODEL_V2:fa", "no_encode_refine_params": 1})

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.ebay.co.uk/",
    }

    session = http_requests.Session()
    session.headers.update(headers)
    session.get("https://www.ebay.co.uk/", timeout=10)

    try:
        response = session.get(ebay_url, params=params, timeout=20)
        logger.debug("eBay request sent to: %s", response.url)
        response.raise_for_status()
    except http_requests.RequestException as e:
        return Response({"success": False, "error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

    data = response.json()

    refinements_module = None
    if data.get("_type") == "SearchRefinementsModule":
        refinements_module = data
    else:
        for module in data.get("modules", []):
            if module.get("_type") == "SearchRefinementsModule":
                refinements_module = module
                break

    if not refinements_module:
        return Response(
            {"success": False, "error": "No refinements module found"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    filters = extract_filters(refinements_module)

    return JsonResponse({
        "success": True,
        "source": "url" if ebay_search_url else "query",
        "query": search_term or params.get("_nkw"),
        "filters": filters,
    })


@api_view(['GET'])
def get_cashconverters_filters(request):
    search_term = request.GET.get("q", "").strip()
    cashconverters_url = request.GET.get("url", "").strip()
    category_path = request.GET.getlist("category_path")

    if not search_term and not cashconverters_url:
        return Response(
            {"success": False, "error": "Provide either q or url"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if cashconverters_url:
        api_url = cashconverters_url
    else:
        api_url = build_cashconverters_url(search_term, category_path if category_path else None)

    logger.debug("CashConverters filters API URL: %s", api_url)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.cashconverters.co.uk/",
    }

    session = http_requests.Session()
    session.headers.update(headers)

    try:
        response = session.get(api_url, timeout=20)
        logger.debug("Cash Converters filters request sent to: %s", response.url)
        response.raise_for_status()
    except http_requests.RequestException as e:
        return Response({"success": False, "error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

    try:
        data = response.json()
    except ValueError as e:
        return Response(
            {"success": False, "error": f"Invalid JSON response: {str(e)}"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    if not data.get("WasSuccessful", False):
        return Response(
            {"success": False, "error": data.get("Message", "Cash Converters API returned unsuccessful response")},
            status=status.HTTP_502_BAD_GATEWAY
        )

    value = data.get("Value", {})
    upper_facets = value.get("UpperFacetGroupList", [])
    lower_facets = value.get("LowerFacetGroupList", [])
    filters = convert_facet_groups_to_filters(upper_facets, lower_facets)

    return JsonResponse({
        "success": True,
        "source": "url" if cashconverters_url else "query",
        "query": search_term or "unknown",
        "filters": filters,
    })


@api_view(['GET'])
def get_cashconverters_results(request):
    """Fetch Cash Converters results for a specific page."""
    search_url = request.GET.get("url", "").strip()
    page = request.GET.get("page", "1")
    fetch_only_first_page = request.GET.get("fetch_only_first_page", "false").lower() == "true"

    if not search_url:
        return Response(
            {"success": False, "error": "url parameter is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        parsed = urlparse(search_url)
        params = parse_qs(parsed.query, keep_blank_values=True)

        api_params = {}
        for key, values in params.items():
            match = re.match(r'f\[([^\]]+)\]\[(\d+)\]', key)
            if match:
                filter_name = match.group(1)
                if filter_name not in ['category', 'locations']:
                    if filter_name not in api_params:
                        api_params[filter_name] = []
                    api_params[filter_name].extend(values)
            else:
                api_params[key] = values

        for key in api_params:
            if isinstance(api_params[key], list) and len(api_params[key]) == 1:
                api_params[key] = api_params[key][0]

        if 'Sort' not in api_params:
            api_params['Sort'] = 'default'
        api_params['page'] = page

        if "search-results" in search_url:
            api_path = parsed.path.replace("search-results", "c3api/search/results")
        else:
            api_path = parsed.path

        query_string = urlencode(api_params, doseq=True)
        api_url = urlunparse((
            parsed.scheme or 'https',
            parsed.netloc or 'www.cashconverters.co.uk',
            api_path, '', query_string, ''
        ))
        logger.debug("CashConverters results API URL: %s (page=%s)", api_url, page)

    except Exception as e:
        return Response(
            {"success": False, "error": f"Invalid URL format: {str(e)}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.cashconverters.co.uk/",
    }

    session = http_requests.Session()
    session.headers.update(headers)

    try:
        response = session.get(api_url, timeout=20)
        mode = "first page only" if fetch_only_first_page else "all pages"
        logger.debug("Cash Converters results request sent to: %s (mode: %s)", response.url, mode)
        response.raise_for_status()
    except http_requests.RequestException as e:
        return Response({"success": False, "error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)

    try:
        data = response.json()
    except ValueError as e:
        return Response(
            {"success": False, "error": f"Invalid JSON response: {str(e)}"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    if not data.get("WasSuccessful", False):
        return Response(
            {"success": False, "error": data.get("Message", "Cash Converters API returned unsuccessful response")},
            status=status.HTTP_502_BAD_GATEWAY
        )

    value = data.get("Value", {})
    items = value.get("ProductList", {}).get("ProductListItems", [])

    results = []
    for raw in items:
        title = raw.get("Title", "")
        price = raw.get("Sp", 0)
        url = raw.get("Url", "")
        store = raw.get("StoreNameWithState", "")
        condition = raw.get("Condition") or raw.get("ProductCondition", "")
        stable_id = raw.get("Code")
        image = raw.get("AbsoluteImageUrl")
        if not image and raw.get("ImageUrl"):
            image = f"https://www.cashconverters.co.uk{raw.get('ImageUrl')}"

        results.append({
            "competitor": "CashConverters",
            "stable_id": stable_id,
            "title": title,
            "price": price,
            "description": "",
            "condition": condition,
            "store": store,
            "url": url if url.startswith("http") else f"https://www.cashconverters.co.uk{url}",
            "image": image
        })

    return JsonResponse({
        "success": True,
        "page": page,
        "results": results,
        "total_items": len(results)
    })
