import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import CustomerTransactionHeader from './components/CustomerTransactionHeader';
import CustomerIntakeModal from '@/components/modals/CustomerIntakeModal.jsx';
import NegotiationItemRow from './components/NegotiationItemRow';
import { ItemContextMenu, TargetOfferModal, ItemOfferModal, SeniorMgmtModal, MarginResultModal } from './components/NegotiationModals';
import NewCustomerDetailsModal from '@/components/modals/NewCustomerDetailsModal';
import SalePriceConfirmModal from '@/components/modals/SalePriceConfirmModal';
import TinyModal from '@/components/ui/TinyModal';
import { finishRequest, fetchRequestDetail, updateCustomer, saveQuoteDraft, deleteRequestItem } from '@/services/api';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { maybeShowSalePriceConfirm } from './utils/researchCompletionHelpers';
import { mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
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
  const workspaceMode = useAppStore((s) => s.mode);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const handleAddFromCeX = useAppStore((s) => s.handleAddFromCeX);
  const cexLoading = useAppStore((s) => s.cexLoading);
  const createOrAppendRequestItem = useAppStore((s) => s.createOrAppendRequestItem);
  const setCustomerInStore = useAppStore((s) => s.setCustomer);
  const setStoreTransactionType = useAppStore((s) => s.setTransactionType);
  const cexProductData = useAppStore((s) => s.cexProductData);
  const setCexProductData = useAppStore((s) => s.setCexProductData);
  const clearCexProduct = useAppStore((s) => s.clearCexProduct);

  const initialCartItems = location.state?.cartItems ?? storeCartItems;
  const initialCustomerData = location.state?.customerData ?? storeCustomerData;
  const initialRequestId =
    location.state?.currentRequestId ??
    location.state?.openQuoteRequest?.request_id ??
    storeRequest?.request_id;
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
  const [showNewBuyConfirm, setShowNewBuyConfirm] = useState(false);
  const [pendingFinishPayload, setPendingFinishPayload] = useState(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [itemOfferModal, setItemOfferModal] = useState(null);
  const [seniorMgmtModal, setSeniorMgmtModal] = useState(null);
  const [marginResultModal, setMarginResultModal] = useState(null);
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);

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

  const handleConfirmNewBuy = useCallback(() => {
    setShowNewBuyConfirm(false);
    // Mirrors the previous AppHeader "New buy" behavior: wipe state synchronously.
    useAppStore.setState((s) => ({
      mode: 'buyer',
      cartItems: [],
      customerData: { id: null, name: 'No Customer Selected', cancelRate: 0, transactionType: 'sale' },
      intent: null,
      request: null,
      selectedCategory: null,
      availableModels: [],
      selectedModel: null,
      selectedCartItemId: null,
      cexProductData: null,
      cexLoading: false,
      isQuickRepriceOpen: false,
      isCustomerModalOpen: true,
      resetKey: s.resetKey + 1,
    }));
    navigate('/buyer');
  }, [navigate]);

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

  const handleRemoveFromNegotiation = useCallback(async (item) => {
    const requestItemId = item?.request_item_id;
    setItems(prev => prev.filter(i => i.id !== item.id));
    setContextMenu(null);
    showNotification(`"${item.title || 'Item'}" removed from negotiation`, 'info');

    // Persist removal so Requests Overview doesn't show stale items.
    if (mode !== 'view' && requestItemId) {
      try {
        await deleteRequestItem(requestItemId);
      } catch (err) {
        console.error('Failed to delete request item:', err);
        showNotification('Failed to remove item from request (server).', 'error');
      }
    }
  }, [showNotification, mode]);

  const buildFiltersSubtitle = useCallback((selectedFilters, fallback) => {
    const parts = [];
    const basic = selectedFilters?.basic || [];
    const apiValues = Object.values(selectedFilters?.apiFilters || {}).flat();
    parts.push(...basic);
    parts.push(...apiValues);

    const priceRange = selectedFilters?.advanced?.priceRange;
    if (priceRange?.min != null && priceRange?.max != null) {
      const min = Number(priceRange.min);
      const max = Number(priceRange.max);
      if (Number.isFinite(min) && Number.isFinite(max)) parts.push(`Price £${min.toFixed(2)} - £${max.toFixed(2)}`);
    }

    const soldRange = selectedFilters?.advanced?.soldDateRange;
    if (soldRange?.fromLabel && soldRange?.toLabel) {
      parts.push(`Sold ${soldRange.fromLabel} - ${soldRange.toLabel}`);
    }

    const joined = parts.filter(Boolean).join(' / ');
    return joined || fallback || 'No filters applied';
  }, []);

  // Live persistence: advanced slider changes should update the active request row
  // so Requests Overview can show the latest exact filters.
  const handleEbayAdvancedFiltersChange = useCallback((nextSelectedFilters) => {
    if (!researchItem) return;
    setItems(prevItems => prevItems.map(i => {
      if (i.id !== researchItem.id) return i;
      const fallback = i.ebayResearchData?.searchTerm || i.title || 'eBay Research Item';
      const nextSubtitle = buildFiltersSubtitle(nextSelectedFilters, fallback);
      return {
        ...i,
        ebayResearchData: { ...(i.ebayResearchData || {}), selectedFilters: nextSelectedFilters },
        subtitle: nextSubtitle,
      };
    }));
    setResearchItem(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ebayResearchData: { ...(prev.ebayResearchData || {}), selectedFilters: nextSelectedFilters },
        subtitle: buildFiltersSubtitle(nextSelectedFilters, prev.ebayResearchData?.searchTerm || prev.title),
      };
    });
  }, [researchItem, setItems, buildFiltersSubtitle]);

  const handleCashConvertersAdvancedFiltersChange = useCallback((nextSelectedFilters) => {
    if (!cashConvertersResearchItem) return;
    setItems(prevItems => prevItems.map(i => {
      if (i.id !== cashConvertersResearchItem.id) return i;
      const fallback = i.cashConvertersResearchData?.searchTerm || i.title || 'Cash Converters Research Item';
      const nextSubtitle = buildFiltersSubtitle(nextSelectedFilters, fallback);
      return {
        ...i,
        cashConvertersResearchData: { ...(i.cashConvertersResearchData || {}), selectedFilters: nextSelectedFilters },
        subtitle: nextSubtitle,
      };
    }));
    setCashConvertersResearchItem(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cashConvertersResearchData: { ...(prev.cashConvertersResearchData || {}), selectedFilters: nextSelectedFilters },
        subtitle: buildFiltersSubtitle(nextSelectedFilters, prev.cashConvertersResearchData?.searchTerm || prev.title),
      };
    });
  }, [cashConvertersResearchItem, setItems, buildFiltersSubtitle]);

  const handleAddNegotiationItem = useCallback(async (cartItem) => {
    if (!cartItem) return;
    try {
      // CeX (and any other) flows may persist the request row before calling onAddToCart — skip a second POST.
      let reqItemId = cartItem.request_item_id;
      if (reqItemId == null || reqItemId === '') {
        const embeddedRawData = cartItem.referenceData ? { referenceData: cartItem.referenceData } : null;
        reqItemId = await createOrAppendRequestItem({
          variantId: cartItem.variantId,
          rawData: embeddedRawData,
          cashConvertersData: cartItem.cashConvertersResearchData || null,
          cashOffers: cartItem.cashOffers || [],
          voucherOffers: cartItem.voucherOffers || [],
          selectedOfferId: cartItem.selectedOfferId ?? null,
          manualOffer: cartItem.manualOffer ?? null,
          ourSalePrice: cartItem.ourSalePrice ?? null,
          cexSku: cartItem.cexSku ?? null,
        });
      }
      const withRequestId = { ...cartItem, request_item_id: reqItemId };
      setItems((prev) => [...prev, normalizeCartItemForNegotiation(withRequestId)]);
      showNotification(`Added "${cartItem.title}" to negotiation`, 'success');
    } catch (err) {
      console.error('Failed to add negotiation item:', err);
      showNotification(err?.message || 'Failed to add item', 'error');
    }
  }, [createOrAppendRequestItem, showNotification]);

  const handleEbayResearchCompleteFromHeader = useCallback(async (data) => {
    if (!data) return;
    const cashOffers = (data.buyOffers || []).map((o, idx) => ({
      id: `ebay-cash-${Date.now()}-${idx}`,
      title: ['1st Offer', '2nd Offer', '3rd Offer'][idx] || 'Offer',
      price: Number(formatOfferPrice(o.price)),
    }));
    const voucherOffers = cashOffers.map((o) => ({
      id: `ebay-voucher-${o.id}`,
      title: o.title,
      price: Number(formatOfferPrice(o.price * 1.1)),
    }));
    const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;
    let selectedOfferId = displayOffers[0]?.id ?? null;
    let manualOffer = null;
    if (data.selectedOfferIndex === null) {
      selectedOfferId = null;
    } else if (data.selectedOfferIndex === 'manual') {
      selectedOfferId = 'manual';
      manualOffer = data.manualOffer ?? null;
    } else if (typeof data.selectedOfferIndex === 'number' && displayOffers[data.selectedOfferIndex]) {
      selectedOfferId = displayOffers[data.selectedOfferIndex].id;
    }
    const searchTitle =
      data.searchTerm != null && String(data.searchTerm).trim() !== ''
        ? String(data.searchTerm).trim().slice(0, 200)
        : 'eBay Research Item';
    const customItem = {
      id: crypto.randomUUID?.() ?? `neg-ebay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: searchTitle,
      subtitle: 'eBay Research',
      quantity: 1,
      category: 'eBay',
      categoryObject: { name: 'eBay', path: ['eBay'] },
      offers: displayOffers,
      cashOffers,
      voucherOffers,
      ebayResearchData: data,
      isCustomEbayItem: true,
      selectedOfferId,
      manualOffer,
      ourSalePrice: data.stats?.suggestedPrice != null ? Number(formatOfferPrice(data.stats.suggestedPrice)) : null,
      request_item_id: null,
      variantId: null,
    };
    await handleAddNegotiationItem(customItem);
  }, [handleAddNegotiationItem, useVoucherOffers]);

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

  // Resume QUOTE from Requests Overview: reset header/builder store before paint so AppHeader
  // does not open the fixed workspace (eBay / category overlay) on stale selectedCategory.
  useLayoutEffect(() => {
    if (mode !== 'negotiate') return;
    const rq = location.state?.openQuoteRequest;
    if (!rq || rq.current_status !== 'QUOTE') return;

    const txType =
      rq.intent === 'DIRECT_SALE' ? 'sale'
        : rq.intent === 'BUYBACK' ? 'buyback'
        : 'store_credit';
    const mappedCustomer = mapRequestToCustomerData(rq);
    useAppStore.setState({
      request: rq,
      customerData: mappedCustomer,
      intent: mapTransactionTypeToIntent(txType),
      selectedCategory: null,
      selectedModel: null,
      selectedCartItemId: null,
      cexProductData: null,
      availableModels: [],
      isLoadingModels: false,
      isCustomerModalOpen: false,
    });
  }, [mode, location.state?.openQuoteRequest]);

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

          setCustomerData(mapRequestToCustomerData(data));
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
        const openQuoteRequest = location.state?.openQuoteRequest;
        if (openQuoteRequest?.current_status === 'QUOTE' && !hasInitializedNegotiateRef.current) {
          const txType =
            openQuoteRequest.intent === 'DIRECT_SALE' ? 'sale'
              : openQuoteRequest.intent === 'BUYBACK' ? 'buyback'
              : 'store_credit';
          setCustomerData(mapRequestToCustomerData(openQuoteRequest));
          setTransactionType(txType);
          setTotalExpectation(openQuoteRequest.overall_expectation_gbp?.toString() || '');
          setTargetOffer(openQuoteRequest.target_offer_gbp != null ? openQuoteRequest.target_offer_gbp.toString() : '');
          setItems((openQuoteRequest.items || []).map((apiItem) => mapApiItemToNegotiationItem(apiItem, txType, 'negotiate')));
          hasInitializedNegotiateRef.current = true;
          window.history.replaceState({}, document.title);
          setIsLoading(false);
          return;
        }
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

        setIsLoading(false);
    }
  }, [mode, actualRequestId, navigate, initialCustomerData, initialCartItems, showNotification]);

  // Sync transactionType from customerData
  useEffect(() => {
    if (customerData?.transactionType) setTransactionType(customerData.transactionType);
  }, [customerData]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    const hasCustomer = Boolean(customerData?.id) || Boolean(initialCustomerData?.id);
    setCustomerModalOpen(!hasCustomer);
  }, [mode, customerData?.id, initialCustomerData?.id]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    if (!customerData?.id) return;
    if (transactionType && transactionType !== customerData.transactionType) {
      setStoreTransactionType(transactionType);
    }
  }, [mode, transactionType, customerData?.id, customerData?.transactionType, setStoreTransactionType]);

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

  // Auto-sum per-item customer expectations into the overall field
  useEffect(() => {
    if (mode !== 'negotiate') return;
    const activeItems = items.filter(i => !i.isRemoved);
    if (activeItems.length === 0) return;
    const parsed = activeItems.map(i => parseFloat(String(i.customerExpectation ?? '').replace(/[£,]/g, '').trim()));
    if (parsed.every(v => Number.isFinite(v) && v >= 0)) {
      const sum = parsed.reduce((acc, v) => acc + v, 0);
      setTotalExpectation(sum.toFixed(2));
    }
  }, [items, mode]);

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

      {mode === 'negotiate' && (
        <CustomerIntakeModal
          open={isCustomerModalOpen}
          onClose={(info) => {
            setCustomerModalOpen(false);
            if (!info) return;
            setCustomerInStore(info);
            const nextCustomer = useAppStore.getState().customerData;
            setCustomerData(nextCustomer);
            setTransactionType(nextCustomer?.transactionType || 'sale');
          }}
        />
      )}

      <AppHeader
        buyerControls={mode === 'negotiate' ? {
          enabled: true,
          selectedCategory,
          onCategorySelect: selectCategory,
          onAddFromCeX: (opts) => handleAddFromCeX({ showNotification, ...opts }),
          isCeXLoading: cexLoading,
          enableNegotiationItemBuilder: true,
          useVoucherOffers,
          onAddNegotiationItem: handleAddNegotiationItem,
          onEbayResearchComplete: handleEbayResearchCompleteFromHeader,
          cexProductData,
          setCexProductData,
          clearCexProduct,
          createOrAppendRequestItem,
          customerData,
          existingItems: items,
          showNotification,
        } : null}
      />

      <main className="relative flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        {/* ── Main Table Section ── */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Top Controls */}
          <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center gap-6">
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
                        onKeyDown={mode === 'negotiate' ? (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        } : undefined}
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
                    <div
                      className={`flex items-baseline gap-1 ${mode === 'negotiate' ? 'cursor-pointer rounded-lg p-2 -mx-2 -mb-2 hover:bg-blue-50 transition-colors group' : ''}`}
                      onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
                      role={mode === 'negotiate' ? 'button' : undefined}
                      title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
                    >
                      <span className="font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
                      </span>
                      {mode === 'negotiate' && (
                        <span className="material-symbols-outlined ml-1 text-blue-300 group-hover:text-blue-600 transition-colors align-middle" style={{ fontSize: '1.5rem' }}>edit</span>
                      )}
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
            customer={customerData?.id ? customerData : { name: 'No customer selected' }}
            transactionType={transactionType}
            onTransactionChange={(nextType) => {
              setTransactionType(nextType);
              setStoreTransactionType(nextType);
            }}
            readOnly={mode === 'view'}
          />
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <button
              type="button"
              onClick={() => setShowNewBuyConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-bold text-sm transition-all"
              style={{
                borderColor: 'rgba(20, 69, 132, 0.25)',
                color: 'var(--brand-blue)',
                background: 'rgba(20, 69, 132, 0.03)',
              }}
              title="Clear cart/customer and start a fresh buying session"
            >
              <span className="material-symbols-outlined text-lg">refresh</span>
              New Buy
            </button>
          </div>

          <div className="p-6 bg-white border-t space-y-4" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
            <div className="flex justify-between items-end">
                <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>Grand Total</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Based on selected offers
                  </span>
                </div>
              <div className="text-right text-3xl font-black tracking-tighter leading-none" style={{ color: 'var(--brand-blue)' }}>
                <span>£{totalOfferPrice.toFixed(2)}</span>
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
                mode === 'view' || workspaceMode === 'buyer' || (hasTarget && !targetMatched) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)', boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)' }}
              onClick={mode === 'view' || workspaceMode === 'buyer' || (hasTarget && !targetMatched) ? undefined : handleFinalizeTransaction}
              disabled={mode === 'view' || workspaceMode === 'buyer' || (hasTarget && !targetMatched)}
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

        {(researchItem || cashConvertersResearchItem) && (
          <div className="fixed left-0 right-80 bottom-0 z-[90] min-h-0" style={{ top: 'var(--workspace-overlay-top, 64px)' }}>
            <div className="relative h-full w-full min-h-0">
              {researchItem && (
                <EbayResearchForm
                  mode="modal"
                  containModalInParent
                  category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
                  savedState={researchItem.ebayResearchData}
                  onComplete={handleResearchComplete}
                  onAdvancedFiltersChange={handleEbayAdvancedFiltersChange}
                  initialHistogramState={true}
                  readOnly={mode === 'view'}
                  showManualOffer={true}
                  hideAddAction={true}
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
                  containModalInParent
                  category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
                  savedState={cashConvertersResearchItem.cashConvertersResearchData}
                  onComplete={handleCashConvertersResearchComplete}
                  onAdvancedFiltersChange={handleCashConvertersAdvancedFiltersChange}
                  initialHistogramState={true}
                  readOnly={mode === 'view'}
                  showManualOffer={true}
                  hideAddAction={true}
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
          </div>
        )}
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

      {showNewBuyConfirm && (
        <TinyModal
          title="Start a new buy?"
          onClose={() => setShowNewBuyConfirm(false)}
        >
          <p className="text-xs text-slate-600 mb-5">
            This will clear your current cart and customer details. You can start again from the buyer page.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: 'white', color: 'var(--text-muted)', border: '1px solid var(--ui-border)' }}
              onClick={() => setShowNewBuyConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={handleConfirmNewBuy}
            >
              Yes, start new buy
            </button>
          </div>
        </TinyModal>
      )}

    </div>
  );
};

export default Negotiation;
