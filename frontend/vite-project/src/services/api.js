import { getCSRFToken } from '../utils/helpers';

const API_BASE_URL = 'http://127.0.0.1:8000/api';

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
 */
export const addRequestItem = async (requestId, itemData) => {
  if (!requestId || !itemData) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/items/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRFToken()
      },
      body: JSON.stringify(itemData)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to add request item');
    }

    return await res.json(); // { request_item_id, ... }
  } catch (err) {
    console.error('Error adding request item:', err);
    return null;
  }
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
export const finishRequest = async (requestId) => {
  if (!requestId) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/requests/${requestId}/finish/`, {
      method: 'POST',
      headers: {
        'X-CSRFToken': getCSRFToken()
      }
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to finish request');
    }

    return await res.json(); // { request_id, status, items_count }
  } catch (err) {
    console.error('Error finishing request:', err);
    return null;
  }
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