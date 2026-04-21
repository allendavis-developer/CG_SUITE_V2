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
def repricing_sessions_view(request):
    if request.method == 'GET':
        sessions = RepricingSession.objects.prefetch_related(
            _RESEARCH_SESSION_PREFETCH
        ).order_by("-created_at")
        serializer = RepricingSessionSerializer(sessions, many=True)
        return Response(serializer.data)

    # Draft session creation: no items_data, just session_data with IN_PROGRESS status
    items_data = request.data.get('items_data') or []
    session_data = request.data.get('session_data')
    cart_key = (request.data.get('cart_key') or '').strip()

    if session_data is not None and not items_data:
        item_count = int(request.data.get('item_count', 0))
        session = RepricingSession.objects.create(
            cart_key=cart_key,
            item_count=item_count,
            barcode_count=0,
            status=RepricingSessionStatus.IN_PROGRESS,
            session_data=session_data,
        )
        serializer = RepricingSessionSerializer(session)
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
        session = RepricingSession.objects.create(
            cart_key=cart_key,
            item_count=len(unique_item_ids),
            barcode_count=len(items_data),
            status=RepricingSessionStatus.COMPLETED,
        )

        for idx, item_data in enumerate(items_data):
            try:
                _create_repricing_session_item_from_payload(session, item_data, idx)
            except ValueError as exc:
                transaction.set_rollback(True)
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    serializer = RepricingSessionSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
def repricing_session_detail(request, repricing_session_id):
    session = get_object_or_404(
        RepricingSession.objects.prefetch_related(_RESEARCH_SESSION_PREFETCH),
        repricing_session_id=repricing_session_id,
    )

    if request.method == 'GET':
        serializer = RepricingSessionSerializer(session)
        return Response(serializer.data)

    # PATCH: auto-save session state
    items_data = request.data.get('items_data') or []
    update_fields = []
    cash_offers_payload = None
    voucher_offers_payload = None

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

    if isinstance(items_data, list) and len(items_data) > 0:
        with transaction.atomic():
            for idx, item_data in enumerate(items_data):
                try:
                    _create_repricing_session_item_from_payload(session, item_data, idx)
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if update_fields:
        session.save(update_fields=update_fields + ['updated_at'])

    serializer = RepricingSessionSerializer(session)
    return Response(serializer.data)


@api_view(['POST'])
def quick_reprice_lookup(request):
    """
    POST: Look up variants by cex_sku to quickly populate the repricer.
    Accepts barcode pairs: cex_sku (numeric) + nospos_barcode.
    Falls back to the live CeX API when a sku is not in our database.

    Body: { "pairs": [ { "cex_sku": "...", "nospos_barcode": "..." }, ... ] }
    Returns: { "found": [...], "not_found": [...] }
    """
    pairs = request.data.get('pairs', [])
    if not isinstance(pairs, list) or not pairs:
        return Response(
            {"error": "pairs must be a non-empty list"},
            status=status.HTTP_400_BAD_REQUEST
        )

    found = []
    not_found = []

    for pair in pairs:
        cex_sku = str(pair.get('cex_sku') or '').strip()
        nospos_barcode = str(pair.get('nospos_barcode') or '').strip()

        if not cex_sku:
            continue

        try:
            variant = Variant.objects.select_related(
                'product__category', 'condition_grade'
            ).get(cex_sku=cex_sku)

            cex_box = _fetch_cex_box_detail(cex_sku)
            if cex_box:
                cex_sale_price = float(cex_box.get('sellPrice') or variant.current_price_gbp)
                cex_tradein_cash = float(cex_box.get('cashPrice') or variant.tradein_cash or 0)
                cex_tradein_voucher = float(cex_box.get('exchangePrice') or variant.tradein_voucher or 0)
                image_urls = cex_box.get('imageUrls') or {}
                image = image_urls.get('large') or image_urls.get('medium') or image_urls.get('small')
                title = cex_box.get('boxName') or variant.product.name
            else:
                cex_sale_price = float(variant.current_price_gbp)
                cex_tradein_cash = float(variant.tradein_cash or 0)
                cex_tradein_voucher = float(variant.tradein_voucher or 0)
                image = None
                title = variant.product.name

            target_sell_price = variant.get_target_sell_price()
            if target_sell_price is not None and float(variant.current_price_gbp) > 0:
                multiplier = float(target_sell_price) / float(variant.current_price_gbp)
                our_sale_price = _round_sale_price(cex_sale_price * multiplier)
            else:
                our_sale_price = _round_sale_price(cex_sale_price * 0.85)

            found.append({
                'cex_sku': cex_sku,
                'nospos_barcode': nospos_barcode,
                'variant_id': variant.variant_id,
                'product_id': variant.product.product_id,
                'product_name': (
                    f"{variant.product.manufacturer.name} {variant.product.name}"
                    if variant.product.manufacturer else variant.product.name
                ),
                'title': title,
                'subtitle': variant.title,
                'condition': variant.condition_grade.code,
                'attribute_values': {
                    vav.attribute_value.attribute.code: vav.attribute_value.value
                    for vav in variant.variant_attribute_values.select_related('attribute_value__attribute').all()
                },
                'category_id': variant.product.category.category_id,
                'category_name': variant.product.category.name,
                'cex_sale_price': cex_sale_price,
                'cex_tradein_cash': cex_tradein_cash,
                'cex_tradein_voucher': cex_tradein_voucher,
                'our_sale_price': our_sale_price,
                'image': image,
                'in_db': True,
            })

        except Variant.DoesNotExist:
            cex_box = _fetch_cex_box_detail(cex_sku)
            if cex_box:
                cex_sale_price = float(cex_box.get('sellPrice') or 0)
                cex_tradein_cash = float(cex_box.get('cashPrice') or 0)
                cex_tradein_voucher = float(cex_box.get('exchangePrice') or 0)
                image_urls = cex_box.get('imageUrls') or {}
                image = image_urls.get('large') or image_urls.get('medium') or image_urls.get('small')
                our_sale_price = _round_sale_price(cex_sale_price * 0.85)
                found.append({
                    'cex_sku': cex_sku,
                    'nospos_barcode': nospos_barcode,
                    'variant_id': None,
                    'title': cex_box.get('boxName') or cex_sku,
                    'subtitle': cex_box.get('categoryName') or '',
                    'condition': '',
                    'category_name': cex_box.get('superCatName') or '',
                    'cex_sale_price': cex_sale_price,
                    'cex_tradein_cash': cex_tradein_cash,
                    'cex_tradein_voucher': cex_tradein_voucher,
                    'our_sale_price': our_sale_price,
                    'image': image,
                    'in_db': False,
                })
            else:
                not_found.append(cex_sku)

    return Response({'found': found, 'not_found': not_found})
