/**
 * Factory for list-workspace handlers (reprice + upload).
 *
 * Reprice and upload workspaces share the same cart-and-selection mechanics
 * (no per-item backend persistence; state is flushed to a session on save).
 * Each module still gets its own handler instance with its own descriptor so
 * copy, routes, and endpoints stay isolated.
 *
 * If their behaviour ever diverges, replace the factory call in the
 * corresponding repriceHandler.js / uploadHandler.js with a bespoke
 * implementation — the store consumers do not need to change.
 */

import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import {
  findDuplicateIndex,
  recalcOffersForTransactionType,
  coerceQuantity,
} from './shared.js';
import { runSelectionHydration } from './buyerHandler.js';

export function createListWorkspaceHandler(descriptor) {
  const CART_KEY = descriptor.cartStateKey;
  const LIST_NOUN = descriptor.listNoun;

  return {
    kind: descriptor.kind,
    descriptor,

    addToCart({ set, get }, item, { showNotification } = {}) {
      const cartItems = get()[CART_KEY];

      if (item.forceNew) {
        const { forceNew: _, ...clean } = item;
        set({ [CART_KEY]: [...cartItems, clean] });
        showNotification?.(`${clean.title} added to cart as a new item`, 'success');
        return;
      }

      const existingIdx = findDuplicateIndex(cartItems, item);
      const existing = existingIdx !== -1 ? cartItems[existingIdx] : null;

      const msg = existing
        ? `${item.title} is already in the ${LIST_NOUN}`
        : `${item.title} added to cart`;

      set((state) => {
        const items = [...state[CART_KEY]];
        const idx = findDuplicateIndex(items, item);
        if (idx === -1) return { [CART_KEY]: [...items, item] };
        const ex = items[idx];
        items[idx] = { ...ex, ...item, id: ex.id, quantity: 1 };
        return { [CART_KEY]: items };
      });

      setTimeout(() => showNotification?.(msg, 'success'), 0);
    },

    updateCartItem({ set }, itemId, updates) {
      const nextUpdates = { ...updates };
      if (nextUpdates.quantity != null) {
        nextUpdates.quantity = coerceQuantity(nextUpdates.quantity);
      }
      set((state) => ({
        [CART_KEY]: state[CART_KEY].map((i) => (i.id === itemId ? { ...i, ...nextUpdates } : i)),
      }));
    },

    updateCartItemOffers({ set }, cartItemId, updatedOfferData) {
      const merged = { ...updatedOfferData };
      set((state) => ({
        [CART_KEY]: state[CART_KEY].map((i) => (i.id === cartItemId ? { ...i, ...merged } : i)),
      }));
    },

    setTransactionType({ set, get }, newType) {
      const { customerData } = get();
      if (newType === customerData.transactionType) return;

      const cartItems = get()[CART_KEY];
      const prevUseVoucher = customerData.transactionType === 'store_credit';
      const newUseVoucher = newType === 'store_credit';

      const nextCartItems = cartItems.map((item) =>
        recalcOffersForTransactionType(item, prevUseVoucher, newUseVoucher)
      );

      set({
        customerData: { ...customerData, transactionType: newType },
        intent: mapTransactionTypeToIntent(newType),
        [CART_KEY]: nextCartItems,
      });
    },

    async resetWorkspace({ set, get }, { showNotification } = {}) {
      set({
        selectedCategory: null,
        availableModels: [],
        selectedModel: null,
        [CART_KEY]: [],
        selectedCartItemId: null,
        isCustomerModalOpen: false,
        cexProductData: null,
        cexLoading: false,
        isQuickRepriceOpen: false,
        repricingSessionId: null,
        resetKey: get().resetKey + 1,
      });

      showNotification?.(`${descriptor.label} workspace reset`, 'success');
    },

    async selectCartItem({ set, get }, item) {
      const { selectedCartItemId, customerData } = get();
      if (selectedCartItemId === item.id) return;
      await runSelectionHydration({ set, get, item, customerData, cartKey: CART_KEY });
    },
  };
}
