import React from "react";
import TinyModal from "@/components/ui/TinyModal";
import { roundSalePrice } from "@/utils/helpers";
import { applyRrpAndOffersFromPriceSource } from "@/pages/buyer/utils/negotiationHelpers";
import { NEGOTIATION_ROW_CONTEXT } from "@/pages/buyer/rowContextZones";

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
 * @param {boolean} [useResearchSuggestedPrice=false] - When true (Negotiation), keep-old / fallback apply only updates useResearchSuggestedPrice for eBay
 * @param {string} [priceLabel='Our Sale Price'] - Label used in the modal copy
 * @param {boolean} [useVoucherOffers=false] - Negotiation: store credit vs cash; repricing uses false
 * @param {Function} [showNotification] - (message, type) for apply errors / success
 * @param {boolean} [repricingMode=false] - Repricing: update New Sale Price + set `rrpOffersSource` for column highlight; offers unchanged
 */
export default function SalePriceConfirmModal({
  modalState,
  items,
  setItems,
  onClose,
  useResearchSuggestedPrice = false,
  priceLabel = "Our Sale Price",
  useVoucherOffers = false,
  showNotification,
  repricingMode = false,
}) {
  if (!modalState) return null;

  const { itemId, oldPricePerUnit, newPricePerUnit, source } = modalState;
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const isZeroSuggestedPrice =
    modalState?.zeroSuggestedPrice === true ||
    (newPricePerUnit != null && !Number.isNaN(newPricePerUnit) && Number(newPricePerUnit) <= 0);

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
    const nextOurSale = String(roundSalePrice(newPricePerUnit));

    if (repricingMode) {
      const rrpZone =
        source === "ebay"
          ? NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY
          : NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== itemId) return i;
          const next = { ...i, ourSalePrice: nextOurSale, rrpOffersSource: rrpZone };
          delete next.ourSalePriceInput;
          return next;
        })
      );
      showNotification?.("New Sale Price updated from research.", "success");
      onClose();
      return;
    }

    const zone =
      source === "ebay"
        ? NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY
        : NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;

    let notify = null;
    setItems((prev) => {
      const live = prev.find((i) => i.id === itemId);
      if (!live) return prev;
      const { item: applied, errorMessage } = applyRrpAndOffersFromPriceSource(live, zone, useVoucherOffers);
      if (errorMessage) {
        notify = { type: "error", message: errorMessage };
        return prev.map((i) =>
          i.id !== itemId
            ? i
            : {
                ...i,
                ourSalePrice: nextOurSale,
                ...(useResearchSuggestedPrice && source === "ebay" ? { useResearchSuggestedPrice: true } : {}),
              }
        );
      }
      notify = { type: "success", message: "RRP and offers updated from this research." };
      return prev.map((i) => (i.id !== itemId ? i : { ...applied, ourSalePrice: nextOurSale }));
    });
    if (notify) showNotification?.(notify.message, notify.type);
    onClose();
  };

  const keepOldPrice = () => {
    if (repricingMode) {
      onClose();
      return;
    }
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        const next = { ...i };
        if (hasOld) {
          next.ourSalePrice = String(roundSalePrice(oldPricePerUnit));
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

  if (isZeroSuggestedPrice) {
    return (
      <TinyModal title={`Update ${priceLabel}?`} onClose={onClose}>
        <p className="text-xs font-semibold mb-1" style={{ color: "var(--brand-blue)" }}>
          {item.title}
        </p>
        <p className="text-[11px] text-slate-600 mb-4">
          {source === "ebay"
            ? `Based on the latest eBay research, the suggested ${repricingMode ? "New Sale Price" : "sale price"} is £0.00.`
            : `Based on the latest Cash Converters research, the suggested ${repricingMode ? "New Sale Price" : "sale price"} is £0.00.`}
        </p>
        <p className="text-[11px] text-slate-600 mb-4">
          {repricingMode ? (
            <>
              The suggested value is zero, so <span className="font-semibold">{priceLabel}</span> cannot be updated
              from this research. Nothing else on the row changes.
            </>
          ) : (
            <>
              Sale price is zero based on data, so <span className="font-semibold">{priceLabel}</span> cannot be
              updated from this research result.
            </>
          )}
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
            style={{ background: "var(--brand-blue)", color: "white" }}
            onClick={onClose}
          >
            Continue
          </button>
        </div>
      </TinyModal>
    );
  }

  return (
    <TinyModal title={`Update ${priceLabel}?`} onClose={keepOldPrice}>
      <p className="text-xs font-semibold mb-1" style={{ color: "var(--brand-blue)" }}>
        {item.title}
      </p>
      <p className="text-[11px] text-slate-600 mb-4">
        {repricingMode
          ? source === "ebay"
            ? "Based on the latest eBay research, a new RRP is available for the New Sale Price column."
            : "Based on the latest Cash Converters research, a new RRP is available for the New Sale Price column."
          : source === "ebay"
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
              {repricingMode ? "Reference before this research" : "Current sale price"}
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
        {repricingMode ? (
          <>
            If you confirm, the <span className="font-semibold">New Sale Price</span> updates to this value (your RRP
            for repricing), and the column for this research ({source === "ebay" ? "eBay" : "Cash Converters"}) will be
            highlighted as the source. 
          </>
        ) : (
          <>
            If you confirm, <span className="font-semibold">{priceLabel}</span> will use this value and your 1st–3rd
            tiers will be rebuilt from the same research, with that column highlighted as the RRP/offers source (same
            as right-click &quot;Use as RRP/offers source&quot;).
          </>
        )}
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
