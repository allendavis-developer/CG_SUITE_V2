"""
Normalized persistence for eBay / Cash Converters market research.

API responses still expose legacy-shaped `raw_data` and `cash_converters_data` dicts
assembled from relational rows so the frontend can stay unchanged.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any

from .models_v2 import (
    MarketResearchDrillLevel,
    MarketResearchListing,
    MarketResearchPlatform,
    MarketResearchSession,
    RepricingSessionItem,
    RequestItem,
)

STANDARD_LISTING_KEYS = frozenset(
    {
        "_id",
        "title",
        "price",
        "url",
        "image",
        "sold",
        "itemId",
        "excluded",
        "shop",
        "sellerInfo",
    }
)


def _dec(val: Any) -> Decimal | None:
    if val is None:
        return None
    if isinstance(val, Decimal):
        return val
    try:
        if isinstance(val, str):
            val = val.replace("£", "").replace(",", "").strip()
        return Decimal(str(val))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _parse_selected_offer_index(val: Any) -> str | None:
    if val is None:
        return None
    if val == "manual":
        return "manual"
    if isinstance(val, (int, float)):
        return str(int(val))
    s = str(val).strip()
    return s if s else None


def _is_market_research_dict(d: dict) -> bool:
    if not isinstance(d.get("listings"), list):
        return False
    stats = d.get("stats")
    if not isinstance(stats, dict):
        return False
    return "median" in stats or "average" in stats or "suggestedPrice" in stats


def _is_cex_product_snapshot_dict(d: dict) -> bool:
    if d.get("id") in (None, "") or not d.get("title"):
        return False
    if _is_market_research_dict(d):
        return False
    return True


def _strip_known_keys(d: dict, keys: frozenset) -> dict | None:
    extra = {k: v for k, v in d.items() if k not in keys}
    return extra if extra else None


def replace_request_item_research(
    request_item: RequestItem,
    platform: str,
    payload: dict | None,
) -> None:
    MarketResearchSession.objects.filter(request_item=request_item, platform=platform).delete()
    if not payload or not isinstance(payload, dict):
        return
    if not _is_market_research_dict(payload):
        return
    stats = payload.get("stats") or {}
    sel = payload.get("selectedFilters")
    filt_opts = payload.get("filterOptions")
    filter_state = None
    if sel is not None or filt_opts is not None:
        filter_state = {"selectedFilters": sel, "filterOptions": filt_opts}
    session = MarketResearchSession.objects.create(
        request_item=request_item,
        repricing_session_item=None,
        platform=platform,
        search_term=str(payload.get("searchTerm") or "")[:500],
        listing_page_url=str(payload.get("listingPageUrl") or "")[:2000],
        show_histogram=bool(payload.get("showHistogram")),
        manual_offer_text=str(payload.get("manualOffer") or "")[:64],
        selected_offer_index=_parse_selected_offer_index(payload.get("selectedOfferIndex")),
        stat_average_gbp=_dec(stats.get("average")),
        stat_median_gbp=_dec(stats.get("median")),
        stat_suggested_sale_gbp=_dec(stats.get("suggestedPrice")),
        advanced_filter_state=payload.get("advancedFilterState"),
        filter_state_json=filter_state,
        buy_offers_json=payload.get("buyOffers"),
    )
    for idx, level in enumerate(payload.get("drillHistory") or []):
        if not isinstance(level, dict):
            continue
        da, db = _dec(level.get("min")), _dec(level.get("max"))
        if da is None or db is None:
            continue
        MarketResearchDrillLevel.objects.create(
            session=session,
            level_index=idx,
            min_gbp=da,
            max_gbp=db,
        )
    for order, row in enumerate(payload.get("listings") or []):
        if not isinstance(row, dict):
            continue
        extra = _strip_known_keys(row, STANDARD_LISTING_KEYS)
        MarketResearchListing.objects.create(
            session=session,
            sort_order=order,
            client_row_id=str(row.get("_id") or "")[:128],
            external_item_id=str(row.get("itemId") or "")[:64],
            title=str(row.get("title") or ""),
            price_gbp=_dec(row.get("price")),
            listing_url=str(row.get("url") or "")[:2000],
            image_url=str(row.get("image") or "")[:2000] if row.get("image") else "",
            excluded=bool(row.get("excluded")),
            sold_text=str(row.get("sold") or "")[:256],
            shop_name=str(row.get("shop") or "")[:256],
            seller_info=str(row.get("sellerInfo") or "")[:2000],
            extra=extra,
        )


def replace_repricing_item_research(
    repricing_item: RepricingSessionItem,
    platform: str,
    payload: dict | None,
) -> None:
    MarketResearchSession.objects.filter(
        repricing_session_item=repricing_item, platform=platform
    ).delete()
    if not payload or not isinstance(payload, dict):
        return
    if not _is_market_research_dict(payload):
        return
    stats = payload.get("stats") or {}
    sel = payload.get("selectedFilters")
    filt_opts = payload.get("filterOptions")
    filter_state = None
    if sel is not None or filt_opts is not None:
        filter_state = {"selectedFilters": sel, "filterOptions": filt_opts}
    session = MarketResearchSession.objects.create(
        request_item=None,
        repricing_session_item=repricing_item,
        platform=platform,
        search_term=str(payload.get("searchTerm") or "")[:500],
        listing_page_url=str(payload.get("listingPageUrl") or "")[:2000],
        show_histogram=bool(payload.get("showHistogram")),
        manual_offer_text=str(payload.get("manualOffer") or "")[:64],
        selected_offer_index=_parse_selected_offer_index(payload.get("selectedOfferIndex")),
        stat_average_gbp=_dec(stats.get("average")),
        stat_median_gbp=_dec(stats.get("median")),
        stat_suggested_sale_gbp=_dec(stats.get("suggestedPrice")),
        advanced_filter_state=payload.get("advancedFilterState"),
        filter_state_json=filter_state,
        buy_offers_json=payload.get("buyOffers"),
    )
    for idx, level in enumerate(payload.get("drillHistory") or []):
        if not isinstance(level, dict):
            continue
        da, db = _dec(level.get("min")), _dec(level.get("max"))
        if da is None or db is None:
            continue
        MarketResearchDrillLevel.objects.create(
            session=session, level_index=idx, min_gbp=da, max_gbp=db
        )
    for order, row in enumerate(payload.get("listings") or []):
        if not isinstance(row, dict):
            continue
        extra = _strip_known_keys(row, STANDARD_LISTING_KEYS)
        MarketResearchListing.objects.create(
            session=session,
            sort_order=order,
            client_row_id=str(row.get("_id") or "")[:128],
            external_item_id=str(row.get("itemId") or "")[:64],
            title=str(row.get("title") or ""),
            price_gbp=_dec(row.get("price")),
            listing_url=str(row.get("url") or "")[:2000],
            image_url=str(row.get("image") or "")[:2000] if row.get("image") else "",
            excluded=bool(row.get("excluded")),
            sold_text=str(row.get("sold") or "")[:256],
            shop_name=str(row.get("shop") or "")[:256],
            seller_info=str(row.get("sellerInfo") or "")[:2000],
            extra=extra,
        )


def session_to_client_payload(session: MarketResearchSession) -> dict:
    listings_out = []
    for row in session.listings.all().order_by("sort_order", "listing_id"):
        d: dict[str, Any] = {
            "_id": row.client_row_id or f"row-{row.listing_id}",
            "title": row.title,
            "price": float(row.price_gbp) if row.price_gbp is not None else "",
            "url": row.listing_url,
            "excluded": row.excluded,
        }
        if row.external_item_id:
            d["itemId"] = row.external_item_id
        if row.image_url:
            d["image"] = row.image_url
        if row.sold_text:
            d["sold"] = row.sold_text
        if row.shop_name:
            d["shop"] = row.shop_name
        if row.seller_info:
            d["sellerInfo"] = row.seller_info
        if row.extra and isinstance(row.extra, dict):
            for k, v in row.extra.items():
                if k not in d:
                    d[k] = v
        listings_out.append(d)
    stats_out = {
        "average": float(session.stat_average_gbp) if session.stat_average_gbp is not None else 0,
        "median": float(session.stat_median_gbp) if session.stat_median_gbp is not None else 0,
        "suggestedPrice": float(session.stat_suggested_sale_gbp)
        if session.stat_suggested_sale_gbp is not None
        else 0,
    }
    drill = [
        {"min": float(l.min_gbp), "max": float(l.max_gbp)}
        for l in session.drill_levels.all().order_by("level_index")
    ]
    fs = session.filter_state_json or {}
    out: dict[str, Any] = {
        "listings": listings_out,
        "stats": stats_out,
        "showHistogram": session.show_histogram,
        "drillHistory": drill,
        "buyOffers": session.buy_offers_json or [],
        "searchTerm": session.search_term,
        "listingPageUrl": session.listing_page_url,
        "selectedFilters": fs.get("selectedFilters")
        if fs.get("selectedFilters") is not None
        else {"basic": [], "apiFilters": {}},
        "filterOptions": fs.get("filterOptions")
        if fs.get("filterOptions") is not None
        else [],
        "manualOffer": session.manual_offer_text or "",
        "advancedFilterState": session.advanced_filter_state,
    }
    if session.selected_offer_index:
        if session.selected_offer_index == "manual":
            out["selectedOfferIndex"] = "manual"
        else:
            try:
                out["selectedOfferIndex"] = int(session.selected_offer_index)
            except ValueError:
                out["selectedOfferIndex"] = session.selected_offer_index
    return out


def _get_session(ri_or_rsi: RequestItem | RepricingSessionItem, platform: str):
    if isinstance(ri_or_rsi, RequestItem):
        return (
            MarketResearchSession.objects.filter(request_item=ri_or_rsi, platform=platform)
            .prefetch_related("listings", "drill_levels")
            .first()
        )
    return (
        MarketResearchSession.objects.filter(
            repricing_session_item=ri_or_rsi, platform=platform
        )
        .prefetch_related("listings", "drill_levels")
        .first()
    )


def compose_raw_data_for_request_item(item: RequestItem) -> dict | None:
    ebay = _get_session(item, MarketResearchPlatform.EBAY)
    ebay_blob = session_to_client_payload(ebay) if ebay else None
    ref = item.cex_reference_json
    meta = item.line_metadata_json or {}
    snap = item.cex_line_snapshot_json

    if snap:
        out = deepcopy(snap) if isinstance(snap, dict) else {}
        if ref is not None:
            out["referenceData"] = ref
        if ebay_blob:
            out["ebayResearchData"] = ebay_blob
        for k in ("display_title", "display_subtitle"):
            if meta.get(k) is not None:
                out[k] = meta[k]
        return out if out else None

    if ebay_blob:
        out = dict(ebay_blob)
        if ref is not None:
            out["referenceData"] = ref
        for k in ("display_title", "display_subtitle"):
            if meta.get(k) is not None:
                out[k] = meta[k]
        return out if (out.get("listings") or ref or meta) else None

    if ref is not None or meta:
        out: dict[str, Any] = {}
        if ref is not None:
            out["referenceData"] = ref
        for k, v in meta.items():
            if v is not None:
                out[k] = v
        return out if out else None
    return None


def compose_cash_converters_for_request_item(item: RequestItem) -> dict:
    cc = _get_session(item, MarketResearchPlatform.CASH_CONVERTERS)
    return session_to_client_payload(cc) if cc else {}


def compose_raw_data_for_repricing_item(item: RepricingSessionItem) -> dict:
    ebay = _get_session(item, MarketResearchPlatform.EBAY)
    return session_to_client_payload(ebay) if ebay else {}


def compose_cash_converters_for_repricing_item(item: RepricingSessionItem) -> dict:
    cc = _get_session(item, MarketResearchPlatform.CASH_CONVERTERS)
    return session_to_client_payload(cc) if cc else {}


def ingest_request_item_post_create(
    item: RequestItem, raw_data: Any, cc_data: Any
) -> None:
    """After RequestItem INSERT: split legacy blobs into normalized rows + JSON context."""
    if raw_data is not None and not isinstance(raw_data, dict):
        raw_data = None
    if cc_data is not None and not isinstance(cc_data, dict):
        cc_data = None
    sync_merged_raw_into_request_item(item, raw_data)
    if cc_data:
        replace_request_item_research(item, MarketResearchPlatform.CASH_CONVERTERS, cc_data)


def sync_merged_raw_into_request_item(item: RequestItem, raw: dict | None) -> None:
    """Persist legacy `raw_data` shape into RequestItem JSON fields + MarketResearchSession rows."""
    if not raw:
        return

    ref = raw.get("referenceData")
    if ref is None:
        ref = raw.get("reference_data")
    if ref is not None:
        item.cex_reference_json = ref

    meta = dict(item.line_metadata_json or {})
    for k in ("display_title", "display_subtitle"):
        if raw.get(k) is not None:
            meta[k] = raw[k]
    item.line_metadata_json = meta if meta else None

    ebay_src = None
    if _is_market_research_dict(raw):
        ebay_src = raw
    elif isinstance(raw.get("ebayResearchData"), dict) and _is_market_research_dict(
        raw["ebayResearchData"]
    ):
        ebay_src = raw["ebayResearchData"]
    if ebay_src:
        replace_request_item_research(item, MarketResearchPlatform.EBAY, ebay_src)

    cc_embed = raw.get("cashConvertersResearchData")
    if isinstance(cc_embed, dict) and _is_market_research_dict(cc_embed):
        replace_request_item_research(
            item, MarketResearchPlatform.CASH_CONVERTERS, cc_embed
        )

    if _is_cex_product_snapshot_dict(raw):
        strip_keys = {
            "referenceData",
            "reference_data",
            "ebayResearchData",
            "cashConvertersResearchData",
            "display_title",
            "display_subtitle",
        }
        snap = {k: v for k, v in raw.items() if k not in strip_keys}
        if not _is_market_research_dict(snap):
            item.cex_line_snapshot_json = snap

    item.save(
        update_fields=[
            "cex_reference_json",
            "cex_line_snapshot_json",
            "line_metadata_json",
        ]
    )


def apply_partial_raw_data_update(item: RequestItem, raw: Any) -> None:
    if raw is None:
        replace_request_item_research(item, MarketResearchPlatform.EBAY, None)
        return
    if not isinstance(raw, dict):
        return
    sync_merged_raw_into_request_item(item, raw)


def apply_partial_cc_data_update(item: RequestItem, raw: Any) -> None:
    if raw is None:
        replace_request_item_research(item, MarketResearchPlatform.CASH_CONVERTERS, None)
        return
    if isinstance(raw, dict) and raw:
        replace_request_item_research(item, MarketResearchPlatform.CASH_CONVERTERS, raw)


def finish_sync_request_item_research(
    item: RequestItem, raw_data: Any, cc_data: Any
) -> None:
    if raw_data is not None and isinstance(raw_data, dict):
        sync_merged_raw_into_request_item(item, raw_data)
    if cc_data is not None and isinstance(cc_data, dict) and cc_data:
        replace_request_item_research(
            item, MarketResearchPlatform.CASH_CONVERTERS, cc_data
        )


def ingest_repricing_line_post_create(
    line: RepricingSessionItem, raw_data: Any, cc_data: Any
) -> None:
    if isinstance(raw_data, dict) and raw_data:
        replace_repricing_item_research(line, MarketResearchPlatform.EBAY, raw_data)
    if isinstance(cc_data, dict) and cc_data:
        replace_repricing_item_research(
            line, MarketResearchPlatform.CASH_CONVERTERS, cc_data
        )
