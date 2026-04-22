/**
 * Workspace handler registry.
 *
 * Each of the three modules (buyer, reprice, upload) ships its own handler;
 * the store resolves the active descriptor and delegates cart / selection
 * operations to the corresponding handler. No more `if (mode === 'repricing')`
 * branching at the call site.
 *
 * Shared mechanics live in ./shared.js (pure helpers) and ./listWorkspaceHandler.js
 * (reprice + upload share cart semantics).
 */

import { buyerHandler } from './buyerHandler.js';
import { repriceHandler } from './repriceHandler.js';
import { uploadHandler } from './uploadHandler.js';
import { getActiveWorkspaceDescriptor } from '../descriptors.js';

export const HANDLERS = Object.freeze({
  buyer: buyerHandler,
  reprice: repriceHandler,
  upload: uploadHandler,
});

/** Return the handler for a store state, mirroring getActiveWorkspaceDescriptor. */
export function getActiveHandler(state) {
  const descriptor = getActiveWorkspaceDescriptor(state);
  const handler = HANDLERS[descriptor.kind];
  if (!handler) throw new Error(`No handler registered for workspace kind: ${descriptor.kind}`);
  return handler;
}

export { buyerHandler, repriceHandler, uploadHandler };
