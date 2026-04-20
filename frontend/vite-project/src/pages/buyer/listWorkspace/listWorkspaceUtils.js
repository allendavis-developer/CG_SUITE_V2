/** Pure helpers for repricing / upload list workspaces (shared by useListWorkspaceNegotiation). */

import { getCartKey } from "@/utils/repricingProgress";

/** `lookupKey` is `${ownerId}_${barcodeIndex}`; owner id may contain other `_` only if malformed — UUIDs are safe. */
export function nosposLookupKeyToOwnerId(lookupKey) {
  const s = String(lookupKey);
  const i = s.lastIndexOf("_");
  if (i <= 0) return "";
  return s.slice(0, i);
}

/** Fields persisted on negotiation rows for DB session snapshots (superset of “new session” item rows). */
const NEGOTIATION_SESSION_ITEM_KEYS = [
  "id",
  "title",
  "subtitle",
  "category",
  "model",
  "cexSellPrice",
  "cexBuyPrice",
  "cexVoucherPrice",
  "cexUrl",
  "ourSalePrice",
  "ourSalePriceInput",
  "cexOutOfStock",
  "cexProductData",
  "isCustomCeXItem",
  "isCustomEbayItem",
  "isCustomCashConvertersItem",
  "condition",
  "categoryObject",
  "nosposBarcodes",
  "ebayResearchData",
  "cashConvertersResearchData",
  "cgResearchData",
  "quantity",
  "isRemoved",
  "variantId",
  "cexSku",
  "attributeValues",
  "referenceData",
  "offers",
  "cashOffers",
  "voucherOffers",
  "image",
  "rrpOffersSource",
  "offersSource",
  /** Upload workspace: NosPos stock-edit scrape snapshot for the barcode line. */
  "uploadNosposStockFromBarcode",
  /** AI / manual CG retail category hint (persisted with draft session). */
  "aiSuggestedCgStockCategory",
  /** AI NosPos stock category + field hints (same as negotiation raw_data mirrors). */
  "aiSuggestedNosposStockCategory",
  "aiSuggestedNosposStockFieldValues",
  /** Upload: row is waiting for a CeX/header product (table order, not a separate FIFO list). */
  "isUploadBarcodeQueuePlaceholder",
  /** Set when the server has created a `pricing_upload_session_item` row (Web EPOS barcode suffix). */
  "upload_session_item_id",
  /** Upload list: optional override for the “Item name & attributes” column / Web EPOS title. */
  "uploadTableItemName",
];

export function pickNegotiationItemForSession(item) {
  const o = {};
  for (const k of NEGOTIATION_SESSION_ITEM_KEYS) {
    o[k] = item[k];
  }
  return o;
}

/**
 * Build `barcodes` / `nosposLookups` maps from items that already carry `nosposBarcodes` metadata.
 */
export function buildNosposMapsFromNegotiationItems(items, maxBarcodesPerItem) {
  const barcodes = {};
  const nosposLookups = {};
  for (const item of items) {
    const rawBarcodes = item.nosposBarcodes || [];
    const seen = new Set();
    const uniqueBarcodes = rawBarcodes.filter((b) => {
      const key = b.barserial || "";
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const cappedBarcodes = uniqueBarcodes.slice(0, maxBarcodesPerItem);
    if (cappedBarcodes.length === 0) continue;
    barcodes[item.id] = cappedBarcodes.map((b) => b.barserial);
    cappedBarcodes.forEach((b, index) => {
      nosposLookups[`${item.id}_${index}`] = {
        status: "selected",
        results: b.href
          ? [{ barserial: b.barserial, href: b.href.replace(/^https:\/\/nospos\.com/i, "") }]
          : [],
        stockBarcode: b.barserial,
        stockName: b.name || "",
        stockUrl: b.href || "",
      };
    });
  }
  return { barcodes, nosposLookups };
}

/** Slot ids for upload rows still waiting for a catalog line (same order as `items` in the UI). */
export function uploadPendingSlotIdsFromItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i && !i.isRemoved && i.isUploadBarcodeQueuePlaceholder).map((i) => String(i.id));
}

export function listWorkspaceCartKeyFromState(state, useUploadSessions) {
  const active = (state.items || []).filter((i) => !i.isRemoved);
  if (!useUploadSessions || active.length > 0) return getCartKey(active);
  const scanSlots = Array.isArray(state.uploadScanSlotIds) ? state.uploadScanSlotIds : [];
  const pending = uploadPendingSlotIdsFromItems(state.items || []);
  const idle = [...scanSlots, ...pending].join("|");
  return idle ? `upload-scan:${idle}` : "";
}

/**
 * True if upload workspace state should be persisted: at least one typed barcode in `barcodes`,
 * or a non-removed item with a NosPos barserial (e.g. queue row after intake).
 */
export function uploadWorkspaceHasRecordedBarcode(state) {
  if (!state || typeof state !== "object") return false;
  const map = state.barcodes || {};
  for (const codes of Object.values(map)) {
    if (Array.isArray(codes) && codes.some((c) => String(c ?? "").trim() !== "")) {
      return true;
    }
  }
  for (const item of state.items || []) {
    if (item?.isRemoved) continue;
    const raw = item?.nosposBarcodes || [];
    if (raw.some((b) => String(b?.barserial ?? "").trim() !== "")) {
      return true;
    }
  }
  return false;
}

export function buildNegotiationSessionDataSnapshot(state, useUploadSessions) {
  const {
    items: snapshotItems,
    barcodes: snapshotBarcodes,
    nosposLookups: snapshotLookups,
    uploadScanSlotIds: snapshotUploadSlots,
    uploadPendingSlotIds: snapshotPendingSlots,
    uploadBarcodeIntakeOpen: snapshotIntakeOpen,
    uploadBarcodeIntakeDone: snapshotIntakeDone,
    uploadStockDetailsBySlotId: snapshotStockDetails,
  } = state;
  const derivedUploadPending =
    useUploadSessions && Array.isArray(snapshotItems)
      ? uploadPendingSlotIdsFromItems(snapshotItems)
      : Array.isArray(snapshotPendingSlots)
        ? snapshotPendingSlots
        : [];
  const snapshot = {
    items: (snapshotItems || []).map(pickNegotiationItemForSession),
    barcodes: snapshotBarcodes,
    nosposLookups: snapshotLookups,
    uploadScanSlotIds: Array.isArray(snapshotUploadSlots) ? snapshotUploadSlots : [],
    uploadPendingSlotIds: derivedUploadPending,
    uploadBarcodeIntakeOpen: Boolean(snapshotIntakeOpen),
    uploadBarcodeIntakeDone: Boolean(snapshotIntakeDone),
  };
  if (useUploadSessions) {
    snapshot.uploadBarcodeWorkspace = buildUploadBarcodeWorkspaceSnapshot({
      uploadScanSlotIds: snapshot.uploadScanSlotIds,
      uploadPendingSlotIds: snapshot.uploadPendingSlotIds,
      uploadBarcodeIntakeOpen: snapshot.uploadBarcodeIntakeOpen,
      uploadBarcodeIntakeDone: snapshot.uploadBarcodeIntakeDone,
      barcodes: snapshot.barcodes,
      nosposLookups: snapshot.nosposLookups,
    });
    snapshot.uploadStockDetailsBySlotId = sanitizeUploadStockDetailsMap(snapshotStockDetails || {});
  }
  return snapshot;
}

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

export const UPLOAD_BARCODE_WORKSPACE_VERSION = 1;

/**
 * Normalised upload barcode queue for `session_data` (resume from reports / DB).
 * Slot ids are stable UUIDs; order is scan then pending (deduped).
 */
export function buildUploadBarcodeWorkspaceSnapshot(state) {
  if (!state) return null;
  const scanOrder = Array.isArray(state.uploadScanSlotIds) ? state.uploadScanSlotIds.map(String) : [];
  const pendingOrder = Array.isArray(state.uploadPendingSlotIds) ? state.uploadPendingSlotIds.map(String) : [];
  const barcodes = state.barcodes || {};
  const lookups = state.nosposLookups || {};
  const seen = new Set();
  const lines = [];
  for (const slotId of [...scanOrder, ...pendingOrder]) {
    if (!slotId || seen.has(slotId)) continue;
    seen.add(slotId);
    const raw = barcodes[slotId];
    const codes = Array.isArray(raw)
      ? raw.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const lk = lookups[`${slotId}_0`];
    let nospos = null;
    if (lk && typeof lk === "object") {
      nospos = {
        status: lk.status || "",
        stockBarcode: lk.stockBarcode || "",
        stockName: lk.stockName || "",
        stockUrl: typeof lk.stockUrl === "string" ? lk.stockUrl.trim() : "",
        error: typeof lk.error === "string" ? lk.error : "",
        results: Array.isArray(lk.results)
          ? lk.results.map((r) => ({
              barserial: r?.barserial || "",
              href: typeof r?.href === "string" ? r.href : "",
              name: r?.name || "",
            }))
          : [],
      };
    }
    lines.push({ slotId: String(slotId), barcodes: codes, nospos });
  }
  return {
    version: UPLOAD_BARCODE_WORKSPACE_VERSION,
    intakeOpen: Boolean(state.uploadBarcodeIntakeOpen),
    intakeDone: Boolean(state.uploadBarcodeIntakeDone),
    scanOrder,
    pendingOrder,
    lines,
  };
}

/** Rebuild client state maps from a persisted workspace snapshot. */
export function expandUploadBarcodeWorkspace(workspace) {
  if (!workspace || workspace.version !== UPLOAD_BARCODE_WORKSPACE_VERSION) return null;
  const barcodes = {};
  const nosposLookups = {};
  for (const line of workspace.lines || []) {
    const slotId = line?.slotId;
    if (!slotId) continue;
    if (Array.isArray(line.barcodes) && line.barcodes.length) {
      barcodes[String(slotId)] = line.barcodes.map((c) => String(c).trim()).filter(Boolean);
    }
    const n = line.nospos;
    if (n && typeof n === "object" && n.status) {
      const stockUrl = typeof n.stockUrl === "string" ? n.stockUrl.trim() : "";
      let href = "";
      if (stockUrl) {
        try {
          const u = new URL(stockUrl);
          href = u.pathname + u.search;
        } catch {
          href = "";
        }
      }
      const relHref = href.startsWith("/") ? href : href ? `/${href}` : "";
      const stockBarcode = n.stockBarcode || "";
      let results = Array.isArray(n.results) ? n.results : [];
      if (n.status === "selected" && stockUrl && (!results || !results.length)) {
        results = relHref || stockBarcode ? [{ barserial: stockBarcode, href: relHref }] : [];
      }
      nosposLookups[`${slotId}_0`] = {
        status: n.status,
        stockBarcode,
        stockName: n.stockName || "",
        stockUrl: stockUrl || (relHref ? `https://nospos.com${relHref}` : ""),
        ...(n.error ? { error: n.error } : {}),
        results,
      };
    }
  }
  return {
    uploadScanSlotIds: (workspace.scanOrder || []).map(String),
    uploadPendingSlotIds: (workspace.pendingOrder || []).map(String),
    uploadBarcodeIntakeOpen: Boolean(workspace.intakeOpen),
    uploadBarcodeIntakeDone: Boolean(workspace.intakeDone),
    barcodes,
    nosposLookups,
  };
}

/** Strip in-flight rows; keep only persisted NosPos scrape fields per slot. */
export function sanitizeUploadStockDetailsMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const [k, v] of Object.entries(map)) {
    if (!v || v.loading) continue;
    const entry = {
      stockUrl: v.stockUrl,
      error: v.error,
      name: v.name,
      createdAt: v.createdAt,
      boughtBy: v.boughtBy,
      costPrice: v.costPrice,
      retailPrice: v.retailPrice,
    };
    if (Array.isArray(v.changeLog)) entry.changeLog = v.changeLog;
    out[k] = entry;
  }
  return out;
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
      uploadContextGetDataFromDatabase: "Get data using database",
      uploadContextDatabaseFlyoutTitle: "Builder category headers (from database)",
      uploadContextDatabaseCategoriesLoading: "Loading categories…",
      jobCompletedMessage: "Upload completed.",
      uploadRestartInWorkspace: "Restart in workspace",
      uploadRestartedInWorkspaceToast: "Session reopened — you can edit the list or run upload again.",
      uploadRestartSessionError: "Could not reopen the upload session.",
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
      uploadOpeningWebEposNewProduct: "Opening Web EPOS new product page…",
      uploadWebEposNeedServerLineIds:
        "Each upload row needs a saved server line id before Web EPOS can build the barcode. Wait for autosave to finish, or refresh after saving the draft, then try again.",
      uploadWebEposNewProductOpened: "Web EPOS finished creating your products in the minimised window.",
      webEposProductsSyncing: "Loading Web EPOS products…",
      uploadHubTitle: "Web EPOS products",
      uploadHubSubtitle:
        "Review the live product list from Web EPOS. When you are ready to add lines and barcodes, continue to the upload workspace.",
      uploadHubEnterButton: "Upload new",
      uploadHubScrapeFailed: "Could not sync the product list",
      uploadHubRetrySync: "Retry sync",
      uploadHubEmptyNoRows: "No rows were returned for this page. You can still start an upload below.",
      uploadHubEmptyAfterError: "Fix the issue above or retry, then start an upload when you are ready.",
      jobLogStart: "Opening Web EPOS…",
      webEposOpened: "Web EPOS opened successfully.",
      webEposOpenFailed: "Could not open Web EPOS.",
      uploadExactlyOneBarcode: (title) =>
        `Add exactly one verified barcode for: ${title || "Unknown Item"}`,
      uploadScanAllVerified: "Every barcode must be verified on NosPos before continuing.",
      uploadScanNeedOneLine: "Add at least one barcode line first.",
      uploadAddMoreBarcodes: "Add more barcodes",
      uploadAddMoreBarcodesTitle: "Open the barcode step again to scan more lines. Existing barcodes stay in the list.",
      uploadIntakeMergedExistingOnly: "Barcode step closed — your list is up to date.",
      uploadPickLineForCeX:
        "Click “Find CeX product” on the barcode row you are filling, then add from the CeX header.",
      uploadMergeReady: "CeX header is set to fill this row — add the product from CeX.",
      uploadAddBarcodesFirst:
        "Add and verify every NosPos barcode in step 1 before you can add items.",
      uploadFindCeXLineFirst:
        "That line is not waiting for a CeX product, or you need to click “Find CeX product” on the row first.",
      uploadNoDirectAddsNoNewLines:
        "Each upload line is tied to one barcode from step 1. You cannot add loose items here — start a new upload to scan more barcodes.",
      uploadNoEbayLines: "Upload lists only use CeX on barcode rows, not eBay research items.",
      uploadFinishBarcodeIntakeFirst: "Finish the barcode step first.",
      uploadNoBarcodesLeft: "No barcodes left to assign. Add more in a new upload session if needed.",
      uploadPendingBarcodesRemain: "Assign every barcode to a line (add items) before proceeding.",
      uploadBarcodeReplaceOnly:
        "This line already has a barcode from step 1. Type a new barcode and use Replace — you can’t clear it with remove.",
      uploadRrpMustBePositive: "Upload RRP must be greater than £0.",
      uploadEveryRrpRequiredHint: "Set Upload RRP for every item before proceeding.",
      uploadRrpUpdatedFromSource: "Upload RRP updated from selected source.",
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
