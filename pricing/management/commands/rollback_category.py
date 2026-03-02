"""
Move all products under a category (and any subcategories) back to the parent.
Deletes all subcategories of the given category.
"""

from django.core.management.base import BaseCommand

from pricing.models_v2 import Product, ProductCategory


def _descendant_ids(category):
    ids = [category.category_id]
    for child in category.children.all():
        ids.extend(_descendant_ids(child))
    return ids


class Command(BaseCommand):
    help = "Move all products under a category back to it and remove subcategories."

    def add_arguments(self, parser):
        parser.add_argument(
            "category",
            type=str,
            help="Category name (case-insensitive)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without writing",
        )

    def handle(self, *args, **options):
        name = options["category"]
        try:
            category = ProductCategory.objects.get(name__iexact=name)
        except ProductCategory.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Category '{name}' not found."))
            return

        ids = _descendant_ids(category)
        ids.remove(category.category_id)

        if not ids:
            self.stdout.write(self.style.WARNING("No subcategories to roll back."))
            return

        products = Product.objects.filter(category_id__in=ids)
        count = products.count()

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Would move {count} products and delete {len(ids)} categories."
                )
            )
            return

        products.update(category=category)
        for cat in ProductCategory.objects.filter(parent_category=category):
            cat.delete()

        self.stdout.write(self.style.SUCCESS(f"Moved {count} products back. Deleted subcategories."))
