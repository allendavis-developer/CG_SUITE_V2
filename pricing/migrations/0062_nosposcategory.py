import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0061_nospos_category_mapping"),
    ]

    operations = [
        migrations.CreateModel(
            name="NosposCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nospos_id", models.PositiveIntegerField(db_index=True, help_text="Category id from NosPos (grid data-key / #column).", unique=True)),
                ("level", models.PositiveSmallIntegerField(help_text="Depth from NosPos (0 = root, 1 = child, …).")),
                (
                    "full_name",
                    models.CharField(
                        help_text="Full path as shown in NosPos, using ' > ' between segments.",
                        max_length=1024,
                    ),
                ),
                ("status", models.CharField(blank=True, help_text="e.g. Active / Inactive", max_length=32)),
                (
                    "buyback_rate",
                    models.DecimalField(
                        blank=True,
                        decimal_places=4,
                        help_text="Optional buy-back rate (populated when available).",
                        max_digits=8,
                        null=True,
                    ),
                ),
                (
                    "offer_rate",
                    models.DecimalField(
                        blank=True,
                        decimal_places=4,
                        help_text="Optional offer rate (populated when available).",
                        max_digits=8,
                        null=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "parent",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="children",
                        to="pricing.nosposcategory",
                    ),
                ),
            ],
            options={
                "verbose_name": "NosPos category",
                "verbose_name_plural": "NosPos categories",
                "db_table": "nosposcategory",
                "ordering": ["level", "full_name"],
            },
        ),
    ]
