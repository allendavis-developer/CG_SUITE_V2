from decimal import Decimal
from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0024_request_target_offer_gbp'),
    ]

    operations = [
        migrations.CreateModel(
            name='RepricingSession',
            fields=[
                ('repricing_session_id', models.AutoField(primary_key=True, serialize=False)),
                ('cart_key', models.CharField(blank=True, db_index=True, default='', max_length=255)),
                ('item_count', models.PositiveIntegerField(default=0)),
                ('barcode_count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'db_table': 'pricing_repricing_session',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='RepricingSessionItem',
            fields=[
                ('repricing_session_item_id', models.AutoField(primary_key=True, serialize=False)),
                ('item_identifier', models.CharField(blank=True, default='', max_length=100)),
                ('title', models.CharField(blank=True, default='', max_length=255)),
                ('quantity', models.PositiveIntegerField(default=1)),
                ('barcode', models.CharField(db_index=True, max_length=255)),
                ('old_retail_price', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('new_retail_price', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('cex_sell_at_repricing', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('our_sale_price_at_repricing', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('raw_data', models.JSONField(blank=True, help_text='eBay research data used for repricing', null=True)),
                ('cash_converters_data', models.JSONField(blank=True, help_text='Cash Converters research data used for repricing', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('repricing_session', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='items', to='pricing.repricingsession')),
            ],
            options={
                'db_table': 'pricing_repricing_session_item',
                'ordering': ['repricing_session_item_id'],
            },
        ),
    ]
