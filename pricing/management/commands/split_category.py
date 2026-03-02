"""
Split a category into subcategories by first word of display name.
- Products with manufacturer: use "Manufacturer Product"
- Products without manufacturer: use product name only
Single level only.
"""

from collections import defaultdict

from django.core.management.base import BaseCommand

from pricing.models_v2 import Product, ProductCategory
from pricing.utils.category_tree import build_one_level_categories


class Command(BaseCommand):
    help = "Split a category: by manufacturer+product (if manufacturer set), else by product name."

    def add_arguments(self, parser):
        parser.add_argument(
            "category",
            type=str,
            help="Category name (case-insensitive)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without writing",
        )

    def handle(self, *args, **options):
        name = options["category"]
        try:
            category = ProductCategory.objects.get(name__iexact=name)
        except ProductCategory.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Category '{name}' not found."))
            return

        qs = Product.objects.select_related("manufacturer").filter(category=category)
        with_mfg = []
        without_mfg = []
        for p in qs:
            display = f"{p.manufacturer.name} {p.name}" if p.manufacturer else p.name
            if p.manufacturer:
                with_mfg.append((p.product_id, display))
            else:
                without_mfg.append((p.product_id, display))

        products = with_mfg + without_mfg
        if not products:
            self.stdout.write(self.style.WARNING(f"No products in '{name}'."))
            return

        self.stdout.write(
            f"Products with manufacturer: {len(with_mfg)}, without: {len(without_mfg)}"
        )

        tree = build_one_level_categories(products)
        without_pids = {pid for pid, _ in without_mfg}

        if options["dry_run"]:
            for node in tree["children"]:
                n_no_mfg = sum(1 for pid, _ in node["products"] if pid in without_pids)
                src = "manufacturer" if n_no_mfg == 0 else f"name ({n_no_mfg} no-mfg)"
                self.stdout.write(
                    f"→ {node['name']} ({len(node['products'])} products) [{src}]"
                )
            self.stdout.write(self.style.SUCCESS("Dry run. Run without --dry-run to apply."))
            return

        for node in tree["children"]:
            cat = ProductCategory.objects.create(
                parent_category=category, name=node["name"]
            )
            n_no_mfg = 0
            for pid, _ in node["products"]:
                Product.objects.filter(product_id=pid).update(category=cat)
                if pid in without_pids:
                    n_no_mfg += 1
            src = "manufacturer" if n_no_mfg == 0 else f"name ({n_no_mfg} no-mfg)"
            self.stdout.write(f"Created {node['name']} ({len(node['products'])} products) [{src}]")

        self.stdout.write(self.style.SUCCESS("Done."))
