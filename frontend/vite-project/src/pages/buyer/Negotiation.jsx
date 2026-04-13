import React, { useMemo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import CustomerIntakeModal from '@/components/modals/CustomerIntakeModal.jsx';
import ResearchOverlayPanel from './components/ResearchOverlayPanel';
import NegotiationDocumentHead from './components/negotiation/NegotiationDocumentHead';
import NegotiationTablesSection from './components/negotiation/NegotiationTablesSection';
import NegotiationTotalsFooter from './components/negotiation/NegotiationTotalsFooter';
import CustomerTransactionHeader from './components/CustomerTransactionHeader';
import NegotiationOfferMetricsBar from './components/negotiation/NegotiationOfferMetricsBar';
import NegotiationModalsLayer from './components/negotiation/NegotiationModalsLayer';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { useResearchOverlay } from './hooks/useResearchOverlay';
import { useNegotiationParkAgreement } from './hooks/useNegotiationParkAgreement';
import { useNegotiationJewelleryWorkspaceSync } from './hooks/useNegotiationJewelleryWorkspaceSync';
import { useNegotiationFinalize } from './hooks/useNegotiationFinalize';
import { useNegotiationItemHandlers } from './hooks/useNegotiationItemHandlers';
import { useNegotiationLifecycle } from './hooks/useNegotiationLifecycle';
import { useMarketplaceSearchPrefetch } from './hooks/useMarketplaceSearchPrefetch';
import { getBlockedOfferSlots } from '@/utils/customerOfferRules';
import {
  resolveOurSalePrice,
  calculateTotalOfferPrice,
  calculateJewelleryOfferTotal,
  calculateNonJewelleryOfferTotal,
  applyEbayResearchToItem,
  applyCashConvertersResearchToItem,
  applyEbayResearchCommittedPricingToItem,
  applyCashConvertersResearchCommittedPricingToItem,
  mergeEbayResearchDataIntoItem,
  mergeCashConvertersResearchDataIntoItem,
  resolveOffersSource,
  resolveSuggestedRetailFromResearchStats,
  sumOfferMinMaxForNegotiationItems,
  offerMinMaxFromCexProductData,
  offerMinMaxFromResearchBuyOffers,
  offerMinMaxFromWorkspaceOfferRows,
  isNegotiationJewelleryLine,
  isNegotiationCexWorkspaceLine,
  isNegotiationBuilderWorkspaceLine,
  isNegotiationEbayWorkspaceLine,
  HEADER_EBAY_CUSTOMER_EXPECTATION_KEY,
  HEADER_OTHER_CUSTOMER_EXPECTATION_KEY,
  formatSumLineCustomerExpectations,
} from './utils/negotiationHelpers';
import { NEGOTIATION_ROW_CONTEXT } from './rowContextZones';
import {
  fetchNosposCategories,
  fetchNosposCategoryMappings,
  updateRequestItemOffer,
  updateRequestItemRawData,
  peekNosposCategoriesCache,
  peekNosposMappingsCache,
} from '@/services/api';
import { normalizeExplicitSalePrice, roundOfferPrice, toVoucherOfferPrice } from '@/utils/helpers';
import JewelleryLineDetailsBlockingModal from '@/components/jewellery/JewelleryLineDetailsBlockingModal';
import {
  deriveNegotiationJewelleryWeightUpdate,
  negotiationJewelleryItemToWorkspaceLine,
  negotiationJewelleryItemsToWorkspaceLines,
  negotiationJewelleryLineNeedsWorkspaceDetail,
} from '@/components/jewellery/jewelleryWorkspaceMapping';
import { isNosposJewelleryWeightStockLabel } from '@/pages/buyer/utils/nosposAgreementFirstItemFill';
import {
  fetchMissingRequiredNosposLines,
  buildMergedNosposStockFieldValuesBlob,
  applyNosposStockFieldBlobToNegotiationItems,
} from './utils/negotiationMissingNosposRequired';
import {
  negotiationLineHasMissingRequiredNosposStockFields,
  negotiationLineNosposFieldAiPending,
} from './utils/nosposAgreementFirstItemFill';
import { resolveNosposStockLeafIdForNegotiationLine } from '@/utils/nosposCategoryMappings';

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
  const [targetOffer, setTargetOffer] = useState("");
  /** Draft customer expectation for header eBay / CeX-before-line / keyed by line id in pending map. */
  const [pendingCustomerExpectationByTarget, setPendingCustomerExpectationByTarget] = useState({});
  const [builderWorkspaceLineId, setBuilderWorkspaceLineId] = useState(null);
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
  const [cexPencilRrpSourceModal, setCexPencilRrpSourceModal] = useState(null); // { itemId }
  const [customerOfferRulesData, setCustomerOfferRulesData] = useState(null);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);
  /** BOOKED_FOR_TESTING | COMPLETE | QUOTE | null — used for research sandbox in view mode. */
  const [viewRequestStatus, setViewRequestStatus] = useState(null);
  const [showJewelleryReferenceModal, setShowJewelleryReferenceModal] = useState(false);
  /** Lines missing required NosPos stock fields — blocks book-for-testing until filled (see modal). */
  const [missingRequiredNosposModal, setMissingRequiredNosposModal] = useState(null);
  /** Lines with no resolved NosPos category — blocks book-for-testing until all are set. */
  const [missingNosposCategoryModal, setMissingNosposCategoryModal] = useState(null);
  /** `{ item, currentNosposId }` — NosPos category picker popup state. */
  const [nosposCategoryPickerModal, setNosposCategoryPickerModal] = useState(null);
  /** `{ categories, mappings }` for NosPos linked fields — warmed from session cache when available. */
  const [nosposSchema, setNosposSchema] = useState(() => {
    const cat = peekNosposCategoriesCache();
    const map = peekNosposMappingsCache();
    if (cat != null && map != null) {
      return {
        categories: Array.isArray(cat.results) ? cat.results : [],
        mappings: Array.isArray(map) ? map : [],
      };
    }
    return { categories: null, mappings: null };
  });
  /** `{ item, negotiationIndex }` — spreadsheet editor for required stock fields. */
  const [nosposRequiredFieldsEditor, setNosposRequiredFieldsEditor] = useState(null);
  // Refs
  const hasInitializedNegotiateRef = useRef(false);
  const completedRef = useRef(false);
  const draftPayloadRef = useRef(null);
  const prevTransactionTypeRef = useRef(transactionType);
  /** Only clear jewellery reference when switching to a different request, not on undefined→id (avoids wiping hydrated scrape). */
  const prevNegotiationRequestIdRef = useRef(null);
  const negotiationFooterRef = useRef(null);
  /** Bottom edge of this element → top of header workspace + item research overlay (below customer + metrics). */
  const negotiationWorkspaceOverlayBottomRef = useRef(null);
  const [researchOverlayBottomInsetPx, setResearchOverlayBottomInsetPx] = useState(0);
  /** Live research tier rows while eBay / CC overlay or header eBay workspace is open — drives Offer min/max. */
  const [overlayEbayLiveBuyOffers, setOverlayEbayLiveBuyOffers] = useState(null);
  const [overlayCcLiveBuyOffers, setOverlayCcLiveBuyOffers] = useState(null);
  const [headerEbayLiveBuyOffers, setHeaderEbayLiveBuyOffers] = useState(null);
  /** Live CeX tier rows from header builder while variant/offers are shown — drives Offer min/max (scoped like eBay header). */
  const [headerBuilderLiveOffers, setHeaderBuilderLiveOffers] = useState(null);
  /** Live offer draft (cash, per-unit) from header Other workspace. */
  const [headerOtherLiveCashOffer, setHeaderOtherLiveCashOffer] = useState(null);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catRes, mapRes] = await Promise.all([
          fetchNosposCategories(),
          fetchNosposCategoryMappings(),
        ]);
        if (cancelled) return;
        setNosposSchema({
          categories: Array.isArray(catRes?.results) ? catRes.results : [],
          mappings: Array.isArray(mapRes) ? mapRes : [],
        });
      } catch (e) {
        if (!cancelled) {
          console.error('[Negotiation] NosPos schema load', e);
          setNosposSchema({ categories: [], mappings: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Research overlay (shared hook) ─────────────────────────────────────
  const applyEbay = useCallback(
    (item, state) => applyEbayResearchToItem(item, state, useVoucherOffers),
    [useVoucherOffers]
  );
  const applyCC = useCallback(
    (item, state) => applyCashConvertersResearchToItem(item, state, useVoucherOffers),
    [useVoucherOffers]
  );
  const onResearchPersisted = useCallback((mergedItem) => {
    if (!mergedItem || mergedItem.selectedOfferId !== 'manual') return;
    const manualPerUnit = parseManualOfferValue(mergedItem.manualOffer);
    let rrp = resolveOurSalePrice(mergedItem);
    if ((rrp == null || rrp <= 0) && mergedItem.cashConvertersResearchData?.stats) {
      rrp = resolveSuggestedRetailFromResearchStats(mergedItem.cashConvertersResearchData.stats);
    }
    if (!Number.isFinite(manualPerUnit) || manualPerUnit <= 0 || !Number.isFinite(rrp) || rrp <= 0) return;
    setTimeout(() => {
      if (manualPerUnit > rrp) {
        const cleanedManualItem = {
          ...mergedItem,
          selectedOfferId: null,
          manualOffer: '',
          manualOfferUsed: false,
        };
        setItems((prev) =>
          prev.map((item) => (item.id === mergedItem.id ? { ...item, ...cleanedManualItem } : item))
        );
        showNotification('This is not allowed, enter a new manual offer or cancel.', 'error');
        setSeniorMgmtModal({ item: cleanedManualItem, proposedPerUnit: manualPerUnit });
      } else
        setMarginResultModal({
          item: mergedItem,
          offerPerUnit: manualPerUnit,
          ourSalePrice: rrp,
          marginPct: ((rrp - manualPerUnit) / rrp) * 100,
          marginGbp: rrp - manualPerUnit,
          confirmedBy: mergedItem.seniorMgmtApprovedBy || null,
        });
    }, 0);
  }, [parseManualOfferValue, setItems, setSeniorMgmtModal, setMarginResultModal, showNotification]);
  /** Populated after useNegotiationItemHandlers — avoids TDZ passing notify into useResearchOverlay. */
  const notifyEbayResearchMergedForNosposAiRef = useRef(null);
  const bridgeNotifyEbayResearchMergedForNosposAi = useCallback((merged) => {
    notifyEbayResearchMergedForNosposAiRef.current?.(merged);
  }, []);
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
    onAfterEbayResearchMerge: mode === 'negotiate' ? bridgeNotifyEbayResearchMergedForNosposAi : null,
  });

  useEffect(() => {
    if (!researchItem) setOverlayEbayLiveBuyOffers(null);
  }, [researchItem]);

  useEffect(() => {
    if (!cashConvertersResearchItem) setOverlayCcLiveBuyOffers(null);
  }, [cashConvertersResearchItem]);

  useEffect(() => {
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'ebay') {
      setHeaderEbayLiveBuyOffers(null);
    }
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  useEffect(() => {
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'builder') {
      setHeaderBuilderLiveOffers(null);
    }
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  useEffect(() => {
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'other') {
      setHeaderOtherLiveCashOffer(null);
    }
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  const handleOverlayEbayResearchOffersLive = useCallback(
    (payload) => {
      setOverlayEbayLiveBuyOffers(payload?.buyOffers ?? null);
      const rid = researchItem?.id;
      if (!rid || !payload) return;
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== rid) return i;
          const offersEbay = resolveOffersSource(i) === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
          const rrpEbay = i.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_EBAY;
          if (!offersEbay && !rrpEbay) return i;
          const synthetic = { ...(i.ebayResearchData && typeof i.ebayResearchData === 'object' ? i.ebayResearchData : {}), ...payload };
          const merged = mergeEbayResearchDataIntoItem(i, synthetic);
          return applyEbayResearchCommittedPricingToItem(i, merged, synthetic, useVoucherOffers);
        })
      );
    },
    [researchItem?.id, setItems, useVoucherOffers]
  );

  const handleOverlayCcResearchOffersLive = useCallback(
    (payload) => {
      setOverlayCcLiveBuyOffers(payload?.buyOffers ?? null);
      const rid = cashConvertersResearchItem?.id;
      if (!rid || !payload) return;
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== rid) return i;
          const offersCc = resolveOffersSource(i) === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
          const rrpCc = i.rrpOffersSource === NEGOTIATION_ROW_CONTEXT.PRICE_SOURCE_CASH_CONVERTERS;
          if (!offersCc && !rrpCc) return i;
          const synthetic = {
            ...(i.cashConvertersResearchData && typeof i.cashConvertersResearchData === 'object'
              ? i.cashConvertersResearchData
              : {}),
            ...payload,
          };
          const merged = mergeCashConvertersResearchDataIntoItem(i, synthetic);
          return applyCashConvertersResearchCommittedPricingToItem(i, merged, synthetic, useVoucherOffers);
        })
      );
    },
    [cashConvertersResearchItem?.id, setItems, useVoucherOffers]
  );

  const handleHeaderEbayResearchOffersLive = useCallback((payload) => {
    setHeaderEbayLiveBuyOffers(payload?.buyOffers ?? null);
  }, []);

  const handleHeaderBuilderOffersLive = useCallback((rows) => {
    setHeaderBuilderLiveOffers(Array.isArray(rows) && rows.length > 0 ? rows : null);
  }, []);

  const handleCloseTransientPanels = useCallback(() => {
    setResearchItem(null);
    setCashConvertersResearchItem(null);
    setSalePriceConfirmModal(null);
  }, [setResearchItem, setCashConvertersResearchItem, setSalePriceConfirmModal]);

  const pendingCustomerExpectationRef = useRef({});
  useEffect(() => {
    pendingCustomerExpectationRef.current = pendingCustomerExpectationByTarget;
  }, [pendingCustomerExpectationByTarget]);

  const getPendingCustomerExpectationMap = useCallback(
    () => pendingCustomerExpectationRef.current,
    []
  );

  const consumeCustomerExpectationDraftKeys = useCallback((keys) => {
    if (!keys?.length) return;
    setPendingCustomerExpectationByTarget((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!(headerWorkspaceOpen && headerWorkspaceMode === 'builder')) {
      setBuilderWorkspaceLineId(null);
    }
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  useEffect(() => {
    if (headerWorkspaceOpen && headerWorkspaceMode === 'ebay') return;
    setPendingCustomerExpectationByTarget((prev) => {
      if (!(HEADER_EBAY_CUSTOMER_EXPECTATION_KEY in prev)) return prev;
      const next = { ...prev };
      delete next[HEADER_EBAY_CUSTOMER_EXPECTATION_KEY];
      return next;
    });
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  useEffect(() => {
    if (headerWorkspaceOpen && headerWorkspaceMode === 'other') return;
    setPendingCustomerExpectationByTarget((prev) => {
      if (!(HEADER_OTHER_CUSTOMER_EXPECTATION_KEY in prev)) return prev;
      const next = { ...prev };
      delete next[HEADER_OTHER_CUSTOMER_EXPECTATION_KEY];
      return next;
    });
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

  useEffect(() => {
    if (headerWorkspaceOpen && headerWorkspaceMode === 'cex') return;
    setPendingCustomerExpectationByTarget((prev) => {
      const stale = Object.keys(prev).filter((k) => k.startsWith('__cex__'));
      if (!stale.length) return prev;
      const next = { ...prev };
      for (const k of stale) delete next[k];
      return next;
    });
  }, [headerWorkspaceOpen, headerWorkspaceMode]);

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
  const negotiationJewelleryWorkspaceModalLines = useMemo(
    () => negotiationJewelleryItemsToWorkspaceLines(jewelleryNegotiationItems),
    [jewelleryNegotiationItems]
  );
  const negotiationNeedsJewelleryDetail = useMemo(
    () => jewelleryNegotiationItems.some(negotiationJewelleryLineNeedsWorkspaceDetail),
    [jewelleryNegotiationItems]
  );
  const [negotiationJewelleryDetailsModalOpen, setNegotiationJewelleryDetailsModalOpen] = useState(false);

  useEffect(() => {
    if (negotiationNeedsJewelleryDetail) setNegotiationJewelleryDetailsModalOpen(true);
  }, [negotiationNeedsJewelleryDetail]);

  useLayoutEffect(() => {
    const el = negotiationFooterRef.current;
    if (!el) return;
    const measure = () => setResearchOverlayBottomInsetPx(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nosposRequiredEditorLiveItem = useMemo(() => {
    if (!nosposRequiredFieldsEditor?.item?.id) return null;
    return items.find((it) => it.id === nosposRequiredFieldsEditor.item.id) ?? null;
  }, [items, nosposRequiredFieldsEditor]);

  useEffect(() => {
    if (nosposRequiredFieldsEditor && !nosposRequiredEditorLiveItem) {
      setNosposRequiredFieldsEditor(null);
    }
  }, [nosposRequiredFieldsEditor, nosposRequiredEditorLiveItem]);

  useEffect(() => {
    if (!nosposRequiredFieldsEditor?.item?.id) return;
    const live = items.find((i) => i.id === nosposRequiredFieldsEditor.item.id);
    if (live?.isJewelleryItem === true && negotiationJewelleryLineNeedsWorkspaceDetail(live)) {
      setNosposRequiredFieldsEditor(null);
    }
  }, [items, nosposRequiredFieldsEditor?.item?.id]);

  const handleOpenNosposRequiredFieldsEditor = useCallback(
    (item, negotiationIndex) => {
      if (!item) return;
      const live = items.find((i) => i.id === item.id) ?? item;
      if (negotiationLineNosposFieldAiPending(live)) return;
      if (live.isJewelleryItem === true && negotiationJewelleryLineNeedsWorkspaceDetail(live)) return;
      setNosposRequiredFieldsEditor({ item: live, negotiationIndex });
    },
    [items]
  );

  /** Buying flow: open the stock-fields editor for the first line with missing required values (hidden column + forced completion). */
  useEffect(() => {
    if (mode !== 'negotiate') return;
    if (missingRequiredNosposModal?.length) return;
    const cats = nosposSchema.categories;
    const maps = nosposSchema.mappings ?? [];
    if (!Array.isArray(cats) || cats.length === 0) return;

    const ordered = [...jewelleryNegotiationItems, ...mainNegotiationItems];
    const openId = nosposRequiredFieldsEditor?.item?.id;

    for (const item of ordered) {
      if (item.isRemoved) continue;
      if (!item.request_item_id || String(item.request_item_id).trim() === '') continue;

      const isJewellery = item.isJewelleryItem === true;
      const list = isJewellery ? jewelleryNegotiationItems : mainNegotiationItems;
      const negotiationIndex = list.findIndex((i) => i.id === item.id);
      if (negotiationIndex < 0) continue;

      if (negotiationLineNosposFieldAiPending(item)) continue;

      if (isJewellery && negotiationJewelleryLineNeedsWorkspaceDetail(item)) continue;

      if (
        !negotiationLineHasMissingRequiredNosposStockFields(item, negotiationIndex, {
          useVoucherOffers,
          categoriesResults: cats,
          categoryMappings: maps,
          requestId: actualRequestId,
        })
      ) {
        continue;
      }

      if (openId === item.id) return;
      if (openId && openId !== item.id) return;

      setNosposRequiredFieldsEditor({ item, negotiationIndex });
      return;
    }
  }, [
    mode,
    missingRequiredNosposModal,
    nosposSchema.categories,
    nosposSchema.mappings,
    mainNegotiationItems,
    jewelleryNegotiationItems,
    nosposRequiredFieldsEditor?.item?.id,
    useVoucherOffers,
    actualRequestId,
  ]);

  const handleSaveNosposRequiredFieldsFromModal = useCallback(
    async ({ item, leafNosposId, draftByFieldId, labelByFieldId }) => {
      const reqId = item?.request_item_id;
      if (!reqId) {
        showNotification('Line must be saved on the request before NosPos fields can be stored.', 'error');
        return;
      }
      let jewelleryDerived = null;
      if (item.isJewelleryItem && labelByFieldId && draftByFieldId) {
        for (const [fid, rawVal] of Object.entries(draftByFieldId)) {
          const lab = labelByFieldId[fid];
          if (!isNosposJewelleryWeightStockLabel(lab)) continue;
          jewelleryDerived = deriveNegotiationJewelleryWeightUpdate(
            item,
            rawVal,
            useVoucherOffers,
            customerOfferRulesData?.settings
          );
          break;
        }
      }

      const aiSuggestedNosposStockFieldValues = buildMergedNosposStockFieldValuesBlob(
        item,
        leafNosposId,
        draftByFieldId
      );
      const rawDataPayload = { aiSuggestedNosposStockFieldValues };
      if (jewelleryDerived) {
        const wl = negotiationJewelleryItemToWorkspaceLine(item);
        const itemName = wl?.itemName || wl?.categoryLabel || wl?.variantTitle || null;
        rawDataPayload.referenceData = {
          ...jewelleryDerived.d.referenceData,
          item_name: itemName,
        };
      }

      const result = await updateRequestItemRawData(reqId, { raw_data: rawDataPayload });
      if (!result) {
        showNotification('Could not save NosPos fields — try again or check your connection.', 'error');
        return;
      }
      if (jewelleryDerived) {
        void updateRequestItemOffer(reqId, {
          selected_offer_id: jewelleryDerived.d.selectedOfferId,
          manual_offer_used: jewelleryDerived.d.selectedOfferId === 'manual',
          manual_offer_gbp:
            jewelleryDerived.d.selectedOfferId === 'manual' && jewelleryDerived.d.manualOffer
              ? normalizeExplicitSalePrice(
                  parseFloat(String(jewelleryDerived.d.manualOffer).replace(/[£,]/g, ''))
                )
              : null,
          our_sale_price_at_negotiation: jewelleryDerived.ourSale ?? null,
          cash_offers_json: !Array.isArray(jewelleryDerived.d.cashOffers)
            ? []
            : jewelleryDerived.d.cashOffers.map((o) => ({
                id: o.id,
                title: o.title,
                price: normalizeExplicitSalePrice(o.price),
              })),
          voucher_offers_json: !Array.isArray(jewelleryDerived.d.voucherOffers)
            ? []
            : jewelleryDerived.d.voucherOffers.map((o) => ({
                id: o.id,
                title: o.title,
                price: normalizeExplicitSalePrice(o.price),
              })),
        }).catch(() => {});
      }

      setItems((prev) => {
        let next = applyNosposStockFieldBlobToNegotiationItems(
          prev,
          item.id,
          aiSuggestedNosposStockFieldValues
        );
        if (jewelleryDerived) {
          next = next.map((row) => {
            if (row.id !== item.id) return row;
            return {
              ...row,
              cashOffers: jewelleryDerived.d.cashOffers,
              voucherOffers: jewelleryDerived.d.voucherOffers,
              offers: jewelleryDerived.d.offers,
              selectedOfferId: jewelleryDerived.d.selectedOfferId,
              manualOffer: jewelleryDerived.d.manualOffer,
              manualOfferUsed: jewelleryDerived.d.manualOfferUsed,
              ourSalePrice: jewelleryDerived.ourSale,
              referenceData: jewelleryDerived.d.referenceData,
              rawData:
                row.rawData != null && typeof row.rawData === 'object'
                  ? { ...row.rawData, referenceData: jewelleryDerived.d.referenceData }
                  : { referenceData: jewelleryDerived.d.referenceData },
            };
          });
        }
        return next;
      });
      if (jewelleryDerived) {
        setJewelleryWorkspaceLines((prev) =>
          prev.map((l) => (l.id === item.id ? { ...l, weight: jewelleryDerived.cleaned } : l))
        );
      }
      showNotification('NosPos required fields saved.', 'success');
      setNosposRequiredFieldsEditor(null);
    },
    [
      showNotification,
      setItems,
      setJewelleryWorkspaceLines,
      useVoucherOffers,
      customerOfferRulesData?.settings,
    ]
  );

  const handleSaveNosposRequiredFieldsFromMissingGate = useCallback(
    async ({ item, leafNosposId, draftByFieldId, labelByFieldId }) => {
      const reqId = item?.request_item_id;
      if (!reqId) {
        showNotification('Line must be saved on the request before NosPos fields can be stored.', 'error');
        return;
      }
      let jewelleryDerived = null;
      if (item.isJewelleryItem && labelByFieldId && draftByFieldId) {
        for (const [fid, rawVal] of Object.entries(draftByFieldId)) {
          const lab = labelByFieldId[fid];
          if (!isNosposJewelleryWeightStockLabel(lab)) continue;
          jewelleryDerived = deriveNegotiationJewelleryWeightUpdate(
            item,
            rawVal,
            useVoucherOffers,
            customerOfferRulesData?.settings
          );
          break;
        }
      }

      const aiSuggestedNosposStockFieldValues = buildMergedNosposStockFieldValuesBlob(
        item,
        leafNosposId,
        draftByFieldId
      );
      const rawDataPayload = { aiSuggestedNosposStockFieldValues };
      if (jewelleryDerived) {
        const wl = negotiationJewelleryItemToWorkspaceLine(item);
        const itemName = wl?.itemName || wl?.categoryLabel || wl?.variantTitle || null;
        rawDataPayload.referenceData = {
          ...jewelleryDerived.d.referenceData,
          item_name: itemName,
        };
      }

      const result = await updateRequestItemRawData(reqId, { raw_data: rawDataPayload });
      if (!result) {
        showNotification('Could not save NosPos fields — try again or check your connection.', 'error');
        return;
      }
      if (jewelleryDerived) {
        void updateRequestItemOffer(reqId, {
          selected_offer_id: jewelleryDerived.d.selectedOfferId,
          manual_offer_used: jewelleryDerived.d.selectedOfferId === 'manual',
          manual_offer_gbp:
            jewelleryDerived.d.selectedOfferId === 'manual' && jewelleryDerived.d.manualOffer
              ? normalizeExplicitSalePrice(
                  parseFloat(String(jewelleryDerived.d.manualOffer).replace(/[£,]/g, ''))
                )
              : null,
          our_sale_price_at_negotiation: jewelleryDerived.ourSale ?? null,
          cash_offers_json: !Array.isArray(jewelleryDerived.d.cashOffers)
            ? []
            : jewelleryDerived.d.cashOffers.map((o) => ({
                id: o.id,
                title: o.title,
                price: normalizeExplicitSalePrice(o.price),
              })),
          voucher_offers_json: !Array.isArray(jewelleryDerived.d.voucherOffers)
            ? []
            : jewelleryDerived.d.voucherOffers.map((o) => ({
                id: o.id,
                title: o.title,
                price: normalizeExplicitSalePrice(o.price),
              })),
        }).catch(() => {});
      }

      let nextItems = applyNosposStockFieldBlobToNegotiationItems(
        items,
        item.id,
        aiSuggestedNosposStockFieldValues
      );
      if (jewelleryDerived) {
        nextItems = nextItems.map((row) => {
          if (row.id !== item.id) return row;
          return {
            ...row,
            cashOffers: jewelleryDerived.d.cashOffers,
            voucherOffers: jewelleryDerived.d.voucherOffers,
            offers: jewelleryDerived.d.offers,
            selectedOfferId: jewelleryDerived.d.selectedOfferId,
            manualOffer: jewelleryDerived.d.manualOffer,
            manualOfferUsed: jewelleryDerived.d.manualOfferUsed,
            ourSalePrice: jewelleryDerived.ourSale,
            referenceData: jewelleryDerived.d.referenceData,
            rawData:
              row.rawData != null && typeof row.rawData === 'object'
                ? { ...row.rawData, referenceData: jewelleryDerived.d.referenceData }
                : { referenceData: jewelleryDerived.d.referenceData },
          };
        });
        setJewelleryWorkspaceLines((prev) =>
          prev.map((l) => (l.id === item.id ? { ...l, weight: jewelleryDerived.cleaned } : l))
        );
      }
      setItems(nextItems);
      try {
        const missing = await fetchMissingRequiredNosposLines(nextItems, useVoucherOffers);
        setMissingRequiredNosposModal(missing.length ? missing : null);
      } catch (e) {
        console.error('[CG Suite] refresh missing NosPos after gate save', e);
        showNotification('Saved fields, but could not refresh the checklist. Use Continue — verify fields.', 'warning');
      }
      showNotification('NosPos fields saved for this line.', 'success');
    },
    [
      items,
      useVoucherOffers,
      showNotification,
      setItems,
      setMissingRequiredNosposModal,
      setJewelleryWorkspaceLines,
      customerOfferRulesData?.settings,
    ]
  );

  // ─── NosPos category picker ──────────────────────────────────────────────

  const handleOpenNosposCategoryPicker = useCallback((item) => {
    const currentId = resolveNosposStockLeafIdForNegotiationLine(item, {
      categoryMappings: nosposSchema.mappings ?? [],
      nosposCategoriesResults: nosposSchema.categories ?? [],
    });
    setNosposCategoryPickerModal({ item, currentNosposId: currentId ?? null });
  }, [nosposSchema]);

  const handleNosposCategorySelected = useCallback(
    async (item, category) => {
      if (!item || !category) return;
      const newHint = {
        fullName: category.fullName,
        nosposId: category.nosposId ?? category.nospos_id,
        fromInternalProductCategory: false,
        manuallySelected: true,
      };
      // Update in-memory state immediately
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== item.id) return it;
          const nextRaw =
            it.rawData != null && typeof it.rawData === 'object'
              ? { ...it.rawData, aiSuggestedNosposStockCategory: newHint, aiSuggestedNosposStockFieldValues: null }
              : { aiSuggestedNosposStockCategory: newHint, aiSuggestedNosposStockFieldValues: null };
          return {
            ...it,
            aiSuggestedNosposStockCategory: newHint,
            aiSuggestedNosposStockFieldValues: null,
            rawData: nextRaw,
            ...(it.ebayResearchData != null && typeof it.ebayResearchData === 'object'
              ? { ebayResearchData: { ...it.ebayResearchData, aiSuggestedNosposStockCategory: newHint, aiSuggestedNosposStockFieldValues: null } }
              : {}),
          };
        })
      );
      setNosposCategoryPickerModal(null);
      // Persist to API if the item has been saved
      const reqId = item.request_item_id;
      if (reqId) {
        try {
          await updateRequestItemRawData(reqId, {
            raw_data: { aiSuggestedNosposStockCategory: newHint, aiSuggestedNosposStockFieldValues: null },
          });
          showNotification('NosPos category updated.', 'success');
        } catch (e) {
          console.error('[CG Suite] save NosPos category override', e);
          showNotification('Category updated in session but could not save to server — will persist on finalize.', 'warning');
        }
      }
    },
    [setItems, showNotification]
  );

  const handleOpenCategoryPickerForItem = useCallback(
    (itemId) => {
      const item = items.find((it) => it.id === itemId);
      if (item) handleOpenNosposCategoryPicker(item);
    },
    [items, handleOpenNosposCategoryPicker]
  );

  const {
    parkProgressModal,
    setParkProgressModal,
    parkRetryBusyUi,
    parkExcludedItems,
    persistedNosposAgreementId,
    handleParkFieldPatch,
    handleRetryParkLine,
    handleViewParkedAgreement,
    handleDownloadParkLog,
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
    nosposCategoriesResults: nosposSchema.categories ?? [],
    nosposCategoryMappings: nosposSchema.mappings ?? [],
  });

  const hasTarget = parsedTarget > 0;
  const targetDelta = hasTarget ? totalOfferPrice - parsedTarget : 0;
  const targetMatched = hasTarget && Math.abs(targetDelta) <= 0.005;
  const targetShortfall = hasTarget && totalOfferPrice < parsedTarget ? parsedTarget - totalOfferPrice : 0;
  const targetExcess = hasTarget && totalOfferPrice > parsedTarget ? totalOfferPrice - parsedTarget : 0;

  const { offerMin, offerMax } = useMemo(() => {
    if (researchItem) {
      const live = items.find((i) => i.id === researchItem.id && !i.isRemoved) ?? researchItem;
      if (Array.isArray(overlayEbayLiveBuyOffers) && overlayEbayLiveBuyOffers.length > 0) {
        return offerMinMaxFromResearchBuyOffers(overlayEbayLiveBuyOffers, useVoucherOffers);
      }
      return sumOfferMinMaxForNegotiationItems([live], useVoucherOffers);
    }

    if (cashConvertersResearchItem) {
      const live =
        items.find((i) => i.id === cashConvertersResearchItem.id && !i.isRemoved) ??
        cashConvertersResearchItem;
      if (Array.isArray(overlayCcLiveBuyOffers) && overlayCcLiveBuyOffers.length > 0) {
        return offerMinMaxFromResearchBuyOffers(overlayCcLiveBuyOffers, useVoucherOffers);
      }
      return sumOfferMinMaxForNegotiationItems([live], useVoucherOffers);
    }

    const activeItems = items.filter((i) => !i.isRemoved);

    if (mode === 'negotiate' && headerWorkspaceOpen && headerWorkspaceMode === 'ebay') {
      if (Array.isArray(headerEbayLiveBuyOffers) && headerEbayLiveBuyOffers.length > 0) {
        return offerMinMaxFromResearchBuyOffers(headerEbayLiveBuyOffers, useVoucherOffers);
      }
      if (activeItems.length === 0) return { offerMin: null, offerMax: null };
      const scoped = activeItems.filter(isNegotiationEbayWorkspaceLine);
      return sumOfferMinMaxForNegotiationItems(scoped, useVoucherOffers);
    }

    if (mode === 'negotiate' && headerWorkspaceOpen && headerWorkspaceMode === 'builder') {
      if (Array.isArray(headerBuilderLiveOffers) && headerBuilderLiveOffers.length > 0) {
        return offerMinMaxFromWorkspaceOfferRows(headerBuilderLiveOffers, useVoucherOffers);
      }
      if (builderWorkspaceLineId) {
        const line = activeItems.find((i) => i.id === builderWorkspaceLineId);
        if (line && isNegotiationBuilderWorkspaceLine(line)) {
          return sumOfferMinMaxForNegotiationItems([line], useVoucherOffers);
        }
      }
      return { offerMin: null, offerMax: null };
    }

    if (mode === 'negotiate' && headerWorkspaceOpen && headerWorkspaceMode === 'other') {
      if (!Number.isFinite(headerOtherLiveCashOffer) || headerOtherLiveCashOffer <= 0) {
        return { offerMin: null, offerMax: null };
      }
      const perUnit = useVoucherOffers
        ? toVoucherOfferPrice(headerOtherLiveCashOffer)
        : roundOfferPrice(headerOtherLiveCashOffer);
      return { offerMin: perUnit, offerMax: perUnit };
    }

    if (activeItems.length === 0) return { offerMin: null, offerMax: null };

    let scoped = activeItems;
    if (mode === 'negotiate' && headerWorkspaceOpen) {
      if (headerWorkspaceMode === 'jewellery') {
        scoped = activeItems.filter(isNegotiationJewelleryLine);
      } else if (headerWorkspaceMode === 'cex') {
        const pid = cexProductData?.id;
        if (pid != null && String(pid) !== '') {
          const matching = activeItems.filter(
            (i) =>
              isNegotiationCexWorkspaceLine(i) &&
              String(i.cexSku ?? i.cexProductData?.id ?? '') === String(pid)
          );
          if (matching.length > 0) {
            scoped = matching;
          } else {
            return offerMinMaxFromCexProductData(cexProductData, useVoucherOffers);
          }
        } else {
          scoped = activeItems.filter(isNegotiationCexWorkspaceLine);
        }
      }
    }

    return sumOfferMinMaxForNegotiationItems(scoped, useVoucherOffers);
  }, [
    items,
    useVoucherOffers,
    researchItem,
    cashConvertersResearchItem,
    overlayEbayLiveBuyOffers,
    overlayCcLiveBuyOffers,
    headerEbayLiveBuyOffers,
    headerBuilderLiveOffers,
    builderWorkspaceLineId,
    headerOtherLiveCashOffer,
    mode,
    headerWorkspaceOpen,
    headerWorkspaceMode,
    cexProductData,
  ]);

  const {
    applyManualOffer,
    handleFinalizeTransaction,
    handleMissingNosposCategoryRecheckContinue,
    handleMissingNosposRecheckContinue,
    handleNewCustomerDetailsSubmit,
    handleConfirmNewBuy,
  } = useNegotiationFinalize({
    items,
    targetOffer,
    totalOfferPrice,
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
    setMissingNosposCategoryModal,
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
    handleJewelleryCoinUnitsChange,
    handleAddNegotiationItem,
    handleWorkspaceBlockedOfferAttempt,
    handleAddJewelleryItemsFromWorkspace,
    handleRemoveJewelleryWorkspaceRow,
    handleEbayResearchCompleteFromHeader,
    handleRefreshCeXData,
    handleApplyRrpPriceSource,
    handleApplyOffersPriceSource,
    notifyEbayResearchMergedForNosposAi,
    handleNegotiationBuilderOffersDisplayed,
    handleNegotiationCexProductDisplayed,
    handleCancelCeXPreview,
    handleCancelJewelleryPreview,
  } = useNegotiationItemHandlers({
    mode,
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
    headerWorkspaceOpen,
    jewelleryWorkspaceLines,
    handleAddFromCeX,
    clearCexProduct,
    getPendingCustomerExpectationMap,
    consumeCustomerExpectationDraftKeys,
    nosposCategoriesResults: nosposSchema.categories ?? [],
    nosposCategoryMappings: nosposSchema.mappings ?? [],
    setCexPencilRrpSourceModal: mode === "negotiate" ? setCexPencilRrpSourceModal : null,
  });
  notifyEbayResearchMergedForNosposAiRef.current = notifyEbayResearchMergedForNosposAi;

  const handleJewelleryDetailsModalCommit = useCallback(
    (commits) => {
      for (const { id, itemName, weight, coinUnits } of commits) {
        const item = items.find((i) => i.id === id);
        if (!item?.isJewelleryItem) continue;
        handleJewelleryItemNameChange(item, itemName);
        if (coinUnits !== undefined) handleJewelleryCoinUnitsChange(item, coinUnits);
        else if (weight !== undefined) handleJewelleryWeightChange(item, weight);
      }
    },
    [items, handleJewelleryItemNameChange, handleJewelleryWeightChange, handleJewelleryCoinUnitsChange]
  );

  const stripCustomerExpectationTargetKey = useMemo(() => {
    if (mode !== 'negotiate') return null;
    if (researchItem?.id) return researchItem.id;
    if (cashConvertersResearchItem?.id) return cashConvertersResearchItem.id;
    if (headerWorkspaceOpen && headerWorkspaceMode === 'ebay') {
      return HEADER_EBAY_CUSTOMER_EXPECTATION_KEY;
    }
    if (headerWorkspaceOpen && headerWorkspaceMode === 'cex' && cexProductData?.id != null) {
      const line = items.find(
        (i) =>
          !i.isRemoved &&
          isNegotiationCexWorkspaceLine(i) &&
          String(i.cexSku ?? i.cexProductData?.id ?? '') === String(cexProductData.id)
      );
      return line?.id ?? `__cex__${cexProductData.id}`;
    }
    if (headerWorkspaceOpen && headerWorkspaceMode === 'builder') {
      if (
        builderWorkspaceLineId &&
        items.some((i) => i.id === builderWorkspaceLineId && !i.isRemoved)
      ) {
        return builderWorkspaceLineId;
      }
      const builders = items.filter((i) => !i.isRemoved && isNegotiationBuilderWorkspaceLine(i));
      if (builders.length === 1) return builders[0].id;
      return builderWorkspaceLineId;
    }
    if (headerWorkspaceOpen && headerWorkspaceMode === 'other') {
      return HEADER_OTHER_CUSTOMER_EXPECTATION_KEY;
    }
    return null;
  }, [
    mode,
    researchItem?.id,
    cashConvertersResearchItem?.id,
    headerWorkspaceOpen,
    headerWorkspaceMode,
    cexProductData?.id,
    items,
    builderWorkspaceLineId,
  ]);

  const metricsCustomerExpectationValue = useMemo(() => {
    if (mode === 'view') {
      return formatSumLineCustomerExpectations(items);
    }
    if (researchItem?.id) {
      const row = items.find((i) => i.id === researchItem.id) ?? researchItem;
      return row.customerExpectation ?? '';
    }
    if (cashConvertersResearchItem?.id) {
      const row =
        items.find((i) => i.id === cashConvertersResearchItem.id) ?? cashConvertersResearchItem;
      return row.customerExpectation ?? '';
    }
    const key = stripCustomerExpectationTargetKey;
    if (key) {
      const pend = pendingCustomerExpectationByTarget[key];
      if (pend != null) return pend;
      if (typeof key === 'string' && !key.startsWith('__')) {
        const row = items.find((i) => i.id === key);
        return row?.customerExpectation ?? '';
      }
      return '';
    }
    return formatSumLineCustomerExpectations(items);
  }, [
    mode,
    items,
    researchItem,
    cashConvertersResearchItem,
    stripCustomerExpectationTargetKey,
    pendingCustomerExpectationByTarget,
  ]);

  const handleMetricsCustomerExpectationChange = useCallback(
    (value) => {
      if (mode !== 'negotiate') return;
      if (researchItem?.id) {
        handleCustomerExpectationChange(researchItem.id, value);
        return;
      }
      if (cashConvertersResearchItem?.id) {
        handleCustomerExpectationChange(cashConvertersResearchItem.id, value);
        return;
      }
      const key = stripCustomerExpectationTargetKey;
      if (!key) return;
      if (typeof key === 'string' && !key.startsWith('__')) {
        const rowExists = items.some((i) => i.id === key && !i.isRemoved);
        if (rowExists) {
          handleCustomerExpectationChange(key, value);
          return;
        }
        setPendingCustomerExpectationByTarget((prev) => ({ ...prev, [key]: value }));
        return;
      }
      setPendingCustomerExpectationByTarget((prev) => ({ ...prev, [key]: value }));
    },
    [
      mode,
      researchItem?.id,
      cashConvertersResearchItem?.id,
      stripCustomerExpectationTargetKey,
      handleCustomerExpectationChange,
      items,
    ]
  );

  const handleNegotiationBuilderPreviewWrapped = useCallback(
    async (preview) => {
      if (preview?.id) setBuilderWorkspaceLineId(preview.id);
      await handleNegotiationBuilderOffersDisplayed(preview);
    },
    [handleNegotiationBuilderOffersDisplayed]
  );

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
    setTargetOffer,
    setJewelleryReferenceScrape,
    setCustomerModalOpen,
    items,
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
  useMarketplaceSearchPrefetch(items, setItems);
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
    <div className="flex min-h-0 h-dvh flex-col overflow-hidden bg-ui-bg text-text-main text-sm">
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

      <div className="shrink-0">
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
          onNegotiationBuilderOffersDisplayed:
            mode === 'negotiate' ? handleNegotiationBuilderPreviewWrapped : undefined,
          onNegotiationCexProductDisplayed:
            mode === 'negotiate' ? handleNegotiationCexProductDisplayed : undefined,
          onCancelCeXWorkspace:
            mode === 'negotiate' ? handleCancelCeXPreview : undefined,
          onCancelBuilderWorkspace:
            mode === 'negotiate' ? handleCancelCeXPreview : undefined,
          onCancelJewelleryWorkspace:
            mode === 'negotiate' ? handleCancelJewelleryPreview : undefined,
          jewelleryWorkspaceLines,
          setJewelleryWorkspaceLines: handleJewelleryWorkspaceLinesChange,
          onRemoveJewelleryWorkspaceRow: handleRemoveJewelleryWorkspaceRow,
          jewelleryReferenceScrape,
          onJewelleryReferenceScrapeResult: handleJewelleryReferenceScrapeResult,
          workspaceOverlayBottomRef: negotiationWorkspaceOverlayBottomRef,
          onHeaderEbayResearchOffersLiveChange: handleHeaderEbayResearchOffersLive,
          onNegotiationBuilderOffersLiveChange: handleHeaderBuilderOffersLive,
          onOtherWorkspaceOfferPreviewChange: setHeaderOtherLiveCashOffer,
          onCloseTransientPanels: handleCloseTransientPanels,
          onNewBuy: () => setShowNewBuyConfirm(true),
          nosposCategoriesResults: nosposSchema.categories ?? [],
          nosposCategoryMappings: nosposSchema.mappings ?? [],
          actualRequestId,
        } : null}
      />
      </div>

      <div
        ref={negotiationWorkspaceOverlayBottomRef}
        className="flex shrink-0 flex-col gap-3 bg-brand-blue px-6 py-2"
      >
        <CustomerTransactionHeader
          customer={customerData?.id ? customerData : { name: 'No customer selected' }}
          transactionType={transactionType}
          onTransactionChange={(nextType) => {
            setTransactionType(nextType);
            setStoreTransactionType(nextType);
          }}
          presentation="infoStrip"
          readOnly={mode === 'view'}
          containerClassName="!border-t-0 !bg-transparent !px-0 !py-0"
        />
        <NegotiationOfferMetricsBar
          mode={mode}
          transactionType={transactionType}
          onTransactionChange={(nextType) => {
            setTransactionType(nextType);
            setStoreTransactionType(nextType);
          }}
          customerExpectationValue={metricsCustomerExpectationValue}
          onCustomerExpectationChange={handleMetricsCustomerExpectationChange}
          customerExpectationLocked={mode === 'view' || (mode === 'negotiate' && stripCustomerExpectationTargetKey == null)}
          hideCustomerExpectation={headerWorkspaceOpen && headerWorkspaceMode === 'jewellery'}
          offerMin={offerMin}
          offerMax={offerMax}
          parsedTarget={parsedTarget}
          setShowTargetModal={setShowTargetModal}
          actualRequestId={actualRequestId}
          researchSandboxBookedView={researchSandboxBookedView}
          hasJewelleryReferenceData={Boolean(jewelleryReferenceScrape?.sections?.length)}
          jewelleryReferenceScrapedAt={jewelleryReferenceScrape?.scrapedAt ?? null}
          headerWorkspaceOpen={headerWorkspaceOpen}
          headerWorkspaceMode={headerWorkspaceMode}
          onOpenJewelleryReferenceModal={() => setShowJewelleryReferenceModal(true)}
          className="!bg-transparent !px-0 !py-0"
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <NegotiationTablesSection
            mode={mode}
            actualRequestId={actualRequestId}
            researchSandboxBookedView={researchSandboxBookedView}
            jewelleryNegotiationItems={jewelleryNegotiationItems}
            handleSelectOffer={handleSelectOffer}
            setContextMenu={setContextMenu}
            setItemOfferModal={setItemOfferModal}
            handleCustomerExpectationChange={handleCustomerExpectationChange}
            handleJewelleryItemNameChange={handleJewelleryItemNameChange}
            handleJewelleryWeightChange={handleJewelleryWeightChange}
            handleJewelleryCoinUnitsChange={handleJewelleryCoinUnitsChange}
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
            handleApplyRrpPriceSource={handleApplyRrpPriceSource}
            handleApplyOffersPriceSource={handleApplyOffersPriceSource}
            setResearchItem={setResearchItem}
            setCashConvertersResearchItem={setCashConvertersResearchItem}
            useVoucherOffers={useVoucherOffers}
            nosposCategoriesResults={nosposSchema.categories}
            nosposCategoryMappings={nosposSchema.mappings ?? []}
            onOpenNosposRequiredFieldsEditor={handleOpenNosposRequiredFieldsEditor}
            onOpenNosposCategoryPicker={mode === 'negotiate' ? handleOpenNosposCategoryPicker : undefined}
            hideNosposRequiredColumn={mode === 'negotiate'}
          />
          <ResearchOverlayPanel
            items={items}
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
            reserveRightSidebar={false}
            bottomInsetPx={researchOverlayBottomInsetPx}
            onEbayResearchOffersLiveChange={handleOverlayEbayResearchOffersLive}
            onCashConvertersResearchOffersLiveChange={handleOverlayCcResearchOffersLive}
          />
        </div>
        <NegotiationTotalsFooter
          ref={negotiationFooterRef}
          mode={mode}
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
          persistedNosposAgreementId={persistedNosposAgreementId}
          handleParkAgreementOpenNospos={handleParkAgreementOpenNospos}
          handleViewParkedAgreement={handleViewParkedAgreement}
          handleDownloadParkLog={handleDownloadParkLog}
          headerWorkspaceOpen={headerWorkspaceOpen}
          researchItem={researchItem}
          cashConvertersResearchItem={cashConvertersResearchItem}
          handleFinalizeTransaction={handleFinalizeTransaction}
        />
      </div>

      {mode === 'negotiate' ? (
        <JewelleryLineDetailsBlockingModal
          open={negotiationJewelleryDetailsModalOpen}
          onClose={() => setNegotiationJewelleryDetailsModalOpen(false)}
          lines={negotiationJewelleryWorkspaceModalLines}
          onCommitLines={handleJewelleryDetailsModalCommit}
          showNotification={showNotification}
          zClass="z-[325]"
        />
      ) : null}

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
        cexPencilRrpSourceModal={cexPencilRrpSourceModal}
        setCexPencilRrpSourceModal={setCexPencilRrpSourceModal}
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
        persistedNosposAgreementId={persistedNosposAgreementId}
        handleViewParkedAgreement={handleViewParkedAgreement}
        handleDownloadParkLog={handleDownloadParkLog}
        showJewelleryReferenceModal={showJewelleryReferenceModal}
        setShowJewelleryReferenceModal={setShowJewelleryReferenceModal}
        jewelleryReferenceScrape={jewelleryReferenceScrape}
        missingRequiredNosposModal={missingRequiredNosposModal}
        handleMissingNosposRecheckContinue={handleMissingNosposRecheckContinue}
        missingGateItems={items}
        missingGateNosposCategories={nosposSchema.categories}
        missingGateNosposMappings={nosposSchema.mappings ?? []}
        onSaveMissingGateNosposFields={handleSaveNosposRequiredFieldsFromMissingGate}
        nosposRequiredFieldsEditor={nosposRequiredFieldsEditor}
        nosposRequiredEditorLiveItem={nosposRequiredEditorLiveItem}
        nosposSchemaCategories={nosposSchema.categories}
        nosposSchemaMappings={nosposSchema.mappings ?? []}
        actualRequestId={actualRequestId}
        onCloseNosposRequiredFieldsEditor={() => setNosposRequiredFieldsEditor(null)}
        onSaveNosposRequiredFieldsFromModal={handleSaveNosposRequiredFieldsFromModal}
        nosposRequiredFieldsRequireCompletion={mode === 'negotiate'}
        parkHidePerItemTableRetry={mode === 'view'}
        nosposCategoryPickerModal={nosposCategoryPickerModal}
        onCloseCategoryPicker={() => setNosposCategoryPickerModal(null)}
        onNosposCategorySelected={handleNosposCategorySelected}
        nosposPickerCategories={nosposSchema.categories}
        missingNosposCategoryModal={missingNosposCategoryModal}
        handleMissingNosposCategoryRecheckContinue={handleMissingNosposCategoryRecheckContinue}
        onOpenCategoryPickerForItem={handleOpenCategoryPickerForItem}
      />

    </div>
  );
};

export default Negotiation;
