from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0066_remove_nosposfield_category_modify_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="NosposCategoryField",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("active", models.BooleanField(default=False, help_text="CategoryFieldForm [checked] — field enabled for category.")),
                ("editable", models.BooleanField(default=False)),
                ("sensitive", models.BooleanField(default=False)),
                ("required", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="field_links",
                        to="pricing.nosposcategory",
                    ),
                ),
                (
                    "field",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="category_links",
                        to="pricing.nosposfield",
                    ),
                ),
            ],
            options={
                "verbose_name": "NosPos category field",
                "verbose_name_plural": "NosPos category fields",
                "db_table": "nosposcategoryfield",
            },
        ),
        migrations.AddConstraint(
            model_name="nosposcategoryfield",
            constraint=models.UniqueConstraint(fields=("category", "field"), name="nosposcategoryfield_category_field_unique"),
        ),
    ]
