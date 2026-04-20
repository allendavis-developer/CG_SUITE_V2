import React from "react";
import TinyModal from "@/components/ui/TinyModal";
import { applyRrpAndOffersFromPriceSource } from "@/pages/buyer/utils/negotiationHelpers";
import { NEGOTIATION_ROW_CONTEXT } from "@/pages/buyer/rowContextZones";

/**
 * After CeX pencil lookup on a row that was not already CeX-sourced for RRP, asks whether to
 * commit CeX sell + tier offers to the RRP column (and highlight), matching right-click
 * "Use as RRP/offers source" on the CeX column.
 */
export default function CexPencilRrpSourceModal({
  modalState,
  items,
  setItems,
  onClose,
  useVoucherOffers = false,
  showNotification,
  /** Optional: called with the row after CeX RRP/offers apply succeeds (e.g. upload CG pipeline). */
  onAfterCexRrpCommit = null,
}) {
  if (!modalState?.itemId) return null;
  const item = items.find((i) => i.id === modalState.itemId);
  if (!item) return null;

  const applyYes = () => {
    let notify = null;
    let committed = null;
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== modalState.itemId) return i;
        const { item: applied, errorMessage } = applyRrpAndOffersFromPriceSource(
          i,
          NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL,
          useVoucherOffers
        );
        if (errorMessage) {
          notify = { type: "error", message: errorMessage };
          return i;
        }
        notify = { type: "success", message: "RRP and offers now use CeX sell." };
        committed = applied;
        return applied;
      })
    );
    if (notify) showNotification?.(notify.message, notify.type);
    if (notify?.type === "success" && committed) {
      setTimeout(() => onAfterCexRrpCommit?.(committed), 0);
    }
    onClose();
  };

  const keepNo = () => onClose();

  return (
    <TinyModal title="Use CeX as RRP source?" onClose={keepNo}>
      <p className="text-xs font-semibold mb-1" style={{ color: "var(--brand-blue)" }}>
        {item.title}
      </p>
      <p className="text-[11px] text-slate-600 mb-4">
        CeX prices are updated on this row. Choose whether the <span className="font-semibold">Our RRP</span>{" "}
        column and 1st–3rd offer tiers should follow CeX sell (and highlight the CeX column), or stay as they
        are now (e.g. eBay research).
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: "var(--ui-border)", color: "var(--text-muted)" }}
          onClick={keepNo}
        >
          No, keep current RRP &amp; offers
        </button>
        <button
          type="button"
          className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
          style={{ background: "var(--brand-blue)", color: "white" }}
          onClick={applyYes}
        >
          Yes, use CeX
        </button>
      </div>
    </TinyModal>
  );
}
