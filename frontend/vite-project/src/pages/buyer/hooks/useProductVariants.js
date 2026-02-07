import { useState, useEffect } from 'react';

export const useProductVariants = (productId) => {
  const [variants, setVariants] = useState([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productId) {
      setVariants([]);
      return;
    }

    const loadVariants = async () => {
      setIsLoadingVariants(true);
      setError(null);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/product-variants/?product_id=${productId}`);
        if (!res.ok) {
          throw new Error(`Network response was not ok: ${res.statusText}`);
        }
        const data = await res.json();
        setVariants(data.variants || []);
      } catch (err) {
        console.error('Error fetching variants:', err);
        setError(err);
        setVariants([]);
      } finally {
        setIsLoadingVariants(false);
      }
    };

    loadVariants();
  }, [productId]);

  return { variants, isLoadingVariants, error };
};
