import re

from django.shortcuts import render, get_object_or_404
from django.db import transaction
from django.http import JsonResponse
from django.core.exceptions import ValidationError as DjangoValidationError
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from django.db.models import OuterRef, Subquery, Max, Prefetch
from django.utils.dateparse import parse_datetime
import os
import logging
import requests

logger = logging.getLogger(__name__)

from pricing.utils.ebay_filters import extract_filters, extract_ebay_search_params, build_ebay_search_url, resolve_ebay_category
from pricing.utils.cashconverters_filters import build_cashconverters_url, convert_facet_groups_to_filters, resolve_cashconverters_category

from .models_v2 import (
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
    PricingRule,
    MarketResearchSession,
    RequestJewelleryReferenceSnapshot,
    CustomerRuleSettings,
    CustomerOfferRule,
    NosposCategoryMapping,
    NosposCategory,
    NosposField,
    NosposCategoryField,
)
from . import research_storage
from .buying_decimal import parse_optional_money
from .offer_rows import get_selected_offer_code, sync_request_item_offer_rows_from_payload
from .services.offer_engine import (
    generate_offer_set as build_offer_set,
    round_price,
)
from .utils.decorators import require_nospos_sync_secret
from .utils.parsing import parse_decimal, coerce_bool
from .services.cex_client import fetch_cex_box_detail as _fetch_cex_box_detail

from .serializers import (
    RequestSerializer, RequestItemSerializer, CustomerSerializer,
    ProductCategorySerializer, ProductSerializer, VariantMarketStatsSerializer,
    RepricingSessionSerializer,
)

_RESEARCH_SESSION_PREFETCH = Prefetch(
    "items__market_research_sessions",
    queryset=MarketResearchSession.objects.prefetch_related("listings", "drill_levels"),
)


def _is_jewellery_placeholder_variant(variant):
    """Synthetic catalogue rows use cex_sku JEW-… — do not treat as CeX prices."""
    if variant is None:
        return False
    sku = getattr(variant, "cex_sku", None) or ""
    return str(sku).upper().startswith("JEW-")


def _resolve_cex_sku_to_variant(item_payload):
    """When variant is null and cex_sku (CeX product ID from URL) is provided, look up variant and use it."""
    if item_payload.get('variant') is not None:
        return
    cex_sku = item_payload.pop('cex_sku', None)
    if not cex_sku:
        raw = item_payload.get('raw_data') or {}
        cex_sku = raw.get('id')
        if not cex_sku:
            rd = raw.get('referenceData') or raw.get('reference_data')
            if isinstance(rd, dict):
                cex_sku = rd.get('cex_sku') or rd.get('id')
    if not cex_sku:
        return
    try:
        v = Variant.objects.get(cex_sku=str(cex_sku))
        item_payload['variant'] = v.variant_id
    except Variant.DoesNotExist:
        pass


_decimal_or_none = parse_decimal


def _create_repricing_session_item_from_payload(session, item_data, idx):
    barcode = (item_data.get('barcode') or '').strip()
    if not barcode:
        raise ValueError(f"items_data[{idx}].barcode is required")

    try:
        quantity = max(1, int(item_data.get('quantity') or 1))
    except (TypeError, ValueError):
        raise ValueError(f"Invalid quantity for items_data[{idx}]")

    line = RepricingSessionItem.objects.create(
        repricing_session=session,
        item_identifier=str(item_data.get('item_identifier') or item_data.get('itemId') or '').strip(),
        title=(item_data.get('title') or '').strip(),
        quantity=quantity,
        barcode=barcode,
        stock_barcode=(item_data.get('stock_barcode') or '').strip(),
        stock_url=(item_data.get('stock_url') or '').strip(),
        old_retail_price=_decimal_or_none(item_data.get('old_retail_price'), 'old_retail_price'),
        new_retail_price=_decimal_or_none(item_data.get('new_retail_price'), 'new_retail_price'),
        cex_sell_at_repricing=_decimal_or_none(item_data.get('cex_sell_at_repricing'), 'cex_sell_at_repricing'),
        our_sale_price_at_repricing=_decimal_or_none(item_data.get('our_sale_price_at_repricing'), 'our_sale_price_at_repricing'),
    )
    research_storage.ingest_repricing_line_post_create(
        line,
        item_data.get('raw_data'),
        item_data.get('cash_converters_data'),
        item_data.get('cg_data'),
    )
    return line


def _sync_request_jewellery_reference_snapshot(existing_request, jewellery_reference_scrape):
    """
    Persist request-level jewellery reference history and set active snapshot.
    Input shape is the frontend payload: { sections, scrapedAt, sourceUrl }.
    """
    if jewellery_reference_scrape is None:
        return
    if not isinstance(jewellery_reference_scrape, dict):
        raise ValueError("jewellery_reference_scrape must be a JSON object")

    sections = jewellery_reference_scrape.get("sections")
    if not isinstance(sections, list):
        raise ValueError("jewellery_reference_scrape.sections must be a list")

    scraped_at = parse_datetime(str(jewellery_reference_scrape.get("scrapedAt") or "")) if jewellery_reference_scrape.get("scrapedAt") else None
    source_url = str(jewellery_reference_scrape.get("sourceUrl") or "")

    # Avoid duplicate history rows when autosave posts the same payload repeatedly.
    snapshot = (
        RequestJewelleryReferenceSnapshot.objects.filter(
            request=existing_request,
            source_name="Mastermelt",
            source_url=source_url,
            scraped_at=scraped_at,
            sections_json=sections,
        )
        .order_by("-created_at")
        .first()
    )
    if snapshot is None:
        snapshot = RequestJewelleryReferenceSnapshot.objects.create(
            request=existing_request,
            source_name="Mastermelt",
            source_url=source_url,
            scraped_at=scraped_at,
            sections_json=sections,
        )
    existing_request.current_jewellery_reference_snapshot = snapshot


_round_offer_price = round_price
_round_sale_price = round_price


@api_view(['GET'])
def categories_list(request):
    # Top-level categories for buyer / repricing sidebars (excludes NosPos-only imports).
    categories = ProductCategory.objects.filter(
        parent_category__isnull=True,
        ready_for_builder=True,
    )
    serializer = ProductCategorySerializer(categories, many=True)
    return Response(serializer.data)


@api_view(['GET'])
def all_categories_flat(request):
    """
    Return every category as a flat list, each with a 'path' label showing
    the full ancestry (e.g. "Electronics > Games > PlayStation").
    Ordered depth-first so children follow their parent.
    """
    all_cats = list(
        ProductCategory.objects
        .select_related('parent_category')
        .order_by('parent_category_id', 'name')
    )

    # Build a lookup and children map
    by_id = {c.category_id: c for c in all_cats}
    children_map = {}
    roots = []
    for c in all_cats:
        pid = c.parent_category_id
        if pid is None:
            roots.append(c)
        else:
            children_map.setdefault(pid, []).append(c)

    result = []

    def walk(cat, ancestors):
        path = ' > '.join(ancestors + [cat.name])
        result.append({
            'category_id': cat.category_id,
            'name': cat.name,
            'path': path,
            'depth': len(ancestors),
            'parent_category_id': cat.parent_category_id,
            'ready_for_builder': cat.ready_for_builder,
        })
        for child in children_map.get(cat.category_id, []):
            walk(child, ancestors + [cat.name])

    for root in roots:
        walk(root, [])

    return Response(result)


@api_view(['GET', 'POST'])
def customers_view(request):
    if request.method == 'GET':
        customers = Customer.objects.all()
        nospos_q = request.query_params.get('nospos_customer_id')
        if nospos_q is not None and str(nospos_q).strip() != '':
            try:
                customers = customers.filter(nospos_customer_id=int(nospos_q))
            except (TypeError, ValueError):
                customers = Customer.objects.none()
        data = [
            {
                "id": c.customer_id,
                "name": c.name,
                "phone": c.phone_number,
                "phone_number": c.phone_number,
                "email": c.email,
                "address": c.address,
                "nospos_customer_id": c.nospos_customer_id,
            }
            for c in customers
        ]
        return Response(data)

    elif request.method == 'POST':
        serializer = CustomerSerializer(data=request.data)
        if serializer.is_valid():
            customer = serializer.save()
            data = {
                "id": customer.customer_id,
                "name": customer.name,
                "phone": customer.phone_number,
                "email": customer.email,
                "address": customer.address or "",
                "cancel_rate": customer.cancel_rate,
                "nospos_customer_id": customer.nospos_customer_id,
            }
            return Response(data, status=status.HTTP_201_CREATED)
        logger.warning("CustomerSerializer errors: %s", serializer.errors)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'PUT'])
def customer_detail(request, customer_id):
    """Get or update a single customer."""
    try:
        customer = Customer.objects.get(customer_id=customer_id)
    except Customer.DoesNotExist:
        return Response(
            {"error": "Customer not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    if request.method == 'GET':
        data = {
            "id": customer.customer_id,
            "name": customer.name,
            "phone": customer.phone_number,
            "email": customer.email,
            "address": customer.address or "",
            "cancel_rate": customer.cancel_rate,
            "nospos_customer_id": customer.nospos_customer_id,
        }
        return Response(data)

    elif request.method in ('PATCH', 'PUT'):
        data = request.data.copy()
        # Map frontend 'phone' to backend 'phone_number' if needed
        if 'phone' in data and 'phone_number' not in data:
            data['phone_number'] = data.pop('phone')
        serializer = CustomerSerializer(customer, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def _get_category_and_descendant_ids(category):
    """Return list of category_id for this category and all its descendants."""
    ids = [category.category_id]
    for child in category.children.all():
        ids.extend(_get_category_and_descendant_ids(child))
    return ids


@api_view(['GET'])
def products_list(request):
    """
    Return all products (model names) for a given category.
    Includes products in the category AND all descendant categories.
    Query param: ?category_id=14
    """
    category_id = request.query_params.get('category_id')
    if not category_id:
        return Response({"error": "category_id query param is required"}, status=400)

    try:
        category = ProductCategory.objects.get(pk=category_id)
    except ProductCategory.DoesNotExist:
        return Response({"error": "Category not found"}, status=404)

    category_ids = _get_category_and_descendant_ids(category)
    products = Product.objects.filter(category_id__in=category_ids)
    serializer = ProductSerializer(products, many=True)
    return Response(serializer.data)


@api_view(['GET', 'POST'])
def requests_view(request):
    """
    GET: List all requests
    POST: Create a new request with initial item (status: QUOTE)
    """
    if request.method == 'GET':
        requests = Request.objects.all().prefetch_related(
            "items__variant",
            _RESEARCH_SESSION_PREFETCH,
            "status_history",
        ).select_related("customer")
        
        serializer = RequestSerializer(requests, many=True)
        return Response(serializer.data)

    elif request.method == 'POST':
        customer_id = request.data.get('customer_id')
        intent = request.data.get('intent')
        item_data = request.data.get('item')
        
        if not customer_id:
            return Response(
                {"error": "customer_id is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not intent:
            return Response(
                {"error": "intent is required. Must be one of: BUYBACK, DIRECT_SALE, STORE_CREDIT"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate intent
        if intent not in [choice[0] for choice in RequestIntent.choices]:
            return Response(
                {"error": f"Invalid intent. Must be one of: {', '.join([c[0] for c in RequestIntent.choices])}"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not item_data:
            return Response(
                {"error": "At least one item is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            customer = Customer.objects.get(customer_id=customer_id)
        except Customer.DoesNotExist:
            return Response(
                {"error": "Customer not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        customer_enrichment = request.data.get('customer_enrichment')
        if customer_enrichment is not None and not isinstance(customer_enrichment, dict):
            customer_enrichment = None

        with transaction.atomic():
            # Create the request
            new_request = Request.objects.create(
                customer=customer,
                intent=intent,
                customer_enrichment_json=customer_enrichment
            )
            
            # Create initial status history entry
            RequestStatusHistory.objects.create(
                request=new_request,
                status=RequestStatus.QUOTE
            )
            
            # Create the first item
            item_payload = item_data.copy()  # ✅ Create a copy
            item_payload['request'] = new_request.request_id
            _resolve_cex_sku_to_variant(item_payload)
            item_serializer = RequestItemSerializer(data=item_payload)

            if item_serializer.is_valid():
                item_serializer.save()
            else:
                return Response(
                    item_serializer.errors,
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Return the full request with nested data (prefetch research for serializer)
            new_request = (
                Request.objects.prefetch_related(
                    "items__variant",
                    _RESEARCH_SESSION_PREFETCH,
                    "status_history",
                )
                .select_related("customer")
                .get(pk=new_request.pk)
            )
            response_serializer = RequestSerializer(new_request)
            return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def add_request_item(request, request_id):
    """
    POST: Add another item to an existing QUOTE request
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    
    # Check current status
    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only add items to QUOTE requests"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Add request to the data
    item_data = request.data.copy()
    customer_enrichment = item_data.pop('customer_enrichment', None)
    item_data['request'] = request_id
    _resolve_cex_sku_to_variant(item_data)

    # Optionally update customer enrichment if provided and not yet set
    if customer_enrichment is not None and isinstance(customer_enrichment, dict) and existing_request.customer_enrichment_json is None:
        existing_request.customer_enrichment_json = customer_enrichment
        existing_request.save(update_fields=['customer_enrichment_json'])

    serializer = RequestItemSerializer(data=item_data)
    
    if serializer.is_valid():
        item = serializer.save()
        item = (
            RequestItem.objects.prefetch_related(
                "market_research_sessions__listings",
                "market_research_sessions__drill_levels",
            )
            .select_related("variant", "variant__product", "variant__product__category")
            .get(pk=item.pk)
        )
        return Response(RequestItemSerializer(item).data, status=status.HTTP_201_CREATED)

    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
def request_detail(request, request_id):
    """
    GET: Retrieve full details of a request including all items and status history
    """
    existing_request = get_object_or_404(
        Request.objects.prefetch_related(
            "items__variant",
            _RESEARCH_SESSION_PREFETCH,
            "status_history",
            "jewellery_reference_history",
        ).select_related(
            "customer",
            "current_jewellery_reference_snapshot",
        ),
        request_id=request_id,
    )
    
    serializer = RequestSerializer(existing_request)
    return Response(serializer.data)


@api_view(['PATCH'])
def update_park_agreement_state(request, request_id):
    """
    PATCH: Persist park agreement state (NosPos agreement id, excluded item ids) for a request.
    Body: { nosposAgreementId?: str|null, excludedItemIds?: list[str|int] }
    Merges into existing park_agreement_state_json rather than replacing entirely.
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    current = {
        k: v for k, v in (existing_request.park_agreement_state_json or {}).items()
        if k != 'nosposAgreementUrl'
    }

    agreement_id = request.data.get('nosposAgreementId', current.get('nosposAgreementId'))
    excl = request.data.get('excludedItemIds', current.get('excludedItemIds'))

    # Normalise types
    if agreement_id is not None:
        agreement_id = str(agreement_id).strip() or None
    if excl is not None:
        if isinstance(excl, (list, tuple)):
            excl = [str(x) for x in excl]
        else:
            excl = []

    updated = {**current}
    if 'nosposAgreementId' in request.data or agreement_id != current.get('nosposAgreementId'):
        updated['nosposAgreementId'] = agreement_id
    if 'excludedItemIds' in request.data:
        updated['excludedItemIds'] = excl

    existing_request.park_agreement_state_json = updated
    existing_request.save(update_fields=['park_agreement_state_json'])
    return Response({'ok': True, 'park_agreement_state_json': updated})


@api_view(['POST'])
def update_request_intent(request, request_id):
    """
    POST: Update the intent of a request
    """
    existing_request = get_object_or_404(Request, request_id=request_id)

    new_intent = request.data.get('intent')
    if not new_intent:
        return Response(
            {"error": "Missing 'intent' field in request data"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if new_intent not in [choice[0] for choice in RequestIntent.choices]:
        return Response(
            {"error": f"Invalid intent. Valid choices: {[choice[0] for choice in RequestIntent.choices]}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    existing_request.intent = new_intent
    existing_request.save(update_fields=['intent'])

    return Response(
        {
            "request_id": existing_request.request_id,
            "intent": existing_request.intent
        },
        status=status.HTTP_200_OK
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


@api_view(['GET'])
def requests_overview_list(request):
    """
    GET: List all requests, optionally filtered by status.
    Query params: ?status=QUOTE or ?status=BOOKED_FOR_TESTING or ?status=COMPLETE
    """
    # Annotate each request with its latest status
    latest_status_subquery = Subquery(
        RequestStatusHistory.objects.filter(request=OuterRef('pk'))
        .order_by('-effective_at')
        .values('status')[:1]
    )
    
    requests = Request.objects.annotate(
        latest_status=latest_status_subquery
    ).prefetch_related(
        "items__variant",
        _RESEARCH_SESSION_PREFETCH,
        "status_history",
    ).select_related("customer").order_by("-created_at")

    status_filter = request.query_params.get('status')
    if status_filter:
        requests = requests.filter(latest_status=status_filter)
        
    serializer = RequestSerializer(requests, many=True)
    return Response(serializer.data)


@api_view(['PATCH'])
def update_request_item(request, request_item_id):
    """
    PATCH: Update offer selection and persisted offer data for a request item (QUOTE),
    or toggle testing_passed only (BOOKED_FOR_TESTING).
    """
    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)
    existing_request = existing_item.request
    current_status = existing_request.status_history.first()
    if not current_status:
        return Response(
            {"error": "Request has no status history"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if current_status.status == RequestStatus.BOOKED_FOR_TESTING:
        extra_keys = set(request.data.keys()) - {'testing_passed'}
        if extra_keys:
            return Response(
                {
                    "error": "For booked-for-testing requests, only 'testing_passed' may be updated on a line.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if 'testing_passed' not in request.data:
            return Response(
                {"error": "Missing 'testing_passed'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing_item.testing_passed = bool(request.data['testing_passed'])
        existing_item.save(update_fields=['testing_passed'])
        from .serializers import RequestItemSerializer
        return Response(RequestItemSerializer(existing_item).data, status=status.HTTP_200_OK)

    if current_status.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only update items in QUOTE or BOOKED_FOR_TESTING requests"},
            status=status.HTTP_400_BAD_REQUEST
        )

    update_fields = []
    cash_offers_payload = None
    voucher_offers_payload = None
    selected_offer_id_payload = None
    if 'selected_offer_id' in request.data:
        selected_offer_id_payload = request.data['selected_offer_id'] or None
    if 'manual_offer_used' in request.data:
        existing_item.manual_offer_used = bool(request.data['manual_offer_used'])
        update_fields.append('manual_offer_used')
    if 'manual_offer_gbp' in request.data:
        val = request.data['manual_offer_gbp']
        try:
            existing_item.manual_offer_gbp = parse_optional_money(
                RequestItem, "manual_offer_gbp", val, existing_item
            )
            update_fields.append('manual_offer_gbp')
        except DjangoValidationError as e:
            return Response(
                {'error': e.messages[0] if e.messages else 'Invalid manual_offer_gbp'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    if 'customer_expectation_gbp' in request.data:
        val = request.data['customer_expectation_gbp']
        try:
            if val is None or val == '':
                existing_item.customer_expectation_gbp = None
            else:
                dec = Decimal(str(val))
                RequestItem._meta.get_field('customer_expectation_gbp').clean(dec, existing_item)
                existing_item.customer_expectation_gbp = dec
            update_fields.append('customer_expectation_gbp')
        except (InvalidOperation, TypeError):
            return Response(
                {'error': 'Invalid format for customer_expectation_gbp'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except DjangoValidationError as e:
            return Response(
                {'error': e.messages[0] if e.messages else 'Invalid customer_expectation_gbp'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    if 'our_sale_price_at_negotiation' in request.data:
        val = request.data['our_sale_price_at_negotiation']
        try:
            existing_item.our_sale_price_at_negotiation = parse_optional_money(
                RequestItem, "our_sale_price_at_negotiation", val, existing_item
            )
            update_fields.append('our_sale_price_at_negotiation')
        except DjangoValidationError as e:
            return Response(
                {'error': e.messages[0] if e.messages else 'Invalid our_sale_price_at_negotiation'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    if 'cash_offers_json' in request.data:
        cash_offers_payload = request.data['cash_offers_json'] or []
    if 'voucher_offers_json' in request.data:
        voucher_offers_payload = request.data['voucher_offers_json'] or []
    if 'quantity' in request.data:
        try:
            existing_item.quantity = max(1, int(request.data['quantity']))
            update_fields.append('quantity')
        except (ValueError, TypeError):
            pass
    if 'senior_mgmt_approved_by' in request.data:
        meta = dict(existing_item.line_metadata_json or {})
        raw_name = request.data.get('senior_mgmt_approved_by')
        name = str(raw_name).strip() if raw_name is not None else ''
        if name:
            meta['senior_mgmt_approved_by'] = name
        else:
            meta.pop('senior_mgmt_approved_by', None)
        existing_item.line_metadata_json = meta if meta else None
        update_fields.append('line_metadata_json')

    if update_fields:
        existing_item.save(update_fields=update_fields)
    if (
        selected_offer_id_payload is not None
        or 'manual_offer_gbp' in update_fields
        or cash_offers_payload is not None
        or voucher_offers_payload is not None
    ):
        try:
            sync_request_item_offer_rows_from_payload(
                existing_item,
                selected_offer_id=(
                    selected_offer_id_payload
                    if selected_offer_id_payload is not None
                    else get_selected_offer_code(existing_item)
                ),
                cash_offers=cash_offers_payload if cash_offers_payload is not None else [],
                voucher_offers=voucher_offers_payload if voucher_offers_payload is not None else [],
                manual_offer_gbp=existing_item.manual_offer_gbp,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    from .serializers import RequestItemSerializer
    serializer = RequestItemSerializer(existing_item)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
def update_request_item_raw_data(request, request_item_id):
    """
    POST: Update research data fields for a specific request item
    """
    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)

    has_raw_data = 'raw_data' in request.data
    has_cash_converters_data = 'cash_converters_data' in request.data
    has_cg_data = 'cg_data' in request.data
    if not has_raw_data and not has_cash_converters_data and not has_cg_data:
        return Response(
            {
                "error": "Provide at least one of: 'raw_data', 'cash_converters_data', 'cg_data' in request data"
            },
            status=status.HTTP_400_BAD_REQUEST
        )

    if has_raw_data:
        new_raw_data = request.data.get("raw_data")
        if new_raw_data is not None and not isinstance(new_raw_data, dict):
            return Response(
                {"error": "'raw_data' must be a JSON object/dict or null"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        research_storage.apply_partial_raw_data_update(existing_item, new_raw_data)

    if has_cash_converters_data:
        new_cc = request.data.get("cash_converters_data")
        if new_cc is not None and not isinstance(new_cc, dict):
            return Response(
                {"error": "'cash_converters_data' must be a JSON object/dict or null"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        research_storage.apply_partial_cc_data_update(existing_item, new_cc)

    if has_cg_data:
        new_cg = request.data.get("cg_data")
        if new_cg is not None and not isinstance(new_cg, dict):
            return Response(
                {"error": "'cg_data' must be a JSON object/dict or null"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        research_storage.apply_partial_cg_data_update(existing_item, new_cg)

    return Response(
        {
            "request_item_id": existing_item.request_item_id,
            "raw_data": research_storage.compose_raw_data_for_request_item(existing_item),
            "cash_converters_data": research_storage.compose_cash_converters_for_request_item(
                existing_item
            ),
            "cg_data": research_storage.compose_cash_generator_for_request_item(existing_item),
        },
        status=status.HTTP_200_OK,
    )


@api_view(['DELETE'])
def delete_request_item(request, request_item_id):
    """
    DELETE: Remove a request item from its request.
    Only allowed for QUOTE requests.
    """
    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)
    existing_request = existing_item.request

    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only remove items from QUOTE requests"},
            status=status.HTTP_400_BAD_REQUEST
        )

    existing_item.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
def finish_request(request, request_id):
    """
    POST: Finalize a request with negotiation data and move it to BOOKED_FOR_TESTING status.
    Expects:
    - items_data: list of dicts, each containing request_item_id and negotiated fields.
    - overall_expectation_gbp: Decimal, customer's total expectation.
    - negotiated_grand_total_gbp: Decimal, the final grand total offer.
    """
    existing_request = get_object_or_404(Request, request_id=request_id)

    # Check current status
    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only finalize QUOTE requests"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Ensure request has at least one item
    if not existing_request.items.exists():
        return Response(
            {"error": "Cannot finalize request with no items"},
            status=status.HTTP_400_BAD_REQUEST
        )

    items_data = request.data.get('items_data', [])
    overall_expectation_gbp = request.data.get('overall_expectation_gbp')
    negotiated_grand_total_gbp = request.data.get('negotiated_grand_total_gbp')
    target_offer_gbp = request.data.get('target_offer_gbp')
    customer_enrichment = request.data.get('customer_enrichment')

    # Validate incoming data for main request
    if overall_expectation_gbp is not None:
        try:
            existing_request.overall_expectation_gbp = parse_optional_money(
                Request, "overall_expectation_gbp", overall_expectation_gbp, existing_request
            )
        except DjangoValidationError as e:
            return Response(
                {"error": e.messages[0] if e.messages else "Invalid overall_expectation_gbp"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if negotiated_grand_total_gbp is not None:
        try:
            existing_request.negotiated_grand_total_gbp = parse_optional_money(
                Request, "negotiated_grand_total_gbp", negotiated_grand_total_gbp, existing_request
            )
        except DjangoValidationError as e:
            return Response(
                {"error": e.messages[0] if e.messages else "Invalid negotiated_grand_total_gbp"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if target_offer_gbp is not None:
        try:
            existing_request.target_offer_gbp = parse_optional_money(
                Request, "target_offer_gbp", target_offer_gbp, existing_request
            )
        except DjangoValidationError as e:
            return Response(
                {"error": e.messages[0] if e.messages else "Invalid target_offer_gbp"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    update_request_fields = ['overall_expectation_gbp', 'negotiated_grand_total_gbp', 'target_offer_gbp']
    if customer_enrichment is not None:
        if not isinstance(customer_enrichment, dict):
            return Response(
                {"error": "customer_enrichment must be a JSON object"},
                status=status.HTTP_400_BAD_REQUEST
            )
        existing_request.customer_enrichment_json = customer_enrichment
        update_request_fields.append('customer_enrichment_json')

    jewellery_reference_scrape = request.data.get('jewellery_reference_scrape')
    if jewellery_reference_scrape is not None:
        try:
            _sync_request_jewellery_reference_snapshot(existing_request, jewellery_reference_scrape)
        except ValueError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_400_BAD_REQUEST
            )
        update_request_fields.append('current_jewellery_reference_snapshot')

    existing_request.save(update_fields=update_request_fields)

    # Update individual request items
    for item_data in items_data:
        request_item_id = item_data.get('request_item_id')
        if not request_item_id:
            return Response(
                {"error": "Each item in items_data must have a 'request_item_id'"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            request_item = existing_request.items.get(request_item_id=request_item_id)
        except RequestItem.DoesNotExist:
            return Response(
                {"error": f"RequestItem with ID {request_item_id} not found for this request"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Update fields for RequestItem
        update_fields = []
        cash_offers_payload = None
        voucher_offers_payload = None
        selected_offer_id_payload = None

        # Save historical CEX prices: prefer values from payload (e.g. "Add from CeX" items with no variant),
        # otherwise use variant prices when available
        cex_from_payload = (
            'cex_buy_cash_at_negotiation' in item_data
            or 'cex_buy_voucher_at_negotiation' in item_data
            or 'cex_sell_at_negotiation' in item_data
        )
        if cex_from_payload:
            for field in ('cex_buy_cash_at_negotiation', 'cex_buy_voucher_at_negotiation', 'cex_sell_at_negotiation'):
                if field in item_data and item_data[field] is not None:
                    try:
                        dec = parse_optional_money(RequestItem, field, item_data[field], request_item)
                        setattr(request_item, field, dec)
                        update_fields.append(field)
                    except DjangoValidationError as e:
                        return Response(
                            {
                                "error": f"{field} for item {request_item_id}: "
                                f"{e.messages[0] if e.messages else 'invalid'}",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
        elif request_item.variant and not _is_jewellery_placeholder_variant(request_item.variant):
            request_item.cex_buy_cash_at_negotiation = request_item.variant.tradein_cash
            update_fields.append('cex_buy_cash_at_negotiation')
            request_item.cex_buy_voucher_at_negotiation = request_item.variant.tradein_voucher
            update_fields.append('cex_buy_voucher_at_negotiation')
            request_item.cex_sell_at_negotiation = request_item.variant.current_price_gbp
            update_fields.append('cex_sell_at_negotiation')

        if 'quantity' in item_data:
            request_item.quantity = item_data['quantity']
            update_fields.append('quantity')
        if 'selected_offer_id' in item_data:
            selected_offer_id_payload = item_data['selected_offer_id']
        if 'manual_offer_gbp' in item_data:
            try:
                request_item.manual_offer_gbp = parse_optional_money(
                    RequestItem, "manual_offer_gbp", item_data["manual_offer_gbp"], request_item
                )
                update_fields.append('manual_offer_gbp')
            except DjangoValidationError as e:
                return Response(
                    {"error": f"manual_offer_gbp for item {request_item_id}: {e.messages[0]}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if 'customer_expectation_gbp' in item_data:
            try:
                request_item.customer_expectation_gbp = parse_optional_money(
                    RequestItem,
                    "customer_expectation_gbp",
                    item_data["customer_expectation_gbp"],
                    request_item,
                )
                update_fields.append('customer_expectation_gbp')
            except DjangoValidationError as e:
                return Response(
                    {"error": f"customer_expectation_gbp for item {request_item_id}: {e.messages[0]}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if 'negotiated_price_gbp' in item_data:
            try:
                request_item.negotiated_price_gbp = parse_optional_money(
                    RequestItem,
                    "negotiated_price_gbp",
                    item_data["negotiated_price_gbp"],
                    request_item,
                )
                update_fields.append('negotiated_price_gbp')
            except DjangoValidationError as e:
                return Response(
                    {"error": f"negotiated_price_gbp for item {request_item_id}: {e.messages[0]}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if (
            "raw_data" in item_data
            or "cash_converters_data" in item_data
            or "cg_data" in item_data
        ):
            research_storage.finish_sync_request_item_research(
                request_item,
                item_data.get("raw_data"),
                item_data.get("cash_converters_data"),
                item_data.get("cg_data"),
            )

        if 'cash_offers_json' in item_data:
            cash_offers_payload = item_data['cash_offers_json'] or []
        
        if 'voucher_offers_json' in item_data:
            voucher_offers_payload = item_data['voucher_offers_json'] or []
        
        if 'our_sale_price_at_negotiation' in item_data:
            try:
                request_item.our_sale_price_at_negotiation = parse_optional_money(
                    RequestItem,
                    "our_sale_price_at_negotiation",
                    item_data["our_sale_price_at_negotiation"],
                    request_item,
                )
                update_fields.append('our_sale_price_at_negotiation')
            except DjangoValidationError as e:
                return Response(
                    {"error": f"our_sale_price_at_negotiation for item {request_item_id}: {e.messages[0]}"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        if 'manual_offer_used' in item_data:
            request_item.manual_offer_used = bool(item_data['manual_offer_used'])
            update_fields.append('manual_offer_used')
        if 'senior_mgmt_approved_by' in item_data:
            meta = dict(request_item.line_metadata_json or {})
            raw_name = item_data.get('senior_mgmt_approved_by')
            name = str(raw_name).strip() if raw_name is not None else ''
            if name:
                meta['senior_mgmt_approved_by'] = name
            else:
                meta.pop('senior_mgmt_approved_by', None)
            request_item.line_metadata_json = meta if meta else None
            update_fields.append('line_metadata_json')
        if update_fields:
            request_item.save(update_fields=update_fields)
        if (
            selected_offer_id_payload is not None
            or 'manual_offer_gbp' in update_fields
            or cash_offers_payload is not None
            or voucher_offers_payload is not None
        ):
            try:
                sync_request_item_offer_rows_from_payload(
                    request_item,
                    selected_offer_id=(
                        selected_offer_id_payload
                        if selected_offer_id_payload is not None
                        else get_selected_offer_code(request_item)
                    ),
                    cash_offers=cash_offers_payload if cash_offers_payload is not None else [],
                    voucher_offers=voucher_offers_payload if voucher_offers_payload is not None else [],
                    manual_offer_gbp=request_item.manual_offer_gbp,
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # When save_only/request_not_completed: save all data but stay in QUOTE (for tab close / draft)
    save_only = request.data.get('save_only') or request.data.get('request_not_completed')
    if not save_only:
        # Create new status history entry (move to BOOKED_FOR_TESTING)
        RequestStatusHistory.objects.create(
            request=existing_request,
            status=RequestStatus.BOOKED_FOR_TESTING
        )
        # Fresh testing workflow: every line starts unchecked until staff ticks it in view.
        existing_request.items.update(testing_passed=False)

    return Response(
        {
            "request_id": existing_request.request_id,
            "status": RequestStatus.QUOTE if save_only else RequestStatus.BOOKED_FOR_TESTING,
            "items_count": existing_request.items.count(),
            "overall_expectation_gbp": existing_request.overall_expectation_gbp,
            "negotiated_grand_total_gbp": existing_request.negotiated_grand_total_gbp,
            "target_offer_gbp": existing_request.target_offer_gbp,
        },
        status=status.HTTP_200_OK
    )


@api_view(['POST'])
def cancel_request(request, request_id):
    """
    POST: Cancel a request - removed, as CANCELLED status no longer exists
    """
    return Response(
        {"error": "Cancellation is no longer supported. Requests can only be QUOTE, BOOKED_FOR_TESTING, or COMPLETE."},
        status=status.HTTP_400_BAD_REQUEST
    )


@api_view(['POST'])
def complete_request_after_testing(request, request_id):
    """
    POST: Record that in-store testing passed — moves request from BOOKED_FOR_TESTING to COMPLETE.
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    current = existing_request.status_history.first()
    if not current or current.status != RequestStatus.BOOKED_FOR_TESTING:
        return Response(
            {"error": "Only requests that are booked for testing can be marked as passed."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    eligible_items = [
        i
        for i in existing_request.items.all()
        if i.negotiated_price_gbp is not None
    ]
    if not eligible_items:
        return Response(
            {"error": "Request has no negotiated lines to complete."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not all(i.testing_passed for i in eligible_items):
        return Response(
            {"error": "Mark testing passed on every active line before completing the request."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    with transaction.atomic():
        RequestStatusHistory.objects.create(
            request=existing_request,
            status=RequestStatus.COMPLETE,
        )
    return Response(
        {
            "request_id": existing_request.request_id,
            "status": RequestStatus.COMPLETE,
        },
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
def variant_market_stats(request):
    """
    Returns competitor / CeX market stats for a given variant SKU.
    """
    sku = request.GET.get('sku')

    if not sku:
        return Response(
            {"detail": "Missing required query param: sku"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        variant = Variant.objects.get(cex_sku=sku)
    except Variant.DoesNotExist:
        return Response(
            {"detail": "Variant not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    serializer = VariantMarketStatsSerializer(variant)
    return Response(serializer.data)


# _fetch_cex_box_detail imported from pricing.services.cex_client


@api_view(['GET'])
def variant_prices(request):
    sku = request.GET.get('sku')

    if not sku:
        return Response(
            {"detail": "Missing required query param: sku"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        variant = Variant.objects.get(cex_sku=sku)
    except Variant.DoesNotExist:
        return Response(
            {"detail": "Variant not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    # --- Reference Data (prefer live CEX API, fallback to DB) ---
    cex_box = _fetch_cex_box_detail(sku)
    if cex_box is not None:
        cex_sale_price = float(cex_box.get("sellPrice", 0) or variant.current_price_gbp)
        cex_tradein_cash = float(cex_box.get("cashPrice", 0) or variant.tradein_cash)
        cex_tradein_voucher = float(cex_box.get("exchangePrice", 0) or variant.tradein_voucher)
        image_urls = cex_box.get("imageUrls") or {}
        # CeX Box API uses `outOfStock` as an integer (0 or 1)
        cex_out_of_stock = bool(cex_box.get("outOfStock", 0))
    else:
        cex_sale_price = float(variant.current_price_gbp)
        cex_tradein_cash = float(variant.tradein_cash)
        cex_tradein_voucher = float(variant.tradein_voucher)
        image_urls = {}
        cex_out_of_stock = bool(variant.cex_out_of_stock)

    # Our Target Sale Price
    # Always compute our_sale_price relative to the *live* cex_sale_price so that
    # offer_1 (based on our margin) never ends up above offer_3 (CeX trade-in)
    # when the DB price is stale vs the live CeX price.
    target_sell_price = variant.get_target_sell_price()
    if target_sell_price is not None and float(variant.current_price_gbp) > 0:
        # Derive the multiplier implied by the pricing rule, then apply it to the
        # live CeX sell price so both our_sale_price and cex_sale_price stay in sync.
        multiplier = float(target_sell_price) / float(variant.current_price_gbp)
        our_sale_price = _round_sale_price(cex_sale_price * multiplier)
        percentage_used = round(multiplier * 100, 2)
    else:
        percentage_used = 85.0
        our_sale_price = _round_sale_price(cex_sale_price * 0.85)

    # Resolve first/second/third offer pct from the applicable pricing rule
    applicable_rule = variant.get_applicable_rule()
    first_offer_pct = (
        float(applicable_rule.first_offer_pct_of_cex)
        if applicable_rule and applicable_rule.first_offer_pct_of_cex is not None
        else None
    )
    second_offer_pct = (
        float(applicable_rule.second_offer_pct_of_cex)
        if applicable_rule and applicable_rule.second_offer_pct_of_cex is not None
        else None
    )
    third_offer_pct = (
        float(applicable_rule.third_offer_pct_of_cex)
        if applicable_rule and applicable_rule.third_offer_pct_of_cex is not None
        else None
    )

    # Generate both sets via shared offer engine to keep endpoint behavior in sync.
    cash_offers = build_offer_set(
        cex_reference_buy_price=cex_tradein_cash,
        prefix="cash",
        cex_sale_price=cex_sale_price,
        our_sale_price=our_sale_price,
        first_offer_pct=first_offer_pct,
        second_offer_pct=second_offer_pct,
        third_offer_pct=third_offer_pct,
    )
    voucher_offers = build_offer_set(
        cex_reference_buy_price=cex_tradein_voucher,
        prefix="voucher",
        cex_sale_price=cex_sale_price,
        our_sale_price=our_sale_price,
        first_offer_pct=first_offer_pct,
        second_offer_pct=second_offer_pct,
        third_offer_pct=third_offer_pct,
    )

    reference_data = {
        "cex_sale_price": cex_sale_price,
        "cex_tradein_cash": cex_tradein_cash,
        "cex_tradein_voucher": cex_tradein_voucher,
        "cex_based_sale_price": our_sale_price,
        "percentage_used": percentage_used,
        "cex_out_of_stock": cex_out_of_stock,
        "first_offer_pct_of_cex": first_offer_pct,
        "second_offer_pct_of_cex": second_offer_pct,
        "third_offer_pct_of_cex": third_offer_pct,
    }
    if image_urls:
        reference_data["cex_image_urls"] = {
            "large": image_urls.get("large"),
            "medium": image_urls.get("medium"),
            "small": image_urls.get("small"),
        }

    return Response({
        "sku": sku,
        "cash_offers": cash_offers,
        "voucher_offers": voucher_offers,
        "reference_data": reference_data
    })


@api_view(['POST'])
def cex_product_prices(request):
    """
    Calculate offers from scraped CeX product-detail page data (no variant).
    Used when adding a product via "Add from CeX" - we have sell/trade-in prices
    from the page but no variant in our DB.
    """
    data = request.data or {}
    logger.info("[CG Suite] cex_product_prices received: %s", data)

    sell_price = data.get('sell_price') or data.get('sellPrice')
    tradein_cash = data.get('tradein_cash') or data.get('tradeInCash')
    tradein_voucher = data.get('tradein_voucher') or data.get('tradeInVoucher')

    if sell_price is None and tradein_cash is None and tradein_voucher is None:
        return Response(
            {"detail": "At least one of sell_price, tradein_cash, tradein_voucher is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    cex_sale_price = float(sell_price or 0)
    cex_tradein_cash = float(tradein_cash or 0)
    cex_tradein_voucher = float(tradein_voucher or 0)

    # Resolve the best pricing rule: category (walked up the hierarchy) → global default
    rule = None
    category_id = data.get('category_id')
    if category_id:
        try:
            from pricing.models_v2 import ProductCategory
            category = ProductCategory.objects.get(pk=category_id)
            for cat in category.iter_ancestors(include_self=True):
                rule = PricingRule.objects.filter(category=cat).first()
                if rule:
                    logger.info("[CG Suite] cex_product_prices: matched category rule via category_id=%s → cat=%s rule=%s", category_id, cat.name, rule)
                    break
        except Exception as exc:
            logger.warning("[CG Suite] cex_product_prices: could not resolve category_id=%s: %s", category_id, exc)

    if rule is None:
        rule = PricingRule.objects.filter(is_global_default=True).first()
        if rule:
            logger.info("[CG Suite] cex_product_prices: using global default rule (category_id=%s)", category_id)

    if rule:
        percentage_used = round(float(rule.sell_price_multiplier) * 100, 2)
        our_sale_price = _round_sale_price(cex_sale_price * float(rule.sell_price_multiplier))
        first_offer_pct = (
            float(rule.first_offer_pct_of_cex)
            if rule.first_offer_pct_of_cex is not None
            else None
        )
        second_offer_pct = (
            float(rule.second_offer_pct_of_cex)
            if rule.second_offer_pct_of_cex is not None
            else None
        )
        third_offer_pct = (
            float(rule.third_offer_pct_of_cex)
            if rule.third_offer_pct_of_cex is not None
            else None
        )
    else:
        percentage_used = 85.0
        our_sale_price = _round_sale_price(cex_sale_price * 0.85)
        first_offer_pct = None
        second_offer_pct = None
        third_offer_pct = None

    cash_offers = build_offer_set(
        cex_reference_buy_price=cex_tradein_cash,
        prefix="cash",
        cex_sale_price=cex_sale_price,
        our_sale_price=our_sale_price,
        first_offer_pct=first_offer_pct,
        second_offer_pct=second_offer_pct,
        third_offer_pct=third_offer_pct,
    )
    voucher_offers = build_offer_set(
        cex_reference_buy_price=cex_tradein_voucher,
        prefix="voucher",
        cex_sale_price=cex_sale_price,
        our_sale_price=our_sale_price,
        first_offer_pct=first_offer_pct,
        second_offer_pct=second_offer_pct,
        third_offer_pct=third_offer_pct,
    )

    reference_data = {
        "cex_sale_price": cex_sale_price,
        "cex_tradein_cash": cex_tradein_cash,
        "cex_tradein_voucher": cex_tradein_voucher,
        "cex_based_sale_price": our_sale_price,
        "percentage_used": percentage_used,
        "first_offer_pct_of_cex": first_offer_pct,
        "second_offer_pct_of_cex": second_offer_pct,
        "third_offer_pct_of_cex": third_offer_pct,
    }
    image_url = data.get('image_url') or data.get('image')
    if image_url:
        reference_data["cex_image_urls"] = {"large": image_url, "medium": image_url, "small": image_url}

    response_data = {
        "sku": data.get('sku') or data.get('id'),
        "cash_offers": cash_offers,
        "voucher_offers": voucher_offers,
        "reference_data": reference_data
    }
    logger.info("[CG Suite] cex_product_prices response: %s", response_data)
    return Response(response_data)


def _serialize_pricing_rule(rule):
    return {
        "id": rule.pricing_rule_id,
        "is_global_default": rule.is_global_default,
        "category": (
            {"id": rule.category.category_id, "name": rule.category.name}
            if rule.category else None
        ),
        "product": (
            {"id": rule.product.product_id, "name": rule.product.name}
            if rule.product else None
        ),
        "sell_price_multiplier": float(rule.sell_price_multiplier),
        "first_offer_pct_of_cex": (
            float(rule.first_offer_pct_of_cex)
            if rule.first_offer_pct_of_cex is not None else None
        ),
        "second_offer_pct_of_cex": (
            float(rule.second_offer_pct_of_cex)
            if rule.second_offer_pct_of_cex is not None else None
        ),
        "third_offer_pct_of_cex": (
            float(rule.third_offer_pct_of_cex)
            if rule.third_offer_pct_of_cex is not None else None
        ),
        "ebay_offer_margin_1_pct": (
            float(rule.ebay_offer_margin_1_pct)
            if rule.ebay_offer_margin_1_pct is not None else None
        ),
        "ebay_offer_margin_2_pct": (
            float(rule.ebay_offer_margin_2_pct)
            if rule.ebay_offer_margin_2_pct is not None else None
        ),
        "ebay_offer_margin_3_pct": (
            float(rule.ebay_offer_margin_3_pct)
            if rule.ebay_offer_margin_3_pct is not None else None
        ),
        "ebay_offer_margin_4_pct": (
            float(rule.ebay_offer_margin_4_pct)
            if rule.ebay_offer_margin_4_pct is not None else None
        ),
    }


@api_view(['GET', 'POST'])
def pricing_rules_view(request):
    """List all pricing rules or create a new one."""
    if request.method == 'GET':
        rules = (
            PricingRule.objects
            .select_related('category', 'product')
            .order_by('-is_global_default', 'category__name', 'product__name')
        )
        return Response([_serialize_pricing_rule(r) for r in rules])

    # POST — create
    data = request.data
    try:
        multiplier = Decimal(str(data['sell_price_multiplier']))
    except (KeyError, InvalidOperation):
        return Response({"error": "sell_price_multiplier is required and must be a number"}, status=400)

    is_global_default = bool(data.get('is_global_default', False))
    category_id = data.get('category_id')
    product_id = data.get('product_id')

    if not is_global_default and not category_id and not product_id:
        return Response({"error": "One of is_global_default, category_id, or product_id is required"}, status=400)

    first_offer_pct = data.get('first_offer_pct_of_cex')
    if first_offer_pct is not None:
        try:
            first_offer_pct = Decimal(str(first_offer_pct))
        except InvalidOperation:
            return Response({"error": "first_offer_pct_of_cex must be a number"}, status=400)

    second_offer_pct = data.get('second_offer_pct_of_cex')
    if second_offer_pct is not None:
        try:
            second_offer_pct = Decimal(str(second_offer_pct))
        except InvalidOperation:
            return Response({"error": "second_offer_pct_of_cex must be a number"}, status=400)

    third_offer_pct = data.get('third_offer_pct_of_cex')
    if third_offer_pct is not None:
        try:
            third_offer_pct = Decimal(str(third_offer_pct))
        except InvalidOperation:
            return Response({"error": "third_offer_pct_of_cex must be a number"}, status=400)

    ebay_margins = {}
    for field in (
        'ebay_offer_margin_1_pct',
        'ebay_offer_margin_2_pct',
        'ebay_offer_margin_3_pct',
        'ebay_offer_margin_4_pct',
    ):
        val = data.get(field)
        if val is not None:
            try:
                ebay_margins[field] = Decimal(str(val))
            except InvalidOperation:
                return Response({"error": f"{field} must be a number"}, status=400)
        else:
            ebay_margins[field] = None

    kwargs = {
        'sell_price_multiplier': multiplier,
        'first_offer_pct_of_cex': first_offer_pct,
        'second_offer_pct_of_cex': second_offer_pct,
        'third_offer_pct_of_cex': third_offer_pct,
        'is_global_default': is_global_default,
        **ebay_margins,
    }

    if category_id:
        try:
            kwargs['category'] = ProductCategory.objects.get(pk=category_id)
        except ProductCategory.DoesNotExist:
            return Response({"error": "Category not found"}, status=404)

    if product_id:
        try:
            kwargs['product'] = Product.objects.get(pk=product_id)
        except Product.DoesNotExist:
            return Response({"error": "Product not found"}, status=404)

    try:
        rule = PricingRule.objects.create(**kwargs)
    except Exception as e:
        return Response({"error": str(e)}, status=400)

    return Response(_serialize_pricing_rule(rule), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
def pricing_rule_detail(request, rule_id):
    """Retrieve, update, or delete a single pricing rule."""
    try:
        rule = PricingRule.objects.select_related('category', 'product').get(pk=rule_id)
    except PricingRule.DoesNotExist:
        return Response({"error": "Pricing rule not found"}, status=404)

    if request.method == 'GET':
        return Response(_serialize_pricing_rule(rule))

    if request.method == 'DELETE':
        rule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH
    data = request.data

    if 'sell_price_multiplier' in data:
        try:
            rule.sell_price_multiplier = Decimal(str(data['sell_price_multiplier']))
        except InvalidOperation:
            return Response({"error": "sell_price_multiplier must be a number"}, status=400)

    if 'first_offer_pct_of_cex' in data:
        val = data['first_offer_pct_of_cex']
        if val is None or val == '':
            rule.first_offer_pct_of_cex = None
        else:
            try:
                rule.first_offer_pct_of_cex = Decimal(str(val))
            except InvalidOperation:
                return Response({"error": "first_offer_pct_of_cex must be a number"}, status=400)

    if 'second_offer_pct_of_cex' in data:
        val = data['second_offer_pct_of_cex']
        if val is None or val == '':
            rule.second_offer_pct_of_cex = None
        else:
            try:
                rule.second_offer_pct_of_cex = Decimal(str(val))
            except InvalidOperation:
                return Response({"error": "second_offer_pct_of_cex must be a number"}, status=400)

    if 'third_offer_pct_of_cex' in data:
        val = data['third_offer_pct_of_cex']
        if val is None or val == '':
            rule.third_offer_pct_of_cex = None
        else:
            try:
                rule.third_offer_pct_of_cex = Decimal(str(val))
            except InvalidOperation:
                return Response({"error": "third_offer_pct_of_cex must be a number"}, status=400)

    for field in (
        'ebay_offer_margin_1_pct',
        'ebay_offer_margin_2_pct',
        'ebay_offer_margin_3_pct',
        'ebay_offer_margin_4_pct',
    ):
        if field in data:
            val = data[field]
            if val is None or val == '':
                setattr(rule, field, None)
            else:
                try:
                    setattr(rule, field, Decimal(str(val)))
                except InvalidOperation:
                    return Response({"error": f"{field} must be a number"}, status=400)

    try:
        rule.save()
    except Exception as e:
        return Response({"error": str(e)}, status=400)

    return Response(_serialize_pricing_rule(rule))


@api_view(['GET'])
def ebay_offer_margins(request):
    """Return effective eBay/Cash Converters offer % of suggested sale (four tiers).

    Values are percentages of suggested sale (e.g. 40 => offer = sell × 0.40).
    Fourth tier defaults to 100 (match suggested sale) when unset.

    Query param: ?category_id=<int>  (optional)
    Walks up the category tree, then global default, then [40, 50, 60, 100].
    """
    defaults = [40, 50, 60, 100]
    category_id = request.GET.get('category_id')

    def _extract_margins(rule):
        if rule is None:
            return None
        m1 = rule.ebay_offer_margin_1_pct
        m2 = rule.ebay_offer_margin_2_pct
        m3 = rule.ebay_offer_margin_3_pct
        m4 = rule.ebay_offer_margin_4_pct
        if m1 is None and m2 is None and m3 is None and m4 is None:
            return None
        return [
            float(m1) if m1 is not None else defaults[0],
            float(m2) if m2 is not None else defaults[1],
            float(m3) if m3 is not None else defaults[2],
            float(m4) if m4 is not None else defaults[3],
        ]

    margins = None

    if category_id:
        try:
            cat = ProductCategory.objects.get(pk=category_id)
            for ancestor in cat.iter_ancestors():
                rule = PricingRule.objects.filter(category=ancestor).first()
                margins = _extract_margins(rule)
                if margins:
                    break
        except ProductCategory.DoesNotExist:
            pass

    if not margins:
        global_rule = PricingRule.objects.filter(is_global_default=True).first()
        margins = _extract_margins(global_rule) or defaults

    return Response({
        "ebay_offer_margin_1_pct": margins[0],
        "ebay_offer_margin_2_pct": margins[1],
        "ebay_offer_margin_3_pct": margins[2],
        "ebay_offer_margin_4_pct": margins[3],
    })


# ─── Customer Offer Rules ──────────────────────────────────────────────────────

def _serialize_customer_rule_settings(settings):
    return {
        "low_cr_max_pct": float(settings.low_cr_max_pct),
        "mid_cr_max_pct": float(settings.mid_cr_max_pct),
        "jewellery_offer_margin_1_pct": float(settings.jewellery_offer_margin_1_pct),
        "jewellery_offer_margin_2_pct": float(settings.jewellery_offer_margin_2_pct),
        "jewellery_offer_margin_3_pct": float(settings.jewellery_offer_margin_3_pct),
        "jewellery_offer_margin_4_pct": float(settings.jewellery_offer_margin_4_pct),
    }


def _serialize_customer_offer_rule(rule):
    return {
        "customer_type": rule.customer_type,
        "allow_offer_1": rule.allow_offer_1,
        "allow_offer_2": rule.allow_offer_2,
        "allow_offer_3": rule.allow_offer_3,
        "allow_offer_4": rule.allow_offer_4,
        "allow_manual": rule.allow_manual,
    }


@api_view(['GET', 'PUT'])
def customer_rule_settings_view(request):
    """Get or update the global cancel-rate tier thresholds (singleton)."""
    settings = CustomerRuleSettings.get_singleton()

    if request.method == 'GET':
        return Response(_serialize_customer_rule_settings(settings))

    data = request.data
    for field in (
        'low_cr_max_pct',
        'mid_cr_max_pct',
        'jewellery_offer_margin_1_pct',
        'jewellery_offer_margin_2_pct',
        'jewellery_offer_margin_3_pct',
        'jewellery_offer_margin_4_pct',
    ):
        if field in data:
            try:
                setattr(settings, field, Decimal(str(data[field])))
            except InvalidOperation:
                return Response({"error": f"{field} must be a number"}, status=400)

    if Decimal(str(settings.low_cr_max_pct)) >= Decimal(str(settings.mid_cr_max_pct)):
        return Response({"error": "low_cr_max_pct must be less than mid_cr_max_pct"}, status=400)

    jewellery_margins = [
        Decimal(str(settings.jewellery_offer_margin_1_pct)),
        Decimal(str(settings.jewellery_offer_margin_2_pct)),
        Decimal(str(settings.jewellery_offer_margin_3_pct)),
        Decimal(str(settings.jewellery_offer_margin_4_pct)),
    ]
    if any(m < 0 or m > 100 for m in jewellery_margins):
        return Response(
            {"error": "jewellery margins must be between 0 and 100"},
            status=400,
        )
    if not (
        jewellery_margins[0] > jewellery_margins[1]
        and jewellery_margins[1] > jewellery_margins[2]
        and jewellery_margins[2] > jewellery_margins[3]
    ):
        return Response(
            {"error": "jewellery margins must be strictly descending (offer1 > offer2 > offer3 > offer4)"},
            status=400,
        )

    settings.save()
    return Response(_serialize_customer_rule_settings(settings))


@api_view(['GET'])
def customer_offer_rules_view(request):
    """Return all 4 customer offer rules (creating defaults if they don't exist)."""
    DEFAULTS = {
        'new_customer': {'allow_offer_1': False, 'allow_offer_2': False, 'allow_offer_3': True, 'allow_offer_4': True, 'allow_manual': False},
        'low_cr':       {'allow_offer_1': True,  'allow_offer_2': True,  'allow_offer_3': True, 'allow_offer_4': True, 'allow_manual': True},
        'mid_cr':       {'allow_offer_1': True,  'allow_offer_2': True,  'allow_offer_3': True, 'allow_offer_4': True, 'allow_manual': True},
        'high_cr':      {'allow_offer_1': True,  'allow_offer_2': True,  'allow_offer_3': True, 'allow_offer_4': True, 'allow_manual': True},
    }
    rules = {}
    for ct, defaults in DEFAULTS.items():
        obj, _ = CustomerOfferRule.objects.get_or_create(customer_type=ct, defaults=defaults)
        rules[ct] = obj

    settings = CustomerRuleSettings.get_singleton()
    return Response({
        "settings": _serialize_customer_rule_settings(settings),
        "rules": {ct: _serialize_customer_offer_rule(obj) for ct, obj in rules.items()},
    })


@api_view(['PUT'])
def customer_offer_rule_detail(request, customer_type):
    """Update a single customer offer rule by type."""
    valid_types = {'new_customer', 'low_cr', 'mid_cr', 'high_cr'}
    if customer_type not in valid_types:
        return Response({"error": "Invalid customer_type"}, status=400)

    rule, _ = CustomerOfferRule.objects.get_or_create(customer_type=customer_type)
    data = request.data
    for field in ('allow_offer_1', 'allow_offer_2', 'allow_offer_3', 'allow_offer_4', 'allow_manual'):
        if field in data:
            setattr(rule, field, bool(data[field]))
    rule.save()
    return Response(_serialize_customer_offer_rule(rule))


# react app
def react_app(request):
    return render(request, "react.html")


@api_view(['GET'])
def product_variants(request):
    """
    Returns all variants for a given product, along with
    dynamic attributes and their allowed values inferred from variants.
    
    Query param: ?product_id=<id>
    """
    product_id = request.query_params.get('product_id')
    if not product_id:
        return Response({"error": "product_id query param is required"}, status=400)

    try:
        product = Product.objects.get(pk=product_id)
    except Product.DoesNotExist:
        return Response({"error": "Product not found"}, status=404)

    # Fetch all variants and prefetch their attribute values
    variants = Variant.objects.filter(product=product).prefetch_related(
        'attribute_values__attribute'
    )

    if not variants.exists():
        return Response({"variants": [], "attributes": []})

    # 1️⃣ Build attributes dictionary dynamically from variants
    attr_map = {}  # {attribute_code: {"label": ..., "values": set()}}
    for v in variants:
        for av in v.attribute_values.all():
            code = av.attribute.code
            if code not in attr_map:
                attr_map[code] = {
                    "label": av.attribute.label,
                    "values": set()
                }
            attr_map[code]["values"].add(av.value)

    # Convert sets to sorted lists
    attributes = []
    for code, data in attr_map.items():
        attributes.append({
            "code": code,
            "label": data["label"],
            "values": sorted(list(data["values"]))
        })

    # 2️⃣ Compute dependencies based on variants
    # For each attribute, figure out which values of other attributes co-exist
    dependencies = []
    attr_codes = list(attr_map.keys())

    for target_attr in attr_codes:
        dep_rules = {}
        for other_attr in attr_codes:
            if other_attr == target_attr:
                continue

            # Build mapping: for each value of other_attr, what values of target_attr exist
            mapping = {}
            for v in variants:
                target_value = next((av.value for av in v.attribute_values.all() if av.attribute.code == target_attr), None)
                other_value = next((av.value for av in v.attribute_values.all() if av.attribute.code == other_attr), None)
                if target_value is None or other_value is None:
                    continue
                if other_value not in mapping:
                    mapping[other_value] = set()
                mapping[other_value].add(target_value)

            # Convert sets to lists
            mapping = {k: sorted(list(vs)) for k, vs in mapping.items()}
            if mapping:
                dep_rules[other_attr] = mapping

        if dep_rules:
            dependencies.append({
                "attribute": target_attr,
                "depends_on": dep_rules  # multiple dependencies
            })

    # 3️⃣ Build variant info
    variants_data = []
    for v in variants:
        attr_values = {av.attribute.code: av.value for av in v.attribute_values.all()}
        variants_data.append({
            "variant_id": v.variant_id,
            "title": v.title,  
            "cex_sku": v.cex_sku,
            "current_price_gbp": float(v.current_price_gbp),
            "tradein_cash": float(v.tradein_cash),
            "tradein_voucher": float(v.tradein_voucher),
            "cex_out_of_stock": v.cex_out_of_stock,
            "attribute_values": attr_values
        })


    return Response({
        "product": {"id": product.product_id, "name": product.name},
        "variants": variants_data,
        "attributes": attributes,
        "dependencies": dependencies
    })


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


@api_view(['GET'])
def get_ebay_filters(request):
    search_term = request.GET.get("q", "").strip()
    ebay_search_url = request.GET.get("url", "").strip()
    category_path = request.GET.getlist("category_path")  # Get category path as list

    if not search_term and not ebay_search_url:
        return Response(
            {"success": False, "error": "Provide either q or url"},
            status=status.HTTP_400_BAD_REQUEST
        )

    ebay_url = "https://www.ebay.co.uk/sch/ajax/refine"

    if ebay_search_url:
        try:
            params = extract_ebay_search_params(ebay_search_url)
        except Exception:
            return Response(
                {"success": False, "error": "Invalid eBay URL"},
                status=status.HTTP_400_BAD_REQUEST
            )
    else:
        # Build eBay search URL with category if provided
        if category_path:
            ebay_search_url = build_ebay_search_url(search_term, category_path)
            try:
                params = extract_ebay_search_params(ebay_search_url)
            except Exception:
                # Fallback to basic params if URL parsing fails
                params = {
                    "_nkw": search_term,
                    "_sacat": 0,
                    "_fsrp": 1,
                    "rt": "nc",
                }
        else:
            params = {
                "_nkw": search_term,
                "_sacat": 0,
                "_fsrp": 1,
                "rt": "nc",
            }

    # force refinement payload options
    params.update({
        "modules": "SEARCH_REFINEMENTS_MODEL_V2:fa",
        "no_encode_refine_params": 1,
    })

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.ebay.co.uk/",
    }

    session = requests.Session()
    session.headers.update(headers)

    # warm cookies
    session.get("https://www.ebay.co.uk/", timeout=10)

    try:
        response = session.get(
            ebay_url,
            params=params,
            timeout=20,
        )
        logger.debug("eBay request sent to: %s", response.url)

        response.raise_for_status()
    except requests.RequestException as e:
        return Response(
            {"success": False, "error": str(e)},
            status=status.HTTP_502_BAD_GATEWAY
        )
    data = response.json()

    refinements_module = None
    if data.get("_type") == "SearchRefinementsModule":
        refinements_module = data
    else:
        for module in data.get("modules", []):
            if module.get("_type") == "SearchRefinementsModule":
                refinements_module = module
                break

    if not refinements_module:
        return Response(
            {"success": False, "error": "No refinements module found"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    filters = extract_filters(refinements_module)

    return JsonResponse({
        "success": True,
        "source": "url" if ebay_search_url else "query",
        "query": search_term or params.get("_nkw"),
        "filters": filters,
    })


@api_view(['GET'])
def get_cashconverters_filters(request):
    """
    Fetch filters from Cash Converters API
    
    Query params:
        q: Search term (required)
        url: Optional Cash Converters URL (for future use)
        category_path: Optional category path array (e.g., ?category_path=Electronics&category_path=Mobile%20Phones)
    """
    search_term = request.GET.get("q", "").strip()
    cashconverters_url = request.GET.get("url", "").strip()
    category_path = request.GET.getlist("category_path")  # Get category path as list

    if not search_term and not cashconverters_url:
        return Response(
            {"success": False, "error": "Provide either q or url"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Build Cash Converters API URL
    if cashconverters_url:
        # For now, extract query from URL if provided
        # TODO: Parse full URL parameters when needed
        api_url = cashconverters_url
    else:
        # Use category_path if provided (even though it may not be in URL yet)
        api_url = build_cashconverters_url(search_term, category_path if category_path else None)

    logger.debug("CashConverters filters API URL: %s", api_url)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.cashconverters.co.uk/",
    }

    session = requests.Session()
    session.headers.update(headers)

    try:
        response = session.get(
            api_url,
            timeout=20,
        )
        logger.debug("Cash Converters filters request sent to: %s", response.url)

        response.raise_for_status()
    except requests.RequestException as e:
        return Response(
            {"success": False, "error": str(e)},
            status=status.HTTP_502_BAD_GATEWAY
        )

    try:
        data = response.json()
    except ValueError as e:
        return Response(
            {"success": False, "error": f"Invalid JSON response: {str(e)}"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    # Check if request was successful
    if not data.get("WasSuccessful", False):
        return Response(
            {"success": False, "error": data.get("Message", "Cash Converters API returned unsuccessful response")},
            status=status.HTTP_502_BAD_GATEWAY
        )

    value = data.get("Value", {})
    
    # Extract facet groups
    upper_facets = value.get("UpperFacetGroupList", [])
    lower_facets = value.get("LowerFacetGroupList", [])
    
    # Convert to eBay-style filter format
    filters = convert_facet_groups_to_filters(upper_facets, lower_facets)

    return JsonResponse({
        "success": True,
        "source": "url" if cashconverters_url else "query",
        "query": search_term or "unknown",
        "filters": filters,
    })


@api_view(['GET'])
def get_cashconverters_results(request):
    """
    Fetch Cash Converters results for a specific page
    
    Query params:
        url: The search results URL (required)
        page: Page number (default: 1)
        fetch_only_first_page: Boolean flag (default: false) - for logging/info purposes
    """
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    import re
    
    search_url = request.GET.get("url", "").strip()
    page = request.GET.get("page", "1")
    fetch_only_first_page = request.GET.get("fetch_only_first_page", "false").lower() == "true"

    if not search_url:
        return Response(
            {"success": False, "error": "url parameter is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Transform search-results URL to API URL
    try:
        parsed = urlparse(search_url)
        params = parse_qs(parsed.query, keep_blank_values=True)
        
        # Convert f[FilterName][0]=value format to FilterName=value for API
        api_params = {}
        for key, values in params.items():
            # Check if key is in f[...][0] format
            match = re.match(r'f\[([^\]]+)\]\[(\d+)\]', key)
            if match:
                filter_name = match.group(1)
                # Skip category and locations filters (not needed for API)
                if filter_name not in ['category', 'locations']:
                    # Add to API params with simple key format
                    if filter_name not in api_params:
                        api_params[filter_name] = []
                    api_params[filter_name].extend(values)
            else:
                # Keep other params as-is
                api_params[key] = values
        
        # Flatten single-value lists
        for key in api_params:
            if isinstance(api_params[key], list) and len(api_params[key]) == 1:
                api_params[key] = api_params[key][0]
        
        # Ensure we have required params
        if 'Sort' not in api_params:
            api_params['Sort'] = 'default'
        
        # Set page
        api_params['page'] = page
        
        # Build API URL
        if "search-results" in search_url:
            api_path = parsed.path.replace("search-results", "c3api/search/results")
        else:
            api_path = parsed.path
        
        # Construct query string
        query_string = urlencode(api_params, doseq=True)
        
        # Build final API URL
        api_url = urlunparse((
            parsed.scheme or 'https',
            parsed.netloc or 'www.cashconverters.co.uk',
            api_path,
            '',
            query_string,
            ''
        ))

        logger.debug("CashConverters results API URL: %s (page=%s)", api_url, page)

    except Exception as e:
        return Response(
            {"success": False, "error": f"Invalid URL format: {str(e)}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.cashconverters.co.uk/",
    }

    session = requests.Session()
    session.headers.update(headers)

    try:
        response = session.get(
            api_url,
            timeout=20,
        )
        mode = "first page only" if fetch_only_first_page else "all pages"
        logger.debug("Cash Converters results request sent to: %s (mode: %s)", response.url, mode)

        response.raise_for_status()
    except requests.RequestException as e:
        return Response(
            {"success": False, "error": str(e)},
            status=status.HTTP_502_BAD_GATEWAY
        )

    try:
        data = response.json()
    except ValueError as e:
        return Response(
            {"success": False, "error": f"Invalid JSON response: {str(e)}"},
            status=status.HTTP_502_BAD_GATEWAY
        )

    # Check if request was successful
    if not data.get("WasSuccessful", False):
        return Response(
            {"success": False, "error": data.get("Message", "Cash Converters API returned unsuccessful response")},
            status=status.HTTP_502_BAD_GATEWAY
        )

    # Parse results
    value = data.get("Value", {})
    items = value.get("ProductList", {}).get("ProductListItems", [])

    results = []
    for raw in items:
        title = raw.get("Title", "")
        price = raw.get("Sp", 0)
        url = raw.get("Url", "")
        store = raw.get("StoreNameWithState", "")
        condition = raw.get("Condition") or raw.get("ProductCondition", "")
        stable_id = raw.get("Code")
        
        # Get image URL - prefer AbsoluteImageUrl, fallback to constructing from ImageUrl
        image = raw.get("AbsoluteImageUrl")
        if not image and raw.get("ImageUrl"):
            image = f"https://www.cashconverters.co.uk{raw.get('ImageUrl')}"

        results.append({
            "competitor": "CashConverters",
            "stable_id": stable_id,
            "title": title,
            "price": price,
            "description": "",
            "condition": condition,
            "store": store,
            "url": url if url.startswith("http") else f"https://www.cashconverters.co.uk{url}",
            "image": image
        })

    return JsonResponse({
        "success": True,
        "page": page,
        "results": results,
        "total_items": len(results)
    })


# ── Ideal Postcodes proxy (UK address lookup for Chrome extension) ─────────────────

@api_view(['GET'])
def address_lookup(request, postcode):
    """
    Proxy to Ideal Postcodes postcode lookup API.
    Given a UK postcode, returns the complete list of addresses at that postcode.
    Used by the Chrome extension customer verification form.
    """
    from django.conf import settings
    from urllib.parse import quote
    api_key = (getattr(settings, 'IDEAL_POSTCODES_API_KEY', '') or '').strip()
    if not api_key:
        return Response(
            {'error': 'Address lookup not configured. Set IDEAL_POSTCODES_API_KEY in .env.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    postcode_clean = (postcode or '').strip()
    if not postcode_clean or len(postcode_clean.replace(' ', '')) < 4:
        return Response({'addresses': []})
    try:
        url = f"https://api.ideal-postcodes.co.uk/v1/postcodes/{quote(postcode_clean)}?api_key={api_key}"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 401:
            logging.getLogger(__name__).warning('Ideal Postcodes 401: invalid API key')
            return Response(
                {'error': 'Invalid Ideal Postcodes API key. Check your key at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if resp.status_code == 402:
            logging.getLogger(__name__).warning('Ideal Postcodes 402: no lookups remaining')
            return Response(
                {'error': 'Address lookup limit reached. Top up at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_402_PAYMENT_REQUIRED
            )
        if resp.status_code == 404:
            return Response({'addresses': []})
        resp.raise_for_status()
        data = resp.json()
        result = data.get('result', [])
        if not isinstance(result, list):
            result = [result] if result else []
        return Response({'addresses': result})
    except requests.RequestException as e:
        logging.getLogger(__name__).warning('Ideal Postcodes postcode lookup failed: %s', e)
        return Response(
            {'error': str(e) if hasattr(e, 'message') else 'Address lookup failed'},
            status=status.HTTP_502_BAD_GATEWAY
        )


# ─── NoSpos Category Mappings ──────────────────────────────────────────────────

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

    # POST — create
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

    # PATCH — update path only
    nospos_path = str(request.data.get('nosposPath') or '').strip()
    if not nospos_path:
        return Response({'error': 'nosposPath is required'}, status=400)

    mapping.nospos_path = nospos_path
    mapping.save()
    return Response(_serialize_nospos_category_mapping(mapping))


# ─── NosPos scraped category tree (extension → DB) ───────────────────────────

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
        status = str(r.get("status") or "").strip()
        rows.append({
            "nospos_id": nid,
            "level": level,
            "full_name": full_name,
            "status": status,
            "buyback_rate": _parse_optional_decimal(r.get("buyback_rate") or r.get("buybackRate")),
            "offer_rate": _parse_optional_decimal(r.get("offer_rate") or r.get("offerRate")),
        })
    return rows


@api_view(["GET"])
def nospos_categories_list(request):
    """List NosPos categories mirrored in the DB, or `{ count }` only with `?count_only=1`."""
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
    """Accept body `{ fields: [{ nosposFieldId, name }] }` or a bare list."""
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
    """List NosPos fields from /stock/category/modify scrape, or `{ count }` with `?count_only=1`."""
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


_coerce_bool = coerce_bool


def _normalize_nospos_category_field_sync_payload(data):
    """
    Body `{ categoryNosposId, fields: [...], buybackRatePercent?, offerRatePercent? }`.
    Returns `(category_nospos_id | None, list of normalized field dicts, buyback_dec | None, offer_dec | None)`.
    """
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
            "active": _coerce_bool(r.get("active"), False),
            "editable": _coerce_bool(r.get("editable"), False),
            "sensitive": _coerce_bool(r.get("sensitive"), False),
            "required": _coerce_bool(r.get("required"), False),
        })
    return category_nospos_id, rows, buyback_dec, offer_dec


@csrf_exempt
@api_view(["POST"])
@require_nospos_sync_secret
def nospos_category_fields_sync(request):
    """Upsert NosposField rows and per-category NosposCategoryField links from a /stock/category/modify scrape."""

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
                    "Run “Update from NoSpos” on the categories page first."
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

