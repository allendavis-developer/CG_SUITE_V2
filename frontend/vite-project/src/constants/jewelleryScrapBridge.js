/**
 * Jewellery scrap bridge: window postMessage type + extension bridge action.
 * Must match chrome-extension/content-bridge.js and jewellery-scrap/constants.js.
 */
export const JEWELLERY_SCRAP_WINDOW_MESSAGE = 'JEWELLERY_SCRAP_PRICES';

export const JEWELLERY_SCRAP_OPEN_TAB_ACTION = 'openJewelleryScrapPrices';

/** Poll ceiling matches CG_JEWELLERY_SCRAP.POLL_MAX × POLL_MS */
export const JEWELLERY_SCRAP_POLL_MS = 500;
export const JEWELLERY_SCRAP_POLL_MAX = 40;

export const JEWELLERY_SCRAP_POLL_CEILING_MS =
  JEWELLERY_SCRAP_POLL_MAX * JEWELLERY_SCRAP_POLL_MS;

export const JEWELLERY_SCRAP_LOADING_FALLBACK_MS =
  JEWELLERY_SCRAP_POLL_CEILING_MS + 15_000;
