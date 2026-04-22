import { sendMessage } from '@/services/extensionBridge';
import { OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS } from './timeouts';

/**
 * The one primitive for calling the Chrome extension. New code should prefer
 * this over writing another `extensionClient.js` one-line wrapper.
 *
 *   callExtension('startWaitingForData', { competitor: 'CeX' })
 *   callExtension('openNosposSiteForCategoryFieldsBulk', { nosposCategoryIds }, { onProgress })
 *
 * The `action` string must match an entry in chrome-extension/flows/bridge/actions/registry.js.
 */
export function callExtension(action, payload = {}, options = {}) {
  return sendMessage({ action, ...payload }, options);
}

/**
 * Race an extension call so the UI never stays in a loading state forever if the bridge hangs.
 */
export function withExtensionCallTimeout(
  promise,
  ms = OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS,
  timeoutMessage
) {
  const msg =
    timeoutMessage ||
    'NoSpos did not respond in time. If you closed the app tab or the extension stalled, try again. If a button stays stuck, refresh this page.';
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

/**
 * True when getData / refine resolved without data because the user closed the listing tab
 * or cancelled. Handles `{ cancelled: true }` and payloads that only include the tab-closed message.
 */
export function isExtensionListingFlowAborted(result) {
  if (result == null) return false;
  if (result.cancelled === true) return true;
  if (result.success === true) return false;
  const msg = String(result.error || '');
  return /tab was closed/i.test(msg);
}
