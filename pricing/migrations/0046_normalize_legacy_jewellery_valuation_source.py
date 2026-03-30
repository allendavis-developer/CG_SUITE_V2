from django.db import migrations


def forward(apps, schema_editor):
    RequestItemJewelleryValuation = apps.get_model("pricing", "RequestItemJewelleryValuation")
    RequestItemJewelleryValuation.objects.filter(valuation_source="LEGACY_IMPORT").update(
        valuation_source="Mastermelt"
    )


def reverse(apps, schema_editor):
    RequestItemJewelleryValuation = apps.get_model("pricing", "RequestItemJewelleryValuation")
    RequestItemJewelleryValuation.objects.filter(valuation_source="Mastermelt").update(
        valuation_source="LEGACY_IMPORT"
    )


class Migration(migrations.Migration):
    dependencies = [
        ("pricing", "0045_remove_request_jewellery_reference_scrape_json"),
    ]

    operations = [
        migrations.RunPython(forward, reverse),
    ]

