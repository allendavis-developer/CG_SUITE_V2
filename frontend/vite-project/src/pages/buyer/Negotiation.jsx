import React, { useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import CustomerIntakeModal from '@/components/modals/CustomerIntakeModal.jsx';
import ResearchOverlayPanel from './components/ResearchOverlayPanel';
import NegotiationDocumentHead from './components/negotiation/NegotiationDocumentHead';
import NegotiationTablesSection from './components/negotiation/NegotiationTablesSection';
import NegotiationSidebarPanel from './components/negotiation/NegotiationSidebarPanel';
import NegotiationModalsLayer from './components/negotiation/NegotiationModalsLayer';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { useResearchOverlay } from './hooks/useResearchOverlay';
import { useNegotiationParkAgreement } from './hooks/useNegotiationParkAgreement';
import { useNegotiationJewelleryWorkspaceSync } from './hooks/useNegotiationJewelleryWorkspaceSync';
import { useNegotiationFinalize } from './hooks/useNegotiationFinalize';
import { useNegotiationItemHandlers } from './hooks/useNegotiationItemHandlers';
import { useNegotiationLifecycle } from './hooks/useNegotiationLifecycle';
import { getBlockedOfferSlots } from '@/utils/customerOfferRules';
import {
  resolveOurSalePrice,
  calculateTotalOfferPrice,
  calculateJewelleryOfferTotal,
  calculateNonJewelleryOfferTotal,
  applyEbayResearchToItem,
  applyCashConvertersResearchToItem,
  resolveSuggestedRetailFromResearchStats,
  getDisplayOffers,
} from './utils/negotiationHelpers';

const Negotiation = ({ mode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId: paramsRequestId } = useParams();
  const { showNotification } = useNotification();

  // Read initial data from store (negotiate mode) or location.state (fallback)
  const storeCartItems = useAppStore((s) => s.cartItems);
  const storeCustomerData = useAppStore((s) => s.customerData);
  const storeRequest = useAppStore((s) => s.request);
  const headerWorkspaceOpen = useAppStore((s) => s.headerWorkspaceOpen);
  const headerWorkspaceMode = useAppStore((s) => s.headerWorkspaceMode);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const handleAddFromCeX = useAppStore((s) => s.handleAddFromCeX);
  const cexLoading = useAppStore((s) => s.cexLoading);
  const createOrAppendRequestItem = useAppStore((s) => s.createOrAppendRequestItem);
  const setRequest = useAppStore((s) => s.setRequest);
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
  /** Lines for the header jewellery workspace (hydrated from quote + draft rows without request_item_id). */
  const [jewelleryWorkspaceLines, setJewelleryWorkspaceLines] = useState([]);
  /** Mastermelt reference scrape cached for this quote request only (one extension run per request). */
  const [jewelleryReferenceScrape, setJewelleryReferenceScrape] = useState(null);
  const [customerData, setCustomerData] = useState({});
  const [transactionType, setTransactionType] = useState('sale');
  const [totalExpectation, setTotalExpectation] = useState("");
  const [targetOffer, setTargetOffer] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // UI / modal state
  const [contextMenu, setContextMenu] = useState(null);
  const [showNewCustomerDetailsModal, setShowNewCustomerDetailsModal] = useState(false);
  const [showNewBuyConfirm, setShowNewBuyConfirm] = useState(false);
  const [pendingFinishPayload, setPendingFinishPayload] = useState(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [itemOfferModal, setItemOfferModal] = useState(null);
  const [seniorMgmtModal, setSeniorMgmtModal] = useState(null);
  const [marginResultModal, setMarginResultModal] = useState(null);
  const [blockedOfferModal, setBlockedOfferModal] = useState(null); // { slot, offer, item?, onAuthoriseAction? }
  const [customerOfferRulesData, setCustomerOfferRulesData] = useState(null);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);
  /** BOOKED_FOR_TESTING | COMPLETE | QUOTE | null — used for research sandbox in view mode. */
  const [viewRequestStatus, setViewRequestStatus] = useState(null);
  const [showJewelleryReferenceModal, setShowJewelleryReferenceModal] = useState(false);
  /** Lines missing required NosPos stock fields — blocks book-for-testing until filled (see modal). */
  const [missingRequiredNosposModal, setMissingRequiredNosposModal] = useState(null);
  // Refs
  const hasInitializedNegotiateRef = useRef(false);
  const completedRef = useRef(false);
  const draftPayloadRef = useRef(null);
  const prevTransactionTypeRef = useRef(transactionType);
  /** Only clear jewellery reference when switching to a different request, not on undefined→id (avoids wiping hydrated scrape). */
  const prevNegotiationRequestIdRef = useRef(null);
  const useVoucherOffers = transactionType === 'store_credit';

  const blockedOfferSlots = useMemo(() => {
    if (!customerOfferRulesData) return new Set();
    return getBlockedOfferSlots(customerData, customerOfferRulesData.rules, customerOfferRulesData.settings);
  }, [customerData, customerOfferRulesData]);

  const parseManualOfferValue = useCallback((rawValue) => {
    if (rawValue == null || rawValue === '') return NaN;
    const parsed = Number(String(rawValue).replace(/[£,]/g, '').trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }, []);

  const researchSandboxBookedView =
    mode === 'view' && viewRequestStatus === 'BOOKED_FOR_TESTING';
  const researchFormReadOnly = mode === 'view' && !researchSandboxBookedView;
  const researchEphemeralNotice = researchSandboxBookedView
    ? 'Research you run in this panel is not saved.'
    : null;

  // ─── Research overlay (shared hook) ─────────────────────────────────────
  const applyEbay = useCallback((item, state) => applyEbayResearchToItem(item, state, useVoucherOffers), [useVoucherOffers]);
  const applyCC = useCallback((item, state) => applyCashConvertersResearchToItem(item, state, useVoucherOffers), [useVoucherOffers]);
  const onResearchPersisted = useCallback((mergedItem) => {
    if (!mergedItem || mergedItem.selectedOfferId !== 'manual') return;
    const manualPerUnit = parseManualOfferValue(mergedItem.manualOffer);
    let rrp = resolveOurSalePrice(mergedItem);
    if ((rrp == null || rrp <= 0) && mergedItem.cashConvertersResearchData?.stats) {
      rrp = resolveSuggestedRetailFromResearchStats(mergedItem.cashConvertersResearchData.stats);
    }
    if (!Number.isFinite(manualPerUnit) || manualPerUnit <= 0 || !Number.isFinite(rrp) || rrp <= 0) return;
    setTimeout(() => {
      if (manualPerUnit > rrp) setSeniorMgmtModal({ item: mergedItem, proposedPerUnit: manualPerUnit });
      else
        setMarginResultModal({
          item: mergedItem,
          offerPerUnit: manualPerUnit,
          ourSalePrice: rrp,
          marginPct: ((rrp - manualPerUnit) / rrp) * 100,
          marginGbp: rrp - manualPerUnit,
          confirmedBy: mergedItem.seniorMgmtApprovedBy || null,
        });
    }, 0);
  }, [parseManualOfferValue, setSeniorMgmtModal, setMarginResultModal]);
  const {
    researchItem, setResearchItem,
    cashConvertersResearchItem, setCashConvertersResearchItem,
    salePriceConfirmModal, setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
    handleResearchItemCategoryResolved,
  } = useResearchOverlay({
    items,
    setItems,
    applyEbayResearch: applyEbay,
    applyCCResearch: applyCC,
    resolveSalePrice: resolveOurSalePrice,
    readOnly: researchFormReadOnly,
    persistResearchOnComplete: mode === 'negotiate',
    onResearchPersisted,
  });

  // ─── Derived values ────────────────────────────────────────────────────

  const parsedTarget = parseFloat(targetOffer) || 0;
  const totalOfferPrice = calculateTotalOfferPrice(items, useVoucherOffers);
  const jewelleryOfferTotal = useMemo(
    () => calculateJewelleryOfferTotal(items, useVoucherOffers),
    [items, useVoucherOffers]
  );
  const otherItemsOfferTotal = useMemo(
    () => calculateNonJewelleryOfferTotal(items, useVoucherOffers),
    [items, useVoucherOffers]
  );
  const mainNegotiationItems = useMemo(
    () => items.filter((i) => !i.isJewelleryItem),
    [items]
  );
  const jewelleryNegotiationItems = useMemo(
    () => items.filter((i) => i.isJewelleryItem === true),
    [items]
  );

  const {
    parkProgressModal,
    setParkProgressModal,
    parkRetryBusyUi,
    parkExcludedItems,
    persistedNosposUrl,
    handleParkFieldPatch,
    handleRetryParkLine,
    handleViewParkedAgreement,
    handleToggleParkExcludeItem,
    handleParkAgreementOpenNospos,
    hydrateFromSavedState,
    parkNosposTabRef,
  } = useNegotiationParkAgreement({
    items,
    actualRequestId,
    showNotification,
    researchSandboxBookedView,
    customerData,
    transactionType,
    useVoucherOffers,
  });

  const {
    normalizeOffersForApi,
    handleJewelleryWorkspaceLinesChange,
  } = useNegotiationJewelleryWorkspaceSync({
    mode,
    useVoucherOffers,
    customerOfferRulesData,
    setItems,
    setJewelleryWorkspaceLines,
    jewelleryWorkspaceLines,
    jewelleryNegotiationItems,
    headerWorkspaceOpen,
    headerWorkspaceMode,
  });

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
      const displayOffers = getDisplayOffers(item, useVoucherOffers);
      const prices = displayOffers.map(o => Number(o.price)).filter(p => !isNaN(p) && p >= 0);
      if (prices.length > 0) {
        min += Math.min(...prices) * qty;
        max += Math.max(...prices) * qty;
      }
    }
    return { offerMin: min, offerMax: max };
  }, [items, useVoucherOffers]);

  const {
    applyManualOffer,
    handleFinalizeTransaction,
    handleMissingNosposRecheckContinue,
    handleNewCustomerDetailsSubmit,
    handleConfirmNewBuy,
  } = useNegotiationFinalize({
    items,
    targetOffer,
    totalOfferPrice,
    totalExpectation,
    useVoucherOffers,
    customerData,
    jewelleryReferenceScrape,
    actualRequestId,
    navigate,
    showNotification,
    setItems,
    setSeniorMgmtModal,
    setMarginResultModal,
    setPendingFinishPayload,
    setShowNewCustomerDetailsModal,
    setShowNewBuyConfirm,
    completedRef,
    pendingFinishPayload,
    setMissingRequiredNosposModal,
  });

  const {
    handleQuantityChange,
    handleSelectOffer,
    markItemSlotAuthorised,
    handleBlockedOfferClick,
    handleResearchBlockedOfferClick,
    handleCustomerExpectationChange,
    handleOurSalePriceChange,
    handleOurSalePriceBlur,
    handleOurSalePriceFocus,
    handleRemoveFromNegotiation,
    handleJewelleryItemNameChange,
    handleJewelleryWeightChange,
    handleAddNegotiationItem,
    handleWorkspaceBlockedOfferAttempt,
    handleAddJewelleryItemsFromWorkspace,
    handleRemoveJewelleryWorkspaceRow,
    handleEbayResearchCompleteFromHeader,
    handleRefreshCeXData,
  } = useNegotiationItemHandlers({
    items,
    setItems,
    setContextMenu,
    setJewelleryWorkspaceLines,
    setBlockedOfferModal,
    setItemOfferModal,
    setSeniorMgmtModal,
    setMarginResultModal,
    showNotification,
    storeRequest,
    setRequest,
    useVoucherOffers,
    customerOfferRulesData,
    createOrAppendRequestItem,
    normalizeOffersForApi,
    parseManualOfferValue,
    headerWorkspaceMode,
    handleAddFromCeX,
    clearCexProduct,
  });

  const { draftPayload, handleJewelleryReferenceScrapeResult } = useNegotiationLifecycle({
    mode,
    location,
    navigate,
    actualRequestId,
    initialCartItems,
    initialCustomerData,
    customerData,
    customerOfferRulesData,
    setCustomerData,
    setTransactionType,
    setStoreTransactionType,
    setRequest,
    setItems,
    setJewelleryWorkspaceLines,
    setIsLoading,
    setViewRequestStatus,
    setTotalExpectation,
    setTargetOffer,
    setJewelleryReferenceScrape,
    setCustomerModalOpen,
    items,
    totalExpectation,
    targetOffer,
    useVoucherOffers,
    jewelleryReferenceScrape,
    transactionType,
    showNotification,
    hydrateFromSavedState,
    hasInitializedNegotiateRef,
    completedRef,
    draftPayloadRef,
    prevTransactionTypeRef,
    prevNegotiationRequestIdRef,
    storeRequest,
    setCustomerOfferRulesData,
  });
  draftPayloadRef.current = draftPayload;
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
      <NegotiationDocumentHead />

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
          onAddJewelleryToNegotiation: handleAddJewelleryItemsFromWorkspace,
          onEbayResearchComplete: handleEbayResearchCompleteFromHeader,
          cexProductData,
          setCexProductData,
          clearCexProduct,
          createOrAppendRequestItem,
          customerData,
          existingItems: items,
          showNotification,
          blockedOfferSlots,
          onWorkspaceBlockedOfferAttempt: handleWorkspaceBlockedOfferAttempt,
          jewelleryWorkspaceLines,
          setJewelleryWorkspaceLines: handleJewelleryWorkspaceLinesChange,
          onRemoveJewelleryWorkspaceRow: handleRemoveJewelleryWorkspaceRow,
          jewelleryReferenceScrape,
          onJewelleryReferenceScrapeResult: handleJewelleryReferenceScrapeResult,
        } : null}
      />

      <main className="relative flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        <NegotiationTablesSection
          mode={mode}
          totalExpectation={totalExpectation}
          setTotalExpectation={setTotalExpectation}
          offerMin={offerMin}
          offerMax={offerMax}
          parsedTarget={parsedTarget}
          setShowTargetModal={setShowTargetModal}
          actualRequestId={actualRequestId}
          researchSandboxBookedView={researchSandboxBookedView}
          jewelleryNegotiationItems={jewelleryNegotiationItems}
          jewelleryReferenceScrape={jewelleryReferenceScrape}
          setShowJewelleryReferenceModal={setShowJewelleryReferenceModal}
          handleSelectOffer={handleSelectOffer}
          setContextMenu={setContextMenu}
          setItemOfferModal={setItemOfferModal}
          handleCustomerExpectationChange={handleCustomerExpectationChange}
          handleJewelleryItemNameChange={handleJewelleryItemNameChange}
          handleJewelleryWeightChange={handleJewelleryWeightChange}
          blockedOfferSlots={blockedOfferSlots}
          handleBlockedOfferClick={handleBlockedOfferClick}
          parkExcludedItems={parkExcludedItems}
          handleToggleParkExcludeItem={handleToggleParkExcludeItem}
          mainNegotiationItems={mainNegotiationItems}
          handleQuantityChange={handleQuantityChange}
          handleOurSalePriceChange={handleOurSalePriceChange}
          handleOurSalePriceBlur={handleOurSalePriceBlur}
          handleOurSalePriceFocus={handleOurSalePriceFocus}
          handleRefreshCeXData={handleRefreshCeXData}
          setResearchItem={setResearchItem}
          setCashConvertersResearchItem={setCashConvertersResearchItem}
          useVoucherOffers={useVoucherOffers}
        />
        <NegotiationSidebarPanel
          customerData={customerData}
          transactionType={transactionType}
          setTransactionType={setTransactionType}
          setStoreTransactionType={setStoreTransactionType}
          mode={mode}
          setShowNewBuyConfirm={setShowNewBuyConfirm}
          jewelleryOfferTotal={jewelleryOfferTotal}
          otherItemsOfferTotal={otherItemsOfferTotal}
          totalOfferPrice={totalOfferPrice}
          hasTarget={hasTarget}
          targetMatched={targetMatched}
          parsedTarget={parsedTarget}
          targetShortfall={targetShortfall}
          targetExcess={targetExcess}
          setTargetOffer={setTargetOffer}
          researchSandboxBookedView={researchSandboxBookedView}
          persistedNosposUrl={persistedNosposUrl}
          handleParkAgreementOpenNospos={handleParkAgreementOpenNospos}
          handleViewParkedAgreement={handleViewParkedAgreement}
          headerWorkspaceOpen={headerWorkspaceOpen}
          researchItem={researchItem}
          cashConvertersResearchItem={cashConvertersResearchItem}
          handleFinalizeTransaction={handleFinalizeTransaction}
        />
        <ResearchOverlayPanel
          researchItem={researchItem}
          cashConvertersResearchItem={cashConvertersResearchItem}
          onResearchComplete={handleResearchComplete}
          onCashConvertersResearchComplete={handleCashConvertersResearchComplete}
          readOnly={researchFormReadOnly}
          ephemeralSessionNotice={researchEphemeralNotice}
          showManualOffer={true}
          useVoucherOffers={useVoucherOffers}
          blockedOfferSlots={blockedOfferSlots}
          onBlockedOfferClick={handleResearchBlockedOfferClick}
          onCategoryResolved={handleResearchItemCategoryResolved}
        />
      </main>

      <NegotiationModalsLayer
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        handleRemoveFromNegotiation={handleRemoveFromNegotiation}
        showNotification={showNotification}
        setItems={setItems}
        useVoucherOffers={useVoucherOffers}
        showTargetModal={showTargetModal}
        setShowTargetModal={setShowTargetModal}
        targetOffer={targetOffer}
        setTargetOffer={setTargetOffer}
        itemOfferModal={itemOfferModal}
        setItemOfferModal={setItemOfferModal}
        items={items}
        applyManualOffer={applyManualOffer}
        seniorMgmtModal={seniorMgmtModal}
        setSeniorMgmtModal={setSeniorMgmtModal}
        marginResultModal={marginResultModal}
        setMarginResultModal={setMarginResultModal}
        blockedOfferModal={blockedOfferModal}
        setBlockedOfferModal={setBlockedOfferModal}
        customerData={customerData}
        customerOfferRulesData={customerOfferRulesData}
        markItemSlotAuthorised={markItemSlotAuthorised}
        salePriceConfirmModal={salePriceConfirmModal}
        setSalePriceConfirmModal={setSalePriceConfirmModal}
        showNewCustomerDetailsModal={showNewCustomerDetailsModal}
        setShowNewCustomerDetailsModal={setShowNewCustomerDetailsModal}
        setPendingFinishPayload={setPendingFinishPayload}
        handleNewCustomerDetailsSubmit={handleNewCustomerDetailsSubmit}
        showNewBuyConfirm={showNewBuyConfirm}
        setShowNewBuyConfirm={setShowNewBuyConfirm}
        handleConfirmNewBuy={handleConfirmNewBuy}
        parkProgressModal={parkProgressModal}
        setParkProgressModal={setParkProgressModal}
        parkNosposTabRef={parkNosposTabRef}
        handleParkFieldPatch={handleParkFieldPatch}
        handleRetryParkLine={handleRetryParkLine}
        parkRetryBusyUi={parkRetryBusyUi}
        handleViewParkedAgreement={handleViewParkedAgreement}
        showJewelleryReferenceModal={showJewelleryReferenceModal}
        setShowJewelleryReferenceModal={setShowJewelleryReferenceModal}
        jewelleryReferenceScrape={jewelleryReferenceScrape}
        missingRequiredNosposModal={missingRequiredNosposModal}
        handleMissingNosposRecheckContinue={handleMissingNosposRecheckContinue}
      />

    </div>
  );
};

export default Negotiation;
