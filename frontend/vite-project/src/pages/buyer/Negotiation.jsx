import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import CustomerTransactionHeader from './components/CustomerTransactionHeader';
import NegotiationItemRow from './components/NegotiationItemRow';
import { ItemContextMenu, TargetOfferModal, ItemOfferModal, SeniorMgmtModal, MarginResultModal } from './components/NegotiationModals';
import NewCustomerDetailsModal from '@/components/modals/NewCustomerDetailsModal';
import SalePriceConfirmModal from '@/components/modals/SalePriceConfirmModal';
import { finishRequest, fetchRequestDetail, updateCustomer, saveQuoteDraft } from '@/services/api';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { maybeShowSalePriceConfirm } from './utils/researchCompletionHelpers';
import {
  buildItemSpecs,
  buildInitialSearchQuery,
  resolveOurSalePrice,
  calculateTotalOfferPrice,
  buildFinishPayload,
  mapApiItemToNegotiationItem,
  normalizeCartItemForNegotiation,
  applyEbayResearchToItem,
  applyCashConvertersResearchToItem,
} from './utils/negotiationHelpers';

// ─── Inline styles (shared with layout) ────────────────────────────────────

const NEGOTIATION_STYLES = `
  :root {
    --brand-blue: #144584;
    --brand-blue-hover: #0d315e;
    --brand-orange: #f7b918;
    --brand-orange-hover: #e5ab14;
    --ui-bg: #f8f9fa;
    --ui-card: #ffffff;
    --ui-border: #e5e7eb;
    --text-main: #1a1a1a;
    --text-muted: #64748b;
  }
  body { font-family: 'Inter', sans-serif; }
  .material-symbols-outlined { font-size: 20px; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #f1f5f9; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: #144584; }
  .spreadsheet-table th {
    background: var(--brand-blue);
    color: white;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.75rem;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .spreadsheet-table th:last-child { border-right: 0; }
  .spreadsheet-table td {
    padding: 0.5rem 0.75rem;
    border-right: 1px solid var(--ui-border);
    vertical-align: middle;
  }
  .spreadsheet-table td:last-child { border-right: 0; }
  .spreadsheet-table tr { border-bottom: 1px solid var(--ui-border); }
  .spreadsheet-table tr:hover { background: rgba(20, 69, 132, 0.05); }
`;

// ─── Component ─────────────────────────────────────────────────────────────

const Negotiation = ({ mode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId: paramsRequestId } = useParams();
  const { showNotification } = useNotification();

  // Read initial data from store (negotiate mode) or location.state (fallback)
  const storeCartItems = useAppStore((s) => s.cartItems);
  const storeCustomerData = useAppStore((s) => s.customerData);
  const storeRequest = useAppStore((s) => s.request);

  const initialCartItems = location.state?.cartItems ?? storeCartItems;
  const initialCustomerData = location.state?.customerData ?? storeCustomerData;
  const initialRequestId = location.state?.currentRequestId ?? storeRequest?.request_id;
  const actualRequestId = mode === 'view' ? paramsRequestId : initialRequestId;

  // ─── Local negotiation state ───────────────────────────────────────────

  const [items, setItems] = useState([]);
  const [customerData, setCustomerData] = useState({});
  const [transactionType, setTransactionType] = useState('sale');
  const [totalExpectation, setTotalExpectation] = useState("");
  const [targetOffer, setTargetOffer] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // UI / modal state
  const [contextMenu, setContextMenu] = useState(null);
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [showNewCustomerDetailsModal, setShowNewCustomerDetailsModal] = useState(false);
  const [pendingFinishPayload, setPendingFinishPayload] = useState(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [itemOfferModal, setItemOfferModal] = useState(null);
  const [seniorMgmtModal, setSeniorMgmtModal] = useState(null);
  const [marginResultModal, setMarginResultModal] = useState(null);
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null);

  // Refs
  const hasInitializedNegotiateRef = useRef(false);
  const completedRef = useRef(false);
  const draftPayloadRef = useRef(null);
  const prevTransactionTypeRef = useRef(transactionType);

  const useVoucherOffers = transactionType === 'store_credit';

  // ─── Derived values ────────────────────────────────────────────────────

  const parsedTarget = parseFloat(targetOffer) || 0;
  const totalOfferPrice = calculateTotalOfferPrice(items, useVoucherOffers);
  const hasTarget = parsedTarget > 0;
  const targetDelta = hasTarget ? totalOfferPrice - parsedTarget : 0;
  const targetMatched = hasTarget && Math.abs(targetDelta) <= 0.005;
  const targetShortfall = hasTarget && totalOfferPrice < parsedTarget ? parsedTarget - totalOfferPrice : 0;
  const targetExcess = hasTarget && totalOfferPrice > parsedTarget ? totalOfferPrice - parsedTarget : 0;

  const { offerMin, offerMax } = useMemo(() => {
    const activeItems = items.filter(i => !i.isRemoved);
    if (activeItems.length === 0) return { offerMin: null, offerMax: null };
    let min = 0, max = 0;
    for (const item of activeItems) {
      const qty = item.quantity || 1;
      const displayOffers = useVoucherOffers
        ? (item.voucherOffers || item.offers || [])
        : (item.cashOffers || item.offers || []);
      const prices = displayOffers.map(o => Number(o.price)).filter(p => !isNaN(p) && p >= 0);
      if (prices.length > 0) {
        min += Math.min(...prices) * qty;
        max += Math.max(...prices) * qty;
      }
    }
    return { offerMin: min, offerMax: max };
  }, [items, useVoucherOffers]);

  // ─── Manual offer application (with senior mgmt & margin checks) ───────

  const applyManualOffer = useCallback((item, proposedPerUnit, seniorMgmtConfirmedBy = null) => {
    const ourSalePrice = resolveOurSalePrice(item);

    if (ourSalePrice && proposedPerUnit > ourSalePrice && !seniorMgmtConfirmedBy) {
      setSeniorMgmtModal({ item, proposedPerUnit });
      return false;
    }

    setItems(prev => prev.map(i =>
      i.id === item.id
        ? {
            ...i,
            manualOffer: proposedPerUnit.toFixed(2),
            selectedOfferId: 'manual',
            manualOfferUsed: true,
            ...(seniorMgmtConfirmedBy && { seniorMgmtApprovedBy: seniorMgmtConfirmedBy }),
          }
        : i
    ));

    if (ourSalePrice && ourSalePrice > 0) {
      const marginPct = ((ourSalePrice - proposedPerUnit) / ourSalePrice) * 100;
      const marginGbp = ourSalePrice - proposedPerUnit;
      setMarginResultModal({ item, offerPerUnit: proposedPerUnit, ourSalePrice, marginPct, marginGbp, confirmedBy: seniorMgmtConfirmedBy });
    }

    return true;
  }, []);

  // ─── Finalization ──────────────────────────────────────────────────────

  const doFinishRequest = useCallback(async (payload) => {
    try {
      await finishRequest(actualRequestId, payload);
      completedRef.current = true;
      useAppStore.getState().resetBuyer();
      showNotification("Transaction finalized successfully and booked for testing!", 'success');
      navigate("/transaction-complete");
    } catch (error) {
      console.error("Error finalizing transaction:", error);
      const msg = error?.message || '';
      if (msg.toLowerCase().includes('can only finalize') || msg.toLowerCase().includes('quote request')) {
        showNotification("This request has already been finalized. Please start a new negotiation from the buyer page.", 'error');
        navigate("/buyer", { replace: true });
      } else {
        showNotification(`Failed to finalize transaction: ${msg}`, 'error');
      }
    }
  }, [actualRequestId, navigate, showNotification]);

  const handleFinalizeTransaction = useCallback(async () => {
    if (!actualRequestId) {
      showNotification("Cannot finalize: Request ID is missing. Please return to the buyer page and start a new negotiation.", "error");
      navigate("/buyer", { replace: true });
      return;
    }

    for (const item of items) {
      if (item.isRemoved) continue;
      if (!item.selectedOfferId) {
        showNotification(`Please select an offer for item: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
      if (item.selectedOfferId === 'manual') {
        const manualValue = parseFloat(item.manualOffer?.replace(/[£,]/g, '')) || 0;
        if (manualValue <= 0) {
          showNotification(`Please enter a valid manual offer for item: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }

      const rawSaleInput = String(item.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
      if (rawSaleInput !== '') {
        const parsedTotalSale = parseFloat(rawSaleInput);
        if (!Number.isFinite(parsedTotalSale) || parsedTotalSale <= 0) {
          showNotification(`Our sale price must be greater than £0 for item: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }

      const resolvedSalePrice = resolveOurSalePrice(item);
      if (!Number.isFinite(Number(resolvedSalePrice)) || Number(resolvedSalePrice) <= 0) {
        showNotification(`Please set a valid Our Sale Price above £0 for item: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
    }

    if (targetOffer) {
      const pt = parseFloat(targetOffer);
      if (pt > 0) {
        const delta = totalOfferPrice - pt;
        if (Math.abs(delta) > 0.005) {
          const relationText = delta < 0 ? 'has not met' : 'exceeds';
          showNotification(`Cannot book for testing: grand total £${totalOfferPrice.toFixed(2)} ${relationText} the target offer of £${pt.toFixed(2)}.`, 'error');
          return;
        }
      }
    }

    const payload = buildFinishPayload(
      items,
      totalExpectation,
      targetOffer,
      useVoucherOffers,
      totalOfferPrice,
      customerData
    );

    if (customerData?.isNewCustomer) {
      setPendingFinishPayload(payload);
      setShowNewCustomerDetailsModal(true);
    } else {
      await doFinishRequest(payload);
    }
  }, [actualRequestId, items, targetOffer, totalOfferPrice, totalExpectation, useVoucherOffers, customerData, doFinishRequest, navigate, showNotification]);

  const handleNewCustomerDetailsSubmit = useCallback(async (formData) => {
    await updateCustomer(customerData.id, {
      name: formData.name,
      phone_number: formData.phone,
      email: formData.email || null,
      address: formData.address || '',
      is_temp_staging: false,
    });
    await doFinishRequest(pendingFinishPayload);
    setPendingFinishPayload(null);
    setShowNewCustomerDetailsModal(false);
  }, [customerData, pendingFinishPayload, doFinishRequest]);

  // ─── Item actions ──────────────────────────────────────────────────────

  const handleQuantityChange = useCallback((itemId, newQty) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: newQty } : i));
  }, []);

  const handleSelectOffer = useCallback((itemId, offerId) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, selectedOfferId: offerId } : i));
  }, []);

  const handleCustomerExpectationChange = useCallback((itemId, value) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, customerExpectation: value } : i));
  }, []);

  const handleOurSalePriceChange = useCallback((itemId, value) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: value } : i));
  }, []);

  const handleOurSalePriceBlur = useCallback((item) => {
    const quantity = item.quantity || 1;
    setItems(prev => prev.map(i => {
      if (i.id !== item.id) return i;
      const raw = (i.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
      const parsedTotal = parseFloat(raw);
      const next = { ...i };
      delete next.ourSalePriceInput;
      if (raw === '') {
        next.ourSalePrice = '';
      } else if (Number.isNaN(parsedTotal) || parsedTotal <= 0) {
        // Keep prior persisted value and reject invalid/non-positive input.
      } else {
        next.ourSalePrice = String(normalizeExplicitSalePrice(parsedTotal / quantity));
      }
      return next;
    }));
    const rawEntered = String(item.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
    if (rawEntered !== '') {
      const parsedEntered = parseFloat(rawEntered);
      if (!Number.isFinite(parsedEntered) || parsedEntered <= 0) {
        showNotification('Our sale price must be greater than £0', 'error');
      }
    }
  }, [showNotification]);

  const handleOurSalePriceFocus = useCallback((itemId, currentValue) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: currentValue } : i));
  }, []);

  const handleRemoveFromNegotiation = useCallback((item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    setContextMenu(null);
    showNotification(`"${item.title || 'Item'}" removed from negotiation`, 'info');
  }, [showNotification]);

  // ─── Research handlers ─────────────────────────────────────────────────

  const handleResearchComplete = useCallback((updatedState) => {
    if (updatedState && !updatedState.cancel && researchItem && mode !== 'view') {
      const currentItem = items.find(i => i.id === researchItem.id);

      setItems(prevItems => prevItems.map(i => {
        if (i.id !== researchItem.id) return i;
        return applyEbayResearchToItem(i, updatedState, useVoucherOffers);
      }));

      maybeShowSalePriceConfirm(updatedState, currentItem, researchItem, setSalePriceConfirmModal, resolveOurSalePrice, 'ebay');
    }
    setResearchItem(null);
  }, [researchItem, items, mode, useVoucherOffers]);

  const handleCashConvertersResearchComplete = useCallback((updatedState) => {
    if (updatedState && !updatedState.cancel && cashConvertersResearchItem && mode !== 'view') {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);

      setItems(prevItems => prevItems.map(i => {
        if (i.id !== cashConvertersResearchItem.id) return i;
        return applyCashConvertersResearchToItem(i, updatedState, useVoucherOffers);
      }));

      maybeShowSalePriceConfirm(updatedState, currentItem, cashConvertersResearchItem, setSalePriceConfirmModal, resolveOurSalePrice, 'cashConverters');
    }
    setCashConvertersResearchItem(null);
  }, [cashConvertersResearchItem, items, mode, useVoucherOffers]);

  // ─── Effects: initialization ───────────────────────────────────────────

  useEffect(() => {
    if (mode === 'view' && actualRequestId) {
      const loadRequestDetails = async () => {
        setIsLoading(true);
        try {
          const data = await fetchRequestDetail(actualRequestId);
          if (!data) {
            showNotification("Request details not found.", "error");
            navigate("/requests-overview", { replace: true });
            return;
          }

          const status = data.current_status || data.status_history?.[0]?.status;
          const txType = data.intent === 'DIRECT_SALE' ? 'sale' : data.intent === 'BUYBACK' ? 'buyback' : 'store_credit';
          const isBookedOrComplete = status === 'BOOKED_FOR_TESTING' || status === 'COMPLETE';

          setCustomerData({
            id: data.customer_details.customer_id,
            name: data.customer_details.name,
            cancelRate: data.customer_details.cancel_rate,
            transactionType: txType,
          });
          setTotalExpectation(data.overall_expectation_gbp?.toString() || '');
          setTargetOffer(data.target_offer_gbp != null ? data.target_offer_gbp.toString() : '');
          setTransactionType(txType);

          const mappedItems = data.items.map(apiItem => {
            const mapped = mapApiItemToNegotiationItem(apiItem, txType, mode);
            const isRemoved = isBookedOrComplete && (apiItem.negotiated_price_gbp == null || apiItem.negotiated_price_gbp === '');
            return { ...mapped, isRemoved };
          });
          setItems(mappedItems);
        } catch (err) {
          console.error("Failed to load request details:", err);
          showNotification(`Failed to load request details: ${err.message}`, "error");
          navigate("/requests-overview", { replace: true });
        } finally {
          setIsLoading(false);
        }
      };
      loadRequestDetails();
    } else if (mode === 'negotiate') {
        if (!hasInitializedNegotiateRef.current) {
        if (initialCartItems && initialCartItems.length > 0) {
          setItems(initialCartItems.map(normalizeCartItemForNegotiation));
            }
            hasInitializedNegotiateRef.current = true;
        }
        if (initialCustomerData?.id && !customerData?.id) {
            setCustomerData(initialCustomerData);
            setTotalExpectation(initialCustomerData?.overall_expectation_gbp?.toString() || "");
            setTargetOffer(initialCustomerData?.target_offer_gbp?.toString() || "");
            setTransactionType(initialCustomerData?.transactionType || 'sale');
        }

      if ((!initialCartItems || initialCartItems.length === 0 || !initialCustomerData?.id) && !isLoading) {
            navigate("/buyer", { replace: true });
            return;
        }
        if (!actualRequestId && !isLoading) {
        console.warn("Negotiation page loaded without requestId.");
            showNotification("Session expired. Please start a new negotiation from the buyer page.", "error");
            navigate("/buyer", { replace: true });
            return;
        }

        setIsLoading(false);
    }
  }, [mode, actualRequestId, navigate, initialCustomerData, initialCartItems, showNotification]);

  // Sync transactionType from customerData
  useEffect(() => {
    if (customerData?.transactionType) setTransactionType(customerData.transactionType);
  }, [customerData]);

  // When transaction type changes in negotiate mode, remap selected offer indices
  useEffect(() => {
    if (mode !== 'negotiate' || prevTransactionTypeRef.current === transactionType) {
      prevTransactionTypeRef.current = transactionType;
      return;
    }
    const prevType = prevTransactionTypeRef.current;
    setItems(prevItems => prevItems.map(item => {
      if (item.selectedOfferId === 'manual') return item;
        const prevUseVoucher = prevType === 'store_credit';
        const newUseVoucher = transactionType === 'store_credit';
      const prevOffers = prevUseVoucher ? (item.voucherOffers || item.offers) : (item.cashOffers || item.offers);
      const newOffers = newUseVoucher ? (item.voucherOffers || item.offers) : (item.cashOffers || item.offers);
        if (!prevOffers || !newOffers) return item;
        const prevIndex = prevOffers.findIndex(o => o.id === item.selectedOfferId);
        if (prevIndex < 0 || !newOffers[prevIndex]) return item;
      return { ...item, selectedOfferId: newOffers[prevIndex].id };
    }));
    prevTransactionTypeRef.current = transactionType;
  }, [transactionType, mode]);

  // Build draft payload synchronously during render so it's always fresh for
  // cleanup functions (eliminates the race where an effect-based ref update
  // hasn't run yet when the component unmounts).
  const draftPayload = useMemo(() => {
    if (mode !== 'negotiate' || !actualRequestId || items.length === 0) return null;
    const total = calculateTotalOfferPrice(items, useVoucherOffers);
    return buildFinishPayload(
      items,
      totalExpectation,
      targetOffer,
      useVoucherOffers,
      total,
      customerData
    );
  }, [items, totalExpectation, targetOffer, useVoucherOffers, mode, actualRequestId, customerData]);

  draftPayloadRef.current = draftPayload;

  // Debounced auto-save
  useEffect(() => {
    if (!draftPayload?.items_data?.length || completedRef.current) return;
    const timer = setTimeout(() => {
      if (completedRef.current) return;
      saveQuoteDraft(actualRequestId, draftPayloadRef.current).catch((err) => {
        console.warn('Quote draft save failed:', err);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [draftPayload, actualRequestId]);

  // Save draft on unmount / tab close
  useEffect(() => {
    if (mode !== 'negotiate' || !actualRequestId) return;

    const flushDraft = (opts = {}) => {
      if (completedRef.current) return;
      const payload = draftPayloadRef.current;
      if (payload?.items_data?.length) {
        saveQuoteDraft(actualRequestId, payload, opts).catch(() => {});
      }
    };

    const handleUnload = () => flushDraft({ keepalive: true });
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      flushDraft();
    };
  }, [mode, actualRequestId]);

  // ─── Loading state ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
        <div className="bg-ui-bg min-h-screen flex items-center justify-center">
            <p>Loading request details...</p>
        </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{NEGOTIATION_STYLES}</style>

      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        {/* ── Main Table Section ── */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Top Controls */}
          <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center justify-between gap-6">
              <button
                onClick={() => navigate(
                  mode === 'view' ? '/requests-overview' : '/buyer',
                  {
                    state: mode === 'negotiate' ? {
                      preserveCart: true,
                      cartItems: items,
                      customerData,
                      currentRequestId: actualRequestId,
                    } : undefined,
                  }
                )}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all ${mode === 'view' ? '' : 'hover:shadow-md'}`}
                style={{ borderColor: 'var(--ui-border)', color: 'var(--brand-blue)' }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                {mode === 'view' ? 'Back to Requests' : 'Back to Cart'}
              </button>

              <div className="flex-1">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(247, 185, 24, 0.5)', background: 'rgba(247, 185, 24, 0.05)' }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--brand-blue)' }}>
                      Customer Total Expectation
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <input
                        className="w-full pl-8 pr-3 py-2.5 bg-white rounded-lg text-lg font-bold focus:ring-2"
                        style={{ border: '1px solid rgba(247, 185, 24, 0.3)', color: 'var(--brand-blue)', outline: 'none' }}
                        type="text"
                        value={totalExpectation}
                        onChange={(e) => setTotalExpectation(e.target.value)}
                        placeholder="0.00"
                        readOnly={mode === 'view'}
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.15)', background: 'rgba(20, 69, 132, 0.02)' }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>
                      Offer Min
                    </label>
                    <p className="text-[9px] mb-2" style={{ color: 'var(--text-muted)' }}>
                      {useVoucherOffers ? '(Voucher)' : '(Cash)'}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-base" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {offerMin !== null ? formatOfferPrice(offerMin) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.15)', background: 'rgba(20, 69, 132, 0.02)' }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>
                      Offer Max
                    </label>
                    <p className="text-[9px] mb-2" style={{ color: 'var(--text-muted)' }}>
                      {useVoucherOffers ? '(Voucher)' : '(Cash)'}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-base" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {offerMax !== null ? formatOfferPrice(offerMax) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border" style={{ borderColor: 'rgba(20, 69, 132, 0.2)', background: 'rgba(20, 69, 132, 0.02)' }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>Target Offer</label>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      {parsedTarget > 0 ? 'Exact total offer required' : 'Not set'}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Request ID</p>
                <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>#{actualRequestId || 'N/A'}</p>
                {mode === 'view' && (
                  <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-red-600">
                    <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                    View Only
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-auto flex-1">
            <table className="w-full spreadsheet-table border-collapse text-left">
              <thead>
                <tr>
                  <th className="w-12 text-center">Qty</th>
                  <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                  <th className="w-24">CeX Buy (Cash)</th>
                  <th className="w-24">CeX Buy (Voucher)</th>
                  <th className="w-24">CeX Sell</th>
                  <th className="w-24">1st Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-24">2nd Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-24">3rd Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-36">Manual Offer</th>
                  <th className="w-32">Customer Expectation</th>
                  <th className="w-24">Our Sale Price</th>
                  <th className="w-36">eBay Price</th>
                  <th className="w-36">Cash Converters</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {items.map((item, index) => (
                  <NegotiationItemRow
                      key={item.id || index}
                    item={item}
                    index={index}
                    mode={mode}
                    useVoucherOffers={useVoucherOffers}
                    onQuantityChange={handleQuantityChange}
                    onSelectOffer={handleSelectOffer}
                    onContextMenu={(e, it) => setContextMenu({ x: e.clientX, y: e.clientY, item: it })}
                    onSetManualOffer={(it) => setItemOfferModal({ item: it })}
                    onCustomerExpectationChange={handleCustomerExpectationChange}
                    onOurSalePriceChange={handleOurSalePriceChange}
                    onOurSalePriceBlur={handleOurSalePriceBlur}
                    onOurSalePriceFocus={handleOurSalePriceFocus}
                    onReopenResearch={setResearchItem}
                    onReopenCashConvertersResearch={setCashConvertersResearchItem}
                  />
                ))}
                <tr className="h-10 opacity-50"><td colSpan="13"></td></tr>
                <tr className="h-10 opacity-50"><td colSpan="13"></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Sidebar ── */}
        <aside className="w-80 border-l flex flex-col bg-white shrink-0" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
          <CustomerTransactionHeader
            customer={customerData}
            transactionType={transactionType}
            onTransactionChange={setTransactionType}
            readOnly={mode === 'view'}
          />
          <div className="flex-1 overflow-y-auto p-6 space-y-6" />

          <div className="p-6 bg-white border-t space-y-4" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
            <div
                className={`flex justify-between items-end ${mode === 'negotiate' ? 'cursor-pointer rounded-lg p-2 -mx-2 hover:bg-blue-50 transition-colors group' : ''}`}
              onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
                title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
              >
                <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>Grand Total</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {mode === 'negotiate' ? 'Click to set target' : 'Based on selected offers'}
                  </span>
                </div>
              <div className="text-right text-3xl font-black tracking-tighter leading-none" style={{ color: 'var(--brand-blue)' }}>
                <span>£{totalOfferPrice.toFixed(2)}</span>
                  {mode === 'negotiate' && (
                  <span className="material-symbols-outlined ml-1 text-blue-300 group-hover:text-blue-600 transition-colors align-middle" style={{ fontSize: 'inherit' }}>edit</span>
                  )}
                </div>
              </div>

            {hasTarget && (
              <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${targetMatched ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <div>
                  <div className={`text-[10px] font-black uppercase tracking-wider ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>Target Offer</div>
                  {!targetMatched && (
                    <div className="text-[9px] text-red-600 font-medium">
                      {totalOfferPrice < parsedTarget
                        ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                        : `Grand total is too high by £${targetExcess.toFixed(2)}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xl font-black ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>£{parsedTarget.toFixed(2)}</span>
                  <span className={`material-symbols-outlined text-[20px] ${targetMatched ? 'text-emerald-600' : 'text-red-500'}`}>
                    {targetMatched ? 'check_circle' : 'cancel'}
                  </span>
                  {mode === 'negotiate' && (
                    <button onClick={(e) => { e.stopPropagation(); setTargetOffer(""); }} className="text-slate-400 hover:text-red-500 transition-colors" title="Remove target">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                mode === 'view' || (hasTarget && !targetMatched) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)', boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)' }}
              onClick={mode === 'view' ? undefined : handleFinalizeTransaction}
              disabled={mode === 'view'}
            >
              <span className="text-base uppercase tracking-tight">Book for Testing</span>
              <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
            {hasTarget && !targetMatched && mode === 'negotiate' && (
              <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
                {totalOfferPrice < parsedTarget
                  ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                  : `Grand total is too high by £${targetExcess.toFixed(2)}`}
              </p>
            )}
          </div>
        </aside>
      </main>

      {/* ── Overlays & Modals ── */}

      {contextMenu && (
        <ItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveFromNegotiation(contextMenu.item)}
          onSetManualOffer={() => { setItemOfferModal({ item: contextMenu.item }); }}
        />
      )}

      {showTargetModal && (
        <TargetOfferModal targetOffer={targetOffer} onSetTarget={setTargetOffer} onClose={() => setShowTargetModal(false)} />
      )}

      {itemOfferModal && (
        <ItemOfferModal
          item={itemOfferModal.item}
          items={items}
          targetOffer={targetOffer}
          useVoucherOffers={useVoucherOffers}
          onApply={(it, perUnit) => applyManualOffer(it, perUnit)}
            onClose={() => setItemOfferModal(null)}
          showNotification={showNotification}
        />
      )}

      {seniorMgmtModal && (
        <SeniorMgmtModal
          item={seniorMgmtModal.item}
          proposedPerUnit={seniorMgmtModal.proposedPerUnit}
          onConfirm={(name) => applyManualOffer(seniorMgmtModal.item, seniorMgmtModal.proposedPerUnit, name)}
            onClose={() => setSeniorMgmtModal(null)}
        />
      )}

      {marginResultModal && (
        <MarginResultModal
          item={marginResultModal.item}
          offerPerUnit={marginResultModal.offerPerUnit}
          ourSalePrice={marginResultModal.ourSalePrice}
          marginPct={marginResultModal.marginPct}
          marginGbp={marginResultModal.marginGbp}
          confirmedBy={marginResultModal.confirmedBy}
            onClose={() => setMarginResultModal(null)}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={true}
      />

      <NewCustomerDetailsModal
        open={showNewCustomerDetailsModal}
        onClose={() => { setShowNewCustomerDetailsModal(false); setPendingFinishPayload(null); }}
        onSubmit={handleNewCustomerDetailsSubmit}
        initialName={customerData?.name || ""}
      />

      {researchItem && (
        <EbayResearchForm
          mode="modal"
          category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
          savedState={researchItem.ebayResearchData}
          onComplete={handleResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
          showManualOffer={true}
          initialSearchQuery={buildInitialSearchQuery(researchItem)}
          useVoucherOffers={useVoucherOffers}
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

      {cashConvertersResearchItem && (
        <CashConvertersResearchForm
          mode="modal"
          category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
          savedState={cashConvertersResearchItem.cashConvertersResearchData}
          onComplete={handleCashConvertersResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
          showManualOffer={true}
          useVoucherOffers={useVoucherOffers}
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

export default Negotiation;
