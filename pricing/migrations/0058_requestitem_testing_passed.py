# Generated manually — per-line testing gate before request can move to COMPLETE

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0057_jewellery_coin_silver_variant"),
    ]

    operations = [
        migrations.AddField(
            model_name="requestitem",
            name="testing_passed",
            field=models.BooleanField(
                default=False,
                help_text="In-store testing passed for this line (BOOKED_FOR_TESTING workflow)",
            ),
        ),
    ]
