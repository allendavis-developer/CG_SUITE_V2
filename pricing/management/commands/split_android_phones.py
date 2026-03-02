"""
Split Android Phones into subcategories by manufacturer + product name prefix.
Products are moved into the new hierarchy.
"""

from django.core.management.base import BaseCommand

from pricing.models_v2 import Product, ProductCategory
from pricing.utils.category_tree import build_one_level_categories

ANDROID_PHONES_NAME = "Android Phones"


class Command(BaseCommand):
    help = "Split Android Phones into subcategories (manufacturer + product prefix)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without writing",
        )

    def handle(self, *args, **options):
        try:
            android_phones = ProductCategory.objects.get(name__iexact=ANDROID_PHONES_NAME)
        except ProductCategory.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Category '{ANDROID_PHONES_NAME}' not found."))
            return

        qs = Product.objects.select_related("manufacturer").filter(category=android_phones)
        products = [
            (p.product_id, f"{p.manufacturer.name} {p.name}" if p.manufacturer else p.name)
            for p in qs
        ]

        if not products:
            self.stdout.write(self.style.WARNING(f"No products in {ANDROID_PHONES_NAME}."))
            return

        tree = build_one_level_categories(products)

        if options["dry_run"]:
            for node in tree["children"]:
                self.stdout.write(f"→ {node['name']} ({len(node['products'])} products)")
            self.stdout.write(self.style.SUCCESS("Dry run. Run without --dry-run to apply."))
            return

        for node in tree["children"]:
            cat = ProductCategory.objects.create(
                parent_category=android_phones, name=node["name"]
            )
            for pid, _ in node["products"]:
                Product.objects.filter(product_id=pid).update(category=cat)

        self.stdout.write(self.style.SUCCESS("Done."))
