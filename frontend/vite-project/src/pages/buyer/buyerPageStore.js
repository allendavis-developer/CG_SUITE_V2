/**
 * Persists buyer vs repricing page state separately so that switching between
 * /buyer and /repricing preserves each page's own state (cart, category, etc.).
 */

const STORE_KEYS = {
  buyer: 'buyerPageStore_buyer',
  repricing: 'buyerPageStore_repricing',
};

function getStorageKey(mode) {
  return mode === 'repricing' ? STORE_KEYS.repricing : STORE_KEYS.buyer;
}

export const defaultSnapshot = () => ({
  selectedCategory: null,
  availableModels: [],
  selectedModel: null,
  cartItems: [],
  selectedCartItemId: null,
  customerData: {
    id: null,
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale',
  },
  intent: null,
  requestId: null,
  isCustomerModalOpen: undefined,
  cexProductData: null,
});

/**
 * Load persisted snapshot for the given mode (buyer | repricing).
 * @returns {Object} Snapshot or default if none saved / parse error.
 */
export function loadSnapshot(mode) {
  try {
    const raw = sessionStorage.getItem(getStorageKey(mode));
    if (!raw) return defaultSnapshot();
    const parsed = JSON.parse(raw);
    return { ...defaultSnapshot(), ...parsed };
  } catch {
    return defaultSnapshot();
  }
}

/**
 * Clear persisted snapshot for the given mode (resets to defaults).
 * @param {string} mode - 'buyer' | 'repricing'
 */
export function clearSnapshot(mode) {
  try {
    sessionStorage.removeItem(getStorageKey(mode));
  } catch (e) {
    console.warn('[buyerPageStore] clear failed', e);
  }
}

/**
 * Save a snapshot for the given mode.
 * @param {string} mode - 'buyer' | 'repricing'
 * @param {Object} snapshot - Plain object with state to persist (see defaultSnapshot).
 */
export function saveSnapshot(mode, snapshot) {
  try {
    const toStore = {
      selectedCategory: snapshot.selectedCategory,
      availableModels: snapshot.availableModels || [],
      selectedModel: snapshot.selectedModel,
      cartItems: snapshot.cartItems || [],
      selectedCartItemId: snapshot.selectedCartItemId ?? null,
      // Persist full customerData object so the sidebar's enriched stats
      // (joined, lastTransacted, rates, counts, etc.) survive module switches.
      customerData: snapshot.customerData
        ? { ...defaultSnapshot().customerData, ...snapshot.customerData }
        : defaultSnapshot().customerData,
      intent: snapshot.intent ?? null,
      requestId: snapshot.requestId ?? null,
      isCustomerModalOpen: snapshot.isCustomerModalOpen,
      cexProductData: snapshot.cexProductData ?? null,
    };
    sessionStorage.setItem(getStorageKey(mode), JSON.stringify(toStore));
  } catch (e) {
    console.warn('[buyerPageStore] save failed', e);
  }
}
