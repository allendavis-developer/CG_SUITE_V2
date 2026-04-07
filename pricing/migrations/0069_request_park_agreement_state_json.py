from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0068_productcategory_ready_for_builder'),
    ]

    operations = [
        migrations.AddField(
            model_name='request',
            name='park_agreement_state_json',
            field=models.JSONField(
                blank=True,
                null=True,
                help_text='Park agreement: NosPos items URL, excluded line ids, progress modal snapshot (in-store testing)',
            ),
        ),
    ]
