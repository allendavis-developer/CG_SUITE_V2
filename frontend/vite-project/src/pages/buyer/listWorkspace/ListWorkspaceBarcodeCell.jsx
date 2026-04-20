import React, { memo } from "react";

export const ListWorkspaceBarcodeCell = memo(function ListWorkspaceBarcodeCell({
  item,
  barcodes,
  nosposLookups,
  useUploadSessions,
  maxBarcodesPerItem,
  isItemReadyForRepricing,
  onOpenModal,
}) {
  const itemBarcodes = barcodes[item.id] || [];
  const fromItemMeta =
    useUploadSessions && maxBarcodesPerItem === 1 && item.nosposBarcodes?.[0]?.barserial
      ? [String(item.nosposBarcodes[0].barserial).trim()].filter(Boolean)
      : [];
  const effectiveBarcodes = itemBarcodes.length > 0 ? itemBarcodes : fromItemMeta;
  const hasBarcodes = effectiveBarcodes.length > 0;
  const single = maxBarcodesPerItem === 1;
  const lk = nosposLookups[`${item.id}_0`];
  const uploadMono =
    useUploadSessions && single && hasBarcodes
      ? String(lk?.stockBarcode || effectiveBarcodes[0] || "").trim() || effectiveBarcodes[0]
      : null;
  const ready = isItemReadyForRepricing(item.id);
  const nosposStockUrl = (() => {
    const u = lk?.stockUrl && String(lk.stockUrl).trim();
    if (u) return u;
    const href = item?.nosposBarcodes?.[0]?.href;
    if (!href || typeof href !== "string") return "";
    const t = href.trim();
    if (!t) return "";
    return /^https?:\/\//i.test(t) ? t : `https://nospos.com${t.startsWith("/") ? t : `/${t}`}`;
  })();

  /** Upload list (single line): once a barcode exists it is fixed — show as text, not an editable control. */
  const uploadBarcodeLocked = useUploadSessions && single && hasBarcodes;
  const lockedDisplayText =
    uploadMono || (effectiveBarcodes[0] != null ? String(effectiveBarcodes[0]).trim() : "");

  if (uploadBarcodeLocked) {
    return (
      <td className="align-top">
        <div className="min-w-0 px-1 py-1.5 text-xs font-semibold leading-snug text-slate-800">
          {nosposStockUrl ? (
            <a
              href={nosposStockUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this stock line on NosPos"
              className="break-all font-mono text-[13px] underline decoration-solid underline-offset-2"
              style={{ color: "var(--brand-blue)" }}
            >
              {lockedDisplayText}
            </a>
          ) : (
            <span className="break-all font-mono text-[13px] text-slate-800">{lockedDisplayText}</span>
          )}
        </div>
      </td>
    );
  }

  return (
    <td>
      <div className="flex w-full min-w-0 items-stretch gap-1">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
            hasBarcodes
              ? ready
                ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
          }`}
          onClick={onOpenModal}
          title={single ? "Click to edit barcode" : "Click to manage barcodes"}
        >
          <span className="material-symbols-outlined text-[14px]">barcode</span>
          <span className="flex-1 text-left">
            {uploadMono
              ? uploadMono
              : hasBarcodes
                ? ready
                  ? single
                    ? "Barcode verified"
                    : "Barcodes verified"
                  : single
                    ? "Barcode needs review"
                    : "Barcodes need review"
                : single
                  ? "Add barcode"
                  : "Add barcodes"}
          </span>
          {ready && <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>}
          {hasBarcodes && !ready && (
            <span className="material-symbols-outlined text-[14px] text-amber-600">pending</span>
          )}
          {!hasBarcodes && <span className="material-symbols-outlined text-[14px] text-red-500">error</span>}
        </button>
      </div>
    </td>
  );
});
