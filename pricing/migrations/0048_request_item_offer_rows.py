from django.db import migrations, models
import django.db.models.deletion
from decimal import Decimal
import django.core.validators


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0047_backfill_current_jewellery_snapshot_from_history"),
    ]

    operations = [
        migrations.CreateModel(
            name="RequestItemOffer",
            fields=[
                ("request_item_offer_id", models.BigAutoField(primary_key=True, serialize=False)),
                (
                    "offer_type",
                    models.CharField(
                        choices=[("CASH", "Cash"), ("VOUCHER", "Voucher"), ("MANUAL", "Manual")],
                        db_index=True,
                        max_length=16,
                    ),
                ),
                ("offer_code", models.CharField(help_text="Stable offer identifier (e.g. cash_1, voucher_2, manual)", max_length=50)),
                ("title", models.CharField(blank=True, max_length=128)),
                (
                    "offer_slot",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        help_text="Optional offer tier/position (1,2,3)",
                        null=True,
                    ),
                ),
                (
                    "price_gbp",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=10,
                        validators=[django.core.validators.MinValueValidator(Decimal("0.00"))],
                    ),
                ),
                ("margin_pct", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ("is_highlighted", models.BooleanField(default=False)),
                ("is_selected", models.BooleanField(db_index=True, default=False)),
                ("sort_order", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "request_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="offer_rows",
                        to="pricing.requestitem",
                    ),
                ),
            ],
            options={
                "db_table": "buying_request_item_offer",
            },
        ),
        migrations.AddIndex(
            model_name="requestitemoffer",
            index=models.Index(fields=["request_item", "offer_type", "sort_order"], name="buying_requ_request_4e24fb_idx"),
        ),
        migrations.AddIndex(
            model_name="requestitemoffer",
            index=models.Index(fields=["request_item", "offer_code"], name="buying_requ_request_bca574_idx"),
        ),
        migrations.AddConstraint(
            model_name="requestitemoffer",
            constraint=models.UniqueConstraint(fields=("request_item", "offer_code"), name="uniq_request_item_offer_code"),
        ),
        migrations.AddConstraint(
            model_name="requestitemoffer",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_selected=True),
                fields=("request_item",),
                name="uniq_selected_offer_per_request_item",
            ),
        ),
    ]

