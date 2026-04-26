"""
Sync Cash Generator department scrape rows into CgCategory.
Uses collection=… slugs from category URLs as stable keys.
"""

from __future__ import annotations

import hashlib
import logging
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qs, urlparse

from django.db import transaction

from pricing.models_v2 import CgCategory

logger = logging.getLogger(__name__)

SAMPLE_LIMIT = 15

_ROOT_PARENT_TOKENS = frozenset(
    {
        "",
        "—",
        "-",
        "\u2014",
        "all categories",
    }
)


def _norm_parent_label(s: str | None) -> str:
    t = (s or "").strip()
    if not t or t.strip("—-\u2014 ").lower() in _ROOT_PARENT_TOKENS or t.lower() == "all categories":
        return ""
    return t


def collection_slug_from_href(href: str | None) -> str | None:
    if not href or not isinstance(href, str):
        return None
    try:
        q = parse_qs(urlparse(href.strip()).query)
        vals = q.get("collection") or []
        if vals and vals[0]:
            return str(vals[0]).strip() or None
    except Exception:
        logger.debug("cg_category_sync: bad href %r", href, exc_info=True)
    return None


def _fallback_slug(name: str, parent_label: str) -> str:
    raw = f"{name}|{parent_label}".encode("utf-8")
    return f"_cg_{hashlib.sha256(raw).hexdigest()[:28]}"


def _normalize_scrape_rows(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen_slug: set[str] = set()
    for r in raw_rows:
        if not isinstance(r, dict):
            continue
        name = str(r.get("category") or "").strip()
        if not name:
            continue
        pl_raw = str(r.get("parentCategory") or "").strip()
        parent_label = _norm_parent_label(pl_raw)
        slug = collection_slug_from_href(r.get("categoryHref"))
        if not slug:
            slug = _fallback_slug(name, parent_label)
        if slug in seen_slug:
            continue
        seen_slug.add(slug)
        out.append({"slug": slug, "name": name, "parent_label": parent_label})
    return out


def _resolve_parent_slugs(rows_by_slug: dict[str, dict[str, Any]]) -> dict[str, str | None]:
    name_to_slugs: dict[str, list[str]] = defaultdict(list)
    for sl, r in rows_by_slug.items():
        name_to_slugs[r["name"]].append(sl)

    result: dict[str, str | None] = {}
    for sl, r in rows_by_slug.items():
        pl = r["parent_label"]
        if not pl:
            result[sl] = None
            continue
        cands = name_to_slugs.get(pl, [])
        if len(cands) == 1:
            result[sl] = cands[0]
        elif len(cands) > 1:
            best = None
            best_len = -1
            for ps in cands:
                if ps == sl:
                    continue
                if sl.startswith(ps + "-") or (ps in sl and sl != ps):
                    if len(ps) > best_len:
                        best_len = len(ps)
                        best = ps
            result[sl] = best if best is not None else cands[0]
        else:
            result[sl] = None
    return result


def _before_snapshot_from_db() -> dict[str, dict[str, str]]:
    snap: dict[str, dict[str, str]] = {}
    for o in CgCategory.objects.exclude(collection_slug__isnull=True).exclude(collection_slug="").select_related(
        "parent_category"
    ):
        slug = str(o.collection_slug)
        pslug = ""
        if o.parent_category_id and o.parent_category.collection_slug:
            pslug = str(o.parent_category.collection_slug)
        snap[slug] = {"name": o.name, "parent_slug": pslug}
    return snap


def _build_diff(
    before: dict[str, dict[str, str]],
    after: dict[str, dict[str, str]],
) -> dict[str, Any]:
    added = [s for s in after if s not in before]
    removed = [s for s in before if s not in after]
    updated: list[str] = []
    unchanged = 0
    for s in after:
        if s not in before:
            continue
        if before[s]["name"] != after[s]["name"] or before[s]["parent_slug"] != after[s]["parent_slug"]:
            updated.append(s)
        else:
            unchanged += 1

    def sample(keys: list[str], lim: int = SAMPLE_LIMIT):
        return keys[:lim]

    updated_details = []
    for s in sample(updated, SAMPLE_LIMIT):
        updated_details.append(
            {
                "slug": s,
                "before": dict(before[s]),
                "after": dict(after[s]),
            }
        )

    return {
        "added_count": len(added),
        "removed_count": len(removed),
        "updated_count": len(updated),
        "unchanged_count": unchanged,
        "added_sample": [{"slug": s, "name": after[s]["name"]} for s in sample(added)],
        "removed_sample": [{"slug": s, "name": before[s]["name"]} for s in sample(removed)],
        "updated_sample": updated_details,
    }


def sync_cg_categories_from_scrape_rows(raw_rows: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = _normalize_scrape_rows(raw_rows)
    if not normalized:
        return {
            "total_rows": 0,
            "diff": {
                "added_count": 0,
                "removed_count": 0,
                "updated_count": 0,
                "unchanged_count": 0,
                "added_sample": [],
                "removed_sample": [],
                "updated_sample": [],
            },
        }

    rows_by_slug = {r["slug"]: r for r in normalized}
    parent_map = _resolve_parent_slugs(rows_by_slug)
    for sl, r in rows_by_slug.items():
        ps = parent_map.get(sl)
        if ps is not None and ps not in rows_by_slug:
            ps = None
        r["parent_slug"] = ps

    after = {
        sl: {"name": r["name"], "parent_slug": r["parent_slug"] or ""}
        for sl, r in rows_by_slug.items()
    }
    before = _before_snapshot_from_db()
    diff = _build_diff(before, after)

    with transaction.atomic():
        CgCategory.objects.all().delete()
        remaining = set(rows_by_slug.keys())
        slug_to_obj: dict[str, CgCategory] = {}
        safety = 0
        while remaining and safety < len(rows_by_slug) + 5:
            safety += 1
            progress = False
            for sl in list(remaining):
                r = rows_by_slug[sl]
                ps = r["parent_slug"]
                if ps and ps in rows_by_slug and ps not in slug_to_obj:
                    continue
                parent_obj = slug_to_obj.get(ps) if ps else None
                obj = CgCategory.objects.create(
                    collection_slug=sl,
                    name=r["name"],
                    parent_category=parent_obj,
                )
                slug_to_obj[sl] = obj
                remaining.remove(sl)
                progress = True
            if not progress and remaining:
                sl = remaining.pop()
                r = rows_by_slug[sl]
                obj = CgCategory.objects.create(
                    collection_slug=sl,
                    name=r["name"],
                    parent_category=None,
                )
                slug_to_obj[sl] = obj

    return {
        "total_rows": len(normalized),
        "diff": diff,
    }
