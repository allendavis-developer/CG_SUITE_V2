/**
 * Single place for "what the global store should look like when entering buyer/repricing routes".
 * React Router navigation and Zustand previously overlapped in App.jsx with large inline patches.
 */

export const ROUTE_ENTRY_CUSTOMER = {
  id: null,
  name: 'No Customer Selected',
  cancelRate: 0,
  transactionType: 'sale',
};

/** Intentional handoff: cart, quote resume, or back-from-negotiation — Negotiation reads location.state first. */
export function isBuyerNavigationHandoff(st) {
  if (!st || typeof st !== 'object') return false;
  if (st.preserveCart === true) return true;
  if (st.openQuoteRequest?.current_status === 'QUOTE') return true;
  if (Array.isArray(st.cartItems) && st.cartItems.length > 0) return true;
  if (st.currentRequestId != null && st.currentRequestId !== '') return true;
  return false;
}

export const REPRICING_WORKSPACE_PATHS = {
  repricingHomePath: '/repricing',
  repricingNegotiationPath: '/repricing-negotiation',
};

export const UPLOAD_WORKSPACE_PATHS = {
  repricingHomePath: '/upload',
  repricingNegotiationPath: '/upload-negotiation',
};

/** Repricing session restore from overview / sidebar / redo. */
export function isRepricingNavigationHandoff(st) {
  if (!st || typeof st !== 'object') return false;
  if (st.sessionId != null && st.sessionId !== '') return true;
  if (Array.isArray(st.cartItems) && st.cartItems.length > 0) return true;
  if (st.sessionBarcodes && Object.keys(st.sessionBarcodes).length > 0) return true;
  if (st.sessionNosposLookups && Object.keys(st.sessionNosposLookups).length > 0) return true;
  return false;
}

/** Apply store updates for /buyer and /negotiation on each navigation (one atomic setState). */
export function bootstrapBuyerWorkspaceFromRoute(locationState, setState) {
  if (isBuyerNavigationHandoff(locationState)) {
    setState((s) => ({
      mode: 'buyer',
      repricingWorkspaceKind: 'repricing',
      cartItems: [],
      repricingSessionId: null,
      repricingCartItems: [],
      ...REPRICING_WORKSPACE_PATHS,
      resetKey: s.resetKey + 1,
    }));
    return;
  }

  setState((s) => ({
    mode: 'buyer',
    repricingWorkspaceKind: 'repricing',
    cartItems: [],
    repricingCartItems: [],
    repricingSessionId: null,
    ...REPRICING_WORKSPACE_PATHS,
    customerData: { ...ROUTE_ENTRY_CUSTOMER },
    intent: null,
    request: null,
    selectedCategory: null,
    availableModels: [],
    selectedModel: null,
    selectedCartItemId: null,
    cexProductData: null,
    cexLoading: false,
    isQuickRepriceOpen: false,
    isCustomerModalOpen: true,
    resetKey: s.resetKey + 1,
    repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
  }));
}

/** Apply store updates for /repricing and /repricing-negotiation on each navigation. */
export function bootstrapRepricingWorkspaceFromRoute(locationState, setState, workspacePaths = REPRICING_WORKSPACE_PATHS) {
  const repricingWorkspaceKind =
    workspacePaths?.repricingHomePath === '/upload' ? 'upload' : 'repricing';

  if (isRepricingNavigationHandoff(locationState)) {
    setState((s) => ({
      mode: 'repricing',
      repricingWorkspaceKind,
      repricingSessionId: locationState.sessionId ?? null,
      repricingCartItems: [],
      ...workspacePaths,
      cartItems: [],
      customerData: { ...ROUTE_ENTRY_CUSTOMER },
      intent: null,
      request: null,
      selectedCategory: null,
      availableModels: [],
      selectedModel: null,
      selectedCartItemId: null,
      cexProductData: null,
      cexLoading: false,
      isQuickRepriceOpen: false,
      isCustomerModalOpen: false,
      resetKey: s.resetKey + 1,
    }));
    return;
  }

  setState((s) => ({
    mode: 'repricing',
    repricingWorkspaceKind,
    repricingSessionId: null,
    repricingCartItems: [],
    ...workspacePaths,
    selectedCategory: null,
    selectedModel: null,
    selectedCartItemId: null,
    cexProductData: null,
    cexLoading: false,
    isQuickRepriceOpen: false,
    cartItems: [],
    customerData: { ...ROUTE_ENTRY_CUSTOMER },
    intent: null,
    request: null,
    isCustomerModalOpen: false,
    repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
    resetKey: s.resetKey + 1,
  }));
}
