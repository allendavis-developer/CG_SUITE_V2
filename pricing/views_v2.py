
from django.shortcuts import render
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models_v2 import Product, ProductCategory
from .serializers import ProductCategorySerializer
from .serializers import ProductSerializer

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


# react app
def react_app(request):
    return render(request, "react.html")
