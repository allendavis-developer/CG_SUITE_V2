# Web EPOS category hierarchy (scraped from the /products/new cascading selects),
# table webepos_categories.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0077_uploadsession_mode'),
    ]

    operations = [
        migrations.CreateModel(
            name='WebEposCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(db_index=True, max_length=255)),
                (
                    'webepos_uuid',
                    models.CharField(
                        db_index=True,
                        help_text='Stable Web EPOS identifier (the option value on `#catLevel{N}`).',
                        max_length=128,
                        unique=True,
                    ),
                ),
                (
                    'level',
                    models.PositiveIntegerField(
                        default=1,
                        help_text='1-based depth under the implicit All Categories root (1 = top-level).',
                    ),
                ),
                ('last_scraped_at', models.DateTimeField(auto_now=True)),
                (
                    'parent_category',
                    models.ForeignKey(
                        blank=True,
                        db_column='parent_category_id',
                        help_text='Parent category. Root categories have this empty.',
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='children',
                        to='pricing.webeposcategory',
                    ),
                ),
            ],
            options={
                'verbose_name': 'Web EPOS category',
                'verbose_name_plural': 'Web EPOS categories',
                'db_table': 'webepos_categories',
            },
        ),
    ]
