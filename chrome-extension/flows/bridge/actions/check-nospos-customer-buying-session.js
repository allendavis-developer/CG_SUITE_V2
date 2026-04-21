/**
 * Check whether a NosPos customer already has an in-progress buying session.
 *
 * Dispatched from flows/bridge/forward.js via the BRIDGE_ACTIONS registry.
 */
async function handleBridgeAction_checkNosposCustomerBuyingSession({ requestId, appTabId, payload }) {
  logPark('handleBridgeForward', 'enter', { action: 'checkNosposCustomerBuyingSession', nosposCustomerId: payload.nosposCustomerId }, 'Step 1: checking NoSpos customer buying session');
  return nosposFetchCustomerBuyingSession(payload.nosposCustomerId);
}
