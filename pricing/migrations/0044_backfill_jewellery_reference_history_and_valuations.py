from decimal import Decimal, InvalidOperation

from django.db import migrations
from django.utils.dateparse import parse_datetime
from django.utils import timezone


def _to_decimal(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    try:
        txt = str(value).replace("£", "").replace(",", "").strip()
        if txt == "":
            return None
        return Decimal(txt)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _to_datetime(value):
    if value in (None, ""):
        return None
    if hasattr(value, "tzinfo"):
        return value
    return parse_datetime(str(value))


def forward_backfill(apps, schema_editor):
    Request = apps.get_model("pricing", "Request")
    RequestJewelleryReferenceSnapshot = apps.get_model("pricing", "RequestJewelleryReferenceSnapshot")
    RequestItemJewellery = apps.get_model("pricing", "RequestItemJewellery")
    RequestItemJewelleryValuation = apps.get_model("pricing", "RequestItemJewelleryValuation")

    request_to_snapshot_id = {}

    requests = Request.objects.filter(jewellery_reference_scrape_json__isnull=False).iterator()
    for req in requests:
        payload = req.jewellery_reference_scrape_json or {}
        if not isinstance(payload, dict):
            continue
        sections = payload.get("sections")
        if not isinstance(sections, list) or len(sections) == 0:
            continue

        snapshot = RequestJewelleryReferenceSnapshot.objects.create(
            request_id=req.request_id,
            source_name="Mastermelt",
            source_url=str(payload.get("sourceUrl") or ""),
            scraped_at=_to_datetime(payload.get("scrapedAt")),
            sections_json=sections,
        )
        req.current_jewellery_reference_snapshot_id = snapshot.snapshot_id
        req.save(update_fields=["current_jewellery_reference_snapshot"])
        request_to_snapshot_id[req.request_id] = snapshot.snapshot_id

    jewellery_rows = RequestItemJewellery.objects.select_related("request_item").iterator()
    for row in jewellery_rows:
        request_item = row.request_item
        ref = request_item.cex_reference_json or {}
        if not isinstance(ref, dict):
            continue
        if ref.get("jewellery_line") is not True:
            continue

        computed_total = _to_decimal(ref.get("computed_total_gbp"))
        if computed_total is None or computed_total < 0:
            continue

        basis_weight = row.measured_gross_weight_grams
        if basis_weight is None:
            input_weight = _to_decimal(ref.get("weight"))
            unit = str(ref.get("weight_unit") or "g").lower().strip()
            if input_weight is not None and input_weight > 0 and unit in {"g", "kg"}:
                basis_weight = input_weight * Decimal("1000") if unit == "kg" else input_weight

        snapshot_id = request_to_snapshot_id.get(request_item.request_id) or getattr(
            request_item.request, "current_jewellery_reference_snapshot_id", None
        )

        RequestItemJewelleryValuation.objects.get_or_create(
            request_item_jewellery_id=row.request_item_id,
            valuation_source="Mastermelt",
            computed_total_gbp=computed_total,
            defaults={
                "source_reference_snapshot_id": snapshot_id,
                "rate_per_gram_gbp": _to_decimal(ref.get("rate_per_gram")),
                "unit_price_gbp": _to_decimal(ref.get("unit_price")),
                "basis_weight_grams": basis_weight,
                "valuation_payload_json": ref,
                "is_selected": True,
                "selected_at": timezone.now(),
            },
        )


def reverse_backfill(apps, schema_editor):
    RequestJewelleryReferenceSnapshot = apps.get_model("pricing", "RequestJewelleryReferenceSnapshot")
    RequestItemJewelleryValuation = apps.get_model("pricing", "RequestItemJewelleryValuation")

    RequestItemJewelleryValuation.objects.filter(valuation_source="Mastermelt").delete()
    RequestJewelleryReferenceSnapshot.objects.filter(source_name="Mastermelt").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0043_requestjewelleryreferencesnapshot_and_more"),
    ]

    operations = [
        migrations.RunPython(forward_backfill, reverse_backfill),
    ]

