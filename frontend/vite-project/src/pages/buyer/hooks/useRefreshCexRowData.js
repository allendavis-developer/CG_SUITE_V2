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
}) {
  return useCallback(
    async (item) => {
      const searchQuery = buildInitialSearchQuery(item);
      const cexData = await handleAddFromCeX({
        showNotification,
        ...(searchQuery ? { searchQuery } : {}),
      });
      if (!cexData) return;
      if (setCexPencilRrpSourceModal && shouldPromptCeXPencilRrpSource(item)) {
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? mergeCeXPencilLookupIntoItem(row, cexData) : row))
        );
        setCexPencilRrpSourceModal({ itemId: item.id });
      } else {
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? applyCeXProductDataToItem(row, cexData, useVoucherOffers) : row
          )
        );
      }
      clearCexProduct();
    },
    [
      handleAddFromCeX,
      showNotification,
      setItems,
      useVoucherOffers,
      clearCexProduct,
      setCexPencilRrpSourceModal,
    ]
  );
}

