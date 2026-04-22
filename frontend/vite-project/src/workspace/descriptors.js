/**
 * One descriptor per workspace "kind". Collapses the scattered branches of
 * `mode === 'repricing' ? ... : ...` and `repricingWorkspaceKind === 'upload'`
 * into a single data-driven lookup — a precondition for the full unification
 * outlined in IDEAL_SYSTEM_ARCHITECTURE §1.4.
 *
 * This module is additive: the store still carries two cart arrays; readers
 * that want to stop branching can call `getActiveWorkspaceDescriptor(state)`
 * and use the descriptor's fields instead of switching on mode / kind.
 */

/**
 * @typedef {object} WorkspaceDescriptor
 * @property {'buyer'|'reprice'|'upload'} kind
 * @property {string} label
 * @property {string} listNoun            — copy label for cart/list
 * @property {string} homePath            — default home route
 * @property {string} negotiationPath     — default negotiation route
 * @property {'cartItems'|'repricingCartItems'} cartStateKey — legacy, until unified
 * @property {string} sessionEndpoint     — backend session collection path
 */

/** @type {WorkspaceDescriptor} */
export const BUYER_WORKSPACE = Object.freeze({
  kind: 'buyer',
  label: 'Buying',
  listNoun: 'cart',
  homePath: '/',
  negotiationPath: '/negotiation',
  cartStateKey: 'cartItems',
  sessionEndpoint: '/requests/',
});

/** @type {WorkspaceDescriptor} */
export const REPRICE_WORKSPACE = Object.freeze({
  kind: 'reprice',
  label: 'Reprice',
  listNoun: 'reprice list',
  homePath: '/repricing',
  negotiationPath: '/repricing-negotiation',
  cartStateKey: 'repricingCartItems',
  sessionEndpoint: '/repricing-sessions/',
});

/** @type {WorkspaceDescriptor} */
export const UPLOAD_WORKSPACE = Object.freeze({
  kind: 'upload',
  label: 'Upload',
  listNoun: 'upload list',
  homePath: '/upload',
  negotiationPath: '/upload-negotiation',
  cartStateKey: 'repricingCartItems',
  sessionEndpoint: '/upload-sessions/',
});

export const WORKSPACES = Object.freeze({
  buyer: BUYER_WORKSPACE,
  reprice: REPRICE_WORKSPACE,
  upload: UPLOAD_WORKSPACE,
});

/**
 * Resolve the descriptor for a store state. Accepts any object carrying
 * `mode` and `repricingWorkspaceKind` (i.e. the existing store shape).
 */
export function getActiveWorkspaceDescriptor(state) {
  if (!state) return BUYER_WORKSPACE;
  if (state.mode !== 'repricing') return BUYER_WORKSPACE;
  if (state.repricingWorkspaceKind === 'upload') return UPLOAD_WORKSPACE;
  return REPRICE_WORKSPACE;
}

/** The active cart array from a store state, without branching in the caller. */
export function getActiveCart(state) {
  const descriptor = getActiveWorkspaceDescriptor(state);
  return state?.[descriptor.cartStateKey] ?? [];
}

/** True when the state represents a workspace kind in the given set. */
export function isWorkspaceKind(state, ...kinds) {
  const descriptor = getActiveWorkspaceDescriptor(state);
  return kinds.includes(descriptor.kind);
}
