import { apiFetch } from './http';

export const createCustomer = async (customerData) => {
  if (!customerData?.name) return null;
  return apiFetch('/customers/', { method: 'POST', body: customerData });
};

function normalizeNosposCustomerId(raw) {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
    } catch {
      /* fall through to next lookup strategy */
    }
  }

  if (customerData.phone_number) {
    try {
      const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.phone_number)}`);
      const results = Array.isArray(data) ? data : (data.results ?? []);
      const match = results.find((c) => c.phone_number === customerData.phone_number);
      if (match) return patchNosposCustomerIdIfMissing(match, nid);
    } catch {
      /* fall through to next lookup strategy */
    }
  }
  try {
    const data = await apiFetch(`/customers/?search=${encodeURIComponent(customerData.name)}`);
    const results = Array.isArray(data) ? data : (data.results ?? []);
    const match = results.find((c) => c.name?.toLowerCase() === customerData.name.toLowerCase());
    if (match) return patchNosposCustomerIdIfMissing(match, nid);
  } catch {
    /* fall through to createCustomer */
  }

  if (nid != null) {
    return createCustomer({ ...customerData, nospos_customer_id: nid });
  }
  return createCustomer(customerData);
};

export const updateCustomer = async (customerId, updates) => {
  if (!customerId || !updates) return null;
  return apiFetch(`/customers/${customerId}/`, { method: 'PATCH', body: updates });
};
