from decimal import Decimal, InvalidOperation

from .models_v2 import RequestItemOffer, RequestItemOfferType


def _offer_slot_from_code(offer_code):
    if not offer_code or "_" not in str(offer_code):
        return None
    suffix = str(offer_code).rsplit("_", 1)[-1]
    try:
        return int(suffix)
    except (TypeError, ValueError):
        return None


def _build_offer_rows(request_item, offer_type, offers, selected_offer_id):
    rows = []
    if not isinstance(offers, list):
        return rows
    for index, offer in enumerate(offers):
        if not isinstance(offer, dict):
            continue
        offer_code = str(offer.get("id") or "").strip()
        if not offer_code:
            continue
        try:
            price_dec = Decimal(str(offer.get("price")))
        except (InvalidOperation, TypeError, ValueError):
            continue
        margin_raw = offer.get("margin")
        margin_dec = None
        if margin_raw not in (None, ""):
            try:
                margin_dec = Decimal(str(margin_raw))
            except (InvalidOperation, TypeError, ValueError):
                margin_dec = None
        rows.append(
            RequestItemOffer(
                request_item=request_item,
                offer_type=offer_type,
                offer_code=offer_code,
                title=str(offer.get("title") or "")[:128],
                offer_slot=_offer_slot_from_code(offer_code),
                price_gbp=price_dec,
                margin_pct=margin_dec,
                is_highlighted=bool(offer.get("isHighlighted")),
                is_selected=(offer_code == (selected_offer_id or "")),
                sort_order=index,
            )
        )
    return rows


def sync_request_item_offer_rows(request_item):
    return sync_request_item_offer_rows_from_payload(
        request_item,
        selected_offer_id=None,
        cash_offers=[],
        voucher_offers=[],
        manual_offer_gbp=request_item.manual_offer_gbp,
    )


def sync_request_item_offer_rows_from_payload(
    request_item,
    *,
    selected_offer_id,
    cash_offers,
    voucher_offers,
    manual_offer_gbp,
):
    rows = []
    rows.extend(
        _build_offer_rows(
            request_item,
            RequestItemOfferType.CASH,
            cash_offers or [],
            selected_offer_id,
        )
    )
    rows.extend(
        _build_offer_rows(
            request_item,
            RequestItemOfferType.VOUCHER,
            voucher_offers or [],
            selected_offer_id,
        )
    )
    if manual_offer_gbp is not None:
        rows.append(
            RequestItemOffer(
                request_item=request_item,
                offer_type=RequestItemOfferType.MANUAL,
                offer_code="manual",
                title="Manual Offer",
                offer_slot=None,
                price_gbp=manual_offer_gbp,
                margin_pct=None,
                is_highlighted=False,
                is_selected=(selected_offer_id == "manual"),
                sort_order=999,
            )
        )
    RequestItemOffer.objects.filter(request_item=request_item).delete()
    if rows:
        RequestItemOffer.objects.bulk_create(rows)


def compose_offer_json_from_rows(request_item, offer_type):
    rows = request_item.offer_rows.filter(offer_type=offer_type).order_by("sort_order", "request_item_offer_id")
    out = []
    for row in rows:
        item = {
            "id": row.offer_code,
            "title": row.title or "",
            "price": float(row.price_gbp),
        }
        if row.margin_pct is not None:
            item["margin"] = float(row.margin_pct)
        if row.is_highlighted:
            item["isHighlighted"] = True
        out.append(item)
    return out


def get_selected_offer_code(request_item):
    row = (
        request_item.offer_rows.filter(is_selected=True)
        .order_by("request_item_offer_id")
        .first()
    )
    return row.offer_code if row else None



