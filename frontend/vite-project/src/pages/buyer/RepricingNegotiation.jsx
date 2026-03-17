import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import { useNotification } from "@/contexts/NotificationContext";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import TinyModal from "@/components/ui/TinyModal";
import { maybeShowSalePriceConfirm } from "./utils/researchCompletionHelpers";
import { clearLastRepricingResult, getLastRepricingResult, openNospos } from "@/services/extensionClient";
import { saveRepricingSession } from "@/services/api";
import { getCartKey, loadRepricingProgress, saveRepricingProgress, clearRepricingProgress } from "@/utils/repricingProgress";
import { getEditableSalePriceState, resolveRepricingSalePrice } from "./utils/repricingDisplay";

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

// ─── Item spec helpers (same logic as Negotiation.jsx) ────────────────────────
const buildItemSpecs = (item) => {
  if (!item) return null;
  if (item.cexProductData?.specifications && Object.keys(item.cexProductData.specifications).length > 0) {
    return item.cexProductData.specifications;
  }
  if (item.attributeValues && Object.values(item.attributeValues).some(v => v)) {
    return Object.fromEntries(
      Object.entries(item.attributeValues)
        .filter(([, v]) => v)
        .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])
    );
  }
  const specs = {};
  if (item.storage)   specs['Storage']   = item.storage;
  if (item.color)     specs['Colour']    = item.color;
  if (item.network)   specs['Network']   = item.network;
  if (item.condition) specs['Condition'] = item.condition;
  return Object.keys(specs).length > 0 ? specs : null;
};

const buildInitialSearchQuery = (item) =>
  item?.ebayResearchData?.searchTerm ||
  item?.ebayResearchData?.lastSearchedTerm ||
  item?.title ||
  undefined;

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

  const { cartItems } = location.state || {};

  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Barcode state: { [itemId]: string[] }
  const [barcodes, setBarcodes] = useState({});
  const [barcodeModal, setBarcodeModal] = useState(null); // { item } | null
  const [barcodeInput, setBarcodeInput] = useState('');

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

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }

  const hasInitialized = useRef(false);
  const lastHandledCompletionRef = useRef("");

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
      try {
        await clearLastRepricingResult();
      } catch {
        // Ignore extension cleanup failures after handling succeeds.
      }

      setIsRepricingFinished(true);

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

    if (!cartItems || cartItems.length === 0) {
      navigate('/repricing', { replace: true });
      return;
    }

    setItems(cartItems.map(item => ({ ...item })));
    const cartKey = getCartKey(cartItems);
    const saved = cartKey ? loadRepricingProgress(cartKey) : null;
    if (saved) {
      setBarcodes(saved.barcodes);
      setCompletedBarcodes(saved.completedBarcodes);
      setCompletedItems(saved.completedItems);
    } else {
      // Pre-populate barcodes from nosposBarcode set by Quick Reprice
      const prePopulated = {};
      for (const item of cartItems) {
        if (item.nosposBarcode) {
          prePopulated[item.id] = [item.nosposBarcode];
        }
      }
      if (Object.keys(prePopulated).length > 0) {
        setBarcodes(prePopulated);
      }
    }
    setIsLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state (must be before useEffects that use it) ─────────────────────
  const activeItems = items.filter(i => !i.isRemoved);
  const activeCartKey = getCartKey(activeItems);

  useEffect(() => {
    if (activeCartKey && (Object.keys(barcodes).length > 0 || Object.keys(completedBarcodes).length > 0 || completedItems.length > 0)) {
      saveRepricingProgress(activeCartKey, { barcodes, completedBarcodes, completedItems });
    }
  }, [barcodes, completedBarcodes, completedItems, activeCartKey]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "REPRICING_PROGRESS" && e.data.payload) {
        const { cartKey: msgCartKey, completedBarcodes: cb, completedItems: ci } = e.data.payload;
        if (msgCartKey && msgCartKey === activeCartKey) {
          setCompletedBarcodes(cb || {});
          setCompletedItems(ci || []);
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

    const checkForCompletedResult = async () => {
      try {
        const response = await getLastRepricingResult();
        if (cancelled || !response?.ok || !response.payload) return;
        await persistCompletedRepricing(response.payload);
      } catch {
        // Ignore polling failures if extension is unavailable.
      }
    };

    checkForCompletedResult();
    window.addEventListener("focus", checkForCompletedResult);
    document.addEventListener("visibilitychange", checkForCompletedResult);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", checkForCompletedResult);
      document.removeEventListener("visibilitychange", checkForCompletedResult);
    };
  }, [activeCartKey]);

  useEffect(() => {
    lastHandledCompletionRef.current = "";
  }, [activeCartKey]);

  const allItemsHaveBarcodes =
    activeItems.length > 0 &&
    activeItems.every(i => (barcodes[i.id] || []).length > 0);

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
    }
    showNotification("Opening NoSpos…", 'info');
    try {
      lastHandledCompletionRef.current = "";
      const repricingData = activeItems.map((item) => ({
        itemId: item.id,
        title: item.title || "",
        salePrice: resolveRepricingSalePrice(item),
        ourSalePriceAtRepricing: resolveRepricingSalePrice(item),
        cexSellAtRepricing: item.cexSellPrice ?? null,
        raw_data: item.ebayResearchData || {},
        cash_converters_data: item.cashConvertersResearchData || {},
        barcodes: barcodes[item.id] || []
      }));
      await openNospos(repricingData, { completedBarcodes, completedItems, cartKey: activeCartKey });
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
                    setItems(prev => prev.map(i => {
                      if (i.id !== item.id) return i;
                      const next = { ...i };
                      delete next.ourSalePriceInput;
                      if (raw === '' || Number.isNaN(parsedTotal) || parsedTotal <= 0) {
                        next.ourSalePrice = '';
                        return next;
                      }
                      next.ourSalePrice = parsedTotal.toFixed(2);
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
                              ? completedItems.includes(item.id)
                                ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
                          }`}
                          onClick={() => { setBarcodeModal({ item }); setBarcodeInput(''); }}
                          title="Click to manage barcodes"
                        >
                          <span className="material-symbols-outlined text-[14px]">barcode</span>
                          <span className="flex-1 text-left">
                            {hasBarcodes
                              ? `${(completedBarcodes[item.id] || []).length}/${itemBarcodes.length} barcode${itemBarcodes.length !== 1 ? 's' : ''}`
                              : 'Add barcodes'}
                          </span>
                          {completedItems.includes(item.id) && (
                            <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>
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
                  const done = (completedBarcodes[i.id] || []).length;
                  const itemComplete = completedItems.includes(i.id);
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate flex-1 flex items-center gap-1" style={{ color: '#64748b' }}>
                        {itemComplete && <span className="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>}
                        {i.title}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          itemComplete ? 'bg-emerald-200 text-emerald-800' : count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {count > 0 ? `${done}/${count} barcode${count !== 1 ? 's' : ''}` : 'missing'}
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
                !allItemsHaveBarcodes || isRepricingFinished ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{
                background: '#f7b918',
                color: '#144584',
                boxShadow: '0 10px 15px -3px rgba(247,185,24,0.3)'
              }}
              onClick={handleProceed}
              disabled={!allItemsHaveBarcodes || isRepricingFinished}
            >
              <span className="text-base uppercase tracking-tight">
                {isRepricingFinished ? 'Repricing Finished' : 'Proceed with Repricing'}
              </span>
              {!isRepricingFinished && (
                <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              )}
            </button>
            {!allItemsHaveBarcodes && !isRepricingFinished && (
              <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
                Add barcodes to all items to proceed
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

        const addBarcode = () => {
          const code = barcodeInput.trim();
          if (!code) return;
          setBarcodes(prev => ({
            ...prev,
            [modalItem.id]: [...(prev[modalItem.id] || []), code]
          }));
          setBarcodeInput('');
        };

        const removeBarcode = (code) => {
          setBarcodes(prev => ({
            ...prev,
            [modalItem.id]: (prev[modalItem.id] || []).filter(b => b !== code)
          }));
        };

        return (
          <TinyModal title="Barcodes" onClose={() => setBarcodeModal(null)}>
            <p className="text-xs font-semibold mb-4" style={{ color: '#144584' }}>
              {modalItem.title}
            </p>

            {itemBarcodes.length > 0 ? (
              <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
                {itemBarcodes.map((code, idx) => {
                  const isComplete = (completedBarcodes[modalItem.id] || []).includes(idx);
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border ${
                        isComplete ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <span className="text-xs font-mono font-semibold flex items-center gap-2" style={{ color: '#144584' }}>
                        {isComplete && <span className="material-symbols-outlined text-emerald-600 text-[16px]">check_circle</span>}
                        {code}
                      </span>
                      <button
                        onClick={() => removeBarcode(code)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Remove barcode"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
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
              onClick={() => setBarcodeModal(null)}
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
