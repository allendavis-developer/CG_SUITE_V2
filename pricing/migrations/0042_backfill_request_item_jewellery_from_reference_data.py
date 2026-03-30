from decimal import Decimal, InvalidOperation

from django.db import migrations
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


def _resolve_material_grade_id(AttributeValue, material_attr_id, material_grade):
    if not material_attr_id or not material_grade:
        return None
    exact = (
        AttributeValue.objects.filter(attribute_id=material_attr_id, value=material_grade)
        .values_list("attribute_value_id", flat=True)
        .first()
    )
    if exact:
        return exact
    return (
        AttributeValue.objects.filter(attribute_id=material_attr_id, value__iexact=material_grade)
        .values_list("attribute_value_id", flat=True)
        .first()
    )


def forward_backfill(apps, schema_editor):
    RequestItem = apps.get_model("pricing", "RequestItem")
    RequestItemJewellery = apps.get_model("pricing", "RequestItemJewellery")
    Attribute = apps.get_model("pricing", "Attribute")
    AttributeValue = apps.get_model("pricing", "AttributeValue")

    material_attr_id = (
        Attribute.objects.filter(code="material_grade")
        .order_by("attribute_id")
        .values_list("attribute_id", flat=True)
        .first()
    )

    qs = RequestItem.objects.filter(cex_reference_json__isnull=False).iterator()
    for item in qs:
        ref = item.cex_reference_json or {}
        if not isinstance(ref, dict):
            continue
        if ref.get("jewellery_line") is not True:
            continue

        input_weight = _to_decimal(ref.get("weight"))
        input_unit = str(ref.get("weight_unit") or "g").strip().lower()
        if input_unit not in {"g", "kg", "each"}:
            input_unit = "g"

        gross_weight_grams = None
        if input_weight is not None and input_weight > 0 and input_unit in {"g", "kg"}:
            gross_weight_grams = input_weight * Decimal("1000") if input_unit == "kg" else input_weight

        material_grade = ref.get("material_grade")
        material_grade_id = _resolve_material_grade_id(
            AttributeValue,
            material_attr_id,
            material_grade,
        )

        defaults = {
            "material_grade_id": material_grade_id,
            "measured_gross_weight_grams": gross_weight_grams,
            "input_weight_value": input_weight,
            "input_weight_unit": input_unit,
            "measurement_source": "IMPORTED",
            "measured_by_name": None,
            "measured_at": timezone.now(),
        }
        RequestItemJewellery.objects.update_or_create(
            request_item_id=item.request_item_id,
            defaults=defaults,
        )


def reverse_backfill(apps, schema_editor):
    RequestItemJewellery = apps.get_model("pricing", "RequestItemJewellery")
    RequestItemJewellery.objects.filter(measurement_source="IMPORTED").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0041_requestitemjewellery_inventoryunitjewellery_and_more"),
    ]

    operations = [
        migrations.RunPython(forward_backfill, reverse_backfill),
    ]

