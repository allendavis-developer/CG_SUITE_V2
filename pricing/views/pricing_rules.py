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
