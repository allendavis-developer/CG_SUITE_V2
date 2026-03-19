from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0030_add_request_customer_enrichment'),
    ]

    operations = [
        migrations.AddField(
            model_name='pricingrule',
            name='second_offer_pct_of_cex',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='% of the CeX trade-in price offered as the Second Offer. E.g. 95 means offer_2 = cex_tradein * 0.95. Leave blank to use the default (midpoint between First and Third).',
                max_digits=5,
                null=True,
            ),
        ),
    ]
