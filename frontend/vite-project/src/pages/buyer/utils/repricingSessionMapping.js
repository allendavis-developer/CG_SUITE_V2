function deduplicateBarcodes(barcodes) {
  if (!Array.isArray(barcodes)) return [];
  const seen = new Set();
  return barcodes.filter((b) => {
    const key = b?.barserial || b?.barcode || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function attachBarcodesFromSessionItems(cartItems, sessionItems, { mergeExisting = true } = {}) {
  if (!Array.isArray(sessionItems) || sessionItems.length === 0) return cartItems;
  const byItemId = {};
  const uploadSessionItemPkByLineId = {};
  for (const si of sessionItems) {
    const id = si.item_identifier;
    if (!id) continue;
    if (si.upload_session_item_id != null) {
      uploadSessionItemPkByLineId[String(id)] = si.upload_session_item_id;
    }
    if (!si.stock_barcode) continue;
    if (!byItemId[id]) byItemId[id] = [];
    byItemId[id].push({
      barserial: si.stock_barcode,
      href: si.stock_url || '',
      name: si.title || '',
    });
  }
  return (cartItems || []).map((item) => {
    const mapped = byItemId[item.id] || [];
    const uploadPk = uploadSessionItemPkByLineId[String(item.id)];
    const withPk =
      uploadPk != null ? { ...item, upload_session_item_id: uploadPk } : { ...item };
    if (mergeExisting) {
      const existing = withPk.nosposBarcodes || [];
      return { ...withPk, nosposBarcodes: deduplicateBarcodes([...existing, ...mapped]) };
    }
    return mapped.length ? { ...withPk, nosposBarcodes: mapped } : withPk;
  });
}

export { deduplicateBarcodes };

