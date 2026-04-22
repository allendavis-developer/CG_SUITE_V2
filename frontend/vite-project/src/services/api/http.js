import { getCSRFToken } from '@/utils/helpers';

const API_BASE = '/api';

/** Public base for same-origin API URLs (used by a few pages that call `fetch` directly). */
export const API_BASE_URL = API_BASE;

export async function apiFetch(path, options = {}) {
  const { method = 'GET', body, keepalive } = options;
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRFToken'] = getCSRFToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(keepalive ? { keepalive } : {}),
  });

  if (!res.ok) {
    let errorMessage = `Request failed (${res.status})`;
    try {
      const errData = await res.json();
      errorMessage =
        errData.error ||
        errData.detail ||
        errData.phone_number?.[0] ||
        errData.name?.[0] ||
        errData.email?.[0] ||
        errorMessage;
    } catch {
      try {
        await res.text();
      } catch {
        /* swallow: response body already consumed or network error */
      }
    }
    throw new Error(errorMessage);
  }

  if (res.status === 204 || method === 'DELETE') return null;
  return res.json();
}

/**
 * Session-scoped single-flight cache: call once per browser session, share in-flight
 * promise with all concurrent callers, then serve from the resolved value forever.
 *
 * Used by nospos categories / mappings where the payload is large, mostly static,
 * and requested from 8+ places during quote hydration.
 */
export function memoizeForSession(loader) {
  let payload = null;
  let inflight = null;
  const get = () => {
    if (payload != null) return Promise.resolve(payload);
    if (inflight) return inflight;
    inflight = loader()
      .then((data) => {
        payload = data;
        inflight = null;
        return data;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
    return inflight;
  };
  get.peek = () => payload;
  return get;
}

/**
 * Per-request-item mutation queue so concurrent PATCH/POSTs against the same
 * request item serialise on the client (API treats them as last-write-wins).
 */
const requestItemMutationQueues = new Map();

export function queueRequestItemMutation(requestItemId, operation) {
  if (!requestItemId) {
    return Promise.resolve().then(operation);
  }
  const key = String(requestItemId);
  const previous = requestItemMutationQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (requestItemMutationQueues.get(key) === next) {
        requestItemMutationQueues.delete(key);
      }
    });
  requestItemMutationQueues.set(key, next);
  return next;
}
