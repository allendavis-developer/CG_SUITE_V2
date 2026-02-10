# Generated manually to update RequestStatus choices

from django.db import migrations, models


def migrate_status_data(apps, schema_editor):
    """
    Migrate existing status data:
    - OPEN -> QUOTE
    - TESTING_COMPLETE -> COMPLETE
    - CANCELLED -> QUOTE (or could be removed, but converting to QUOTE for data preservation)
    """
    RequestStatusHistory = apps.get_model('pricing', 'RequestStatusHistory')
    
    # Migrate OPEN to QUOTE
    RequestStatusHistory.objects.filter(status='OPEN').update(status='QUOTE')
    
    # Migrate TESTING_COMPLETE to COMPLETE
    RequestStatusHistory.objects.filter(status='TESTING_COMPLETE').update(status='COMPLETE')
    
    # Migrate CANCELLED to QUOTE (preserving data)
    RequestStatusHistory.objects.filter(status='CANCELLED').update(status='QUOTE')


def reverse_migrate_status_data(apps, schema_editor):
    """
    Reverse migration:
    - QUOTE -> OPEN (if it was originally OPEN, we can't distinguish, so default to OPEN)
    - COMPLETE -> TESTING_COMPLETE
    """
    RequestStatusHistory = apps.get_model('pricing', 'RequestStatusHistory')
    
    # Reverse: QUOTE -> OPEN (we can't distinguish original, so default to OPEN)
    RequestStatusHistory.objects.filter(status='QUOTE').update(status='OPEN')
    
    # Reverse: COMPLETE -> TESTING_COMPLETE
    RequestStatusHistory.objects.filter(status='COMPLETE').update(status='TESTING_COMPLETE')


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0016_requestitem_our_sale_price_at_negotiation'),
    ]

    operations = [
        # First, migrate the data
        migrations.RunPython(migrate_status_data, reverse_migrate_status_data),
        
        # Then, update the field choices
        migrations.AlterField(
            model_name='requeststatushistory',
            name='status',
            field=models.CharField(
                choices=[
                    ('QUOTE', 'Quote'),
                    ('BOOKED_FOR_TESTING', 'Booked For Testing'),
                    ('COMPLETE', 'Complete')
                ],
                max_length=30
            ),
        ),
    ]
