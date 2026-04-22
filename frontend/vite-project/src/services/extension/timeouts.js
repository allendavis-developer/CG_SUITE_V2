/** Use with `openNosposSiteOnly`: login plus up to 12 full page loads (extension allows 90s each). */
export const OPEN_NOSPOS_SITE_CATEGORY_TIMEOUT_MS = 12 * 95000;

/** Use with `openNosposSiteForFields` (login + one modify page). */
export const OPEN_NOSPOS_SITE_FIELD_TIMEOUT_MS = 12 * 95000;

/** Bulk field scrape: many modify pages × ~90s load cap each (2h default). */
export const OPEN_NOSPOS_BULK_CATEGORY_FIELDS_TIMEOUT_MS = 120 * 60 * 1000;

/** Default cap for extension calls that should not leave the UI stuck (e.g. open NosPos site flows). */
export const OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS = 28000;

/** Open new agreement + wait for NosPos items URL (`openNosposNewAgreementCreateBackground` polls the tab ~120s). */
export const OPEN_NOSPOS_NEW_AGREEMENT_ITEMS_TAB_TIMEOUT_MS = 130000;

/** Same timeout/message as upload flows; races `openWebEposUpload` so the UI cannot hang. */
export const WEB_EPOS_UPLOAD_CLIENT_TIMEOUT_MS = 65000;

export const WEB_EPOS_UPLOAD_TIMEOUT_MESSAGE =
  'Web EPOS did not respond in time. Try again or refresh this page.';
