from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0063_alter_customerofferrule_allow_offer_4_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="NosposAttribute",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "nospos_id",
                    models.PositiveIntegerField(
                        db_index=True,
                        help_text="Attribute id from NosPos (grid data-key).",
                        unique=True,
                    ),
                ),
                ("summary", models.TextField(blank=True, help_text="Joined visible cells from the index grid.")),
                ("extra", models.JSONField(blank=True, default=dict, help_text="Raw scrape fields (e.g. cellTexts).")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "NosPos attribute",
                "verbose_name_plural": "NosPos attributes",
                "db_table": "nosposattribute",
                "ordering": ["nospos_id"],
            },
        ),
    ]
