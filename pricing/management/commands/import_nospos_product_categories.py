"""
Mirror NosPos category rows from `NosposCategory` into internal `ProductCategory` trees.

Rules:
- Skip entire subtrees for these NosPos category names: any row whose path contains one of
  them as a segment (root or deeper) is excluded, with all descendants:
  - Computers/Tablets & Networking
  - Mobile Phones & Communications
- Under "Jewellery & Watches", only import "Watches" and its descendants (not other jewellery branches).
- All created/linked categories get `ready_for_builder=False` (existing rows with the same
  parent+name keep their current `ready_for_builder`, e.g. Gaming/phones/tablets stay True).

Requires NosPos categories to be in the DB first (Data → Update from NoSpos / sync).

Usage:
    python manage.py import_nospos_product_categories
    python manage.py import_nospos_product_categories --dry-run
"""

import re

from django.core.management.base import BaseCommand
from django.db import transaction

from pricing.models_v2 import NosposCategory, ProductCategory

_PATH_SPLIT = re.compile(r"\s*>\s*")

# If any segment of `full_name` (split on " > ") equals one of these, the row and its subtree
# are excluded (not only when the name appears as the first segment).
_EXCLUDED_ROOTS = frozenset(
    {
        "Computers/Tablets & Networking",
        "Mobile Phones & Communications",
    }
)

_JEWELLERY_WATCHES_ROOT = "Jewellery & Watches"
_WATCHES_BRANCH_SEGMENT = "Watches"


def _parts(full_name: str) -> list[str]:
    return [p.strip() for p in _PATH_SPLIT.split((full_name or "").strip()) if p.strip()]


def _allowed_nospos_full_name(full_name: str) -> bool:
    parts = _parts(full_name)
    if not parts:
        return False
    if any(segment in _EXCLUDED_ROOTS for segment in parts):
        return False
    root = parts[0]
    if root == _JEWELLERY_WATCHES_ROOT:
        if len(parts) < 2:
            return False
        if parts[1] != _WATCHES_BRANCH_SEGMENT:
            return False
        return True
    return True


def _prefix_paths(full_name: str) -> list[str]:
    parts = _parts(full_name)
    out = []
    for i in range(1, len(parts) + 1):
        out.append(" > ".join(parts[:i]))
    return out


class Command(BaseCommand):
    help = "Import NosPos categories into ProductCategory (see module docstring for exclusions)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show counts only; do not write ProductCategory rows.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        if not NosposCategory.objects.exists():
            self.stdout.write(
                self.style.WARNING(
                    "No NosposCategory rows — run NosPos category sync first (nothing to import)."
                )
            )
            return

        paths: set[str] = set()
        allowed_rows = 0
        for nc in NosposCategory.objects.all().order_by("level", "nospos_id"):
            if not _allowed_nospos_full_name(nc.full_name):
                continue
            allowed_rows += 1
            for p in _prefix_paths(nc.full_name):
                paths.add(p)

        sorted_paths = sorted(paths, key=lambda p: (len(_parts(p)), p))

        self.stdout.write(
            f"NosposCategory rows allowed: {allowed_rows}; distinct ProductCategory paths: {len(sorted_paths)}"
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no database changes."))
            return

        created = 0
        reused = 0
        path_to_cat: dict[str, ProductCategory] = {}

        with transaction.atomic():
            for full_path in sorted_paths:
                segs = _parts(full_path)
                segment = segs[-1]
                parent_path = " > ".join(segs[:-1]) if len(segs) > 1 else None
                parent = path_to_cat.get(parent_path) if parent_path else None

                obj, was_created = ProductCategory.objects.get_or_create(
                    parent_category=parent,
                    name=segment,
                    defaults={"ready_for_builder": False},
                )
                path_to_cat[full_path] = obj
                if was_created:
                    created += 1
                else:
                    reused += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. ProductCategory created: {created}, existing parent+name matched: {reused}."
            )
        )
