/**
 * Repricing module handler.
 *
 * Cart-level behaviour is shared with the upload module — both pull from the
 * list-workspace factory. If repricing ever needs bespoke behaviour that
 * diverges from upload, replace the factory call below with a tailored
 * implementation; the store API stays stable.
 */

import { REPRICE_WORKSPACE } from '../descriptors.js';
import { createListWorkspaceHandler } from './listWorkspaceHandler.js';

export const repriceHandler = createListWorkspaceHandler(REPRICE_WORKSPACE);
