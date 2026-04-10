from rest_framework.decorators import api_view
from rest_framework.response import Response

from pricing.models_v2 import ProductCategory, Product, Variant
from pricing.serializers import (
    ProductCategorySerializer,
    ProductSerializer,
    VariantMarketStatsSerializer,
)


def _get_category_and_descendant_ids(category):
    """Return list of category_id for this category and all its descendants."""
    ids = [category.category_id]
    for child in category.children.all():
        ids.extend(_get_category_and_descendant_ids(child))
    return ids


@api_view(['GET'])
def categories_list(request):
    categories = ProductCategory.objects.filter(
        parent_category__isnull=True,
        ready_for_builder=True,
    )
    serializer = ProductCategorySerializer(categories, many=True)
    return Response(serializer.data)


@api_view(['GET'])
def all_categories_flat(request):
    """Return every category as a flat list with full ancestry path."""
    all_cats = list(
        ProductCategory.objects
        .select_related('parent_category')
        .order_by('parent_category_id', 'name')
    )

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


@api_view(['GET'])
def products_list(request):
    """Return all products for a given category including descendants."""
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


@api_view(['GET'])
def product_variants(request):
    """Returns all variants for a given product with dynamic attributes and dependencies."""
    product_id = request.query_params.get('product_id')
    if not product_id:
        return Response({"error": "product_id query param is required"}, status=400)

    try:
        product = Product.objects.get(pk=product_id)
    except Product.DoesNotExist:
        return Response({"error": "Product not found"}, status=404)

    variants = Variant.objects.filter(product=product).prefetch_related(
        'attribute_values__attribute'
    )

    if not variants.exists():
        return Response({"variants": [], "attributes": []})

    attr_map = {}
    for v in variants:
        for av in v.attribute_values.all():
            code = av.attribute.code
            if code not in attr_map:
                attr_map[code] = {"label": av.attribute.label, "values": set()}
            attr_map[code]["values"].add(av.value)

    attributes = []
    for code, data in attr_map.items():
        attributes.append({
            "code": code,
            "label": data["label"],
            "values": sorted(list(data["values"]))
        })

    dependencies = []
    attr_codes = list(attr_map.keys())

    for target_attr in attr_codes:
        dep_rules = {}
        for other_attr in attr_codes:
            if other_attr == target_attr:
                continue
            mapping = {}
            for v in variants:
                target_value = next((av.value for av in v.attribute_values.all() if av.attribute.code == target_attr), None)
                other_value = next((av.value for av in v.attribute_values.all() if av.attribute.code == other_attr), None)
                if target_value is None or other_value is None:
                    continue
                if other_value not in mapping:
                    mapping[other_value] = set()
                mapping[other_value].add(target_value)
            mapping = {k: sorted(list(vs)) for k, vs in mapping.items()}
            if mapping:
                dep_rules[other_attr] = mapping
        if dep_rules:
            dependencies.append({"attribute": target_attr, "depends_on": dep_rules})

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
def variant_market_stats(request):
    """Returns competitor / CeX market stats for a given variant SKU."""
    sku = request.GET.get('sku')
    if not sku:
        return Response({"detail": "Missing required query param: sku"}, status=400)
    try:
        variant = Variant.objects.get(cex_sku=sku)
    except Variant.DoesNotExist:
        return Response({"detail": "Variant not found"}, status=404)
    serializer = VariantMarketStatsSerializer(variant)
    return Response(serializer.data)
