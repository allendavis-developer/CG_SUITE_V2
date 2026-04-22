from __future__ import annotations

import html
import logging
import re
from typing import Iterable, List
from urllib.parse import parse_qs, quote, urlparse

import requests as http_requests
from bs4 import BeautifulSoup
from django.db import transaction
from django.shortcuts import render
from django.conf import settings
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


@ensure_csrf_cookie
def react_app(request):
    """SPA shell; ensures `csrftoken` is set so fetch POSTs can send X-CSRFToken."""
    return render(request, "react.html")


@api_view(['GET'])
def address_lookup(request, postcode):
    """Proxy to Ideal Postcodes postcode lookup API."""
    api_key = (getattr(settings, 'IDEAL_POSTCODES_API_KEY', '') or '').strip()
    if not api_key:
        return Response(
            {'error': 'Address lookup not configured. Set IDEAL_POSTCODES_API_KEY in .env.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    postcode_clean = (postcode or '').strip()
    if not postcode_clean or len(postcode_clean.replace(' ', '')) < 4:
        return Response({'addresses': []})
    try:
        url = f"https://api.ideal-postcodes.co.uk/v1/postcodes/{quote(postcode_clean)}?api_key={api_key}"
        resp = http_requests.get(url, timeout=10)
        if resp.status_code == 401:
            logger.warning('Ideal Postcodes 401: invalid API key')
            return Response(
                {'error': 'Invalid Ideal Postcodes API key. Check your key at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if resp.status_code == 402:
            logger.warning('Ideal Postcodes 402: no lookups remaining')
            return Response(
                {'error': 'Address lookup limit reached. Top up at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_402_PAYMENT_REQUIRED
            )
        if resp.status_code == 404:
            return Response({'addresses': []})
        resp.raise_for_status()
        data = resp.json()
        result = data.get('result', [])
        if not isinstance(result, list):
            result = [result] if result else []
        return Response({'addresses': result})
    except http_requests.RequestException as e:
        logger.warning('Ideal Postcodes postcode lookup failed: %s', e)
        return Response(
            {'error': str(e) if hasattr(e, 'message') else 'Address lookup failed'},
            status=status.HTTP_502_BAD_GATEWAY
        )


_CG_RETAIL_CATEGORY_UA = (
    'Mozilla/5.0 (compatible; CG-Suite/1.0; +https://github.com/) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)
_CG_RETAIL_HOME_URLS = (
    'https://cashgenerator.co.uk/',
    'https://www.cashgenerator.co.uk/',
)


def _collection_slug_from_href(href: str) -> str:
    """
    Normalise category id from href: legacy ?collection=foo or /collections/foo (root /collections → 'all').
    """
    if not href:
        return ''
    h = html.unescape(href.strip())
    if 'collection=' in h:
        try:
            base = h if h.startswith('http') else f'https://cashgenerator.co.uk{h}'
            vals = parse_qs(urlparse(base).query).get('collection') or []
            if vals:
                return (vals[0] or '').strip()
        except Exception:
            pass
        m = re.search(r'collection=([^&"\'#]+)', h)
        if m:
            return html.unescape(m.group(1)).strip()
    m = re.search(r'/collections(?:/([^?#"\'>\s]+))?', h)
    if m:
        tail = (m.group(1) or '').strip().rstrip('/')
        return 'all' if not tail else tail
    return ''


def _name_from_anchor(a) -> str:
    if not a:
        return ''
    span = a.find('span')
    raw = span.get_text(' ', strip=True) if span else a.get_text(' ', strip=True)
    return html.unescape(raw or '').strip()


def _find_all_categories_root_li(soup: BeautifulSoup):
    """Resolve mega-menu root: li.dropdown.highlight, or any li.dropdown whose top link is All Categories → /collections."""
    for sel in ('li.dropdown.highlight', 'li[class*="dropdown"][class*="highlight"]'):
        hit = soup.select_one(sel)
        if hit and hit.select_one(':scope > ul.dropdown-menu'):
            return hit

    for a in soup.select('a.dropdown-link[href], a[href*="/collections"]'):
        if _name_from_anchor(a).lower() != 'all categories':
            continue
        slug = _collection_slug_from_href(a.get('href') or '')
        if slug != 'all':
            continue
        node = a
        while node is not None:
            if getattr(node, 'name', None) == 'li':
                cls = node.get('class') or []
                if 'dropdown' in cls and node.select_one(':scope > ul.dropdown-menu'):
                    return node
            node = node.parent
    return None


def _parse_cash_generator_category_rows(html_text: str) -> List[dict]:
    """Parse homepage mega-menu (All Categories); supports /collections/… and legacy ?collection=… links."""
    soup = BeautifulSoup(html_text, 'html.parser')
    root_li = _find_all_categories_root_li(soup)
    if not root_li:
        return []
    root_menu = root_li.select_one(':scope > ul.dropdown-menu')
    if not root_menu:
        return []

    rows: List[dict] = []
    seen: set[str] = set()

    def add_row(name: str, href: str, path_parts: tuple[str, ...]) -> None:
        col = _collection_slug_from_href(href)
        if not name or col in ('', 'all'):
            return
        parent = path_parts[-1] if path_parts else 'All Categories'
        key = col or f'{name}\x00{parent}'
        if key in seen:
            return
        seen.add(key)
        rows.append(
            {
                'categoryName': name,
                'categoryPath': ' › '.join(path_parts + (name,)),
                'collectionSlug': col,
            }
        )

    def submenu_link(inner):
        if not inner:
            return None
        for a in inner.select('a.dropdown-link[href]'):
            if _collection_slug_from_href(a.get('href') or '') not in ('', 'all'):
                return a
        return None

    def walk_ul(ul, path_parts: tuple[str, ...]) -> None:
        if not ul:
            return
        for li in ul.find_all('li', recursive=False):
            cls = li.get('class') or []
            if 'back-prev-menu' in cls:
                continue
            if 'dropdown-submenu' in cls:
                inner = li.select_one(':scope > .dropdown-inner')
                link = submenu_link(inner)
                sub = li.select_one(':scope > ul.dropdown-menu')
                if link:
                    nm = _name_from_anchor(link)
                    add_row(nm, link.get('href') or '', path_parts)
                    walk_ul(sub, path_parts + (nm,))
                elif sub:
                    walk_ul(sub, path_parts)
            else:
                a = li.select_one(":scope > a[href][href*='/collections/'], :scope > a[href*='collection=']")
                if a:
                    add_row(_name_from_anchor(a), a.get('href') or '', path_parts)

    walk_ul(root_menu, ('All Categories',))
    return rows


def _cg_category_api_rows(categories: Iterable) -> List[dict]:
    """Build categoryPath from parent chain (not stored in DB)."""
    rows_list = list(categories)
    by_id = {c.pk: c for c in rows_list}
    out: List[dict] = []
    for c in rows_list:
        names: List[str] = []
        cur = c
        seen: set[int] = set()
        while cur is not None and cur.pk not in seen:
            seen.add(cur.pk)
            names.append(cur.name)
            pid = cur.parent_category_id
            cur = by_id.get(pid) if pid else None
        trail = ' › '.join(reversed(names))
        path = f'All Categories › {trail}' if trail else 'All Categories'
        out.append(
            {
                'cgCategoryId': c.pk,
                'categoryName': c.name,
                'categoryPath': path,
                'parentCategoryId': c.parent_category_id,
            }
        )
    return out


def _sync_cg_categories_from_parsed(parsed: List[dict]) -> tuple[int, int]:
    """Insert new rows and refresh name/parent when scrape differs. Returns (added, updated)."""
    from pricing.models_v2 import CGCategory

    by_path = {r['categoryPath']: r for r in parsed}
    ordered = sorted(parsed, key=lambda r: r['categoryPath'].count(' › '))
    added = 0
    updated = 0
    with transaction.atomic():
        for r in ordered:
            slug = r['collectionSlug']
            path = r['categoryPath']
            name = r['categoryName']
            parent_path = path.rsplit(' › ', 1)[0] if ' › ' in path else ''
            pr = by_path.get(parent_path)
            parent = None
            if pr:
                parent = CGCategory.objects.filter(collection_slug=pr['collectionSlug']).only('pk').first()
            obj = CGCategory.objects.filter(collection_slug=slug).first()
            if obj:
                changed = False
                if obj.name != name:
                    obj.name = name
                    changed = True
                new_pid = parent.pk if parent else None
                if obj.parent_category_id != new_pid:
                    obj.parent_category = parent
                    changed = True
                if changed:
                    obj.save(update_fields=['name', 'parent_category'])
                    updated += 1
            else:
                CGCategory.objects.create(
                    collection_slug=slug,
                    name=name,
                    parent_category=parent,
                )
                added += 1
    return added, updated


def _fetch_cash_generator_homepage_html() -> tuple[str, str, Exception | None]:
    last_err: Exception | None = None
    html_text = ''
    final_url = ''
    for url in _CG_RETAIL_HOME_URLS:
        try:
            resp = http_requests.get(
                url,
                timeout=35,
                headers={
                    'User-Agent': _CG_RETAIL_CATEGORY_UA,
                    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-GB,en;q=0.9',
                },
            )
            resp.raise_for_status()
            html_text = resp.text or ''
            final_url = str(resp.url or url)
            if 'dropdown' in html_text and (
                'collection=' in html_text or '/collections/' in html_text or 'All Categories' in html_text
            ):
                break
        except http_requests.RequestException as e:
            last_err = e
            logger.warning('Cash Generator retail fetch failed for %s: %s', url, e)
    return html_text, final_url, last_err


@api_view(['GET', 'POST'])
def cash_generator_retail_categories(request):
    """
    GET: rows from cg_categories (saved names and parent_category_id).
    POST: re-fetch homepage, parse mega-menu, upsert DB (add new + refresh changed), return rows.
    """
    from pricing.models_v2 import CGCategory

    if request.method == 'GET':
        qs = CGCategory.objects.all().order_by('collection_slug')
        rows = _cg_category_api_rows(qs)
        return Response(
            {
                'ok': True,
                'rows': rows,
                'pageUrl': None,
                'source': 'database',
            }
        )

    html_text, final_url, last_err = _fetch_cash_generator_homepage_html()
    if not html_text:
        msg = str(last_err) if last_err else 'Empty response'
        return Response({'ok': False, 'error': f'Could not fetch homepage HTML: {msg}'}, status=status.HTTP_502_BAD_GATEWAY)

    parsed = _parse_cash_generator_category_rows(html_text)
    if not parsed:
        return Response(
            {
                'ok': False,
                'error': 'Could not find or parse the All Categories mega-menu in the downloaded HTML.',
            },
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    added, updated = _sync_cg_categories_from_parsed(parsed)
    qs = CGCategory.objects.all().order_by('collection_slug')
    rows = _cg_category_api_rows(qs)
    return Response(
        {
            'ok': True,
            'rows': rows,
            'pageUrl': final_url,
            'source': 'scrape',
            'added': added,
            'updated': updated,
        }
    )


# ─── Web EPOS categories ─────────────────────────────────────────────────
#
# Scraped by the Chrome extension from the `/products/new` page's cascading
# `#catLevel{N}` selects. The extension posts the flat list back here (each
# node has `webepos_uuid`, `name`, optional `parent_webepos_uuid`, `level`)
# and we upsert by `webepos_uuid` so repeated scrapes merge cleanly.


def _webepos_category_rows(qs) -> list[dict]:
    return [
        {
            'webepos_category_id': obj.pk,
            'webepos_uuid': obj.webepos_uuid,
            'name': obj.name,
            'parent_category_id': obj.parent_category_id,
            'level': obj.level,
        }
        for obj in qs
    ]


@api_view(['GET', 'POST'])
def webepos_categories_view(request):
    """
    GET: flat list of rows from `webepos_categories`.
    POST: body `{ nodes: [{ webepos_uuid, name, parent_webepos_uuid?, level }] }`
      → upsert by `webepos_uuid`, setting name/level/parent on each pass. Parents
      are resolved after all nodes exist so the input order doesn't matter.
    """
    from pricing.models_v2 import WebEposCategory

    if request.method == 'GET':
        qs = WebEposCategory.objects.all().order_by('level', 'name')
        return Response({'ok': True, 'rows': _webepos_category_rows(qs), 'source': 'database'})

    body = request.data if isinstance(request.data, dict) else {}
    nodes = body.get('nodes') if isinstance(body.get('nodes'), list) else []
    if not nodes:
        return Response(
            {'ok': False, 'error': 'Expected `{ nodes: [...] }` from the extension.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    added = 0
    updated = 0
    parent_uuid_by_child_uuid: dict[str, str] = {}

    with transaction.atomic():
        for raw in nodes:
            if not isinstance(raw, dict):
                continue
            uuid = str(raw.get('webepos_uuid') or '').strip()
            name = str(raw.get('name') or '').strip()
            if not uuid or not name:
                continue
            level_raw = raw.get('level')
            try:
                level = max(1, int(level_raw)) if level_raw is not None else 1
            except (TypeError, ValueError):
                level = 1
            parent_uuid = str(raw.get('parent_webepos_uuid') or '').strip() or None
            if parent_uuid:
                parent_uuid_by_child_uuid[uuid] = parent_uuid

            obj = WebEposCategory.objects.filter(webepos_uuid=uuid).first()
            if obj is None:
                WebEposCategory.objects.create(
                    webepos_uuid=uuid,
                    name=name,
                    level=level,
                    parent_category=None,
                )
                added += 1
            else:
                changed = False
                if obj.name != name:
                    obj.name = name
                    changed = True
                if obj.level != level:
                    obj.level = level
                    changed = True
                if changed:
                    obj.save(update_fields=['name', 'level'])
                    updated += 1

        # Second pass: wire parents now that every node exists.
        if parent_uuid_by_child_uuid:
            pk_by_uuid = dict(
                WebEposCategory.objects.filter(
                    webepos_uuid__in=set(parent_uuid_by_child_uuid.keys())
                    | set(parent_uuid_by_child_uuid.values())
                ).values_list('webepos_uuid', 'pk')
            )
            for child_uuid, parent_uuid in parent_uuid_by_child_uuid.items():
                child_pk = pk_by_uuid.get(child_uuid)
                parent_pk = pk_by_uuid.get(parent_uuid)
                if child_pk is None:
                    continue
                WebEposCategory.objects.filter(pk=child_pk).update(parent_category_id=parent_pk)

    qs = WebEposCategory.objects.all().order_by('level', 'name')
    return Response(
        {
            'ok': True,
            'rows': _webepos_category_rows(qs),
            'source': 'scrape',
            'added': added,
            'updated': updated,
        }
    )
