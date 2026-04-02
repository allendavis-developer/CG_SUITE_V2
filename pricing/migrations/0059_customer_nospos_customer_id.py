# NosPos customer profile id from URL /customer/<id>/view (Chrome extension intake)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0058_requestitem_testing_passed"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="nospos_customer_id",
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                help_text="NoSpos customer id from profile URL (e.g. /customer/33757/view)",
                null=True,
                unique=True,
            ),
        ),
    ]
