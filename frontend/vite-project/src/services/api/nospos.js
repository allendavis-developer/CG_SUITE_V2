import { apiFetch, memoizeForSession } from './http';

const nosposMappingsLoader = memoizeForSession(() => apiFetch('/nospos-category-mappings/'));
const nosposCategoriesLoader = memoizeForSession(() => apiFetch('/nospos-categories/'));

export const fetchNosposCategoryMappings = () => nosposMappingsLoader();
export const peekNosposMappingsCache = () => nosposMappingsLoader.peek();

export const fetchNosposCategories = () => nosposCategoriesLoader();
export const peekNosposCategoriesCache = () => nosposCategoriesLoader.peek();

export const createNosposCategoryMapping = (data) =>
  apiFetch('/nospos-category-mappings/', { method: 'POST', body: data });
export const updateNosposCategoryMapping = (id, data) =>
  apiFetch(`/nospos-category-mappings/${id}/`, { method: 'PATCH', body: data });
export const deleteNosposCategoryMapping = (id) =>
  apiFetch(`/nospos-category-mappings/${id}/`, { method: 'DELETE' });

export const fetchNosposFields = () => apiFetch('/nospos-fields/');
export const syncNosposFields = (body) => apiFetch('/nospos-fields/sync/', { method: 'POST', body });
export const syncNosposCategories = (categories) =>
  apiFetch('/nospos-categories/sync/', { method: 'POST', body: { categories } });
