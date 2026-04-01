from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0055_pricingrule_ebay_offer_margin_4_pct"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerrulesettings",
            name="jewellery_offer_margin_1_pct",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("30.00"),
                help_text="Jewellery 1st offer margin % vs reference total.",
                max_digits=5,
            ),
        ),
        migrations.AddField(
            model_name="customerrulesettings",
            name="jewellery_offer_margin_2_pct",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("20.00"),
                help_text="Jewellery 2nd offer margin % vs reference total.",
                max_digits=5,
            ),
        ),
        migrations.AddField(
            model_name="customerrulesettings",
            name="jewellery_offer_margin_3_pct",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("10.00"),
                help_text="Jewellery 3rd offer margin % vs reference total.",
                max_digits=5,
            ),
        ),
        migrations.AddField(
            model_name="customerrulesettings",
            name="jewellery_offer_margin_4_pct",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("5.00"),
                help_text="Jewellery 4th offer margin % vs reference total.",
                max_digits=5,
            ),
        ),
    ]
