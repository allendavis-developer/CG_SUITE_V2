import re

from django.db import transaction
from django.db.models import Prefetch
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from pricing.models_v2 import (
    ProductCategory,
    NosposCategoryMapping,
    NosposCategory,
    NosposField,
    NosposCategoryField,
)
from pricing.utils.decorators import require_nospos_sync_secret
from pricing.utils.parsing import parse_decimal, coerce_bool


def _serialize_nospos_category_mapping(m):
    return {
        'id': m.id,
        'internalCategoryId': m.category_id,
        'internalCategoryName': m.category.name,
        'nosposPath': m.nospos_path,
    }


@api_view(['GET', 'POST'])
def nospos_category_mappings_view(request):
    """List all NoSpos category mappings or create a new one."""
    if request.method == 'GET':
        mappings = NosposCategoryMapping.objects.select_related('category').all()
        return Response([_serialize_nospos_category_mapping(m) for m in mappings])

    category_id = request.data.get('internalCategoryId')
    nospos_path = str(request.data.get('nosposPath') or '').strip()

    if not category_id:
        return Response({'error': 'internalCategoryId is required'}, status=400)
    if not nospos_path:
        return Response({'error': 'nosposPath is required'}, status=400)

    try:
        category = ProductCategory.objects.get(pk=category_id)
    except ProductCategory.DoesNotExist:
        return Response({'error': 'Category not found'}, status=404)

    if NosposCategoryMapping.objects.filter(category=category).exists():
        return Response({'error': 'A mapping for this category already exists. Delete the existing one first.'}, status=400)

    mapping = NosposCategoryMapping.objects.create(category=category, nospos_path=nospos_path)
    return Response(_serialize_nospos_category_mapping(mapping), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def nospos_category_mapping_detail(request, mapping_id):
    """Update or delete a single NoSpos category mapping."""
    try:
        mapping = NosposCategoryMapping.objects.select_related('category').get(pk=mapping_id)
    except NosposCategoryMapping.DoesNotExist:
        return Response({'error': 'Mapping not found'}, status=404)

    if request.method == 'DELETE':
        mapping.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    nospos_path = str(request.data.get('nosposPath') or '').strip()
    if not nospos_path:
        return Response({'error': 'nosposPath is required'}, status=400)

    mapping.nospos_path = nospos_path
    mapping.save()
    return Response(_serialize_nospos_category_mapping(mapping))


# --- NosPos scraped category tree (extension -> DB) ---

def _parent_path_from_full_name(full_name):
    parts = [p.strip() for p in re.split(r"\s*>\s*", (full_name or "").strip()) if p.strip()]
    if len(parts) < 2:
        return None
    return " > ".join(parts[:-1])


def _parse_optional_decimal(value):
    try:
        return parse_decimal(value)
    except ValueError:
        return None


def _normalize_nospos_category_payload_rows(raw):
    rows = []
    if isinstance(raw, dict):
        raw = raw.get("categories") or raw.get("rows") or []
    if not isinstance(raw, list):
        return rows
    for r in raw:
        if not isinstance(r, dict):
            continue
        nid = r.get("nosposId")
        if nid is None:
            nid = r.get("nospos_id")
        try:
            nid = int(nid)
        except (TypeError, ValueError):
            continue
        if nid <= 0:
            continue
        full_name = str(r.get("fullName") or r.get("full_name") or "").strip()
        if not full_name:
            continue
        level = r.get("level")
        try:
            level = int(level)
        except (TypeError, ValueError):
            level = 0
        if level < 0:
            level = 0
        cat_status = str(r.get("status") or "").strip()
        rows.append({
            "nospos_id": nid,
            "level": level,
            "full_name": full_name,
            "status": cat_status,
            "buyback_rate": _parse_optional_decimal(r.get("buyback_rate") or r.get("buybackRate")),
            "offer_rate": _parse_optional_decimal(r.get("offer_rate") or r.get("offerRate")),
        })
    return rows


@api_view(["GET"])
def nospos_categories_list(request):
    """List NosPos categories mirrored in the DB."""
    if request.query_params.get("count_only") in ("1", "true", "yes"):
        return Response({"count": NosposCategory.objects.count()})

    field_link_qs = NosposCategoryField.objects.select_related("field").order_by("field__name")
    qs = (
        NosposCategory.objects.select_related("parent")
        .prefetch_related(Prefetch("field_links", queryset=field_link_qs))
        .order_by("level", "full_name", "nospos_id")
    )
    results = []
    for c in qs:
        linked_fields = []
        for link in c.field_links.all():
            linked_fields.append({
                "nosposFieldId": link.field.nospos_field_id,
                "name": link.field.name,
                "active": link.active,
                "editable": link.editable,
                "sensitive": link.sensitive,
                "required": link.required,
            })
        results.append({
            "id": c.id,
            "nosposId": c.nospos_id,
            "level": c.level,
            "fullName": c.full_name,
            "status": c.status or "",
            "parentNosposId": c.parent.nospos_id if c.parent_id else None,
            "parentFullName": c.parent.full_name if c.parent_id else None,
            "buybackRate": str(c.buyback_rate) if c.buyback_rate is not None else None,
            "offerRate": str(c.offer_rate) if c.offer_rate is not None else None,
            "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
            "linkedFields": linked_fields,
        })
    return Response({"count": len(results), "results": results})


@csrf_exempt
@api_view(["POST"])
@require_nospos_sync_secret
def nospos_categories_sync(request):
    """Upsert rows scraped from NosPos /stock/category/index."""
    rows = _normalize_nospos_category_payload_rows(request.data)
    if not rows:
        return Response({"error": "No valid category rows in body"}, status=status.HTTP_400_BAD_REQUEST)

    rows.sort(key=lambda x: (x["level"], x["nospos_id"]))
    created = 0
    updated = 0

    with transaction.atomic():
        for item in rows:
            parent = None
            if item["level"] > 0:
                parent_path = _parent_path_from_full_name(item["full_name"])
                if parent_path:
                    parent = NosposCategory.objects.filter(full_name=parent_path).first()

            obj, was_created = NosposCategory.objects.update_or_create(
                nospos_id=item["nospos_id"],
                defaults={
                    "parent": parent,
                    "level": item["level"],
                    "full_name": item["full_name"],
                    "status": item["status"],
                    "buyback_rate": item["buyback_rate"],
                    "offer_rate": item["offer_rate"],
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        for obj in NosposCategory.objects.filter(level__gt=0, parent__isnull=True):
            parent_path = _parent_path_from_full_name(obj.full_name)
            if not parent_path:
                continue
            p = NosposCategory.objects.filter(full_name=parent_path).first()
            if p and p.id != obj.id:
                obj.parent = p
                obj.save(update_fields=["parent"])

    return Response({"ok": True, "created": created, "updated": updated, "total_received": len(rows)})


def _normalize_nospos_field_payload_rows(data):
    if isinstance(data, dict):
        raw = data.get("fields") or data.get("rows") or []
    elif isinstance(data, list):
        raw = data
    else:
        return []
    if not isinstance(raw, list):
        return []
    rows = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        fid = r.get("nosposFieldId")
        if fid is None:
            fid = r.get("fieldId") or r.get("nospos_field_id")
        try:
            fid = int(fid)
        except (TypeError, ValueError):
            continue
        if fid <= 0:
            continue
        name = str(r.get("name") or "").strip()
        if not name:
            continue
        rows.append({"nospos_field_id": fid, "name": name})
    return rows


@api_view(["GET"])
def nospos_fields_list(request):
    if request.query_params.get("count_only") in ("1", "true", "yes"):
        return Response({"count": NosposField.objects.count()})

    qs = NosposField.objects.order_by("nospos_field_id")
    results = []
    for a in qs:
        results.append({
            "id": a.id,
            "nosposFieldId": a.nospos_field_id,
            "name": a.name,
            "updatedAt": a.updated_at.isoformat() if a.updated_at else None,
        })
    return Response({"count": len(results), "results": results})


@csrf_exempt
@api_view(["POST"])
@require_nospos_sync_secret
def nospos_fields_sync(request):
    """Upsert field rows scraped from NosPos /stock/category/modify."""
    rows = _normalize_nospos_field_payload_rows(request.data)
    if not rows:
        return Response({"error": "No valid field rows in body"}, status=status.HTTP_400_BAD_REQUEST)

    created = 0
    updated = 0
    with transaction.atomic():
        for item in rows:
            obj, was_created = NosposField.objects.update_or_create(
                nospos_field_id=item["nospos_field_id"],
                defaults={"name": item["name"]},
            )
            if was_created:
                created += 1
            else:
                updated += 1

    return Response({"ok": True, "created": created, "updated": updated, "total_received": len(rows)})


def _normalize_nospos_category_field_sync_payload(data):
    if not isinstance(data, dict):
        return None, [], None, None
    raw_cat = data.get("categoryNosposId")
    if raw_cat is None:
        raw_cat = data.get("category_nospos_id")
    try:
        category_nospos_id = int(raw_cat)
    except (TypeError, ValueError):
        return None, [], None, None
    if category_nospos_id <= 0:
        return None, [], None, None

    br_raw = data.get("buybackRatePercent")
    if br_raw is None:
        br_raw = data.get("buyback_rate_percent")
    buyback_dec = _parse_optional_decimal(br_raw)

    offer_raw = data.get("offerRatePercent")
    if offer_raw is None:
        offer_raw = data.get("offer_rate_percent")
    offer_dec = _parse_optional_decimal(offer_raw)

    raw_fields = data.get("fields")
    if raw_fields is None:
        raw_fields = []
    if not isinstance(raw_fields, list):
        return category_nospos_id, [], buyback_dec, offer_dec

    rows = []
    for r in raw_fields:
        if not isinstance(r, dict):
            continue
        fid = r.get("nosposFieldId")
        if fid is None:
            fid = r.get("fieldId") or r.get("nospos_field_id")
        try:
            fid = int(fid)
        except (TypeError, ValueError):
            continue
        if fid <= 0:
            continue
        name = str(r.get("name") or "").strip()
        if not name:
            continue
        rows.append({
            "nospos_field_id": fid,
            "name": name,
            "active": coerce_bool(r.get("active"), False),
            "editable": coerce_bool(r.get("editable"), False),
            "sensitive": coerce_bool(r.get("sensitive"), False),
            "required": coerce_bool(r.get("required"), False),
        })
    return category_nospos_id, rows, buyback_dec, offer_dec


@csrf_exempt
@api_view(["POST"])
@require_nospos_sync_secret
def nospos_category_fields_sync(request):
    """Upsert NosposField rows and per-category NosposCategoryField links."""
    category_nospos_id, rows, buyback_dec, offer_dec = _normalize_nospos_category_field_sync_payload(
        request.data
    )
    if category_nospos_id is None:
        return Response({"error": "Invalid or missing categoryNosposId"}, status=status.HTTP_400_BAD_REQUEST)
    if not rows and buyback_dec is None and offer_dec is None:
        return Response(
            {"error": "No valid field rows and no buybackRatePercent/offerRatePercent in body"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    category = NosposCategory.objects.filter(nospos_id=category_nospos_id).first()
    if not category:
        return Response(
            {
                "error": (
                    f"No NosposCategory with nospos_id={category_nospos_id}. "
                    "Run \u201cUpdate from NoSpos\u201d on the categories page first."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    active_fids = {item["nospos_field_id"] for item in rows if item["active"]}
    field_created = 0
    field_updated = 0
    link_created = 0
    link_updated = 0
    deleted_count = 0

    with transaction.atomic():
        rate_updates = []
        if buyback_dec is not None:
            category.buyback_rate = buyback_dec
            rate_updates.append("buyback_rate")
        if offer_dec is not None:
            category.offer_rate = offer_dec
            rate_updates.append("offer_rate")
        if rate_updates:
            category.save(update_fields=rate_updates)

        if rows:
            for item in rows:
                _f, f_was_created = NosposField.objects.update_or_create(
                    nospos_field_id=item["nospos_field_id"],
                    defaults={"name": item["name"]},
                )
                if f_was_created:
                    field_created += 1
                else:
                    field_updated += 1

            for item in rows:
                if not item["active"]:
                    continue
                field = NosposField.objects.get(nospos_field_id=item["nospos_field_id"])
                _link, l_was_created = NosposCategoryField.objects.update_or_create(
                    category=category,
                    field=field,
                    defaults={
                        "active": True,
                        "editable": item["editable"],
                        "sensitive": item["sensitive"],
                        "required": item["required"],
                    },
                )
                if l_was_created:
                    link_created += 1
                else:
                    link_updated += 1

            deleted_count, _ = NosposCategoryField.objects.filter(category=category).exclude(
                field__nospos_field_id__in=active_fids
            ).delete()

    category.refresh_from_db()
    return Response({
        "ok": True,
        "categoryNosposId": category_nospos_id,
        "total_received": len(rows),
        "links_for_active_fields": len(active_fids),
        "fields_created": field_created,
        "fields_updated": field_updated,
        "field_links_created": link_created,
        "field_links_updated": link_updated,
        "field_links_removed": deleted_count,
        "buybackRate": str(category.buyback_rate) if category.buyback_rate is not None else None,
        "offerRate": str(category.offer_rate) if category.offer_rate is not None else None,
    })
