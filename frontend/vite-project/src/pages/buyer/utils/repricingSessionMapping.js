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
  for (const si of sessionItems) {
    const id = si.item_identifier;
    if (!id || !si.stock_barcode) continue;
    if (!byItemId[id]) byItemId[id] = [];
    byItemId[id].push({
      barserial: si.stock_barcode,
      href: si.stock_url || '',
      name: si.title || '',
    });
  }
  return (cartItems || []).map((item) => {
    const mapped = byItemId[item.id] || [];
    if (mergeExisting) {
      const existing = item.nosposBarcodes || [];
      return { ...item, nosposBarcodes: deduplicateBarcodes([...existing, ...mapped]) };
    }
    return mapped.length ? { ...item, nosposBarcodes: mapped } : item;
  });
}

export { deduplicateBarcodes };

