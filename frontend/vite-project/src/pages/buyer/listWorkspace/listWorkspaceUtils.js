/** Pure helpers for repricing / upload list workspaces (shared by useListWorkspaceNegotiation). */

export const barcodeCap = (f) =>
  Number.isFinite(f.maxBarcodesPerItem) ? f.maxBarcodesPerItem : Infinity;

export function getNosposIdFromUrl(stockUrl) {
  if (!stockUrl) return "";
  try {
    const url = new URL(stockUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("stock");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = parts[idx + 1];
      return /^\d+$/.test(candidate) ? candidate : "";
    }
    return "";
  } catch {
    return "";
  }
}

export function openBarcodePrintTab(itemsData) {
  if (!Array.isArray(itemsData) || !itemsData.length) return;
  const ids = Array.from(
    new Set(
      itemsData
        .map((item) => getNosposIdFromUrl(item.stock_url))
        .filter((id) => id && id.trim() !== "")
    )
  );
  if (!ids.length) return;
  const stockIdsParam = encodeURIComponent(ids.join(","));
  window.open(`https://nospos.com/print/barcode?stock_ids=${stockIdsParam}`, "_blank", "noopener");
}

export const buildSessionSavePayload = (payload) => ({
  cart_key: payload?.cart_key || "",
  item_count: payload?.item_count || 0,
  barcode_count: payload?.barcode_count || 0,
  items_data: Array.isArray(payload?.items_data) ? payload.items_data : [],
});

export const buildAmbiguousBarcodeEntries = (payload) =>
  (Array.isArray(payload?.ambiguous_barcodes) ? payload.ambiguous_barcodes : []).map((entry) => ({
    itemId: entry?.itemId,
    itemTitle: entry?.itemTitle || "Unknown Item",
    barcodeIndex: entry?.barcodeIndex,
    oldBarcode: entry?.barcode || "",
    replacementBarcode: "",
  }));

export const buildUnverifiedBarcodeEntries = (payload) =>
  (Array.isArray(payload?.unverified_barcodes) ? payload.unverified_barcodes : []).map((entry) => ({
    itemId: entry?.itemId,
    itemTitle: entry?.itemTitle || "Unknown Item",
    barcodeIndex: entry?.barcodeIndex,
    barcode: entry?.barcode || "",
    stockBarcode: entry?.stockBarcode || "",
    stockUrl: entry?.stockUrl || "",
  }));

/** User-facing strings for repricing vs upload workspace (upload opens Web EPOS via the extension). */
export function negotiationWorkspaceCopy(isUpload) {
  if (isUpload) {
    return {
      workspace: "upload",
      saveFailLog: "[CG Suite] Upload save failed:",
      listName: "upload list",
      removedFromList: (title) => `"${title || "Item"}" removed from upload list`,
      addedOne: (title) => `Added "${title || "Item"}" to upload list`,
      addedMany: (n) => `${n} item${n !== 1 ? "s" : ""} added to upload list`,
      loadingList: "Loading upload list...",
      newConfirmTitle: "Start a new upload?",
      newConfirmBody:
        "This will clear your current upload list and start fresh from the upload workspace.",
      newConfirmYes: "Yes, start new upload",
      contextRemoveLabel: "Remove from upload list",
      jobCompletedMessage: "Upload completed.",
      persistSavedWithIssues: (uv) =>
        uv > 0
          ? `Saved upload items. ${uv} barcode(s) couldn't be verified — check below.`
          : "Saved the upload items. Some barcodes need to be more specific.",
      persistNoItemsRetry: "No items were updated. Enter more specific barcodes to retry.",
      persistDoneWithUnverified: (uv) =>
        `Upload done. ${uv} barcode(s) couldn't be auto-verified — check the items below.`,
      persistDoneSaved: "Upload is done and has been saved.",
      persistNoItems: "No items were updated.",
      persistSaveError: "Upload finished but could not be saved.",
      startBackground: "Opening Web EPOS…",
      jobLogStart: "Opening Web EPOS…",
      webEposOpened: "Web EPOS opened successfully.",
      webEposOpenFailed: "Could not open Web EPOS.",
      uploadExactlyOneBarcode: (title) =>
        `Add exactly one verified barcode for: ${title || "Unknown Item"}`,
      cancelOk: "Upload cancelled",
      cancelErr: "Could not cancel upload",
    };
  }
  return {
    workspace: "repricing",
    saveFailLog: "[CG Suite] Repricing save failed:",
    listName: "reprice list",
    removedFromList: (title) => `"${title || "Item"}" removed from reprice list`,
    addedOne: (title) => `Added "${title || "Item"}" to reprice list`,
    addedMany: (n) => `${n} item${n !== 1 ? "s" : ""} added to reprice list`,
    loadingList: "Loading reprice list...",
    newConfirmTitle: "Start a new repricing?",
    newConfirmBody:
      "This will clear your current reprice list and start fresh from the repricing workspace.",
    newConfirmYes: "Yes, start new repricing",
    contextRemoveLabel: "Remove from reprice list",
    jobCompletedMessage: "Repricing completed.",
    persistSavedWithIssues: (uv) =>
      uv > 0
        ? `Saved repriced items. ${uv} barcode(s) couldn't be verified — check below.`
        : "Saved the repriced items. Some barcodes need to be more specific.",
    persistNoItemsRetry: "No items were repriced. Enter more specific barcodes to retry.",
    persistDoneWithUnverified: (uv) =>
      `Repricing done. ${uv} barcode(s) couldn't be auto-verified — check the items below.`,
    persistDoneSaved: "Repricing is done and has been saved.",
    persistNoItems: "No items were repriced.",
    persistSaveError: "Repricing finished but could not be saved.",
    startBackground: "Starting background repricing…",
    jobLogStart: "Starting background repricing…",
    cancelOk: "Repricing cancelled",
    cancelErr: "Could not cancel repricing",
  };
}
