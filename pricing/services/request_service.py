"""Business logic for the Request lifecycle.

Views in ``pricing.views.requests`` are thin controllers. They parse inputs,
call one of the ``finalize``, ``update_item``, ``complete_after_testing``
functions here, and translate :class:`RequestServiceError` into HTTP responses.

Every ORM write, field-level validation, and status transition lives here so
the view layer is free of business rules.

Status-transition cheat sheet
-----------------------------
QUOTE             -- ``finalize(save_only=False)`` -->  BOOKED_FOR_TESTING
BOOKED_FOR_TESTING -- ``complete_after_testing``   -->  COMPLETE

``finalize(save_only=True)`` saves negotiation data but leaves status as QUOTE
(used when the user closes the tab / saves a draft).
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from pricing import research_storage
from pricing.buying_decimal import parse_optional_money
from pricing.models_v2 import (
    Request,
    RequestItem,
    RequestStatus,
    RequestStatusHistory,
)
from pricing.offer_rows import (
    get_selected_offer_code,
    sync_request_item_offer_rows_from_payload,
)
from pricing.views._shared import (
    _is_jewellery_placeholder_variant,
    _sync_request_jewellery_reference_snapshot,
)


# =============================================================================
# Errors
# =============================================================================

class RequestServiceError(Exception):
    """Raised on any validation / state failure.

    Carries an HTTP ``status_code`` so views can translate the error directly
    without needing a second mapping table.
    """

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# =============================================================================
# Public API
# =============================================================================

def finalize(*, request_id: int, data: dict, save_only: bool) -> dict:
    """Save negotiation data and (unless ``save_only``) move QUOTE to BOOKED_FOR_TESTING.

    Parameters
    ----------
    request_id : int
        Primary key of the Request.
    data : dict
        Parsed JSON body (typically ``request.data`` from the view).
    save_only : bool
        When True, save everything but leave status at QUOTE (draft / tab-close).
    """
    req = _get_quote_request(request_id)
    _require_has_items(req)

    _apply_request_level_fields(req, data)
    # The legacy behavior always saves these three fields, even when untouched —
    # we preserve that to keep DB writes byte-equivalent for audit diffs.
    req.save(update_fields=[
        "overall_expectation_gbp",
        "negotiated_grand_total_gbp",
        "target_offer_gbp",
        *(["customer_enrichment_json"] if "customer_enrichment" in data and data["customer_enrichment"] is not None else []),
        *(["current_jewellery_reference_snapshot"] if data.get("jewellery_reference_scrape") is not None else []),
    ])

    for item_data in (data.get("items_data") or []):
        _apply_item_during_finalize(req, item_data)

    if not save_only:
        _transition_to_testing(req)

    return {
        "request_id": req.request_id,
        "status": RequestStatus.QUOTE if save_only else RequestStatus.BOOKED_FOR_TESTING,
        "items_count": req.items.count(),
        "overall_expectation_gbp": req.overall_expectation_gbp,
        "negotiated_grand_total_gbp": req.negotiated_grand_total_gbp,
        "target_offer_gbp": req.target_offer_gbp,
    }


def update_item(*, request_item_id: int, data: dict) -> RequestItem:
    """Update one RequestItem. Behavior depends on parent request's status.

    - **QUOTE**: full item + offer-row updates.
    - **BOOKED_FOR_TESTING**: only ``testing_passed`` may change.
    """
    item = _get_item(request_item_id)
    current = item.request.status_history.first()
    if not current:
        raise RequestServiceError("Request has no status history")

    if current.status == RequestStatus.BOOKED_FOR_TESTING:
        return _apply_testing_passed_only(item, data)

    if current.status != RequestStatus.QUOTE:
        raise RequestServiceError(
            "Can only update items in QUOTE or BOOKED_FOR_TESTING requests"
        )

    return _apply_item_update(item, data)


def complete_after_testing(*, request_id: int) -> dict:
    """Move BOOKED_FOR_TESTING -> COMPLETE after every negotiated line has passed testing."""
    req = _get_request(request_id)
    current = req.status_history.first()
    if not current or current.status != RequestStatus.BOOKED_FOR_TESTING:
        raise RequestServiceError(
            "Only requests that are booked for testing can be marked as passed."
        )

    eligible = [i for i in req.items.all() if i.negotiated_price_gbp is not None]
    if not eligible:
        raise RequestServiceError("Request has no negotiated lines to complete.")
    if not all(i.testing_passed for i in eligible):
        raise RequestServiceError(
            "Mark testing passed on every active line before completing the request."
        )

    with transaction.atomic():
        RequestStatusHistory.objects.create(request=req, status=RequestStatus.COMPLETE)

    return {"request_id": req.request_id, "status": RequestStatus.COMPLETE}


# =============================================================================
# Lookup helpers
# =============================================================================

def _get_request(request_id: int) -> Request:
    try:
        return Request.objects.get(request_id=request_id)
    except Request.DoesNotExist:
        raise RequestServiceError("Request not found", status_code=404)


def _get_quote_request(request_id: int) -> Request:
    req = _get_request(request_id)
    current = req.status_history.first()
    if not current or current.status != RequestStatus.QUOTE:
        raise RequestServiceError("Can only finalize QUOTE requests")
    return req


def _get_item(request_item_id: int) -> RequestItem:
    try:
        return RequestItem.objects.select_related("request", "variant").get(
            request_item_id=request_item_id
        )
    except RequestItem.DoesNotExist:
        raise RequestServiceError("Request item not found", status_code=404)


def _require_has_items(req: Request) -> None:
    if not req.items.exists():
        raise RequestServiceError("Cannot finalize request with no items")


# =============================================================================
# Request-level field application (finalize)
# =============================================================================

def _apply_request_level_fields(req: Request, data: dict) -> None:
    """Populate the request's negotiation fields in-place (no DB write here)."""
    for field in ("overall_expectation_gbp", "negotiated_grand_total_gbp", "target_offer_gbp"):
        if data.get(field) is not None:
            _assign_money(req, field, data[field])

    enrichment = data.get("customer_enrichment")
    if enrichment is not None:
        if not isinstance(enrichment, dict):
            raise RequestServiceError("customer_enrichment must be a JSON object")
        req.customer_enrichment_json = enrichment

    jewellery_ref = data.get("jewellery_reference_scrape")
    if jewellery_ref is not None:
        try:
            _sync_request_jewellery_reference_snapshot(req, jewellery_ref)
        except ValueError as exc:
            raise RequestServiceError(str(exc))


# =============================================================================
# Per-item application (finalize path)
# =============================================================================

def _apply_item_during_finalize(req: Request, item_data: dict) -> None:
    """Apply one entry from ``items_data`` during finalize()."""
    item_id = item_data.get("request_item_id")
    if not item_id:
        raise RequestServiceError(
            "Each item in items_data must have a 'request_item_id'"
        )
    try:
        item = req.items.get(request_item_id=item_id)
    except RequestItem.DoesNotExist:
        raise RequestServiceError(
            f"RequestItem with ID {item_id} not found for this request",
            status_code=404,
        )

    update_fields: list[str] = []
    _apply_cex_at_negotiation(item, item_data, update_fields)
    _apply_common_item_fields(item, item_data, update_fields)

    if any(k in item_data for k in ("raw_data", "cash_converters_data", "cg_data")):
        research_storage.finish_sync_request_item_research(
            item,
            item_data.get("raw_data"),
            item_data.get("cash_converters_data"),
            item_data.get("cg_data"),
        )

    if update_fields:
        item.save(update_fields=update_fields)

    cash, voucher, selected = _extract_offer_payloads(item_data)
    _sync_offer_rows_if_needed(item, cash, voucher, selected, update_fields)


# =============================================================================
# Per-item application (PATCH /request-items/:id)
# =============================================================================

def _apply_item_update(item: RequestItem, data: dict) -> RequestItem:
    """Apply a PATCH to a single RequestItem (QUOTE path)."""
    update_fields: list[str] = []
    cash, voucher, selected = _extract_offer_payloads(data)

    if "manual_offer_used" in data:
        item.manual_offer_used = bool(data["manual_offer_used"])
        update_fields.append("manual_offer_used")

    if "manual_offer_gbp" in data:
        _assign_money(item, "manual_offer_gbp", data["manual_offer_gbp"])
        update_fields.append("manual_offer_gbp")

    if "customer_expectation_gbp" in data:
        _assign_customer_expectation(item, data["customer_expectation_gbp"])
        update_fields.append("customer_expectation_gbp")

    if "our_sale_price_at_negotiation" in data:
        _assign_money(item, "our_sale_price_at_negotiation", data["our_sale_price_at_negotiation"])
        update_fields.append("our_sale_price_at_negotiation")

    if "quantity" in data:
        try:
            item.quantity = max(1, int(data["quantity"]))
            update_fields.append("quantity")
        except (ValueError, TypeError):
            pass  # Matches legacy behaviour: invalid quantity is silently ignored.

    if "senior_mgmt_approved_by" in data:
        _apply_senior_mgmt_name(item, data.get("senior_mgmt_approved_by"))
        update_fields.append("line_metadata_json")

    if update_fields:
        item.save(update_fields=update_fields)
    _sync_offer_rows_if_needed(item, cash, voucher, selected, update_fields)
    return item


def _apply_testing_passed_only(item: RequestItem, data: dict) -> RequestItem:
    """BOOKED_FOR_TESTING allows toggling ``testing_passed`` and nothing else."""
    extra = set(data.keys()) - {"testing_passed"}
    if extra:
        raise RequestServiceError(
            "For booked-for-testing requests, only 'testing_passed' may be updated on a line."
        )
    if "testing_passed" not in data:
        raise RequestServiceError("Missing 'testing_passed'")
    item.testing_passed = bool(data["testing_passed"])
    item.save(update_fields=["testing_passed"])
    return item


# =============================================================================
# Shared per-item helpers
# =============================================================================

def _apply_cex_at_negotiation(item: RequestItem, data: dict, update_fields: list[str]) -> None:
    """Snapshot CEX prices onto the item at negotiation time.

    If the payload carries any ``cex_*_at_negotiation`` value we honour it.
    Otherwise, and only when the variant is a real catalogue row (not a
    jewellery placeholder), we copy the live variant prices.
    """
    cex_fields = (
        "cex_buy_cash_at_negotiation",
        "cex_buy_voucher_at_negotiation",
        "cex_sell_at_negotiation",
    )
    payload_carries_cex = any(f in data for f in cex_fields)

    if payload_carries_cex:
        for field in cex_fields:
            if data.get(field) is not None:
                _assign_money(item, field, data[field])
                update_fields.append(field)
        return

    if item.variant and not _is_jewellery_placeholder_variant(item.variant):
        item.cex_buy_cash_at_negotiation = item.variant.tradein_cash
        item.cex_buy_voucher_at_negotiation = item.variant.tradein_voucher
        item.cex_sell_at_negotiation = item.variant.current_price_gbp
        update_fields.extend(cex_fields)


def _apply_common_item_fields(item: RequestItem, data: dict, update_fields: list[str]) -> None:
    """Apply fields shared between finalize(per-item) and update_item()."""
    if "quantity" in data:
        item.quantity = data["quantity"]
        update_fields.append("quantity")
    if "manual_offer_gbp" in data:
        _assign_money(item, "manual_offer_gbp", data["manual_offer_gbp"])
        update_fields.append("manual_offer_gbp")
    if "customer_expectation_gbp" in data:
        _assign_money(item, "customer_expectation_gbp", data["customer_expectation_gbp"])
        update_fields.append("customer_expectation_gbp")
    if "negotiated_price_gbp" in data:
        _assign_money(item, "negotiated_price_gbp", data["negotiated_price_gbp"])
        update_fields.append("negotiated_price_gbp")
    if "our_sale_price_at_negotiation" in data:
        _assign_money(item, "our_sale_price_at_negotiation",
                      data["our_sale_price_at_negotiation"])
        update_fields.append("our_sale_price_at_negotiation")
    if "manual_offer_used" in data:
        item.manual_offer_used = bool(data["manual_offer_used"])
        update_fields.append("manual_offer_used")
    if "senior_mgmt_approved_by" in data:
        _apply_senior_mgmt_name(item, data.get("senior_mgmt_approved_by"))
        update_fields.append("line_metadata_json")


# =============================================================================
# Field-level helpers
# =============================================================================

def _assign_money(instance, field: str, value) -> None:
    """Validate + assign a money-style DecimalField on a model instance."""
    try:
        setattr(instance, field,
                parse_optional_money(type(instance), field, value, instance))
    except DjangoValidationError as e:
        msg = e.messages[0] if e.messages else f"Invalid {field}"
        raise RequestServiceError(msg)


def _assign_customer_expectation(item: RequestItem, value) -> None:
    """``customer_expectation_gbp`` on PATCH accepts empty string / None to clear."""
    if value is None or value == "":
        item.customer_expectation_gbp = None
        return
    try:
        dec = Decimal(str(value))
        RequestItem._meta.get_field("customer_expectation_gbp").clean(dec, item)
        item.customer_expectation_gbp = dec
    except (InvalidOperation, TypeError):
        raise RequestServiceError("Invalid format for customer_expectation_gbp")
    except DjangoValidationError as e:
        msg = e.messages[0] if e.messages else "Invalid customer_expectation_gbp"
        raise RequestServiceError(msg)


def _apply_senior_mgmt_name(item: RequestItem, value) -> None:
    """Set / clear the approver name inside ``line_metadata_json``."""
    meta = dict(item.line_metadata_json or {})
    name = str(value).strip() if value is not None else ""
    if name:
        meta["senior_mgmt_approved_by"] = name
    else:
        meta.pop("senior_mgmt_approved_by", None)
    item.line_metadata_json = meta if meta else None


def _extract_offer_payloads(data: dict):
    """Pull the three offer-payload keys, preserving present-vs-missing semantics.

    Returns ``(cash, voucher, selected_id)``. Each is ``None`` when the caller
    did not include the key — so we can distinguish *not provided* from
    *explicitly cleared to []*.
    """
    cash = data["cash_offers_json"] or [] if "cash_offers_json" in data else None
    voucher = data["voucher_offers_json"] or [] if "voucher_offers_json" in data else None
    selected_id = data["selected_offer_id"] if "selected_offer_id" in data else None
    if isinstance(selected_id, str) and selected_id.strip() == "":
        selected_id = None
    return cash, voucher, selected_id


def _sync_offer_rows_if_needed(item: RequestItem, cash, voucher, selected_id,
                               update_fields: list[str]) -> None:
    """Rebuild RequestItemOffer rows when any offer-relevant field changed."""
    changed = (
        selected_id is not None
        or "manual_offer_gbp" in update_fields
        or cash is not None
        or voucher is not None
    )
    if not changed:
        return
    try:
        sync_request_item_offer_rows_from_payload(
            item,
            selected_offer_id=(
                selected_id if selected_id is not None else get_selected_offer_code(item)
            ),
            cash_offers=cash or [],
            voucher_offers=voucher or [],
            manual_offer_gbp=item.manual_offer_gbp,
        )
    except ValueError as exc:
        raise RequestServiceError(str(exc))


# =============================================================================
# Status transitions
# =============================================================================

def _transition_to_testing(req: Request) -> None:
    """QUOTE -> BOOKED_FOR_TESTING. Fresh testing flags so staff must tick each line."""
    RequestStatusHistory.objects.create(
        request=req, status=RequestStatus.BOOKED_FOR_TESTING,
    )
    req.items.update(testing_passed=False)
