from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0065_nosposfield_replace_attribute"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="nosposfield",
            name="nosposfield_category_field_unique",
        ),
        migrations.RemoveField(
            model_name="nosposfield",
            name="category_modify_id",
        ),
        migrations.AlterField(
            model_name="nosposfield",
            name="nospos_field_id",
            field=models.PositiveIntegerField(
                db_index=True,
                help_text="Field id from CategoryFieldForm[X] in the form.",
                unique=True,
            ),
        ),
    ]
