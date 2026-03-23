# Generated manually — convert stored values from gross margin % on sale to % of sale price for offers.
# Old: offer = sell × (1 - margin/100). New: offer = sell × (pct/100). So pct = 100 - margin.

from decimal import Decimal

from django.db import migrations


def forwards_convert_margin_to_pct_of_sale(apps, schema_editor):
    PricingRule = apps.get_model("pricing", "PricingRule")
    fields = (
        "ebay_offer_margin_1_pct",
        "ebay_offer_margin_2_pct",
        "ebay_offer_margin_3_pct",
    )
    for rule in PricingRule.objects.all():
        updates = {}
        for fname in fields:
            val = getattr(rule, fname)
            if val is not None:
                updates[fname] = Decimal("100") - val
        if updates:
            for k, v in updates.items():
                setattr(rule, k, v)
            rule.save(update_fields=list(updates.keys()))


def backwards_convert_pct_to_margin(apps, schema_editor):
    PricingRule = apps.get_model("pricing", "PricingRule")
    fields = (
        "ebay_offer_margin_1_pct",
        "ebay_offer_margin_2_pct",
        "ebay_offer_margin_3_pct",
    )
    for rule in PricingRule.objects.all():
        updates = {}
        for fname in fields:
            val = getattr(rule, fname)
            if val is not None:
                updates[fname] = Decimal("100") - val
        if updates:
            for k, v in updates.items():
                setattr(rule, k, v)
            rule.save(update_fields=list(updates.keys()))


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0033_add_ebay_offer_margins"),
    ]

    operations = [
        migrations.RunPython(forwards_convert_margin_to_pct_of_sale, backwards_convert_pct_to_margin),
    ]
