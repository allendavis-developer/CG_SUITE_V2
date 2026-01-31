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
  if (!sku) return { offers: [], referenceData: null };

  try {
    const res = await fetch(`/api/variant-prices/?sku=${sku}`);
    if (!res.ok) throw new Error('Failed to fetch offers');
    
    const data = await res.json();
    return {
      offers: data.offers,
      referenceData: data.reference_data
    };
  } catch (err) {
    console.error('Error fetching offers:', err);
    return { offers: [], referenceData: null };
  }
};

/**
 * Create a new customer request
 */
export const createRequest = async (customerId, transactionType, firstItem) => {
  if (!customerId) {
    throw new Error('No customer selected');
  }

  const response = await fetch(`${API_BASE_URL}/requests/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      "X-CSRFToken": getCSRFToken()
    },
    body: JSON.stringify({
      customer_id: customerId,
      intent: transactionType === 'sale' ? 'DIRECT_SALE' : 'BUYBACK',
      item: {
        variant_id: firstItem.variantId,
        initial_expectation_gbp: firstItem.customerExpectation,
        notes: `${firstItem.title} - ${firstItem.subtitle} | Our offer: ${firstItem.price} (${firstItem.offerTitle})`
      }
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to create request: ${response.status} - ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error('Server returned invalid JSON response');
  }

  return data;
};

/**
 * Add an item to an existing request
 */
export const addItemToRequest = async (requestId, item) => {
  if (!requestId) {
    throw new Error('No active request');
  }

  const response = await fetch(`${API_BASE_URL}/requests/${requestId}/items/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      "X-CSRFToken": getCSRFToken()
    },
    body: JSON.stringify({
      variant_id: item.variantId,
      initial_expectation_gbp: item.customerExpectation,
      notes: `${item.title} - ${item.subtitle} | Our offer: ${item.price} (${item.offerTitle})`
    })
  });

  if (!response.ok) {
    throw new Error('Failed to add item to request');
  }

  const data = await response.json();
  return data;
};

/**
 * Finalize a transaction
 */
export const finalizeTransaction = async (requestId) => {
  if (!requestId) {
    throw new Error('No active request to finalize');
  }

  const response = await fetch(`${API_BASE_URL}/requests/${requestId}/finish/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      "X-CSRFToken": getCSRFToken()
    }
  });

  if (!response.ok) {
    throw new Error('Failed to finalize transaction');
  }

  const data = await response.json();
  return data;
};