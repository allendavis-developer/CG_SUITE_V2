
from django.shortcuts import render
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models_v2 import ProductCategory, Product, Variant, Attribute, VariantAttributeValue, ConditionGrade
from .serializers import ProductCategorySerializer, ProductSerializer, AttributeSerializer, VariantMarketStatsSerializer

@api_view(['GET'])
def categories_list(request):
    # Fetch top-level categories only (parent_category is None)
    categories = ProductCategory.objects.filter(parent_category__isnull=True)
    serializer = ProductCategorySerializer(categories, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def products_list(request):
    """
    Return all products (model names) for a given category.
    Query param: ?category_id=14
    """
    category_id = request.query_params.get('category_id')
    if not category_id:
        return Response({"error": "category_id query param is required"}, status=400)

    try:
        category = ProductCategory.objects.get(pk=category_id)
    except ProductCategory.DoesNotExist:
        return Response({"error": "Category not found"}, status=404)

    products = Product.objects.filter(category=category)
    serializer = ProductSerializer(products, many=True)
    return Response(serializer.data)

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


@api_view(['GET'])
def variant_prices(request):
    """
    Logic:
    - Sale price is derived from CeX price using pricing rules
      (fallback to 85% if no rule applies)
    - First Offer: Same absolute margin as CeX at our sale price
    - Second Offer: Midpoint between First and Third
    - Third Offer: Match CeX trade-in cash
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

    # CeX reference prices (DO NOT MODIFY)
    cex_sale_price = float(variant.current_price_gbp)
    cex_tradein_cash = float(variant.tradein_cash)

    # CeX absolute margin
    cex_margin = cex_sale_price - cex_tradein_cash

    # 🔹 Determine sale price using pricing rules
    target_sale_price = variant.get_target_sell_price()

    if target_sale_price is not None:
        cex_based_sale_price = float(target_sale_price)
        percentage_used = round(
            cex_based_sale_price / cex_sale_price * 100, 2
        )
    else:
        # Backwards-compatible fallback
        percentage_used = 85.0
        cex_based_sale_price = cex_sale_price * 0.85

    # Third offer: match CeX trade-in cash
    third_offer = cex_tradein_cash

    # First offer: same absolute margin as CeX
    first_offer = cex_based_sale_price - cex_margin
    first_offer = max(first_offer, 0)

    # Second offer: midpoint
    second_offer = (first_offer + third_offer) / 2

    # Margin % helper
    def calculate_margin_percentage(offer_price, sale_price):
        if sale_price == 0:
            return 0
        margin_amount = sale_price - offer_price
        return round((margin_amount / sale_price) * 100, 1)

    first_margin = calculate_margin_percentage(first_offer, cex_based_sale_price)
    second_margin = calculate_margin_percentage(second_offer, cex_based_sale_price)
    third_margin = calculate_margin_percentage(third_offer, cex_based_sale_price)

    offers = [
        {
            "id": 1,
            "title": "First Offer",
            "price": round(first_offer, 2),
            "margin": first_margin
        },
        {
            "id": 2,
            "title": "Second Offer",
            "price": round(second_offer, 2),
            "margin": second_margin
        },
        {
            "id": 3,
            "title": "Third Offer",
            "price": round(third_offer, 2),
            "margin": third_margin,
            "isHighlighted": True
        }
    ]

    return Response({
        "sku": sku,
        "offers": offers,
        "reference_data": {
            "cex_sale_price": cex_sale_price,
            "cex_tradein_cash": cex_tradein_cash,
            "cex_margin": cex_margin,
            "cex_based_sale_price": round(cex_based_sale_price, 2),
            "percentage_used": percentage_used
        }
    })

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
