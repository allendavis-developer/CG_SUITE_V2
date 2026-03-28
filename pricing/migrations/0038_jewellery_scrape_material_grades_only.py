# Keep only material/grade values that exist in the scraped reference price sheet so
# frontend matching (material_grade ↔ section row labels) stays aligned.

from decimal import Decimal

from django.db import migrations
from django.utils import timezone


# Labels as they appear on scraped rows (Gold/PGM sections + row text).
ALLOWED_MATERIAL_GRADES = [
    "9ct HM",
    "14ct HM",
    "18ct HM",
    "22ct HM",
    "24ct HM",
    "HM",  # Silver — HM (per kg in scrape)
    "HM Pt",
    "HM Pd",
]


def trim_jewellery_materials(apps, schema_editor):
    ProductCategory = apps.get_model("pricing", "ProductCategory")
    Product = apps.get_model("pricing", "Product")
    Attribute = apps.get_model("pricing", "Attribute")
    AttributeValue = apps.get_model("pricing", "AttributeValue")
    ConditionGrade = apps.get_model("pricing", "ConditionGrade")
    Variant = apps.get_model("pricing", "Variant")
    VariantAttributeValue = apps.get_model("pricing", "VariantAttributeValue")

    try:
        cat = ProductCategory.objects.get(name="Jewellery")
    except ProductCategory.DoesNotExist:
        return

    try:
        attr = Attribute.objects.get(category=cat, code="material_grade")
    except Attribute.DoesNotExist:
        return

    allowed_set = set(ALLOWED_MATERIAL_GRADES)

    # Remove JEW- variants whose material is not in the scrape-aligned allowlist
    qs = Variant.objects.filter(
        product__category=cat,
        cex_sku__startswith="JEW-",
    ).prefetch_related("variant_attribute_values__attribute_value__attribute")

    to_delete = []
    for v in qs:
        mg = None
        for vav in v.variant_attribute_values.all():
            av = vav.attribute_value
            if av.attribute_id == attr.attribute_id:
                mg = av.value
                break
        if mg is None or mg not in allowed_set:
            to_delete.append(v.variant_id)

    if to_delete:
        Variant.objects.filter(variant_id__in=to_delete).delete()

    # Drop attribute values no longer allowed (only for this attribute)
    for av in AttributeValue.objects.filter(attribute=attr):
        if av.value not in allowed_set:
            if not VariantAttributeValue.objects.filter(attribute_value=av).exists():
                av.delete()

    # Ensure allowed values exist
    value_objs = []
    for val in ALLOWED_MATERIAL_GRADES:
        av, _ = AttributeValue.objects.get_or_create(attribute=attr, value=val)
        value_objs.append(av)

    products = list(Product.objects.filter(category=cat))
    try:
        cg = ConditionGrade.objects.get(code="UNKNOWN")
    except ConditionGrade.DoesNotExist:
        cg = ConditionGrade.objects.create(code="UNKNOWN")

    now = timezone.now()
    for p in products:
        for av in value_objs:
            cex_sku = f"JEW-P{p.product_id}-A{av.attribute_value_id}"
            title = f"{p.name} — {av.value}"[:255]
            sig = f"material_grade={av.value}"[:500]
            v, _ = Variant.objects.update_or_create(
                cex_sku=cex_sku,
                defaults={
                    "product_id": p.product_id,
                    "condition_grade_id": cg.condition_grade_id,
                    "current_price_gbp": Decimal("0.01"),
                    "tradein_cash": Decimal("0.00"),
                    "tradein_voucher": Decimal("0.00"),
                    "cex_out_of_stock": False,
                    "variant_signature": sig,
                    "title": title,
                    "cex_price_last_updated_date": now,
                },
            )
            VariantAttributeValue.objects.get_or_create(
                variant=v,
                attribute_value=av,
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0037_jewellery_catalog"),
    ]

    operations = [
        migrations.RunPython(trim_jewellery_materials, noop_reverse),
    ]
