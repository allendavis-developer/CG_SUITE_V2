import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useNotification } from "@/contexts/NotificationContext";
import { getModuleFeatures } from "../config/moduleFeatures";

import {
  clearLastRepricingResult,
  openNospos,
  openWebEposUploadWithTimeout,
  searchNosposBarcode,
  scrapeNosposStockEditForUpload,
} from "@/services/extensionClient";
import {
  saveRepricingSession,
  updateRepricingSession,
  saveUploadSession,
  updateUploadSession,
  fetchCashGeneratorRetailCategories,
} from "@/services/api";
import { summariseNegotiationItemForAi, runCgStockCategoryAiMatchBackground } from '@/services/aiCategoryPathCascade';
import { getAiSuggestedCgStockCategoryFromItem, mergeCgAiOntoNegotiationRow } from '@/utils/cgCategoryMappings';
import { getCartKey, saveRepricingProgress } from "@/utils/repricingProgress";
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
  negotiationWorkspaceCopy,
  openBarcodePrintTab,
  nosposLookupKeyToOwnerId,
  buildNosposMapsFromNegotiationItems,
} from "./listWorkspaceUtils";
import { useListWorkspaceNegotiationPersistence } from "./useListWorkspaceNegotiationPersistence";
import { useListWorkspaceNegotiationBootstrap } from "./useListWorkspaceNegotiationBootstrap";
import { useListWorkspaceRepricingCompletion } from "./useListWorkspaceRepricingCompletion";
import { ListWorkspaceBarcodeCell } from "./ListWorkspaceBarcodeCell";

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
  const resumingUploadSessionFromNav = location.state?.sessionId != null;

  const [items, setItems] = useState([]);
  const [isQuickRepriceOpen, setIsQuickRepriceOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [barcodes, setBarcodes] = useState({});
  const [barcodeModal, setBarcodeModal] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [nosposLookups, setNosposLookups] = useState({});
  const [nosposResultsPanel, setNosposResultsPanel] = useState(null);

  /** Upload-only: barcode slots while intake modal is open (building queue). */
  const [uploadScanSlotIds, setUploadScanSlotIds] = useState([]);
  /** Ordered slot ids waiting to be assigned to the next table row added (FIFO). */
  const [uploadPendingSlotIds, setUploadPendingSlotIds] = useState([]);
  /** Full-screen barcode intake (new upload only — not when resuming a DB session from reports). */
  const [uploadBarcodeIntakeOpen, setUploadBarcodeIntakeOpen] = useState(
    () => moduleKey === 'upload' && !resumingUploadSessionFromNav
  );
  const [uploadBarcodeIntakeDone, setUploadBarcodeIntakeDone] = useState(false);
  /** Upload workspace: NosPos stock edit scrape result keyed by scan/pending slot id (scraped when user selects or single-match). */
  const [uploadStockDetailsBySlotId, setUploadStockDetailsBySlotId] = useState({});
  const uploadStockScrapeGenBySlotRef = useRef({});

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

  const [cgCategoryRows, setCgCategoryRows] = useState(null);
  const [cgCategoryPickerModal, setCgCategoryPickerModal] = useState(null);

  useEffect(() => {
    if (!useUploadSessions) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchCashGeneratorRetailCategories();
        if (cancelled) return;
        setCgCategoryRows(Array.isArray(d?.rows) ? d.rows : []);
      } catch {
        if (!cancelled) setCgCategoryRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useUploadSessions]);

  const scheduleCgAiForUploadLine = useCallback(
    (item) => {
      const lineId = item?.id;
      if (!lineId || item?.isRemoved) return;
      const catId = item?.categoryObject?.id;
      const isCeXNoInternalLeaf = item?.isCustomCeXItem === true && catId == null;
      if (catId == null && !isCeXNoInternalLeaf) return;
      if (getAiSuggestedCgStockCategoryFromItem(item)) return;
      void (async () => {
        setItems((prev) => prev.map((r) => (r.id === lineId ? { ...r, cgCategoryAiPending: true } : r)));
        try {
          const summary = summariseNegotiationItemForAi(item);
          const cgMatch = await runCgStockCategoryAiMatchBackground({
            itemSummary: summary,
            logTag: `[CG Suite][CgPathMatch][upload][${lineId}]`,
          });
          if (!cgMatch?.cgCategoryId) return;
          const aiSuggestedCgStockCategory = {
            cgCategoryId: Number(cgMatch.cgCategoryId),
            categoryPath: cgMatch.categoryPath,
            pathSegments: cgMatch.pathSegments,
            source: 'upload_workspace_ai',
            savedAt: new Date().toISOString(),
          };
          setItems((prev) =>
            prev.map((r) => (r.id !== lineId ? r : mergeCgAiOntoNegotiationRow(r, aiSuggestedCgStockCategory)))
          );
        } catch (e) {
          console.warn('[CG Suite][CgPathMatch][upload]', e);
        } finally {
          setItems((prev) => prev.map((r) => (r.id === lineId ? { ...r, cgCategoryAiPending: false } : r)));
        }
      })();
    },
    [setItems]
  );

  const bridgeAfterEbayForUploadCg = useCallback(
    (mergedItem) => {
      if (!useUploadSessions || !mergedItem) return;
      scheduleCgAiForUploadLine(mergedItem);
    },
    [useUploadSessions, scheduleCgAiForUploadLine]
  );

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
    onAfterEbayResearchMerge: useUploadSessions ? bridgeAfterEbayForUploadCg : undefined,
  });
  useMarketplaceSearchPrefetch(items, setItems);

  const {
    uploadWebEposReady,
    handleViewWebEposProducts,
    viewWebEposProductsDisabled,
    handleViewWebEposCategories,
    viewWebEposCategoriesDisabled,
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

  const isCreatingSession = useRef(false);
  const [dbSessionId, setDbSessionId] = useState(location.state?.sessionId || null);

  const activeItems = items.filter((i) => !i.isRemoved);
  const scanCartKey =
    useUploadSessions && items.length === 0 && (uploadScanSlotIds.length > 0 || uploadPendingSlotIds.length > 0)
      ? `upload-scan:${[...uploadScanSlotIds, ...uploadPendingSlotIds].join('|')}`
      : '';
  const activeCartKey = scanCartKey || getCartKey(activeItems);

  const { lastHandledCompletionRef } = useListWorkspaceRepricingCompletion({
    activeCartKey,
    dbSessionId,
    useUploadSessions,
    updateWorkspaceSession,
    saveWorkspaceSession,
    copy,
    showNotification,
    setIsRepricingFinished,
    setRepricingJob,
    setCompletedItemsData,
    setUnverifiedModal,
    setAmbiguousBarcodeModal,
    setCompletedBarcodes,
    setCompletedItems,
  });

  useListWorkspaceNegotiationPersistence({
    useUploadSessions,
    copy,
    items,
    barcodes,
    nosposLookups,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadStockDetailsBySlotId,
    dbSessionId,
    setDbSessionId,
    isRepricingFinished,
    isLoading,
    updateWorkspaceSession,
    saveWorkspaceSession,
    readSessionIdFromResponse,
    isCartInitiallyEmptyRef,
    isCreatingSession,
  });

  useListWorkspaceNegotiationBootstrap({
    moduleKey,
    location,
    cartItems,
    resumingUploadSessionFromNav,
    maxBarcodesPerItem,
    saveWorkspaceSession,
    readSessionIdFromResponse,
    setDbSessionId,
    setItems,
    setBarcodes,
    setNosposLookups,
    setUploadScanSlotIds,
    setUploadPendingSlotIds,
    setUploadBarcodeIntakeOpen,
    setUploadBarcodeIntakeDone,
    setUploadStockDetailsBySlotId,
    setBarcodeModal,
    setBarcodeInput,
    setIsLoading,
    isCreatingSession,
  });

  useEffect(() => {
    if (activeCartKey && (Object.keys(barcodes).length > 0 || Object.keys(nosposLookups).length > 0)) {
      saveRepricingProgress(activeCartKey, { barcodes, nosposLookups });
    }
  }, [barcodes, nosposLookups, activeCartKey]);

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
    setBarcodes((prev) => {
      if (!prev[item.id]) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setNosposLookups((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k === `${item.id}_0` || k.startsWith(`${item.id}_`)) delete next[k];
      });
      return next;
    });
    showNotification(copy.removedFromList(item.title), 'info');
  };

  const addItemsWithBarcodePrepopulation = useCallback((newItems) => {
    const { barcodes: newBarcodes, nosposLookups: newLookups } = buildNosposMapsFromNegotiationItems(
      newItems,
      maxBarcodesPerItem
    );
    setItems((prev) => [...prev, ...newItems.map(withDefaultRrpOffersSource)]);
    if (Object.keys(newBarcodes).length > 0) {
      setBarcodes((prev) => ({ ...prev, ...newBarcodes }));
      setNosposLookups((prev) => ({ ...prev, ...newLookups }));
    }
    if (useUploadSessions) {
      newItems.forEach((it) => scheduleCgAiForUploadLine(withDefaultRrpOffersSource(it)));
    }
  }, [maxBarcodesPerItem, useUploadSessions, scheduleCgAiForUploadLine]);

  const handleOpenCgCategoryPicker = useCallback((item) => {
    const hint = getAiSuggestedCgStockCategoryFromItem(item);
    setCgCategoryPickerModal({ item, currentCgCategoryId: hint?.cgCategoryId ?? null });
  }, []);

  const handleCgCategorySelected = useCallback(
    (item, row) => {
      const rid = row?.cgCategoryId ?? row?.cg_category_id;
      if (!item || rid == null) return;
      const aiSuggestedCgStockCategory = {
        cgCategoryId: Number(rid),
        categoryPath: row.categoryPath,
        manuallySelected: true,
        savedAt: new Date().toISOString(),
      };
      setItems((prev) =>
        prev.map((it) => (it.id !== item.id ? it : mergeCgAiOntoNegotiationRow(it, aiSuggestedCgStockCategory)))
      );
      setCgCategoryPickerModal(null);
      showNotification('CG category updated.', 'success');
    },
    [setItems, showNotification]
  );

  const handleAddRepricingItem = useCallback((cartItem, opts = {}) => {
    if (!cartItem) return;

    if (useUploadSessions) {
      if (uploadBarcodeIntakeOpen) {
        showNotification(copy.uploadFinishBarcodeIntakeFirst, 'error');
        return;
      }
      if (uploadPendingSlotIds.length === 0) {
        showNotification(copy.uploadNoBarcodesLeft, 'warning');
        return;
      }
      const slotId = uploadPendingSlotIds[0];
      if (!isItemReadyForRepricing(slotId)) {
        showNotification(copy.uploadScanAllVerified, 'error');
        return;
      }
      const lk = nosposLookups[`${slotId}_0`];
      const typedCodes = barcodes[slotId] || [];
      const stockBarcode = lk?.stockBarcode || typedCodes[0] || '';
      let nosposBarcodes = [];
      if (lk?.status === 'selected' && stockBarcode) {
        nosposBarcodes = [{
          barserial: stockBarcode,
          href: (lk.stockUrl || '').replace(/^https:\/\/nospos\.com/i, '') || '',
          name: lk?.stockName || '',
        }];
      } else if (typedCodes[0]) {
        nosposBarcodes = [{ barserial: typedCodes[0], href: '', name: '' }];
      }

      const newId = cartItem.id || (crypto.randomUUID?.() ?? `upload-item-${Date.now()}`);
      setBarcodes((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      setNosposLookups((prev) => {
        const next = { ...prev };
        delete next[`${slotId}_0`];
        return next;
      });
      {
        const g = (uploadStockScrapeGenBySlotRef.current[slotId] ?? 0) + 1;
        uploadStockScrapeGenBySlotRef.current[slotId] = g;
        setUploadStockDetailsBySlotId((prev) => {
          if (!prev[slotId]) return prev;
          const next = { ...prev };
          delete next[slotId];
          return next;
        });
      }
      setUploadPendingSlotIds((prev) => prev.slice(1));

      const scraped = uploadStockDetailsBySlotId[slotId];
      const uploadNosposStockFromBarcode =
        scraped && !scraped.loading && !scraped.error
          ? {
              costPrice: scraped.costPrice != null && scraped.costPrice !== '' ? String(scraped.costPrice).trim() : '',
              retailPrice:
                scraped.retailPrice != null && scraped.retailPrice !== '' ? String(scraped.retailPrice).trim() : '',
              boughtBy: scraped.boughtBy != null ? String(scraped.boughtBy).trim() : '',
              createdAt: scraped.createdAt != null ? String(scraped.createdAt).trim() : '',
            }
          : null;

      const item = {
        ...cartItem,
        id: newId,
        quantity: cartItem.quantity || 1,
        nosposBarcodes,
        ebayResearchData: cartItem.ebayResearchData || null,
        cashConvertersResearchData: cartItem.cashConvertersResearchData || null,
        cgResearchData: cartItem.cgResearchData || null,
        isRemoved: false,
        ...(uploadNosposStockFromBarcode ? { uploadNosposStockFromBarcode } : {}),
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
      return;
    }

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
  }, [
    addItemsWithBarcodePrepopulation,
    showNotification,
    copy,
    useUploadSessions,
    uploadBarcodeIntakeOpen,
    uploadPendingSlotIds,
    barcodes,
    nosposLookups,
    isItemReadyForRepricing,
    uploadStockDetailsBySlotId,
  ]);

  const handleEbayResearchCompleteFromHeader = useCallback((data) => {
    if (!data) return;
    if (useUploadSessions) {
      if (uploadBarcodeIntakeOpen) {
        showNotification(copy.uploadFinishBarcodeIntakeFirst, 'error');
        return;
      }
      showNotification(copy.uploadNoEbayLines, 'warning');
      return;
    }
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
  }, [addItemsWithBarcodePrepopulation, showNotification, copy, useUploadSessions, uploadBarcodeIntakeOpen]);

  const handleQuickRepriceItems = useCallback((foundItems) => {
    if (useUploadSessions) return;
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
  }, [addItemsWithBarcodePrepopulation, showNotification, copy, useUploadSessions]);

  const completeUploadBarcodeIntake = useCallback(() => {
    if (!useUploadSessions) return;
    if (uploadScanSlotIds.length === 0) {
      showNotification(copy.uploadScanNeedOneLine, 'error');
      return;
    }
    if (uploadScanSlotIds.some((id) => !isItemReadyForRepricing(id))) {
      showNotification(copy.uploadScanAllVerified, 'error');
      return;
    }
    setUploadPendingSlotIds([...uploadScanSlotIds]);
    setUploadScanSlotIds([]);
    setUploadBarcodeIntakeDone(true);
    setUploadBarcodeIntakeOpen(false);
    setBarcodeModal(null);
    setBarcodeInput('');
    setNosposResultsPanel(null);
    showNotification('Add items from the header. Each new line uses the next barcode in order.', 'success');
  }, [useUploadSessions, uploadScanSlotIds, isItemReadyForRepricing, showNotification, copy]);

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

  const uploadBeginLineSyncLockRef = useRef(false);
  const beginUploadScanBarcodeLine = useCallback(() => {
    if (!useUploadSessions) return;
    if (uploadBeginLineSyncLockRef.current) return;
    uploadBeginLineSyncLockRef.current = true;
    const id = crypto.randomUUID?.() ?? `upload-scan-${Date.now()}`;
    setUploadScanSlotIds((prev) => [...prev, id]);
    setBarcodeModal({ item: { id, title: 'New barcode line' } });
    setBarcodeInput('');
    queueMicrotask(() => {
      uploadBeginLineSyncLockRef.current = false;
    });
  }, [useUploadSessions]);

  /** Keep a draft line + composer whenever intake is open and there is nothing to edit yet. */
  useEffect(() => {
    if (!useUploadSessions || !uploadBarcodeIntakeOpen) return;
    if (uploadScanSlotIds.length > 0 || barcodeModal) return;
    beginUploadScanBarcodeLine();
  }, [useUploadSessions, uploadBarcodeIntakeOpen, uploadScanSlotIds.length, barcodeModal, beginUploadScanBarcodeLine]);

  /** When the active intake line becomes NosPos-verified, open the next line automatically (no extra “Add line”). */
  const uploadIntakeEditorReadyBaselineRef = useRef(false);
  useLayoutEffect(() => {
    if (!useUploadSessions || !uploadBarcodeIntakeOpen || !barcodeModal?.item?.id) return;
    const id = barcodeModal.item.id;
    if (!uploadScanSlotIds.includes(id)) return;
    uploadIntakeEditorReadyBaselineRef.current = isItemReadyForRepricing(id);
  }, [
    useUploadSessions,
    uploadBarcodeIntakeOpen,
    barcodeModal?.item?.id,
    uploadScanSlotIds,
    isItemReadyForRepricing,
  ]);

  useEffect(() => {
    if (!useUploadSessions || !uploadBarcodeIntakeOpen || !barcodeModal?.item?.id) return;
    const id = barcodeModal.item.id;
    if (!uploadScanSlotIds.includes(id)) return;
    const ready = isItemReadyForRepricing(id);
    const prev = uploadIntakeEditorReadyBaselineRef.current;
    if (ready && !prev) {
      beginUploadScanBarcodeLine();
    }
    uploadIntakeEditorReadyBaselineRef.current = ready;
  }, [
    useUploadSessions,
    uploadBarcodeIntakeOpen,
    barcodeModal,
    uploadScanSlotIds,
    barcodes,
    nosposLookups,
    isItemReadyForRepricing,
    beginUploadScanBarcodeLine,
  ]);

  const removeUploadScanSlotById = useCallback((slotId) => {
    setUploadScanSlotIds((prev) => prev.filter((x) => x !== slotId));
    setBarcodes((prev) => {
      if (!prev[slotId]) return prev;
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
    setNosposLookups((prev) => {
      const next = { ...prev };
      delete next[`${slotId}_0`];
      return next;
    });
    setNosposResultsPanel((prev) => (prev?.itemId === slotId ? null : prev));
    setBarcodeModal((prev) => (prev?.item?.id === slotId ? null : prev));
    const g = (uploadStockScrapeGenBySlotRef.current[slotId] ?? 0) + 1;
    uploadStockScrapeGenBySlotRef.current[slotId] = g;
    setUploadStockDetailsBySlotId((prev) => {
      if (!prev[slotId]) return prev;
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  }, []);

  const triggerUploadStockScrapeForSlot = useCallback((slotId, stockUrl) => {
    if (!useUploadSessions || !slotId || !stockUrl) return;
    const gen = (uploadStockScrapeGenBySlotRef.current[slotId] ?? 0) + 1;
    uploadStockScrapeGenBySlotRef.current[slotId] = gen;
    setUploadStockDetailsBySlotId((prev) => ({
      ...prev,
      [slotId]: { loading: true, stockUrl },
    }));
    void (async () => {
      try {
        const r = await scrapeNosposStockEditForUpload(stockUrl);
        if (uploadStockScrapeGenBySlotRef.current[slotId] !== gen) return;
        if (r?.ok && r.details) {
          setUploadStockDetailsBySlotId((prev) => ({
            ...prev,
            [slotId]: { loading: false, stockUrl, ...r.details },
          }));
        } else if (r?.loginRequired) {
          setUploadStockDetailsBySlotId((prev) => ({
            ...prev,
            [slotId]: {
              loading: false,
              stockUrl,
              error: 'Sign in to NosPos in Chrome first.',
            },
          }));
        } else {
          setUploadStockDetailsBySlotId((prev) => ({
            ...prev,
            [slotId]: {
              loading: false,
              stockUrl,
              error: r?.error || 'Could not load stock page.',
            },
          }));
        }
      } catch (e) {
        if (uploadStockScrapeGenBySlotRef.current[slotId] !== gen) return;
        setUploadStockDetailsBySlotId((prev) => ({
          ...prev,
          [slotId]: {
            loading: false,
            stockUrl,
            error: e?.message || 'Extension unavailable.',
          },
        }));
      }
    })();
  }, [useUploadSessions]);

  // ── Barcode modal handlers ──────────────────────────────────────────────────
  const runNosposLookup = useCallback((code, barcodeIndex, ownerIdOverride) => {
    const ownerId = ownerIdOverride ?? barcodeModal?.item?.id;
    if (!ownerId) return;
    const lookupKey = `${ownerId}_${barcodeIndex}`;
    if (useUploadSessions) {
      const g = (uploadStockScrapeGenBySlotRef.current[ownerId] ?? 0) + 1;
      uploadStockScrapeGenBySlotRef.current[ownerId] = g;
      setUploadStockDetailsBySlotId((prev) => {
        if (!prev[ownerId]) return prev;
        const next = { ...prev };
        delete next[ownerId];
        return next;
      });
    }
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
          if (useUploadSessions && results[0]?.href) {
            triggerUploadStockScrapeForSlot(ownerId, `https://nospos.com${results[0].href}`);
          }
        } else {
          showNotification(`Found ${results.length} NosPos matches for barcode ${code}. Pick the right one below.`, "info");
          setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'found', results } }));
          setNosposResultsPanel({ itemId: ownerId, barcodeIndex });
        }
      } else {
        showNotification(result?.error || "NosPos lookup failed.", "error");
        setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'error', error: result?.error || 'Search failed' } }));
      }
    }).catch(err => {
      showNotification(err?.message || "NosPos lookup failed.", "error");
      setNosposLookups(prev => ({ ...prev, [lookupKey]: { status: 'error', error: err?.message || 'Extension unavailable' } }));
    });
  }, [barcodeModal, showNotification, useUploadSessions, triggerUploadStockScrapeForSlot]);

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
    if (
      useUploadSessions &&
      items.some((i) => String(i.id) === String(barcodeModal.item.id) && !i.isRemoved)
    ) {
      showNotification(copy.uploadBarcodeReplaceOnly, 'info');
      return;
    }
    setBarcodes((prev) => ({
      ...prev,
      [barcodeModal.item.id]: (prev[barcodeModal.item.id] || []).filter((b) => b !== code),
    }));
  }, [barcodeModal, useUploadSessions, items, showNotification, copy]);

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
    const ownerId = nosposLookupKeyToOwnerId(lookupKey);
    if (ownerId && result?.href) {
      triggerUploadStockScrapeForSlot(ownerId, `https://nospos.com${result.href}`);
    }
  }, [triggerUploadStockScrapeForSlot]);

  const skipNosposLookup = useCallback((lookupKey) => {
    setNosposLookups(prev => ({
      ...prev,
      [lookupKey]: { ...prev[lookupKey], status: 'skipped' }
    }));
  }, []);

  // ── Proceed / retry / new repricing ─────────────────────────────────────────
  const handleProceed = async () => {
    if (useUploadSessions && uploadPendingSlotIds.length > 0) {
      showNotification(copy.uploadPendingBarcodesRemain, 'warning');
      return;
    }
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

  const renderBarcodeCell = useCallback(
    (item) => (
      <ListWorkspaceBarcodeCell
        item={item}
        barcodes={barcodes}
        nosposLookups={nosposLookups}
        useUploadSessions={useUploadSessions}
        maxBarcodesPerItem={maxBarcodesPerItem}
        isItemReadyForRepricing={isItemReadyForRepricing}
        onOpenModal={() => {
          setBarcodeModal({ item });
          setBarcodeInput('');
        }}
      />
    ),
    [barcodes, nosposLookups, isItemReadyForRepricing, maxBarcodesPerItem, useUploadSessions]
  );

  const showWorkspaceLoader = isLoading || (useUploadSessions && !uploadWebEposReady);
  const workspaceLoaderMessage =
    useUploadSessions && !isLoading && !uploadWebEposReady ? copy.startBackground : copy.loadingList;

  const uploadCurrentBarcodeLabel = useMemo(() => {
    if (!useUploadSessions) return '';
    const slotId = uploadPendingSlotIds[0];
    if (!slotId) return '';
    const lk = nosposLookups[`${slotId}_0`];
    const typed = (barcodes[slotId] || [])[0];
    return String(lk?.stockBarcode || typed || '').trim();
  }, [useUploadSessions, uploadPendingSlotIds, barcodes, nosposLookups]);

  /** Strip above table: show cached scrape for the FIFO queue head (scraped when each line was verified, not on Continue). */
  const uploadPendingStockDetails = useMemo(() => {
    if (!useUploadSessions) return null;
    const head = uploadPendingSlotIds[0];
    if (!head) return null;
    return uploadStockDetailsBySlotId[head] ?? null;
  }, [useUploadSessions, uploadPendingSlotIds, uploadStockDetailsBySlotId]);

  return {
    showWorkspaceLoader,
    workspaceLoaderMessage,
    features,
    copy,
    useUploadSessions,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadCurrentBarcodeLabel,
    uploadPendingStockDetails,
    beginUploadScanBarcodeLine,
    removeUploadScanSlotById,
    completeUploadBarcodeIntake,
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
    handleViewWebEposCategories,
    viewWebEposCategoriesDisabled,
    openBarcodePrintTab,
    cgCategoryRows,
    cgCategoryPickerModal,
    setCgCategoryPickerModal,
    handleOpenCgCategoryPicker,
    handleCgCategorySelected,
  };
}
