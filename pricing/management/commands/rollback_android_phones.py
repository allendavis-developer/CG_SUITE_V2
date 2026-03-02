"""
Move all products under Android Phones (and any subcategories) back to Android Phones.
Deletes all subcategories of Android Phones.
"""

from django.core.management.base import BaseCommand

from pricing.models_v2 import Product, ProductCategory

ANDROID_PHONES_NAME = "Android Phones"


def _descendant_ids(category):
    ids = [category.category_id]
    for child in category.children.all():
        ids.extend(_descendant_ids(child))
    return ids


class Command(BaseCommand):
    help = "Move all products under Android Phones back to Android Phones and remove subcategories."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without writing",
        )

    def handle(self, *args, **options):
        try:
            android_phones = ProductCategory.objects.get(name__iexact=ANDROID_PHONES_NAME)
        except ProductCategory.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Category '{ANDROID_PHONES_NAME}' not found."))
            return

        ids = _descendant_ids(android_phones)
        ids.remove(android_phones.category_id)  # Exclude Android Phones itself

        if not ids:
            self.stdout.write(self.style.WARNING("No subcategories to roll back."))
            return

        products = Product.objects.filter(category_id__in=ids)
        count = products.count()

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"Would move {count} products and delete {len(ids)} categories."))
            return

        products.update(category=android_phones)
        for cat in ProductCategory.objects.filter(parent_category=android_phones):
            cat.delete()

        self.stdout.write(self.style.SUCCESS(f"Moved {count} products back. Deleted subcategories."))
