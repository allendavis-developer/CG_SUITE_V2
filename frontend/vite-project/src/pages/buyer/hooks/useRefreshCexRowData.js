import { useCallback } from 'react';
import {
  applyCeXProductDataToItem,
  buildInitialSearchQuery,
  mergeCeXPencilLookupIntoItem,
  shouldPromptCeXPencilRrpSource,
} from '../utils/negotiationHelpers';

export function useRefreshCexRowData({
  handleAddFromCeX,
  clearCexProduct,
  setItems,
  showNotification,
  useVoucherOffers = false,
  /** Negotiation only: open modal to confirm committing CeX as RRP/offers source after lookup. */
  setCexPencilRrpSourceModal = null,
  /** Optional: called with the merged row after CeX data is written (e.g. upload CG + NosPos category). */
  onAfterCexRowUpdated = null,
}) {
  return useCallback(
    async (item) => {
      const searchQuery = buildInitialSearchQuery(item);
      const cexData = await handleAddFromCeX({
        showNotification,
        /** Pencil must wait for pricing rules / reference tiers; header "Add from CeX" may use false for snappier UI. */
        awaitPricing: true,
        ...(searchQuery ? { searchQuery } : {}),
      });
      if (!cexData) return;
      let openPencilModal = false;
      setItems((prev) => {
        const live = prev.find((r) => r.id === item.id) || item;
        const usePencilMerge = Boolean(setCexPencilRrpSourceModal && shouldPromptCeXPencilRrpSource(live));
        openPencilModal = usePencilMerge;
        const next = usePencilMerge
          ? mergeCeXPencilLookupIntoItem(live, cexData)
          : applyCeXProductDataToItem(live, cexData, useVoucherOffers);
        setTimeout(() => onAfterCexRowUpdated?.(next), 0);
        return prev.map((row) => (row.id === item.id ? next : row));
      });
      if (openPencilModal) setCexPencilRrpSourceModal({ itemId: item.id });
      clearCexProduct();
    },
    [
      handleAddFromCeX,
      showNotification,
      setItems,
      useVoucherOffers,
      clearCexProduct,
      setCexPencilRrpSourceModal,
      onAfterCexRowUpdated,
    ]
  );
}

