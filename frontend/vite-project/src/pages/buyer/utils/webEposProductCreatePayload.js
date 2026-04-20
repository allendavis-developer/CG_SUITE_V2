import { getAiSuggestedCgStockCategoryFromItem } from '@/utils/cgCategoryMappings';
import { resolveUploadPipelineSalePrice } from '@/pages/buyer/utils/repricingDisplay';
import { resolveUploadTableItemName } from '@/pages/buyer/utils/negotiationHelpers';

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Web EPOS product barcode suffix: date + time (local) then server line id.
 * Shape: `STOCK-DDMMYY-HHmmss-ID:123` (no colons in time — friendlier for scanners).
 */
export function formatWebEposUploadBarcodeTimestamp(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = pad(d.getFullYear() % 100);
  const HH = pad(d.getHours());
  const Mi = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  return `${dd}${mm}${yy}-${HH}${Mi}${SS}`;
}

/** Integer `upload_session_item_id` when the row has been saved to the server; else null. */
function uploadSessionItemPrimaryKeyForBarcode(item) {
  const raw = item?.upload_session_item_id;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (t < 1 || !Number.isSafeInteger(t)) return null;
  return String(t);
}

/**
 * Overlay `upload_session_item_id` from GET `/upload-sessions/:id/` `items` onto workspace rows
 * (`item.id` ↔ `item_identifier`).
 */
export function mergeUploadSessionItemIdsFromApiLines(activeItems, lineItems) {
  if (!Array.isArray(activeItems) || !Array.isArray(lineItems) || lineItems.length === 0) {
    return activeItems;
  }
  return activeItems.map((row) => {
    if (!row || row.isRemoved) return row;
    const match = lineItems.find(
      (si) => String(si.item_identifier || '').trim() === String(row.id).trim()
    );
    const pk = match?.upload_session_item_id;
    if (pk == null) return row;
    return { ...row, upload_session_item_id: pk };
  });
}

export function webEposCategoryPathLabelsFromUploadItem(item) {
  const hint = getAiSuggestedCgStockCategoryFromItem(item);
  if (hint) {
    if (Array.isArray(hint.pathSegments) && hint.pathSegments.length) {
      return hint.pathSegments.map((s) => String(s).trim()).filter(Boolean);
    }
    if (hint.categoryPath != null && String(hint.categoryPath).trim()) {
      return String(hint.categoryPath)
        .split(/[›>]/g)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (item?.categoryObject?.name) {
    return [String(item.categoryObject.name).trim()].filter(Boolean);
  }
  return [];
}

/**
 * One row → extension payload for Web EPOS `/products/new` autofill.
 *
 * @param {object} item — upload negotiation row
 * @param {string[]} verifiedBarcodes — NosPos stock barcodes (uses first)
 * @returns {object|null}
 */
export function buildWebEposProductCreatePayloadFromUploadRow(item, verifiedBarcodes) {
  if (!item || item.isRemoved) return null;
  const codes = Array.isArray(verifiedBarcodes) ? verifiedBarcodes : [];
  const stockBc = String(codes[0] || '').trim();
  if (!stockBc) return null;

  const pk = uploadSessionItemPrimaryKeyForBarcode(item);
  if (pk == null) return null;
  const ts = formatWebEposUploadBarcodeTimestamp();
  const barcode = `${stockBc}-${ts}-ID:${pk}`;

  const rrp = resolveUploadPipelineSalePrice(item);
  const price =
    rrp != null && Number.isFinite(Number(rrp)) && Number(rrp) > 0 ? Number(rrp).toFixed(2) : '0';

  const cost = parseMoney(item.uploadNosposStockFromBarcode?.costPrice);
  const costStr = cost != null ? cost.toFixed(2) : '0';

  const labels = webEposCategoryPathLabelsFromUploadItem(item);

  const displayName = resolveUploadTableItemName(item);
  const title = displayName === '—' ? 'Product' : displayName.slice(0, 150);

  return {
    title,
    price,
    costPrice: costStr,
    wasPrice: '0',
    quantity: 1,
    condition: 'refurbished',
    grade: 'B',
    barcode,
    intro: displayName === '—' ? '' : displayName.slice(0, 10000),
    fulfilmentOption: 'anyfulfilment',
    categoryPathLabels: labels,
  };
}
