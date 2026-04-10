"""
Mirror NosPos category rows from `NosposCategory` into internal `ProductCategory` trees.

Rules:
- Skip entire subtrees for these NosPos category names: any row whose path contains one of
  them as a segment (root or deeper) is excluded, including all descendants (e.g.
  `Mobile Phones & Communication > Mobile & Smart Phones` is excluded when
  `Mobile Phones & Communication` is listed).
- Under "Jewellery & Watches", only import "Watches" and its descendants (not other jewellery branches).

ProductCategory rows use one segment per node: each `name` is a single path part (e.g. `Mobile & Smart Phones`),
never the whole NosPos `full_name` string.
- Optional: roots in `_BUILDER_READY_NOSPOS_ROOTS` get `ready_for_builder=True` for new rows;
  roots in `_NOT_BUILDER_READY_NOSPOS_ROOTS` are always `ready_for_builder=False` (and existing
  rows in that subtree are cleared after import).

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
# are excluded. Include spelling variants if NosPos strings differ.
_EXCLUDED_SEGMENTS = frozenset(
    {
        "Mobile Phones & Communication",
        "Mobile Phones & Communications",
        "Video Games & Consoles",
    }
)

# NosPos root segment (first path part) — mirrored subtree gets ready_for_builder=True for new rows.
_BUILDER_READY_NOSPOS_ROOTS = frozenset()

# Always hidden from the buyer/repricing category header (`ready_for_builder=False` for whole subtree).
_NOT_BUILDER_READY_NOSPOS_ROOTS = frozenset(
    {
        "Computers/Tablets & Networking",
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
    if any(segment in _EXCLUDED_SEGMENTS for segment in parts):
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


def _clear_builder_ready_subtree(root: ProductCategory) -> int:
    """Set ready_for_builder=False on root and all descendants. Returns count updated."""
    n = 0
    stack = [root]
    seen: set[int] = set()
    while stack:
        cat = stack.pop()
        pk = int(cat.pk)
        if pk in seen:
            continue
        seen.add(pk)
        if cat.ready_for_builder:
            ProductCategory.objects.filter(pk=pk).update(ready_for_builder=False)
            n += 1
        stack.extend(cat.children.all())
    return n


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
                # One ProductCategory per path prefix; `name` is always this node's segment only
                # (e.g. last part of `Mobile Phones & Communication > Mobile & Smart Phones` is
                # `Mobile & Smart Phones`), never the full NosPos string.
                segment = segs[-1]
                parent_path = " > ".join(segs[:-1]) if len(segs) > 1 else None
                parent = path_to_cat.get(parent_path) if parent_path else None

                root_segment = segs[0]
                builder_ready = (
                    root_segment in _BUILDER_READY_NOSPOS_ROOTS
                    and root_segment not in _NOT_BUILDER_READY_NOSPOS_ROOTS
                )
                obj, was_created = ProductCategory.objects.get_or_create(
                    parent_category=parent,
                    name=segment,
                    defaults={"ready_for_builder": builder_ready},
                )
                if builder_ready and not obj.ready_for_builder:
                    obj.ready_for_builder = True
                    obj.save(update_fields=["ready_for_builder"])
                if root_segment in _NOT_BUILDER_READY_NOSPOS_ROOTS and obj.ready_for_builder:
                    obj.ready_for_builder = False
                    obj.save(update_fields=["ready_for_builder"])
                path_to_cat[full_path] = obj
                if was_created:
                    created += 1
                else:
                    reused += 1

            for root_name in _NOT_BUILDER_READY_NOSPOS_ROOTS:
                root_path = root_name
                root_cat = path_to_cat.get(root_path)
                if root_cat is not None:
                    cleared = _clear_builder_ready_subtree(root_cat)
                    if cleared:
                        self.stdout.write(
                            f"Cleared ready_for_builder on {cleared} row(s) under NosPos root “{root_name}”."
                        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. ProductCategory created: {created}, existing parent+name matched: {reused}."
            )
        )
