import { useCallback, useEffect, useRef, useState } from 'react';
import { openJewelleryScrapPrices } from '@/services/extensionClient';
import {
  JEWELLERY_SCRAP_WINDOW_MESSAGE,
  JEWELLERY_SCRAP_LOADING_FALLBACK_MS,
} from '@/constants/jewelleryScrapBridge';

/**
 * Jewellery workspace: opens extension worker tab, listens for JEWELLERY_SCRAP_WINDOW_MESSAGE.
 */
export function useJewelleryScrapWorkspace() {
  const [scrape, setScrape] = useState(null);
  const [loading, setLoading] = useState(false);
  const fallbackTimerRef = useRef(null);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearFallbackTimer();
    setScrape(null);
    setLoading(false);
  }, [clearFallbackTimer]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== window || e.data?.type !== JEWELLERY_SCRAP_WINDOW_MESSAGE) return;
      const sections = e.data.payload?.sections;
      if (!Array.isArray(sections) || sections.length === 0) return;
      clearFallbackTimer();
      setLoading(false);
      setScrape({
        sections,
        scrapedAt: e.data.payload?.scrapedAt ?? null,
        sourceUrl: e.data.payload?.sourceUrl ?? null,
      });
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      clearFallbackTimer();
    };
  }, [clearFallbackTimer]);

  const startScrapeSession = useCallback(() => {
    clearFallbackTimer();
    setScrape(null);
    setLoading(true);
    return openJewelleryScrapPrices()
      .then(() => {
        fallbackTimerRef.current = window.setTimeout(() => {
          fallbackTimerRef.current = null;
          setLoading(false);
        }, JEWELLERY_SCRAP_LOADING_FALLBACK_MS);
      })
      .catch((err) => {
        console.error('[useJewelleryScrapWorkspace] open tab:', err);
        clearFallbackTimer();
        setLoading(false);
      });
  }, [clearFallbackTimer]);

  return { scrape, loading, startScrapeSession, reset };
}
