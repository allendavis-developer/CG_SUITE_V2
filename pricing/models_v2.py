"""
models_v2
"""

from django.db import models
from django.db.models import Q, F
from django.core.validators import MinValueValidator
from decimal import Decimal
from django.utils import timezone
from django.conf import settings


class ProductCategory(models.Model):
    """
    Category hierarchy. Top level categories have parent category ID = null
    """
    category_id = models.AutoField(primary_key=True)
    parent_category = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
        db_column='parent_category_id',
        help_text="Parent category. Root categories have this empty."
    )
    name = models.CharField(max_length=255, db_index=True)
    ready_for_builder = models.BooleanField(
        default=True,
        db_index=True,
        help_text=(
            "If False, hide this category (and use only where full tree is needed, e.g. "
            "NosPos mapping / data tools). Buyer and repricing sidebars only show "
            "categories with this True."
        ),
    )

    class Meta:
        db_table = 'pricing_product_category'
        verbose_name = 'Product Category'
        verbose_name_plural = 'Product Categories'
        indexes = [
            models.Index(fields=['parent_category', 'name']),
        ]

    def __str__(self):
        return self.name

    def iter_ancestors(self, include_self=True):
        """
        Yields this category, then its parents up to the root.
        """
        category = self if include_self else self.parent_category
        while category:
            yield category
            category = category.parent_category


class CGCategory(models.Model):
    """
    Cash Generator retail mega-menu categories (scraped from the public site).
    Top-level rows have parent_category_id NULL (under implicit All Categories).
    """

    parent_category = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children',
        db_column='parent_category_id',
        help_text='Parent category. Root categories have this empty.',
    )
    name = models.CharField(max_length=255, db_index=True)
    collection_slug = models.CharField(
        max_length=255,
        unique=True,
        db_index=True,
        help_text='Stable id from /collections/{slug} (used when merging scrapes).',
    )

    class Meta:
        db_table = 'cg_categories'
        verbose_name = 'CG category'
        verbose_name_plural = 'CG categories'

    def __str__(self):
        return self.name


class Manufacturer(models.Model):
    manufacturer_id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=255, unique=True, db_index=True)

    class Meta:
        db_table = 'pricing_manufacturer'

    def __str__(self):
        return self.name


class Product(models.Model):
    """
    A product is a model name, not a sellable thing.
    Represents the family/model (e.g., "PlayStation 5 Slim").
    """
    product_id = models.AutoField(primary_key=True)
    category = models.ForeignKey(
        ProductCategory,
        on_delete=models.CASCADE,
        related_name='products',
        db_column='category_id'
    )

    manufacturer = models.ForeignKey(
        Manufacturer,
        on_delete=models.CASCADE,
        related_name='products',
        db_column='manufacturer_id',
        null=True,  # optional if old products don't have a manufacturer
        blank=True
    )


    name = models.CharField(max_length=255, db_index=True)

    class Meta:
        db_table = 'pricing_product'
        indexes = [
            models.Index(fields=['category', 'name']),
        ]

    def __str__(self):
        return self.name


class Attribute(models.Model):
    """
    Attributes define what kinds of variation exist for products in this category.
    Examples: storage_tb, edition, console_colour
    """
    attribute_id = models.AutoField(primary_key=True)
    category = models.ForeignKey(
        ProductCategory,
        on_delete=models.CASCADE,
        related_name='attributes',
        db_column='category_id'
    )
    code = models.CharField(
        max_length=100,
        db_index=True,
        help_text="Stable machine-readable code (e.g., 'storage_tb')"
    )
    label = models.CharField(
        max_length=255,
        help_text="User-facing label (e.g., 'Storage Capacity')"
    )

    class Meta:
        db_table = 'pricing_attribute'
        unique_together = [['category', 'code']]
        indexes = [
            models.Index(fields=['category', 'code']),
        ]

    def __str__(self):
        return f"{self.label} ({self.code})"


class AttributeValue(models.Model):
    """
    Canonical value table for attributes.
    Each value exists once. No free-text chaos. No duplication.
    """
    attribute_value_id = models.AutoField(primary_key=True)
    attribute = models.ForeignKey(
        Attribute,
        on_delete=models.CASCADE,
        related_name='values',
        db_column='attribute_id'
    )
    value = models.CharField(max_length=255, db_index=True)

    class Meta:
        db_table = 'pricing_attribute_value'
        unique_together = [['attribute', 'value']]
        indexes = [
            models.Index(fields=['attribute', 'value']),
        ]

    def __str__(self):
        return f"{self.attribute.code} = {self.value}"


class ConditionGrade(models.Model):
    """
    CeX-specific condition grades.
    Condition is not an attribute - it's a core axis of sellability.
    This table is global (not scoped to category).
    """
    condition_grade_id = models.AutoField(primary_key=True)
    code = models.CharField(max_length=50, unique=True, db_index=True, help_text="Condition code (e.g., 'BOXED', 'UNBOXED', 'DISCOUNTED')")

    class Meta:
        db_table = 'pricing_condition_grade'
        verbose_name = 'Condition Grade'
        verbose_name_plural = 'Condition Grades'

    def __str__(self):
        return self.code


class PricingRule(models.Model):
    """
    Determines what % of CeX sale price we should sell at, and optionally
    what % of the CeX trade-in price to use for the First and Second Offers.
    Scoped to a specific product, category, or as the global default.
    """

    pricing_rule_id = models.AutoField(primary_key=True)

    category = models.ForeignKey(
        ProductCategory,
        on_delete=models.CASCADE,
        related_name='pricing_rules',
        null=True,
        blank=True
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='pricing_rules',
        null=True,
        blank=True
    )

    is_global_default = models.BooleanField(
        default=False,
        help_text="Fallback rule if no product or category rule exists"
    )

    sell_price_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))]
    )

    first_offer_pct_of_cex = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "% of the CeX trade-in price offered as the First Offer. "
            "E.g. 90 means offer_1 = cex_tradein * 0.90. "
            "Leave blank to use the default (same absolute margin as CeX)."
        )
    )

    second_offer_pct_of_cex = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "% of the CeX trade-in price offered as the Second Offer. "
            "E.g. 95 means offer_2 = cex_tradein * 0.95. "
            "Leave blank to use the default (midpoint between First and Third)."
        )
    )

    third_offer_pct_of_cex = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "% of the CeX trade-in price offered as the Third Offer. "
            "E.g. 100 means offer_3 = cex_tradein * 1.00 (matches CeX). "
            "Leave blank to default to 100% (match CeX trade-in exactly)."
        )
    )

    ebay_offer_margin_1_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "First eBay/Cash Converters cash offer as % of suggested sale price. "
            "E.g. 40 means offer = suggestedPrice × 0.40. Default 40."
        )
    )

    ebay_offer_margin_2_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Second offer as % of suggested sale price. "
            "E.g. 50 means offer = suggestedPrice × 0.50. Default 50."
        )
    )

    ebay_offer_margin_3_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Third offer as % of suggested sale price. "
            "E.g. 60 means offer = suggestedPrice × 0.60. Default 60."
        )
    )

    ebay_offer_margin_4_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Fourth offer as % of suggested sale price (top tier; typically match sale). "
            "E.g. 100 means offer = suggestedPrice × 1.00. Default 100 when blank."
        )
    )

    class Meta:
        db_table = 'pricing_rule'
        constraints = [
            # One rule per product
            models.UniqueConstraint(
                fields=['product'],
                condition=models.Q(product__isnull=False),
                name='uniq_product_rule'
            ),
            # One rule per category
            models.UniqueConstraint(
                fields=['category'],
                condition=models.Q(category__isnull=False),
                name='uniq_category_rule'
            ),
            # At most one global default
            models.UniqueConstraint(
                fields=['is_global_default'],
                condition=models.Q(is_global_default=True),
                name='uniq_global_default_rule'
            ),
            # Must have a valid scope
            models.CheckConstraint(
                condition=(
                    models.Q(product__isnull=False) |
                    models.Q(category__isnull=False) |
                    models.Q(is_global_default=True)
                ),
                name='pricing_rule_scope_required'
            ),
        ]

    def __str__(self):
        if self.is_global_default:
            return f"GLOBAL @ {self.sell_price_multiplier}"
        target = self.product.name if self.product else self.category.name
        return f"{target} @ {self.sell_price_multiplier}"


class Variant(models.Model):
    """
    The sellable SKU type.
    A variant is one unique combination of:
    - product
    - condition
    - attribute values
    
    Also owns the CeX SKU and current price.
    """
    variant_id = models.AutoField(primary_key=True)
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='variants',
        db_column='product_id',
        null=False,
        blank=False
    )

    condition_grade = models.ForeignKey(
        ConditionGrade,
        on_delete=models.CASCADE,
        related_name='variants',
        db_column='condition_grade_id'
    )
    cex_sku = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        help_text="CeX SKU - stable identity"
    )
    current_price_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text="Current price in GBP (denormalized for fast reads)"
    )

    tradein_cash = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="Trade-in value paid as cash in GBP"
    )

    tradein_voucher = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="Trade-in value paid as voucher in GBP"
    )

    cex_price_last_updated_date = models.DateTimeField(
        default=timezone.now,
        help_text="Timestamp when the CeX price was last updated"
    )

    cex_out_of_stock = models.BooleanField(
        default=False,
        help_text="Indicates whether the variant is out of stock at CeX"
    )


    variant_signature = models.CharField(
        max_length=500,
        db_index=True,
        help_text="Unique signature encoding attribute values (e.g., 'storage=1TB|edition=Digital')"
    )
    title = models.CharField(
        max_length=255,
        help_text="Human-readable variant title / box name",
        null=False,   # matches DB NOT NULL
        blank=False
    )

    attribute_values = models.ManyToManyField(
        AttributeValue,
        through='VariantAttributeValue',
        related_name='variants'
    )

    class Meta:
        db_table = 'pricing_variant'
        indexes = [
            models.Index(fields=['product', 'condition_grade']),
            models.Index(fields=['cex_sku']),
            models.Index(fields=['current_price_gbp']),
        ]

    def get_applicable_rule(self):
        """Return the most-specific PricingRule that applies to this variant, or None."""
        # 1️⃣ Product-level rule
        rule = PricingRule.objects.filter(product=self.product).first()
        if rule:
            return rule

        # 2️⃣ Category-level rules (walk up the tree)
        for category in self.product.category.iter_ancestors():
            rule = PricingRule.objects.filter(category=category).first()
            if rule:
                return rule

        # 3️⃣ Global default
        return PricingRule.objects.filter(is_global_default=True).first()

    def get_target_sell_price(self):
        rule = self.get_applicable_rule()
        if rule is None:
            return None
        return (self.current_price_gbp * rule.sell_price_multiplier).quantize(
            Decimal('0.01')
        )




    def __str__(self):
        return f"{self.product.name} ({self.condition_grade.code}) - {self.cex_sku}"
    



class VariantAttributeValue(models.Model):
    """
    Bridge table that applies attribute values to variants.
    This is where storage, edition, colour, etc. actually attach.
    """
    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name='variant_attribute_values',
        db_column='variant_id'
    )
    attribute_value = models.ForeignKey(
        AttributeValue,
        on_delete=models.CASCADE,
        related_name='variant_attribute_values',
        db_column='attribute_value_id'
    )

    class Meta:
        db_table = 'pricing_variant_attribute_value'
        unique_together = [['variant', 'attribute_value']]
        indexes = [
            models.Index(fields=['variant', 'attribute_value']),
        ]

    def __str__(self):
        return f"{self.variant.cex_sku} - {self.attribute_value}"


class VariantPriceHistory(models.Model):
    """
    Append-only price history table.
    Preserves every observed price change.
    Never updated, only appended.
    variant.current_price_gbp mirrors the latest row.
    """
    price_history_id = models.AutoField(primary_key=True)
    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name='price_history',
        db_column='variant_id'
    )
    price_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text="Price in GBP at this point in time"
    )
    recorded_at = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        help_text="When this price was recorded"
    )

    class Meta:
        db_table = 'pricing_variant_price_history'
        ordering = ['-recorded_at']
        indexes = [
            models.Index(fields=['variant', '-recorded_at']),
            models.Index(fields=['recorded_at']),
        ]

    def __str__(self):
        return f"{self.variant.cex_sku} - £{self.price_gbp} @ {self.recorded_at}"


class Location(models.Model):
    """
    A physical location that can hold inventory.
    """
    location_id = models.AutoField(primary_key=True)

    code = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        help_text="Stable location code (e.g., 'WARR', 'WYTH')"
    )

    name = models.CharField(
        max_length=255,
        help_text="Human-readable location name"
    )

    class Meta:
        db_table = 'pricing_location'
        verbose_name = 'Location'
        verbose_name_plural = 'Locations'
        indexes = [
            models.Index(fields=['code']),
        ]

    def __str__(self):
        return self.name


class VariantInventory(models.Model):
    """
    Current inventory levels for a variant at a specific location.
    """
    inventory_id = models.AutoField(primary_key=True)

    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name='inventory',
        db_column='variant_id'
    )

    location = models.ForeignKey(
        Location,
        on_delete=models.CASCADE,
        related_name='inventory',
        db_column='location_id'
    )

    quantity_on_hand = models.PositiveIntegerField(
        default=0,
        help_text="Physical stock currently held"
    )

    quantity_reserved = models.PositiveIntegerField(
        default=0,
        help_text="Stock reserved for orders but not yet fulfilled"
    )

    last_updated = models.DateTimeField(
        auto_now=True,
        help_text="When this inventory row was last updated"
    )

    class Meta:
        db_table = 'pricing_variant_inventory'
        unique_together = [['variant', 'location']]
        indexes = [
            models.Index(fields=['variant', 'location']),
            models.Index(fields=['location']),
        ]

    def __str__(self):
        return f"{self.variant.cex_sku} @ {self.location.code} ({self.quantity_on_hand})"


class InventoryUnit(models.Model):
    """
    Represents a single physical item/unit in inventory.
    One row = one real-world object.
    """
    item_id = models.AutoField(primary_key=True)

    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name='items',
        db_column='variant_id'
    )

    location = models.ForeignKey(
        Location,
        on_delete=models.CASCADE,
        related_name='items',
        db_column='location_id'
    )

    serial_number = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        help_text="Optional serial number or IMEI"
    )

    acquired_at = models.DateTimeField(
        default=timezone.now,
        help_text="When this item was acquired"
    )

    is_sellable = models.BooleanField(
        default=True,
        help_text="Whether this specific item can currently be sold"
    )

    notes = models.TextField(
        blank=True,
        help_text="Free-form notes about this unit"
    )

    tradein = models.OneToOneField(
        "TradeIn",
        on_delete=models.PROTECT,
        related_name="inventory_unit",
        help_text="Trade-in that created this physical item"
    )


    class Meta:
        db_table = 'pricing_inventory_item'
        indexes = [
            models.Index(fields=['variant', 'location']),
            models.Index(fields=['serial_number']),
            models.Index(fields=['is_sellable']),
        ]

    def __str__(self):
        return f"Item {self.item_id} - {self.variant.cex_sku}"



class VariantStatus(models.Model):
    """
    Status tracking for variants.
    Avoids deleting history when CeX delists items.
    Keeps variants stable even when unavailable.
    """
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('DELISTED', 'Delisted'),
        ('DISCONTINUED', 'Discontinued'),
    ]

    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name='status_history',
        db_column='variant_id'
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        db_index=True
    )
    effective_from = models.DateTimeField(
        db_index=True,
        help_text="When this status became effective"
    )

    class Meta:
        db_table = 'pricing_variant_status'
        ordering = ['-effective_from']
        indexes = [
            models.Index(fields=['variant', '-effective_from']),
            models.Index(fields=['status', 'effective_from']),
        ]

    def __str__(self):
        return f"{self.variant.cex_sku} - {self.status} from {self.effective_from}"


class Customer(models.Model):
    customer_id = models.AutoField(primary_key=True)

    name = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=50, db_index=True, unique=True)
    email = models.EmailField(max_length=255, unique=True, blank=True, null=True)
    address = models.TextField(blank=True)
    is_temp_staging = models.BooleanField(default=False)
    nospos_customer_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        unique=True,
        db_index=True,
        help_text="NoSpos customer id from profile URL (e.g. /customer/33757/view)",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def cancel_rate(self):
        from django.db.models import Q, Subquery, OuterRef
        
        total_requests = self.requests.count()
        if total_requests == 0:
            return 0.0
        
        # Get the latest status for each request
        # Note: CANCELLED status has been removed, so cancel_rate is always 0
        return 0.0
    

    def __str__(self):  
        return self.name


    class Meta:
        db_table = "buying_customer"


class RequestIntent(models.TextChoices):
    BUYBACK = "BUYBACK"
    DIRECT_SALE = "DIRECT_SALE"
    STORE_CREDIT = "STORE_CREDIT"


class Request(models.Model):
    request_id = models.AutoField(primary_key=True)

    customer = models.ForeignKey(
        "Customer",
        on_delete=models.CASCADE,
        related_name="requests"
    )

    intent = models.CharField(
        max_length=20,
        choices=RequestIntent.choices
    )

    created_at = models.DateTimeField(auto_now_add=True)

    overall_expectation_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Overall expectation for the request"
    )

    negotiated_grand_total_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Grand total of all negotiated item prices in GBP"
    )

    target_offer_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Target grand total offer in GBP"
    )

    customer_enrichment_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Enriched customer data from NoSpos (rates, dates, etc.) for display in buyer UI"
    )

    current_jewellery_reference_snapshot = models.ForeignKey(
        "RequestJewelleryReferenceSnapshot",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="active_for_requests",
        help_text="Currently selected jewellery reference snapshot for this request",
    )

    park_agreement_state_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Park agreement: NosPos items URL, excluded line ids, progress modal snapshot (in-store testing)",
    )

    def __str__(self):
        # This will show "Request #101 - John Doe (BUYBACK)"
        return f"Request #{self.request_id} - {self.customer.name} ({self.intent})"
    
    class Meta:
        db_table = "buying_request"


class RequestItem(models.Model):
    request_item_id = models.AutoField(primary_key=True)

    request = models.ForeignKey(
        Request,
        on_delete=models.CASCADE,
        related_name="items"
    )

    variant = models.ForeignKey(
        "Variant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Resolved variant after identification"
    )

    # Renamed to match request's naming convention
    expectation_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Expectation for this item"
    )

    cex_reference_json = models.JSONField(
        null=True,
        blank=True,
        help_text="CeX reference bundle (pricing strip, images) attached to this line when eBay/CC research is saved",
    )
    cex_line_snapshot_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Full 'Add from CeX' product payload when the line is a custom CeX item (non-catalog)",
    )
    line_metadata_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Negotiation UI metadata (display_title, display_subtitle, etc.)",
    )

    quantity = models.PositiveIntegerField(
        default=1,
        help_text="Quantity of this item in the request"
    )
    manual_offer_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="Manually entered offer price for this item"
    )
    customer_expectation_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="Customer's expected price for this item"
    )
    negotiated_price_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="Final negotiated price for this item after selection"
    )

    notes = models.TextField(blank=True)

    # Historical prices at the time of negotiation, denormalized from Variant
    cex_buy_cash_at_negotiation = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="CeX Buy (Cash) price at negotiation time"
    )
    cex_buy_voucher_at_negotiation = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text="CeX Buy (Voucher) price at negotiation time"
    )
    cex_sell_at_negotiation = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text="CeX Sell price at negotiation time"
    )
    our_sale_price_at_negotiation = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text="Our calculated sale price at the time of negotiation"
    )

    manual_offer_used = models.BooleanField(
        default=False,
        help_text="True if a manual offer was set using the manual offer tool"
    )
    testing_passed = models.BooleanField(
        default=False,
        help_text="In-store testing passed for this line (BOOKED_FOR_TESTING workflow)",
    )
    senior_mgmt_approved_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="request_item_senior_approvals",
    )

    class Meta:
        db_table = "buying_request_item"


class RequestItemOfferType(models.TextChoices):
    CASH = "CASH", "Cash"
    VOUCHER = "VOUCHER", "Voucher"
    MANUAL = "MANUAL", "Manual"


class RequestItemOffer(models.Model):
    """
    Normalized offer rows for request-item negotiation.
    JSON snapshots remain for compatibility; this table supports FK-safe selection/reporting.
    """

    request_item_offer_id = models.BigAutoField(primary_key=True)
    request_item = models.ForeignKey(
        RequestItem,
        on_delete=models.CASCADE,
        related_name="offer_rows",
    )
    offer_type = models.CharField(
        max_length=16,
        choices=RequestItemOfferType.choices,
        db_index=True,
    )
    offer_code = models.CharField(
        max_length=50,
        help_text="Stable offer identifier (e.g. cash_1, voucher_2, manual)",
    )
    title = models.CharField(max_length=128, blank=True)
    offer_slot = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Optional offer tier/position (1,2,3)",
    )
    price_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    margin_pct = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
    )
    is_highlighted = models.BooleanField(default=False)
    is_selected = models.BooleanField(default=False, db_index=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "buying_request_item_offer"
        indexes = [
            models.Index(fields=["request_item", "offer_type", "sort_order"]),
            models.Index(fields=["request_item", "offer_code"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["request_item", "offer_code"],
                name="uniq_request_item_offer_code",
            ),
            models.UniqueConstraint(
                fields=["request_item"],
                condition=Q(is_selected=True),
                name="uniq_selected_offer_per_request_item",
            ),
        ]


class JewelleryWeightInputUnit(models.TextChoices):
    GRAMS = "g", "Grams"
    KILOGRAMS = "kg", "Kilograms"
    EACH = "each", "Each"


class JewelleryMeasurementSource(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    SCALE = "SCALE", "Scale"
    IMPORTED = "IMPORTED", "Imported"
    ESTIMATED = "ESTIMATED", "Estimated"


class JewelleryHallmarkStatus(models.TextChoices):
    UNKNOWN = "UNKNOWN", "Unknown"
    PRESENT = "PRESENT", "Present"
    ABSENT = "ABSENT", "Absent"
    UNREADABLE = "UNREADABLE", "Unreadable"


class RequestItemJewellery(models.Model):
    """
    Jewellery-specific request-line snapshot.
    Stores intake/negotiation measurements without overloading RequestItem JSON.
    """
    request_item = models.OneToOneField(
        RequestItem,
        on_delete=models.CASCADE,
        related_name="jewellery",
        db_column="request_item_id",
        primary_key=True,
    )
    inventory_unit = models.ForeignKey(
        "InventoryUnit",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="request_item_jewellery_rows",
        help_text="Optional linked inventory unit once this request line is booked into stock",
    )
    material_grade = models.ForeignKey(
        "AttributeValue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="request_item_jewellery_rows",
        db_column="material_grade_attribute_value_id",
        help_text="Material/purity grade (expected to reference the jewellery material_grade attribute)",
    )
    measured_gross_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.001"))],
        help_text="Canonical gross weight in grams used for valuation",
    )
    measured_net_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        help_text="Optional net precious-metal weight in grams",
    )
    measured_stone_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        help_text="Optional stone/non-metal deduction in grams",
    )
    input_weight_value = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        help_text="Original entered weight value before normalization",
    )
    input_weight_unit = models.CharField(
        max_length=10,
        choices=JewelleryWeightInputUnit.choices,
        default=JewelleryWeightInputUnit.GRAMS,
        help_text="Original entry unit from UI/input form",
    )
    measurement_source = models.CharField(
        max_length=20,
        choices=JewelleryMeasurementSource.choices,
        default=JewelleryMeasurementSource.MANUAL,
        db_index=True,
        help_text="How this jewellery measurement was captured",
    )
    measured_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="request_item_jewellery_measurements",
    )
    measured_at = models.DateTimeField(
        default=timezone.now,
        db_index=True,
        help_text="When this request-line jewellery measurement was captured",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "buying_request_item_jewellery"
        indexes = [
            models.Index(fields=["material_grade", "measured_gross_weight_grams"]),
            models.Index(fields=["measured_at"]),
            models.Index(fields=["measurement_source"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(measured_gross_weight_grams__isnull=True) | Q(measured_gross_weight_grams__gt=0),
                name="req_item_jewellery_gross_weight_gt_zero",
            ),
            models.CheckConstraint(
                condition=Q(measured_net_weight_grams__isnull=True) | Q(measured_net_weight_grams__gte=0),
                name="req_item_jewellery_net_weight_gte_zero",
            ),
            models.CheckConstraint(
                condition=Q(measured_stone_weight_grams__isnull=True) | Q(measured_stone_weight_grams__gte=0),
                name="req_item_jewellery_stone_weight_gte_zero",
            ),
            models.CheckConstraint(
                condition=(
                    Q(measured_net_weight_grams__isnull=True)
                    | Q(measured_gross_weight_grams__isnull=True)
                    | Q(measured_net_weight_grams__lte=F("measured_gross_weight_grams"))
                ),
                name="req_item_jewellery_net_lte_gross",
            ),
            models.CheckConstraint(
                condition=(
                    Q(measured_stone_weight_grams__isnull=True)
                    | Q(measured_gross_weight_grams__isnull=True)
                    | Q(measured_stone_weight_grams__lte=F("measured_gross_weight_grams"))
                ),
                name="req_item_jewellery_stone_lte_gross",
            ),
        ]


class RequestItemJewelleryValuation(models.Model):
    """
    Append-only valuation snapshots for a jewellery request line.
    """
    valuation_id = models.BigAutoField(primary_key=True)
    request_item_jewellery = models.ForeignKey(
        RequestItemJewellery,
        on_delete=models.CASCADE,
        related_name="valuations",
        db_column="request_item_id",
    )
    valuation_source = models.CharField(
        max_length=64,
        db_index=True,
        help_text="Valuation source identifier (e.g., Mastermelt/manual/internal)",
    )
    source_reference_snapshot = models.ForeignKey(
        "RequestJewelleryReferenceSnapshot",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="valuations",
        help_text="Optional request-level reference snapshot used for this valuation",
    )
    rate_per_gram_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.0000"))],
    )
    unit_price_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.0000"))],
    )
    basis_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        help_text="Weight basis used in this valuation snapshot",
    )
    computed_total_gbp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
        help_text="Computed valuation total for this snapshot",
    )
    valuation_payload_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Raw valuation payload for reproducibility/audit",
    )
    is_selected = models.BooleanField(
        default=False,
        db_index=True,
        help_text="True when this valuation is currently selected for the request line",
    )
    selected_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "buying_request_item_jewellery_valuation"
        indexes = [
            models.Index(fields=["request_item_jewellery", "-created_at"]),
            models.Index(fields=["valuation_source", "-created_at"]),
            models.Index(fields=["computed_total_gbp"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["request_item_jewellery"],
                condition=Q(is_selected=True),
                name="uniq_selected_jewellery_valuation_per_request_item",
            ),
            models.CheckConstraint(
                condition=Q(computed_total_gbp__gte=0),
                name="req_item_jewellery_valuation_total_gte_zero",
            ),
        ]


class RequestJewelleryReferenceSnapshot(models.Model):
    """
    Historical jewellery reference scrape snapshots at request level.
    Request.current_jewellery_reference_snapshot points to the active one.
    """
    snapshot_id = models.BigAutoField(primary_key=True)
    request = models.ForeignKey(
        Request,
        on_delete=models.CASCADE,
        related_name="jewellery_reference_history",
    )
    source_name = models.CharField(
        max_length=100,
        blank=True,
        default="Mastermelt",
        help_text="Human-readable source system name",
    )
    source_url = models.URLField(max_length=2000, blank=True, default="")
    scraped_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sections_json = models.JSONField(
        help_text="Normalized jewellery reference sections payload",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    created_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="jewellery_reference_snapshots",
    )

    class Meta:
        db_table = "buying_request_jewellery_reference_snapshot"
        indexes = [
            models.Index(fields=["request", "-created_at"]),
            models.Index(fields=["request", "-scraped_at"]),
        ]

class InventoryUnitJewellery(models.Model):
    """
    Canonical jewellery measurements for a physical stock unit.
    Query this table for inventory-by-weight/material operations.
    """
    inventory_unit = models.OneToOneField(
        InventoryUnit,
        on_delete=models.CASCADE,
        related_name="jewellery",
        db_column="inventory_item_id",
        primary_key=True,
    )
    material_grade = models.ForeignKey(
        "AttributeValue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_jewellery_rows",
        db_column="material_grade_attribute_value_id",
        help_text="Material/purity grade used for stock reporting and filtering",
    )
    gross_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(Decimal("0.001"))],
        db_index=True,
        help_text="Canonical gross stock weight in grams",
    )
    net_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        db_index=True,
        help_text="Optional net precious-metal weight in grams",
    )
    stone_weight_grams = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.000"))],
        help_text="Optional stone/non-metal deduction in grams",
    )
    hallmark_status = models.CharField(
        max_length=20,
        choices=JewelleryHallmarkStatus.choices,
        default=JewelleryHallmarkStatus.UNKNOWN,
        db_index=True,
    )
    measurement_source = models.CharField(
        max_length=20,
        choices=JewelleryMeasurementSource.choices,
        default=JewelleryMeasurementSource.MANUAL,
        db_index=True,
        help_text="How this stock-unit jewellery measurement was captured",
    )
    source_request_item = models.ForeignKey(
        RequestItemJewellery,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_units_created",
        help_text="Optional provenance link back to the request-line jewellery snapshot",
    )
    measured_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_jewellery_measurements",
    )
    measured_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pricing_inventory_item_jewellery"
        indexes = [
            models.Index(fields=["material_grade", "gross_weight_grams"]),
            models.Index(fields=["gross_weight_grams"]),
            models.Index(fields=["net_weight_grams"]),
            models.Index(fields=["hallmark_status"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(gross_weight_grams__gt=0),
                name="inventory_jewellery_gross_weight_gt_zero",
            ),
            models.CheckConstraint(
                condition=Q(net_weight_grams__isnull=True) | Q(net_weight_grams__gte=0),
                name="inventory_jewellery_net_weight_gte_zero",
            ),
            models.CheckConstraint(
                condition=Q(stone_weight_grams__isnull=True) | Q(stone_weight_grams__gte=0),
                name="inventory_jewellery_stone_weight_gte_zero",
            ),
            models.CheckConstraint(
                condition=Q(net_weight_grams__isnull=True) | Q(net_weight_grams__lte=F("gross_weight_grams")),
                name="inventory_jewellery_net_lte_gross",
            ),
            models.CheckConstraint(
                condition=Q(stone_weight_grams__isnull=True) | Q(stone_weight_grams__lte=F("gross_weight_grams")),
                name="inventory_jewellery_stone_lte_gross",
            ),
        ]


class RepricingSessionStatus(models.TextChoices):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class RepricingSession(models.Model):
    repricing_session_id = models.AutoField(primary_key=True)
    cart_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    item_count = models.PositiveIntegerField(default=0)
    barcode_count = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=RepricingSessionStatus.choices,
        default=RepricingSessionStatus.IN_PROGRESS,
        db_index=True,
    )
    session_data = models.JSONField(
        null=True,
        blank=True,
        help_text="Full frontend state for resuming in-progress sessions (items, barcodes, lookups, research)"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pricing_repricing_session"
        ordering = ["-created_at"]


class AbstractStockSessionLine(models.Model):
    """
    Persisted NoSPos stock line shared by repricing and upload modules (barcode → verified stock, prices).
    RequestItem stays separate: buying flow uses different columns and jewellery tables.
    """

    item_identifier = models.CharField(max_length=100, blank=True, default="")
    title = models.CharField(max_length=255, blank=True, default="")
    quantity = models.PositiveIntegerField(default=1)
    barcode = models.CharField(max_length=255, db_index=True)
    stock_barcode = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stock_url = models.URLField(
        max_length=500,
        blank=True,
        default="",
        help_text="Link to the stock page in NoSPos / stock system",
    )
    old_retail_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    new_retail_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    cex_sell_at_repricing = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
        help_text="CeX sell snapshot at workflow time (repricing or upload)",
    )
    our_sale_price_at_repricing = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
        help_text="Our sale / new retail input at workflow time (repricing or upload)",
    )

    class Meta:
        abstract = True


class RepricingSessionItem(AbstractStockSessionLine):
    repricing_session_item_id = models.AutoField(primary_key=True)
    repricing_session = models.ForeignKey(
        RepricingSession,
        on_delete=models.CASCADE,
        related_name="items",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pricing_repricing_session_item"
        ordering = ["repricing_session_item_id"]


class UploadSessionMode(models.TextChoices):
    NEW = "NEW", "New products"
    AUDIT = "AUDIT", "Audit existing products"


class UploadSession(models.Model):
    """Upload module: same session shape as repricing, separate persistence."""

    upload_session_id = models.AutoField(primary_key=True)
    cart_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    item_count = models.PositiveIntegerField(default=0)
    barcode_count = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=RepricingSessionStatus.choices,
        default=RepricingSessionStatus.IN_PROGRESS,
        db_index=True,
    )
    mode = models.CharField(
        max_length=10,
        choices=UploadSessionMode.choices,
        default=UploadSessionMode.NEW,
        db_index=True,
    )
    session_data = models.JSONField(
        null=True,
        blank=True,
        help_text="Full frontend state for resuming upload sessions (items, barcodes, lookups, research)",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pricing_upload_session"
        ordering = ["-created_at"]


class UploadSessionItem(AbstractStockSessionLine):
    upload_session_item_id = models.AutoField(primary_key=True)
    upload_session = models.ForeignKey(
        UploadSession,
        on_delete=models.CASCADE,
        related_name="items",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pricing_upload_session_item"
        ordering = ["upload_session_item_id"]


class MarketResearchPlatform(models.TextChoices):
    EBAY = "EBAY", "eBay"
    CASH_CONVERTERS = "CASH_CONVERTERS", "Cash Converters"
    CASH_GENERATOR = "CASH_GENERATOR", "Cash Generator"


class MarketResearchSession(models.Model):
    """
    Normalized market research snapshot (eBay, Cash Converters, or Cash Generator) for a buying line or repricing line.
    Query listings via MarketResearchListing; session-level stats are indexed columns.
    """

    session_id = models.BigAutoField(primary_key=True)
    platform = models.CharField(max_length=32, choices=MarketResearchPlatform.choices, db_index=True)

    request_item = models.ForeignKey(
        RequestItem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="market_research_sessions",
    )
    repricing_session_item = models.ForeignKey(
        RepricingSessionItem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="market_research_sessions",
    )
    upload_session_item = models.ForeignKey(
        UploadSessionItem,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="market_research_sessions",
    )

    search_term = models.CharField(max_length=500, blank=True, default="")
    listing_page_url = models.URLField(max_length=2000, blank=True, default="")
    show_histogram = models.BooleanField(default=False)
    manual_offer_text = models.CharField(max_length=64, blank=True, default="")
    selected_offer_index = models.CharField(max_length=32, blank=True, null=True)

    stat_average_gbp = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True, db_index=True
    )
    stat_median_gbp = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True, db_index=True
    )
    stat_suggested_sale_gbp = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True, db_index=True
    )

    advanced_filter_state = models.JSONField(null=True, blank=True)
    filter_state_json = models.JSONField(
        null=True,
        blank=True,
        help_text="selectedFilters, filterOptions-as-captured from the research form",
    )
    buy_offers_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Snapshot of calculated buy offers at save time (pctOfSale, price)",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pricing_market_research_session"
        constraints = [
            models.CheckConstraint(
                condition=(
                    (
                        Q(request_item__isnull=False)
                        & Q(repricing_session_item__isnull=True)
                        & Q(upload_session_item__isnull=True)
                    )
                    | (
                        Q(request_item__isnull=True)
                        & Q(repricing_session_item__isnull=False)
                        & Q(upload_session_item__isnull=True)
                    )
                    | (
                        Q(request_item__isnull=True)
                        & Q(repricing_session_item__isnull=True)
                        & Q(upload_session_item__isnull=False)
                    )
                ),
                name="market_research_session_parent_xor",
            ),
            models.UniqueConstraint(
                fields=["request_item", "platform"],
                condition=Q(request_item__isnull=False),
                name="uniq_request_item_market_research_platform",
            ),
            models.UniqueConstraint(
                fields=["repricing_session_item", "platform"],
                condition=Q(repricing_session_item__isnull=False),
                name="uniq_repricing_item_market_research_platform",
            ),
            models.UniqueConstraint(
                fields=["upload_session_item", "platform"],
                condition=Q(upload_session_item__isnull=False),
                name="uniq_upload_session_item_market_research_platform",
            ),
        ]


class MarketResearchDrillLevel(models.Model):
    drill_id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(
        MarketResearchSession,
        on_delete=models.CASCADE,
        related_name="drill_levels",
    )
    level_index = models.PositiveSmallIntegerField()
    min_gbp = models.DecimalField(max_digits=12, decimal_places=4)
    max_gbp = models.DecimalField(max_digits=12, decimal_places=4)
    segments_json = models.JSONField(
        null=True,
        blank=True,
        help_text="When set, OR of [{min, max}, ...] price bands (multi-zoom). min_gbp/max_gbp store the envelope.",
    )

    class Meta:
        db_table = "pricing_market_research_drill_level"
        ordering = ["level_index"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "level_index"],
                name="uniq_research_drill_session_level",
            ),
        ]


class MarketResearchListing(models.Model):
    listing_id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(
        MarketResearchSession,
        on_delete=models.CASCADE,
        related_name="listings",
    )
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    client_row_id = models.CharField(max_length=128, blank=True, default="")
    external_item_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    title = models.TextField(blank=True, default="")
    price_gbp = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, db_index=True)
    listing_url = models.URLField(max_length=2000, blank=True, default="")
    image_url = models.URLField(max_length=2000, blank=True, default="")
    excluded = models.BooleanField(default=False, db_index=True)
    sold_text = models.CharField(max_length=256, blank=True, default="")
    shop_name = models.CharField(max_length=256, blank=True, default="")
    seller_info = models.TextField(blank=True, default="")
    extra = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "pricing_market_research_listing"
        ordering = ["sort_order", "listing_id"]


class RequestStatus(models.TextChoices):
    QUOTE = "QUOTE"
    BOOKED_FOR_TESTING = "BOOKED_FOR_TESTING"
    COMPLETE = "COMPLETE"


class RequestStatusHistory(models.Model):
    request = models.ForeignKey(
        Request,
        on_delete=models.CASCADE,
        related_name="status_history"
    )

    status = models.CharField(
        max_length=30,
        choices=RequestStatus.choices
    )

    effective_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "buying_request_status"
        ordering = ["-effective_at"]


class TradeInOutcome(models.TextChoices):
    BUYBACK = "BUYBACK"
    DIRECT_SALE = "DIRECT_SALE"


class TradeIn(models.Model):
    tradein_id = models.AutoField(primary_key=True)

    request_item = models.OneToOneField(
        RequestItem,
        on_delete=models.CASCADE,
        related_name="tradein"
    )

    final_offer_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))]
    )

    outcome = models.CharField(
        max_length=20,
        choices=TradeInOutcome.choices
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "buying_tradein"


class AgreementType(models.TextChoices):
    DIRECT_SALE = "DIRECT_SALE"
    BUYBACK = "BUYBACK"


class AgreementStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    EXERCISED = "EXERCISED"
    EXPIRED = "EXPIRED"
    COMPLETED = "COMPLETED"


class Agreement(models.Model):
    agreement_id = models.AutoField(primary_key=True)

    tradein = models.OneToOneField(
        TradeIn,
        on_delete=models.CASCADE,
        related_name="agreement"
    )

    agreement_type = models.CharField(
        max_length=20,
        choices=AgreementType.choices
    )

    status = models.CharField(
        max_length=20,
        choices=AgreementStatus.choices,
        default=AgreementStatus.ACTIVE
    )

    signed_at = models.DateTimeField(default=timezone.now)

    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Only for buyback agreements"
    )

    buyback_repurchase_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True
    )

    class Meta:
        db_table = "buying_agreement"


class InventoryOwnershipEventType(models.TextChoices):
    ACQUIRED_DIRECT = "ACQUIRED_DIRECT"
    BUYBACK_STARTED = "BUYBACK_STARTED"
    BUYBACK_EXERCISED = "BUYBACK_EXERCISED"
    BUYBACK_EXPIRED = "BUYBACK_EXPIRED"


class InventoryOwnershipEvent(models.Model):
    inventory_unit = models.ForeignKey(
        InventoryUnit,
        on_delete=models.CASCADE,
        related_name="ownership_events"
    )

    event_type = models.CharField(
        max_length=30,
        choices=InventoryOwnershipEventType.choices
    )

    event_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "inventory_ownership_event"


# ─── Customer Offer Rules ──────────────────────────────────────────────────────

class CustomerRuleSettings(models.Model):
    """
    Global settings for cancel-rate tier thresholds.
    Intended as a singleton — only one row should ever exist (id=1).
    """

    low_cr_max_pct = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=Decimal('20.00'),
        help_text=(
            "Upper bound (inclusive) for the 'Low Cancel Rate' tier. "
            "Customers with cancel rate ≤ this value are classified as Low CR."
        )
    )

    mid_cr_max_pct = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=Decimal('40.00'),
        help_text=(
            "Upper bound (inclusive) for the 'Mid Cancel Rate' tier. "
            "Customers with cancel rate between Low CR max and this value are Mid CR; "
            "above this value is High CR."
        )
    )

    jewellery_offer_margin_1_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('30.00'),
        help_text="Jewellery 1st offer margin % vs reference total."
    )
    jewellery_offer_margin_2_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('20.00'),
        help_text="Jewellery 2nd offer margin % vs reference total."
    )
    jewellery_offer_margin_3_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('10.00'),
        help_text="Jewellery 3rd offer margin % vs reference total."
    )
    jewellery_offer_margin_4_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('5.00'),
        help_text="Jewellery 4th offer margin % vs reference total."
    )

    class Meta:
        db_table = 'buying_customer_rule_settings'
        verbose_name = 'Customer Rule Settings'

    def __str__(self):
        return (
            f"CR Thresholds: Low ≤{self.low_cr_max_pct}%, Mid ≤{self.mid_cr_max_pct}%, "
            f"High >{self.mid_cr_max_pct}% | Jewellery margins: "
            f"{self.jewellery_offer_margin_1_pct}/{self.jewellery_offer_margin_2_pct}/"
            f"{self.jewellery_offer_margin_3_pct}/{self.jewellery_offer_margin_4_pct}"
        )

    @classmethod
    def get_singleton(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class CustomerOfferRule(models.Model):
    """
    Defines which offer slots are allowed without senior-management authorisation
    for a given customer type (new customer, low/mid/high cancel rate).
    """

    CUSTOMER_TYPE_CHOICES = [
        ('new_customer', 'New Customer'),
        ('low_cr', 'Low Cancel Rate'),
        ('mid_cr', 'Mid Cancel Rate'),
        ('high_cr', 'High Cancel Rate'),
    ]

    customer_type = models.CharField(
        max_length=20,
        choices=CUSTOMER_TYPE_CHOICES,
        unique=True,
        help_text="The customer classification this rule applies to."
    )

    allow_offer_1 = models.BooleanField(
        default=True,
        help_text="Whether the 1st Offer slot can be selected without authorisation."
    )
    allow_offer_2 = models.BooleanField(
        default=True,
        help_text="Whether the 2nd Offer slot can be selected without authorisation."
    )
    allow_offer_3 = models.BooleanField(
        default=True,
        help_text="Whether the 3rd Offer slot can be selected without authorisation."
    )
    allow_offer_4 = models.BooleanField(
        default=True,
        help_text="Whether the 4th Offer slot can be selected without authorisation."
    )
    allow_manual = models.BooleanField(
        default=True,
        help_text="Whether a manual offer entry is allowed without authorisation."
    )

    class Meta:
        db_table = 'buying_customer_offer_rule'
        verbose_name = 'Customer Offer Rule'
        verbose_name_plural = 'Customer Offer Rules'

    def __str__(self):
        return f"Offer rule for {self.get_customer_type_display()}"


class NosposCategoryMapping(models.Model):
    """
    User-configured mapping from an internal ProductCategory to a NoSpos
    category path string.  The nospos_path uses ' > ' as a hierarchy delimiter,
    e.g. 'Gaming > Consoles > Sony > PlayStation5'.
    """

    category = models.OneToOneField(
        ProductCategory,
        on_delete=models.CASCADE,
        related_name='nospos_category_mapping',
        help_text="Internal category being mapped.",
    )
    nospos_path = models.CharField(
        max_length=500,
        help_text="NoSpos path using '>' as delimiter, e.g. 'Gaming > Consoles > Sony > PlayStation5'.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'nospos_category_mapping'
        verbose_name = 'NoSpos Category Mapping'
        verbose_name_plural = 'NoSpos Category Mappings'
        ordering = ['category__name']

    def __str__(self):
        return f"{self.category.name} → {self.nospos_path}"


class NosposCategory(models.Model):
    """
    Stock category row mirrored from NosPos /stock/category/index (extension scrape).
    Parent is derived from full_name hierarchy (… > parent > child); roots have parent=None.
    """

    nospos_id = models.PositiveIntegerField(
        unique=True,
        db_index=True,
        help_text="Category id from NosPos (grid data-key / #column).",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children",
    )
    level = models.PositiveSmallIntegerField(
        help_text="Depth from NosPos (0 = root, 1 = child, …).",
    )
    full_name = models.CharField(
        max_length=1024,
        help_text="Full path as shown in NosPos, using ' > ' between segments.",
    )
    status = models.CharField(max_length=32, blank=True, help_text="e.g. Active / Inactive")
    buyback_rate = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Optional buy-back rate (populated when available).",
    )
    offer_rate = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Optional offer rate (populated when available).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nosposcategory"
        verbose_name = "NosPos category"
        verbose_name_plural = "NosPos categories"
        ordering = ["level", "full_name"]

    def __str__(self):
        return f"{self.full_name} (#{self.nospos_id})"


class NosposField(models.Model):
    """
    Global NosPos stock field label from CategoryFieldForm (scraped via /stock/category/modify for convenience).
    """

    nospos_field_id = models.PositiveIntegerField(
        unique=True,
        db_index=True,
        help_text="Field id from CategoryFieldForm[X] in the form.",
    )
    name = models.CharField(max_length=512)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nosposfield"
        verbose_name = "NosPos field"
        verbose_name_plural = "NosPos fields"
        ordering = ["nospos_field_id"]

    def __str__(self):
        return f"{self.name} (#{self.nospos_field_id})"


class NosposCategoryField(models.Model):
    """
    Per-category assignment of a global NosPos field with checkbox flags from /stock/category/modify.
    """

    category = models.ForeignKey(
        NosposCategory,
        on_delete=models.CASCADE,
        related_name="field_links",
    )
    field = models.ForeignKey(
        NosposField,
        on_delete=models.CASCADE,
        related_name="category_links",
    )
    active = models.BooleanField(default=False, help_text="CategoryFieldForm [checked] — field enabled for category.")
    editable = models.BooleanField(default=False)
    sensitive = models.BooleanField(default=False)
    required = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nosposcategoryfield"
        verbose_name = "NosPos category field"
        verbose_name_plural = "NosPos category fields"
        constraints = [
            models.UniqueConstraint(
                fields=["category", "field"],
                name="nosposcategoryfield_category_field_unique",
            ),
        ]

    def __str__(self):
        return f"{self.category_id}:{self.field_id} active={self.active}"
