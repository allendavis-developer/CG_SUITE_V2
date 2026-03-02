"""
Rename products that follow the pattern "Product {cex_sku}" to the variant's title.
Used to fix products that were created without a proper name during import.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from pricing.models_v2 import Product, Variant


class Command(BaseCommand):
    help = "Rename products named 'Product {code}' to the variant title (code = cex_sku)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be renamed without writing",
        )

    def handle(self, *args, **options):
        prefix = "Product "
        products = Product.objects.filter(name__startswith=prefix)

        renames = []
        for product in products:
            code = product.name[len(prefix):].strip()
            if not code:
                continue
            try:
                variant = Variant.objects.get(cex_sku=code, product=product)
            except Variant.DoesNotExist:
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping '{product.name}' - no variant with cex_sku '{code}' "
                        f"for this product"
                    )
                )
                continue

            new_name = variant.title
            if product.name != new_name:
                renames.append((product, new_name))

        if not renames:
            self.stdout.write(self.style.SUCCESS("No products to rename."))
            return

        for product, new_name in renames:
            self.stdout.write(f"  {product.name} -> {new_name}")

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Dry run. Would rename {len(renames)} product(s). "
                    "Run without --dry-run to apply."
                )
            )
            return

        with transaction.atomic():
            for product, new_name in renames:
                product.name = new_name
                product.save(update_fields=["name"])

        self.stdout.write(
            self.style.SUCCESS(f"Renamed {len(renames)} product(s).")
        )
