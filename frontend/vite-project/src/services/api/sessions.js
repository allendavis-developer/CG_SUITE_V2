import { apiFetch } from './http';

// ─── Repricing sessions ─────────────────────────────────────────────────────

export const saveRepricingSession = async (payload) => {
  if (!payload) return null;
  return apiFetch('/repricing-sessions/', { method: 'POST', body: payload });
};

export const updateRepricingSession = async (sessionId, updates, { keepalive = false } = {}) => {
  if (!sessionId) return null;
  return apiFetch(`/repricing-sessions/${sessionId}/`, { method: 'PATCH', body: updates, keepalive });
};

export const fetchRepricingSessionsOverview = async () => apiFetch('/repricing-sessions/overview/');

export const quickRepriceLookup = async (pairs) => {
  if (!pairs?.length) return { found: [], not_found: [] };
  return apiFetch('/quick-reprice/lookup/', { method: 'POST', body: { pairs } });
};

export const fetchRepricingSessionDetail = async (id) => {
  if (!id) return null;
  return apiFetch(`/repricing-sessions/${id}/`);
};

// ─── Upload sessions (same payloads, separate tables) ───────────────────────

export const saveUploadSession = async (payload) => {
  if (!payload) return null;
  return apiFetch('/upload-sessions/', { method: 'POST', body: payload });
};

export const updateUploadSession = async (sessionId, updates, { keepalive = false } = {}) => {
  if (!sessionId) return null;
  return apiFetch(`/upload-sessions/${sessionId}/`, { method: 'PATCH', body: updates, keepalive });
};

export const fetchUploadSessionDetail = async (id) => {
  if (!id) return null;
  return apiFetch(`/upload-sessions/${id}/`);
};

export const fetchUploadSessionsOverview = async () => apiFetch('/upload-sessions/overview/');
