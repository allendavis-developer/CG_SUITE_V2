# category_path is derived from the parent chain in the API, not stored.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0075_cg_categories_legacy_slug_column'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='cgcategory',
            name='category_path',
        ),
    ]
