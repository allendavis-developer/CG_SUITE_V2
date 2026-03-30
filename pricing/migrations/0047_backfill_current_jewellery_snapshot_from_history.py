from django.db import migrations


def forward(apps, schema_editor):
    Request = apps.get_model("pricing", "Request")
    RequestJewelleryReferenceSnapshot = apps.get_model(
        "pricing", "RequestJewelleryReferenceSnapshot"
    )

    for req in Request.objects.filter(
        current_jewellery_reference_snapshot__isnull=True
    ).iterator():
        latest = (
            RequestJewelleryReferenceSnapshot.objects.filter(request_id=req.request_id)
            .order_by("-created_at")
            .first()
        )
        if latest:
            req.current_jewellery_reference_snapshot_id = latest.snapshot_id
            req.save(update_fields=["current_jewellery_reference_snapshot"])


def reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("pricing", "0046_normalize_legacy_jewellery_valuation_source"),
    ]

    operations = [
        migrations.RunPython(forward, reverse),
    ]
