import { useState, useEffect } from 'react';
import { fetchCompetitorStats } from '@/services/api';

export const useCompetitorStats = (variant, allVariants) => {
  const [competitorStats, setCompetitorStats] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!variant) {
      setCompetitorStats([]);
      return;
    }

    const selectedVariant = allVariants.find(v => v.cex_sku === variant);
    if (!selectedVariant) {
      setCompetitorStats([]);
      return;
    }

    const loadStats = async () => {
      setIsLoadingStats(true);
      setError(null);
      try {
        const data = await fetchCompetitorStats(
          selectedVariant.cex_sku,
          selectedVariant.title
        );
        setCompetitorStats(data);
      } catch (err) {
        console.error('Error fetching competitor stats:', err);
        setError(err);
        setCompetitorStats([]);
      } finally {
        setIsLoadingStats(false);
      }
    };

    loadStats();
  }, [variant, allVariants]);

  return { competitorStats, isLoadingStats, error };
};
