import re
from django.db import transaction
from django.core.management.base import BaseCommand
from pricing.models_v2 import (
    ProductCategory, Product, Variant, Attribute, AttributeValue
)

CANONICAL_PRODUCTS = {
    "iPad": "iPad",
    "iPad Air": "iPad Air",
    "iPad Mini": "iPad Mini",
    "iPad Pro": "iPad Pro",
}

ATTRIBUTE_CODES = [
    "colour",
    "generation",
    "grade",
    "phone_network",
    "screensize_inches",
    "storage_GB",
]

class Command(BaseCommand):
    help = "Normalize iPad variants: assign canonical products, attributes, and signatures"

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            ipad_category = ProductCategory.objects.get(name="Apple iPad")
        except ProductCategory.DoesNotExist:
            self.stderr.write("❌ Category 'Apple iPad' not found")
            return

        # Collect all descendant categories
        categories = []
        stack = [ipad_category]
        while stack:
            category = stack.pop()
            categories.append(category)
            stack.extend(category.children.all())

        products = Product.objects.filter(category__in=categories).prefetch_related("variants").order_by("name")

        # Prepare canonical products map
        canonical_product_map = {}
        for key, name in CANONICAL_PRODUCTS.items():
            cp, _ = Product.objects.get_or_create(name=name, category=ipad_category)
            canonical_product_map[key] = cp

        # Prepare attribute map per canonical product
        attribute_map = {}
        for cp in canonical_product_map.values():
            attribute_map[cp.product_id] = {}
            for code in ATTRIBUTE_CODES:
                attr, _ = Attribute.objects.get_or_create(
                    category=cp.category,
                    code=code,
                    defaults={"label": code.replace("_", " ").title()}
                )
                attribute_map[cp.product_id][code] = attr

        # Process variants
        for product in products:
            for variant in product.variants.all():
                title = variant.title

                # 1️⃣ Determine canonical product
                sorted_keys = sorted(CANONICAL_PRODUCTS.keys(), key=len, reverse=True)
                canonical_product_name = "UNKNOWN"
                for key in sorted_keys:
                    if key.lower() in title.lower():
                        canonical_product_name = CANONICAL_PRODUCTS[key]
                        break
                canonical_product = canonical_product_map.get(canonical_product_name)
                if not canonical_product:
                    continue  # safety

                # 2️⃣ Extract attributes
                attrs = {
                    "colour": None,
                    "generation": None,
                    "grade": None,
                    "phone_network": None,
                    "screensize_inches": None,
                    "storage_GB": None
                }

                grade_match = re.search(r'\b([ABCDF])\b$', title)
                if grade_match:
                    attrs["grade"] = grade_match.group(1)

                storage_match = re.search(r'(\d+(?:GB|TB))', title)
                if storage_match:
                    attrs["storage_GB"] = storage_match.group(1)

                screensize_match = re.search(r'(\d+(?:\.\d+)?)["“]', title)
                if screensize_match:
                    attrs["screensize_inches"] = screensize_match.group(1)

                network_match = re.search(r'\b(EE|O2|Vodafone|Unlocked|WiFi|International)\b', title, re.IGNORECASE)
                if network_match:
                    attrs["phone_network"] = network_match.group(1)

                gen_match = re.search(r'((?:\d+(?:st|nd|rd|th) Gen)|M\d+)', title)
                if gen_match:
                    attrs["generation"] = gen_match.group(1)

                colour_match = re.search(r'[-–]\s*([^,]+?),', title)
                if not colour_match:
                    colour_match = re.search(r'(.+?)\s+(?:EE|O2|Vodafone|Unlocked|WiFi|International)\b', title)
                if colour_match:
                    attrs["colour"] = colour_match.group(1).strip()

                # 3️⃣ Update variant
                variant.product = canonical_product
                variant.save()

                # 4️⃣ Remove old attribute links
                variant.attribute_values.clear()

                # 5️⃣ Assign new AttributeValues
                signature_parts = []
                for code, value in attrs.items():
                    if value is None:
                        continue
                    attr = attribute_map[canonical_product.product_id][code]
                    av, _ = AttributeValue.objects.get_or_create(attribute=attr, value=value)
                    variant.attribute_values.add(av)
                    signature_parts.append(f"{code}={value}")

                # 6️⃣ Update variant signature
                variant.variant_signature = "|".join(signature_parts)
                variant.save()

                # 7️⃣ Print result
                print(f"{title} | canonical_product={canonical_product_name} | " +
                      " | ".join(f"{k}={v}" for k, v in attrs.items()))
