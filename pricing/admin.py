from django.contrib import admin
from django import forms
from django.utils.html import format_html


# --- MODELS V2 ----
from django.contrib import admin
from .models_v2 import (
    ProductCategory,
    Manufacturer,
    Product,
    Attribute,
    AttributeValue,
    ConditionGrade,
    Variant,
    VariantAttributeValue,
    VariantPriceHistory,
    VariantStatus,
    PricingRule,
    InventoryUnit,
    Customer,
    RequestItem,
    RequestStatusHistory,
    Request,
    TradeIn,
    Agreement,
    InventoryOwnershipEvent,
    Location
)


# --------------------------------
# Category, Manufacturer & Product
# --------------------------------

@admin.register(ProductCategory)
class ProductCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "parent_category")
    list_filter = ("parent_category",)
    search_fields = ("name",)
    ordering = ("name",)

@admin.register(Manufacturer)
class ManufacturerAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)
    ordering = ("name",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "manufacturer")
    list_filter = ("category", "manufacturer")
    search_fields = ("name", "manufacturer__name")
    ordering = ("name",)


# -------------------------
# Attributes
# -------------------------

class AttributeValueInline(admin.TabularInline):
    model = AttributeValue
    extra = 0


@admin.register(Attribute)
class AttributeAdmin(admin.ModelAdmin):
    list_display = ("code", "category")
    list_filter = ("category",)
    search_fields = ("code",)
    ordering = ("category", "code")
    inlines = [AttributeValueInline]


@admin.register(AttributeValue)
class AttributeValueAdmin(admin.ModelAdmin):
    list_display = ("value", "attribute")
    list_filter = ("attribute",)
    search_fields = ("value",)
    ordering = ("attribute", "value")


# -------------------------
# Condition Grades
# -------------------------

@admin.register(ConditionGrade)
class ConditionGradeAdmin(admin.ModelAdmin):
    list_display = ("code",)
    search_fields = ("code",)
    ordering = ("code",)


# -------------------------
# Variant & Bridges
# -------------------------

class VariantAttributeValueInline(admin.TabularInline):
    model = VariantAttributeValue
    extra = 0
    autocomplete_fields = ("attribute_value",)


class VariantPriceHistoryInline(admin.TabularInline):
    model = VariantPriceHistory
    extra = 0
    readonly_fields = ("price_gbp", "recorded_at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


class VariantStatusInline(admin.TabularInline):
    model = VariantStatus
    extra = 0
    ordering = ("-effective_from",)


@admin.register(Variant)
class VariantAdmin(admin.ModelAdmin):
    list_display = (
        "cex_sku",
        "product",
        "condition_grade",
        "current_price_gbp",
    )
    list_filter = (
        "condition_grade",
        "product__category",
    )
    search_fields = (
        "cex_sku",
        "variant_signature",
        "product__name",
        "title"
    )
    ordering = ("product", "condition_grade")
    autocomplete_fields = ("product", "condition_grade")
    readonly_fields = ("variant_signature",)
    inlines = [
        VariantAttributeValueInline,
        VariantPriceHistoryInline,
        VariantStatusInline,
    ]


@admin.register(VariantAttributeValue)
class VariantAttributeValueAdmin(admin.ModelAdmin):
    list_display = ("variant", "attribute_value")
    list_filter = ("attribute_value__attribute",)
    search_fields = ("variant__cex_sku", "attribute_value__value")


# -------------------------
# History Tables (Read-only)
# -------------------------

@admin.register(VariantPriceHistory)
class VariantPriceHistoryAdmin(admin.ModelAdmin):
    list_display = ("variant", "price_gbp", "recorded_at")
    list_filter = ("recorded_at",)
    search_fields = ("variant__cex_sku",)
    ordering = ("-recorded_at",)
    readonly_fields = ("variant", "price_gbp", "recorded_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(VariantStatus)
class VariantStatusAdmin(admin.ModelAdmin):
    list_display = ("variant", "status", "effective_from")
    list_filter = ("status",)
    search_fields = ("variant__cex_sku",)
    ordering = ("-effective_from",)


@admin.register(PricingRule)
class PricingRuleAdmin(admin.ModelAdmin):
    list_display = (
        'get_scope', 
        'movement_class', 
        'sell_price_multiplier', 
        'is_global_default'
    )
    list_filter = ('movement_class', 'is_global_default', 'category', 'product')
    search_fields = ('product__name', 'category__name')
    ordering = ('movement_class', 'product', 'category')

    fieldsets = (
        (None, {
            'fields': ('movement_class', 'sell_price_multiplier', 'is_global_default')
        }),
        ('Scope', {
            'fields': ('product', 'category'),
            'description': "Choose either a product, a category, or mark as global default."
        }),
    )

    def get_scope(self, obj):
        if obj.is_global_default:
            return "Global"
        if obj.product:
            return f"Product: {obj.product.name}"
        if obj.category:
            return f"Category: {obj.category.name}"
        return "—"
    get_scope.short_description = "Scope"

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "phone_number", "created_at")
    search_fields = ("name", "phone_number")
    ordering = ("-created_at",)


    

class RequestStatusHistoryInline(admin.TabularInline):
    model = RequestStatusHistory
    extra = 0
    readonly_fields = ("status", "effective_at")
    ordering = ("-effective_at",)

    def has_add_permission(self, request, obj=None):
        return False


# 3. NOW YOUR INLINE WORKS
class RequestItemInline(admin.TabularInline):
    model = RequestItem
    extra = 0
    autocomplete_fields = ['variant']
    fields = ('variant', 'expectation_gbp', 'notes')
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('variant')

# 4. NOW YOUR REQUEST ADMIN WORKS
@admin.register(Request)
class RequestAdmin(admin.ModelAdmin):
    list_display = ("request_id", "customer", "intent", "created_at")
    list_select_related = ("customer",)
    search_fields = ("request_id", "customer__name", "customer__phone_number")
    autocomplete_fields = ("customer",)
    inlines = [RequestItemInline]
    


@admin.register(RequestItem)
class RequestItemAdmin(admin.ModelAdmin):
    list_display = (
        "request_item_id",
        "request",
        "variant",
        "expectation_gbp",
        "quantity",
        "customer_expectation_gbp",
        "negotiated_price_gbp",
        "get_cex_buy_cash",
        "get_cex_buy_voucher",
        "get_cex_sell_price",
    )
    list_filter = ("variant__product__category",)
    search_fields = (
        "variant__cex_sku",
        "request__customer__name",
        "request__customer__phone_number",
    )
    autocomplete_fields = ("request", "variant")
    readonly_fields = (
        "raw_data",
        "cash_offers_json",
        "voucher_offers_json",
        "customer_expectation_gbp",
        "negotiated_price_gbp",
        "get_cex_buy_cash",
        "get_cex_buy_voucher",
        "get_cex_sell_price",
    )
    fieldsets = (
        (None, {
            'fields': (
                'request',
                'variant',
                'expectation_gbp',
                'quantity',
                'notes'
            )
        }),
        ('Variant Details (from linked Variant)', { # Updated fieldset title
            'fields': (
                'get_cex_buy_cash',
                'get_cex_buy_voucher',
                'get_cex_sell_price',
            ),
        }),
        ('Offers & Negotiation', {
            'fields': (
                'customer_expectation_gbp',
                'selected_offer_id',
                'manual_offer_gbp',
                'negotiated_price_gbp',
                'cash_offers_json',
                'voucher_offers_json',
            )
        }),
        ('Raw Data', {
            'fields': ('raw_data',),
            'classes': ('collapse',),
            'description': "Raw data used for pricing decisions."
        }),
    )

    def get_cex_buy_cash(self, obj):
        return obj.variant.tradein_cash if obj.variant else None
    get_cex_buy_cash.short_description = "CeX Buy (Cash)"

    def get_cex_buy_voucher(self, obj):
        return obj.variant.tradein_voucher if obj.variant else None
    get_cex_buy_voucher.short_description = "CeX Buy (Voucher)"

    def get_cex_sell_price(self, obj):
        return obj.variant.current_price_gbp if obj.variant else None
    get_cex_sell_price.short_description = "CeX Sell Price"


@admin.register(TradeIn)
class TradeInAdmin(admin.ModelAdmin):
    list_display = (
        "tradein_id",
        "request_item",
        "outcome",
        "final_offer_gbp",
        "created_at",
    )
    list_filter = ("outcome",)
    ordering = ("-created_at",)
    autocomplete_fields = ("request_item",)

    readonly_fields = (
        "request_item",
        "final_offer_gbp",
        "outcome",
        "created_at",
    )

    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False

@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ("code", "name")
    search_fields = ("code", "name")
    ordering = ("code",)



@admin.register(Agreement)
class AgreementAdmin(admin.ModelAdmin):
    list_display = (
        "agreement_id",
        "agreement_type",
        "status",
        "signed_at",
        "expires_at",
    )
    list_filter = ("agreement_type", "status")
    ordering = ("-signed_at",)

    readonly_fields = (
        "tradein",
        "agreement_type",
        "signed_at",
    )

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(InventoryUnit)
class InventoryUnitAdmin(admin.ModelAdmin):
    list_display = (
        "item_id",
        "variant",
        "location",
        "is_sellable",
    )
    list_filter = ("location", "is_sellable")
    search_fields = ("variant__cex_sku",)
    autocomplete_fields = ("variant", "location")

    readonly_fields = ("tradein",)


@admin.register(InventoryOwnershipEvent)
class InventoryOwnershipEventAdmin(admin.ModelAdmin):
    list_display = (
        "inventory_unit",
        "event_type",
        "event_at",
    )
    list_filter = ("event_type",)
    ordering = ("-event_at",)

    readonly_fields = (
        "inventory_unit",
        "event_type",
        "event_at",
        "notes",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
