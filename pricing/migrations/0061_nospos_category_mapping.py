from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0060_reset_testing_passed_for_booked_requests'),
    ]

    operations = [
        migrations.CreateModel(
            name='NosposCategoryMapping',
            fields=[
                ('id', models.AutoField(primary_key=True, serialize=False)),
                ('nospos_path', models.CharField(
                    help_text="NoSpos path using '>' as delimiter, e.g. 'Gaming > Consoles > Sony > PlayStation5'.",
                    max_length=500,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.OneToOneField(
                    help_text='Internal category being mapped.',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='nospos_category_mapping',
                    to='pricing.productcategory',
                )),
            ],
            options={
                'verbose_name': 'NoSpos Category Mapping',
                'verbose_name_plural': 'NoSpos Category Mappings',
                'db_table': 'nospos_category_mapping',
                'ordering': ['category__name'],
            },
        ),
    ]
