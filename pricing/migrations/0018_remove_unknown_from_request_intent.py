# Generated manually to remove UNKNOWN from RequestIntent and make intent required

from django.db import migrations, models


def migrate_unknown_intents(apps, schema_editor):
    """
    Migrate existing UNKNOWN intents to DIRECT_SALE as a safe default.
    """
    Request = apps.get_model('pricing', 'Request')
    
    # Migrate UNKNOWN to DIRECT_SALE
    Request.objects.filter(intent='UNKNOWN').update(intent='DIRECT_SALE')


def reverse_migrate_unknown_intents(apps, schema_editor):
    """
    Reverse migration: Convert DIRECT_SALE back to UNKNOWN (if they were originally UNKNOWN).
    Note: This is not perfect as we can't distinguish which DIRECT_SALE records were originally UNKNOWN.
    """
    # We can't perfectly reverse this, so we'll leave it as is
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0017_update_request_status_choices'),
    ]

    operations = [
        # First, migrate the data
        migrations.RunPython(migrate_unknown_intents, reverse_migrate_unknown_intents),
        
        # Then, update the field to remove UNKNOWN from choices and remove default
        migrations.AlterField(
            model_name='request',
            name='intent',
            field=models.CharField(
                choices=[
                    ('BUYBACK', 'Buyback'),
                    ('DIRECT_SALE', 'Direct Sale'),
                    ('STORE_CREDIT', 'Store Credit')
                ],
                max_length=20
            ),
        ),
    ]
