import { apiFetch } from './http';

/**
 * Web EPOS category hierarchy (backed by the `webepos_categories` table).
 *
 * GET  /webepos-categories/  → `{ ok: true, rows: [{ webepos_category_id, webepos_uuid, name, parent_category_id, level }] }`
 * POST /webepos-categories/  → body `{ nodes: [{ webepos_uuid, name, parent_webepos_uuid?, level }] }`
 *                              upserts by `webepos_uuid` and returns the fresh rows plus `{ added, updated }`.
 */

/** Fetch the flat list of Web EPOS categories currently saved in the DB. */
export async function fetchWebeposCategoriesFlat() {
  return apiFetch('/webepos-categories/');
}

/**
 * Send the scraped tree back to Django. `nodes` is the flat array returned by
 * the extension walker; parent relationships are expressed via `parent_webepos_uuid`
 * so the Django view can upsert without caring about insertion order.
 */
export async function saveWebeposCategoriesFromScrape(nodes) {
  return apiFetch('/webepos-categories/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: Array.isArray(nodes) ? nodes : [] }),
  });
}
