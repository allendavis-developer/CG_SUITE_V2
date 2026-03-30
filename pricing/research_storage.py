"""
Normalized persistence for eBay / Cash Converters market research plus jewellery data.

API responses still expose `raw_data`/`cash_converters_data` dicts for frontend
compatibility, but jewellery reference/valuation state is sourced from normalized tables.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any

from .models_v2 import (
    AttributeValue,
    JewelleryMeasurementSource,
    MarketResearchDrillLevel,
    MarketResearchListing,
    MarketResearchPlatform,
    MarketResearchSession,
    RepricingSessionItem,
    RequestItem,
    RequestItemJewellery,
    RequestItemJewelleryValuation,
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


def _merge_advanced_filter_state(prev: Any, new: Any) -> Any:
    """Keep keys from previous session when the payload omits them (e.g. partial raw_data updates)."""
    if new is None:
        return prev
    if not isinstance(new, dict):
        return new
    prev_d = prev if isinstance(prev, dict) else {}
    return {**prev_d, **new}


def _to_grams(weight_raw: Any, unit_raw: Any) -> Decimal | None:
    weight = _dec(weight_raw)
    if weight is None or weight <= 0:
        return None
    unit = str(unit_raw or "g").strip().lower()
    if unit == "kg":
        return weight * Decimal("1000")
    if unit == "g":
        return weight
    return None


def _build_jewellery_reference_from_normalized(item: RequestItem) -> dict | None:
    row = getattr(item, "jewellery", None)
    if row is None:
        return None

    selected = (
        row.valuations.filter(is_selected=True).order_by("-created_at").first()
        or row.valuations.order_by("-created_at").first()
    )
    selected_payload = (
        selected.valuation_payload_json
        if selected and isinstance(selected.valuation_payload_json, dict)
        else {}
    )
    ref_snap = (
        selected.source_reference_snapshot
        if selected and selected.source_reference_snapshot_id
        else getattr(item.request, "current_jewellery_reference_snapshot", None)
    )
    sections = ref_snap.sections_json if ref_snap and isinstance(ref_snap.sections_json, list) else []

    out = {
        "jewellery_line": True,
        "material_grade": row.material_grade.value if row.material_grade_id else None,
        "product_name": selected_payload.get("product_name"),
        "line_title": selected_payload.get("line_title"),
        "category_label": selected_payload.get("category_label") or selected_payload.get("line_title"),
        "item_name": selected_payload.get("item_name")
        or selected_payload.get("category_label")
        or selected_payload.get("line_title"),
        "reference_catalog_id": selected_payload.get("reference_catalog_id"),
        "reference_display_name": selected_payload.get("reference_display_name"),
        "reference_section_title": selected_payload.get("reference_section_title"),
        "reference_price_source_kind": selected_payload.get("reference_price_source_kind"),
        "weight": str(row.input_weight_value) if row.input_weight_value is not None else None,
        "weight_unit": row.input_weight_unit or "g",
        "computed_total_gbp": float(selected.computed_total_gbp) if selected else None,
        "rate_per_gram": float(selected.rate_per_gram_gbp) if selected and selected.rate_per_gram_gbp is not None else None,
        "unit_price": float(selected.unit_price_gbp) if selected and selected.unit_price_gbp is not None else None,
        "reference_source": "normalized",
    }
    if sections:
        out["reference_sections"] = sections
    if ref_snap and ref_snap.source_url:
        out["source_url"] = ref_snap.source_url
    return out


def _upsert_jewellery_from_reference_payload(item: RequestItem, ref: dict) -> None:
    if ref.get("jewellery_line") is not True:
        return

    gross_grams = _to_grams(ref.get("weight"), ref.get("weight_unit"))
    req_jew, _ = RequestItemJewellery.objects.update_or_create(
        request_item=item,
        defaults={
            "measured_gross_weight_grams": gross_grams,
            "input_weight_value": _dec(ref.get("weight")),
            "input_weight_unit": str(ref.get("weight_unit") or "g").strip().lower(),
            "measurement_source": JewelleryMeasurementSource.IMPORTED,
        },
    )

    # best-effort material grade map from legacy payload
    material_grade = ref.get("material_grade")
    if material_grade:
        av = AttributeValue.objects.filter(value=material_grade).first()
        if av:
            req_jew.material_grade = av
            req_jew.save(update_fields=["material_grade", "updated_at"])

    total = _dec(ref.get("computed_total_gbp"))
    if total is None:
        return

    val, created = RequestItemJewelleryValuation.objects.get_or_create(
        request_item_jewellery=req_jew,
        valuation_source="LEGACY_IMPORT",
        computed_total_gbp=total,
        defaults={
            "rate_per_gram_gbp": _dec(ref.get("rate_per_gram")),
            "unit_price_gbp": _dec(ref.get("unit_price")),
            "basis_weight_grams": gross_grams,
            "valuation_payload_json": ref,
            "is_selected": True,
        },
    )
    if created:
        RequestItemJewelleryValuation.objects.filter(
            request_item_jewellery=req_jew
        ).exclude(pk=val.pk).update(is_selected=False)


def replace_request_item_research(
    request_item: RequestItem,
    platform: str,
    payload: dict | None,
) -> None:
    prev_adv = (
        MarketResearchSession.objects.filter(
            request_item=request_item, platform=platform
        )
        .values_list("advanced_filter_state", flat=True)
        .first()
    )
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
        advanced_filter_state=_merge_advanced_filter_state(
            prev_adv, payload.get("advancedFilterState")
        ),
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
    prev_adv = (
        MarketResearchSession.objects.filter(
            repricing_session_item=repricing_item, platform=platform
        )
        .values_list("advanced_filter_state", flat=True)
        .first()
    )
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
        advanced_filter_state=_merge_advanced_filter_state(
            prev_adv, payload.get("advancedFilterState")
        ),
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
    ref = _build_jewellery_reference_from_normalized(item) or item.cex_reference_json
    meta = item.line_metadata_json or {}
    snap = item.cex_line_snapshot_json

    if snap:
        out = deepcopy(snap) if isinstance(snap, dict) else {}
        if ref is not None:
            out["referenceData"] = ref
        if ebay_blob:
            out["ebayResearchData"] = ebay_blob
        for k in ("display_title", "display_subtitle", "rrpOffersSource"):
            if meta.get(k) is not None:
                out[k] = meta[k]
        return out if out else None

    if ebay_blob:
        out = dict(ebay_blob)
        if ref is not None:
            out["referenceData"] = ref
        for k in ("display_title", "display_subtitle", "rrpOffersSource"):
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
        if isinstance(ref, dict) and ref.get("jewellery_line") is True:
            _upsert_jewellery_from_reference_payload(item, ref)
        else:
            item.cex_reference_json = ref

    meta = dict(item.line_metadata_json or {})
    for k in ("display_title", "display_subtitle"):
        if raw.get(k) is not None:
            meta[k] = raw[k]
    # Negotiation UI: which column (CeX sell / eBay / CC) was used as RRP+offers source
    if "rrpOffersSource" in raw:
        v = raw.get("rrpOffersSource")
        if v is None or v == "":
            meta.pop("rrpOffersSource", None)
        else:
            meta["rrpOffersSource"] = v
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
            "cex_line_snapshot_json",
            "line_metadata_json",
        ] + (["cex_reference_json"] if not (isinstance(ref, dict) and ref.get("jewellery_line") is True) else [])
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
