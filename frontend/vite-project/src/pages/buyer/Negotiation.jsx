import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import JewelleryNegotiationSlimTable from '@/components/jewellery/JewelleryNegotiationSlimTable';
import { buildJewelleryNegotiationCartItem, getJewelleryWorkspaceDerivedState } from '@/components/jewellery/jewelleryNegotiationCart';
import { negotiationJewelleryItemsToWorkspaceLines, negotiationJewelleryItemToWorkspaceLine } from '@/components/jewellery/jewelleryWorkspaceMapping';
import {
  applyJewelleryScrapeToNegotiationItem,
  remapJewelleryWorkspaceLines,
} from '@/components/jewellery/jewelleryScrapeRemap';
import CustomerTransactionHeader from './components/CustomerTransactionHeader';
import NosposAgreementMirrorModal from './components/NosposAgreementMirrorModal';
import CustomerIntakeModal from '@/components/modals/CustomerIntakeModal.jsx';
import NegotiationItemRow from './components/NegotiationItemRow';
import JewelleryReferencePricesTable from '@/components/jewellery/JewelleryReferencePricesTable';
import { TargetOfferModal, ItemOfferModal, SeniorMgmtModal, MarginResultModal, BlockedOfferAuthModal } from './components/NegotiationModals';
import NegotiationRowContextMenu from './components/NegotiationRowContextMenu';
import { handlePriceSourceAsRrpOffersSource } from './utils/priceSourceAsRrpOffers';
import NewCustomerDetailsModal from '@/components/modals/NewCustomerDetailsModal';
import SalePriceConfirmModal from '@/components/modals/SalePriceConfirmModal';
import ResearchOverlayPanel from './components/ResearchOverlayPanel';
import TinyModal from '@/components/ui/TinyModal';
import {
  finishRequest,
  fetchRequestDetail,
  updateCustomer,
  saveQuoteDraft,
  deleteRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
  fetchCustomerOfferRules,
} from '@/services/api';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { useResearchOverlay, makeSalePriceBlurHandler } from './hooks/useResearchOverlay';
import { useRefreshCexRowData } from './hooks/useRefreshCexRowData';
import useNosposMirrorRowCardMap from './hooks/useNosposMirrorRowCardMap';
import { mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import {
  openNosposCustomerProfile,
  withExtensionCallTimeout,
  closeNosposAgreementTab,
} from '@/services/extensionClient';
import { getBlockedOfferSlots, revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import {
  resolveOurSalePrice,
  calculateTotalOfferPrice,
  calculateJewelleryOfferTotal,
  calculateNonJewelleryOfferTotal,
  buildFinishPayload,
  isQuoteDraftPayloadSaveable,
  mapApiItemToNegotiationItem,
  normalizeCartItemForNegotiation,
  applyEbayResearchToItem,
  applyCashConvertersResearchToItem,
  getDisplayOffers,
  resolveSuggestedRetailFromResearchStats,
  logCategoryRuleDecision,
} from './utils/negotiationHelpers';
import { EBAY_TOP_LEVEL_CATEGORY } from './constants';
import { SPREADSHEET_TABLE_STYLES } from './spreadsheetTableStyles';

/** NosPos draft agreement items step — matches extension content script snapshot `pageUrl`. */
function isNosposAgreementItemsPageUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'nospos.com') return false;
    return /\/newagreement\/\d+\/items\/?$/i.test(u.pathname || '');
  } catch {
    return false;
  }
}

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
  const jewelleryWorkspaceLinesRef = useRef(jewelleryWorkspaceLines);
  jewelleryWorkspaceLinesRef.current = jewelleryWorkspaceLines;
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
  const [passedTestingSubmitting, setPassedTestingSubmitting] = useState(false);
  const [showJewelleryReferenceModal, setShowJewelleryReferenceModal] = useState(false);
  const [agreementMirrorSessionActive, setAgreementMirrorSessionActive] = useState(false);
  const [agreementMirrorModalState, setAgreementMirrorModalState] = useState(null);
  const [agreementMirrorSnapshot, setAgreementMirrorSnapshot] = useState(null);
  /** From NosPos items-form snapshots; cleared when mirror session ends. */
  const [nosposAgreementItemsParkUrl, setNosposAgreementItemsParkUrl] = useState(null);
  const [agreementMirrorWaitExpired, setAgreementMirrorWaitExpired] = useState(false);
  /** Before opening NoSpos: confirm in-store testing passed, or capture failure reason. */
  const [completeTestingGateModal, setCompleteTestingGateModal] = useState(null);
  const [completeTestingFailureReason, setCompleteTestingFailureReason] = useState('');
  /** Per-row in-store testing outcome for BOOKED_FOR_TESTING flow: 'passed' | 'failed'. */
  const [testingOutcomeByRow, setTestingOutcomeByRow] = useState({});

  // Refs
  const hasInitializedNegotiateRef = useRef(false);
  const completedRef = useRef(false);
  const draftPayloadRef = useRef(null);
  const prevTransactionTypeRef = useRef(transactionType);
  /** Only clear jewellery reference when switching to a different request, not on undefined→id (avoids wiping hydrated scrape). */
  const prevNegotiationRequestIdRef = useRef(null);
  const agreementMirrorSnapshotRef = useRef(null);
  /** Park / Open mirror flow: NosPos tab should be closed if user abandons (modal dismiss, refresh, unmount). */
  const agreementMirrorSessionActiveRef = useRef(false);

  const useVoucherOffers = transactionType === 'store_credit';

  /** NosPos newagreement type: PA = Buy Back, DP = Buy (direct sale + store credit). */
  const nosposOpenOptions = useMemo(
    () => ({ agreementType: transactionType === 'buyback' ? 'PA' : 'DP' }),
    [transactionType]
  );

  const endAgreementMirrorSession = useCallback((opts = {}) => {
    const completed = opts.completed === true;
    const fromTabClosedEvent = opts.fromTabClosedEvent === true;
    agreementMirrorSessionActiveRef.current = false;
    setAgreementMirrorSessionActive(false);
    setAgreementMirrorModalState(null);
    setAgreementMirrorSnapshot(null);
    setNosposAgreementItemsParkUrl(null);
    setAgreementMirrorWaitExpired(false);
    if (!completed && !fromTabClosedEvent) {
      void closeNosposAgreementTab();
    }
  }, []);

  const openAgreementMirrorSession = useCallback(() => {
    agreementMirrorSessionActiveRef.current = true;
    setAgreementMirrorSessionActive(true);
    setAgreementMirrorModalState(null);
    setAgreementMirrorSnapshot(null);
    setNosposAgreementItemsParkUrl(null);
    setAgreementMirrorWaitExpired(false);
  }, []);

  const openAgreementMirrorItemModal = useCallback((itemIndex) => {
    if (!Number.isInteger(itemIndex)) return;
    setAgreementMirrorModalState({ kind: 'item', index: itemIndex });
  }, []);

  const closeAgreementMirrorModal = useCallback(() => {
    setAgreementMirrorModalState(null);
  }, []);

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
    ? 'Research you run in this panel is not saved. Use Complete testing on each line in order (pass or fail), then use View parked agreement when it appears.'
    : null;

  /** Negotiated lines only (matches backend complete-testing eligible items). */
  const eligibleTestingLines = useMemo(
    () => items.filter((i) => !i.isRemoved),
    [items]
  );
  const hasEligibleTestingLines = eligibleTestingLines.length > 0;

  useEffect(() => {
    setTestingOutcomeByRow({});
  }, [actualRequestId, viewRequestStatus]);

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
  }, [parseManualOfferValue]);
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
  /** NosPos mirror cards align with jewellery rows first, then main negotiation rows. */
  const agreementMirrorSourceLines = useMemo(
    () => [
      ...jewelleryNegotiationItems.filter((i) => !i.isRemoved),
      ...mainNegotiationItems.filter((i) => !i.isRemoved),
    ],
    [jewelleryNegotiationItems, mainNegotiationItems]
  );
  const agreementMirrorIndexByItemId = useMemo(() => {
    const map = new Map();
    agreementMirrorSourceLines.forEach((item, index) => {
      if (item?.id != null) map.set(item.id, index);
    });
    return map;
  }, [agreementMirrorSourceLines]);
  const {
    rowStateByIndex: agreementMirrorRowStateByIndex,
    allRowsProcessed: allAgreementMirrorItemsProcessed,
  } = useNosposMirrorRowCardMap(
    agreementMirrorSourceLines,
    agreementMirrorSnapshot,
    testingOutcomeByRow,
    actualRequestId
  );
  const parkAgreementNosposHref = useMemo(() => {
    if (!hasEligibleTestingLines || !allAgreementMirrorItemsProcessed || passedTestingSubmitting) return null;
    return nosposAgreementItemsParkUrl || null;
  }, [
    hasEligibleTestingLines,
    allAgreementMirrorItemsProcessed,
    passedTestingSubmitting,
    nosposAgreementItemsParkUrl,
  ]);
  useEffect(() => {
    setTestingOutcomeByRow((prev) => {
      const maxIndex = Math.max(0, agreementMirrorSourceLines.length - 1);
      let changed = false;
      const next = {};
      for (const [rawIdx, outcome] of Object.entries(prev || {})) {
        const idx = Number(rawIdx);
        if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
          changed = true;
          continue;
        }
        next[idx] = outcome;
      }
      return changed ? next : prev;
    });
  }, [agreementMirrorSourceLines.length]);
  const isAgreementMirrorRowProcessed = useCallback((rowIndex) => {
    return Boolean(agreementMirrorRowStateByIndex.get(rowIndex)?.isProcessed);
  }, [agreementMirrorRowStateByIndex]);
  const showNosposRowActions = researchSandboxBookedView;
  const openNosposAgreementFlow = useCallback(async ({ openItemIndex = null } = {}) => {
    if (!actualRequestId || viewRequestStatus !== 'BOOKED_FOR_TESTING') return false;
    setPassedTestingSubmitting(true);
    try {
      const nid = customerData?.nospos_customer_id;
      if (nid != null && customerData?.id) {
        try {
          const openResult = await withExtensionCallTimeout(
            openNosposCustomerProfile(nid, nosposOpenOptions)
          );
          if (openResult?.warning) {
            showNotification(openResult.warning, 'warning');
          }
          if (openResult?.loginRequired) {
            endAgreementMirrorSession({ fromTabClosedEvent: true });
            showNotification(
              'You must be logged in to NoSpos. Sign in at nospos.com, then use Complete testing again.',
              'error'
            );
            return false;
          } else if (!openResult?.ok) {
            showNotification(openResult?.error || 'Could not open NoSpos.', 'warning');
            return false;
          }
          const openMirror =
            openResult?.ok === true || openResult?.sessionUnchecked === true;
          if (openMirror) {
            openAgreementMirrorSession();
            if (Number.isInteger(openItemIndex)) {
              openAgreementMirrorItemModal(openItemIndex);
            }
            showNotification(
              'NoSpos agreement opened in the background. Use Complete testing on each line in order.',
              'success'
            );
            return true;
          }
        } catch (openErr) {
          showNotification(
            openErr?.message ||
              'Chrome extension is required to open NoSpos, or the request timed out — try again.',
            'warning'
          );
          return false;
        }
      } else {
        showNotification('No NoSpos customer id on file for this request.', 'warning');
        return false;
      }
    } catch (err) {
      console.error('openNosposAgreementFlow:', err);
      showNotification(err?.message || 'Something went wrong opening NoSpos.', 'error');
      return false;
    } finally {
      setPassedTestingSubmitting(false);
    }
    return false;
  }, [
    actualRequestId,
    viewRequestStatus,
    customerData?.id,
    customerData?.nospos_customer_id,
    nosposOpenOptions,
    showNotification,
    openAgreementMirrorSession,
    openAgreementMirrorItemModal,
    endAgreementMirrorSession,
  ]);

  const proceedMirrorAfterInStorePass = useCallback(
    async (rowIndex) => {
      if (!Number.isInteger(rowIndex)) return;
      if (!agreementMirrorSessionActive) {
        await openNosposAgreementFlow({ openItemIndex: rowIndex });
      } else {
        openAgreementMirrorItemModal(rowIndex);
      }
    },
    [agreementMirrorSessionActive, openNosposAgreementFlow, openAgreementMirrorItemModal]
  );

  const requestCompleteTestingGate = useCallback((rowIndex) => {
    if (!Number.isInteger(rowIndex)) return;
    setCompleteTestingFailureReason('');
    setCompleteTestingGateModal({ rowIndex, step: 'pass_question' });
  }, []);

  const getAgreementMirrorRowAction = useCallback((item) => {
    const rowIndex = item?.id != null ? agreementMirrorIndexByItemId.get(item.id) : undefined;
    if (!showNosposRowActions || !Number.isInteger(rowIndex)) return null;
    const rowStateForGate = agreementMirrorRowStateByIndex.get(rowIndex) || { isAdded: false, isComplete: false, outcome: null };
    const rowOutcome = rowStateForGate.outcome;
    const rowAlreadyProcessed = isAgreementMirrorRowProcessed(rowIndex);
    const previousLineProcessed =
      rowIndex === 0 || isAgreementMirrorRowProcessed(rowIndex - 1);
    const canUseThisRow =
      previousLineProcessed || rowAlreadyProcessed || rowStateForGate.isAdded;
    if (!canUseThisRow) {
      return {
        label: 'Complete testing',
        disabled: true,
        tone: 'muted',
        hint: 'Process the line above first (pass or fail) before continuing on this line.',
      };
    }
    // Outcome checks come first — outcome is set regardless of whether NoSpos is open.
    if (rowOutcome === 'failed') {
      return {
        label: 'Testing failed',
        disabled: false,
        tone: 'danger',
        hint: 'This line failed in-store testing. Click to retest and mark as passed when ready.',
        onClick: () => requestCompleteTestingGate(rowIndex),
      };
    }
    const rowState = rowStateForGate;
    if (rowState.isComplete) {
      return {
        label: 'Added to NoSpos',
        disabled: false,
        tone: 'done',
        hint: 'This line is ready in NoSpos. Click to reopen and edit if needed.',
        onClick: () => { void proceedMirrorAfterInStorePass(rowIndex); },
      };
    }
    if (rowOutcome === 'passed') {
      return {
        label: 'Open NoSpos',
        disabled: passedTestingSubmitting,
        tone: 'primary',
        hint: rowState.isAdded
          ? 'Testing passed — finish the required NoSpos fields for this line.'
          : 'Testing passed — open NoSpos to create and complete this line.',
        onClick: () => { void proceedMirrorAfterInStorePass(rowIndex); },
      };
    }
    if (!agreementMirrorSessionActive) {
      return {
        label: 'Complete testing',
        disabled: passedTestingSubmitting,
        tone: 'primary',
        hint: 'Confirm in-store testing passed, then open NoSpos for this line.',
        onClick: () => requestCompleteTestingGate(rowIndex),
      };
    }
    if (!agreementMirrorSnapshot) {
      return {
        label: 'Waiting…',
        disabled: true,
        tone: 'muted',
        hint: 'Waiting for the NoSpos items page to load.',
      };
    }
    return {
      label: 'Complete testing',
      disabled: false,
      tone: 'primary',
      hint: rowState.isAdded
        ? 'Confirm in-store testing passed, then finish required NoSpos fields.'
        : 'Confirm in-store testing passed, then create this line in NoSpos.',
      onClick: () => requestCompleteTestingGate(rowIndex),
    };
  }, [
    showNosposRowActions,
    agreementMirrorIndexByItemId,
    agreementMirrorSessionActive,
    agreementMirrorSnapshot,
    agreementMirrorRowStateByIndex,
    isAgreementMirrorRowProcessed,
    requestCompleteTestingGate,
    proceedMirrorAfterInStorePass,
    passedTestingSubmitting,
  ]);

  // Load customer offer rules once on mount
  useEffect(() => {
    fetchCustomerOfferRules()
      .then((data) => setCustomerOfferRulesData(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'negotiate') {
      prevNegotiationRequestIdRef.current = null;
      return;
    }
    const id =
      actualRequestId != null && actualRequestId !== ''
        ? Number(actualRequestId)
        : null;
    const prev = prevNegotiationRequestIdRef.current;

    if (id == null || Number.isNaN(id)) {
      if (prev != null) setJewelleryReferenceScrape(null);
      prevNegotiationRequestIdRef.current = null;
      return;
    }

    if (prev != null && prev !== id) {
      setJewelleryReferenceScrape(null);
    }
    prevNegotiationRequestIdRef.current = id;
  }, [mode, actualRequestId]);

  // After resume, location.state may be cleared (replaceState) while zustand still holds the full request from fetch.
  useEffect(() => {
    if (mode !== 'negotiate' || actualRequestId == null || actualRequestId === '') return;
    const jr = storeRequest?.jewellery_reference_scrape_json;
    if (!storeRequest || !jr?.sections?.length) return;
    if (Number(storeRequest.request_id) !== Number(actualRequestId)) return;
    setJewelleryReferenceScrape((cur) => {
      if (cur?.sections?.length) return cur;
      return {
        sections: jr.sections,
        scrapedAt: jr.scrapedAt ?? null,
        sourceUrl: jr.sourceUrl ?? null,
      };
    });
  }, [mode, actualRequestId, storeRequest]);

  useEffect(() => {
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'jewellery') return;
    const fromQuote = negotiationJewelleryItemsToWorkspaceLines(jewelleryNegotiationItems);
    setJewelleryWorkspaceLines((prev) => {
      const drafts = prev.filter((l) => !l.request_item_id);
      const quoteIds = new Set(fromQuote.map((l) => l.id));
      const draftsNotInQuote = drafts.filter((d) => !quoteIds.has(d.id));
      return [...fromQuote, ...draftsNotInQuote];
    });
  }, [jewelleryNegotiationItems, headerWorkspaceOpen, headerWorkspaceMode]);

  const normalizeOffersForApi = useCallback((offers) => {
    if (!Array.isArray(offers)) return [];
    return offers.map((o) => ({
      id: o.id,
      title: o.title,
      price: normalizeExplicitSalePrice(o.price),
    }));
  }, []);

  const syncJewelleryWorkspaceLinesToNegotiation = useCallback(
    (lines, changedLineIds = null) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!item.isJewelleryItem || !item.request_item_id) return item;
          const line = lines.find((l) => l.id === item.id);
          if (!line) return item;
          const d = getJewelleryWorkspaceDerivedState(line, useVoucherOffers, customerOfferRulesData?.settings);
          const ourSale =
            d.ourSalePrice != null && d.ourSalePrice > 0 ? d.ourSalePrice : item.ourSalePrice;
          return {
            ...item,
            cashOffers: d.cashOffers,
            voucherOffers: d.voucherOffers,
            offers: d.offers,
            selectedOfferId: d.selectedOfferId,
            manualOffer: d.manualOffer,
            manualOfferUsed: d.manualOfferUsed,
            ourSalePrice: ourSale,
            referenceData: d.referenceData,
            rawData:
              item.rawData != null && typeof item.rawData === 'object'
                ? { ...item.rawData, referenceData: d.referenceData }
                : { referenceData: d.referenceData },
          };
        })
      );

      // Only persist lines that actually changed. When changedLineIds is null
      // (e.g. final flush on workspace close) every line is saved.
      const linesToPersist = changedLineIds
        ? lines.filter((l) => changedLineIds.has(l.id))
        : lines;

      // SQLite (dev) allows only one writer at a time. Parallel update-offer + update-raw
      // for every line (especially on workspace close) causes "database is locked" 500s.
      void (async () => {
        for (const line of linesToPersist) {
          if (!line.request_item_id) continue;
          const d = getJewelleryWorkspaceDerivedState(line, useVoucherOffers, customerOfferRulesData?.settings);
          const itemName = line.itemName || line.categoryLabel || line.variantTitle || null;
          const payload = {
            selected_offer_id: d.selectedOfferId,
            manual_offer_used: d.selectedOfferId === 'manual',
            manual_offer_gbp:
              d.selectedOfferId === 'manual' && d.manualOffer
                ? normalizeExplicitSalePrice(parseFloat(String(d.manualOffer).replace(/[£,]/g, '')))
                : null,
            senior_mgmt_approved_by: line.selectedOfferTierAuthBy || line.manualOfferAuthBy || null,
            our_sale_price_at_negotiation:
              d.ourSalePrice != null && d.ourSalePrice > 0 ? d.ourSalePrice : null,
            cash_offers_json: normalizeOffersForApi(d.cashOffers),
            voucher_offers_json: normalizeOffersForApi(d.voucherOffers),
          };
          await updateRequestItemOffer(line.request_item_id, payload).catch(() => {});
          await updateRequestItemRawData(line.request_item_id, {
            raw_data: {
              referenceData: {
                ...d.referenceData,
                item_name: itemName,
                category_label: line.categoryLabel || d.referenceData?.line_title || null,
              },
              authorisedOfferSlots: Array.isArray(line.authorisedOfferSlots) ? line.authorisedOfferSlots : [],
            },
          }).catch(() => {});
        }
      })();
    },
    [customerOfferRulesData?.settings, normalizeOffersForApi, useVoucherOffers]
  );

  const handleJewelleryWorkspaceLinesChange = useCallback(
    (updater) => {
      setJewelleryWorkspaceLines((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

        // Identify which lines actually changed so we only hit the DB for those.
        const changedIds = new Set();
        for (const nextLine of next) {
          const prevLine = prev.find((l) => l.id === nextLine.id);
          if (!prevLine || prevLine !== nextLine) changedIds.add(nextLine.id);
        }

        if (changedIds.size > 0) {
          Promise.resolve().then(() => syncJewelleryWorkspaceLinesToNegotiation(next, changedIds));
        }
        return next;
      });
    },
    [syncJewelleryWorkspaceLinesToNegotiation]
  );

  const prevJewelleryWorkspaceVisibleRef = useRef(false);
  const prevHeaderWorkspaceOpenRef = useRef(headerWorkspaceOpen);
  useEffect(() => {
    const visible = Boolean(headerWorkspaceOpen && headerWorkspaceMode === 'jewellery');
    const prevVisible = prevJewelleryWorkspaceVisibleRef.current;
    prevJewelleryWorkspaceVisibleRef.current = visible;
    if (prevVisible && !visible && mode === 'negotiate') {
      syncJewelleryWorkspaceLinesToNegotiation(jewelleryWorkspaceLinesRef.current);
    }

    const wasHeaderWorkspaceOpen = prevHeaderWorkspaceOpenRef.current;
    prevHeaderWorkspaceOpenRef.current = headerWorkspaceOpen;
    // Dropping the whole workspace (X): remove draft jewellery rows that were never added via Complete.
    // Switching Jewellery → another tab while the panel stays open keeps drafts until the user closes the workspace.
    if (wasHeaderWorkspaceOpen && !headerWorkspaceOpen && mode === 'negotiate') {
      setJewelleryWorkspaceLines((prev) => prev.filter((l) => l.request_item_id));
    }
  }, [headerWorkspaceOpen, headerWorkspaceMode, mode, syncJewelleryWorkspaceLinesToNegotiation]);

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
          showNotification(`Our RRP must be greater than £0 for item: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }

      const resolvedSalePrice = resolveOurSalePrice(item);
      if (!Number.isFinite(Number(resolvedSalePrice)) || Number(resolvedSalePrice) <= 0) {
        showNotification(`Please set a valid Our RRP above £0 for item: ${item.title || 'Unknown Item'}`, 'error');
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
      customerData,
      jewelleryReferenceScrape
    );

    if (customerData?.isNewCustomer) {
      setPendingFinishPayload(payload);
      setShowNewCustomerDetailsModal(true);
    } else {
      await doFinishRequest(payload);
    }
  }, [
    actualRequestId,
    items,
    targetOffer,
    totalOfferPrice,
    totalExpectation,
    useVoucherOffers,
    customerData,
    jewelleryReferenceScrape,
    doFinishRequest,
    navigate,
    showNotification,
  ]);

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
    useAppStore.getState().resetBuyerWorkspace({ openCustomerModal: true });
    navigate('/buyer');
  }, [navigate]);

  // ─── Item actions ──────────────────────────────────────────────────────

  const handleQuantityChange = useCallback((itemId, newQty) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: newQty } : i));
  }, []);

  const handleSelectOffer = useCallback((itemId, offerId) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        return {
          ...i,
          selectedOfferId: offerId,
          ...revokeManualOfferAuthorisationIfSwitchingAway(i, offerId),
        };
      })
    );
  }, []);

  const markItemSlotAuthorised = useCallback((itemId, slot, approverName) => {
    if (!itemId || !slot) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const authorisedOfferSlots = Array.isArray(it.authorisedOfferSlots) ? [...it.authorisedOfferSlots] : [];
        if (!authorisedOfferSlots.includes(slot)) authorisedOfferSlots.push(slot);
        return {
          ...it,
          authorisedOfferSlots,
          ...(approverName ? { seniorMgmtApprovedBy: approverName } : {}),
        };
      })
    );
  }, []);

  const handleBlockedOfferClick = useCallback((slot, offer, item) => {
    setBlockedOfferModal({ slot, offer, item });
  }, []);

  const handleResearchBlockedOfferClick = useCallback((payload, contextItem) => {
    if (!payload?.slot || !contextItem) return;
    if (typeof payload.afterAuthorise === 'function') {
      setBlockedOfferModal({
        slot: payload.slot,
        offer: payload.offer || null,
        item: contextItem,
        onAuthoriseAction: (approverName) => {
          if (payload.slot === 'manual') {
            markItemSlotAuthorised(contextItem.id, 'manual', approverName);
          }
          payload.afterAuthorise();
        },
      });
      return;
    }
    setBlockedOfferModal({
      slot: payload.slot,
      offer: payload.offer || null,
      item: contextItem,
      onAuthoriseAction: (approverName) => {
        if (payload.slot === 'manual') {
          markItemSlotAuthorised(contextItem.id, 'manual', approverName);
          setItemOfferModal({ item: contextItem, seniorMgmtOverride: approverName });
          return;
        }
        if (typeof payload.selectedOfferIndex !== 'number') return;
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== contextItem.id) return it;
            const offerRows = getDisplayOffers(it, useVoucherOffers);
            const selected = offerRows?.[payload.selectedOfferIndex];
            if (!selected) return it;
            const revokePatch = revokeManualOfferAuthorisationIfSwitchingAway(it, selected.id);
            const baseSlots = Array.isArray(revokePatch.authorisedOfferSlots)
              ? [...revokePatch.authorisedOfferSlots]
              : Array.isArray(it.authorisedOfferSlots)
                ? [...it.authorisedOfferSlots]
                : [];
            if (!baseSlots.includes(payload.slot)) baseSlots.push(payload.slot);
            return {
              ...it,
              ...revokePatch,
              selectedOfferId: selected.id,
              authorisedOfferSlots: baseSlots,
              seniorMgmtApprovedBy: approverName,
            };
          })
        );
      },
    });
  }, [markItemSlotAuthorised, useVoucherOffers]);

  const handleCustomerExpectationChange = useCallback((itemId, value) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, customerExpectation: value } : i));
  }, []);

  const handleOurSalePriceChange = useCallback((itemId, value) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: value } : i));
  }, []);

  const handleOurSalePriceBlur = useCallback(
    makeSalePriceBlurHandler(setItems, normalizeExplicitSalePrice, showNotification),
    [showNotification]
  );

  const handleOurSalePriceFocus = useCallback((itemId, currentValue) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ourSalePriceInput: currentValue } : i));
  }, []);

  const handleRemoveFromNegotiation = useCallback(async (item) => {
    if (item.request_item_id) {
      try {
        await deleteRequestItem(item.request_item_id);
      } catch (err) {
        console.error(err);
        showNotification(err?.message || 'Failed to remove item from quote', 'error');
        return;
      }
      const req = storeRequest;
      if (req?.items?.length) {
        const rid = Number(item.request_item_id);
        if (req.items.some((i) => Number(i.request_item_id) === rid)) {
          setRequest({
            ...req,
            items: req.items.filter((i) => Number(i.request_item_id) !== rid),
          });
        }
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setJewelleryWorkspaceLines((prev) => prev.filter((l) => l.id !== item.id));
    setContextMenu(null);
    showNotification(`"${item.title || 'Item'}" removed from negotiation`, 'info');
  }, [showNotification, storeRequest, setRequest]);

  const handleJewelleryItemNameChange = useCallback((item, value) => {
    const nextName = value ?? '';
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== item.id) return row;
        const nextRef = {
          ...(row.referenceData || {}),
          item_name: nextName,
        };
        return {
          ...row,
          title: nextName || row.referenceData?.category_label || row.referenceData?.line_title || row.title,
          variantName: nextName || row.referenceData?.category_label || row.referenceData?.line_title || row.variantName,
          referenceData: nextRef,
          rawData:
            row.rawData != null && typeof row.rawData === 'object'
              ? { ...row.rawData, referenceData: nextRef }
              : { referenceData: nextRef },
        };
      })
    );
    if (item.request_item_id) {
      const baseRef = item.referenceData || {};
      updateRequestItemRawData(item.request_item_id, {
        raw_data: {
          referenceData: {
            ...baseRef,
            item_name: nextName,
          },
        },
      }).catch(() => {});
    }
  }, []);

  const handleJewelleryWeightChange = useCallback((item, nextWeight) => {
    const cleaned = String(nextWeight ?? '').replace(/[^0-9.]/g, '');
    const workspaceLine = negotiationJewelleryItemToWorkspaceLine(item);
    if (!workspaceLine) return;
    const updatedLine = { ...workspaceLine, weight: cleaned };
    const d = getJewelleryWorkspaceDerivedState(updatedLine, useVoucherOffers, customerOfferRulesData?.settings);
    const ourSale = d.ourSalePrice != null && d.ourSalePrice > 0 ? d.ourSalePrice : item.ourSalePrice;
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== item.id) return row;
        return {
          ...row,
          cashOffers: d.cashOffers,
          voucherOffers: d.voucherOffers,
          offers: d.offers,
          selectedOfferId: d.selectedOfferId,
          manualOffer: d.manualOffer,
          manualOfferUsed: d.manualOfferUsed,
          ourSalePrice: ourSale,
          referenceData: d.referenceData,
          rawData:
            row.rawData != null && typeof row.rawData === 'object'
              ? { ...row.rawData, referenceData: d.referenceData }
              : { referenceData: d.referenceData },
        };
      })
    );
    setJewelleryWorkspaceLines((prev) =>
      prev.map((l) => (l.id === item.id ? { ...l, weight: cleaned } : l))
    );
    if (item.request_item_id) {
      const itemName = updatedLine.itemName || updatedLine.categoryLabel || updatedLine.variantTitle || null;
      updateRequestItemOffer(item.request_item_id, {
        selected_offer_id: d.selectedOfferId,
        manual_offer_used: d.selectedOfferId === 'manual',
        manual_offer_gbp:
          d.selectedOfferId === 'manual' && d.manualOffer
            ? normalizeExplicitSalePrice(parseFloat(String(d.manualOffer).replace(/[£,]/g, '')))
            : null,
        our_sale_price_at_negotiation: ourSale ?? null,
        cash_offers_json: normalizeOffersForApi(d.cashOffers),
        voucher_offers_json: normalizeOffersForApi(d.voucherOffers),
      }).catch(() => {});
      updateRequestItemRawData(item.request_item_id, {
        raw_data: {
          referenceData: {
            ...d.referenceData,
            item_name: itemName,
          },
        },
      }).catch(() => {});
    }
  }, [useVoucherOffers, customerOfferRulesData?.settings, normalizeOffersForApi]);

  const handleAddNegotiationItem = useCallback(async (cartItem, options = {}) => {
    if (!cartItem) return false;
    const { skipSuccessNotification = false } = options;
    try {
      // CeX (and any other) flows may persist the request row before calling onAddToCart — skip a second POST.
      let reqItemId = cartItem.request_item_id;
      if (reqItemId == null || reqItemId === '') {
        const rawDataPayload =
          cartItem.rawData != null && typeof cartItem.rawData === 'object'
            ? cartItem.rawData
            : cartItem.ebayResearchData != null && typeof cartItem.ebayResearchData === 'object'
              ? buildPersistedEbayRawData(cartItem.ebayResearchData, {
                  categoryObject: cartItem.categoryObject,
                  referenceData: cartItem.referenceData,
                  cashOffers: cartItem.cashOffers || [],
                  voucherOffers: cartItem.voucherOffers || [],
                })
            : cartItem.referenceData != null && typeof cartItem.referenceData === 'object'
              ? { referenceData: cartItem.referenceData }
              : null;
        reqItemId = await createOrAppendRequestItem({
          variantId: cartItem.variantId,
          rawData: rawDataPayload,
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
      const normalizedItem = normalizeCartItemForNegotiation(withRequestId, useVoucherOffers);
      logCategoryRuleDecision({
        context: 'builder-or-workspace-item-added',
        item: normalizedItem,
        categoryObject: normalizedItem.categoryObject,
        rule: {
          source: normalizedItem.isCustomCeXItem ? 'cex-reference-rule' : 'builder-precomputed-rule',
          referenceDataPresent: Boolean(normalizedItem.referenceData),
        },
      });
      setItems((prev) => [...prev, normalizedItem]);

      // Keep manual-offer safety flow consistent for builder/workspace adds:
      // trigger the same senior-management and margin dialogs used by row edits.
      if (normalizedItem.selectedOfferId === 'manual') {
        const manualPerUnit = parseManualOfferValue(normalizedItem.manualOffer);
        const ourSalePrice = resolveOurSalePrice(normalizedItem);
        if (Number.isFinite(manualPerUnit) && manualPerUnit > 0 && ourSalePrice && ourSalePrice > 0) {
          if (manualPerUnit > ourSalePrice) {
            setSeniorMgmtModal({ item: normalizedItem, proposedPerUnit: manualPerUnit });
          } else {
            const marginPct = ((ourSalePrice - manualPerUnit) / ourSalePrice) * 100;
            const marginGbp = ourSalePrice - manualPerUnit;
            setMarginResultModal({
              item: normalizedItem,
              offerPerUnit: manualPerUnit,
              ourSalePrice,
              marginPct,
              marginGbp,
              confirmedBy: normalizedItem.seniorMgmtApprovedBy || null,
            });
          }
        }
      }

      if (!skipSuccessNotification) {
        showNotification(`Added "${cartItem.title}" to negotiation`, 'success');
      }
      return true;
    } catch (err) {
      console.error('Failed to add negotiation item:', err);
      showNotification(err?.message || 'Failed to add item', 'error');
      return false;
    }
  }, [createOrAppendRequestItem, parseManualOfferValue, showNotification, useVoucherOffers]);

  const handleWorkspaceBlockedOfferAttempt = useCallback((payload) => {
    if (!payload?.slot) return;
    const { slot, offer = null, item = null } = payload;
    const workspaceModeAtAttempt = headerWorkspaceMode;
    setBlockedOfferModal({
      slot,
      offer,
      item,
      onAuthoriseAction: async (approverName) => {
        if (!item) return;
        const authorisedOfferSlots = Array.from(
          new Set([...(Array.isArray(item.authorisedOfferSlots) ? item.authorisedOfferSlots : []), slot])
        );
        const nextItem = {
          ...item,
          authorisedOfferSlots,
          seniorMgmtApprovedBy: approverName,
        };
        const ok = await handleAddNegotiationItem(nextItem);
        if (ok && (workspaceModeAtAttempt === 'builder' || workspaceModeAtAttempt === 'cex')) {
          useAppStore.getState().requestCloseHeaderWorkspace();
        }
      },
      onCancelAction: () => {
        if (workspaceModeAtAttempt === 'builder') {
          const s = useAppStore.getState();
          s.setHeaderWorkspaceMode?.('builder');
          s.setHeaderWorkspaceOpen?.(true);
        }
      },
    });
  }, [handleAddNegotiationItem, headerWorkspaceMode]);

  const handleAddJewelleryItemsFromWorkspace = useCallback(
    async (draftWorkspaceLines) => {
      if (!Array.isArray(draftWorkspaceLines) || draftWorkspaceLines.length === 0) {
        useAppStore.getState().requestCloseHeaderWorkspace();
        showNotification('Jewellery updates saved.', 'info');
        return;
      }
      for (const line of draftWorkspaceLines) {
        try {
          const cartItem = buildJewelleryNegotiationCartItem(line, useVoucherOffers, customerOfferRulesData?.settings);
          const ok = await handleAddNegotiationItem(cartItem, { skipSuccessNotification: true });
          if (!ok) return;
        } catch (err) {
          console.error(err);
          showNotification(err?.message || 'Failed to add jewellery item', 'error');
          return;
        }
      }
      setJewelleryWorkspaceLines([]);
      useAppStore.getState().requestCloseHeaderWorkspace();
      showNotification(
        `${draftWorkspaceLines.length} jewellery item${draftWorkspaceLines.length !== 1 ? 's' : ''} added to negotiation`,
        'success'
      );
    },
    [customerOfferRulesData?.settings, handleAddNegotiationItem, useVoucherOffers, showNotification]
  );

  const handleRemoveJewelleryWorkspaceRow = useCallback(
    async (line) => {
      if (line.request_item_id) {
        const item = items.find((i) => i.id === line.id);
        if (item) {
          await handleRemoveFromNegotiation(item);
          return;
        }
      }
      setJewelleryWorkspaceLines((prev) => prev.filter((l) => l.id !== line.id));
    },
    [items, handleRemoveFromNegotiation]
  );

  const handleEbayResearchCompleteFromHeader = useCallback(async (data) => {
    if (!data) return;
    const cashOffers = (data.buyOffers || []).map((o, idx) => ({
      id: `ebay-cash_${idx + 1}`,
      title: titleForEbayCcOfferIndex(idx),
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
    const resolved = data.resolvedCategory?.id != null ? data.resolvedCategory : null;
    const categoryObject = resolved ?? EBAY_TOP_LEVEL_CATEGORY;
    const categoryName = categoryObject?.name ?? 'eBay';
    const customItem = {
      id: crypto.randomUUID?.() ?? `neg-ebay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: searchTitle,
      subtitle: 'eBay Research',
      quantity: 1,
      category: categoryName,
      categoryObject,
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

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers,
  });

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

          setViewRequestStatus(status || null);
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
          const jr = data.jewellery_reference_scrape_json;
          setJewelleryReferenceScrape(
            jr?.sections?.length
              ? {
                  sections: jr.sections,
                  scrapedAt: jr.scrapedAt ?? null,
                  sourceUrl: jr.sourceUrl ?? null,
                }
              : null
          );
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
          setRequest(openQuoteRequest);
          const jr = openQuoteRequest.jewellery_reference_scrape_json;
          if (jr?.sections?.length) {
            setJewelleryReferenceScrape({
              sections: jr.sections,
              scrapedAt: jr.scrapedAt ?? null,
              sourceUrl: jr.sourceUrl ?? null,
            });
          }
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
    agreementMirrorSnapshotRef.current = agreementMirrorSnapshot;
  }, [agreementMirrorSnapshot]);

  // Extension: when the NoSpos background window/tab we opened is closed, mirror listing-tab UX.
  useEffect(() => {
    function onNosposProfileTabClosedMessage(event) {
      if (event.source !== window || event.data?.type !== 'NOSPOS_PROFILE_TAB_CLOSED') return;
      endAgreementMirrorSession({ fromTabClosedEvent: true });
      showNotification(
        event.data.message || 'NoSpos window was closed. You can try again when ready.',
        'warning'
      );
    }
    window.addEventListener('message', onNosposProfileTabClosedMessage);
    return () => window.removeEventListener('message', onNosposProfileTabClosedMessage);
  }, [showNotification, endAgreementMirrorSession]);

  // NosPos items form snapshot → mirror modal (while open).
  useEffect(() => {
    function onAgreementItemsSnapshot(event) {
      if (event.source !== window || event.data?.type !== 'NOSPOS_AGREEMENT_ITEMS_SNAPSHOT') return;
      const payload = event.data.payload;
      if (!payload?.cards?.length) return;
      if (!agreementMirrorSessionActiveRef.current) return;
      setAgreementMirrorSnapshot(payload);
      if (payload?.pageUrl && isNosposAgreementItemsPageUrl(payload.pageUrl)) {
        setNosposAgreementItemsParkUrl(payload.pageUrl);
      }
      setAgreementMirrorWaitExpired(false);
    }
    window.addEventListener('message', onAgreementItemsSnapshot);
    return () => window.removeEventListener('message', onAgreementItemsSnapshot);
  }, []);

  useEffect(() => {
    if (!agreementMirrorSessionActive || agreementMirrorSnapshot) return;
    const t = setTimeout(() => {
      if (agreementMirrorSessionActiveRef.current && !agreementMirrorSnapshotRef.current) {
        setAgreementMirrorWaitExpired(true);
        showNotification(
          'The NosPos items step was not detected in time. Restore the minimized NosPos window or try Park / Open in NoSpos again.',
          'warning'
        );
      }
    }, 120000);
    return () => clearTimeout(t);
  }, [agreementMirrorSessionActive, agreementMirrorSnapshot, showNotification]);

  // Full page unload / refresh / bfcache: close NosPos mirror tab (avoid unmount cleanup — Strict Mode).
  useEffect(() => {
    function onPageHide() {
      if (agreementMirrorSessionActiveRef.current) {
        void closeNosposAgreementTab();
        agreementMirrorSessionActiveRef.current = false;
        setAgreementMirrorSessionActive(false);
      }
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const mirrorLocationPathRef = useRef(null);
  useEffect(() => {
    const next = `${location.pathname}${location.search}`;
    if (mirrorLocationPathRef.current === null) {
      mirrorLocationPathRef.current = next;
      return;
    }
    if (mirrorLocationPathRef.current !== next) {
      mirrorLocationPathRef.current = next;
      if (agreementMirrorSessionActiveRef.current) {
        endAgreementMirrorSession();
      }
    }
  }, [location.pathname, location.search, endAgreementMirrorSession]);

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
      const prevOffers = getDisplayOffers(item, prevUseVoucher);
      const newOffers = getDisplayOffers(item, newUseVoucher);
        if (!prevOffers || !newOffers) return item;
        const prevIndex = prevOffers.findIndex(o => o.id === item.selectedOfferId);
        if (prevIndex < 0 || !newOffers[prevIndex]) return item;
        const nextId = newOffers[prevIndex].id;
        return {
          ...item,
          selectedOfferId: nextId,
          ...revokeManualOfferAuthorisationIfSwitchingAway(item, nextId),
        };
    }));
    prevTransactionTypeRef.current = transactionType;
  }, [transactionType, mode]);

  // Build draft payload synchronously during render so it's always fresh for
  // cleanup functions (eliminates the race where an effect-based ref update
  // hasn't run yet when the component unmounts).
  const draftPayload = useMemo(() => {
    if (mode !== 'negotiate' || !actualRequestId) return null;
    const hasJewelleryRef = jewelleryReferenceScrape?.sections?.length > 0;
    if (items.length === 0 && !hasJewelleryRef) return null;
    const total = calculateTotalOfferPrice(items, useVoucherOffers);
    return buildFinishPayload(
      items,
      totalExpectation,
      targetOffer,
      useVoucherOffers,
      total,
      customerData,
      jewelleryReferenceScrape
    );
  }, [
    items,
    totalExpectation,
    targetOffer,
    useVoucherOffers,
    mode,
    actualRequestId,
    customerData,
    jewelleryReferenceScrape,
  ]);

  const handleJewelleryReferenceScrapeResult = useCallback((scrape) => {
    if (!scrape?.sections?.length) return;
    setJewelleryReferenceScrape(scrape);
    setJewelleryWorkspaceLines((prev) => remapJewelleryWorkspaceLines(prev, scrape.sections));
    setItems((prev) =>
      prev.map((i) =>
        i.isJewelleryItem
          ? applyJewelleryScrapeToNegotiationItem(
              i,
              scrape.sections,
              useVoucherOffers,
              customerOfferRulesData?.settings
            )
          : i
      )
    );
  }, [customerOfferRulesData?.settings, useVoucherOffers]);

  draftPayloadRef.current = draftPayload;

  // Debounced auto-save
  useEffect(() => {
    if (!isQuoteDraftPayloadSaveable(draftPayload) || completedRef.current) return;
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
      if (isQuoteDraftPayloadSaveable(payload)) {
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
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{SPREADSHEET_TABLE_STYLES}</style>

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
                    <div className="flex items-baseline gap-1 mt-2">
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
                    <div className="flex items-baseline gap-1 mt-2">
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
                      className={`flex items-baseline gap-1 ${mode === 'negotiate' ? 'cursor-pointer rounded-lg p-2 -mx-2 -mb-2 hover:bg-brand-blue/5 transition-colors group' : ''}`}
                      onClick={mode === 'negotiate' ? () => setShowTargetModal(true) : undefined}
                      role={mode === 'negotiate' ? 'button' : undefined}
                      title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
                    >
                      <span className="font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
                      </span>
                      {mode === 'negotiate' && (
                        <span className="material-symbols-outlined ml-1 text-brand-blue/45 group-hover:text-brand-blue transition-colors align-middle" style={{ fontSize: '1.5rem' }}>edit</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Request ID</p>
                <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>#{actualRequestId || 'N/A'}</p>
                {mode === 'view' && (
                  researchSandboxBookedView ? (
                    <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-800">
                      <span className="material-symbols-outlined text-[12px]">science</span>
                      In-store testing — complete each line in NoSpos in order, then use View parked agreement
                    </p>
                  ) : (
                    <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-red-600">
                      <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                      View Only
                    </p>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Tables: one scroll for jewellery + items; tables grow to full content height */}
          <div className="min-h-0 flex-1 overflow-auto">
            {jewelleryNegotiationItems.length > 0 ? (
              <div
                className="border-b-2 bg-white"
                style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}
              >
                <div
                  className="sticky top-0 z-[5] border-b bg-white px-6 py-3"
                  style={{ borderColor: 'var(--ui-border)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">Jewellery</h3>
                    {mode === 'view' && jewelleryReferenceScrape?.sections?.length ? (
                      <button
                        type="button"
                        onClick={() => setShowJewelleryReferenceModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-blue shadow-sm transition-colors hover:bg-gray-50"
                      >
                        <span className="material-symbols-outlined text-[16px] leading-none">table_view</span>
                        View reference table
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    Workspace-style columns plus manual offer and customer expectation. Grand total includes these lines.
                  </p>
                </div>
                <JewelleryNegotiationSlimTable
                  items={jewelleryNegotiationItems}
                  mode={mode}
                  useVoucherOffers={useVoucherOffers}
                  onSelectOffer={handleSelectOffer}
                  onRowContextMenu={(e, it, zone) =>
                    setContextMenu({ x: e.clientX, y: e.clientY, item: it, zone })
                  }
                  onSetManualOffer={(it) => setItemOfferModal({ item: it })}
                  onCustomerExpectationChange={handleCustomerExpectationChange}
                  onJewelleryItemNameChange={handleJewelleryItemNameChange}
                  onJewelleryWeightChange={handleJewelleryWeightChange}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={(slot, offer, bItem) => handleBlockedOfferClick(slot, offer, bItem)}
                  testingPassedColumnMode={null}
                  showNosposAction={showNosposRowActions}
                  getNosposAction={getAgreementMirrorRowAction}
                />
              </div>
            ) : null}
            <div className="px-6 pt-4 pb-6">
              <div className="pb-2">
                <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">Items</h3>
                <p className="text-[11px] text-gray-600">Phones, CeX, eBay, and other catalogue lines.</p>
              </div>
              <table className="w-full spreadsheet-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-12 text-center">Qty</th>
                    <th className="w-36">Category</th>
                    <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                    <th className="w-24 spreadsheet-th-cex">Sell</th>
                    <th className="w-24 spreadsheet-th-cex">Voucher</th>
                    <th className="w-24 spreadsheet-th-cex">Cash</th>
                    <th className="w-24 spreadsheet-th-offer-tier">1st</th>
                    <th className="w-24 spreadsheet-th-offer-tier">2nd</th>
                    <th className="w-24 spreadsheet-th-offer-tier">3rd</th>
                    <th className="w-24 spreadsheet-th-offer-tier">4th</th>
                    <th className="w-36">Manual</th>
                    <th className="w-32">Customer Expectation</th>
                    <th className="w-24">Our RRP</th>
                    <th className="w-36">eBay Price</th>
                    <th className="w-36">Cash Converters</th>
                    {showNosposRowActions ? <th className="w-40">NoSpos</th> : null}
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {mainNegotiationItems.map((item, index) => (
                    <NegotiationItemRow
                      key={item.id || `main-${index}`}
                      item={item}
                      index={index}
                      mode={mode}
                      allowResearchSandboxInView={researchSandboxBookedView}
                      useVoucherOffers={useVoucherOffers}
                      onQuantityChange={handleQuantityChange}
                      onSelectOffer={handleSelectOffer}
                      onRowContextMenu={(e, it, zone) =>
                        setContextMenu({ x: e.clientX, y: e.clientY, item: it, zone })}
                      onSetManualOffer={(it) => setItemOfferModal({ item: it })}
                      onCustomerExpectationChange={handleCustomerExpectationChange}
                      onOurSalePriceChange={handleOurSalePriceChange}
                      onOurSalePriceBlur={handleOurSalePriceBlur}
                      onOurSalePriceFocus={handleOurSalePriceFocus}
                      onRefreshCeXData={handleRefreshCeXData}
                      onReopenResearch={setResearchItem}
                      onReopenCashConvertersResearch={setCashConvertersResearchItem}
                      blockedOfferSlots={blockedOfferSlots}
                      onBlockedOfferClick={(slot, offer) => handleBlockedOfferClick(slot, offer, item)}
                      testingPassedColumnMode={null}
                      showNosposAction={showNosposRowActions}
                      nosposAction={getAgreementMirrorRowAction(item)}
                    />
                  ))}
                  <tr className="h-10 opacity-50">
                    <td colSpan={(showNosposRowActions ? 16 : 15)}></td>
                  </tr>
                  <tr className="h-10 opacity-50">
                    <td colSpan={(showNosposRowActions ? 16 : 15)}></td>
                  </tr>
                </tbody>
              </table>
            </div>
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
            <div className="space-y-2.5">
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{ color: 'var(--brand-blue)' }}>
                  Jewellery
                </span>
                <span className="text-lg font-black tabular-nums tracking-tight text-right" style={{ color: 'var(--brand-blue)' }}>
                  £{jewelleryOfferTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{ color: 'var(--brand-blue)' }}>
                  Other items
                </span>
                <span className="text-lg font-black tabular-nums tracking-tight text-right" style={{ color: 'var(--brand-blue)' }}>
                  £{otherItemsOfferTotal.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="pt-2 border-t flex justify-between items-end gap-3" style={{ borderColor: 'rgba(20, 69, 132, 0.15)' }}>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>Grand Total</span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Based on selected offers
                </span>
              </div>
              <div className="text-right text-3xl font-black tracking-tighter leading-none shrink-0" style={{ color: 'var(--brand-blue)' }}>
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

            {researchSandboxBookedView ? (
              <>
                {parkAgreementNosposHref ? (
                  <a
                    href={parkAgreementNosposHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Opens your NoSpos draft items page in a new tab"
                    className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] text-center no-underline hover:opacity-95"
                    style={{
                      background: 'var(--brand-orange)',
                      color: 'var(--brand-blue)',
                      boxShadow: hasEligibleTestingLines
                        ? '0 10px 15px -3px rgba(247, 185, 24, 0.3)'
                        : 'none',
                    }}
                  >
                    <span className="material-symbols-outlined text-xl" aria-hidden>
                      task_alt
                    </span>
                    <span className="text-base uppercase tracking-tight">View parked agreement</span>
                    <span className="material-symbols-outlined text-lg opacity-80" aria-hidden>
                      open_in_new
                    </span>
                  </a>
                ) : (
                  <div
                    className={`w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 select-none ${
                      !hasEligibleTestingLines || !allAgreementMirrorItemsProcessed || passedTestingSubmitting
                        ? 'opacity-50 cursor-not-allowed'
                        : 'opacity-50 cursor-default'
                    }`}
                    style={{
                      background: 'var(--brand-orange)',
                      color: 'var(--brand-blue)',
                      boxShadow: hasEligibleTestingLines
                        ? '0 10px 15px -3px rgba(247, 185, 24, 0.3)'
                        : 'none',
                    }}
                    aria-disabled="true"
                    title={
                      !hasEligibleTestingLines || !allAgreementMirrorItemsProcessed
                        ? 'Complete every line first'
                        : passedTestingSubmitting
                          ? undefined
                          : 'Opens when the NoSpos items page URL is available from your session'
                    }
                  >
                    <span className="material-symbols-outlined text-xl" aria-hidden>
                      task_alt
                    </span>
                    <span className="text-base uppercase tracking-tight">
                      {passedTestingSubmitting ? 'Working…' : 'View parked agreement'}
                    </span>
                  </div>
                )}
                {eligibleTestingLines.length === 0 && (
                  <p className="text-[10px] text-center font-medium text-amber-800">
                    This request has no negotiated lines — add offers before booking, or contact support.
                  </p>
                )}
                {hasEligibleTestingLines && !passedTestingSubmitting && !agreementMirrorSessionActive && (
                  <p className="text-[10px] text-center font-medium" style={{ color: 'var(--text-muted)' }}>
                    Use Complete testing on each line in order. View parked agreement appears when every line is processed (passed or failed) and NoSpos has loaded the items page.
                  </p>
                )}
                {hasEligibleTestingLines && agreementMirrorSessionActive && !agreementMirrorSnapshot && (
                  <p className="text-[10px] text-center font-medium" style={{ color: 'var(--text-muted)' }}>
                    Waiting for the NoSpos items page to load.
                  </p>
                )}
                {hasEligibleTestingLines && agreementMirrorSessionActive && agreementMirrorSnapshot && !allAgreementMirrorItemsProcessed && (
                  <p className="text-[10px] text-center font-medium" style={{ color: 'var(--text-muted)' }}>
                    Finish Complete testing on each line that is still open. The next row unlocks when the line above is processed; all lines must be processed before View parked agreement is available.
                  </p>
                )}
                {hasEligibleTestingLines && agreementMirrorSessionActive && allAgreementMirrorItemsProcessed && (
                  <p className="text-[10px] text-center font-medium" style={{ color: 'var(--text-muted)' }}>
                    {parkAgreementNosposHref
                      ? 'Every line is processed. View parked agreement opens your NoSpos items page in a new tab.'
                      : 'Every line is processed. View parked agreement appears once NoSpos sends the items page URL.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <button
                  className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                    mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched) ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)', boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)' }}
                  onClick={mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched) ? undefined : handleFinalizeTransaction}
                  disabled={mode === 'view' || headerWorkspaceOpen || researchItem || cashConvertersResearchItem || (hasTarget && !targetMatched)}
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
              </>
            )}
          </div>
        </aside>

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

      {/* ── Overlays & Modals ── */}

      {contextMenu && (
        <NegotiationRowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          zone={contextMenu.zone}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveFromNegotiation(contextMenu.item)}
          onUseAsRrpOffersSource={() =>
            handlePriceSourceAsRrpOffersSource(contextMenu.item, contextMenu.zone, {
              showNotification,
              setItems,
              useVoucherOffers,
            })}
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
          onApply={(it, perUnit) => applyManualOffer(it, perUnit, itemOfferModal.seniorMgmtOverride ?? null)}
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

      {blockedOfferModal && (
        <BlockedOfferAuthModal
          slot={blockedOfferModal.slot}
          offer={blockedOfferModal.offer}
          item={blockedOfferModal.item}
          customerData={customerData}
          customerOfferRulesData={customerOfferRulesData}
          onAuthorise={(approverName) => {
            const { slot, offer, item: bItem, onAuthoriseAction } = blockedOfferModal;
            if (typeof onAuthoriseAction === 'function') {
              Promise.resolve(onAuthoriseAction(approverName)).finally(() => {
                setBlockedOfferModal(null);
              });
              return;
            }
            if (slot === 'manual') {
              // open the normal manual offer modal so user can enter amount
              if (bItem?.id) markItemSlotAuthorised(bItem.id, 'manual', approverName);
              setItemOfferModal({ item: bItem, seniorMgmtOverride: approverName });
            } else if (offer && bItem) {
              setItems((prev) =>
                prev.map((it) => {
                  if (it.id !== bItem.id) return it;
                  const revokePatch = revokeManualOfferAuthorisationIfSwitchingAway(it, offer.id);
                  const baseSlots = Array.isArray(revokePatch.authorisedOfferSlots)
                    ? [...revokePatch.authorisedOfferSlots]
                    : Array.isArray(it.authorisedOfferSlots)
                      ? [...it.authorisedOfferSlots]
                      : [];
                  if (!baseSlots.includes(slot)) baseSlots.push(slot);
                  return {
                    ...it,
                    ...revokePatch,
                    selectedOfferId: offer.id,
                    seniorMgmtApprovedBy: approverName,
                    authorisedOfferSlots: baseSlots,
                  };
                })
              );
            }
            setBlockedOfferModal(null);
          }}
          onClose={() => {
            if (typeof blockedOfferModal?.onCancelAction === 'function') {
              blockedOfferModal.onCancelAction();
            }
            setBlockedOfferModal(null);
          }}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={true}
        priceLabel="Our RRP"
        useVoucherOffers={useVoucherOffers}
        showNotification={showNotification}
      />

      <NewCustomerDetailsModal
        open={showNewCustomerDetailsModal}
        onClose={() => { setShowNewCustomerDetailsModal(false); setPendingFinishPayload(null); }}
        onSubmit={handleNewCustomerDetailsSubmit}
        initialName={customerData?.name || ""}
      />

      <NosposAgreementMirrorModal
        open={agreementMirrorModalState != null}
        snapshot={agreementMirrorSnapshot}
        loading={agreementMirrorSessionActive && !agreementMirrorSnapshot}
        waitExpired={agreementMirrorWaitExpired}
        requestId={actualRequestId}
        sourceLines={agreementMirrorSourceLines}
        useVoucherOffers={useVoucherOffers}
        selectedIndex={agreementMirrorModalState?.kind === 'item' ? agreementMirrorModalState.index : null}
        autoAddSelectedIfMissing={agreementMirrorModalState?.kind === 'item'}
        testingOutcomeByRow={testingOutcomeByRow}
        onClose={(opts) => {
          if (opts?.completed === true) {
            showNotification('Agreement parked on NoSpos successfully.', 'success');
            endAgreementMirrorSession(opts);
            return;
          }
          closeAgreementMirrorModal();
        }}
      />

      {completeTestingGateModal ? (
        <TinyModal
          title="In-store testing"
          zClass="z-[125]"
          onClose={() => {
            setCompleteTestingGateModal(null);
            setCompleteTestingFailureReason('');
          }}
        >
          {completeTestingGateModal.step === 'pass_question' ? (
            <>
              <p className="text-xs text-slate-600 mb-4">
                Did in-store testing pass for this line? You can only continue to NoSpos if testing passed.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
                  style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                  onClick={() => {
                    const idx = completeTestingGateModal.rowIndex;
                    setTestingOutcomeByRow((prev) => ({ ...prev, [idx]: 'passed' }));
                    setCompleteTestingGateModal(null);
                    void proceedMirrorAfterInStorePass(idx);
                  }}
                >
                  Yes, testing passed
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ background: 'white', color: 'var(--text-muted)', border: '1px solid var(--ui-border)' }}
                  onClick={() =>
                    setCompleteTestingGateModal((m) => (m ? { ...m, step: 'failure_reason' } : m))
                  }
                >
                  No, testing failed
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-600 mb-2">
                What went wrong? (Required — NoSpos will not open until you pass testing on a later attempt.)
              </p>
              <textarea
                className="w-full min-h-[88px] rounded-lg border border-[var(--ui-border)] p-2 text-sm text-[var(--text-main)]"
                value={completeTestingFailureReason}
                onChange={(e) => setCompleteTestingFailureReason(e.target.value)}
                placeholder="Describe the failure…"
              />
              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ background: 'white', color: 'var(--text-muted)', border: '1px solid var(--ui-border)' }}
                  onClick={() =>
                    setCompleteTestingGateModal((m) => (m ? { ...m, step: 'pass_question' } : m))
                  }
                >
                  Back
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                  disabled={!completeTestingFailureReason.trim()}
                  onClick={() => {
                    const idx = completeTestingGateModal.rowIndex;
                    const reason = completeTestingFailureReason.trim();
                    console.info('[CG Suite] In-store testing reported failed', { rowIndex: idx, reason });
                    setTestingOutcomeByRow((prev) => ({ ...prev, [idx]: 'failed' }));
                    const short = reason.length > 140 ? `${reason.slice(0, 140)}…` : reason;
                    showNotification(`Testing failed — recorded: ${short}`, 'warning');
                    setCompleteTestingGateModal(null);
                    setCompleteTestingFailureReason('');
                  }}
                >
                  Submit
                </button>
              </div>
            </>
          )}
        </TinyModal>
      ) : null}

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

      {showJewelleryReferenceModal ? (
        <TinyModal
          title="Jewellery reference table"
          zClass="z-[220]"
          panelClassName="!max-w-5xl !h-[min(92vh,860px)]"
          onClose={() => setShowJewelleryReferenceModal(false)}
        >
          <JewelleryReferencePricesTable
            sections={jewelleryReferenceScrape?.sections || []}
            showLineItems={false}
            defaultOpen={true}
            hideToggle={true}
            title="Reference prices (saved snapshot)"
          />
        </TinyModal>
      ) : null}

    </div>
  );
};

export default Negotiation;
