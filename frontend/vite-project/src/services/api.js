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

/** Same endpoints as negotiation category picker: all-categories → products → product-variants. */
const JEWELLERY_PRODUCT_ORDER = [
  'Earrings',
  'Scrap',
  'Bangles',
  'Rings',
  'Necklaces',
  'Bracelets',
  'Chains',
  'Pendant',
  'Bullion (gold)',
  'Coin',
  'Bullion (other)',
];

/** Labels aligned with the jewellery reference-price scrape (migrations 0038–0039). */
const JEWELLERY_SCRAPE_MATERIAL_GRADES = new Set([
  '9ct gold',
  '14ct gold',
  '18ct gold',
  '22ct gold',
  '24ct gold',
  'Silver',
  'Platinum',
  'Palladium',
  'Full Sovereign',
  'Half Sovereign',
  'Krugerrand',
]);

export async function fetchJewelleryCatalog() {
  try {
    const flatRes = await fetch(`${API_BASE_URL}/all-categories/`);
    const flatData = await flatRes.json();
    if (!flatRes.ok || !Array.isArray(flatData)) return null;

    const jew = flatData.find((c) => c.name === 'Jewellery');
    if (!jew?.category_id) return null;

    const prodRes = await fetch(`${API_BASE_URL}/products/?category_id=${jew.category_id}`);
    const productsRaw = await prodRes.json();
    if (!prodRes.ok || !Array.isArray(productsRaw)) return null;

    const pmap = new Map(productsRaw.map((p) => [p.name, p]));
    const products = [];
    for (const name of JEWELLERY_PRODUCT_ORDER) {
      const p = pmap.get(name);
      if (p) products.push({ product_id: p.product_id, name: p.name });
    }
    for (const p of productsRaw) {
      if (!JEWELLERY_PRODUCT_ORDER.includes(p.name)) {
        products.push({ product_id: p.product_id, name: p.name });
      }
    }

    const variantResults = await Promise.all(
      productsRaw.map((p) =>
        fetch(`${API_BASE_URL}/product-variants/?product_id=${p.product_id}`).then(async (r) => ({
          ok: r.ok,
          product: p,
          data: await r.json(),
        }))
      )
    );

    const variants = [];
    const gradeLabels = new Set();
    for (const { ok, product: p, data } of variantResults) {
      if (!ok || !data?.variants?.length) continue;
      for (const v of data.variants) {
        const sku = String(v.cex_sku || '');
        if (!sku.toUpperCase().startsWith('JEW-')) continue;
        const mg = v.attribute_values?.material_grade ?? '';
        if (!JEWELLERY_SCRAPE_MATERIAL_GRADES.has(mg)) continue;
        if (mg) gradeLabels.add(mg);
        variants.push({
          variant_id: v.variant_id,
          product_id: p.product_id,
          product_name: p.name,
          material_grade: mg,
          title: v.title,
          cex_sku: v.cex_sku,
        });
      }
    }

    const material_grades = Array.from(gradeLabels)
      .sort()
      .map((value, idx) => ({ attribute_value_id: idx, value }));

    return {
      category_id: jew.category_id,
      products,
      material_grades,
      variants,
    };
  } catch (err) {
    console.error('Error building jewellery catalog:', err);
    return null;
  }
}

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

export const fetchProductCategories = async () => {
  try {
    const data = await apiFetch('/product-categories/');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Error fetching product categories:', err);
    return [];
  }
};

export const fetchProductVariants = async (productId) => {
  if (!productId) return [];
  try {
    const data = await apiFetch(`/product-variants/?product_id=${productId}`);
    return data?.variants || [];
  } catch (err) {
    console.error('Error fetching product variants:', err);
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
        category_id: cexData.categoryId ?? null,
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

/**
 * Requests overview table (server-filtered by status when not ALL).
 * Uses apiFetch so session cookies / errors match the rest of the app.
 */
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

/** Mark a BOOKED_FOR_TESTING request as COMPLETE (testing passed). */
export const markRequestPassedTesting = async (requestId) => {
  if (!requestId) throw new Error('Request ID required');
  return apiFetch(`/requests/${requestId}/complete-testing/`, { method: 'POST', body: {} });
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

/** PATCH testing_passed on a line (BOOKED_FOR_TESTING requests only). Returns updated item JSON. */
export const setRequestItemTestingPassed = async (requestItemId, testingPassed) => {
  if (requestItemId == null) throw new Error('Request item ID required');
  return apiFetch(`/request-items/${requestItemId}/update-offer/`, {
    method: 'PATCH',
    body: { testing_passed: Boolean(testingPassed) },
  });
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

function normalizeNosposCustomerId(raw) {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** If we matched an existing row by phone/name but NoSpos id was missing, backfill it. */
async function patchNosposCustomerIdIfMissing(customer, nosposCustomerId) {
  if (customer == null || nosposCustomerId == null) return customer;
  if (customer.nospos_customer_id != null) return customer;
  try {
    return await apiFetch(`/customers/${customer.id}/`, {
      method: 'PATCH',
      body: { nospos_customer_id: nosposCustomerId },
    });
  } catch {
    return customer;
  }
}

export const getOrCreateCustomer = async (customerData) => {
  if (!customerData?.name) return null;
  const nid = normalizeNosposCustomerId(customerData.nospos_customer_id);

  if (nid != null) {
    try {
      const data = await apiFetch(`/customers/?nospos_customer_id=${encodeURIComponent(nid)}`);
      const results = Array.isArray(data) ? data : (data.results ?? []);
      if (results.length > 0) {
        return patchNosposCustomerIdIfMissing(results[0], nid);
      }
    } catch {}
  }

  if (customerData.phone_number) {
    try {
      const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.phone_number)}`);
      const results = Array.isArray(data) ? data : (data.results ?? []);
      const match = results.find((c) => c.phone_number === customerData.phone_number);
      if (match) return patchNosposCustomerIdIfMissing(match, nid);
    } catch {}
  }
  try {
    const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.name)}`);
    const results = Array.isArray(data) ? data : (data.results ?? []);
    const match = results.find((c) => c.name?.toLowerCase() === customerData.name.toLowerCase());
    if (match) return patchNosposCustomerIdIfMissing(match, nid);
  } catch {}

  if (nid != null) {
    return createCustomer({ ...customerData, nospos_customer_id: nid });
  }
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

// ─── Customer Offer Rules ───────────────────────────────────────────────────────

export const fetchCustomerOfferRules = () => apiFetch('/customer-offer-rules/');
export const updateCustomerOfferRule = (customerType, data) =>
  apiFetch(`/customer-offer-rules/${customerType}/`, { method: 'PUT', body: data });
export const fetchCustomerRuleSettings = () => apiFetch('/customer-rule-settings/');
export const updateCustomerRuleSettings = (data) =>
  apiFetch('/customer-rule-settings/', { method: 'PUT', body: data });

// ─── NoSpos Category Mappings ───────────────────────────────────────────────────

export const fetchNosposCategoryMappings = () => apiFetch('/nospos-category-mappings/');
export const createNosposCategoryMapping = (data) => apiFetch('/nospos-category-mappings/', { method: 'POST', body: data });
export const updateNosposCategoryMapping = (id, data) => apiFetch(`/nospos-category-mappings/${id}/`, { method: 'PATCH', body: data });
export const deleteNosposCategoryMapping = (id) => apiFetch(`/nospos-category-mappings/${id}/`, { method: 'DELETE' });

// ─── Categories ────────────────────────────────────────────────────────────────

export const fetchAllCategoriesFlat = () => apiFetch('/all-categories/');
