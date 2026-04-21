"""HTTP views for the Request lifecycle.

Business logic lives in ``pricing.services.request_service``. Views here only:

1. Parse inputs from ``request.data``.
2. Call the service.
3. Translate :class:`request_service.RequestServiceError` into a ``Response``.
4. Serialize the result.

Helpers shared across domain modules live in :mod:`pricing.views._shared`.
"""
import logging

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import OuterRef, Subquery, Prefetch

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from pricing.models_v2 import (
    Customer,
    Request,
    RequestItem,
    RequestStatus,
    RequestStatusHistory,
    RequestIntent,
    MarketResearchSession,
)
from pricing.serializers import RequestSerializer, RequestItemSerializer
from pricing.services import request_service
from pricing.views._shared import _resolve_cex_sku_to_variant

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prefetch helpers (shared by list / detail endpoints)
# ---------------------------------------------------------------------------

_RESEARCH_SESSION_PREFETCH = Prefetch(
    "items__market_research_sessions",
    queryset=MarketResearchSession.objects.prefetch_related("listings", "drill_levels"),
)


def _error_response(error: request_service.RequestServiceError) -> Response:
    """Translate a service error into a DRF response."""
    return Response({"error": error.message}, status=error.status_code)


# ---------------------------------------------------------------------------
# Collection endpoints
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
def requests_view(request):
    """GET: list all requests. POST: create a new QUOTE request with one initial item."""
    if request.method == 'GET':
        qs = (
            Request.objects.all()
            .prefetch_related("items__variant", _RESEARCH_SESSION_PREFETCH, "status_history")
            .select_related("customer")
        )
        return Response(RequestSerializer(qs, many=True).data)

    # POST: create
    customer_id = request.data.get('customer_id')
    intent = request.data.get('intent')
    item_data = request.data.get('item')

    if not customer_id:
        return Response({"error": "customer_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    if not intent:
        return Response(
            {"error": "intent is required. Must be one of: BUYBACK, DIRECT_SALE, STORE_CREDIT"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    valid_intents = [c[0] for c in RequestIntent.choices]
    if intent not in valid_intents:
        return Response(
            {"error": f"Invalid intent. Must be one of: {', '.join(valid_intents)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not item_data:
        return Response({"error": "At least one item is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        customer = Customer.objects.get(customer_id=customer_id)
    except Customer.DoesNotExist:
        return Response({"error": "Customer not found"}, status=status.HTTP_404_NOT_FOUND)

    customer_enrichment = request.data.get('customer_enrichment')
    if customer_enrichment is not None and not isinstance(customer_enrichment, dict):
        customer_enrichment = None

    with transaction.atomic():
        new_request = Request.objects.create(
            customer=customer,
            intent=intent,
            customer_enrichment_json=customer_enrichment,
        )
        RequestStatusHistory.objects.create(request=new_request, status=RequestStatus.QUOTE)

        item_payload = dict(item_data)
        item_payload['request'] = new_request.request_id
        _resolve_cex_sku_to_variant(item_payload)
        item_serializer = RequestItemSerializer(data=item_payload)
        if not item_serializer.is_valid():
            return Response(item_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        item_serializer.save()

        # Reload with prefetch so the response has nested data.
        fresh = (
            Request.objects.prefetch_related(
                "items__variant", _RESEARCH_SESSION_PREFETCH, "status_history",
            )
            .select_related("customer")
            .get(pk=new_request.pk)
        )
        return Response(RequestSerializer(fresh).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def requests_overview_list(request):
    """List requests, optionally filtered by latest status (QUOTE / BOOKED_FOR_TESTING / COMPLETE)."""
    latest_status = Subquery(
        RequestStatusHistory.objects.filter(request=OuterRef('pk'))
        .order_by('-effective_at')
        .values('status')[:1]
    )
    qs = (
        Request.objects.annotate(latest_status=latest_status)
        .prefetch_related("items__variant", _RESEARCH_SESSION_PREFETCH, "status_history")
        .select_related("customer")
        .order_by("-created_at")
    )
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(latest_status=status_filter)
    return Response(RequestSerializer(qs, many=True).data)


# ---------------------------------------------------------------------------
# Request-level endpoints
# ---------------------------------------------------------------------------

@api_view(['GET'])
def request_detail(request, request_id):
    """Full details of one request including items, status history, jewellery reference snapshot."""
    existing = get_object_or_404(
        Request.objects.prefetch_related(
            "items__variant", _RESEARCH_SESSION_PREFETCH,
            "status_history", "jewellery_reference_history",
        ).select_related("customer", "current_jewellery_reference_snapshot"),
        request_id=request_id,
    )
    return Response(RequestSerializer(existing).data)


@api_view(['POST'])
def add_request_item(request, request_id):
    """Add one more item to an existing QUOTE request."""
    existing = get_object_or_404(Request, request_id=request_id)
    current = existing.status_history.first()
    if not current or current.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only add items to QUOTE requests"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    item_data = request.data.copy()
    customer_enrichment = item_data.pop('customer_enrichment', None)
    item_data['request'] = request_id
    _resolve_cex_sku_to_variant(item_data)

    # Enrichment gets set once; don't overwrite later.
    if (
        customer_enrichment is not None
        and isinstance(customer_enrichment, dict)
        and existing.customer_enrichment_json is None
    ):
        existing.customer_enrichment_json = customer_enrichment
        existing.save(update_fields=['customer_enrichment_json'])

    serializer = RequestItemSerializer(data=item_data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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


@api_view(['PATCH'])
def update_park_agreement_state(request, request_id):
    """Merge park-agreement state (nosposAgreementId, excludedItemIds) into the stored JSON."""
    existing = get_object_or_404(Request, request_id=request_id)
    current = {
        k: v for k, v in (existing.park_agreement_state_json or {}).items()
        if k != 'nosposAgreementUrl'
    }

    agreement_id = request.data.get('nosposAgreementId', current.get('nosposAgreementId'))
    excluded = request.data.get('excludedItemIds', current.get('excludedItemIds'))

    if agreement_id is not None:
        agreement_id = str(agreement_id).strip() or None
    if excluded is not None:
        excluded = [str(x) for x in excluded] if isinstance(excluded, (list, tuple)) else []

    updated = {**current}
    if 'nosposAgreementId' in request.data or agreement_id != current.get('nosposAgreementId'):
        updated['nosposAgreementId'] = agreement_id
    if 'excludedItemIds' in request.data:
        updated['excludedItemIds'] = excluded

    existing.park_agreement_state_json = updated
    existing.save(update_fields=['park_agreement_state_json'])
    return Response({'ok': True, 'park_agreement_state_json': updated})


@api_view(['POST'])
def update_request_intent(request, request_id):
    """Replace the request's intent (BUYBACK / DIRECT_SALE / STORE_CREDIT)."""
    existing = get_object_or_404(Request, request_id=request_id)
    new_intent = request.data.get('intent')
    if not new_intent:
        return Response(
            {"error": "Missing 'intent' field in request data"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    valid = [c[0] for c in RequestIntent.choices]
    if new_intent not in valid:
        return Response(
            {"error": f"Invalid intent. Valid choices: {valid}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    existing.intent = new_intent
    existing.save(update_fields=['intent'])
    return Response({"request_id": existing.request_id, "intent": existing.intent})


# ---------------------------------------------------------------------------
# Item-level endpoints
# ---------------------------------------------------------------------------

@api_view(['PATCH'])
def update_request_item(request, request_item_id):
    """Update one request item — QUOTE path does full fields, BOOKED_FOR_TESTING toggles only ``testing_passed``."""
    try:
        item = request_service.update_item(
            request_item_id=request_item_id,
            data=request.data,
        )
    except request_service.RequestServiceError as e:
        return _error_response(e)
    return Response(RequestItemSerializer(item).data)


@api_view(['POST'])
def update_request_item_raw_data(request, request_item_id):
    """Merge partial research data (raw_data / cash_converters_data / cg_data) into a request item."""
    from pricing import research_storage  # local import to keep top-level imports tight

    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)

    keys = ('raw_data', 'cash_converters_data', 'cg_data')
    provided = [k for k in keys if k in request.data]
    if not provided:
        return Response(
            {"error": f"Provide at least one of: {', '.join(repr(k) for k in keys)} in request data"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    for key in provided:
        value = request.data.get(key)
        if value is not None and not isinstance(value, dict):
            return Response(
                {"error": f"'{key}' must be a JSON object/dict or null"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if 'raw_data' in request.data:
        research_storage.apply_partial_raw_data_update(existing_item, request.data.get('raw_data'))
    if 'cash_converters_data' in request.data:
        research_storage.apply_partial_cc_data_update(existing_item, request.data.get('cash_converters_data'))
    if 'cg_data' in request.data:
        research_storage.apply_partial_cg_data_update(existing_item, request.data.get('cg_data'))

    return Response({
        "request_item_id": existing_item.request_item_id,
        "raw_data": research_storage.compose_raw_data_for_request_item(existing_item),
        "cash_converters_data": research_storage.compose_cash_converters_for_request_item(existing_item),
        "cg_data": research_storage.compose_cash_generator_for_request_item(existing_item),
    })


@api_view(['DELETE'])
def delete_request_item(request, request_item_id):
    """Remove an item from a QUOTE request."""
    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)
    current = existing_item.request.status_history.first()
    if not current or current.status != RequestStatus.QUOTE:
        return Response(
            {"error": "Can only remove items from QUOTE requests"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    existing_item.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Lifecycle transitions
# ---------------------------------------------------------------------------

@api_view(['POST'])
def finish_request(request, request_id):
    """Finalize a QUOTE request. Business logic in :func:`request_service.finalize`."""
    save_only = bool(
        request.data.get('save_only') or request.data.get('request_not_completed')
    )
    try:
        result = request_service.finalize(
            request_id=request_id,
            data=request.data,
            save_only=save_only,
        )
    except request_service.RequestServiceError as e:
        return _error_response(e)
    return Response(result)


@api_view(['POST'])
def cancel_request(request, request_id):
    """Legacy endpoint: CANCELLED status no longer exists."""
    return Response(
        {"error": "Cancellation is no longer supported. Requests can only be QUOTE, BOOKED_FOR_TESTING, or COMPLETE."},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(['POST'])
def complete_request_after_testing(request, request_id):
    """Move BOOKED_FOR_TESTING -> COMPLETE. Logic in :func:`request_service.complete_after_testing`."""
    try:
        result = request_service.complete_after_testing(request_id=request_id)
    except request_service.RequestServiceError as e:
        return _error_response(e)
    return Response(result)
