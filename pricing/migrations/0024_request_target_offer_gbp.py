from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0023_requestitem_manual_offer_and_senior_mgmt'),
    ]

    operations = [
        migrations.AddField(
            model_name='request',
            name='target_offer_gbp',
            field=models.DecimalField(
                max_digits=12,
                decimal_places=2,
                null=True,
                blank=True,
                help_text='Target grand total offer in GBP',
            ),
        ),
    ]

