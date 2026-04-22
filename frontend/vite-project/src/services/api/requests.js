import { apiFetch, queueRequestItemMutation } from './http';

export const createRequest = async (requestData) => {
  if (!requestData) return null;
  return apiFetch('/requests/', { method: 'POST', body: requestData });
};

export const addRequestItem = async (requestId, itemData) => {
  if (!requestId || !itemData) throw new Error('Request ID and item data are required');
  const data = await apiFetch(`/requests/${requestId}/items/`, { method: 'POST', body: itemData });
  if (!data?.request_item_id) throw new Error('Invalid response: missing request_item_id');
  return data;
};

export const fetchRequestDetail = async (requestId) => {
  if (!requestId) return null;
  try {
    return await apiFetch(`/requests/${requestId}/`);
  } catch (err) {
    console.error('Error fetching request detail:', err);
    return null;
  }
};

export async function fetchRequestsOverview(statusFilter = 'ALL') {
  const query =
    statusFilter && statusFilter !== 'ALL'
      ? `?status=${encodeURIComponent(statusFilter)}`
      : '';
  const data = await apiFetch(`/requests/overview/${query}`);
  return Array.isArray(data) ? data : [];
}

export const finishRequest = async (requestId, payload) => {
  if (!requestId || !payload) throw new Error('Request ID and payload required');
  return apiFetch(`/requests/${requestId}/finish/`, { method: 'POST', body: payload });
};

export const saveParkAgreementState = async (requestId, state) => {
  if (!requestId) return null;
  return apiFetch(`/requests/${requestId}/park-state/`, { method: 'PATCH', body: state });
};

export const updateRequestNegotiationFields = async (requestId, data) => {
  if (!requestId || !data) return null;
  return apiFetch(`/requests/${requestId}/negotiation-fields/`, { method: 'PATCH', body: data });
};

export const saveQuoteDraft = async (requestId, payload, { keepalive = false } = {}) => {
  if (!requestId || !payload) return null;
  return apiFetch(`/requests/${requestId}/finish/`, {
    method: 'POST',
    body: { ...payload, request_not_completed: true },
    keepalive,
  });
};

export const deleteRequestItem = async (requestItemId) => {
  if (!requestItemId) return;
  await apiFetch(`/request-items/${requestItemId}/`, { method: 'DELETE' });
};

export const updateRequestItemOffer = async (requestItemId, data) => {
  if (!requestItemId || !data) return;
  await queueRequestItemMutation(requestItemId, () =>
    apiFetch(`/request-items/${requestItemId}/update-offer/`, { method: 'PATCH', body: data })
  );
};

export const updateRequestItemRawData = async (requestItemId, data) => {
  if (!requestItemId || !data) return null;
  try {
    const result = await queueRequestItemMutation(requestItemId, () =>
      apiFetch(`/request-items/${requestItemId}/update-raw/`, { method: 'POST', body: data })
    );
    if (result == null) {
      console.error('[CG Suite][api] updateRequestItemRawData: empty response (possible auth/404)', { requestItemId });
      return null;
    }
    return result;
  } catch (err) {
    console.error('[CG Suite][api] updateRequestItemRawData failed:', err?.message || err, { requestItemId });
    return null;
  }
};
