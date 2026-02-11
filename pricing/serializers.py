# serializers.py
from rest_framework import serializers
from .models_v2 import ( ProductCategory, Product, Variant, Attribute, AttributeValue, Customer, Request, RequestItem, RequestStatus, 
    RequestStatusHistory, Variant, RequestIntent )


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
    name = serializers.SerializerMethodField()  # override 'name'

    class Meta:
        model = Product
        fields = ['product_id', 'name']  # 'name' now includes manufacturer

    def get_name(self, obj):
        if obj.manufacturer:
            return f"{obj.manufacturer.name} {obj.name}"
        return obj.name



class VariantSerializer(serializers.ModelSerializer):
    """Variant serializer for nested use in RequestItemSerializer"""
    class Meta:
        model = Variant
        fields = ['variant_id', 'cex_sku', 'title', 'current_price_gbp']
        read_only_fields = ['variant_id']



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

class CustomerSerializer(serializers.ModelSerializer):
    cancel_rate = serializers.FloatField(read_only=True)  # Add this line

    class Meta:
        model = Customer
        fields = ['customer_id', 'name', 'phone_number', 'email', 'address', 'cancel_rate']
        extra_kwargs = {
            'name': {'required': True},
        }

    def to_representation(self, instance):
        return {
            "id": instance.customer_id,
            "name": instance.name,
            "phone": instance.phone_number,
            "email": instance.email,
            "address": instance.address,
            "cancel_rate": instance.cancel_rate  # Include cancel rate here
        }


class RequestItemSerializer(serializers.ModelSerializer):
    variant_details = VariantSerializer(source='variant', read_only=True)
    
    class Meta:
        model = RequestItem
        fields = [
            'request_item_id',
            'request',
            'variant',
            'variant_details',
            'raw_data',
            'cash_converters_data',  # Cash Converters research data
            'notes',
            'quantity',
            'selected_offer_id',
            'manual_offer_gbp',
            'customer_expectation_gbp',
            'negotiated_price_gbp',
            'cash_offers_json',  # Add new field
            'voucher_offers_json', # Add new field
            'cex_buy_cash_at_negotiation',
            'cex_buy_voucher_at_negotiation',
            'cex_sell_at_negotiation',
            'our_sale_price_at_negotiation',
        ]
        read_only_fields = [
            'request_item_id',
            'cex_buy_cash_at_negotiation',
            'cex_buy_voucher_at_negotiation',
            'cex_sell_at_negotiation',
            'our_sale_price_at_negotiation',
        ]
    
    def validate_customer_expectation_gbp(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Customer expectation cannot be negative")
        return value


class RequestStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = RequestStatusHistory
        fields = ['status', 'effective_at']
        read_only_fields = ['effective_at']


class RequestSerializer(serializers.ModelSerializer):
    customer_details = CustomerSerializer(source='customer', read_only=True)
    items = RequestItemSerializer(many=True, read_only=True)
    current_status = serializers.SerializerMethodField()
    status_history = RequestStatusHistorySerializer(many=True, read_only=True)
    
    class Meta:
        model = Request
        fields = [
            'request_id',
            'customer',
            'customer_details',
            'intent',
            'created_at',
            'overall_expectation_gbp',
            'negotiated_grand_total_gbp',
            'items',
            'current_status',
            'status_history'
        ]
        read_only_fields = ['request_id', 'created_at']
    
    def get_current_status(self, obj):
        latest_status = obj.status_history.first()
        # Always return a status - default to QUOTE if no status history exists
        return latest_status.status if latest_status else RequestStatus.QUOTE
    
    def validate_intent(self, value):
        if not value:
            raise serializers.ValidationError("Intent is required. Must be one of: BUYBACK, DIRECT_SALE, STORE_CREDIT")
        if value not in [choice[0] for choice in RequestIntent.choices]:
            raise serializers.ValidationError(f"Invalid intent. Must be one of: {', '.join([c[0] for c in RequestIntent.choices])}")
        return value
