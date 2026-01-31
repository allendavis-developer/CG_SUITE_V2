from django.core.management.base import BaseCommand
from pricing.models_v2 import ProductCategory, Product, Variant, Attribute, Manufacturer
from django.db import transaction

class Command(BaseCommand):
    help = "Log how many phone products have a manufacturer attribute set on their variants and create Manufacturer records efficiently"

    def handle(self, *args, **options):
        # 1️⃣ Get the Phones category
        try:
            phones_category = ProductCategory.objects.get(name__iexact="Android Phones")
        except ProductCategory.DoesNotExist:
            self.stdout.write(self.style.ERROR("Android Phones category not found"))
            return

        def get_all_subcategories(category):
            subcategories = [category]
            for child in category.children.all():
                subcategories.extend(get_all_subcategories(child))
            return subcategories

        all_categories = get_all_subcategories(phones_category)
        products = Product.objects.filter(category__in=all_categories).prefetch_related('variants__attribute_values')

        if not products.exists():
            self.stdout.write("No products found under Phones category")
            return

        # 3️⃣ Get the manufacturer attribute
        manufacturer_attr = Attribute.objects.filter(code="manufacturer").first()
        if not manufacturer_attr:
            self.stdout.write(self.style.ERROR("No Attribute with code='manufacturer' found"))
            return

        # 4️⃣ Collect all unique manufacturer names from product variants
        manufacturer_names_set = set()
        product_manufacturer_map = {}  # product_id -> manufacturer_name

        for product in products:
            variants = product.variants.all()
            manufacturer_name = None
            for variant in variants:
                attr_value_qs = variant.attribute_values.filter(attribute=manufacturer_attr)
                if attr_value_qs.exists():
                    manufacturer_name = attr_value_qs.first().value
                    break  # Stop at first found
            if manufacturer_name:
                manufacturer_names_set.add(manufacturer_name)
                product_manufacturer_map[product.product_id] = manufacturer_name

        # 5️⃣ Get existing manufacturers and create missing ones
        existing_manufacturers = Manufacturer.objects.filter(name__in=manufacturer_names_set)
        existing_names = set(existing_manufacturers.values_list('name', flat=True))

        # Prepare missing manufacturers for bulk_create
        missing_names = manufacturer_names_set - existing_names
        new_manufacturers = [Manufacturer(name=name) for name in missing_names]

        with transaction.atomic():
            if new_manufacturers:
                Manufacturer.objects.bulk_create(new_manufacturers)
            
            # Reload all manufacturers after creation
            all_manufacturers = Manufacturer.objects.filter(name__in=manufacturer_names_set)
            name_to_obj = {m.name: m for m in all_manufacturers}

            # 6️⃣ Assign manufacturers to products
            products_to_update = []
            products_without_manufacturer = []

            for product in products:
                manufacturer_name = product_manufacturer_map.get(product.product_id)
                if manufacturer_name:
                    manufacturer_obj = name_to_obj[manufacturer_name]
                    if product.manufacturer != manufacturer_obj:
                        product.manufacturer = manufacturer_obj
                        products_to_update.append(product)
                else:
                    products_without_manufacturer.append(product)
                    self.stdout.write(f"Missing manufacturer: {product.name} (ID {product.product_id})")

            if products_to_update:
                Product.objects.bulk_update(products_to_update, ['manufacturer'])

        # 7️⃣ Log results
        self.stdout.write(
            self.style.SUCCESS(
                f"Products with manufacturer: {len(products_to_update) + len(existing_names & set(product_manufacturer_map.values()))}\n"
                f"Products without manufacturer: {len(products_without_manufacturer)}"
            )
        )
