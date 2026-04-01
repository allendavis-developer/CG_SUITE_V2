from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0054_customer_offer_rules_and_third_offer_pct"),
    ]

    operations = [
        migrations.AddField(
            model_name="pricingrule",
            name="ebay_offer_margin_4_pct",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Fourth offer as % of suggested sale price (top tier; typically match sale). E.g. 100 means offer = suggestedPrice × 1.00. Default 100 when blank.",
                max_digits=5,
                null=True,
            ),
        ),
    ]
