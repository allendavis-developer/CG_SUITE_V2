from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0076_remove_cgcategory_category_path'),
    ]

    operations = [
        migrations.AddField(
            model_name='uploadsession',
            name='mode',
            field=models.CharField(
                choices=[('NEW', 'New products'), ('AUDIT', 'Audit existing products')],
                db_index=True,
                default='NEW',
                max_length=10,
            ),
        ),
    ]
