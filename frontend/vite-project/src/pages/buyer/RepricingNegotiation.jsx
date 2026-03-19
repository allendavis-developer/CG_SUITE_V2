import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import { useNotification } from "@/contexts/NotificationContext";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import TinyModal from "@/components/ui/TinyModal";
import { maybeShowSalePriceConfirm } from "./utils/researchCompletionHelpers";
import { cancelNosposRepricing, clearLastRepricingResult, getLastRepricingResult, getNosposRepricingStatus, openNospos, searchNosposBarcode } from "@/services/extensionClient";
import { saveRepricingSession, createRepricingSessionDraft, updateRepricingSession, fetchRepricingSessionDetail } from "@/services/api";
import { getCartKey, loadRepricingProgress, saveRepricingProgress, clearRepricingProgress } from "@/utils/repricingProgress";
import { getEditableSalePriceState, resolveRepricingSalePrice } from "./utils/repricingDisplay";
import useAppStore from '@/store/useAppStore';
import { roundSalePrice } from '@/utils/helpers';
import { buildItemSpecs, buildInitialSearchQuery } from './utils/negotiationHelpers';

// ─── Right-click context menu (remove only) ────────────────────────────────
const ContextMenu = ({ x, y, onClose, onRemove }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] py-1 border shadow-xl bg-white rounded-lg"
      style={{ left: x, top: y, borderColor: 'var(--ui-border)' }}
    >
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-2 text-red-600"
        onClick={() => { onRemove(); onClose(); }}
      >
        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
        Remove from reprice list
      </button>
    </div>
  );
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

// ─── Main component ────────────────────────────────────────────────────────────
const RepricingNegotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotification();

  const storeCartItems = useAppStore((s) => s.repricingCartItems);
  const cartItems = location.state?.cartItems ?? storeCartItems;

  const [items, setItems] = useState([]);
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

  // Sale price confirm after research (shared with Negotiation)
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null); // { itemId, oldPricePerUnit, newPricePerUnit, source }

  // Research modal state
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [isRepricingFinished, setIsRepricingFinished] = useState(false);
  const [ambiguousBarcodeModal, setAmbiguousBarcodeModal] = useState(null);
  const [repricingJob, setRepricingJob] = useState(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }

  const hasInitialized = useRef(false);
  const lastHandledCompletionRef = useRef("");

  // ── DB session persistence ──────────────────────────────────────────────────
  const [dbSessionId, setDbSessionId] = useState(location.state?.sessionId || null);
  const autoSaveTimer = useRef(null);
  const isCreatingSession = useRef(false);
  const hasPendingSave = useRef(false);
  const latestStateRef = useRef({ items, barcodes, nosposLookups });

  useEffect(() => { latestStateRef.current = { items, barcodes, nosposLookups }; }, [items, barcodes, nosposLookups]);

  const buildSessionDataSnapshot = useCallback((state) => {
    const { items: snapshotItems, barcodes: snapshotBarcodes, nosposLookups: snapshotLookups } = state || latestStateRef.current;
    return {
      items: snapshotItems.map(({ id, title, subtitle, category, model, cexSellPrice, cexBuyPrice, cexUrl,
        ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData, isCustomCeXItem, condition,
        categoryObject, nosposBarcodes, ebayResearchData, cashConvertersResearchData, quantity,
        isRemoved }) => ({
        id, title, subtitle, category, model, cexSellPrice, cexBuyPrice, cexUrl,
        ourSalePrice, ourSalePriceInput, cexOutOfStock, cexProductData, isCustomCeXItem, condition,
        categoryObject, nosposBarcodes, ebayResearchData, cashConvertersResearchData, quantity,
        isRemoved,
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

  const persistCompletedRepricing = async (payload) => {
    if (!payload?.cart_key || payload.cart_key !== activeCartKey) return false;

    const fingerprint = JSON.stringify(payload);
    if (lastHandledCompletionRef.current === fingerprint) return false;
    lastHandledCompletionRef.current = fingerprint;

    const savePayload = buildSessionSavePayload(payload);
    const ambiguousEntries = buildAmbiguousBarcodeEntries(payload);

    try {
      if (savePayload.barcode_count > 0) {
        await saveRepricingSession(savePayload);
        clearRepricingProgress(activeCartKey);
      }

      // Mark the DB session as COMPLETED
      if (dbSessionId) {
        try {
          await updateRepricingSession(dbSessionId, { status: 'COMPLETED' });
        } catch {}
      }

      try {
        await clearLastRepricingResult();
      } catch {
        // Ignore extension cleanup failures after handling succeeds.
      }

      setIsRepricingFinished(true);
      setRepricingJob((prev) => prev ? { ...prev, running: false, done: true, step: 'completed', message: 'Repricing completed.' } : prev);

      if (ambiguousEntries.length > 0) {
        setAmbiguousBarcodeModal({ entries: ambiguousEntries, isRetrying: false });
        if (savePayload.barcode_count > 0) {
          showNotification("Saved the repriced items. Some barcodes need to be more specific.", "warning");
        } else {
          showNotification("No items were repriced. Enter more specific barcodes to retry.", "warning");
        }
      } else if (savePayload.barcode_count > 0) {
        showNotification("Repricing is done and has been saved.", "success");
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

    // If we have a sessionId AND cartItems, just attach to the existing DB session (no refetch)
    if (resumeSessionId && cartItems?.length) {
      setDbSessionId(resumeSessionId);
    }

    // Normal flow: starting fresh from cart items
    if (!cartItems || cartItems.length === 0) {
      navigate('/repricing', { replace: true });
      return;
    }

    setItems(cartItems.map(item => ({ ...item })));
    const cartKey = getCartKey(cartItems);
    const saved = cartKey ? loadRepricingProgress(cartKey) : null;
    if (saved) {
      setBarcodes(saved.barcodes);
      setNosposLookups(saved.nosposLookups || {});
    } else {
      // Pre-populate barcodes from nosposBarcodes set by Quick Reprice (array of { barserial, href, name })
      const prePopulated = {};
      const prePopulatedLookups = {};
      for (const item of cartItems) {
        const barcodes = item.nosposBarcodes || [];
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
        cexUrl: item.cexUrl, ourSalePrice: item.ourSalePrice, cexOutOfStock: item.cexOutOfStock,
        cexProductData: item.cexProductData, isCustomCeXItem: item.isCustomCeXItem,
        condition: item.condition, categoryObject: item.categoryObject,
        nosposBarcodes: item.nosposBarcodes, ebayResearchData: item.ebayResearchData,
        cashConvertersResearchData: item.cashConvertersResearchData, quantity: item.quantity,
      }));
      createRepricingSessionDraft({
        cart_key: cartKey,
        item_count: cartItems.length,
        session_data: { items: itemsSnapshot, barcodes: saved?.barcodes || {}, nosposLookups: saved?.nosposLookups || {} },
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

  const handleResearchComplete = (updatedState) => {
    if (updatedState?.cancel) { setResearchItem(null); return; }
    if (updatedState && researchItem) {
      const currentItem = items.find(i => i.id === researchItem.id);
      setItems(prev => prev.map(i =>
        i.id !== researchItem.id ? i : { ...i, ebayResearchData: updatedState }
      ));
      maybeShowSalePriceConfirm(
        updatedState,
        currentItem,
        researchItem,
        setSalePriceConfirmModal,
        resolveRepricingSalePrice,
        'ebay'
      );
    }
    setResearchItem(null);
  };

  const handleCashConvertersResearchComplete = (updatedState) => {
    if (updatedState?.cancel) { setCashConvertersResearchItem(null); return; }
    if (updatedState && cashConvertersResearchItem) {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);
      setItems(prev => prev.map(i =>
        i.id !== cashConvertersResearchItem.id ? i : { ...i, cashConvertersResearchData: updatedState }
      ));
      maybeShowSalePriceConfirm(
        updatedState,
        currentItem,
        cashConvertersResearchItem,
        setSalePriceConfirmModal,
        resolveRepricingSalePrice,
        'cashConverters'
      );
    }
    setCashConvertersResearchItem(null);
  };

  const handleProceed = async () => {
    for (const item of activeItems) {
      if (!(barcodes[item.id] || []).length) {
        showNotification(`Add at least one barcode for: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
      if (!isItemReadyForRepricing(item.id)) {
        showNotification(`Verify the NosPos barcode for: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
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
      const repricingData = activeItems.map((item) => ({
        itemId: item.id,
        title: item.title || "",
        salePrice: resolveRepricingSalePrice(item),
        ourSalePriceAtRepricing: resolveRepricingSalePrice(item),
        cexSellAtRepricing: item.cexSellPrice ?? null,
        raw_data: item.ebayResearchData || {},
        cash_converters_data: item.cashConvertersResearchData || {},
        barcodes: getVerifiedBarcodesForItem(item.id)
      }));
      await openNospos(repricingData, { completedBarcodes: freshCompletedBarcodes, completedItems: freshCompletedItems, cartKey: activeCartKey });
    } catch (err) {
      showNotification(err?.message || "Could not open NoSpos", "error");
    }
  };

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8f9fa' }}>
        <p className="text-sm text-gray-500">Loading reprice list...</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="text-sm overflow-hidden min-h-screen flex flex-col" style={{ background: '#f8f9fa', color: '#1a1a1a' }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        :root {
          --brand-blue: #144584;
          --brand-orange: #f7b918;
          --ui-border: #e5e7eb;
          --text-muted: #64748b;
        }
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #144584; }
        .reprice-table th {
          background: #144584;
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
        }
        .reprice-table td:last-child { border-right: 0; }
        .reprice-table tr { border-bottom: 1px solid #e5e7eb; }
        .reprice-table tr:hover { background: rgba(20,69,132,0.05); }
      `}</style>

      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">

        {/* ── Main Table Section ─────────────────────────────────────────────── */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">

          {/* Top Controls */}
          <div className="p-6 border-b" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex items-center justify-between gap-6">
              <button
                onClick={() => navigate('/repricing', { state: { preserveCart: true, cartItems: items } })}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all hover:shadow-md"
                style={{ borderColor: '#e5e7eb', color: '#144584' }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Back to Reprice List
              </button>

              <div
                className="flex items-center gap-3 px-5 py-3 rounded-xl border"
                style={{ borderColor: 'rgba(20,69,132,0.2)', background: 'rgba(20,69,132,0.03)' }}
              >
                <span className="material-symbols-outlined text-2xl" style={{ color: '#144584' }}>sell</span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#144584' }}>
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
                <p className="text-lg font-bold" style={{ color: '#144584' }}>
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
                  <th className="w-24">CeX Sell</th>
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
                    perUnitSalePrice,
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
                      if (raw === '' || Number.isNaN(parsedTotal) || parsedTotal <= 0) {
                        next.ourSalePrice = '';
                        return next;
                      }
                      next.ourSalePrice = String(roundSalePrice(parsedTotal / qty));
                      return next;
                    }));
                  };

                  return (
                    <tr
                      key={item.id || index}
                      className={item.isRemoved ? 'opacity-60' : ''}
                      style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, item });
                      }}
                    >
                      {/* Item Name & Attributes */}
                      <td>
                        <div
                          className="font-bold text-[13px] flex items-center gap-2 flex-wrap"
                          style={{ color: '#144584' }}
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
                      <td className="font-medium text-blue-800 align-top">
                        {item.cexSellPrice != null ? (
                          <div>
                            {item.cexUrl ? (
                              <a
                                href={item.cexUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted"
                              >
                                £{item.cexSellPrice.toFixed(2)}
                              </a>
                            ) : (
                              <div>£{item.cexSellPrice.toFixed(2)}</div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* New Sale Price — editable */}
                      <td className="font-medium text-purple-700">
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
                      <td>
                        {ebayData?.stats?.median ? (
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[13px] font-medium" style={{ color: '#144584' }}>
                              <div>£{Number(ebayData.stats.median).toFixed(2)}</div>
                            </div>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: '#f7b918', color: '#144584' }}
                              onClick={() => setResearchItem(item)}
                              title="View/Refine eBay Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium" style={{ color: '#64748b' }}>—</span>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: '#f7b918', color: '#144584' }}
                              onClick={() => setResearchItem(item)}
                              title="Research eBay"
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Cash Converters */}
                      <td>
                        {ccData?.stats?.median ? (
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[13px] font-medium" style={{ color: '#144584' }}>
                              <div>£{Number(ccData.stats.median).toFixed(2)}</div>
                            </div>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: '#f7b918', color: '#144584' }}
                              onClick={() => setCashConvertersResearchItem(item)}
                              title="View/Refine Cash Converters Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">store</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium" style={{ color: '#64748b' }}>—</span>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: '#f7b918', color: '#144584' }}
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
          style={{ borderColor: 'rgba(20,69,132,0.2)' }}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b bg-blue-900" style={{ borderColor: 'rgba(20,69,132,0.2)' }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-yellow-400 text-2xl">sell</span>
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-white">Reprice List</p>
                <p className="text-xs text-blue-200">
                  {activeItems.length} item{activeItems.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Barcode status */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <p
                className="text-[10px] font-black uppercase tracking-wider mb-3"
                style={{ color: '#144584' }}
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
            style={{ borderColor: 'rgba(20,69,132,0.2)' }}
          >
            <button
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                !allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{
                background: '#f7b918',
                color: '#144584',
                boxShadow: '0 10px 15px -3px rgba(247,185,24,0.3)'
              }}
              onClick={handleProceed}
              disabled={!allItemsReadyForRepricing || isRepricingFinished || isBackgroundRepricingRunning}
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
            {isRepricingFinished && (
              <p className="text-[10px] text-center text-emerald-700 font-semibold -mt-2">
                Repricing finished
              </p>
            )}
          </div>
        </aside>
      </main>

      {/* ── Context Menu ───────────────────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveItem(contextMenu.item)}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={false}
        priceLabel="New Sale Price"
      />

      {isBackgroundRepricingRunning && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
          <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl bg-white shadow-2xl border" style={{ borderColor: 'rgba(20,69,132,0.15)' }}>
            <div className="px-6 py-5 border-b bg-blue-900" style={{ borderColor: 'rgba(20,69,132,0.15)' }}>
              <div className="flex items-start gap-4">
                <span className="material-symbols-outlined text-yellow-400 text-3xl animate-spin">progress_activity</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-200">Background Repricing In Progress</p>
                  <h3 className="text-xl font-black text-white mt-1">Please wait while CG Suite updates NoSpos</h3>
                  <p className="text-sm text-blue-100 mt-2">
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
              <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'rgba(20,69,132,0.1)' }}>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Current Status</p>
                <p className="text-sm font-bold text-slate-800 mt-1">{repricingJob?.message || 'Working…'}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {repricingJob?.currentItemTitle ? `Item: ${repricingJob.currentItemTitle}` : 'Waiting for first item'}
                  {repricingJob?.currentBarcode ? ` · Barcode: ${repricingJob.currentBarcode}` : ''}
                </p>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4" style={{ borderColor: 'rgba(20,69,132,0.1)' }}>
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
                      background: '#144584'
                    }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(20,69,132,0.1)' }}>
                <div className="px-4 py-3 bg-slate-50 border-b" style={{ borderColor: 'rgba(20,69,132,0.08)' }}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Detailed Process Stack</p>
                  <p className="text-xs text-slate-500 mt-1">This stays in order from start to finish so you can follow each item and barcode step-by-step.</p>
                </div>
                <div className="max-h-[38vh] overflow-y-auto buyer-panel-scroll p-4 space-y-2 bg-white">
                  {[...(repricingJob?.logs || [])].slice(-40).map((entry, index) => (
                    <div key={`${entry.timestamp || 'log'}-${index}`} className="rounded-xl border px-3 py-2.5 bg-slate-50" style={{ borderColor: 'rgba(20,69,132,0.08)' }}>
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

      {ambiguousBarcodeModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCloseAmbiguousBarcodeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-5 border-b" style={{ borderColor: 'rgba(20,69,132,0.15)' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#144584' }}>
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
                <div key={`${entry.itemId}-${entry.barcodeIndex}-${index}`} className="rounded-xl border p-4" style={{ borderColor: 'rgba(20,69,132,0.15)', background: '#f8fafc' }}>
                  <p className="text-sm font-bold mb-2" style={{ color: '#144584' }}>
                    {entry.itemTitle}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        Old Typed Barcode
                      </p>
                      <div className="px-3 py-2 rounded-lg border text-sm font-mono bg-white" style={{ borderColor: 'rgba(20,69,132,0.15)', color: '#144584' }}>
                        {entry.oldBarcode || '—'}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                        More Specific Barcode
                      </p>
                      <input
                        className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
                        style={{ borderColor: 'rgba(20,69,132,0.3)', color: '#144584' }}
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

            <div className="px-6 py-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'rgba(20,69,132,0.15)', background: '#f8fafc' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>
                Clicking outside skips these for now and keeps them out of repricing history.
              </p>
              <div className="flex items-center gap-3">
                <button
                  className="px-4 py-2 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'rgba(20,69,132,0.2)', color: '#144584', background: 'white' }}
                  onClick={handleCloseAmbiguousBarcodeModal}
                >
                  Close
                </button>
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                    ambiguousBarcodeModal.isRetrying ? 'opacity-70 cursor-wait' : ''
                  }`}
                  style={{ background: '#f7b918', color: '#144584' }}
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
            <p className="text-xs font-semibold mb-4" style={{ color: '#144584' }}>
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
                    <div key={idx} className="rounded-lg border overflow-hidden" style={{ borderColor: isComplete ? '#a7f3d0' : 'rgba(20,69,132,0.15)' }}>
                      {/* Top row: barcode code + status + remove */}
                      <div className={`flex items-center gap-2 px-3 py-1.5 ${isComplete ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                        <span className="flex-1 text-xs font-mono font-semibold flex items-center gap-1.5" style={{ color: '#144584' }}>
                          {isComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                          {code}
                        </span>

                        {/* NosPos lookup status badges */}
                        {lookup?.status === 'searching' && (
                          <span className="text-[10px] font-semibold text-blue-500 flex items-center gap-1">
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
                            className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
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
                            className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-0.5"
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
                        <div className="border-t" style={{ borderColor: 'rgba(20,69,132,0.1)' }}>
                          <div className="px-2 py-1.5 bg-blue-50">
                            <p className="text-[10px] font-semibold text-blue-700 mb-1">Select the matching item on NosPos:</p>
                            <div className="space-y-1">
                              {lookup.results.map((result, ri) => (
                                <div
                                  key={ri}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white border hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer group"
                                  style={{ borderColor: 'rgba(20,69,132,0.15)' }}
                                >
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={`https://nospos.com${result.href}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block text-[11px] font-mono font-bold text-blue-700 hover:underline leading-tight"
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
                                    style={{ background: '#144584', color: 'white' }}
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
                style={{ borderColor: 'rgba(20,69,132,0.3)', color: '#144584' }}
                type="text"
                placeholder="Enter barcode"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addBarcode(); }}
              />
              <button
                className="px-3 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: '#144584', color: 'white' }}
                onClick={addBarcode}
              >
                Add
              </button>
            </div>

            <button
              className="w-full py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
              style={{ background: '#f7b918', color: '#144584' }}
              onClick={() => { setBarcodeModal(null); setNosposResultsPanel(null); }}
            >
              OK
            </button>
          </TinyModal>
        );
      })()}

      {/* ── eBay Research Modal ────────────────────────────────────────────────── */}
      {researchItem && (
        <EbayResearchForm
          mode="modal"
          category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
          savedState={researchItem.ebayResearchData}
          onComplete={handleResearchComplete}
          initialHistogramState={true}
          readOnly={false}
          showManualOffer={false}
          initialSearchQuery={buildInitialSearchQuery(researchItem)}
          marketComparisonContext={{
            cexSalePrice: researchItem?.cexSellPrice ?? null,
            ourSalePrice: researchItem?.ourSalePrice ?? null,
            ebaySalePrice: researchItem?.ebayResearchData?.stats?.median ?? null,
            cashConvertersSalePrice: researchItem?.cashConvertersResearchData?.stats?.median ?? null,
            itemTitle: researchItem?.title || null,
            itemCondition: researchItem?.condition || null,
            itemSpecs: researchItem?.isCustomCeXItem ? null : buildItemSpecs(researchItem),
            cexSpecs: researchItem?.isCustomCeXItem ? buildItemSpecs(researchItem) : null,
            ebaySearchTerm: researchItem?.ebayResearchData?.searchTerm || null,
            cashConvertersSearchTerm: researchItem?.cashConvertersResearchData?.searchTerm || null,
          }}
        />
      )}

      {/* ── Cash Converters Research Modal ────────────────────────────────────── */}
      {cashConvertersResearchItem && (
        <CashConvertersResearchForm
          mode="modal"
          category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
          savedState={cashConvertersResearchItem.cashConvertersResearchData}
          onComplete={handleCashConvertersResearchComplete}
          initialHistogramState={true}
          readOnly={false}
          showManualOffer={false}
          initialSearchQuery={buildInitialSearchQuery(cashConvertersResearchItem)}
          marketComparisonContext={{
            cexSalePrice: cashConvertersResearchItem?.cexSellPrice ?? null,
            ourSalePrice: cashConvertersResearchItem?.ourSalePrice ?? null,
            ebaySalePrice: cashConvertersResearchItem?.ebayResearchData?.stats?.median ?? null,
            cashConvertersSalePrice: cashConvertersResearchItem?.cashConvertersResearchData?.stats?.median ?? null,
            itemTitle: cashConvertersResearchItem?.title || null,
            itemCondition: cashConvertersResearchItem?.condition || null,
            itemSpecs: cashConvertersResearchItem?.isCustomCeXItem ? null : buildItemSpecs(cashConvertersResearchItem),
            cexSpecs: cashConvertersResearchItem?.isCustomCeXItem ? buildItemSpecs(cashConvertersResearchItem) : null,
            ebaySearchTerm: cashConvertersResearchItem?.ebayResearchData?.searchTerm || null,
            cashConvertersSearchTerm: cashConvertersResearchItem?.cashConvertersResearchData?.searchTerm || null,
          }}
        />
      )}
    </div>
  );
};

export default RepricingNegotiation;
