import { apiFetch } from './http';

export const fetchCashGeneratorRetailCategories = () => apiFetch('/cash-generator/retail-categories/');
export const syncCashGeneratorRetailCategories = () =>
  apiFetch('/cash-generator/retail-categories/', { method: 'POST', body: {} });
