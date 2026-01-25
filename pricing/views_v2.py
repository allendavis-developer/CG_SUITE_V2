
from django.shortcuts import render
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models_v2 import ProductCategory
from .serializers import ProductCategorySerializer

@api_view(['GET'])
def categories_list(request):
    # Fetch top-level categories only (parent_category is None)
    categories = ProductCategory.objects.filter(parent_category__isnull=True)
    serializer = ProductCategorySerializer(categories, many=True)
    return Response(serializer.data)


# react app
def react_app(request):
    return render(request, "react.html")
