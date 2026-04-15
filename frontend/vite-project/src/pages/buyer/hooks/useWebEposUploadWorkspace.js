import { useState, useEffect, useRef, useCallback } from 'react';
import {
  startWebEposUploadWithTimeout,
  scrapeWebEposProducts,
} from '@/services/extensionClient';
import {
  WEB_EPOS_UPLOAD_SKIP_GATE_KEY,
  WEB_EPOS_PRODUCTS_SNAPSHOT_KEY,
  WEB_EPOS_REOPEN_URL_KEY,
} from '@/pages/buyer/webEposUploadConstants';

/**
 * Upload module only: Web EPOS entry gate, post-login product scrape, and navigation to the products page.
 */
export function useWebEposUploadWorkspace({
  enabled,
  isLoading,
  navigate,
  showNotification,
  webEposOpenFailedCopy,
  uiBlocked,
}) {
  const [uploadWebEposReady, setUploadWebEposReady] = useState(() => !enabled);
  const [webEposProductsSnapshot, setWebEposProductsSnapshot] = useState(null);
  const [webEposProductsScrapeLoading, setWebEposProductsScrapeLoading] = useState(false);
  const [webEposProductsScrapeError, setWebEposProductsScrapeError] = useState(null);
  const [webEposScrapeNonce, setWebEposScrapeNonce] = useState(0);

  const entryGateStartedRef = useRef(false);
  const skipNextAutoScrapeRef = useRef(false);

  useEffect(() => {
    if (!enabled || isLoading) return;
    if (entryGateStartedRef.current) return;
    entryGateStartedRef.current = true;

    let skipGate = false;
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(WEB_EPOS_UPLOAD_SKIP_GATE_KEY) === '1') {
        sessionStorage.removeItem(WEB_EPOS_UPLOAD_SKIP_GATE_KEY);
        skipGate = true;
      }
    } catch (_) {}

    let reopenUrl = null;
    try {
      reopenUrl = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(WEB_EPOS_REOPEN_URL_KEY) : null;
      if (reopenUrl) {
        skipGate = false;
        sessionStorage.removeItem(WEB_EPOS_REOPEN_URL_KEY);
      }
    } catch (_) {}

    if (skipGate) {
      try {
        const raw = sessionStorage.getItem(WEB_EPOS_PRODUCTS_SNAPSHOT_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && Array.isArray(p.rows)) {
            setWebEposProductsSnapshot({
              rows: p.rows,
              pagingText: p.pagingText ?? null,
              pageUrl: p.pageUrl ?? null,
              scrapedAt: p.scrapedAt ?? null,
            });
          }
        }
      } catch (_) {}
      skipNextAutoScrapeRef.current = true;
      setUploadWebEposReady(true);
      return;
    }

    try {
      sessionStorage.removeItem(WEB_EPOS_PRODUCTS_SNAPSHOT_KEY);
    } catch (_) {}
    setWebEposProductsSnapshot(null);

    let cancelled = false;
    (async () => {
      try {
        const result = await startWebEposUploadWithTimeout({ reopenUrl: reopenUrl || undefined });
        if (cancelled) return;
        if (result?.cancelled) {
          showNotification(webEposOpenFailedCopy, 'error');
          navigate('/', { replace: true });
          return;
        }
        setUploadWebEposReady(true);
      } catch (err) {
        if (cancelled) return;
        showNotification(err?.message || webEposOpenFailedCopy, 'error');
        navigate('/', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, isLoading, navigate, showNotification, webEposOpenFailedCopy]);

  useEffect(() => {
    if (!enabled || !uploadWebEposReady) return;
    if (skipNextAutoScrapeRef.current) {
      skipNextAutoScrapeRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setWebEposProductsScrapeLoading(true);
      setWebEposProductsScrapeError(null);
      try {
        const data = await scrapeWebEposProducts();
        if (cancelled) return;
        if (data?.ok) {
          setWebEposProductsSnapshot({
            rows: data.rows,
            pagingText: data.pagingText,
            pageUrl: data.pageUrl,
            scrapedAt: new Date().toISOString(),
          });
        } else {
          setWebEposProductsSnapshot(null);
          setWebEposProductsScrapeError(data?.error || 'Could not read Web EPOS products.');
        }
      } catch (e) {
        if (!cancelled) {
          setWebEposProductsSnapshot(null);
          setWebEposProductsScrapeError(e?.message || 'Could not read Web EPOS products.');
        }
      } finally {
        if (!cancelled) setWebEposProductsScrapeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, uploadWebEposReady, webEposScrapeNonce]);

  const handleViewWebEposProducts = useCallback(() => {
    if (webEposProductsScrapeLoading) {
      showNotification('Still syncing the product list from Web EPOS…', 'info');
      return;
    }
    if (webEposProductsSnapshot) {
      try {
        sessionStorage.setItem(WEB_EPOS_UPLOAD_SKIP_GATE_KEY, '1');
        sessionStorage.setItem(WEB_EPOS_PRODUCTS_SNAPSHOT_KEY, JSON.stringify(webEposProductsSnapshot));
      } catch (_) {}
      navigate('/upload/webepos-products', { state: webEposProductsSnapshot });
      return;
    }
    showNotification(
      webEposProductsScrapeError ? 'Retrying product list from Web EPOS…' : 'Product list not ready yet. Retrying…',
      'info'
    );
    setWebEposScrapeNonce((n) => n + 1);
  }, [
    navigate,
    showNotification,
    webEposProductsScrapeLoading,
    webEposProductsSnapshot,
    webEposProductsScrapeError,
  ]);

  const viewWebEposProductsDisabled =
    !uploadWebEposReady ||
    uiBlocked;

  const bumpWebEposScrape = useCallback(() => {
    setWebEposScrapeNonce((n) => n + 1);
  }, []);

  return {
    uploadWebEposReady,
    webEposProductsSnapshot,
    webEposProductsScrapeLoading,
    webEposProductsScrapeError,
    handleViewWebEposProducts,
    viewWebEposProductsDisabled,
    bumpWebEposScrape,
  };
}
