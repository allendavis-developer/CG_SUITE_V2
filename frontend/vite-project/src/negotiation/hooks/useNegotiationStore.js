import { useShallow } from 'zustand/react/shallow';
import useAppStore from '@/store/useAppStore';

/**
 * One selector returning every store field the negotiation page reads. Replaces
 * the 16 separate `useAppStore((s) => s.x)` calls in Negotiation.jsx so the page
 * re-renders only when one of these fields actually changes (and lint stops
 * complaining about the 16-deep dependency arrays downstream).
 *
 * This is the seed for the NegotiationController extraction — a single-point
 * subscription that upcoming work can wrap with per-domain facets (cart,
 * workspace, customer) without touching the page shell again.
 */
export function useNegotiationStore() {
  return useAppStore(
    useShallow((s) => ({
      storeCartItems: s.cartItems,
      storeCustomerData: s.customerData,
      storeRequest: s.request,
      headerWorkspaceOpen: s.headerWorkspaceOpen,
      headerWorkspaceMode: s.headerWorkspaceMode,
      selectedCategory: s.selectedCategory,
      selectCategory: s.selectCategory,
      handleAddFromCeX: s.handleAddFromCeX,
      cexLoading: s.cexLoading,
      createOrAppendRequestItem: s.createOrAppendRequestItem,
      setRequest: s.setRequest,
      setCustomerInStore: s.setCustomer,
      setStoreTransactionType: s.setTransactionType,
      cexProductData: s.cexProductData,
      setCexProductData: s.setCexProductData,
      clearCexProduct: s.clearCexProduct,
    }))
  );
}
