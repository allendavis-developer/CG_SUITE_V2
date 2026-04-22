import { apiFetch } from './http';

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

export const fetchAllCategoriesFlat = () => apiFetch('/all-categories/');
