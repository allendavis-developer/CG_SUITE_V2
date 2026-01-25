# serializers.py
from rest_framework import serializers
from .models_v2 import ProductCategory, Product, Attribute, AttributeValue

class ProductCategorySerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()  # Nested children

    class Meta:
        model = ProductCategory
        fields = ['category_id', 'name', 'children']

    def get_children(self, obj):
        # Recursively include child categories
        children = obj.children.all()
        serializer = ProductCategorySerializer(children, many=True)
        return serializer.data

class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ['product_id', 'name']

class AttributeValueSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeValue
        fields = ['value']  # Only need the value for frontend

class AttributeSerializer(serializers.ModelSerializer):
    values = AttributeValueSerializer(many=True, read_only=True)

    class Meta:
        model = Attribute
        fields = ['label', 'values', 'code']  # label = user-facing, code = internal
