from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0039_rename_jewellery_material_labels"),
    ]

    operations = [
        migrations.AddField(
            model_name="request",
            name="jewellery_reference_scrape_json",
            field=models.JSONField(
                blank=True,
                null=True,
                help_text="Cached Mastermelt-style reference sections from the jewellery workspace scrape",
            ),
        ),
    ]
