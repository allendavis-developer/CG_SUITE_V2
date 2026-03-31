from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0050_drop_legacy_offer_json_fields"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="inventoryunitjewellery",
            name="measured_by_name",
        ),
        migrations.RemoveField(
            model_name="requestitem",
            name="selected_offer_id",
        ),
        migrations.RemoveField(
            model_name="requestitem",
            name="senior_mgmt_approved_by",
        ),
        migrations.RemoveField(
            model_name="requestitemjewellery",
            name="measured_by_name",
        ),
        migrations.RemoveField(
            model_name="requestjewelleryreferencesnapshot",
            name="created_by_name",
        ),
    ]

