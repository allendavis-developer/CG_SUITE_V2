from django.shortcuts import render, get_object_or_404
from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models_v2 import ( ProductCategory, Product, Variant, Customer,
Request, RequestItem, RequestStatus, RequestStatusHistory,
Customer, Variant, RequestIntent
)

from .serializers import ( RequestSerializer, RequestItemSerializer, CustomerSerializer,
ProductCategorySerializer, ProductSerializer, CustomerSerializer, VariantMarketStatsSerializer
)

@api_view(['GET'])
def categories_list(request):
    # Fetch top-level categories only (parent_category is None)
    categories = ProductCategory.objects.filter(parent_category__isnull=True)
    serializer = ProductCategorySerializer(categories, many=True)
    return Response(serializer.data)


@api_view(['GET', 'POST'])
def customers_view(request):
    if request.method == 'GET':
        customers = Customer.objects.all()
        data = [
            {
                "id": c.customer_id,
                "name": c.name,
                "phone": c.phone_number,
                "email": c.email,
                "address": c.address
            }
            for c in customers
        ]
        return Response(data)

    elif request.method == 'POST':
        serializer = CustomerSerializer(data=request.data)
        if serializer.is_valid():
            customer = serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        print("❌ CustomerSerializer errors:", serializer.errors)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



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


@api_view(['GET', 'POST'])
def requests_view(request):
    """
    GET: List all requests
    POST: Create a new request with initial item (status: OPEN)
    """
    if request.method == 'GET':
        requests = Request.objects.all().prefetch_related(
            'items', 
            'status_history'
        ).select_related('customer')
        
        serializer = RequestSerializer(requests, many=True)
        return Response(serializer.data)

    elif request.method == 'POST':
        customer_id = request.data.get('customer_id')
        intent = request.data.get('intent', RequestIntent.UNKNOWN)
        item_data = request.data.get('item')
        
        if not customer_id:
            return Response(
                {"error": "customer_id is required"},
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
        
        with transaction.atomic():
            # Create the request
            new_request = Request.objects.create(
                customer=customer,
                intent=intent
            )
            
            # Create initial status history entry
            RequestStatusHistory.objects.create(
                request=new_request,
                status=RequestStatus.OPEN
            )
            
            # Create the first item
            item_payload = item_data.copy()  # ✅ Create a copy
            item_payload['request'] = new_request.request_id
            item_serializer = RequestItemSerializer(data=item_payload)

            if item_serializer.is_valid():
                item_serializer.save()
            else:
                return Response(
                    item_serializer.errors,
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Return the full request with nested data
            response_serializer = RequestSerializer(new_request)
            return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def add_request_item(request, request_id):
    """
    POST: Add another item to an existing OPEN request
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    
    # Check current status
    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.OPEN:
        return Response(
            {"error": "Can only add items to OPEN requests"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Add request to the data
    item_data = request.data.copy()
    item_data['request'] = request_id
    
    serializer = RequestItemSerializer(data=item_data)
    
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
def request_detail(request, request_id):
    """
    GET: Retrieve full details of a request including all items and status history
    """
    existing_request = get_object_or_404(
        Request.objects.prefetch_related(
            'items__variant',
            'status_history'
        ).select_related('customer'),
        request_id=request_id
    )
    
    serializer = RequestSerializer(existing_request)
    return Response(serializer.data)


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


@api_view(['POST'])
def update_request_item_raw_data(request, request_item_id):
    """
    POST: Update raw_data field for a specific request item
    """
    existing_item = get_object_or_404(RequestItem, request_item_id=request_item_id)

    new_raw_data = request.data.get('raw_data')
    if new_raw_data is None:
        return Response(
            {"error": "Missing 'raw_data' field in request data"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Optional: ensure it's a valid JSON object
    if not isinstance(new_raw_data, dict):
        return Response(
            {"error": "'raw_data' must be a JSON object/dict"},
            status=status.HTTP_400_BAD_REQUEST
        )

    existing_item.raw_data = new_raw_data
    existing_item.save(update_fields=['raw_data'])

    return Response(
        {
            "request_item_id": existing_item.request_item_id,
            "raw_data": existing_item.raw_data
        },
        status=status.HTTP_200_OK
    )


@api_view(['POST'])
def finish_request(request, request_id):
    """
    POST: Finish a request and move it to BOOKED_FOR_TESTING status
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    
    # Check current status
    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.OPEN:
        return Response(
            {"error": "Can only finish OPEN requests"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Ensure request has at least one item
    if not existing_request.items.exists():
        return Response(
            {"error": "Cannot finish request with no items"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Create new status history entry
    RequestStatusHistory.objects.create(
        request=existing_request,
        status=RequestStatus.BOOKED_FOR_TESTING
    )
    
    return Response(
        {
            "request_id": existing_request.request_id,
            "status": RequestStatus.BOOKED_FOR_TESTING,
            "items_count": existing_request.items.count()
        },
        status=status.HTTP_200_OK
    )


@api_view(['POST'])
def cancel_request(request, request_id):
    """
    POST: Cancel a request (can be done from any status except CANCELLED)
    """
    existing_request = get_object_or_404(Request, request_id=request_id)
    
    current_status = existing_request.status_history.first()
    if current_status and current_status.status == RequestStatus.CANCELLED:
        return Response(
            {"error": "Request is already cancelled"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    RequestStatusHistory.objects.create(
        request=existing_request,
        status=RequestStatus.CANCELLED
    )
    
    return Response(
        {
            "request_id": existing_request.request_id,
            "status": RequestStatus.CANCELLED
        },
        status=status.HTTP_200_OK
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

    # CeX reference prices 
    cex_sale_price = float(variant.current_price_gbp)
    cex_tradein_cash = float(variant.tradein_cash)
    cex_tradein_voucher = float(variant.tradein_voucher)

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
            "cex_tradein_voucher": cex_tradein_voucher,
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
