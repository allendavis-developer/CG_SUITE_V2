from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0025_repricing_session_and_items"),
    ]

    operations = [
        migrations.AddField(
            model_name="repricingsessionitem",
            name="stock_barcode",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
    ]
