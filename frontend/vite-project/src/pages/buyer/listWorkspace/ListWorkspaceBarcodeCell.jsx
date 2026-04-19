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
  const hasBarcodes = itemBarcodes.length > 0;
  const single = maxBarcodesPerItem === 1;
  const lk = nosposLookups[`${item.id}_0`];
  const uploadMono =
    useUploadSessions && single && hasBarcodes
      ? String(lk?.stockBarcode || itemBarcodes[0] || "").trim() || itemBarcodes[0]
      : null;
  const ready = isItemReadyForRepricing(item.id);

  return (
    <td>
      <button
        type="button"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all w-full ${
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
        <span
          className={`flex-1 text-left ${useUploadSessions && single && hasBarcodes ? "font-mono" : ""}`}
        >
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
    </td>
  );
});
