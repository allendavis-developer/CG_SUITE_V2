# serializers.py
from rest_framework import serializers
from .models_v2 import ProductCategory, Product, Variant, Attribute, AttributeValue

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


class VariantMarketStatsSerializer(serializers.ModelSerializer):
    platform = serializers.SerializerMethodField()

    sale_price_gbp = serializers.DecimalField(
        source='current_price_gbp',
        max_digits=10,
        decimal_places=2
    )

    tradein_cash_gbp = serializers.DecimalField(
        source='tradein_cash',
        max_digits=10,
        decimal_places=2
    )

    tradein_voucher_gbp = serializers.DecimalField(
        source='tradein_voucher',
        max_digits=10,
        decimal_places=2
    )

    last_updated = serializers.DateTimeField(
        source='cex_price_last_updated_date'
    )

    class Meta:
        model = Variant
        fields = [
            'cex_sku',
            'title',
            'platform',
            'sale_price_gbp',
            'tradein_cash_gbp',
            'tradein_voucher_gbp',
            'cex_out_of_stock',
            'last_updated',
        ]

    def get_platform(self, obj):
        return "CEX"
