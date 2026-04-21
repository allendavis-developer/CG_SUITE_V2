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
