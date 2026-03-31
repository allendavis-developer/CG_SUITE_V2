from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0049_phase4_identity_fks"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="requestitem",
            name="cash_offers_json",
        ),
        migrations.RemoveField(
            model_name="requestitem",
            name="voucher_offers_json",
        ),
    ]

