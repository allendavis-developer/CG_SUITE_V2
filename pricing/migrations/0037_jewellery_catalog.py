# Jewellery category: products × material_grade variants (CeX-style SKUs prefixed JEW-).

from decimal import Decimal

from django.db import migrations
from django.utils import timezone


PRODUCT_NAMES = [
    "Earrings",
    "Scrap",
    "Bangles",
    "Rings",
    "Necklaces",
    "Bracelets",
    "Chains",
    "Pendant",
    "Bullion (gold)",
    "Bullion (other)",
]

# Initial seed; 0038_jewellery_scrape_material_grades_only trims to scrape-only labels (Gold ct HM, Silver HM, …).
MATERIAL_GRADES = [
    "9ct HM",
    "10ct",
    "14ct HM",
    "15ct",
    "18ct HM",
    "22ct HM",
    "24ct HM",
    "Fine gold",
    "Silver HM",
    "Silver coins",
    "Platinum",
    "Palladium",
    "Half Sovereign",
    "Full Sovereign",
    "Krugerrand",
]


def seed_jewellery_catalog(apps, schema_editor):
    ProductCategory = apps.get_model("pricing", "ProductCategory")
    Product = apps.get_model("pricing", "Product")
    Attribute = apps.get_model("pricing", "Attribute")
    AttributeValue = apps.get_model("pricing", "AttributeValue")
    ConditionGrade = apps.get_model("pricing", "ConditionGrade")
    Variant = apps.get_model("pricing", "Variant")
    VariantAttributeValue = apps.get_model("pricing", "VariantAttributeValue")

    cat, _ = ProductCategory.objects.get_or_create(
        name="Jewellery",
        defaults={"parent_category": None},
    )

    attr, _ = Attribute.objects.get_or_create(
        category=cat,
        code="material_grade",
        defaults={"label": "Material / grade"},
    )

    value_objs = []
    for val in MATERIAL_GRADES:
        av, _ = AttributeValue.objects.get_or_create(attribute=attr, value=val)
        value_objs.append(av)

    products = []
    for name in PRODUCT_NAMES:
        p, _ = Product.objects.get_or_create(
            category=cat,
            name=name,
            defaults={"manufacturer_id": None},
        )
        products.append(p)

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
        ("pricing", "0036_market_research_normalize"),
    ]

    operations = [
        migrations.RunPython(seed_jewellery_catalog, noop_reverse),
    ]
