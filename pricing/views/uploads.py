"""Auto-split from the former pricing/views_v2.py god file.

Helpers shared across the split modules live in pricing.views._shared.
"""
import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.http import JsonResponse
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import OuterRef, Subquery, Max, Prefetch
from django.utils.dateparse import parse_datetime

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from pricing.models_v2 import (
    ProductCategory,
    Product,
    Variant,
    Customer,
    Request,
    RequestItem,
    RequestStatus,
    RequestStatusHistory,
    RequestIntent,
    RepricingSession,
    RepricingSessionItem,
    RepricingSessionStatus,
    UploadSession,
    UploadSessionItem,
    PricingRule,
    MarketResearchSession,
    RequestJewelleryReferenceSnapshot,
    CustomerRuleSettings,
    CustomerOfferRule,
)
from pricing import research_storage
from pricing.buying_decimal import parse_optional_money
from pricing.offer_rows import (
    get_selected_offer_code,
    sync_request_item_offer_rows_from_payload,
)
from pricing.services.offer_engine import (
    generate_offer_set as build_offer_set,
    round_price,
)
from pricing.utils.parsing import parse_decimal, coerce_bool
from pricing.services.cex_client import fetch_cex_box_detail as _fetch_cex_box_detail

from pricing.serializers import (
    RequestSerializer,
    RequestItemSerializer,
    CustomerSerializer,
    ProductCategorySerializer,
    ProductSerializer,
    VariantMarketStatsSerializer,
    RepricingSessionSerializer,
    UploadSessionSerializer,
)

logger = logging.getLogger(__name__)

from pricing.views._shared import (
    _is_jewellery_placeholder_variant,
    _resolve_cex_sku_to_variant,
    _decimal_or_none,
    _create_stock_session_line_from_payload,
    _create_repricing_session_item_from_payload,
    _create_upload_session_item_from_payload,
    _sync_upload_session_items_from_session_snapshot,
    _sync_request_jewellery_reference_snapshot,
    _get_category_and_descendant_ids,
    _upload_session_data_has_barcode,
    _round_offer_price,
    _round_sale_price,
)

_RESEARCH_SESSION_PREFETCH = Prefetch(
    "items__market_research_sessions",
    queryset=MarketResearchSession.objects.prefetch_related("listings", "drill_levels"),
)
_UPLOAD_SESSION_PREFETCH = Prefetch(
    "items__market_research_sessions",
    queryset=MarketResearchSession.objects.prefetch_related("listings", "drill_levels"),
)

@api_view(['GET', 'POST'])
def upload_sessions_view(request):
    if request.method == 'GET':
        sessions = UploadSession.objects.prefetch_related(
            _UPLOAD_SESSION_PREFETCH
        ).order_by("-created_at")
        serializer = UploadSessionSerializer(sessions, many=True)
        return Response(serializer.data)

    items_data = request.data.get('items_data') or []
    session_data = request.data.get('session_data')
    cart_key = (request.data.get('cart_key') or '').strip()
    requested_mode = (request.data.get('mode') or '').strip().upper()
    session_mode = requested_mode if requested_mode in {'NEW', 'AUDIT'} else 'NEW'

    if session_data is not None and not items_data:
        if not _upload_session_data_has_barcode(session_data):
            return Response(
                {
                    'error': (
                        'At least one recorded barcode is required to create an upload session.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        item_count = int(request.data.get('item_count', 0))
        session = UploadSession.objects.create(
            cart_key=cart_key,
            item_count=item_count,
            barcode_count=0,
            status=RepricingSessionStatus.IN_PROGRESS,
            mode=session_mode,
            session_data=session_data,
        )
        serializer = UploadSessionSerializer(session)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    if not isinstance(items_data, list) or len(items_data) == 0:
        return Response(
            {"error": "items_data must be a non-empty list"},
            status=status.HTTP_400_BAD_REQUEST
        )

    unique_item_ids = {
        str(item.get('item_identifier') or item.get('itemId') or '').strip()
        for item in items_data
        if (item.get('item_identifier') or item.get('itemId'))
    }

    with transaction.atomic():
        session = UploadSession.objects.create(
            cart_key=cart_key,
            item_count=len(unique_item_ids),
            barcode_count=len(items_data),
            status=RepricingSessionStatus.COMPLETED,
            mode=session_mode,
        )

        for idx, item_data in enumerate(items_data):
            try:
                _create_upload_session_item_from_payload(session, item_data, idx)
            except ValueError as exc:
                transaction.set_rollback(True)
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    serializer = UploadSessionSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
def upload_session_detail(request, upload_session_id):
    session = get_object_or_404(
        UploadSession.objects.prefetch_related(_UPLOAD_SESSION_PREFETCH),
        upload_session_id=upload_session_id,
    )

    if request.method == 'GET':
        serializer = UploadSessionSerializer(session)
        return Response(serializer.data)

    items_data = request.data.get('items_data') or []
    update_fields = []

    if 'session_data' in request.data:
        session.session_data = request.data['session_data']
        update_fields.append('session_data')

    if 'status' in request.data:
        new_status = request.data['status']
        if new_status in RepricingSessionStatus.values:
            session.status = new_status
            update_fields.append('status')
            if new_status == RepricingSessionStatus.IN_PROGRESS:
                session.items.all().delete()
                session.barcode_count = 0
                update_fields.append('barcode_count')

    if 'cart_key' in request.data:
        session.cart_key = (request.data['cart_key'] or '').strip()
        update_fields.append('cart_key')

    if 'item_count' in request.data:
        session.item_count = int(request.data['item_count'] or 0)
        update_fields.append('item_count')

    if 'barcode_count' in request.data:
        session.barcode_count = int(request.data['barcode_count'] or 0)
        update_fields.append('barcode_count')

    if 'mode' in request.data:
        new_mode = (request.data['mode'] or '').strip().upper()
        if new_mode in {'NEW', 'AUDIT'}:
            session.mode = new_mode
            update_fields.append('mode')

    if isinstance(items_data, list) and len(items_data) > 0:
        with transaction.atomic():
            for idx, item_data in enumerate(items_data):
                try:
                    iid = str(item_data.get('item_identifier') or item_data.get('itemId') or '').strip()
                    if iid:
                        existing_line = UploadSessionItem.objects.filter(
                            upload_session=session, item_identifier=iid
                        ).first()
                        if existing_line:
                            old_rp = _decimal_or_none(item_data.get('old_retail_price'), 'old_retail_price')
                            new_rp = _decimal_or_none(item_data.get('new_retail_price'), 'new_retail_price')
                            price_update_fields = []
                            if old_rp is not None:
                                existing_line.old_retail_price = old_rp
                                price_update_fields.append('old_retail_price')
                            if new_rp is not None:
                                existing_line.new_retail_price = new_rp
                                price_update_fields.append('new_retail_price')
                            if price_update_fields:
                                existing_line.save(update_fields=price_update_fields)
                            research_storage.ingest_upload_line_post_create(
                                existing_line,
                                item_data.get('raw_data'),
                                item_data.get('cash_converters_data'),
                                item_data.get('cg_data'),
                            )
                            continue
                    _create_upload_session_item_from_payload(session, item_data, idx)
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    _sync_upload_session_items_from_session_snapshot(session)

    if update_fields:
        session.save(update_fields=update_fields + ['updated_at'])

    serializer = UploadSessionSerializer(session)
    return Response(serializer.data)
