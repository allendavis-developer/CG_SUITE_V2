# Friendlier material labels (no "HM"); align with how users read the scrape sections.

from django.db import migrations


RENAME_PAIRS = [
    ("9ct HM", "9ct gold"),
    ("14ct HM", "14ct gold"),
    ("18ct HM", "18ct gold"),
    ("22ct HM", "22ct gold"),
    ("24ct HM", "24ct gold"),
    ("HM", "Silver"),
    ("HM Pt", "Platinum"),
    ("HM Pd", "Palladium"),
]


def rename_labels(apps, schema_editor):
    ProductCategory = apps.get_model("pricing", "ProductCategory")
    Attribute = apps.get_model("pricing", "Attribute")
    AttributeValue = apps.get_model("pricing", "AttributeValue")
    Variant = apps.get_model("pricing", "Variant")

    try:
        cat = ProductCategory.objects.get(name="Jewellery")
    except ProductCategory.DoesNotExist:
        return

    try:
        attr = Attribute.objects.get(category=cat, code="material_grade")
    except Attribute.DoesNotExist:
        return

    for old, new in RENAME_PAIRS:
        AttributeValue.objects.filter(attribute=attr, value=old).update(value=new)

    for v in Variant.objects.filter(
        product__category=cat,
        cex_sku__startswith="JEW-",
    ).select_related("product"):
        mg = None
        for vav in v.variant_attribute_values.select_related("attribute_value__attribute").all():
            av = vav.attribute_value
            if av.attribute_id == attr.attribute_id:
                mg = av.value
                break
        if mg is None:
            continue
        v.title = f"{v.product.name} — {mg}"[:255]
        v.variant_signature = f"material_grade={mg}"[:500]
        v.save(update_fields=["title", "variant_signature"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0038_jewellery_scrape_material_grades_only"),
    ]

    operations = [
        migrations.RunPython(rename_labels, noop_reverse),
    ]
