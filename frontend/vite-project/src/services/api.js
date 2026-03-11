import { getCSRFToken } from '../utils/helpers';

export const API_BASE_URL = 'http://127.0.0.1:8000/api';

/**
 * Fetch product models for a given category
 */
export const fetchProductModels = async (category) => {
  if (!category?.id) return [];

  try {
    const res = await fetch(`/api/products/?category_id=${category.id}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();

    return data.map((p) => ({ 
      model_id: p.product_id, 
      name: p.name,
      product_id: p.product_id 
    }));
  } catch (err) {
    console.error('Error fetching product models:', err);
    return [];
  }
};

/**
 * Fetch competitor statistics for a SKU
 */
export const fetchCompetitorStats = async (cexSku) => {
  if (!cexSku) return [];

  const res = await fetch(`/api/market-stats/?sku=${cexSku}`);
  if (!res.ok) throw new Error('Failed to fetch market stats');

  const data = await res.json();

  return [
    {
      platform: data.platform,
      salePrice: Number(data.sale_price_gbp),
      buyPrice: Number(data.tradein_cash_gbp),
      voucherPrice: Number(data.tradein_voucher_gbp),
      verified: true,
      outOfStock: data.cex_out_of_stock,
      lastUpdated: data.last_updated
    }
  ];
};

/**
 * Fetch product attributes and variants
 */
export const fetchAttributes = async (productId) => {
  if (!productId) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/product-variants/?product_id=${productId}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();

    return {
      attributes: data.attributes.map(attr => ({
        name: attr.label,
        code: attr.code,
        values: attr.values
      })),
      dependencies: data.dependencies,
      variants: data.variants
    };
  } catch (err) {
    console.error('Error fetching attributes:', err);
    return null;
  }
};

/**
 * Fetch variant prices and offers
 */
export const fetchVariantPrices = async (sku) => {
  if (!sku) return { 
    cash_offers: [], 
    voucher_offers: [], 
    referenceData: null 
  };

  try {
    const res = await fetch(`/api/variant-prices/?sku=${sku}`);
    if (!res.ok) throw new Error('Failed to fetch offers');
    
    const data = await res.json();
    return {
      cash_offers: data.cash_offers || [],
      voucher_offers: data.voucher_offers || [],
      referenceData: data.reference_data
    };
  } catch (err) {
    console.error('Error fetching offers:', err);
    return { 
      cash_offers: [], 
      voucher_offers: [], 
      referenceData: null 
    };
  }
};

/**
 * Fetch offers for a CeX product from scraped page data (no variant).
 * Sends sell_price, tradein_cash, tradein_voucher to backend for calculation.
 */
export const fetchCeXProductPrices = async (cexData) => {
  if (!cexData) {
    console.log('[CG Suite] fetchCeXProductPrices: no cexData');
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }

  const body = {
    sell_price: cexData.sellPrice,
    tradein_cash: cexData.tradeInCash,
    tradein_voucher: cexData.tradeInVoucher,
    title: cexData.title,
    category: cexData.category,
    image: cexData.image,
    image_url: cexData.image,
    sku: cexData.id
  };
  console.log('[CG Suite] fetchCeXProductPrices: POST body', body);

  try {
    const res = await fetch('/api/cex-product-prices/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    console.log('[CG Suite] fetchCeXProductPrices: response status', res.status, 'data', data);

    if (!res.ok) throw new Error(data?.detail || 'Failed to fetch CeX offers');
    return {
      cash_offers: data.cash_offers || [],
      voucher_offers: data.voucher_offers || [],
      referenceData: data.reference_data
    };
  } catch (err) {
    console.error('[CG Suite] fetchCeXProductPrices error:', err);
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }
};
/* ------------------------- Request APIs ------------------------- */

/**
 * Create a new request
 * @param {object} requestData - { customer_id, intent, item }
 */
export const createRequest = async (requestData) => {
  if (!requestData) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(requestData)
    });

    if (!res.ok) {
      // Try to parse as JSON first, fall back to text if it fails
      let errorMessage = 'Failed to create request';
      try {
        const errData = await res.json();
        errorMessage = errData.error || errorMessage;
      } catch (parseErr) {
        // If JSON parsing fails, get the text (likely HTML error page)
        const errorText = await res.text();
        console.error('Server returned non-JSON response:', errorText.substring(0, 500));
        errorMessage = `Server error (${res.status})`;
      }
      throw new Error(errorMessage);
    }

    return await res.json();
  } catch (err) {
    console.error('Error creating request:', err);
    throw err; // Re-throw instead of returning null so the caller can handle it
  }
};

/**
 * Add an item to an existing request
 * @param {number} requestId
 * @param {object} itemData - { variant, expectation_gbp, notes, raw_data }
 * @returns {Promise<{ request_item_id: number }>}
 */
export const addRequestItem = async (requestId, itemData) => {
  if (!requestId || !itemData) {
    throw new Error('Request ID and item data are required');
  }

  const res = await fetch(`${API_BASE_URL}/requests/${requestId}/items/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken()
    },
    body: JSON.stringify(itemData)
  });

  if (!res.ok) {
    let errorMessage = 'Failed to add request item';
    try {
      const errData = await res.json();
      errorMessage = errData.error || errorMessage;
    } catch {
      errorMessage = `Server error (${res.status})`;
    }
    throw new Error(errorMessage);
  }

  const data = await res.json();
  if (!data?.request_item_id) {
    throw new Error('Invalid response: missing request_item_id');
  }
  return data;
};

/**
 * Fetch full details of a request (including items and status history)
 * @param {number} requestId
 */
export const fetchRequestDetail = async (requestId) => {
  if (!requestId) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/`);
    if (!res.ok) throw new Error('Failed to fetch request detail');

    return await res.json(); // { request_id, items: [...], status_history: [...], ... }
  } catch (err) {
    console.error('Error fetching request detail:', err);
    return null;
  }
};

/**
 * Finish a request (moves it to BOOKED_FOR_TESTING)
 * @param {number} requestId
 */
export const finishRequest = async (requestId, payload) => {
  if (!requestId || !payload) {
    console.error("finishRequest requires a requestId and a payload.");
    return null;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/finish/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errorMessage = 'Failed to finish request';
      try {
        const errData = await res.json();
        errorMessage = errData.error || errorMessage;
      } catch (parseErr) {
        const errorText = await res.text();
        console.error('Server returned non-JSON response:', errorText.substring(0, 500));
        errorMessage = `Server error (${res.status})`;
      }
      throw new Error(errorMessage);
    }

    return await res.json(); // { request_id, status, items_count }
  } catch (err) {
    console.error('Error finishing request:', err);
    throw err; // Re-throw the error
  }
};

/**
 * Save quote draft (negotiation data) without completing the request.
 * Keeps status as QUOTE, "request not completed". Use when closing tab.
 * @param {number} requestId
 * @param {object} payload - same shape as finishRequest (items_data, overall_expectation_gbp, etc.)
 * @param {{ keepalive?: boolean }} options - use keepalive: true for beforeunload (request survives page unload)
 */
export const saveQuoteDraft = async (requestId, payload, { keepalive = false } = {}) => {
  if (!requestId || !payload) return null;

  const body = JSON.stringify({ ...payload, request_not_completed: true });

  const res = await fetch(`${API_BASE_URL}/requests/${requestId}/finish/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken()
    },
    body,
    keepalive
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to save quote draft');
  }
  return res.json();
};

/**
 * Cancel a request
 * @param {number} requestId
 */
export const cancelRequest = async (requestId) => {
  if (!requestId) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/cancel/`, {
      method: 'POST',
      headers: {
        'X-CSRFToken': getCSRFToken()
      }
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to cancel request');
    }

    return await res.json(); // { request_id, status }
  } catch (err) {
    console.error('Error cancelling request:', err);
    return null;
  }
};


/**
 * Update the intent of a request
 * @param {number} requestId
 * @param {string} intent - new intent value
 */
export const updateRequestIntent = async (requestId, intent) => {
  if (!requestId || !intent) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/update-intent/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify({ intent })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update request intent');
    }

    return await res.json(); // { request_id, intent }
  } catch (err) {
    console.error('Error updating request intent:', err);
    return null;
  }
};

/**
 * Create a new customer
 * @param {object} customerData - { name, phone_number?, email?, address? }
 */
export const createCustomer = async (customerData) => {
  if (!customerData || !customerData.name) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/customers/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(customerData)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.phone_number?.[0] || errData.name?.[0] || 'Failed to create customer');
    }

    return await res.json();
  } catch (err) {
    console.error('Error creating customer:', err);
    throw err;
  }
};

/**
 * Update an existing customer
 * @param {number} customerId
 * @param {object} updates - { name?, phone?, email?, address? }
 */
export const updateCustomer = async (customerId, updates) => {
  if (!customerId || !updates) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/customers/${customerId}/`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(updates)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.phone_number?.[0] || errData.email?.[0] || 'Failed to update customer');
    }

    return await res.json();
  } catch (err) {
    console.error('Error updating customer:', err);
    throw err;
  }
};

/**
 * Update raw_data field for a request item
 * @param {number} requestItemId
 * @param {object} rawData - JSON object with new raw data
 */
export const updateRequestItemRawData = async (requestItemId, rawData) => {
  if (!requestItemId || !rawData || typeof rawData !== 'object') return null;

  try {
    const res = await fetch(`${API_BASE_URL}/request-items/${requestItemId}/update-raw/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify({ raw_data: rawData })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update request item raw data');
    }

    return await res.json(); // { request_item_id, raw_data }
  } catch (err) {
    console.error('Error updating request item raw data:', err);
    return null;
  }
};

/**
 * Save a completed repricing session.
 * Payload shape mirrors the saved repricing snapshot emitted by the extension.
 */
export const saveRepricingSession = async (payload) => {
  if (!payload) return null;

  const res = await fetch(`${API_BASE_URL}/repricing-sessions/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken()
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to save repricing session');
  }

  return res.json();
};

export const fetchRepricingSessionsOverview = async () => {
  const res = await fetch(`${API_BASE_URL}/repricing-sessions/overview/`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to fetch repricing sessions');
  }
  return res.json();
};

/**
 * Quick Reprice: look up variants by cex_sku + nospos_barcode pairs.
 * @param {Array<{cex_sku: string, nospos_barcode: string}>} pairs
 * @returns {Promise<{found: Array, not_found: Array}>}
 */
export const quickRepriceLookup = async (pairs) => {
  if (!pairs || !pairs.length) return { found: [], not_found: [] };

  const res = await fetch(`${API_BASE_URL}/quick-reprice/lookup/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken()
    },
    body: JSON.stringify({ pairs })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Quick reprice lookup failed');
  }

  return res.json();
};

export const fetchRepricingSessionDetail = async (repricingSessionId) => {
  if (!repricingSessionId) return null;

  const res = await fetch(`${API_BASE_URL}/repricing-sessions/${repricingSessionId}/`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to fetch repricing session detail');
  }
  return res.json();
};