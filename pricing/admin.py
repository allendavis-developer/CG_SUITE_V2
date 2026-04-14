from django.contrib import admin
from django import forms
from django.utils.html import format_html

# --- MODELS V2 ----
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
    RequestItemOffer,
    RequestStatusHistory,
    Request,
    TradeIn,
    Agreement,
    InventoryOwnershipEvent,
    Location,
    RepricingSession,
    RepricingSessionItem,
    UploadSession,
    UploadSessionItem,
    RequestJewelleryReferenceSnapshot,
    RequestItemJewellery,
    RequestItemJewelleryValuation,
    InventoryUnitJewellery,
    NosposCategory,
    NosposField,
    NosposCategoryField,
)


# --------------------------------
# Category, Manufacturer & Product
# --------------------------------

@admin.register(NosposCategory)
class NosposCategoryAdmin(admin.ModelAdmin):
    list_display = (
        "nospos_id",
        "level",
        "full_name",
        "parent",
        "status",
        "buyback_rate",
        "offer_rate",
        "updated_at",
    )
    list_filter = ("level", "status")
    search_fields = ("full_name", "nospos_id")
    ordering = ("level", "full_name")
    raw_id_fields = ("parent",)


@admin.register(NosposField)
class NosposFieldAdmin(admin.ModelAdmin):
    list_display = ("nospos_field_id", "name", "updated_at")
    search_fields = ("name", "nospos_field_id")
    ordering = ("nospos_field_id",)


@admin.register(NosposCategoryField)
class NosposCategoryFieldAdmin(admin.ModelAdmin):
    list_display = ("category", "field", "active", "editable", "sensitive", "required", "updated_at")
    list_filter = ("active", "editable", "sensitive", "required")
    search_fields = ("category__full_name", "category__nospos_id", "field__name", "field__nospos_field_id")
    raw_id_fields = ("category", "field")


@admin.register(ProductCategory)
class ProductCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "parent_category", "ready_for_builder")
    list_filter = ("parent_category", "ready_for_builder")
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
        'sell_price_multiplier',
        'first_offer_pct_of_cex',
        'second_offer_pct_of_cex',
        'is_global_default',
    )
    list_filter = ('is_global_default', 'category', 'product')
    search_fields = ('product__name', 'category__name')
    ordering = ('product', 'category')

    fieldsets = (
        (None, {
            'fields': ('sell_price_multiplier', 'first_offer_pct_of_cex', 'second_offer_pct_of_cex', 'is_global_default')
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
    list_display = ("name", "phone_number", "nospos_customer_id", "created_at")
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


class RequestItemOfferInline(admin.TabularInline):
    model = RequestItemOffer
    extra = 0
    fields = (
        "offer_type",
        "offer_code",
        "title",
        "offer_slot",
        "price_gbp",
        "margin_pct",
        "is_highlighted",
        "is_selected",
        "sort_order",
    )
    readonly_fields = ("offer_type", "offer_code", "title", "offer_slot", "price_gbp", "margin_pct", "is_highlighted", "sort_order")

# 4. NOW YOUR REQUEST ADMIN WORKS
@admin.register(Request)
class RequestAdmin(admin.ModelAdmin):
    list_display = ("request_id", "customer", "intent", "current_jewellery_reference_snapshot", "created_at")
    list_select_related = ("customer",)
    search_fields = ("request_id", "customer__name", "customer__phone_number")
    autocomplete_fields = ("customer", "current_jewellery_reference_snapshot")
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
    autocomplete_fields = ("request", "variant", "senior_mgmt_approved_user")
    readonly_fields = (
        "get_ebay_research_summary",
        "get_cc_research_summary",
        "get_cg_research_summary",
        "get_line_context_summary",
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
                'manual_offer_gbp',
                'manual_offer_used',
                'senior_mgmt_approved_user',
                'negotiated_price_gbp',
            )
        }),
        ('Market research (normalized)', {
            'fields': (
                'get_ebay_research_summary',
                'get_cc_research_summary',
                'get_cg_research_summary',
                'get_line_context_summary',
            ),
            'classes': ('collapse',),
            'description': "eBay / Cash Converters / Cash Generator research is stored relationally; CeX snapshots in JSON fields.",
        }),
    )
    inlines = [RequestItemOfferInline]

    def get_ebay_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="EBAY").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_ebay_research_summary.short_description = "eBay research"

    def get_cc_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_CONVERTERS").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cc_research_summary.short_description = "Cash Converters research"

    def get_cg_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_GENERATOR").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cg_research_summary.short_description = "Cash Generator research"

    def get_line_context_summary(self, obj):
        parts = []
        if obj.cex_line_snapshot_json:
            parts.append("CeX line snapshot")
        if obj.cex_reference_json:
            parts.append("CeX reference")
        if obj.line_metadata_json:
            parts.append("negotiation metadata")
        return ", ".join(parts) if parts else "—"

    get_line_context_summary.short_description = "Other persisted context"

    def get_cex_buy_cash(self, obj):
        return obj.variant.tradein_cash if obj.variant else None
    get_cex_buy_cash.short_description = "CeX Buy (Cash)"

    def get_cex_buy_voucher(self, obj):
        return obj.variant.tradein_voucher if obj.variant else None
    get_cex_buy_voucher.short_description = "CeX Buy (Voucher)"

    def get_cex_sell_price(self, obj):
        return obj.variant.current_price_gbp if obj.variant else None
    get_cex_sell_price.short_description = "CeX Sell Price"


@admin.register(RequestItemOffer)
class RequestItemOfferAdmin(admin.ModelAdmin):
    list_display = (
        "request_item_offer_id",
        "request_item",
        "offer_type",
        "offer_code",
        "price_gbp",
        "is_selected",
        "sort_order",
    )
    list_filter = ("offer_type", "is_selected")
    search_fields = (
        "request_item__request_item_id",
        "request_item__request__request_id",
        "request_item__request__customer__name",
        "offer_code",
        "title",
    )
    autocomplete_fields = ("request_item",)


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


@admin.register(RequestJewelleryReferenceSnapshot)
class RequestJewelleryReferenceSnapshotAdmin(admin.ModelAdmin):
    list_display = (
        "snapshot_id",
        "request",
        "source_name",
        "scraped_at",
        "created_at",
    )
    list_filter = ("source_name", "created_at", "scraped_at")
    search_fields = (
        "snapshot_id",
        "request__request_id",
        "request__customer__name",
        "source_url",
        "created_by_user__username",
    )
    autocomplete_fields = ("request", "created_by_user")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)


@admin.register(RequestItemJewellery)
class RequestItemJewelleryAdmin(admin.ModelAdmin):
    list_display = (
        "request_item",
        "material_grade",
        "measured_gross_weight_grams",
        "measurement_source",
        "measured_at",
        "inventory_unit",
    )
    list_filter = ("measurement_source", "input_weight_unit", "measured_at")
    search_fields = (
        "request_item__request_item_id",
        "request_item__request__request_id",
        "request_item__request__customer__name",
        "measured_by_user__username",
        "inventory_unit__item_id",
    )
    autocomplete_fields = ("request_item", "inventory_unit", "material_grade", "measured_by_user")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-measured_at",)


@admin.register(RequestItemJewelleryValuation)
class RequestItemJewelleryValuationAdmin(admin.ModelAdmin):
    list_display = (
        "valuation_id",
        "request_item_jewellery",
        "valuation_source",
        "computed_total_gbp",
        "is_selected",
        "created_at",
    )
    list_filter = ("valuation_source", "is_selected", "created_at")
    search_fields = (
        "valuation_id",
        "request_item_jewellery__request_item__request_item_id",
        "request_item_jewellery__request_item__request__request_id",
        "request_item_jewellery__request_item__request__customer__name",
    )
    autocomplete_fields = ("request_item_jewellery", "source_reference_snapshot")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)


@admin.register(InventoryUnitJewellery)
class InventoryUnitJewelleryAdmin(admin.ModelAdmin):
    list_display = (
        "inventory_unit",
        "material_grade",
        "gross_weight_grams",
        "net_weight_grams",
        "hallmark_status",
        "measurement_source",
        "measured_at",
    )
    list_filter = ("hallmark_status", "measurement_source", "measured_at")
    search_fields = (
        "inventory_unit__item_id",
        "inventory_unit__variant__cex_sku",
        "inventory_unit__variant__title",
        "measured_by_user__username",
    )
    autocomplete_fields = ("inventory_unit", "material_grade", "source_request_item", "measured_by_user")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-measured_at",)


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


# -------------------------
# Repricing sessions (read-focused)
# -------------------------


class RepricingSessionItemInline(admin.TabularInline):
    model = RepricingSessionItem
    extra = 0
    readonly_fields = (
        "item_identifier",
        "title",
        "quantity",
        "barcode",
        "stock_barcode",
        "stock_url_link",
        "old_retail_price",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "created_at",
    )
    fields = readonly_fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def stock_url_link(self, obj):
        if not obj.stock_url:
            return "-"
        return format_html('<a href="{}" target="_blank" rel="noopener noreferrer">{}</a>', obj.stock_url, obj.stock_url)

    stock_url_link.short_description = "Stock URL"


@admin.register(RepricingSession)
class RepricingSessionAdmin(admin.ModelAdmin):
    list_display = (
        "repricing_session_id",
        "cart_key",
        "item_count",
        "barcode_count",
        "created_at",
    )
    search_fields = ("cart_key",)
    list_filter = ("created_at",)
    ordering = ("-created_at",)
    inlines = [RepricingSessionItemInline]


@admin.register(RepricingSessionItem)
class RepricingSessionItemAdmin(admin.ModelAdmin):
    list_display = (
        "repricing_session_item_id",
        "repricing_session",
        "item_identifier",
        "title",
        "barcode",
        "stock_barcode",
        "short_stock_url",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "created_at",
    )
    list_filter = ("repricing_session", "created_at")
    search_fields = ("item_identifier", "title", "barcode", "stock_barcode", "stock_url")
    readonly_fields = (
        "repricing_session",
        "item_identifier",
        "title",
        "quantity",
        "barcode",
        "stock_barcode",
        "stock_url",
        "old_retail_price",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "get_ebay_research_summary",
        "get_cc_research_summary",
        "get_cg_research_summary",
        "created_at",
    )

    def get_ebay_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="EBAY").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_ebay_research_summary.short_description = "eBay research"

    def get_cc_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_CONVERTERS").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cc_research_summary.short_description = "Cash Converters research"

    def get_cg_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_GENERATOR").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cg_research_summary.short_description = "Cash Generator research"

    def short_stock_url(self, obj):
        if not obj.stock_url:
            return ""
        # Show only path / last part for readability
        return obj.stock_url.replace("https://", "").replace("http://", "")

    short_stock_url.short_description = "Stock URL"


class UploadSessionItemInline(admin.TabularInline):
    model = UploadSessionItem
    extra = 0
    readonly_fields = (
        "item_identifier",
        "title",
        "quantity",
        "barcode",
        "stock_barcode",
        "stock_url_link",
        "old_retail_price",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "created_at",
    )
    fields = readonly_fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def stock_url_link(self, obj):
        if not obj.stock_url:
            return "-"
        return format_html('<a href="{}" target="_blank" rel="noopener noreferrer">{}</a>', obj.stock_url, obj.stock_url)

    stock_url_link.short_description = "Stock URL"


@admin.register(UploadSession)
class UploadSessionAdmin(admin.ModelAdmin):
    list_display = (
        "upload_session_id",
        "cart_key",
        "item_count",
        "barcode_count",
        "created_at",
    )
    search_fields = ("cart_key",)
    list_filter = ("created_at",)
    ordering = ("-created_at",)
    inlines = [UploadSessionItemInline]


@admin.register(UploadSessionItem)
class UploadSessionItemAdmin(admin.ModelAdmin):
    list_display = (
        "upload_session_item_id",
        "upload_session",
        "item_identifier",
        "title",
        "barcode",
        "stock_barcode",
        "short_stock_url",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "created_at",
    )
    list_filter = ("upload_session", "created_at")
    search_fields = ("item_identifier", "title", "barcode", "stock_barcode", "stock_url")
    readonly_fields = (
        "upload_session",
        "item_identifier",
        "title",
        "quantity",
        "barcode",
        "stock_barcode",
        "stock_url",
        "old_retail_price",
        "new_retail_price",
        "cex_sell_at_repricing",
        "our_sale_price_at_repricing",
        "get_ebay_research_summary",
        "get_cc_research_summary",
        "get_cg_research_summary",
        "created_at",
    )

    def get_ebay_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="EBAY").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_ebay_research_summary.short_description = "eBay research"

    def get_cc_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_CONVERTERS").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cc_research_summary.short_description = "Cash Converters research"

    def get_cg_research_summary(self, obj):
        s = obj.market_research_sessions.filter(platform="CASH_GENERATOR").first()
        if not s:
            return "—"
        n = s.listings.count()
        return f"median £{s.stat_median_gbp} · suggested £{s.stat_suggested_sale_gbp} · {n} listing(s)"

    get_cg_research_summary.short_description = "Cash Generator research"

    def short_stock_url(self, obj):
        if not obj.stock_url:
            return ""
        return obj.stock_url.replace("https://", "").replace("http://", "")

    short_stock_url.short_description = "Stock URL"
