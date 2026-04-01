# Add Silver material variant under Coin (1 troy oz reference — see frontend jewellerySilverCoinReference).

from decimal import Decimal

from django.db import migrations
from django.utils import timezone


def add_coin_silver_variant(apps, schema_editor):
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

    av, _ = AttributeValue.objects.get_or_create(attribute=attr, value="Silver")

    try:
        coin = Product.objects.get(category=cat, name="Coin")
    except Product.DoesNotExist:
        return

    try:
        cg = ConditionGrade.objects.get(code="UNKNOWN")
    except ConditionGrade.DoesNotExist:
        cg = ConditionGrade.objects.create(code="UNKNOWN")

    cex_sku = f"JEW-P{coin.product_id}-A{av.attribute_value_id}"
    title = f"{coin.name} — {av.value}"[:255]
    sig = f"material_grade={av.value}"[:500]
    now = timezone.now()
    v, _ = Variant.objects.update_or_create(
        cex_sku=cex_sku,
        defaults={
            "product_id": coin.product_id,
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
        ("pricing", "0056_customerrulesettings_jewellery_offer_margin_fields"),
    ]

    operations = [
        migrations.RunPython(add_coin_silver_variant, noop_reverse),
    ]
