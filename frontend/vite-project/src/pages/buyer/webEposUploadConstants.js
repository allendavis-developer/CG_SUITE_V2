/** Single source for Upload ↔ Web EPOS URLs and sessionStorage keys (extension + SPA). */

export const WEB_EPOS_PRODUCTS_URL = 'https://webepos.cashgenerator.co.uk/products';

/** Set before navigating back from the products page so the upload gate does not reopen Web EPOS. */
export const WEB_EPOS_UPLOAD_SKIP_GATE_KEY = 'cgUploadSkipNextWebEposGate';

/** Persist scraped table while on `/upload/webepos-products` so returning via skip-gate can restore it. */
export const WEB_EPOS_PRODUCTS_SNAPSHOT_KEY = 'cgUploadWebEposProductsSnapshot';

/** After the worker was closed, reopen flow stores the last URL here for the next gate run. */
export const WEB_EPOS_REOPEN_URL_KEY = 'cgWebEposReopenUrl';
