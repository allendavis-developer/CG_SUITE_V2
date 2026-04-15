import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useNotification } from "@/contexts/NotificationContext";
import { getModuleFeatures } from "../config/moduleFeatures";

import {
  cancelNosposRepricing,
  clearLastRepricingResult,
  getLastRepricingResult,
  getNosposRepricingStatus,
  openNospos,
  openWebEposUploadWithTimeout,
  searchNosposBarcode,
} from "@/services/extensionClient";
import {
  saveRepricingSession,
  updateRepricingSession,
  saveUploadSession,
  updateUploadSession,
} from "@/services/api";
import { getCartKey, loadRepricingProgress, saveRepricingProgress, clearRepricingProgress } from "@/utils/repricingProgress";
import { getEditableSalePriceState, resolveRepricingSalePrice } from "../utils/repricingDisplay";
import useAppStore from '@/store/useAppStore';
import { normalizeExplicitSalePrice, formatOfferPrice, roundSalePrice } from '@/utils/helpers';
import {
  withDefaultRrpOffersSource,
  logCategoryRuleDecision,
  applyRrpOnlyFromPriceSource,
} from '../utils/negotiationHelpers';
import { EBAY_TOP_LEVEL_CATEGORY } from '../constants';
import { useResearchOverlay } from '../hooks/useResearchOverlay';
import { useMarketplaceSearchPrefetch } from '../hooks/useMarketplaceSearchPrefetch';
import { useRefreshCexRowData } from '../hooks/useRefreshCexRowData';
import { handlePriceSourceAsRrpOffersSource } from '../utils/priceSourceAsRrpOffers';
import { useWebEposUploadWorkspace } from '../hooks/useWebEposUploadWorkspace';
import {
  barcodeCap,
  buildAmbiguousBarcodeEntries,
  buildSessionSavePayload,
  buildUnverifiedBarcodeEntries,
  negotiationWorkspaceCopy,
  openBarcodePrintTab,
} from "./listWorkspaceUtils";

/** State and handlers for repricing / upload list workspaces (used by ListWorkspaceNegotiation via Negotiation). */
export function useListWorkspaceNegotiation(moduleKey = 'repricing') {
  const features = getModuleFeatures(moduleKey);
  const maxBarcodesPerItem = barcodeCap(features);
  const useUploadSessions = moduleKey === 'upload';
  const copy = useMemo(() => negotiationWorkspaceCopy(useUploadSessions), [useUploadSessions]);
  const saveWorkspaceSession = useUploadSessions ? saveUploadSession : saveRepricingSession;
  const updateWorkspaceSession = useUploadSessions ? updateUploadSession : updateRepricingSession;
  const readSessionIdFromResponse = (resp) =>
    (useUploadSessions ? resp?.upload_session_id : resp?.repricing_session_id) ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotification();

  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const handleAddFromCeX = useAppStore((s) => s.handleAddFromCeX);
  const cexLoading = useAppStore((s) => s.cexLoading);
  const cexProductData = useAppStore((s) => s.cexProductData);
  const setCexProductData = useAppStore((s) => s.setCexProductData);
  const clearCexProduct = useAppStore((s) => s.clearCexProduct);
  const headerWorkspaceOpen = useAppStore((s) => s.headerWorkspaceOpen);

  const cartItems = location.state?.cartItems || [];
  const isCartInitiallyEmptyRef = useRef(cartItems.length === 0);

  const [items, setItems] = useState([]);
  const [isQuickRepriceOpen, setIsQuickRepriceOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [barcodes, setBarcodes] = useState({});
  const [barcodeModal, setBarcodeModal] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [nosposLookups, setNosposLookups] = useState({});
  const [nosposResultsPanel, setNosposResultsPanel] = useState(null);

  const [completedBarcodes, setCompletedBarcodes] = useState({});
  const [completedItems, setCompletedItems] = useState([]);

  const [showNewRepricingConfirm, setShowNewRepricingConfirm] = useState(false);

  const applyEbayRepriceResearch = useCallback((item, state) => ({
    ...item,
    ebayResearchData: state,
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), []);
  const applyCCRepriceResearch = useCallback((item, state) => ({
    ...item,
    cashConvertersResearchData: state,
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), []);
  const applyCGRepriceResearch = useCallback((item, state) => ({
    ...item,
    cgResearchData: state,
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), []);
  const {
    researchItem, setResearchItem,
    cashConvertersResearchItem, setCashConvertersResearchItem,
    cgResearchItem, setCgResearchItem,
    salePriceConfirmModal, setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
    handleCashGeneratorResearchComplete,
    handleResearchItemCategoryResolved,
  } = useResearchOverlay({
    items, setItems,
    applyEbayResearch: applyEbayRepriceResearch,
    applyCCResearch: applyCCRepriceResearch,
    applyCGResearch: applyCGRepriceResearch,
    resolveSalePrice: resolveRepricingSalePrice,
  });
  useMarketplaceSearchPrefetch(items, setItems);

  const {
    uploadWebEposReady,
    handleViewWebEposProducts,
    viewWebEposProductsDisabled,
    bumpWebEposScrape,
  } = useWebEposUploadWorkspace({
    enabled: useUploadSessions,
    isLoading,
    navigate,
    showNotification,
    webEposOpenFailedCopy: copy.webEposOpenFailed,
    uiBlocked:
      headerWorkspaceOpen ||
      !!researchItem ||
      !!cashConvertersResearchItem ||
      !!cgResearchItem,
  });

  const [isRepricingFinished, setIsRepricingFinished] = useState(false);
  const [completedItemsData, setCompletedItemsData] = useState([]);
  const [ambiguousBarcodeModal, setAmbiguousBarcodeModal] = useState(null);
  const [unverifiedModal, setUnverifiedModal] = useState(null);
  const [repricingJob, setRepricingJob] = useState(null);
  const [zeroSalePriceModal, setZeroSalePriceModal] = useState(null);

  const [contextMenu, setContextMenu] = useState(null);
  const [cexPencilRrpSourceModal, setCexPencilRrpSourceModal] = useState(null);

  const hasInitialized = useRef(false);
  const lastHandledCompletionRef = useRef("");

  // ── DB session persistence ──────────────────────────────────────────────────
  const [dbSessionId, setDbSessionId] = useState(location.state?.sessionId || null);
  const autoSaveTimer = useRef(null);
  const isCreatingSession = useRef(false);
  const hasPendingSave = useRef(false);
  const latestStateRef = useRef({ items, barcodes, nosposLookups });
  latestStateRef.current = { items, barcodes, nosposLookups };

  const buildSessionDataSnapshot = useCallback((state) => {
    const { items: snapshotItems, barcodes: snapshotBarcodes, nosposLookups: snapshotLookups } = state || latestStateRef.current;
    return {
      items: snapshotItems.map(({ id, title, subtitle, category, model, cexSellPrice, cexBuyPrice,
        cexVoucherPrice, cexUrl, ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData,
        isCustomCeXItem, isCustomEbayItem, isCustomCashConvertersItem, condition, categoryObject,
        nosposBarcodes, ebayResearchData, cashConvertersResearchData, cgResearchData, quantity, isRemoved,
        variantId, cexSku, attributeValues, referenceData, offers, cashOffers, voucherOffers,
        image, rrpOffersSource, offersSource }) => ({
        id, title, subtitle, category, model, cexSellPrice, cexBuyPrice, cexVoucherPrice, cexUrl,
        ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData, isCustomCeXItem,
        isCustomEbayItem, isCustomCashConvertersItem, condition, categoryObject, nosposBarcodes,
        ebayResearchData, cashConvertersResearchData, cgResearchData, quantity, isRemoved, variantId, cexSku,
        attributeValues, referenceData, offers, cashOffers, voucherOffers, image, rrpOffersSource,
        offersSource,
      })),
      barcodes: snapshotBarcodes,
      nosposLookups: snapshotLookups,
    };
  }, []);

  const flushNegotiationSave = useCallback((opts = {}) => {
    if (!dbSessionId || isRepricingFinished) return;
    const state = latestStateRef.current;
    const activeCount = state.items.filter(i => !i.isRemoved).length;
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    hasPendingSave.current = false;
    updateWorkspaceSession(dbSessionId, {
      session_data: buildSessionDataSnapshot(state),
      cart_key: getCartKey(state.items.filter(i => !i.isRemoved)),
      item_count: activeCount,
    }, opts).catch(err => console.warn(copy.saveFailLog, err));
  }, [dbSessionId, isRepricingFinished, buildSessionDataSnapshot, updateWorkspaceSession, copy.saveFailLog]);

  useEffect(() => {
    if (!dbSessionId || isLoading || isRepricingFinished) return;
    hasPendingSave.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      hasPendingSave.current = false;
      const activeCount = items.filter(i => !i.isRemoved).length;
      updateWorkspaceSession(dbSessionId, {
        session_data: buildSessionDataSnapshot({ items, barcodes, nosposLookups }),
        cart_key: getCartKey(items.filter(i => !i.isRemoved)),
        item_count: activeCount,
      }).catch(err => console.warn('[CG Suite] Auto-save failed:', err));
    }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [items, barcodes, nosposLookups, dbSessionId, isLoading, isRepricingFinished, buildSessionDataSnapshot]);

  useEffect(() => {
    return () => { if (hasPendingSave.current) flushNegotiationSave(); };
  }, [flushNegotiationSave]);

  useEffect(() => {
    const handleUnload = () => flushNegotiationSave({ keepalive: true });
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [flushNegotiationSave]);

  const prevItemsLengthRef = useRef(0);
  useEffect(() => {
    const prevLen = prevItemsLengthRef.current;
    prevItemsLengthRef.current = items.length;
    if (!isCartInitiallyEmptyRef.current) return;
    if (prevLen > 0 || items.length === 0) return;
    if (dbSessionId || isCreatingSession.current) return;
    isCreatingSession.current = true;
    saveWorkspaceSession({
      cart_key: getCartKey(items),
      item_count: items.length,
      session_data: buildSessionDataSnapshot({ items, barcodes: {}, nosposLookups: {} }),
    }).then(resp => {
      const sid = readSessionIdFromResponse(resp);
      if (sid) {
        setDbSessionId(sid);
        useAppStore.getState().setRepricingSessionId(sid);
      }
    }).catch(err => {
      console.warn('[CG Suite] Failed to create draft session:', err);
    }).finally(() => {
      isCreatingSession.current = false;
    });
  }, [items.length, dbSessionId, buildSessionDataSnapshot]);

  const activeItems = items.filter(i => !i.isRemoved);
  const activeCartKey = getCartKey(activeItems);

  const persistCompletedRepricing = async (payload) => {
    if (!payload?.cart_key || payload.cart_key !== activeCartKey) return false;

    const fingerprint = JSON.stringify(payload);
    if (lastHandledCompletionRef.current === fingerprint) return false;
    lastHandledCompletionRef.current = fingerprint;

    const savePayload = buildSessionSavePayload(payload);
    const ambiguousEntries = buildAmbiguousBarcodeEntries(payload);
    const unverifiedEntries = buildUnverifiedBarcodeEntries(payload);

    try {
      if (dbSessionId) {
        const updateData = { status: 'COMPLETED' };
        if (savePayload.barcode_count > 0) {
          updateData.items_data = savePayload.items_data;
          updateData.barcode_count = savePayload.barcode_count;
          updateData.item_count = savePayload.item_count;
          updateData.cart_key = savePayload.cart_key;
        }
        try { await updateWorkspaceSession(dbSessionId, updateData); } catch {}
        if (savePayload.barcode_count > 0) clearRepricingProgress(activeCartKey);
        useAppStore.getState().clearRepricingSessionDraft();
      } else if (savePayload.barcode_count > 0) {
        await saveWorkspaceSession(savePayload);
        clearRepricingProgress(activeCartKey);
      }

      try { await clearLastRepricingResult(); } catch {}

      setIsRepricingFinished(true);
      setRepricingJob((prev) => prev ? { ...prev, running: false, done: true, step: 'completed', message: copy.jobCompletedMessage } : prev);

      if (savePayload.barcode_count > 0) {
        setCompletedItemsData(savePayload.items_data);
        openBarcodePrintTab(savePayload.items_data);
      }

      if (unverifiedEntries.length > 0) {
        setUnverifiedModal({ entries: unverifiedEntries });
      }

      if (ambiguousEntries.length > 0) {
        setAmbiguousBarcodeModal({ entries: ambiguousEntries, isRetrying: false });
        if (savePayload.barcode_count > 0) {
          showNotification(
            copy.persistSavedWithIssues(unverifiedEntries.length),
            "warning"
          );
        } else {
          showNotification(copy.persistNoItemsRetry, "warning");
        }
      } else if (savePayload.barcode_count > 0) {
        showNotification(
          unverifiedEntries.length > 0
            ? copy.persistDoneWithUnverified(unverifiedEntries.length)
            : copy.persistDoneSaved,
          unverifiedEntries.length > 0 ? "warning" : "success"
        );
      } else {
        showNotification(copy.persistNoItems, "info");
      }

      return true;
    } catch (err) {
      lastHandledCompletionRef.current = "";
      showNotification(err?.message || copy.persistSaveError, "error");
      return false;
    }
  };

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const resumeSessionId = location.state?.sessionId || useAppStore.getState().repricingSessionId;
    const sessionBarcodes = location.state?.sessionBarcodes || null;
    const sessionNosposLookups = location.state?.sessionNosposLookups || null;

    if (resumeSessionId && cartItems?.length) {
      setDbSessionId(resumeSessionId);
    }

    if (!cartItems || cartItems.length === 0) {
      setIsLoading(false);
      return;
    }

    setItems(cartItems.map(item => ({ ...item })));
    const cartKey = getCartKey(cartItems);
    const saved = cartKey ? loadRepricingProgress(cartKey) : null;

    if (saved && (Object.keys(saved.barcodes || {}).length > 0 || Object.keys(saved.nosposLookups || {}).length > 0)) {
      setBarcodes(saved.barcodes || {});
      setNosposLookups(saved.nosposLookups || {});
    } else if (sessionBarcodes && Object.keys(sessionBarcodes).length > 0) {
      setBarcodes(sessionBarcodes);
      setNosposLookups(sessionNosposLookups || {});
    } else {
      const prePopulated = {};
      const prePopulatedLookups = {};
      for (const item of cartItems) {
        const rawBarcodes = item.nosposBarcodes || [];
        const seen = new Set();
        const uniqueBarcodes = rawBarcodes.filter(b => {
          const key = b.barserial || '';
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const cappedBarcodes = uniqueBarcodes.slice(0, maxBarcodesPerItem);
        if (cappedBarcodes.length > 0) {
          prePopulated[item.id] = cappedBarcodes.map(b => b.barserial);
          cappedBarcodes.forEach((b, index) => {
            prePopulatedLookups[`${item.id}_${index}`] = {
              status: 'selected',
              results: b.href
                ? [{ barserial: b.barserial, href: b.href.replace(/^https:\/\/nospos\.com/i, '') }]
                : [],
              stockBarcode: b.barserial,
              stockName: b.name || '',
              stockUrl: b.href || ''
            };
          });
        }
      }
      if (Object.keys(prePopulated).length > 0) {
        setBarcodes(prePopulated);
        setNosposLookups(prePopulatedLookups);
      }
    }

    if (!resumeSessionId && !isCreatingSession.current) {
      isCreatingSession.current = true;
      const itemsSnapshot = cartItems.map(item => ({
        id: item.id, title: item.title, subtitle: item.subtitle, category: item.category,
        model: item.model, cexSellPrice: item.cexSellPrice, cexBuyPrice: item.cexBuyPrice,
        cexVoucherPrice: item.cexVoucherPrice, cexUrl: item.cexUrl, ourSalePrice: item.ourSalePrice,
        cexOutOfStock: item.cexOutOfStock, cexProductData: item.cexProductData,
        isCustomCeXItem: item.isCustomCeXItem, isCustomEbayItem: item.isCustomEbayItem,
        isCustomCashConvertersItem: item.isCustomCashConvertersItem,
        condition: item.condition, categoryObject: item.categoryObject,
        nosposBarcodes: item.nosposBarcodes, ebayResearchData: item.ebayResearchData,
        cashConvertersResearchData: item.cashConvertersResearchData,
        cgResearchData: item.cgResearchData,
        quantity: item.quantity,
        variantId: item.variantId, cexSku: item.cexSku, attributeValues: item.attributeValues,
        referenceData: item.referenceData, offers: item.offers, cashOffers: item.cashOffers,
        voucherOffers: item.voucherOffers, image: item.image, rrpOffersSource: item.rrpOffersSource,
        offersSource: item.offersSource,
      }));
      const restoredBarcodes = saved?.barcodes || sessionBarcodes || {};
      const restoredLookups = saved?.nosposLookups || sessionNosposLookups || {};
      saveWorkspaceSession({
        cart_key: cartKey,
        item_count: cartItems.length,
        session_data: { items: itemsSnapshot, barcodes: restoredBarcodes, nosposLookups: restoredLookups },
      }).then(resp => {
        const sid = readSessionIdFromResponse(resp);
        if (sid) {
          setDbSessionId(sid);
          useAppStore.getState().setRepricingSessionId(sid);
        }
      }).catch(err => {
        console.warn('[CG Suite] Failed to create draft session:', err);
      });
    }

    setIsLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeCartKey && (Object.keys(barcodes).length > 0 || Object.keys(nosposLookups).length > 0)) {
      saveRepricingProgress(activeCartKey, { barcodes, nosposLookups });
    }
  }, [barcodes, nosposLookups, activeCartKey]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "REPRICING_PROGRESS" && e.data.payload) {
        const { cartKey: msgCartKey, completedBarcodes: cb, completedItems: ci } = e.data.payload;
        if (msgCartKey && msgCartKey === activeCartKey) {
          setCompletedBarcodes(cb || {});
          setCompletedItems(ci || []);
          setRepricingJob(e.data.payload);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeCartKey]);

  useEffect(() => {
    const handler = async (e) => {
      if (e.data?.type !== "REPRICING_COMPLETE" || !e.data.payload) return;
      await persistCompletedRepricing(e.data.payload);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeCartKey, showNotification, copy]);

  useEffect(() => {
    if (!activeCartKey) return;
    let cancelled = false;

    const syncLiveStatus = async () => {
      try {
        const response = await getNosposRepricingStatus();
        const payload = response?.ok ? response.payload : null;
        if (cancelled || !payload || payload.cartKey !== activeCartKey) return;
        setRepricingJob(payload);
        setCompletedBarcodes(payload.completedBarcodes || {});
        setCompletedItems(payload.completedItems || []);
      } catch {}
    };

    const checkForCompletedResult = async () => {
      try {
        const response = await getLastRepricingResult();
        if (cancelled || !response?.ok || !response.payload) return;
        await persistCompletedRepricing(response.payload);
      } catch {}
    };

    syncLiveStatus();
    checkForCompletedResult();
    const intervalId = window.setInterval(syncLiveStatus, 1500);
    window.addEventListener("focus", checkForCompletedResult);
    document.addEventListener("visibilitychange", checkForCompletedResult);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkForCompletedResult);
      document.removeEventListener("visibilitychange", checkForCompletedResult);
    };
  }, [activeCartKey]);

  useEffect(() => { lastHandledCompletionRef.current = ""; }, [activeCartKey]);

  // ── Barcode helpers ─────────────────────────────────────────────────────────
  const getBarcodeLookup = (itemId, barcodeIndex) =>
    nosposLookups[`${itemId}_${barcodeIndex}`] || null;

  const getVerifiedBarcodesForItem = (itemId) =>
    (barcodes[itemId] || []).flatMap((code, index) => {
      const lookup = getBarcodeLookup(itemId, index);
      return lookup?.status === 'selected' && lookup.stockBarcode ? [lookup.stockBarcode] : [];
    });

  const isItemReadyForRepricing = useCallback((itemId) => {
    const itemBarcodes = barcodes[itemId] || [];
    if (!itemBarcodes.length) return false;
    const hasVerified = (itemBarcodes).flatMap((code, index) => {
      const lookup = nosposLookups[`${itemId}_${index}`] || null;
      return lookup?.status === 'selected' && lookup.stockBarcode ? [lookup.stockBarcode] : [];
    }).length > 0;
    const allResolved = itemBarcodes.every((_, index) => {
      const lookup = nosposLookups[`${itemId}_${index}`] || null;
      return lookup?.status === 'selected' || lookup?.status === 'skipped';
    });
    return hasVerified && allResolved;
  }, [barcodes, nosposLookups]);

  const allItemsReadyForRepricing =
    activeItems.length > 0 &&
    activeItems.every((item) => isItemReadyForRepricing(item.id));
  const isBackgroundRepricingRunning = repricingJob?.running && repricingJob?.cartKey === activeCartKey;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleRemoveItem = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    showNotification(copy.removedFromList(item.title), 'info');
  };

  const addItemsWithBarcodePrepopulation = useCallback((newItems) => {
    const newBarcodes = {};
    const newLookups = {};
    newItems.forEach(item => {
      const rawBarcodes = item.nosposBarcodes || [];
      const seen = new Set();
      const uniqueBarcodes = rawBarcodes.filter(b => {
        const key = b.barserial || '';
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const cappedBarcodes = uniqueBarcodes.slice(0, maxBarcodesPerItem);
      if (cappedBarcodes.length > 0) {
        newBarcodes[item.id] = cappedBarcodes.map(b => b.barserial);
        cappedBarcodes.forEach((b, index) => {
          newLookups[`${item.id}_${index}`] = {
            status: 'selected',
            results: b.href ? [{ barserial: b.barserial, href: b.href.replace(/^https:\/\/nospos\.com/i, '') }] : [],
            stockBarcode: b.barserial,
            stockName: b.name || '',
            stockUrl: b.href || '',
          };
        });
      }
    });
    setItems((prev) => [...prev, ...newItems.map(withDefaultRrpOffersSource)]);
    if (Object.keys(newBarcodes).length > 0) {
      setBarcodes(prev => ({ ...prev, ...newBarcodes }));
      setNosposLookups(prev => ({ ...prev, ...newLookups }));
    }
  }, [maxBarcodesPerItem]);

  const handleAddRepricingItem = useCallback((cartItem) => {
    if (!cartItem) return;
    const item = {
      ...cartItem,
      id: cartItem.id || (crypto.randomUUID?.() ?? `reprice-item-${Date.now()}`),
      quantity: cartItem.quantity || 1,
      nosposBarcodes: cartItem.nosposBarcodes || [],
      ebayResearchData: cartItem.ebayResearchData || null,
      cashConvertersResearchData: cartItem.cashConvertersResearchData || null,
      cgResearchData: cartItem.cgResearchData || null,
      isRemoved: false,
    };
    logCategoryRuleDecision({
      context: 'repricing-item-added',
      item,
      categoryObject: item.categoryObject,
      rule: {
        source: item.isCustomCeXItem ? 'cex-reference-rule' : 'builder-precomputed-rule',
        referenceDataPresent: Boolean(item.referenceData),
      },
    });
    addItemsWithBarcodePrepopulation([item]);
    showNotification(copy.addedOne(item.title), 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification, copy]);

  const handleEbayResearchCompleteFromHeader = useCallback((data) => {
    if (!data) return;
    const searchTitle = data.searchTerm?.trim()?.slice(0, 200) || 'eBay Research Item';
    const resolved = data.resolvedCategory?.id != null ? data.resolvedCategory : null;
    const categoryObject = resolved ?? EBAY_TOP_LEVEL_CATEGORY;
    const categoryName = categoryObject?.name ?? 'eBay';
    const customItem = {
      id: crypto.randomUUID?.() ?? `reprice-ebay-${Date.now()}`,
      title: searchTitle,
      subtitle: 'eBay Research',
      quantity: 1,
      category: categoryName,
      categoryObject,
      offers: [],
      cashOffers: [],
      voucherOffers: [],
      ebayResearchData: data,
      isCustomEbayItem: true,
      selectedOfferId: null,
      ourSalePrice: data.stats?.suggestedPrice != null ? Number(formatOfferPrice(data.stats.suggestedPrice)) : null,
      nosposBarcodes: [],
      cashConvertersResearchData: null,
      cgResearchData: null,
      referenceData: null,
      variantId: null,
      cexSku: null,
      cexSellPrice: null,
      cexBuyPrice: null,
      cexVoucherPrice: null,
      cexUrl: null,
      cexOutOfStock: false,
      attributeValues: {},
      condition: null,
      image: null,
      isRemoved: false,
    };
    addItemsWithBarcodePrepopulation([customItem]);
    showNotification(copy.addedOne(customItem.title), 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification, copy]);

  const handleQuickRepriceItems = useCallback((foundItems) => {
    if (!foundItems?.length) return;
    const newItems = foundItems.map(result => {
      const itemId = crypto.randomUUID?.() ?? `reprice-qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const nosposBarcodes = result.nosposBarcodes || [];
      return {
        id: itemId,
        title: result.title || '',
        subtitle: result.subtitle || result.condition || '',
        model: result.product_name || result.title || '',
        category: result.category_name || '',
        categoryObject: result.category_name ? {
          ...(result.category_id != null ? { id: result.category_id } : {}),
          name: result.category_name,
          path: [result.category_name],
        } : null,
        condition: result.condition || '',
        attributeValues: result.attribute_values || {},
        variantId: result.variant_id ?? null,
        cexSku: result.cex_sku || null,
        cexSellPrice: result.cex_sale_price ?? null,
        cexBuyPrice: result.cex_tradein_cash ?? null,
        cexVoucherPrice: result.cex_tradein_voucher ?? null,
        cexUrl: result.cex_sku ? `https://uk.webuy.com/product-detail?id=${result.cex_sku}` : null,
        ourSalePrice: result.our_sale_price != null && Number.isFinite(Number(result.our_sale_price))
          ? roundSalePrice(Number(result.our_sale_price)) : null,
        image: result.image || '',
        nosposBarcodes,
        isCustomCeXItem: !result.in_db,
        fromQuickReprice: true,
        offers: [],
        cashOffers: [],
        voucherOffers: [],
        selectedOfferId: null,
        ebayResearchData: null,
        cashConvertersResearchData: null,
        cgResearchData: null,
        referenceData: null,
        quantity: 1,
        isRemoved: false,
      };
    });
    addItemsWithBarcodePrepopulation(newItems);
    showNotification(copy.addedMany(newItems.length), 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification, copy]);

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers: false,
    setCexPencilRrpSourceModal,
  });

  // ── Sale price handlers (shared component interface) ────────────────────────
  const handleOurSalePriceChange = useCallback((itemId, value) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: value } : i));
  }, []);

  const handleOurSalePriceBlur = useCallback((item) => {
    const salePriceDisplayValue = getEditableSalePriceState(item).displayValue;
    const raw = (item.ourSalePriceInput ?? salePriceDisplayValue).replace(/[£,]/g, '').trim();
    const parsedTotal = parseFloat(raw);
    const qty = item.quantity || 1;
    setItems(prev => prev.map(i => {
      if (i.id !== item.id) return i;
      const next = { ...i };
      delete next.ourSalePriceInput;
      if (raw === '') {
        next.ourSalePrice = '';
        return next;
      }
      if (Number.isNaN(parsedTotal) || parsedTotal <= 0) return next;
      next.ourSalePrice = String(normalizeExplicitSalePrice(parsedTotal / qty));
      return next;
    }));
    if (raw !== '' && (Number.isNaN(parsedTotal) || parsedTotal <= 0)) {
      showNotification('Our sale price must be greater than £0', 'error');
    }
  }, [showNotification]);

  const handleOurSalePriceFocus = useCallback((itemId, displayValue) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: displayValue } : i));
  }, []);

  const handleApplyRrpPriceSource = useCallback((item, zone) => {
    const { item: next, errorMessage } = applyRrpOnlyFromPriceSource(item, zone);
    if (errorMessage) {
      showNotification(errorMessage, 'error');
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    showNotification('New Sale Price updated from selected source.', 'success');
  }, [showNotification]);

  // ── Barcode modal handlers ──────────────────────────────────────────────────
  const runNosposLookup = useCallback((code, barcodeIndex) => {
    if (!barcodeModal) return;
    const lookupKey = `${barcodeModal.item.id}_${barcodeIndex}`;
    setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'searching' } }));
    searchNosposBarcode(code).then(result => {
      if (result?.loginRequired) {
        showNotification("NosPos lookup needs you to be logged in first.", "error");
        setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'error', error: 'Log in to NosPos first' } }));
      } else if (result?.ok) {
        const results = result.results || [];
        if (results.length === 0) {
          showNotification(`No NosPos match found for barcode ${code}.`, "warning");
          setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'not_found', results: [] } }));
        } else if (results.length === 1) {
          showNotification(`Found 1 NosPos match for barcode ${code}.`, "success");
          setNosposLookups(prev => ({
            ...prev,
            [lookupKey]: {
              status: 'selected', results,
              stockBarcode: results[0].barserial,
              stockName: results[0].name || '',
              stockUrl: `https://nospos.com${results[0].href}`
            }
          }));
        } else {
          showNotification(`Found ${results.length} NosPos matches for barcode ${code}. Pick the right one below.`, "info");
          setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'found', results } }));
          setNosposResultsPanel({ itemId: barcodeModal.item.id, barcodeIndex });
        }
      } else {
        showNotification(result?.error || "NosPos lookup failed.", "error");
        setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'error', error: result?.error || 'Search failed' } }));
      }
    }).catch(err => {
      showNotification(err?.message || "NosPos lookup failed.", "error");
      setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'error', error: err?.message || 'Extension unavailable' } }));
    });
  }, [barcodeModal, showNotification]);

  const addBarcode = useCallback(() => {
    if (!barcodeModal) return;
    const code = barcodeInput.trim();
    if (!code) return;
    const itemId = barcodeModal.item.id;
    const existing = barcodes[itemId] || [];
    const atCap = Number.isFinite(maxBarcodesPerItem) && existing.length >= maxBarcodesPerItem;
    const newIdx = atCap ? 0 : existing.length;
    if (atCap) {
      setNosposLookups((prev) => {
        const next = { ...prev };
        existing.forEach((_, i) => { delete next[`${itemId}_${i}`]; });
        return next;
      });
      setBarcodes((prev) => ({ ...prev, [itemId]: [code] }));
    } else {
      setBarcodes((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), code],
      }));
    }
    setBarcodeInput('');
    runNosposLookup(code, newIdx);
  }, [barcodeModal, barcodeInput, barcodes, runNosposLookup, maxBarcodesPerItem]);

  const removeBarcode = useCallback((code) => {
    if (!barcodeModal) return;
    setBarcodes(prev => ({
      ...prev,
      [barcodeModal.item.id]: (prev[barcodeModal.item.id] || []).filter(b => b !== code)
    }));
  }, [barcodeModal]);

  const selectNosposResult = useCallback((lookupKey, result) => {
    setNosposLookups(prev => ({
      ...prev,
      [lookupKey]: {
        ...prev[lookupKey],
        status: 'selected',
        stockBarcode: result.barserial,
        stockName: result.name || '',
        stockUrl: `https://nospos.com${result.href}`
      }
    }));
    setNosposResultsPanel(null);
  }, []);

  const skipNosposLookup = useCallback((lookupKey) => {
    setNosposLookups(prev => ({
      ...prev,
      [lookupKey]: { ...prev[lookupKey], status: 'skipped' }
    }));
  }, []);

  // ── Proceed / retry / new repricing ─────────────────────────────────────────
  const handleProceed = async () => {
    const zeroSalePriceItems = [];
    for (const item of activeItems) {
      const rawSaleInput = String(item.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
      if (rawSaleInput !== '') {
        const parsedTotalSale = parseFloat(rawSaleInput);
        if (!Number.isFinite(parsedTotalSale) || parsedTotalSale <= 0) {
          showNotification(`Our sale price must be greater than £0 for: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }
      const resolvedSalePrice = resolveRepricingSalePrice(item);
      if (!Number.isFinite(Number(resolvedSalePrice)) || Number(resolvedSalePrice) <= 0) {
        zeroSalePriceItems.push(item.title || 'Unknown Item');
        continue;
      }
      if (!(barcodes[item.id] || []).length) {
        showNotification(`Add at least one barcode for: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
      if (useUploadSessions) {
        const bc = barcodes[item.id] || [];
        if (bc.length !== 1) {
          showNotification(copy.uploadExactlyOneBarcode(item.title), 'error');
          return;
        }
      }
      if (!isItemReadyForRepricing(item.id)) {
        showNotification(`Verify the NosPos barcode for: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
    }
    if (zeroSalePriceItems.length > 0) {
      setZeroSalePriceModal({ itemTitles: zeroSalePriceItems });
      return;
    }

    if (useUploadSessions) {
      showNotification(copy.startBackground, 'info');
      try {
        const result = await openWebEposUploadWithTimeout();
        if (result?.cancelled) return;
        showNotification(copy.webEposOpened, 'success');
        bumpWebEposScrape();
      } catch (err) {
        showNotification(err?.message || copy.webEposOpenFailed, 'error');
      }
      return;
    }

    showNotification(copy.startBackground, 'info');
    try {
      lastHandledCompletionRef.current = "";
      setCompletedBarcodes({});
      setCompletedItems([]);
      const freshCompletedBarcodes = {};
      const freshCompletedItems = [];
      setRepricingJob({
        cartKey: activeCartKey,
        running: true, done: false, step: 'starting',
        message: 'Opening NoSpos in the background',
        currentBarcode: '', currentItemId: '', currentItemTitle: '',
        totalBarcodes: activeItems.reduce((sum, item) => sum + getVerifiedBarcodesForItem(item.id).length, 0),
        completedBarcodeCount: 0,
        completedBarcodes: freshCompletedBarcodes,
        completedItems: freshCompletedItems,
        logs: [{ timestamp: new Date().toISOString(), level: 'info', message: copy.jobLogStart }]
      });
      const repricingData = activeItems.map((item) => {
        const resolvedSalePrice = resolveRepricingSalePrice(item);
        return {
          itemId: item.id,
          title: item.title || "",
          salePrice: resolvedSalePrice,
          ourSalePriceAtRepricing: resolvedSalePrice,
          cexSellAtRepricing: item.cexSellPrice ?? null,
          raw_data: item.ebayResearchData || {},
          cash_converters_data: item.cashConvertersResearchData || {},
          cg_data: item.cgResearchData || {},
          barcodes: getVerifiedBarcodesForItem(item.id)
        };
      });
      await openNospos(repricingData, { completedBarcodes: freshCompletedBarcodes, completedItems: freshCompletedItems, cartKey: activeCartKey });
    } catch (err) {
      showNotification(err?.message || "Could not open NoSpos", "error");
    }
  };

  const handleConfirmNewRepricing = useCallback(() => {
    setShowNewRepricingConfirm(false);
    const { repricingHomePath } = useAppStore.getState();
    useAppStore.getState().resetRepricingWorkspace({
      homePath: repricingHomePath,
      negotiationPath: useAppStore.getState().repricingNegotiationPath,
    });
    navigate(repricingHomePath || '/repricing');
  }, [navigate]);

  const handleRetryAmbiguousBarcodes = async () => {
    if (!ambiguousBarcodeModal) return;
    const retryEntries = ambiguousBarcodeModal.entries
      .map((entry) => ({ ...entry, replacementBarcode: entry.replacementBarcode.trim() }))
      .filter((entry) => entry.replacementBarcode);
    if (!retryEntries.length) {
      showNotification("Type at least one more specific barcode before retrying.", "error");
      return;
    }
    const retryItemsById = new Map();
    for (const entry of retryEntries) {
      const item = items.find((candidate) => String(candidate.id) === String(entry.itemId));
      if (!item) continue;
      if (!retryItemsById.has(item.id)) {
        retryItemsById.set(item.id, {
          itemId: item.id, title: item.title || "",
          salePrice: resolveRepricingSalePrice(item),
          ourSalePriceAtRepricing: resolveRepricingSalePrice(item),
          cexSellAtRepricing: item.cexSellPrice ?? null,
          raw_data: item.ebayResearchData || {},
          cash_converters_data: item.cashConvertersResearchData || {},
          cg_data: item.cgResearchData || {},
          barcodes: []
        });
      }
      retryItemsById.get(item.id).barcodes.push(entry.replacementBarcode);
    }
    const retryData = Array.from(retryItemsById.values()).filter((item) => item.barcodes.length > 0);
    if (!retryData.length) {
      showNotification("Couldn't prepare any retry barcodes.", "error");
      return;
    }
    setAmbiguousBarcodeModal((prev) => (prev ? { ...prev, isRetrying: true } : prev));
    try {
      lastHandledCompletionRef.current = "";
      await clearLastRepricingResult().catch(() => {});
      if (useUploadSessions) {
        const result = await openWebEposUploadWithTimeout();
        if (result?.cancelled) return;
        setAmbiguousBarcodeModal(null);
        showNotification(copy.webEposOpened, 'success');
      } else {
        await openNospos(retryData, { completedBarcodes: {}, completedItems: [], cartKey: activeCartKey });
        setAmbiguousBarcodeModal(null);
        showNotification("Retrying the more specific barcodes in NoSpos…", "info");
      }
    } catch (err) {
      setAmbiguousBarcodeModal((prev) => (prev ? { ...prev, isRetrying: false } : prev));
      showNotification(err?.message || "Could not retry those barcodes.", "error");
    }
  };

  // ── Barcodes column renderer for the shared table ───────────────────────────
  const renderBarcodeCell = useCallback((item) => {
    const itemBarcodes = barcodes[item.id] || [];
    const hasBarcodes = itemBarcodes.length > 0;
    const single = maxBarcodesPerItem === 1;
    return (
      <td>
        <button
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all w-full ${
            hasBarcodes
              ? isItemReadyForRepricing(item.id)
                ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
          }`}
          onClick={() => { setBarcodeModal({ item }); setBarcodeInput(''); }}
          title={single ? 'Click to set barcode' : 'Click to manage barcodes'}
        >
          <span className="material-symbols-outlined text-[14px]">barcode</span>
          <span className="flex-1 text-left">
            {hasBarcodes
              ? isItemReadyForRepricing(item.id)
                ? (single ? 'Barcode verified' : 'Barcodes verified')
                : (single ? 'Barcode needs review' : 'Barcodes need review')
              : (single ? 'Add barcode' : 'Add barcodes')}
          </span>
          {isItemReadyForRepricing(item.id) && (
            <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>
          )}
          {hasBarcodes && !isItemReadyForRepricing(item.id) && (
            <span className="material-symbols-outlined text-[14px] text-amber-600">pending</span>
          )}
          {!hasBarcodes && (
            <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
          )}
        </button>
      </td>
    );
  }, [barcodes, isItemReadyForRepricing, maxBarcodesPerItem]);

  const showWorkspaceLoader = isLoading || (useUploadSessions && !uploadWebEposReady);
  const workspaceLoaderMessage =
    useUploadSessions && !isLoading && !uploadWebEposReady ? copy.startBackground : copy.loadingList;

  return {
    showWorkspaceLoader,
    workspaceLoaderMessage,
    features,
    copy,
    useUploadSessions,
    items,
    setItems,
    selectedCategory,
    selectCategory,
    handleAddFromCeX,
    cexLoading,
    cexProductData,
    setCexProductData,
    clearCexProduct,
    headerWorkspaceOpen,
    activeItems,
    barcodes,
    barcodeModal,
    setBarcodeModal,
    barcodeInput,
    setBarcodeInput,
    nosposLookups,
    nosposResultsPanel,
    setNosposResultsPanel,
    completedBarcodes,
    researchItem,
    cashConvertersResearchItem,
    cgResearchItem,
    salePriceConfirmModal,
    setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
    handleCashGeneratorResearchComplete,
    handleResearchItemCategoryResolved,
    isRepricingFinished,
    completedItemsData,
    ambiguousBarcodeModal,
    setAmbiguousBarcodeModal,
    unverifiedModal,
    setUnverifiedModal,
    repricingJob,
    zeroSalePriceModal,
    setZeroSalePriceModal,
    contextMenu,
    setContextMenu,
    cexPencilRrpSourceModal,
    setCexPencilRrpSourceModal,
    activeCartKey,
    isItemReadyForRepricing,
    allItemsReadyForRepricing,
    isBackgroundRepricingRunning,
    handleRemoveItem,
    handleAddRepricingItem,
    handleEbayResearchCompleteFromHeader,
    handleRefreshCeXData,
    handleOurSalePriceChange,
    handleOurSalePriceBlur,
    handleOurSalePriceFocus,
    handleApplyRrpPriceSource,
    addBarcode,
    removeBarcode,
    runNosposLookup,
    selectNosposResult,
    skipNosposLookup,
    handleProceed,
    handleConfirmNewRepricing,
    handleRetryAmbiguousBarcodes,
    renderBarcodeCell,
    showNotification,
    maxBarcodesPerItem,
    showNewRepricingConfirm,
    setShowNewRepricingConfirm,
    setResearchItem,
    setCashConvertersResearchItem,
    setCgResearchItem,
    isQuickRepriceOpen,
    setIsQuickRepriceOpen,
    handleQuickRepriceItems,
    handleViewWebEposProducts,
    viewWebEposProductsDisabled,
    openBarcodePrintTab,
  };
}
