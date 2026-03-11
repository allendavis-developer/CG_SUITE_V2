export const REPRICING_PROGRESS_KEY = "cgRepricingProgress";

export function getCartKey(items) {
  if (!items?.length) return "";
  return items
    .map((i) => i.id)
    .filter(Boolean)
    .sort()
    .join("|");
}

export function loadRepricingProgress(cartKey) {
  try {
    const raw = localStorage.getItem(REPRICING_PROGRESS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const entry = data[cartKey];
    if (!entry) return null;
    return {
      barcodes: entry.barcodes || {},
      completedBarcodes: entry.completedBarcodes || {},
      completedItems: entry.completedItems || [],
    };
  } catch {
    return null;
  }
}

export function saveRepricingProgress(cartKey, { barcodes, completedBarcodes, completedItems }) {
  try {
    const raw = localStorage.getItem(REPRICING_PROGRESS_KEY) || "{}";
    const data = JSON.parse(raw);
    data[cartKey] = { barcodes: barcodes || {}, completedBarcodes: completedBarcodes || {}, completedItems: completedItems || [] };
    localStorage.setItem(REPRICING_PROGRESS_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("[CG Suite] Failed to save repricing progress:", err);
  }
}

export function clearRepricingProgress(cartKey) {
  if (!cartKey) return;
  try {
    const raw = localStorage.getItem(REPRICING_PROGRESS_KEY) || "{}";
    const data = JSON.parse(raw);
    delete data[cartKey];
    localStorage.setItem(REPRICING_PROGRESS_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("[CG Suite] Failed to clear repricing progress:", err);
  }
}
