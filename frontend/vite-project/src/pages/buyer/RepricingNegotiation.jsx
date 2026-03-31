import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import QuickRepriceModal from "@/components/modals/QuickRepriceModal";
import { useNotification } from "@/contexts/NotificationContext";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import ResearchOverlayPanel from './components/ResearchOverlayPanel';
import TinyModal from "@/components/ui/TinyModal";
import { cancelNosposRepricing, clearLastRepricingResult, getLastRepricingResult, getNosposRepricingStatus, openNospos, searchNosposBarcode } from "@/services/extensionClient";
import { saveRepricingSession, createRepricingSessionDraft, updateRepricingSession } from "@/services/api";
import { getCartKey, loadRepricingProgress, saveRepricingProgress, clearRepricingProgress } from "@/utils/repricingProgress";
import { getEditableSalePriceState, resolveRepricingSalePrice } from "./utils/repricingDisplay";
import useAppStore from '@/store/useAppStore';
import { normalizeExplicitSalePrice, formatOfferPrice, roundSalePrice } from '@/utils/helpers';
import { withDefaultRrpOffersSource } from './utils/negotiationHelpers';
import { EBAY_TOP_LEVEL_CATEGORY } from './constants';
import { SPREADSHEET_CEX_TH_STYLES, RRP_SOURCE_CELL_STYLES } from './spreadsheetTableStyles';
import { useResearchOverlay } from './hooks/useResearchOverlay';
import { useRefreshCexRowData } from './hooks/useRefreshCexRowData';
import NegotiationRowContextMenu from './components/NegotiationRowContextMenu';
import { NEGOTIATION_ROW_CONTEXT, RRP_SOURCE_CELL_CLASS } from './rowContextZones';
import { handlePriceSourceAsRrpOffersSource } from './utils/priceSourceAsRrpOffers';

const getNosposIdFromUrl = (stockUrl) => {
  if (!stockUrl) return "";
  try {
    const url = new URL(stockUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("stock");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = parts[idx + 1];
      return /^\d+$/.test(candidate) ? candidate : "";
    }
    return "";
  } catch {
    return "";
  }
};

const openBarcodePrintTab = (itemsData) => {
  if (!Array.isArray(itemsData) || !itemsData.length) return;
  const ids = Array.from(
    new Set(
      itemsData
        .map((item) => getNosposIdFromUrl(item.stock_url))
        .filter((id) => id && id.trim() !== "")
    )
  );
  if (!ids.length) return;
  const stockIdsParam = encodeURIComponent(ids.join(","));
  window.open(`https://nospos.com/print/barcode?stock_ids=${stockIdsParam}`, "_blank", "noopener");
};

const buildSessionSavePayload = (payload) => ({
  cart_key: payload?.cart_key || "",
  item_count: payload?.item_count || 0,
  barcode_count: payload?.barcode_count || 0,
  items_data: Array.isArray(payload?.items_data) ? payload.items_data : [],
});

const buildAmbiguousBarcodeEntries = (payload) =>
  (Array.isArray(payload?.ambiguous_barcodes) ? payload.ambiguous_barcodes : []).map((entry) => ({
    itemId: entry?.itemId,
    itemTitle: entry?.itemTitle || "Unknown Item",
    barcodeIndex: entry?.barcodeIndex,
    oldBarcode: entry?.barcode || "",
    replacementBarcode: "",
  }));

const buildUnverifiedBarcodeEntries = (payload) =>
  (Array.isArray(payload?.unverified_barcodes) ? payload.unverified_barcodes : []).map((entry) => ({
    itemId: entry?.itemId,
    itemTitle: entry?.itemTitle || "Unknown Item",
    barcodeIndex: entry?.barcodeIndex,
    barcode: entry?.barcode || "",
    stockBarcode: entry?.stockBarcode || "",
    stockUrl: entry?.stockUrl || "",
  }));

// ─── Main component ────────────────────────────────────────────────────────────
const RepricingNegotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotification();

  // Store selectors for header item builder
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const handleAddFromCeX = useAppStore((s) => s.handleAddFromCeX);
  const cexLoading = useAppStore((s) => s.cexLoading);
  const cexProductData = useAppStore((s) => s.cexProductData);
  const setCexProductData = useAppStore((s) => s.setCexProductData);
  const clearCexProduct = useAppStore((s) => s.clearCexProduct);
  const headerWorkspaceOpen = useAppStore((s) => s.headerWorkspaceOpen);

  // Cart items only come from navigation state (session restore / overview)
  const cartItems = location.state?.cartItems || [];
  // Track whether we started with an empty cart so we know to create a session on first item add
  const isCartInitiallyEmptyRef = useRef(cartItems.length === 0);

  const [items, setItems] = useState([]);
  const [isQuickRepriceOpen, setIsQuickRepriceOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Barcode state: { [itemId]: string[] }
  const [barcodes, setBarcodes] = useState({});
  const [barcodeModal, setBarcodeModal] = useState(null); // { item } | null
  const [barcodeInput, setBarcodeInput] = useState('');

  // NosPos barcode lookup state: { [itemId_barcodeIndex]: { status, results, stockBarcode, stockUrl, error } }
  // status: 'searching' | 'found' | 'not_found' | 'selected' | 'skipped' | 'error'
  const [nosposLookups, setNosposLookups] = useState({});
  // Which results panel is expanded: { itemId, barcodeIndex } | null
  const [nosposResultsPanel, setNosposResultsPanel] = useState(null);

  // Progress: completedBarcodes { [itemId]: number[] } (indices), completedItems string[]
  const [completedBarcodes, setCompletedBarcodes] = useState({});
  const [completedItems, setCompletedItems] = useState([]);

  const [showNewRepricingConfirm, setShowNewRepricingConfirm] = useState(false);

  // Research overlay (shared hook)
  const applyEbayRepriceResearch = useCallback((item, state) => ({ ...item, ebayResearchData: state }), []);
  const applyCCRepriceResearch = useCallback((item, state) => ({ ...item, cashConvertersResearchData: state }), []);
  const {
    researchItem, setResearchItem,
    cashConvertersResearchItem, setCashConvertersResearchItem,
    salePriceConfirmModal, setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
  } = useResearchOverlay({
    items, setItems,
    applyEbayResearch: applyEbayRepriceResearch,
    applyCCResearch: applyCCRepriceResearch,
    resolveSalePrice: resolveRepricingSalePrice,
  });

  const [isRepricingFinished, setIsRepricingFinished] = useState(false);
  const [completedItemsData, setCompletedItemsData] = useState([]);
  const [ambiguousBarcodeModal, setAmbiguousBarcodeModal] = useState(null);
  const [unverifiedModal, setUnverifiedModal] = useState(null); // { entries: [] }
  const [repricingJob, setRepricingJob] = useState(null);
  const [zeroSalePriceModal, setZeroSalePriceModal] = useState(null); // { itemTitles: string[] }

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item, zone }

  const hasInitialized = useRef(false);
  const lastHandledCompletionRef = useRef("");

  // ── DB session persistence ──────────────────────────────────────────────────
  const [dbSessionId, setDbSessionId] = useState(location.state?.sessionId || null);
  const autoSaveTimer = useRef(null);
  const isCreatingSession = useRef(false);
  const hasPendingSave = useRef(false);
  const latestStateRef = useRef({ items, barcodes, nosposLookups });
  // Keep ref in sync during render (not in an effect) so cleanup functions
  // always read the latest state — eliminates the stale-ref-on-unmount race.
  latestStateRef.current = { items, barcodes, nosposLookups };

  const buildSessionDataSnapshot = useCallback((state) => {
    const { items: snapshotItems, barcodes: snapshotBarcodes, nosposLookups: snapshotLookups } = state || latestStateRef.current;
    return {
      items: snapshotItems.map(({ id, title, subtitle, category, model, cexSellPrice, cexBuyPrice,
        cexVoucherPrice, cexUrl, ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData,
        isCustomCeXItem, isCustomEbayItem, isCustomCashConvertersItem, condition, categoryObject,
        nosposBarcodes, ebayResearchData, cashConvertersResearchData, quantity, isRemoved,
        variantId, cexSku, attributeValues, referenceData, offers, cashOffers, voucherOffers,
        image, rrpOffersSource }) => ({
        id, title, subtitle, category, model, cexSellPrice, cexBuyPrice, cexVoucherPrice, cexUrl,
        ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData, isCustomCeXItem,
        isCustomEbayItem, isCustomCashConvertersItem, condition, categoryObject, nosposBarcodes,
        ebayResearchData, cashConvertersResearchData, quantity, isRemoved, variantId, cexSku,
        attributeValues, referenceData, offers, cashOffers, voucherOffers, image, rrpOffersSource,
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
    updateRepricingSession(dbSessionId, {
      session_data: buildSessionDataSnapshot(state),
      cart_key: getCartKey(state.items.filter(i => !i.isRemoved)),
      item_count: activeCount,
    }, opts).catch(err => console.warn('[CG Suite] Repricing save failed:', err));
  }, [dbSessionId, isRepricingFinished, buildSessionDataSnapshot]);

  // Debounced auto-save: trigger on any state change (items, barcodes, lookups)
  useEffect(() => {
    if (!dbSessionId || isLoading || isRepricingFinished) return;
    hasPendingSave.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      hasPendingSave.current = false;
      const activeCount = items.filter(i => !i.isRemoved).length;
      updateRepricingSession(dbSessionId, {
        session_data: buildSessionDataSnapshot({ items, barcodes, nosposLookups }),
        cart_key: getCartKey(items.filter(i => !i.isRemoved)),
        item_count: activeCount,
      }).catch(err => console.warn('[CG Suite] Auto-save failed:', err));
    }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [items, barcodes, nosposLookups, dbSessionId, isLoading, isRepricingFinished, buildSessionDataSnapshot]);

  // Flush pending save on unmount (client-side navigation away)
  useEffect(() => {
    return () => {
      if (hasPendingSave.current) flushNegotiationSave();
    };
  }, [flushNegotiationSave]);

  // Save on tab close / hard reload
  useEffect(() => {
    const handleUnload = () => flushNegotiationSave({ keepalive: true });
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [flushNegotiationSave]);

  // For fresh-start sessions (no initial cartItems), create a draft DB session when the first item is added
  const prevItemsLengthRef = useRef(0);
  useEffect(() => {
    const prevLen = prevItemsLengthRef.current;
    prevItemsLengthRef.current = items.length;
    if (!isCartInitiallyEmptyRef.current) return;
    if (prevLen > 0 || items.length === 0) return;
    if (dbSessionId || isCreatingSession.current) return;
    isCreatingSession.current = true;
    createRepricingSessionDraft({
      cart_key: getCartKey(items),
      item_count: items.length,
      session_data: buildSessionDataSnapshot({ items, barcodes: {}, nosposLookups: {} }),
    }).then(resp => {
      if (resp?.repricing_session_id) {
        setDbSessionId(resp.repricing_session_id);
        useAppStore.getState().setRepricingSessionId(resp.repricing_session_id);
      }
    }).catch(err => {
      console.warn('[CG Suite] Failed to create draft session:', err);
    }).finally(() => {
      isCreatingSession.current = false;
    });
  }, [items.length, dbSessionId, buildSessionDataSnapshot]);

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
        // Update the existing draft session with completion data instead of
        // creating a separate session, avoiding duplicates in the overview.
        const updateData = { status: 'COMPLETED' };
        if (savePayload.barcode_count > 0) {
          updateData.items_data = savePayload.items_data;
          updateData.barcode_count = savePayload.barcode_count;
          updateData.item_count = savePayload.item_count;
          updateData.cart_key = savePayload.cart_key;
        }
        try {
          await updateRepricingSession(dbSessionId, updateData);
        } catch {}
        if (savePayload.barcode_count > 0) clearRepricingProgress(activeCartKey);
        useAppStore.getState().clearRepricingSessionDraft();
      } else if (savePayload.barcode_count > 0) {
        await saveRepricingSession(savePayload);
        clearRepricingProgress(activeCartKey);
      }

      try {
        await clearLastRepricingResult();
      } catch {
        // Ignore extension cleanup failures after handling succeeds.
      }

      setIsRepricingFinished(true);
      setRepricingJob((prev) => prev ? { ...prev, running: false, done: true, step: 'completed', message: 'Repricing completed.' } : prev);

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
            unverifiedEntries.length > 0
              ? `Saved repriced items. ${unverifiedEntries.length} barcode(s) couldn't be verified — check below.`
              : "Saved the repriced items. Some barcodes need to be more specific.",
            "warning"
          );
        } else {
          showNotification("No items were repriced. Enter more specific barcodes to retry.", "warning");
        }
      } else if (savePayload.barcode_count > 0) {
        showNotification(
          unverifiedEntries.length > 0
            ? `Repricing done. ${unverifiedEntries.length} barcode(s) couldn't be auto-verified — check the items below.`
            : "Repricing is done and has been saved.",
          unverifiedEntries.length > 0 ? "warning" : "success"
        );
      } else {
        showNotification("No items were repriced.", "info");
      }

      return true;
    } catch (err) {
      lastHandledCompletionRef.current = "";
      showNotification(err?.message || "Repricing finished but could not be saved.", "error");
      return false;
    }
  };

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const resumeSessionId = location.state?.sessionId || useAppStore.getState().repricingSessionId;
    const sessionBarcodes = location.state?.sessionBarcodes || null;
    const sessionNosposLookups = location.state?.sessionNosposLookups || null;

    // If we have a sessionId AND cartItems, just attach to the existing DB session (no refetch)
    if (resumeSessionId && cartItems?.length) {
      setDbSessionId(resumeSessionId);
    }

    // Empty start — just mark as ready; items will be added via the header builder
    if (!cartItems || cartItems.length === 0) {
      setIsLoading(false);
      return;
    }

    setItems(cartItems.map(item => ({ ...item })));
    const cartKey = getCartKey(cartItems);
    const saved = cartKey ? loadRepricingProgress(cartKey) : null;

    // Restore barcodes & nosposLookups with priority:
    // 1. localStorage (most recent in-browser state)
    // 2. DB session_data (passed via location.state from overview/back navigation)
    // 3. Pre-populate from item nosposBarcodes (Quick Reprice)
    if (saved && (Object.keys(saved.barcodes || {}).length > 0 || Object.keys(saved.nosposLookups || {}).length > 0)) {
      setBarcodes(saved.barcodes || {});
      setNosposLookups(saved.nosposLookups || {});
    } else if (sessionBarcodes && Object.keys(sessionBarcodes).length > 0) {
      setBarcodes(sessionBarcodes);
      setNosposLookups(sessionNosposLookups || {});
    } else {
      // Pre-populate barcodes from nosposBarcodes set by Quick Reprice (array of { barserial, href, name })
      const prePopulated = {};
      const prePopulatedLookups = {};
      for (const item of cartItems) {
        const rawBarcodes = item.nosposBarcodes || [];
        const seen = new Set();
        const barcodes = rawBarcodes.filter(b => {
          const key = b.barserial || '';
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (barcodes.length > 0) {
          prePopulated[item.id] = barcodes.map(b => b.barserial);
          barcodes.forEach((b, index) => {
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

    // Create a draft DB session (unless already attached to an existing one)
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
        cashConvertersResearchData: item.cashConvertersResearchData, quantity: item.quantity,
        variantId: item.variantId, cexSku: item.cexSku, attributeValues: item.attributeValues,
        referenceData: item.referenceData, offers: item.offers, cashOffers: item.cashOffers,
        voucherOffers: item.voucherOffers, image: item.image, rrpOffersSource: item.rrpOffersSource,
      }));
      const restoredBarcodes = saved?.barcodes || sessionBarcodes || {};
      const restoredLookups = saved?.nosposLookups || sessionNosposLookups || {};
      createRepricingSessionDraft({
        cart_key: cartKey,
        item_count: cartItems.length,
        session_data: { items: itemsSnapshot, barcodes: restoredBarcodes, nosposLookups: restoredLookups },
      }).then(resp => {
        if (resp?.repricing_session_id) {
          setDbSessionId(resp.repricing_session_id);
          useAppStore.getState().setRepricingSessionId(resp.repricing_session_id);
        }
      }).catch(err => {
        console.warn('[CG Suite] Failed to create draft session:', err);
      });
    }

    setIsLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state (must be before useEffects that use it) ─────────────────────
  const activeItems = items.filter(i => !i.isRemoved);
  const activeCartKey = getCartKey(activeItems);

  useEffect(() => {
    if (
      activeCartKey &&
      (
        Object.keys(barcodes).length > 0 ||
        Object.keys(nosposLookups).length > 0
      )
    ) {
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
  }, [activeCartKey, showNotification]);

  useEffect(() => {
    if (!activeCartKey) return;

    let cancelled = false;

    const syncLiveStatus = async () => {
      try {
        const response = await getNosposRepricingStatus();
        const payload = response?.ok ? response.payload : null;
        if (cancelled || !payload || payload.cartKey !== activeCartKey) return;
        // Update when running, or when stopped/cancelled (so we clear the stuck overlay)
        setRepricingJob(payload);
        setCompletedBarcodes(payload.completedBarcodes || {});
        setCompletedItems(payload.completedItems || []);
      } catch {
        // Ignore polling failures if extension is unavailable.
      }
    };

    const checkForCompletedResult = async () => {
      try {
        const response = await getLastRepricingResult();
        if (cancelled || !response?.ok || !response.payload) return;
        await persistCompletedRepricing(response.payload);
      } catch {
        // Ignore polling failures if extension is unavailable.
      }
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

  useEffect(() => {
    lastHandledCompletionRef.current = "";
  }, [activeCartKey]);

  const getLookupKey = (itemId, barcodeIndex) => `${itemId}_${barcodeIndex}`;

  const getBarcodeLookup = (itemId, barcodeIndex) =>
    nosposLookups[getLookupKey(itemId, barcodeIndex)] || null;

  const getVerifiedBarcodesForItem = (itemId) =>
    (barcodes[itemId] || []).flatMap((code, index) => {
      const lookup = getBarcodeLookup(itemId, index);
      return lookup?.status === 'selected' && lookup.stockBarcode
        ? [lookup.stockBarcode]
        : [];
    });

  const isBarcodeResolved = (itemId, barcodeIndex) => {
    const lookup = getBarcodeLookup(itemId, barcodeIndex);
    return lookup?.status === 'selected' || lookup?.status === 'skipped';
  };

  const isItemReadyForRepricing = (itemId) => {
    const itemBarcodes = barcodes[itemId] || [];
    if (!itemBarcodes.length) return false;
    const hasVerified = getVerifiedBarcodesForItem(itemId).length > 0;
    const allResolved = itemBarcodes.every((_, index) => isBarcodeResolved(itemId, index));
    return hasVerified && allResolved;
  };

  const allItemsReadyForRepricing =
    activeItems.length > 0 &&
    activeItems.every((item) => isItemReadyForRepricing(item.id));
  const isBackgroundRepricingRunning = repricingJob?.running && repricingJob?.cartKey === activeCartKey;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleRemoveItem = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    showNotification(`"${item.title || 'Item'}" removed from reprice list`, 'info');
  };

  // ── Add items from the header builder (category/CeX/eBay) ──────────────────
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
      if (uniqueBarcodes.length > 0) {
        newBarcodes[item.id] = uniqueBarcodes.map(b => b.barserial);
        uniqueBarcodes.forEach((b, index) => {
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
  }, []);

  const handleAddRepricingItem = useCallback((cartItem) => {
    if (!cartItem) return;
    const item = {
      ...cartItem,
      id: cartItem.id || (crypto.randomUUID?.() ?? `reprice-item-${Date.now()}`),
      quantity: cartItem.quantity || 1,
      nosposBarcodes: cartItem.nosposBarcodes || [],
      ebayResearchData: cartItem.ebayResearchData || null,
      cashConvertersResearchData: cartItem.cashConvertersResearchData || null,
      isRemoved: false,
    };
    addItemsWithBarcodePrepopulation([item]);
    showNotification(`Added "${item.title || 'Item'}" to reprice list`, 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification]);

  const handleEbayResearchCompleteFromHeader = useCallback((data) => {
    if (!data) return;
    const searchTitle = data.searchTerm?.trim()?.slice(0, 200) || 'eBay Research Item';
    const customItem = {
      id: crypto.randomUUID?.() ?? `reprice-ebay-${Date.now()}`,
      title: searchTitle,
      subtitle: 'eBay Research',
      quantity: 1,
      category: 'eBay',
      categoryObject: EBAY_TOP_LEVEL_CATEGORY,
      offers: [],
      cashOffers: [],
      voucherOffers: [],
      ebayResearchData: data,
      isCustomEbayItem: true,
      selectedOfferId: null,
      ourSalePrice: data.stats?.suggestedPrice != null ? Number(formatOfferPrice(data.stats.suggestedPrice)) : null,
      nosposBarcodes: [],
      cashConvertersResearchData: null,
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
    showNotification(`Added "${customItem.title}" to reprice list`, 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification]);

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
        referenceData: null,
        quantity: 1,
        isRemoved: false,
      };
    });
    addItemsWithBarcodePrepopulation(newItems);
    showNotification(`${newItems.length} item${newItems.length !== 1 ? 's' : ''} added to reprice list`, 'success');
  }, [addItemsWithBarcodePrepopulation, showNotification]);

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers: false,
  });

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
      if (!isItemReadyForRepricing(item.id)) {
        showNotification(`Verify the NosPos barcode for: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
    }
    if (zeroSalePriceItems.length > 0) {
      setZeroSalePriceModal({ itemTitles: zeroSalePriceItems });
      return;
    }
    showNotification("Starting background repricing…", 'info');
    try {
      lastHandledCompletionRef.current = "";
      // Restart from zero: clear previous run's progress so repricing processes all barcodes again
      setCompletedBarcodes({});
      setCompletedItems([]);
      const freshCompletedBarcodes = {};
      const freshCompletedItems = [];
      setRepricingJob({
        cartKey: activeCartKey,
        running: true,
        done: false,
        step: 'starting',
        message: 'Opening NoSpos in the background',
        currentBarcode: '',
        currentItemId: '',
        currentItemTitle: '',
        totalBarcodes: activeItems.reduce((sum, item) => sum + getVerifiedBarcodesForItem(item.id).length, 0),
        completedBarcodeCount: 0,
        completedBarcodes: freshCompletedBarcodes,
        completedItems: freshCompletedItems,
        logs: [{
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Starting background repricing…'
        }]
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
    useAppStore.getState().resetRepricingWorkspace();
    navigate('/repricing');
  }, [navigate]);

  const handleCloseAmbiguousBarcodeModal = () => {
    setAmbiguousBarcodeModal(null);
  };

  const handleAmbiguousBarcodeChange = (index, value) => {
    setAmbiguousBarcodeModal((prev) => {
      if (!prev) return prev;
      const entries = prev.entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, replacementBarcode: value } : entry
      );
      return { ...prev, entries };
    });
  };

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
          itemId: item.id,
          title: item.title || "",
          salePrice: resolveRepricingSalePrice(item),
          ourSalePriceAtRepricing: resolveRepricingSalePrice(item),
          cexSellAtRepricing: item.cexSellPrice ?? null,
          raw_data: item.ebayResearchData || {},
          cash_converters_data: item.cashConvertersResearchData || {},
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
      await openNospos(retryData, { completedBarcodes: {}, completedItems: [], cartKey: activeCartKey });
      setAmbiguousBarcodeModal(null);
      showNotification("Retrying the more specific barcodes in NoSpos…", "info");
    } catch (err) {
      setAmbiguousBarcodeModal((prev) => (prev ? { ...prev, isRetrying: false } : prev));
      showNotification(err?.message || "Could not retry those barcodes.", "error");
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ui-bg)' }}>
        <p className="text-sm text-gray-500">Loading reprice list...</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="text-sm overflow-hidden min-h-screen flex flex-col" style={{ background: '#f8f9fa', color: '#1a1a1a' }}>
      <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        .reprice-table th {
          background: var(--brand-blue);
          color: white;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.75rem;
          border-right: 1px solid rgba(255,255,255,0.1);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .reprice-table th:last-child { border-right: 0; }
        .reprice-table td {
          padding: 0.5rem 0.75rem;
          border-right: 1px solid #e5e7eb;
          vertical-align: middle;
          transition: background-color 0.1s ease, box-shadow 0.1s ease;
          box-shadow: inset 0 0 0 0 transparent;
        }
        .reprice-table td:last-child { border-right: 0; }
        .reprice-table tr { border-bottom: 1px solid #e5e7eb; }
        .reprice-table tbody td:hover {
          background: var(--brand-blue-alpha-10);
          box-shadow: inset 0 0 0 2px var(--brand-blue-alpha-30);
        }
        ${SPREADSHEET_CEX_TH_STYLES}
        ${RRP_SOURCE_CELL_STYLES}
      `}</style>

      <AppHeader
        buyerControls={{
          enabled: true,
          selectedCategory,
          onCategorySelect: selectCategory,
          onAddFromCeX: (opts) => handleAddFromCeX({ showNotification, ...opts }),
          isCeXLoading: cexLoading,
          enableNegotiationItemBuilder: true,
          useVoucherOffers: false,
          onAddNegotiationItem: handleAddRepricingItem,
          onEbayResearchComplete: handleEbayResearchCompleteFromHeader,
          cexProductData,
          setCexProductData,
          clearCexProduct,
          existingItems: items,
          showNotification,
          onQuickReprice: () => setIsQuickRepriceOpen(true),
        }}
      />

      <main className="relative flex flex-1 overflow-hidden h-[calc(100vh-61px)]">

        {/* ── Main Table Section ─────────────────────────────────────────────── */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">

          {/* Top Controls */}
          <div className="p-6 border-b" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex items-center justify-between gap-6">
              <div
                className="flex items-center gap-3 px-5 py-3 rounded-xl border"
                style={{ borderColor: 'var(--brand-blue-alpha-20)', background: 'var(--brand-blue-alpha-03)' }}
              >
                <span className="material-symbols-outlined text-2xl" style={{ color: 'var(--brand-blue)' }}>sell</span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>
                    Repricing Session
                  </p>
                  <p className="text-xs" style={{ color: '#64748b' }}>
                    {activeItems.length} item{activeItems.length !== 1 ? 's' : ''} to reprice
                  </p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748b' }}>
                  Items
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>
                  {activeItems.length}
                </p>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-auto flex-1">
            <table className="w-full reprice-table border-collapse text-left">
              <thead>
                <tr>
                  <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                  <th className="w-24 spreadsheet-th-cex">Sell</th>
                  <th className="w-24 spreadsheet-th-cex">Voucher</th>
                  <th className="w-24 spreadsheet-th-cex">Cash</th>
                  <th className="w-28">New Sale Price</th>
                  <th className="w-36">eBay Price</th>
                  <th className="w-36">Cash Converters</th>
                  <th className="w-44">Barcodes</th>
                </tr>
              </thead>

              <tbody className="text-xs">
                {items.map((item, index) => {
                  const ebayData = item.ebayResearchData;
                  const ccData = item.cashConvertersResearchData;
                  const cexOutOfStock = item.cexOutOfStock || item.cexProductData?.isOutOfStock || false;
                  const itemBarcodes = barcodes[item.id] || [];
                  const hasBarcodes = itemBarcodes.length > 0;

                  const {
                    totalSalePrice,
                    isEditingRowTotal,
                    displayValue: salePriceDisplayValue,
                  } = getEditableSalePriceState(item);

                  const handleOurSalePriceBlur = () => {
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
                      if (Number.isNaN(parsedTotal) || parsedTotal <= 0) {
                        // Reject invalid/non-positive input and keep previous value.
                        return next;
                      }
                      next.ourSalePrice = String(normalizeExplicitSalePrice(parsedTotal / qty));
                      return next;
                    }));
                    if (raw !== '' && (Number.isNaN(parsedTotal) || parsedTotal <= 0)) {
                      showNotification('Our sale price must be greater than £0', 'error');
                    }
                  };

                  const openRowContext = (e, zone) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, item, zone });
                  };

                  const hlCexSource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL;
                  const hlEbaySource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
                  const hlCcSource = item.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;

                  return (
                    <tr
                      key={item.id || index}
                      className={item.isRemoved ? 'opacity-60' : ''}
                      style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
                    >
                      {/* Item Name & Attributes */}
                      <td onContextMenu={(e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.ITEM_META)}>
                        <div
                          className="font-bold text-[13px] flex items-center gap-2 flex-wrap"
                          style={{ color: 'var(--brand-blue)' }}
                        >
                          {item.title || 'N/A'}
                          {cexOutOfStock && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                              CeX out of stock
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: '#64748b' }}>
                          {(item.cexBuyPrice != null || item.cexSellPrice != null)
                            ? (item.subtitle || '')
                            : (item.subtitle || item.category || 'No details')}
                          {item.model && ` | ${item.model}`}
                        </div>
                        <div className="text-[9px] mt-1 text-slate-400 italic">Right-click to remove</div>
                      </td>

                      {/* CeX Sell */}
                      <td
                        className={[
                          'font-medium align-top',
                          hlCexSource ? `text-white ${RRP_SOURCE_CELL_CLASS}` : 'text-red-700',
                        ].join(' ')}
                        onContextMenu={(e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CEX_SELL)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            {item.cexSellPrice != null ? (
                              <div>
                                {item.cexUrl ? (
                                  <a
                                    href={item.cexUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={hlCexSource ? 'text-white underline decoration-dotted' : 'text-red-700 underline decoration-dotted'}
                                  >
                                    £{item.cexSellPrice.toFixed(2)}
                                  </a>
                                ) : (
                                  <div>£{item.cexSellPrice.toFixed(2)}</div>
                                )}
                              </div>
                            ) : '—'}
                          </div>
                          <button
                            className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                            style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                            onClick={() => handleRefreshCeXData(item)}
                            title="Refresh CeX prices"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                        </div>
                      </td>

                      <td className="font-medium text-red-700 align-top">
                        {item.cexVoucherPrice != null && !Number.isNaN(Number(item.cexVoucherPrice))
                          ? `£${Number(item.cexVoucherPrice).toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="font-medium text-red-700 align-top">
                        {item.cexBuyPrice != null && !Number.isNaN(Number(item.cexBuyPrice))
                          ? `£${Number(item.cexBuyPrice).toFixed(2)}`
                          : '—'}
                      </td>

                      {/* New Sale Price — editable */}
                      <td className="font-medium text-red-700">
                        <div>
                          <input
                            className="w-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0 bg-white rounded"
                            placeholder="£0.00"
                            type="text"
                            value={salePriceDisplayValue}
                            onChange={(e) => {
                              const value = e.target.value.replace(/[£,]/g, '').trim();
                              setItems(prev =>
                                prev.map(i => i.id === item.id ? { ...i, ourSalePriceInput: value } : i)
                              );
                            }}
                            onBlur={handleOurSalePriceBlur}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                            onFocus={() => {
                              if (item.ourSalePriceInput === undefined && salePriceDisplayValue !== '') {
                                setItems(prev =>
                                  prev.map(i => i.id === item.id ? { ...i, ourSalePriceInput: salePriceDisplayValue } : i)
                                );
                              }
                            }}
                          />
                          {!isEditingRowTotal && totalSalePrice != null && !Number.isNaN(totalSalePrice) && (
                            <div className="text-[9px] opacity-70 mt-0.5">
                              £{totalSalePrice.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* eBay Price */}
                      <td
                        className={hlEbaySource ? RRP_SOURCE_CELL_CLASS : undefined}
                        onContextMenu={(e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY)}
                      >
                        {ebayData?.stats?.median ? (
                          <div className="flex items-center justify-between gap-2">
                            <div
                              className="text-[13px] font-medium"
                              style={{ color: hlEbaySource ? '#fff' : 'var(--brand-blue)' }}
                            >
                              <div>£{Number(ebayData.stats.median).toFixed(2)}</div>
                            </div>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={() => setResearchItem(item)}
                              title="View/Refine eBay Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-[13px] font-medium"
                              style={{ color: hlEbaySource ? 'rgba(255,255,255,0.85)' : '#64748b' }}
                            >
                              —
                            </span>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={() => setResearchItem(item)}
                              title="Research eBay"
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Cash Converters */}
                      <td
                        className={hlCcSource ? RRP_SOURCE_CELL_CLASS : undefined}
                        onContextMenu={(e) => openRowContext(e, NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS)}
                      >
                        {ccData?.stats?.median ? (
                          <div className="flex items-center justify-between gap-2">
                            <div
                              className="text-[13px] font-medium"
                              style={{ color: hlCcSource ? '#fff' : 'var(--brand-blue)' }}
                            >
                              <div>£{Number(ccData.stats.median).toFixed(2)}</div>
                            </div>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={() => setCashConvertersResearchItem(item)}
                              title="View/Refine Cash Converters Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">store</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-[13px] font-medium"
                              style={{ color: hlCcSource ? 'rgba(255,255,255,0.85)' : '#64748b' }}
                            >
                              —
                            </span>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={() => setCashConvertersResearchItem(item)}
                              title="Research Cash Converters"
                            >
                              <span className="material-symbols-outlined text-[16px]">store</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Barcodes */}
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
                          title="Click to manage barcodes"
                        >
                          <span className="material-symbols-outlined text-[14px]">barcode</span>
                          <span className="flex-1 text-left">
                            {hasBarcodes
                              ? isItemReadyForRepricing(item.id)
                                ? 'Barcodes verified'
                                : 'Barcodes need review'
                              : 'Add barcodes'}
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
                    </tr>
                  );
                })}

                <tr className="h-10 opacity-50"><td colSpan="6"></td></tr>
                <tr className="h-10 opacity-50"><td colSpan="6"></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Sidebar ────────────────────────────────────────────────────────── */}
        <aside
          className="w-80 border-l flex flex-col bg-white shrink-0"
          style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b bg-brand-blue" style={{ borderColor: 'var(--brand-blue-alpha-20)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-brand-orange text-2xl">sell</span>
                <div>
                  <p className="text-sm font-black uppercase tracking-wider text-white">Reprice List</p>
                  <p className="text-xs text-white/70">
                    {activeItems.length} item{activeItems.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewRepricingConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Clear reprice list and start a new repricing session"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                New Repricing
              </button>
            </div>
          </div>

          {/* Barcode status */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <p
                className="text-[10px] font-black uppercase tracking-wider mb-3"
                style={{ color: 'var(--brand-blue)' }}
              >
                Barcode Status
              </p>
              <div className="space-y-2">
                {activeItems.map(i => {
                  const count = (barcodes[i.id] || []).length;
                  const itemComplete = isItemReadyForRepricing(i.id);
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate flex-1 flex items-center gap-1" style={{ color: '#64748b' }}>
                        {itemComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                        {i.title}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          itemComplete ? 'bg-emerald-200 text-emerald-800' : count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {count === 0 ? 'missing' : itemComplete ? 'verified' : 'needs review'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="p-6 bg-white border-t space-y-4"
            style={{ borderColor: 'var(--brand-blue-alpha-20)' }}
          >
            <button
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                headerWorkspaceOpen || researchItem || cashConvertersResearchItem || !allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)',
                boxShadow: '0 10px 15px -3px rgba(247,185,24,0.3)'
              }}
              onClick={handleProceed}
              disabled={headerWorkspaceOpen || researchItem || cashConvertersResearchItem || !allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning}
            >
              <span className="text-base uppercase tracking-tight">
                {isRepricingFinished ? 'Repricing Finished' : isBackgroundRepricingRunning ? 'Repricing Running in Background' : 'Proceed with Repricing'}
              </span>
              {!isRepricingFinished && !isBackgroundRepricingRunning && (
                <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              )}
              {isBackgroundRepricingRunning && (
                <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
              )}
            </button>
            {!allItemsReadyForRepricing && !isRepricingFinished && (
              <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
                Verify a NoSpos barcode for every item before proceeding
              </p>
            )}
            {isRepricingFinished && completedItemsData.length > 0 && (
              <button
                onClick={() => openBarcodePrintTab(completedItemsData)}
                className="w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ background: 'var(--brand-blue)', color: '#fff' }}
              >
                <span className="material-symbols-outlined text-xl">print</span>
                <span className="text-sm uppercase tracking-tight">Print Barcodes</span>
              </button>
            )}
            {isRepricingFinished && completedItemsData.length === 0 && (
              <p className="text-[10px] text-center text-emerald-700 font-semibold -mt-2">
                Repricing finished
              </p>
            )}
          </div>
        </aside>

        <ResearchOverlayPanel
          researchItem={researchItem}
          cashConvertersResearchItem={cashConvertersResearchItem}
          onResearchComplete={handleResearchComplete}
          onCashConvertersResearchComplete={handleCashConvertersResearchComplete}
          hideOfferCards={true}
        />
      </main>

      {/* ── Context Menu ───────────────────────────────────────────────────────── */}
      {contextMenu && (
        <NegotiationRowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          zone={contextMenu.zone}
          removeLabel="Remove from reprice list"
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveItem(contextMenu.item)}
          onUseAsRrpOffersSource={() =>
            handlePriceSourceAsRrpOffersSource(contextMenu.item, contextMenu.zone, {
              showNotification,
              setItems,
              useVoucherOffers: false,
            })}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={false}
        priceLabel="New Sale Price"
        repricingMode
        showNotification={showNotification}
      />

      {showNewRepricingConfirm && (
        <TinyModal
          title="Start a new repricing?"
          onClose={() => setShowNewRepricingConfirm(false)}
        >
          <p className="text-xs text-slate-600 mb-5">
            This will clear your current reprice list and start fresh from the repricing workspace.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: 'white', color: 'var(--text-muted)', border: '1px solid var(--ui-border)' }}
              onClick={() => setShowNewRepricingConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={handleConfirmNewRepricing}
            >
              Yes, start new repricing
            </button>
          </div>
        </TinyModal>
      )}

      {isBackgroundRepricingRunning && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
          <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl bg-white shadow-2xl border" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
            <div className="px-6 py-5 border-b bg-brand-blue" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
              <div className="flex items-start gap-4">
                <span className="material-symbols-outlined text-brand-orange text-3xl animate-spin">progress_activity</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Background Repricing In Progress</p>
                  <h3 className="text-xl font-black text-white mt-1">Please wait while CG Suite updates NoSpos</h3>
                  <p className="text-sm text-white/80 mt-2">
                    The rest of this screen is locked while the hidden NoSpos worker is running so the process stays consistent.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await cancelNosposRepricing(activeCartKey);
                      showNotification('Repricing cancelled', 'info');
                    } catch (e) {
                      showNotification('Could not cancel repricing', 'error');
                    }
                  }}
                  className="shrink-0 px-4 py-2 rounded-lg font-bold text-sm bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                  Cancel
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Current Status</p>
                <p className="text-sm font-bold text-slate-800 mt-1">{repricingJob?.message || 'Working…'}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {repricingJob?.currentItemTitle ? `Item: ${repricingJob.currentItemTitle}` : 'Waiting for first item'}
                  {repricingJob?.currentBarcode ? ` · Barcode: ${repricingJob.currentBarcode}` : ''}
                </p>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Progress</p>
                  <p className="text-xs font-bold text-slate-600">
                    {repricingJob?.completedBarcodeCount || 0} / {repricingJob?.totalBarcodes || 0} barcodes completed
                  </p>
                </div>
                <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${repricingJob?.totalBarcodes ? Math.min(100, ((repricingJob.completedBarcodeCount || 0) / repricingJob.totalBarcodes) * 100) : 0}%`,
                      background: 'var(--brand-blue)'
                    }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
                <div className="px-4 py-3 bg-slate-50 border-b" style={{ borderColor: 'var(--brand-blue-alpha-08)' }}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Detailed Process Stack</p>
                  <p className="text-xs text-slate-500 mt-1">This stays in order from start to finish so you can follow each item and barcode step-by-step.</p>
                </div>
                <div className="max-h-[38vh] overflow-y-auto buyer-panel-scroll p-4 space-y-2 bg-white">
                  {[...(repricingJob?.logs || [])].slice(-40).map((entry, index) => (
                    <div key={`${entry.timestamp || 'log'}-${index}`} className="rounded-xl border px-3 py-2.5 bg-slate-50" style={{ borderColor: 'var(--brand-blue-alpha-08)' }}>
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Step {Math.max(1, (repricingJob?.logs || []).slice(-40).length ? index + 1 : 1)}</p>
                      <p className="text-[11px] font-semibold text-slate-700 leading-relaxed">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {unverifiedModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setUnverifiedModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">
                    Manual Verification Required
                  </p>
                  <p className="text-sm mt-1 font-semibold" style={{ color: 'var(--text-main)' }}>
                    {unverifiedModal.entries.length} barcode{unverifiedModal.entries.length !== 1 ? 's' : ''} couldn't be automatically verified after saving.
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#475569' }}>
                    The price was likely saved correctly — NosPos just didn't confirm it in time.
                    Please open each link below and double-check the retail price is set correctly.
                  </p>
                </div>
                <button onClick={() => setUnverifiedModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-3 overflow-y-auto max-h-[55vh]">
              {unverifiedModal.entries.map((entry, index) => (
                <div key={`${entry.itemId}-${entry.barcodeIndex}-${index}`} className="rounded-xl border p-4" style={{ borderColor: 'rgba(247,185,24,0.4)', background: '#fffbeb' }}>
                  <p className="text-sm font-bold mb-3" style={{ color: 'var(--brand-blue)' }}>
                    {entry.itemTitle}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        Typed Barcode
                      </p>
                      <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                        {entry.barcode || '—'}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        NosPos Barcode
                      </p>
                      <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                        {entry.stockBarcode || '—'}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        NosPos Link
                      </p>
                      {entry.stockUrl ? (
                        <a
                          href={entry.stockUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold bg-white hover:bg-brand-blue/5 transition-colors"
                          style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
                        >
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                          Open in NosPos
                        </a>
                      ) : (
                        <div className="px-3 py-2 rounded-lg border text-sm bg-white text-slate-400 italic" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
                          No link available
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>
                The price was saved in NosPos — this is just a confirmation check that timed out.
              </p>
              <button
                className="px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: 'var(--brand-blue)', color: 'white' }}
                onClick={() => setUnverifiedModal(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {ambiguousBarcodeModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCloseAmbiguousBarcodeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>
                    Specific Barcodes Required
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#475569' }}>
                    These barcodes only opened the stock search page, so NoSpos could not jump straight to a stock item.
                    Type more specific barcodes, then retry only those rows.
                  </p>
                </div>
                <button onClick={handleCloseAmbiguousBarcodeModal} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[55vh]">
              {ambiguousBarcodeModal.entries.map((entry, index) => (
                <div key={`${entry.itemId}-${entry.barcodeIndex}-${index}`} className="rounded-xl border p-4" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
                  <p className="text-sm font-bold mb-2" style={{ color: 'var(--brand-blue)' }}>
                    {entry.itemTitle}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        Old Typed Barcode
                      </p>
                      <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'var(--brand-blue-alpha-15)', color: 'var(--brand-blue)' }}>
                        {entry.oldBarcode || '—'}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        More Specific Barcode
                      </p>
                      <input
                        className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
                        style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
                        type="text"
                        placeholder="Type a more specific barcode"
                        value={entry.replacementBarcode}
                        onChange={(e) => handleAmbiguousBarcodeChange(index, e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>
                Clicking outside skips these for now and keeps them out of repricing history.
              </p>
              <div className="flex items-center gap-3">
                <button
                  className="px-4 py-2 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--brand-blue-alpha-20)', color: 'var(--brand-blue)', background: 'white' }}
                  onClick={handleCloseAmbiguousBarcodeModal}
                >
                  Close
                </button>
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                    ambiguousBarcodeModal.isRetrying ? 'opacity-70 cursor-wait' : ''
                  }`}
                  style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                  onClick={handleRetryAmbiguousBarcodes}
                  disabled={ambiguousBarcodeModal.isRetrying}
                >
                  {ambiguousBarcodeModal.isRetrying ? 'Retrying…' : 'Retry Typed Barcodes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Barcode Modal ──────────────────────────────────────────────────────── */}
      {barcodeModal && (() => {
        const modalItem = barcodeModal.item;
        const itemBarcodes = barcodes[modalItem.id] || [];

        const runNosposLookup = (code, barcodeIndex) => {
          const lookupKey = `${modalItem.id}_${barcodeIndex}`;
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
                // Auto-select single result
                setNosposLookups(prev => ({
                  ...prev,
                  [lookupKey]: {
                    status: 'selected',
                    results,
                    stockBarcode: results[0].barserial,
                    stockName: results[0].name || '',
                    stockUrl: `https://nospos.com${results[0].href}`
                  }
                }));
              } else {
                showNotification(`Found ${results.length} NosPos matches for barcode ${code}. Pick the right one below.`, "info");
                setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'found', results } }));
                // Auto-open the results panel for this barcode
                setNosposResultsPanel({ itemId: modalItem.id, barcodeIndex });
              }
            } else {
              showNotification(result?.error || "NosPos lookup failed.", "error");
              setNosposLookups(prev => ({
                ...prev,
                [lookupKey]: { status: 'error', error: result?.error || 'Search failed' }
              }));
            }
          }).catch(err => {
            showNotification(err?.message || "NosPos lookup failed.", "error");
            setNosposLookups(prev => ({
              ...prev,
              [lookupKey]: { status: 'error', error: err?.message || 'Extension unavailable' }
            }));
          });
        };

        const addBarcode = () => {
          const code = barcodeInput.trim();
          if (!code) return;
          const newIdx = (barcodes[modalItem.id] || []).length;
          setBarcodes(prev => ({
            ...prev,
            [modalItem.id]: [...(prev[modalItem.id] || []), code]
          }));
          setBarcodeInput('');
          runNosposLookup(code, newIdx);
        };

        const removeBarcode = (code) => {
          setBarcodes(prev => ({
            ...prev,
            [modalItem.id]: (prev[modalItem.id] || []).filter(b => b !== code)
          }));
        };

        const selectNosposResult = (lookupKey, result) => {
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
        };

        const skipNosposLookup = (lookupKey) => {
          setNosposLookups(prev => ({
            ...prev,
            [lookupKey]: { ...prev[lookupKey], status: 'skipped' }
          }));
        };

        return (
          <TinyModal title="Barcodes" onClose={() => { setBarcodeModal(null); setNosposResultsPanel(null); }}>
            <p className="text-xs font-semibold mb-4" style={{ color: 'var(--brand-blue)' }}>
              {modalItem.title}
            </p>

            {itemBarcodes.length > 0 ? (
              <div className="space-y-2 mb-4 max-h-96 overflow-y-auto">
                {itemBarcodes.map((code, idx) => {
                  const isComplete = (completedBarcodes[modalItem.id] || []).includes(idx);
                  const lookupKey = `${modalItem.id}_${idx}`;
                  const lookup = nosposLookups[lookupKey];
                  const isPanelOpen = nosposResultsPanel?.itemId === modalItem.id && nosposResultsPanel?.barcodeIndex === idx;

                  return (
                    <div key={idx} className="rounded-lg border overflow-hidden" style={{ borderColor: isComplete ? '#a7f3d0' : 'var(--brand-blue-alpha-15)' }}>
                      {/* Top row: barcode code + status + remove */}
                      <div className={`flex items-center gap-2 px-3 py-1.5 ${isComplete ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                        <span className="flex-1 text-xs font-mono font-semibold flex items-center gap-1.5" style={{ color: 'var(--brand-blue)' }}>
                          {isComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                          {code}
                        </span>

                        {/* NosPos lookup status badges */}
                        {lookup?.status === 'searching' && (
                          <span className="text-[10px] font-semibold text-brand-blue/80 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px] animate-spin">refresh</span>
                            Searching…
                          </span>
                        )}
                        {lookup?.status === 'selected' && (
                          <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 min-w-0">
                            <span className="material-symbols-outlined text-[12px]">check_circle</span>
                            <span className="truncate">
                              <a
                                href={lookup.stockUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                                title={lookup.stockBarcode}
                              >
                                {lookup.stockBarcode}
                              </a>
                              {lookup.stockName ? (
                                <>
                                  {' '}
                                  ·{' '}
                                  <a
                                    href={lookup.stockUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline"
                                    title={lookup.stockName}
                                  >
                                    {lookup.stockName}
                                  </a>
                                </>
                              ) : null}
                            </span>
                          </span>
                        )}
                        {lookup?.status === 'found' && (
                          <button
                            className="text-[10px] font-semibold text-brand-blue hover:text-brand-blue-hover flex items-center gap-1 transition-colors"
                            onClick={() => setNosposResultsPanel(isPanelOpen ? null : { itemId: modalItem.id, barcodeIndex: idx })}
                          >
                            <span className="material-symbols-outlined text-[12px]">list</span>
                            {lookup.results.length} result{lookup.results.length !== 1 ? 's' : ''} — pick one
                          </button>
                        )}
                        {lookup?.status === 'not_found' && (
                          <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">search_off</span>
                            Not found
                          </span>
                        )}
                        {lookup?.status === 'skipped' && (
                          <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">skip_next</span>
                            Skipped
                          </span>
                        )}
                        {lookup?.status === 'error' && (
                          <span className="text-[10px] font-semibold text-red-400" title={lookup.error}>
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                          </span>
                        )}

                        {(lookup?.status === 'not_found' || lookup?.status === 'error') && (
                          <button
                            className="text-[10px] font-semibold text-brand-blue hover:text-brand-blue-hover transition-colors flex items-center gap-0.5"
                            onClick={() => runNosposLookup(code, idx)}
                            title="Retry NosPos lookup"
                          >
                            <span className="material-symbols-outlined text-[12px]">refresh</span>
                            Retry
                          </button>
                        )}

                        {/* Skip button for not_found / found / error states */}
                        {(lookup?.status === 'not_found' || lookup?.status === 'found' || lookup?.status === 'error') && (
                          <button
                            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-0.5"
                            onClick={() => { skipNosposLookup(lookupKey); setNosposResultsPanel(null); }}
                            title="Skip this barcode"
                          >
                            Skip
                          </button>
                        )}

                        <button
                          onClick={() => removeBarcode(code)}
                          className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                          title="Remove barcode"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>

                      {/* Results panel (shown when multiple results and user expands or auto-opens) */}
                      {isPanelOpen && lookup?.results?.length > 0 && (
                        <div className="border-t" style={{ borderColor: 'var(--brand-blue-alpha-10)' }}>
                          <div className="px-2 py-1.5 bg-brand-blue/5">
                            <p className="text-[10px] font-semibold text-brand-blue mb-1">Select the matching item on NosPos:</p>
                            <div className="space-y-1">
                              {lookup.results.map((result, ri) => (
                                <div
                                  key={ri}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white border hover:border-brand-blue/30 hover:bg-brand-blue/5 transition-colors cursor-pointer group"
                                  style={{ borderColor: 'var(--brand-blue-alpha-15)' }}
                                >
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={`https://nospos.com${result.href}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block text-[11px] font-mono font-bold text-brand-blue hover:underline leading-tight"
                                      onClick={() => selectNosposResult(lookupKey, result)}
                                    >
                                      {result.barserial}
                                    </a>
                                    <a
                                      href={`https://nospos.com${result.href}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block text-[10px] text-slate-500 truncate leading-tight mt-0.5 hover:underline"
                                      onClick={() => selectNosposResult(lookupKey, result)}
                                    >
                                      {result.name}
                                    </a>
                                    <p className="text-[10px] text-slate-400 leading-tight">
                                      Cost {result.costPrice} · Retail {result.retailPrice} · Qty {result.quantity}
                                    </p>
                                  </div>
                                  <button
                                    className="flex-shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-colors"
                                    style={{ background: 'var(--brand-blue)', color: 'white' }}
                                    onClick={() => selectNosposResult(lookupKey, result)}
                                  >
                                    Select
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              className="mt-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                              onClick={() => setNosposResultsPanel(null)}
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic mb-4">No barcodes added yet.</p>
            )}

            <div className="flex gap-2 mb-4">
              <input
                autoFocus
                className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--brand-blue-alpha-30)', color: 'var(--brand-blue)' }}
                type="text"
                placeholder="Enter barcode"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addBarcode(); }}
              />
              <button
                className="px-3 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: 'var(--brand-blue)', color: 'white' }}
                onClick={addBarcode}
              >
                Add
              </button>
            </div>

            <button
              className="w-full py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={() => { setBarcodeModal(null); setNosposResultsPanel(null); }}
            >
              OK
            </button>
          </TinyModal>
        );
      })()}

      {isQuickRepriceOpen && (
        <QuickRepriceModal
          onClose={() => setIsQuickRepriceOpen(false)}
          onAddItems={handleQuickRepriceItems}
        />
      )}

      {zeroSalePriceModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--brand-blue-alpha-15)' }}>
              <p className="text-[11px] font-black uppercase tracking-wider text-amber-600">
                Cannot Update Sale Price
              </p>
              <p className="text-sm mt-2" style={{ color: '#475569' }}>
                Sale price is £0 based on current data, so this item cannot be updated in NoSpos.
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
                Affected item{zeroSalePriceModal.itemTitles.length !== 1 ? 's' : ''}
              </p>
              <ul className="space-y-1 max-h-36 overflow-y-auto">
                {zeroSalePriceModal.itemTitles.map((title, idx) => (
                  <li key={`${title}-${idx}`} className="text-xs font-semibold text-brand-blue">
                    {title}
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-6 py-4 border-t flex justify-end" style={{ borderColor: 'var(--brand-blue-alpha-15)', background: 'var(--ui-bg)' }}>
              <button
                className="px-4 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: 'var(--brand-blue)', color: 'white' }}
                onClick={() => setZeroSalePriceModal(null)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepricingNegotiation;
