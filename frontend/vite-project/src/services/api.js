import { getCSRFToken } from '../utils/helpers';

const API_BASE = '/api';

/** Public base for same-origin API URLs (used by a few pages that call `fetch` directly). */
export const API_BASE_URL = API_BASE;

async function apiFetch(path, options = {}) {
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
      errorMessage = errData.error || errData.detail || errData.phone_number?.[0] || errData.name?.[0] || errData.email?.[0] || errorMessage;
    } catch {
      try { await res.text(); } catch {}
    }
    throw new Error(errorMessage);
  }

  if (res.status === 204 || method === 'DELETE') return null;
  return res.json();
}

// ─── Products ──────────────────────────────────────────────────────────────────

export const fetchProductModels = async (category) => {
  if (!category?.id) return [];
  try {
    const data = await apiFetch(`/products/?category_id=${category.id}`);
    return data.map((p) => ({ model_id: p.product_id, name: p.name, product_id: p.product_id }));
  } catch (err) {
    console.error('Error fetching product models:', err);
    return [];
  }
};

export const fetchAttributes = async (productId) => {
  if (!productId) return null;
  try {
    const data = await apiFetch(`/product-variants/?product_id=${productId}`);
    return {
      attributes: data.attributes.map((a) => ({ name: a.label, code: a.code, values: a.values })),
      dependencies: data.dependencies,
      variants: data.variants,
    };
  } catch (err) {
    console.error('Error fetching attributes:', err);
    return null;
  }
};

export const fetchVariantPrices = async (sku) => {
  if (!sku) return { cash_offers: [], voucher_offers: [], referenceData: null };
  try {
    const data = await apiFetch(`/variant-prices/?sku=${sku}`);
    return { cash_offers: data.cash_offers || [], voucher_offers: data.voucher_offers || [], referenceData: data.reference_data };
  } catch (err) {
    console.error('Error fetching offers:', err);
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }
};

export const fetchCeXProductPrices = async (cexData) => {
  if (!cexData) return { cash_offers: [], voucher_offers: [], referenceData: null };
  try {
    const data = await apiFetch('/cex-product-prices/', {
      method: 'POST',
      body: {
        sell_price: cexData.sellPrice,
        tradein_cash: cexData.tradeInCash,
        tradein_voucher: cexData.tradeInVoucher,
        title: cexData.title,
        category: cexData.category,
        image: cexData.image,
        image_url: cexData.image,
        sku: cexData.id,
      },
    });
    return { cash_offers: data.cash_offers || [], voucher_offers: data.voucher_offers || [], referenceData: data.reference_data };
  } catch (err) {
    console.error('[CG Suite] fetchCeXProductPrices error:', err);
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }
};

// ─── Requests ──────────────────────────────────────────────────────────────────

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

export const finishRequest = async (requestId, payload) => {
  if (!requestId || !payload) throw new Error('Request ID and payload required');
  return apiFetch(`/requests/${requestId}/finish/`, { method: 'POST', body: payload });
};

export const saveQuoteDraft = async (requestId, payload, { keepalive = false } = {}) => {
  if (!requestId || !payload) return null;
  return apiFetch(`/requests/${requestId}/finish/`, {
    method: 'POST',
    body: { ...payload, request_not_completed: true },
    keepalive,
  });
};

// ─── Request Items ─────────────────────────────────────────────────────────────

export const deleteRequestItem = async (requestItemId) => {
  if (!requestItemId) return;
  await apiFetch(`/request-items/${requestItemId}/`, { method: 'DELETE' });
};

export const updateRequestItemOffer = async (requestItemId, data) => {
  if (!requestItemId || !data) return;
  await apiFetch(`/request-items/${requestItemId}/update-offer/`, { method: 'PATCH', body: data });
};

export const updateRequestItemRawData = async (requestItemId, data) => {
  if (!requestItemId || !data) return null;
  try {
    return await apiFetch(`/request-items/${requestItemId}/update-raw/`, { method: 'POST', body: data });
  } catch (err) {
    console.error('Error updating request item raw data:', err);
    return null;
  }
};

// ─── Customers ─────────────────────────────────────────────────────────────────

export const createCustomer = async (customerData) => {
  if (!customerData?.name) return null;
  return apiFetch('/customers/', { method: 'POST', body: customerData });
};

export const getOrCreateCustomer = async (customerData) => {
  if (!customerData?.name) return null;
  if (customerData.phone_number) {
    try {
      const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.phone_number)}`);
      const results = Array.isArray(data) ? data : (data.results ?? []);
      const match = results.find((c) => c.phone_number === customerData.phone_number);
      if (match) return match;
    } catch {}
  }
  try {
    const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.name)}`);
    const results = Array.isArray(data) ? data : (data.results ?? []);
    const match = results.find((c) => c.name?.toLowerCase() === customerData.name.toLowerCase());
    if (match) return match;
  } catch {}
  return createCustomer(customerData);
};

export const updateCustomer = async (customerId, updates) => {
  if (!customerId || !updates) return null;
  return apiFetch(`/customers/${customerId}/`, { method: 'PATCH', body: updates });
};

// ─── Repricing ─────────────────────────────────────────────────────────────────

export const saveRepricingSession = async (payload) => {
  if (!payload) return null;
  return apiFetch('/repricing-sessions/', { method: 'POST', body: payload });
};

export const createRepricingSessionDraft = async ({ cart_key, item_count, session_data }) => {
  return apiFetch('/repricing-sessions/', {
    method: 'POST',
    body: { cart_key, item_count, session_data },
  });
};

export const updateRepricingSession = async (sessionId, updates, { keepalive = false } = {}) => {
  if (!sessionId) return null;
  return apiFetch(`/repricing-sessions/${sessionId}/`, {
    method: 'PATCH',
    body: updates,
    keepalive,
  });
};

export const fetchRepricingSessionsOverview = async () => {
  return apiFetch('/repricing-sessions/overview/');
};

export const quickRepriceLookup = async (pairs) => {
  if (!pairs?.length) return { found: [], not_found: [] };
  return apiFetch('/quick-reprice/lookup/', { method: 'POST', body: { pairs } });
};

export const fetchRepricingSessionDetail = async (id) => {
  if (!id) return null;
  return apiFetch(`/repricing-sessions/${id}/`);
};

// ─── Pricing Rules ─────────────────────────────────────────────────────────────

export const fetchPricingRules = () => apiFetch('/pricing-rules/');
export const createPricingRule = (data) => apiFetch('/pricing-rules/', { method: 'POST', body: data });
export const updatePricingRule = (id, data) => apiFetch(`/pricing-rules/${id}/`, { method: 'PATCH', body: data });
export const deletePricingRule = (id) => apiFetch(`/pricing-rules/${id}/`, { method: 'DELETE' });
export const fetchEbayOfferMargins = (categoryId) =>
  apiFetch(`/ebay-offer-margins/${categoryId ? `?category_id=${categoryId}` : ''}`);

// ─── Categories ────────────────────────────────────────────────────────────────

export const fetchAllCategoriesFlat = () => apiFetch('/all-categories/');
