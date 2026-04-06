from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0067_nosposcategoryfield"),
    ]

    operations = [
        migrations.AddField(
            model_name="productcategory",
            name="ready_for_builder",
            field=models.BooleanField(
                db_index=True,
                default=True,
                help_text="If False, hide from buyer/repricing category pickers; use for NosPos mirror trees and mapping.",
            ),
        ),
    ]
