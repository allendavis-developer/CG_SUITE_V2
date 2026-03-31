import { useCallback } from 'react';
import { applyCeXProductDataToItem, buildInitialSearchQuery } from '../utils/negotiationHelpers';

export function useRefreshCexRowData({
  handleAddFromCeX,
  clearCexProduct,
  setItems,
  showNotification,
  useVoucherOffers = false,
}) {
  return useCallback(
    async (item) => {
      const searchQuery = buildInitialSearchQuery(item);
      const cexData = await handleAddFromCeX({
        showNotification,
        ...(searchQuery ? { searchQuery } : {}),
      });
      if (!cexData) return;
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? applyCeXProductDataToItem(row, cexData, useVoucherOffers) : row
        )
      );
      // Row-level CeX refresh should not leave header workspace product state behind.
      clearCexProduct();
    },
    [handleAddFromCeX, showNotification, setItems, useVoucherOffers, clearCexProduct]
  );
}

