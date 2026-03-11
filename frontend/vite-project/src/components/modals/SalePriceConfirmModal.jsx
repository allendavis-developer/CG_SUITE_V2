import React from "react";
import TinyModal from "@/components/ui/TinyModal";

/**
 * Shared "Update Our Sale Price?" modal for Negotiation and RepricingNegotiation.
 * When research returns a new suggested price, this asks the user whether to keep
 * the current value or update to the new one.
 *
 * @param {Object} props
 * @param {Object|null} modalState - { itemId, oldPricePerUnit, newPricePerUnit, source: 'ebay'|'cashConverters' }
 * @param {Array} items - Items array (to resolve item title)
 * @param {Function} setItems - State setter for items
 * @param {Function} onClose - Called when modal is dismissed (clears modal state in parent)
 * @param {boolean} [useResearchSuggestedPrice=false] - When true (Negotiation), apply/keep also updates useResearchSuggestedPrice
 * @param {string} [priceLabel='Our Sale Price'] - Label used in the modal copy
 */
export default function SalePriceConfirmModal({
  modalState,
  items,
  setItems,
  onClose,
  useResearchSuggestedPrice = false,
  priceLabel = "Our Sale Price",
}) {
  if (!modalState) return null;

  const { itemId, oldPricePerUnit, newPricePerUnit, source } = modalState;
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;

  const qty = item.quantity || 1;
  const hasOld = oldPricePerUnit != null && !Number.isNaN(oldPricePerUnit);

  const formatTotal = (perUnit) =>
    perUnit != null && !Number.isNaN(perUnit)
      ? `£${(perUnit * qty).toFixed(2)}`
      : "Not set";

  const formatPerUnit = (perUnit) =>
    perUnit != null && !Number.isNaN(perUnit) ? `£${perUnit.toFixed(2)}` : "—";

  const applyNewPrice = () => {
    if (newPricePerUnit == null || Number.isNaN(newPricePerUnit)) {
      onClose();
      return;
    }
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        return {
          ...i,
          ourSalePrice: newPricePerUnit.toFixed(2),
          ...(useResearchSuggestedPrice && source === "ebay" ? { useResearchSuggestedPrice: true } : {}),
        };
      })
    );
    onClose();
  };

  const keepOldPrice = () => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        const next = { ...i };
        if (hasOld) {
          next.ourSalePrice = oldPricePerUnit.toFixed(2);
        } else {
          next.ourSalePrice = "";
        }
        if (useResearchSuggestedPrice && source === "ebay") {
          next.useResearchSuggestedPrice = false;
        }
        return next;
      })
    );
    onClose();
  };

  return (
    <TinyModal title={`Update ${priceLabel}?`} onClose={keepOldPrice}>
      <p className="text-xs font-semibold mb-1" style={{ color: "var(--brand-blue)" }}>
        {item.title}
      </p>
      <p className="text-[11px] text-slate-600 mb-4">
        {source === "ebay"
          ? "Based on the latest eBay research, a new suggested sale price is available."
          : "Based on the latest Cash Converters research, a new suggested sale price is available."}
      </p>

      <div
        className="mb-4 border rounded-lg p-3"
        style={{ borderColor: "var(--ui-border)", background: "#f8fafc" }}
      >
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div
              className="text-[10px] font-black uppercase tracking-wider mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Current sale price
            </div>
            <div className="font-bold" style={{ color: "var(--brand-blue)" }}>
              {hasOld ? formatTotal(oldPricePerUnit) : "Not set"}
            </div>
            {qty > 1 && hasOld && (
              <div className="text-[9px] text-slate-500 mt-0.5">
                {formatPerUnit(oldPricePerUnit)} × {qty}
              </div>
            )}
          </div>
          <div>
            <div
              className="text-[10px] font-black uppercase tracking-wider mb-1"
              style={{ color: "var(--brand-blue)" }}
            >
              New from research
            </div>
            <div className="font-bold text-purple-700">{formatTotal(newPricePerUnit)}</div>
            {qty > 1 && newPricePerUnit != null && !Number.isNaN(newPricePerUnit) && (
              <div className="text-[9px] text-slate-500 mt-0.5">
                {formatPerUnit(newPricePerUnit)} × {qty}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-600 mb-4">
        Do you want to update <span className="font-semibold">{priceLabel}</span> to this new value?
      </p>

      <div className="flex gap-2">
        <button
          className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: "var(--ui-border)", color: "var(--text-muted)" }}
          onClick={keepOldPrice}
        >
          No, keep current
        </button>
        <button
          className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
          style={{ background: "var(--brand-blue)", color: "white" }}
          onClick={applyNewPrice}
        >
          Yes, update
        </button>
      </div>
    </TinyModal>
  );
}
