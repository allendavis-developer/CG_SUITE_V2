import { apiFetch } from './http';

export const fetchPricingRules = () => apiFetch('/pricing-rules/');
export const createPricingRule = (data) => apiFetch('/pricing-rules/', { method: 'POST', body: data });
export const updatePricingRule = (id, data) => apiFetch(`/pricing-rules/${id}/`, { method: 'PATCH', body: data });
export const deletePricingRule = (id) => apiFetch(`/pricing-rules/${id}/`, { method: 'DELETE' });
export const fetchEbayOfferMargins = (categoryId) =>
  apiFetch(`/ebay-offer-margins/${categoryId ? `?category_id=${categoryId}` : ''}`);

export const fetchCustomerOfferRules = () => apiFetch('/customer-offer-rules/');
export const updateCustomerOfferRule = (customerType, data) =>
  apiFetch(`/customer-offer-rules/${customerType}/`, { method: 'PUT', body: data });
export const updateCustomerRuleSettings = (data) =>
  apiFetch('/customer-rule-settings/', { method: 'PUT', body: data });
