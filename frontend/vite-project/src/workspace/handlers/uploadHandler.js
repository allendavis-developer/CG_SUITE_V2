/**
 * Upload module handler.
 *
 * Cart-level behaviour is shared with repricing — both pull from the
 * list-workspace factory. Diverge this handler (swap the factory call for
 * bespoke logic) if upload ever needs different cart semantics.
 */

import { UPLOAD_WORKSPACE } from '../descriptors.js';
import { createListWorkspaceHandler } from './listWorkspaceHandler.js';

export const uploadHandler = createListWorkspaceHandler(UPLOAD_WORKSPACE);
