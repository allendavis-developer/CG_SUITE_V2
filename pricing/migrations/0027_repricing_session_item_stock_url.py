from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0026_repricing_session_item_stock_barcode"),
    ]

    operations = [
        migrations.AddField(
            model_name="repricingsessionitem",
            name="stock_url",
            field=models.URLField(
                max_length=500,
                blank=True,
                default="",
                help_text="Link to the stock page in NoSPos / stock system",
            ),
        ),
    ]

