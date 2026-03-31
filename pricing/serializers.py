# serializers.py
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models_v2 import (
    ProductCategory,
    Product,
    Variant,
    Attribute,
    AttributeValue,
    Customer,
    Request,
    RequestItem,
    RequestStatus,
    RequestStatusHistory,
    RequestIntent,
    RepricingSession,
    RepricingSessionItem,
    RequestItemOfferType,
)
from . import research_storage
from .offer_rows import (
    compose_offer_json_from_rows,
    get_selected_offer_code,
    sync_request_item_offer_rows,
    sync_request_item_offer_rows_from_payload,
)


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
    product_id = serializers.IntegerField(source='product.product_id', read_only=True)
    product_name = serializers.SerializerMethodField()
    category_id = serializers.IntegerField(source='product.category.category_id', read_only=True)
    category_name = serializers.CharField(source='product.category.name', read_only=True)
    condition = serializers.CharField(source='condition_grade.code', read_only=True)
    attribute_values = serializers.SerializerMethodField()

    def get_product_name(self, obj):
        if obj.product.manufacturer:
            return f"{obj.product.manufacturer.name} {obj.product.name}"
        return obj.product.name

    def get_attribute_values(self, obj):
        return {
            vav.attribute_value.attribute.code: vav.attribute_value.value
            for vav in obj.variant_attribute_values.select_related('attribute_value__attribute').all()
        }

    class Meta:
        model = Variant
        fields = [
            'variant_id',
            'cex_sku',
            'title',
            'current_price_gbp',
            'tradein_cash',
            'tradein_voucher',
            'cex_out_of_stock',
            'product_id',
            'product_name',
            'category_id',
            'category_name',
            'condition',
            'attribute_values',
        ]
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
    cancel_rate = serializers.FloatField(read_only=True)

    class Meta:
        model = Customer
        fields = ['customer_id', 'name', 'phone_number', 'email', 'address', 'is_temp_staging', 'cancel_rate']
        extra_kwargs = {
            'name': {'required': True},
            'is_temp_staging': {'required': False, 'default': False},
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
    raw_data = serializers.SerializerMethodField()
    cash_converters_data = serializers.SerializerMethodField()
    selected_offer_id = serializers.SerializerMethodField()
    senior_mgmt_approved_by = serializers.SerializerMethodField()
    cash_offers_json = serializers.JSONField(required=False)
    voucher_offers_json = serializers.JSONField(required=False)

    class Meta:
        model = RequestItem
        fields = [
            'request_item_id',
            'request',
            'variant',
            'variant_details',
            'raw_data',
            'cash_converters_data',
            'notes',
            'quantity',
            'selected_offer_id',
            'manual_offer_gbp',
            'manual_offer_used',
            'senior_mgmt_approved_by',
            'customer_expectation_gbp',
            'negotiated_price_gbp',
            'cash_offers_json',
            'voucher_offers_json',
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
            'raw_data',
            'cash_converters_data',
        ]

    def get_raw_data(self, obj):
        return research_storage.compose_raw_data_for_request_item(obj)

    def get_cash_converters_data(self, obj):
        return research_storage.compose_cash_converters_for_request_item(obj)

    def create(self, validated_data):
        cash_offers = validated_data.pop("cash_offers_json", None)
        voucher_offers = validated_data.pop("voucher_offers_json", None)
        item = RequestItem.objects.create(**validated_data)
        research_storage.ingest_request_item_post_create(
            item,
            self.initial_data.get('raw_data'),
            self.initial_data.get('cash_converters_data'),
        )
        if cash_offers is not None or voucher_offers is not None:
            sync_request_item_offer_rows_from_payload(
                item,
                selected_offer_id=self.initial_data.get("selected_offer_id"),
                cash_offers=cash_offers or [],
                voucher_offers=voucher_offers or [],
                manual_offer_gbp=item.manual_offer_gbp,
            )
        else:
            sync_request_item_offer_rows(item)
        return item

    def to_representation(self, instance):
        data = super().to_representation(instance)
        cash_rows = compose_offer_json_from_rows(instance, RequestItemOfferType.CASH)
        voucher_rows = compose_offer_json_from_rows(instance, RequestItemOfferType.VOUCHER)
        if cash_rows:
            data["cash_offers_json"] = cash_rows
        if voucher_rows:
            data["voucher_offers_json"] = voucher_rows
        return data

    def get_selected_offer_id(self, obj):
        return get_selected_offer_code(obj)

    def get_senior_mgmt_approved_by(self, obj):
        user = getattr(obj, "senior_mgmt_approved_user", None)
        return getattr(user, "username", None) if user else None
    
    def validate_customer_expectation_gbp(self, value):
        if value is None:
            return value
        if value < 0:
            raise serializers.ValidationError("Customer expectation cannot be negative")
        field = RequestItem._meta.get_field("customer_expectation_gbp")
        try:
            field.clean(value, None)
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.messages)
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
    jewellery_reference_scrape_json = serializers.SerializerMethodField()
    
    class Meta:
        model = Request
        fields = [
            'request_id',
            'customer',
            'customer_details',
            'intent',
            'created_at',
            'overall_expectation_gbp',
            'target_offer_gbp',
            'negotiated_grand_total_gbp',
            'customer_enrichment_json',
            'jewellery_reference_scrape_json',
            'items',
            'current_status',
            'status_history'
        ]
        read_only_fields = ['request_id', 'created_at']
    
    def get_current_status(self, obj):
        latest_status = obj.status_history.first()
        # Always return a status - default to QUOTE if no status history exists
        return latest_status.status if latest_status else RequestStatus.QUOTE

    def get_jewellery_reference_scrape_json(self, obj):
        snap = getattr(obj, "current_jewellery_reference_snapshot", None)
        if snap is None:
            snap = (
                obj.jewellery_reference_history.order_by("-created_at").first()
            )
        if not snap:
            return None
        sections = snap.sections_json
        if not isinstance(sections, list) or len(sections) == 0:
            return None
        return {
            "sections": sections,
            "scrapedAt": snap.scraped_at.isoformat() if snap.scraped_at else None,
            "sourceUrl": snap.source_url or None,
        }
    
    def validate_intent(self, value):
        if not value:
            raise serializers.ValidationError("Intent is required. Must be one of: BUYBACK, DIRECT_SALE, STORE_CREDIT")
        if value not in [choice[0] for choice in RequestIntent.choices]:
            raise serializers.ValidationError(f"Invalid intent. Must be one of: {', '.join([c[0] for c in RequestIntent.choices])}")
        return value


class RepricingSessionItemSerializer(serializers.ModelSerializer):
    raw_data = serializers.SerializerMethodField()
    cash_converters_data = serializers.SerializerMethodField()

    class Meta:
        model = RepricingSessionItem
        fields = [
            'repricing_session_item_id',
            'item_identifier',
            'title',
            'quantity',
            'barcode',
            'stock_barcode',
            'stock_url',
            'old_retail_price',
            'new_retail_price',
            'cex_sell_at_repricing',
            'our_sale_price_at_repricing',
            'raw_data',
            'cash_converters_data',
            'created_at',
        ]
        read_only_fields = [
            'repricing_session_item_id',
            'created_at',
            'raw_data',
            'cash_converters_data',
        ]

    def get_raw_data(self, obj):
        return research_storage.compose_raw_data_for_repricing_item(obj)

    def get_cash_converters_data(self, obj):
        return research_storage.compose_cash_converters_for_repricing_item(obj)


class RepricingSessionSerializer(serializers.ModelSerializer):
    items = RepricingSessionItemSerializer(many=True, read_only=True)

    class Meta:
        model = RepricingSession
        fields = [
            'repricing_session_id',
            'cart_key',
            'item_count',
            'barcode_count',
            'status',
            'session_data',
            'created_at',
            'updated_at',
            'items',
        ]
        read_only_fields = ['repricing_session_id', 'created_at', 'updated_at']
