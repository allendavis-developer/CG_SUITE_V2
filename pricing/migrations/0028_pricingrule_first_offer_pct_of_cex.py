from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0027_repricing_session_item_stock_url'),
    ]

    operations = [
        migrations.AddField(
            model_name='pricingrule',
            name='first_offer_pct_of_cex',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='% of the CeX trade-in price offered as the First Offer. E.g. 90 means offer_1 = cex_tradein * 0.90. Leave blank to use the default (same absolute margin as CeX).',
                max_digits=5,
                null=True,
            ),
        ),
    ]
