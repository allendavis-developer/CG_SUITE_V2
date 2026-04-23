"""
Normalized persistence for eBay / Cash Converters / Cash Generator market research plus jewellery data.

API responses still expose `raw_data`/`cash_converters_data`/`cg_data` dicts for frontend
compatibility, but jewellery reference/valuation state is sourced from normalized tables.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction

from .models_v2 import (
    AttributeValue,
    JewelleryMeasurementSource,
    MarketResearchDrillLevel,
    MarketResearchListing,
    MarketResearchPlatform,
    MarketResearchSession,
    RepricingSessionItem,
    UploadSessionItem,
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

    # Only one valuation may be selected per line (DB unique constraint). Creating a new
    # row with is_selected=True would fail if another row is still selected — which
    # happens whenever computed_total_gbp changes (e.g. jewellery workspace weight edit).
    with transaction.atomic():
        RequestItemJewelleryValuation.objects.filter(
            request_item_jewellery=req_jew,
        ).update(is_selected=False)

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
        if not created:
            val.rate_per_gram_gbp = _dec(ref.get("rate_per_gram"))
            val.unit_price_gbp = _dec(ref.get("unit_price"))
            val.basis_weight_grams = gross_grams
            val.valuation_payload_json = ref
            val.is_selected = True
            val.save(
                update_fields=[
                    "rate_per_gram_gbp",
                    "unit_price_gbp",
                    "basis_weight_grams",
                    "valuation_payload_json",
                    "is_selected",
                ]
            )


def _replace_market_research(
    *,
    platform: str,
    payload: dict | None,
    request_item: RequestItem | None = None,
    repricing_item: RepricingSessionItem | None = None,
    upload_item: UploadSessionItem | None = None,
) -> None:
    n = sum(1 for x in (request_item, repricing_item, upload_item) if x is not None)
    if n != 1:
        return
    if request_item is not None:
        session_filter = {"request_item": request_item, "platform": platform}
        owner_fields = {
            "request_item": request_item,
            "repricing_session_item": None,
            "upload_session_item": None,
        }
    elif upload_item is not None:
        session_filter = {"upload_session_item": upload_item, "platform": platform}
        owner_fields = {
            "request_item": None,
            "repricing_session_item": None,
            "upload_session_item": upload_item,
        }
    else:
        session_filter = {"repricing_session_item": repricing_item, "platform": platform}
        owner_fields = {
            "request_item": None,
            "repricing_session_item": repricing_item,
            "upload_session_item": None,
        }

    if not payload or not isinstance(payload, dict):
        MarketResearchSession.objects.filter(**session_filter).delete()
        return
    if not _is_market_research_dict(payload):
        MarketResearchSession.objects.filter(**session_filter).delete()
        return
    prev_adv = (
        MarketResearchSession.objects.filter(**session_filter)
        .values_list("advanced_filter_state", flat=True)
        .first()
    )
    stats = payload.get("stats") or {}
    sel = payload.get("selectedFilters")
    filt_opts = payload.get("filterOptions")
    filter_state = None
    if sel is not None or filt_opts is not None:
        filter_state = {"selectedFilters": sel, "filterOptions": filt_opts}
    session, created = MarketResearchSession.objects.update_or_create(
        defaults={
            **owner_fields,
            "search_term": str(payload.get("searchTerm") or "")[:500],
            "listing_page_url": str(payload.get("listingPageUrl") or "")[:2000],
            "show_histogram": bool(payload.get("showHistogram")),
            "manual_offer_text": str(payload.get("manualOffer") or "")[:64],
            "selected_offer_index": _parse_selected_offer_index(payload.get("selectedOfferIndex")),
            "stat_average_gbp": _dec(stats.get("average")),
            "stat_median_gbp": _dec(stats.get("median")),
            "stat_suggested_sale_gbp": _dec(stats.get("suggestedPrice")),
            "advanced_filter_state": _merge_advanced_filter_state(
                prev_adv, payload.get("advancedFilterState")
            ),
            "filter_state_json": filter_state,
            "buy_offers_json": payload.get("buyOffers"),
        },
        **session_filter,
    )
    for idx, level in enumerate(payload.get("drillHistory") or []):
        if not isinstance(level, dict):
            continue
        kind = str(level.get("kind") or "").lower()
        segments_raw = level.get("segments")
        if kind == "multi" and isinstance(segments_raw, list) and len(segments_raw) > 1:
            clean: list[dict[str, float]] = []
            env_min: Decimal | None = None
            env_max: Decimal | None = None
            for seg in segments_raw[:32]:
                if not isinstance(seg, dict):
                    continue
                da, db = _dec(seg.get("min")), _dec(seg.get("max"))
                if da is None or db is None or da > db:
                    continue
                clean.append({"min": float(da), "max": float(db)})
                env_min = da if env_min is None else min(env_min, da)
                env_max = db if env_max is None else max(env_max, db)
            if len(clean) < 2 or env_min is None or env_max is None:
                continue
            MarketResearchDrillLevel.objects.create(
                session=session,
                level_index=idx,
                min_gbp=env_min,
                max_gbp=env_max,
                segments_json=clean,
            )
            continue
        da, db = _dec(level.get("min")), _dec(level.get("max"))
        if da is None or db is None:
            continue
        MarketResearchDrillLevel.objects.create(
            session=session,
            level_index=idx,
            min_gbp=da,
            max_gbp=db,
            segments_json=None,
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


def replace_request_item_research(
    request_item: RequestItem,
    platform: str,
    payload: dict | None,
) -> None:
    _replace_market_research(
        request_item=request_item,
        platform=platform,
        payload=payload,
    )


def replace_repricing_item_research(
    repricing_item: RepricingSessionItem,
    platform: str,
    payload: dict | None,
) -> None:
    _replace_market_research(
        repricing_item=repricing_item,
        platform=platform,
        payload=payload,
    )


def replace_upload_item_research(
    upload_item: UploadSessionItem,
    platform: str,
    payload: dict | None,
) -> None:
    _replace_market_research(
        upload_item=upload_item,
        platform=platform,
        payload=payload,
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
    drill: list[dict[str, Any]] = []
    for l in session.drill_levels.all().order_by("level_index"):
        row: dict[str, Any] = {"min": float(l.min_gbp), "max": float(l.max_gbp)}
        sj = getattr(l, "segments_json", None)
        if isinstance(sj, list) and len(sj) > 1:
            segs: list[dict[str, float]] = []
            for seg in sj:
                if not isinstance(seg, dict):
                    continue
                try:
                    a = float(seg["min"])
                    b = float(seg["max"])
                except (KeyError, TypeError, ValueError):
                    continue
                segs.append({"min": a, "max": b})
            if len(segs) > 1:
                row["kind"] = "multi"
                row["segments"] = segs
        drill.append(row)
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


def _get_session(ri_or_rsi: RequestItem | RepricingSessionItem | UploadSessionItem, platform: str):
    if isinstance(ri_or_rsi, RequestItem):
        return (
            MarketResearchSession.objects.filter(request_item=ri_or_rsi, platform=platform)
            .prefetch_related("listings", "drill_levels")
            .first()
        )
    if isinstance(ri_or_rsi, UploadSessionItem):
        return (
            MarketResearchSession.objects.filter(
                upload_session_item=ri_or_rsi, platform=platform
            )
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

    _META_PASSTHROUGH = (
        "display_title", "display_subtitle", "rrpOffersSource", "authorisedOfferSlots",
        "resolvedCategory", "categoryObject", "category",
        "aiSuggestedNosposStockCategory",
        "aiSuggestedNosposStockFieldValues",
    )

    if snap:
        out = deepcopy(snap) if isinstance(snap, dict) else {}
        if ref is not None:
            out["referenceData"] = ref
        if ebay_blob:
            out["ebayResearchData"] = ebay_blob
        for k in _META_PASSTHROUGH:
            if meta.get(k) is not None:
                out[k] = meta[k]
        return out if out else None

    if ebay_blob:
        out = dict(ebay_blob)
        if ref is not None:
            out["referenceData"] = ref
        for k in _META_PASSTHROUGH:
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


def compose_cash_generator_for_request_item(item: RequestItem) -> dict:
    cg = _get_session(item, MarketResearchPlatform.CASH_GENERATOR)
    return session_to_client_payload(cg) if cg else {}


def compose_raw_data_for_repricing_item(
    item: RepricingSessionItem | UploadSessionItem,
) -> dict:
    ebay = _get_session(item, MarketResearchPlatform.EBAY)
    return session_to_client_payload(ebay) if ebay else {}


def compose_cash_converters_for_repricing_item(
    item: RepricingSessionItem | UploadSessionItem,
) -> dict:
    cc = _get_session(item, MarketResearchPlatform.CASH_CONVERTERS)
    return session_to_client_payload(cc) if cc else {}


def compose_cash_generator_for_repricing_item(
    item: RepricingSessionItem | UploadSessionItem,
) -> dict:
    cg = _get_session(item, MarketResearchPlatform.CASH_GENERATOR)
    return session_to_client_payload(cg) if cg else {}


def ingest_request_item_post_create(
    item: RequestItem, raw_data: Any, cc_data: Any, cg_data: Any = None
) -> None:
    """After RequestItem INSERT: split legacy blobs into normalized rows + JSON context."""
    if raw_data is not None and not isinstance(raw_data, dict):
        raw_data = None
    if cc_data is not None and not isinstance(cc_data, dict):
        cc_data = None
    if cg_data is not None and not isinstance(cg_data, dict):
        cg_data = None
    sync_merged_raw_into_request_item(item, raw_data)
    if cc_data:
        replace_request_item_research(item, MarketResearchPlatform.CASH_CONVERTERS, cc_data)
    if cg_data:
        replace_request_item_research(item, MarketResearchPlatform.CASH_GENERATOR, cg_data)


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
    if "authorisedOfferSlots" in raw:
        slots = raw.get("authorisedOfferSlots")
        if isinstance(slots, list):
            cleaned = [str(s).strip() for s in slots if str(s).strip()]
            meta["authorisedOfferSlots"] = cleaned
        elif slots is None:
            meta.pop("authorisedOfferSlots", None)
    # Persist the category the user selected in the eBay research picker so it
    # survives the backend normalisation round-trip and is restored on reopen.
    resolved = raw.get("resolvedCategory")
    if isinstance(resolved, dict) and resolved.get("name"):
        meta["resolvedCategory"] = resolved
    elif "resolvedCategory" in raw and raw["resolvedCategory"] is None:
        meta.pop("resolvedCategory", None)
    cat_obj = raw.get("categoryObject")
    if isinstance(cat_obj, dict) and cat_obj.get("name"):
        meta["categoryObject"] = cat_obj
    elif "categoryObject" in raw and raw["categoryObject"] is None:
        meta.pop("categoryObject", None)
    cat_name = raw.get("category")
    if cat_name and isinstance(cat_name, str) and cat_name.strip():
        meta["category"] = cat_name.strip()
    elif "category" in raw and not raw["category"]:
        meta.pop("category", None)
    # AI-matched NosPos stock path from extension research (internal category root ready_for_builder).
    nospos_ai = raw.get("aiSuggestedNosposStockCategory")
    if isinstance(nospos_ai, dict) and (
        nospos_ai.get("fullName")
        or nospos_ai.get("nosposId") is not None
        or (isinstance(nospos_ai.get("pathSegments"), list) and len(nospos_ai.get("pathSegments") or []) > 0)
    ):
        meta["aiSuggestedNosposStockCategory"] = nospos_ai
    elif "aiSuggestedNosposStockCategory" in raw and raw["aiSuggestedNosposStockCategory"] is None:
        meta.pop("aiSuggestedNosposStockCategory", None)
    nospos_fields_ai = raw.get("aiSuggestedNosposStockFieldValues")
    if isinstance(nospos_fields_ai, dict) and isinstance(nospos_fields_ai.get("byNosposFieldId"), dict):
        meta["aiSuggestedNosposStockFieldValues"] = nospos_fields_ai
    elif "aiSuggestedNosposStockFieldValues" in raw and raw["aiSuggestedNosposStockFieldValues"] is None:
        meta.pop("aiSuggestedNosposStockFieldValues", None)
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

    cg_embed = raw.get("cgResearchData")
    if isinstance(cg_embed, dict) and _is_market_research_dict(cg_embed):
        replace_request_item_research(item, MarketResearchPlatform.CASH_GENERATOR, cg_embed)

    if _is_cex_product_snapshot_dict(raw):
        strip_keys = {
            "referenceData",
            "reference_data",
            "ebayResearchData",
            "cashConvertersResearchData",
            "cgResearchData",
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


def apply_partial_cg_data_update(item: RequestItem, raw: Any) -> None:
    if raw is None:
        replace_request_item_research(item, MarketResearchPlatform.CASH_GENERATOR, None)
        return
    if isinstance(raw, dict) and raw:
        replace_request_item_research(item, MarketResearchPlatform.CASH_GENERATOR, raw)


def finish_sync_request_item_research(
    item: RequestItem, raw_data: Any, cc_data: Any, cg_data: Any = None
) -> None:
    if raw_data is not None and isinstance(raw_data, dict):
        sync_merged_raw_into_request_item(item, raw_data)
    if cc_data is not None and isinstance(cc_data, dict) and cc_data:
        replace_request_item_research(
            item, MarketResearchPlatform.CASH_CONVERTERS, cc_data
        )
    if cg_data is not None and isinstance(cg_data, dict) and cg_data:
        replace_request_item_research(
            item, MarketResearchPlatform.CASH_GENERATOR, cg_data
        )


def ingest_repricing_line_post_create(
    line: RepricingSessionItem, raw_data: Any, cc_data: Any, cg_data: Any = None
) -> None:
    ingest_stock_session_line_post_create(line, raw_data, cc_data, cg_data)


def ingest_upload_line_post_create(
    line: UploadSessionItem, raw_data: Any, cc_data: Any, cg_data: Any = None
) -> None:
    ingest_stock_session_line_post_create(line, raw_data, cc_data, cg_data)


def ingest_stock_session_line_post_create(
    line: RepricingSessionItem | UploadSessionItem,
    raw_data: Any,
    cc_data: Any,
    cg_data: Any = None,
) -> None:
    if isinstance(line, UploadSessionItem):
        if isinstance(raw_data, dict) and raw_data:
            replace_upload_item_research(line, MarketResearchPlatform.EBAY, raw_data)
        if isinstance(cc_data, dict) and cc_data:
            replace_upload_item_research(
                line, MarketResearchPlatform.CASH_CONVERTERS, cc_data
            )
        if isinstance(cg_data, dict) and cg_data:
            replace_upload_item_research(
                line, MarketResearchPlatform.CASH_GENERATOR, cg_data
            )
        return
    if isinstance(raw_data, dict) and raw_data:
        replace_repricing_item_research(line, MarketResearchPlatform.EBAY, raw_data)
    if isinstance(cc_data, dict) and cc_data:
        replace_repricing_item_research(
            line, MarketResearchPlatform.CASH_CONVERTERS, cc_data
        )
    if isinstance(cg_data, dict) and cg_data:
        replace_repricing_item_research(
            line, MarketResearchPlatform.CASH_GENERATOR, cg_data
        )
