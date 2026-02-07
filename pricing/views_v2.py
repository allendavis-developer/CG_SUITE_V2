from django.shortcuts import render, get_object_or_404
from django.db import transaction
from django.http import JsonResponse

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from decimal import Decimal, InvalidOperation
from django.db.models import OuterRef, Subquery, Max
import requests
from pricing.utils.ebay_filters import extract_filters, extract_ebay_search_params

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


@api_view(['GET'])
def requests_overview_list(request):
    """
    GET: List all requests, optionally filtered by status.
    Query params: ?status=OPEN or ?status=BOOKED_FOR_TESTING
    """
    requests = Request.objects.all().prefetch_related(
        'items',
        'items__variant', # Pre-fetch variant details for items
        'status_history'
    ).select_related('customer').order_by('-created_at') # Order by creation date, newest first

    status_filter = request.query_params.get('status')
    if status_filter:
        # Filter by the latest status in the history
        requests = requests.filter(status_history__status=status_filter, status_history__effective_at=(
            RequestStatusHistory.objects.filter(request=OuterRef('pk')).order_by('-effective_at').values('effective_at')[:1]
        ))
        
    serializer = RequestSerializer(requests, many=True)
    return Response(serializer.data)


@api_view(['GET'])
def requests_overview_list(request):
    """
    GET: List all requests, optionally filtered by status.
    Query params: ?status=OPEN or ?status=BOOKED_FOR_TESTING
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
        'items',
        'items__variant',
        'status_history'
    ).select_related('customer').order_by('-created_at')

    status_filter = request.query_params.get('status')
    if status_filter:
        requests = requests.filter(latest_status=status_filter)
        
    serializer = RequestSerializer(requests, many=True)
    return Response(serializer.data)


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
    POST: Finalize a request with negotiation data and move it to BOOKED_FOR_TESTING status.
    Expects:
    - items_data: list of dicts, each containing request_item_id and negotiated fields.
    - overall_expectation_gbp: Decimal, customer's total expectation.
    - negotiated_grand_total_gbp: Decimal, the final grand total offer.
    """
    existing_request = get_object_or_404(Request, request_id=request_id)

    # Check current status
    current_status = existing_request.status_history.first()
    if not current_status or current_status.status != RequestStatus.OPEN:
        return Response(
            {"error": "Can only finalize OPEN requests"},
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

    # Validate incoming data for main request
    if overall_expectation_gbp is not None:
        try:
            existing_request.overall_expectation_gbp = Decimal(str(overall_expectation_gbp))
        except InvalidOperation:
            return Response(
                {"error": "Invalid format for overall_expectation_gbp"},
                status=status.HTTP_400_BAD_REQUEST
            )

    if negotiated_grand_total_gbp is not None:
        try:
            existing_request.negotiated_grand_total_gbp = Decimal(str(negotiated_grand_total_gbp))
        except InvalidOperation:
            return Response(
                {"error": "Invalid format for negotiated_grand_total_gbp"},
                status=status.HTTP_400_BAD_REQUEST
            )

    existing_request.save(update_fields=['overall_expectation_gbp', 'negotiated_grand_total_gbp'])

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

        # Save historical variant prices
        if request_item.variant:
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
            request_item.selected_offer_id = item_data['selected_offer_id']
            update_fields.append('selected_offer_id')
        if 'manual_offer_gbp' in item_data:
            try:
                request_item.manual_offer_gbp = Decimal(str(item_data['manual_offer_gbp'])) if item_data['manual_offer_gbp'] is not None else None
                update_fields.append('manual_offer_gbp')
            except InvalidOperation:
                return Response(
                    {"error": f"Invalid format for manual_offer_gbp for item {request_item_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if 'customer_expectation_gbp' in item_data:
            try:
                request_item.customer_expectation_gbp = Decimal(str(item_data['customer_expectation_gbp'])) if item_data['customer_expectation_gbp'] is not None else None
                update_fields.append('customer_expectation_gbp')
            except InvalidOperation:
                return Response(
                    {"error": f"Invalid format for customer_expectation_gbp for item {request_item_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if 'negotiated_price_gbp' in item_data:
            try:
                request_item.negotiated_price_gbp = Decimal(str(item_data['negotiated_price_gbp'])) if item_data['negotiated_price_gbp'] is not None else None
                update_fields.append('negotiated_price_gbp')
            except InvalidOperation:
                return Response(
                    {"error": f"Invalid format for negotiated_price_gbp for item {request_item_id}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        if 'raw_data' in item_data:
            request_item.raw_data = item_data['raw_data']
            update_fields.append('raw_data')
        
        if 'cash_offers_json' in item_data:
            request_item.cash_offers_json = item_data['cash_offers_json']
            update_fields.append('cash_offers_json')
        
        if 'voucher_offers_json' in item_data:
            request_item.voucher_offers_json = item_data['voucher_offers_json']
            update_fields.append('voucher_offers_json')
        
        if update_fields:
            request_item.save(update_fields=update_fields)

    # Create new status history entry
    RequestStatusHistory.objects.create(
        request=existing_request,
        status=RequestStatus.BOOKED_FOR_TESTING
    )

    return Response(
        {
            "request_id": existing_request.request_id,
            "status": RequestStatus.BOOKED_FOR_TESTING,
            "items_count": existing_request.items.count(),
            "overall_expectation_gbp": existing_request.overall_expectation_gbp,
            "negotiated_grand_total_gbp": existing_request.negotiated_grand_total_gbp
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

    # --- Reference Data ---
    cex_sale_price = float(variant.current_price_gbp)
    cex_tradein_cash = float(variant.tradein_cash)
    cex_tradein_voucher = float(variant.tradein_voucher)

    # Our Target Sale Price
    target_sell_price = variant.get_target_sell_price()
    if target_sell_price is not None:
        our_sale_price = float(target_sell_price)
        percentage_used = round(our_sale_price / cex_sale_price * 100, 2)
    else:
        percentage_used = 85.0
        our_sale_price = cex_sale_price * 0.85

    # --- Calculation Helpers ---
    def calculate_margin_percentage(offer_price, sale_price):
        if sale_price <= 0: return 0
        margin_amount = sale_price - offer_price
        return round((margin_amount / sale_price) * 100, 1)

    def generate_offer_set(cex_reference_buy_price, prefix):
        """
        Generates First, Second, and Third offers based on a CeX reference price.
        Logic: 
        - Third: Match CeX
        - First: Match CeX absolute margin
        - Second: Midpoint
        """
        # Absolute margin CeX makes on this item
        cex_abs_margin = cex_sale_price - cex_reference_buy_price
        
        # 1. First Offer: Same absolute margin at our (usually lower) sale price
        offer_1 = max(our_sale_price - cex_abs_margin, 0)
        
        # 3. Third Offer: Match CeX trade-in price exactly
        offer_3 = cex_reference_buy_price
        
        # 2. Second Offer: Midpoint
        offer_2 = (offer_1 + offer_3) / 2

        return [
            {
                "id": f"{prefix}_1",
                "title": "First Offer",
                "price": round(offer_1, 2),
                "margin": calculate_margin_percentage(offer_1, our_sale_price)
            },
            {
                "id": f"{prefix}_2",
                "title": "Second Offer",
                "price": round(offer_2, 2),
                "margin": calculate_margin_percentage(offer_2, our_sale_price)
            },
            {
                "id": f"{prefix}_3",
                "title": "Third Offer",
                "price": round(offer_3, 2),
                "margin": calculate_margin_percentage(offer_3, our_sale_price),
                "isHighlighted": True
            }
        ]

    # Generate both sets
    cash_offers = generate_offer_set(cex_tradein_cash, "cash")
    voucher_offers = generate_offer_set(cex_tradein_voucher, "voucher")

    return Response({
        "sku": sku,
        "cash_offers": cash_offers,
        "voucher_offers": voucher_offers,
        "reference_data": {
            "cex_sale_price": cex_sale_price,
            "cex_tradein_cash": cex_tradein_cash,
            "cex_tradein_voucher": cex_tradein_voucher,
            "cex_based_sale_price": round(our_sale_price, 2),
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


@api_view(['GET'])
def get_ebay_filters(request):
    search_term = request.GET.get("q", "").strip()
    ebay_search_url = request.GET.get("url", "").strip()

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
        # Log the actual URL that was requested
        print(f"Request sent to: {response.url}")

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



