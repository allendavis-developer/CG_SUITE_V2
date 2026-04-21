"""Helpers shared across the split view modules. Extracted verbatim from the
former pricing/views_v2.py god file; do not add new logic here unless it is
genuinely cross-domain."""
import logging
from decimal import Decimal
from django.utils.dateparse import parse_datetime

from pricing.models_v2 import (
    Variant,
    RepricingSessionItem,
    UploadSessionItem,
    RequestJewelleryReferenceSnapshot,
)
from pricing import research_storage
from pricing.utils.parsing import parse_decimal
from pricing.services.offer_engine import round_price

logger = logging.getLogger(__name__)

_decimal_or_none = parse_decimal
_round_offer_price = round_price
_round_sale_price = round_price

def _is_jewellery_placeholder_variant(variant):
    """Synthetic catalogue rows use cex_sku JEW-… — do not treat as CeX prices."""
    if variant is None:
        return False
    sku = getattr(variant, "cex_sku", None) or ""
    return str(sku).upper().startswith("JEW-")


def _resolve_cex_sku_to_variant(item_payload):
    """When variant is null and cex_sku (CeX product ID from URL) is provided, look up variant and use it."""
    if item_payload.get('variant') is not None:
        return
    cex_sku = item_payload.pop('cex_sku', None)
    if not cex_sku:
        raw = item_payload.get('raw_data') or {}
        cex_sku = raw.get('id')
        if not cex_sku:
            rd = raw.get('referenceData') or raw.get('reference_data')
            if isinstance(rd, dict):
                cex_sku = rd.get('cex_sku') or rd.get('id')
    if not cex_sku:
        return
    try:
        v = Variant.objects.get(cex_sku=str(cex_sku))
        item_payload['variant'] = v.variant_id
    except Variant.DoesNotExist:
        pass


def _create_stock_session_line_from_payload(
    session,
    item_data,
    idx,
    *,
    parent_fk_field: str,
    line_model,
    ingest_post_create,
):
    barcode = (item_data.get('barcode') or '').strip()
    if not barcode:
        raise ValueError(f"items_data[{idx}].barcode is required")

    try:
        quantity = max(1, int(item_data.get('quantity') or 1))
    except (TypeError, ValueError):
        raise ValueError(f"Invalid quantity for items_data[{idx}]")

    kwargs = {
        parent_fk_field: session,
        "item_identifier": str(item_data.get('item_identifier') or item_data.get('itemId') or '').strip(),
        "title": (item_data.get('title') or '').strip(),
        "quantity": quantity,
        "barcode": barcode,
        "stock_barcode": (item_data.get('stock_barcode') or '').strip(),
        "stock_url": (item_data.get('stock_url') or '').strip(),
        "old_retail_price": _decimal_or_none(item_data.get('old_retail_price'), 'old_retail_price'),
        "new_retail_price": _decimal_or_none(item_data.get('new_retail_price'), 'new_retail_price'),
        "cex_sell_at_repricing": _decimal_or_none(item_data.get('cex_sell_at_repricing'), 'cex_sell_at_repricing'),
        "our_sale_price_at_repricing": _decimal_or_none(
            item_data.get('our_sale_price_at_repricing'), 'our_sale_price_at_repricing'
        ),
    }
    line = line_model.objects.create(**kwargs)
    ingest_post_create(
        line,
        item_data.get('raw_data'),
        item_data.get('cash_converters_data'),
        item_data.get('cg_data'),
    )
    return line


def _create_repricing_session_item_from_payload(session, item_data, idx):
    return _create_stock_session_line_from_payload(
        session,
        item_data,
        idx,
        parent_fk_field="repricing_session",
        line_model=RepricingSessionItem,
        ingest_post_create=research_storage.ingest_repricing_line_post_create,
    )


def _create_upload_session_item_from_payload(session, item_data, idx):
    return _create_stock_session_line_from_payload(
        session,
        item_data,
        idx,
        parent_fk_field="upload_session",
        line_model=UploadSessionItem,
        ingest_post_create=research_storage.ingest_upload_line_post_create,
    )


def _sync_upload_session_items_from_session_snapshot(session):
    """
    Create missing UploadSessionItem rows from session_data.items + barcodes.

    Draft autosave only PATCHes session_data (no items_data), so DB line rows
    did not exist until completion — but the Web EPOS proceed flow needs
    upload_session_item_id on each row. This keeps DB lines in sync with the
    snapshot whenever the session is saved.
    """
    session_data = session.session_data
    if not isinstance(session_data, dict):
        return
    items = session_data.get('items') or []
    if not isinstance(items, list) or not items:
        return
    barcodes = session_data.get('barcodes') or {}
    if not isinstance(barcodes, dict):
        barcodes = {}
    lookups = session_data.get('nosposLookups') or {}
    if not isinstance(lookups, dict):
        lookups = {}

    existing_ids = set(
        UploadSessionItem.objects.filter(upload_session=session).values_list('item_identifier', flat=True)
    )

    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get('isRemoved'):
            continue
        if item.get('isUploadBarcodeQueuePlaceholder'):
            continue
        iid = str(item.get('id') or '').strip()
        if not iid or iid in existing_ids:
            continue

        codes = barcodes.get(iid)
        if codes is None:
            codes = barcodes.get(str(item.get('id')))
        if not isinstance(codes, list):
            codes = []
        barcode = ''
        for c in codes:
            t = str(c or '').strip()
            if t:
                barcode = t
                break
        if not barcode:
            continue

        lk = lookups.get(f'{iid}_0')
        if lk is None and item.get('id') is not None:
            lk = lookups.get(f'{item.get("id")}_0')
        stock_barcode = ''
        stock_url = ''
        if isinstance(lk, dict):
            stock_barcode = str(lk.get('stockBarcode') or '').strip()
            stock_url = str(lk.get('stockUrl') or '').strip()[:500]

        try:
            quantity = max(1, int(item.get('quantity') or 1))
        except (TypeError, ValueError):
            quantity = 1

        raw_ebay = item.get('ebayResearchData')
        raw_cc = item.get('cashConvertersResearchData')
        raw_cg = item.get('cgResearchData')
        item_data = {
            'item_identifier': iid,
            'itemId': iid,
            'barcode': barcode,
            'title': str(item.get('uploadTableItemName') or item.get('variantName') or item.get('title') or '').strip(),
            'quantity': quantity,
            'stock_barcode': stock_barcode,
            'stock_url': stock_url,
            'cex_sell_at_repricing': item.get('cexSellPrice'),
            'our_sale_price_at_repricing': item.get('ourSalePrice'),
            'raw_data': raw_ebay if isinstance(raw_ebay, dict) else {},
            'cash_converters_data': raw_cc if isinstance(raw_cc, dict) else {},
            'cg_data': raw_cg if isinstance(raw_cg, dict) else {},
        }
        try:
            _create_upload_session_item_from_payload(session, item_data, 0)
        except ValueError:
            continue
        existing_ids.add(iid)


def _sync_request_jewellery_reference_snapshot(existing_request, jewellery_reference_scrape):
    """
    Persist request-level jewellery reference history and set active snapshot.
    Input shape is the frontend payload: { sections, scrapedAt, sourceUrl }.
    """
    if jewellery_reference_scrape is None:
        return
    if not isinstance(jewellery_reference_scrape, dict):
        raise ValueError("jewellery_reference_scrape must be a JSON object")

    sections = jewellery_reference_scrape.get("sections")
    if not isinstance(sections, list):
        raise ValueError("jewellery_reference_scrape.sections must be a list")

    scraped_at = parse_datetime(str(jewellery_reference_scrape.get("scrapedAt") or "")) if jewellery_reference_scrape.get("scrapedAt") else None
    source_url = str(jewellery_reference_scrape.get("sourceUrl") or "")

    # Avoid duplicate history rows when autosave posts the same payload repeatedly.
    snapshot = (
        RequestJewelleryReferenceSnapshot.objects.filter(
            request=existing_request,
            source_name="Mastermelt",
            source_url=source_url,
            scraped_at=scraped_at,
            sections_json=sections,
        )
        .order_by("-created_at")
        .first()
    )
    if snapshot is None:
        snapshot = RequestJewelleryReferenceSnapshot.objects.create(
            request=existing_request,
            source_name="Mastermelt",
            source_url=source_url,
            scraped_at=scraped_at,
            sections_json=sections,
        )
    existing_request.current_jewellery_reference_snapshot = snapshot


def _get_category_and_descendant_ids(category):
    """Return list of category_id for this category and all its descendants."""
    ids = [category.category_id]
    for child in category.children.all():
        ids.extend(_get_category_and_descendant_ids(child))
    return ids


def _upload_session_data_has_barcode(session_data) -> bool:
    """True if client snapshot includes at least one typed or item-linked NosPos barcode."""
    if not session_data or not isinstance(session_data, dict):
        return False
    barcodes = session_data.get('barcodes') or {}
    if isinstance(barcodes, dict):
        for codes in barcodes.values():
            if isinstance(codes, list) and any(str(c or '').strip() for c in codes):
                return True
    for item in session_data.get('items') or []:
        if item.get('isRemoved'):
            continue
        for b in (item.get('nosposBarcodes') or []):
            if str((b or {}).get('barserial') or '').strip():
                return True
    uw = session_data.get('uploadBarcodeWorkspace') or {}
    for line in (uw.get('lines') or []):
        if not isinstance(line, dict):
            continue
        for c in (line.get('barcodes') or []):
            if str(c or '').strip():
                return True
    return False
