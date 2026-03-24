import React, { useEffect, useRef, useCallback } from 'react';
import { Sidebar } from '@/components/ui/components';
import AppHeader from '@/components/AppHeader';
import CustomerIntakeModal from '@/components/modals/CustomerIntakeModal.jsx';
import QuickRepriceModal from '@/components/modals/QuickRepriceModal.jsx';
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore, { useCartItems } from '@/store/useAppStore';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import TransactionTypeConfirmDialog from './components/TransactionTypeConfirmDialog';
import { createRepricingSessionDraft, updateRepricingSession } from '@/services/api';
import { getCartKey } from '@/utils/repricingProgress';

export default function Buyer({ mode = 'buyer' }) {
  const isRepricing = mode === 'repricing';
  const location = useLocation();
  const { showNotification } = useNotification();
  const hasRestoredRef = useRef(false);

  const {
    setMode,
    customerData,
    isCustomerModalOpen,
    setCustomerModalOpen,
    setCustomer,
    setTransactionType,
    selectCategory,
    handleAddFromCeX,
    cexLoading,
    isQuickRepriceOpen,
    setQuickRepriceOpen,
    addQuickRepriceItems,
    resetBuyer,
    restoreFromQuoteRequest,
    resetKey,
  } = useAppStore();

  const cartItems = useCartItems();

  // Sync mode into store
  useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);

  // Ensure customer intake modal is shown when entering buyer mode without a customer
  useEffect(() => {
    if (isRepricing) return;
    if (!customerData?.id) {
      setCustomerModalOpen(true);
    }
  }, [isRepricing, customerData?.id, setCustomerModalOpen]);

  // Fresh-start repricing: clear stale session so a new draft is created
  const hasFreshStarted = useRef(false);
  useEffect(() => {
    if (!isRepricing || hasFreshStarted.current) return;
    if (location.state?.freshStart) {
      hasFreshStarted.current = true;
      useAppStore.setState({ repricingSessionId: null, repricingCartItems: [] });
      window.history.replaceState({}, document.title);
    }
  }, [isRepricing, location.state]);

  // Restore from quote request (Requests Overview → continue editing)
  useEffect(() => {
    const req = location.state?.openQuoteRequest;
    if (req && req.current_status === 'QUOTE') {
      restoreFromQuoteRequest(req);
      window.history.replaceState({}, document.title);
    }
  }, [location.state?.openQuoteRequest, restoreFromQuoteRequest]);

  // Restore cart from negotiation back-navigation
  useEffect(() => {
    if (!location.state?.preserveCart || hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const { cartItems: navItems, customerData: navCustomer, currentRequestId, request: navRequest } = location.state;

    if (navItems) {
      const useVoucher = navCustomer?.transactionType === 'store_credit';
      const items = navItems.map((item) => {
        const next = useVoucher ? (item.voucherOffers ?? []) : (item.cashOffers ?? []);
        return { ...item, offers: next.length ? next : (item.offers || []) };
      });
      useAppStore.getState().setCartItems(items);
    }
    if (navCustomer) {
      useAppStore.getState().setCustomerData(navCustomer);
      useAppStore.getState().setCustomerModalOpen(false);
      if (navCustomer.transactionType) {
        useAppStore.setState({ intent: mapTransactionTypeToIntent(navCustomer.transactionType) });
      }
    }
    if (navRequest) {
      const status = navRequest.current_status ?? navRequest.status_history?.[0]?.status;
      if (status === 'QUOTE') useAppStore.getState().setRequest(navRequest);
      else useAppStore.getState().resetBuyer();
    } else if (currentRequestId) {
      useAppStore.getState().hydrateFromRequest(currentRequestId);
    }

    window.history.replaceState({}, document.title);
  }, [location.state]);

  // ── Repricing auto-save to DB ──────────────────────────────────────────────
  const autoSaveTimer = useRef(null);
  const isCreatingDraft = useRef(false);
  const latestCartRef = useRef(cartItems);
  const hasPendingSave = useRef(false);
  // Keep ref in sync during render (not in an effect) so cleanup functions
  // always read the latest cart — eliminates stale-ref-on-unmount race.
  latestCartRef.current = cartItems;

  // If the repricing cart transitions from non-empty to empty while we have a
  // session ID, clear the ID so the next addToCart triggers a fresh draft.
  // We track the previous length to avoid clearing on initial mount when the
  // overview just set the session ID alongside the cart items.
  const prevCartLenRef = useRef(cartItems.length);
  useEffect(() => {
    if (!isRepricing) return;
    const prevLen = prevCartLenRef.current;
    prevCartLenRef.current = cartItems.length;
    if (prevLen > 0 && cartItems.length === 0) {
      const sid = useAppStore.getState().repricingSessionId;
      if (sid) useAppStore.setState({ repricingSessionId: null });
    }
  }, [isRepricing, cartItems.length]);

  const buildCartSnapshot = useCallback((items) => ({
    items: items.map(({ id, title, subtitle, category, model, cexSellPrice, cexBuyPrice,
      cexVoucherPrice, cexUrl, ourSalePrice, cexOutOfStock, cexProductData, isCustomCeXItem,
      isCustomEbayItem, isCustomCashConvertersItem, condition, categoryObject, nosposBarcodes,
      ebayResearchData, cashConvertersResearchData, quantity, offers, cashOffers, voucherOffers,
      variantId, cexSku, attributeValues, referenceData, image }) => ({
      id, title, subtitle, category, model, cexSellPrice, cexBuyPrice, cexVoucherPrice, cexUrl,
      ourSalePrice, cexOutOfStock, cexProductData, isCustomCeXItem, isCustomEbayItem,
      isCustomCashConvertersItem, condition, categoryObject, nosposBarcodes, ebayResearchData,
      cashConvertersResearchData, quantity, offers, cashOffers, voucherOffers, variantId, cexSku,
      attributeValues, referenceData, image,
    })),
  }), []);

  const flushSave = useCallback((opts = {}) => {
    const sessionId = useAppStore.getState().repricingSessionId;
    const items = latestCartRef.current;
    if (!sessionId || !items?.length) return;
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    hasPendingSave.current = false;
    updateRepricingSession(sessionId, {
      session_data: buildCartSnapshot(items),
      cart_key: getCartKey(items),
      item_count: items.length,
    }, opts).catch(err => console.warn('[CG Suite] Repricing save failed:', err));
  }, [buildCartSnapshot]);

  // Create draft or debounced auto-save on cart changes
  useEffect(() => {
    if (!isRepricing || cartItems.length === 0) return;

    const sessionId = useAppStore.getState().repricingSessionId;

    if (!sessionId && !isCreatingDraft.current) {
      isCreatingDraft.current = true;
      createRepricingSessionDraft({
        cart_key: getCartKey(cartItems),
        item_count: cartItems.length,
        session_data: buildCartSnapshot(cartItems),
      }).then(resp => {
        if (resp?.repricing_session_id) {
          useAppStore.getState().setRepricingSessionId(resp.repricing_session_id);
        }
      }).catch(err => {
        console.warn('[CG Suite] Failed to create repricing draft:', err);
      }).finally(() => { isCreatingDraft.current = false; });
      return;
    }

    if (!sessionId) return;

    hasPendingSave.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      hasPendingSave.current = false;
      updateRepricingSession(sessionId, {
        session_data: buildCartSnapshot(cartItems),
        cart_key: getCartKey(cartItems),
        item_count: cartItems.length,
      }).catch(err => console.warn('[CG Suite] Repricing auto-save failed:', err));
    }, 2000);

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [isRepricing, cartItems, buildCartSnapshot]);

  // Flush pending save on unmount (client-side navigation away)
  useEffect(() => {
    if (!isRepricing) return;
    return () => {
      if (hasPendingSave.current) flushSave();
    };
  }, [isRepricing, flushSave]);

  // Save on tab close / hard reload
  useEffect(() => {
    if (!isRepricing) return;
    const handleUnload = () => flushSave({ keepalive: true });
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [isRepricing, flushSave]);

  // ── Transaction type change with confirmation ──
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);
  const [pendingType, setPendingType] = React.useState(null);

  const handleTransactionTypeChange = (newType) => {
    if (cartItems.length > 0 && newType !== customerData.transactionType) {
      setPendingType(newType);
      setShowConfirmDialog(true);
    } else {
      setTransactionType(newType);
    }
  };

  const confirmTransactionTypeChange = () => {
    setTransactionType(pendingType);
    setShowConfirmDialog(false);
    setPendingType(null);
  };

  return (
    <div className="bg-gray-50 text-gray-900 h-screen flex flex-col overflow-hidden text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      {!isRepricing && (
        <CustomerIntakeModal
          key={resetKey}
          open={isCustomerModalOpen}
          onClose={(info) => {
            setCustomerModalOpen(false);
            if (info) setCustomer(info);
          }}
        />
      )}

      {isQuickRepriceOpen && (
        <QuickRepriceModal
          onClose={() => setQuickRepriceOpen(false)}
          onAddItems={(items) => addQuickRepriceItems(items, { showNotification })}
        />
      )}

      <AppHeader />
      <main className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          onCategorySelect={selectCategory}
          onAddFromCeX={null}
          isCeXLoading={cexLoading}
          onQuickReprice={isRepricing ? () => setQuickRepriceOpen(true) : null}
          customerData={isRepricing ? null : customerData}
          onTransactionTypeChange={isRepricing ? null : handleTransactionTypeChange}
        />
        <MainContent key={resetKey} mode={mode} onTransactionTypeChange={handleTransactionTypeChange} />
        <CartSidebar mode={mode} onTransactionTypeChange={!isRepricing ? handleTransactionTypeChange : null} />
      </main>

      {showConfirmDialog && (
        <TransactionTypeConfirmDialog
          pendingType={pendingType}
          cartCount={cartItems.length}
          onConfirm={confirmTransactionTypeChange}
          onCancel={() => { setShowConfirmDialog(false); setPendingType(null); }}
        />
      )}
    </div>
  );
}