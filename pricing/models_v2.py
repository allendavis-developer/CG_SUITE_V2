"""
models_v2
"""

from django.db import models
from django.core.validators import MinValueValidator
from decimal import Decimal
from django.utils import timezone


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


class MovementClass(models.TextChoices):
    FAST = 'FAST', 'Fast mover'
    MEDIUM = 'MEDIUM', 'Medium mover'
    SLOW = 'SLOW', 'Slow mover'
    UNKNOWN = 'UNKNOWN', 'Unknown'


class PricingRule(models.Model):
    """
    Determines what % of CeX sale price we should sell at
    based on movement class and scope.
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

    movement_class = models.CharField(
        max_length=20,
        choices=MovementClass.choices,
        db_index=True
    )

    sell_price_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))]
    )

    class Meta:
        db_table = 'pricing_rule'
        indexes = [
            models.Index(fields=['product', 'movement_class']),
            models.Index(fields=['category', 'movement_class']),
            models.Index(fields=['is_global_default', 'movement_class']),
        ]
        constraints = [
            # Product-level uniqueness
            models.UniqueConstraint(
                fields=['product', 'movement_class'],
                condition=models.Q(product__isnull=False),
                name='uniq_product_movement_rule'
            ),

            # Category-level uniqueness
            models.UniqueConstraint(
                fields=['category', 'movement_class'],
                condition=models.Q(category__isnull=False),
                name='uniq_category_movement_rule'
            ),

            # One global default per movement class
            models.UniqueConstraint(
                fields=['movement_class'],
                condition=models.Q(is_global_default=True),
                name='uniq_global_default_movement_rule'
            ),

            # Valid scope rule
            models.CheckConstraint(
                check=(
                    models.Q(product__isnull=False) |
                    models.Q(category__isnull=False) |
                    models.Q(is_global_default=True)
                ),
                name='pricing_rule_scope_required'
            ),
        ]

    def __str__(self):
        if self.is_global_default:
            return f"GLOBAL - {self.movement_class} @ {self.sell_price_multiplier}"
        target = self.product.name if self.product else self.category.name
        return f"{target} - {self.movement_class} @ {self.sell_price_multiplier}"


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

    def get_movement_class(self):
        if not self.current_price_gbp or not self.tradein_cash:
            return MovementClass.UNKNOWN

        margin = (
            (self.current_price_gbp - self.tradein_cash)
            / self.current_price_gbp
        )

        if margin > Decimal('0.50'):
            return MovementClass.SLOW
        elif margin >= Decimal('0.40'):
            return MovementClass.MEDIUM
        else:
            return MovementClass.FAST
        
    def get_target_sell_price(self):
        movement = self.get_movement_class()

        if movement == MovementClass.UNKNOWN:
            return None

        # 1️⃣ Product-level rule
        rule = PricingRule.objects.filter(
            product=self.product,
            movement_class=movement
        ).first()

        if rule:
            return (self.current_price_gbp * rule.sell_price_multiplier).quantize(
                Decimal('0.01')
            )

        # 2️⃣ Category-level rules (walk up the tree)
        for category in self.product.category.iter_ancestors():
            rule = PricingRule.objects.filter(
                category=category,
                movement_class=movement
            ).first()
            if rule:
                return (self.current_price_gbp * rule.sell_price_multiplier).quantize(
                    Decimal('0.01')
                )

        # 3️⃣ Global default
        rule = PricingRule.objects.filter(
            is_global_default=True,
            movement_class=movement
        ).first()

        if not rule:
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
    email = models.EmailField(max_length=255, unique=True, blank=True, null=True)  # New email field
    address = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def cancel_rate(self):
        total_requests = self.requests.count()
        if total_requests == 0:
            return 0.0
        cancelled = self.requests.filter(status='CANCELLED').count()
        return round((cancelled / total_requests) * 100, 2)

    class Meta:
        db_table = "buying_customer"



class RequestIntent(models.TextChoices):
    BUYBACK = "BUYBACK"
    DIRECT_SALE = "DIRECT_SALE"
    UNKNOWN = "UNKNOWN"


class Request(models.Model):
    request_id = models.AutoField(primary_key=True)

    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="requests"
    )

    intent = models.CharField(
        max_length=20,
        choices=RequestIntent.choices,
        default=RequestIntent.UNKNOWN
    )

    created_at = models.DateTimeField(auto_now_add=True)

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
        Variant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Resolved variant after identification"
    )

    initial_expectation_gbp = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True
    )

    notes = models.TextField(blank=True)

    class Meta:
        db_table = "buying_request_item"


class RequestStatus(models.TextChoices):
    OPEN = "OPEN"
    CONTACTED = "CONTACTED"
    BOOKED_FOR_TESTING = "BOOKED_FOR_TESTING"
    TESTING_COMPLETE = "TESTING_COMPLETE"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


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
