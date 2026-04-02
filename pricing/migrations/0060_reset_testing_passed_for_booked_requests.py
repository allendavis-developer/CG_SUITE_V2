# Reset per-line testing flags for requests still in BOOKED_FOR_TESTING so the checklist
# starts unchecked when opening the request view.

from django.db import migrations


def reset_testing_passed_for_booked(apps, schema_editor):
    Request = apps.get_model("pricing", "Request")
    RequestItem = apps.get_model("pricing", "RequestItem")
    RequestStatusHistory = apps.get_model("pricing", "RequestStatusHistory")

    for req in Request.objects.all().iterator():
        latest = (
            RequestStatusHistory.objects.filter(request=req)
            .order_by("-effective_at")
            .first()
        )
        if latest and latest.status == "BOOKED_FOR_TESTING":
            RequestItem.objects.filter(request=req).update(testing_passed=False)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0059_customer_nospos_customer_id"),
    ]

    operations = [
        migrations.RunPython(reset_testing_passed_for_booked, noop_reverse),
    ]
