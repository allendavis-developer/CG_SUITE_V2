# CG retail categories (cashgenerator.co.uk mega-menu), table cg_categories.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0073_upload_session_models'),
    ]

    operations = [
        migrations.CreateModel(
            name='CGCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(db_index=True, max_length=255)),
                (
                    'collection_slug',
                    models.CharField(
                        db_index=True,
                        help_text='Stable id from /collections/{slug} (used when merging scrapes).',
                        max_length=255,
                        unique=True,
                    ),
                ),
                (
                    'category_path',
                    models.CharField(
                        blank=True,
                        help_text='Breadcrumb from scrape, e.g. All Categories › …',
                        max_length=1024,
                    ),
                ),
                (
                    'parent_category',
                    models.ForeignKey(
                        blank=True,
                        db_column='parent_category_id',
                        help_text='Parent category. Root categories have this empty.',
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='children',
                        to='pricing.cgcategory',
                    ),
                ),
            ],
            options={
                'verbose_name': 'CG category',
                'verbose_name_plural': 'CG categories',
                'db_table': 'cg_categories',
            },
        ),
    ]
