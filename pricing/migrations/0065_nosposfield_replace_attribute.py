from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0064_nosposattribute"),
    ]

    operations = [
        migrations.DeleteModel(name="NosposAttribute"),
        migrations.CreateModel(
            name="NosposField",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "category_modify_id",
                    models.PositiveIntegerField(db_index=True, help_text="Category id from modify URL (?id=)."),
                ),
                (
                    "nospos_field_id",
                    models.PositiveIntegerField(db_index=True, help_text="Field id from CategoryFieldForm[X] in the form."),
                ),
                ("name", models.CharField(max_length=512)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "NosPos field",
                "verbose_name_plural": "NosPos fields",
                "db_table": "nosposfield",
                "ordering": ["category_modify_id", "nospos_field_id"],
            },
        ),
        migrations.AddConstraint(
            model_name="nosposfield",
            constraint=models.UniqueConstraint(
                fields=("category_modify_id", "nospos_field_id"),
                name="nosposfield_category_field_unique",
            ),
        ),
    ]
