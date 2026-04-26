"""Cash Generator retail category sync (browser scrape → CgCategory)."""

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from pricing.models_v2 import CgCategory
from pricing.services.cg_category_sync import sync_cg_categories_from_scrape_rows

CG_SEARCH_RESULTS_BASE = "https://cashgenerator.co.uk/pages/search-results-page"


@api_view(["GET"])
def cg_categories_list(request):
    """
    Flat list for the upload categories table: category name, parent display name, optional retail URL.
    """
    qs = (
        CgCategory.objects.order_by("parent_category_id", "name")
        .values("name", "collection_slug", "parent_category_id", "parent_category__name")
    )
    rows = []
    for c in qs:
        slug = (c.get("collection_slug") or "").strip()
        parent_name = (
            c["parent_category__name"]
            if c.get("parent_category_id")
            else "—"
        )
        href = None
        if slug and not slug.startswith("_cg_"):
            href = f"{CG_SEARCH_RESULTS_BASE}?collection={slug}"
        rows.append(
            {
                "category": c["name"],
                "parentCategory": parent_name,
                "categoryHref": href,
            }
        )
    return Response({"rows": rows, "count": len(rows)})


@api_view(["POST"])
def cg_categories_sync(request):
    """
    Body: { "rows": [ { "category", "parentCategory", "categoryHref?" }, ... ] }
    Replaces CG category table with the scrape snapshot and returns a diff vs previous DB state.
    """
    data = request.data if isinstance(request.data, dict) else {}
    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) == 0:
        return Response(
            {"error": "rows must be a non-empty array"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    result = sync_cg_categories_from_scrape_rows(rows)
    return Response({"ok": True, **result})
