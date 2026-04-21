import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useNotification } from "@/contexts/NotificationContext";
import { getModuleFeatures } from "../config/moduleFeatures";

import {
  clearLastRepricingResult,
  openNospos,
  openWebEposProductCreateForUploadWithTimeout,
  openWebEposUploadWithTimeout,
  searchNosposBarcode,
  scrapeNosposStockEditForUpload,
  scrapeWebEposEditPageForAudit,
  editWebEposProductsForAuditWithTimeout,
} from "@/services/extensionClient";
import {
  saveRepricingSession,
  updateRepricingSession,
  saveUploadSession,
  updateUploadSession,
  fetchUploadSessionDetail,
  fetchCashGeneratorRetailCategories,
  fetchProductCategories,
  fetchAllCategoriesFlat,
} from "@/services/api";
import {
  reverseLookupWebEposCategory,
  cgCategoryObjectToWebEposLabels,
} from "@/utils/webeposCategoryReverseLookup";
import {
  summariseNegotiationItemForAi,
  runCgStockCategoryAiMatchBackground,
  runNosposStockCategoryAiMatchBackground,
} from '@/services/aiCategoryPathCascade';
import {
  getAiSuggestedCgStockCategoryFromItem,
  mergeCgAiOntoNegotiationRow,
  clearCgAiSuggestionFromNegotiationRow,
} from '@/utils/cgCategoryMappings';
import { mergeNosposAiOntoNegotiationRow } from '@/utils/nosposCategoryMappings';
import { getCartKey, saveRepricingProgress, clearRepricingProgress } from "@/utils/repricingProgress";
import {
  getEditableSalePriceState,
  resolveRepricingSalePrice,
  resolveUploadPipelineSalePrice,
} from "../utils/repricingDisplay";
import useAppStore from '@/store/useAppStore';
import { normalizeExplicitSalePrice, formatOfferPrice, roundSalePrice } from '@/utils/helpers';
import {
  withDefaultRrpOffersSource,
  withUploadListRrpSourceDefaults,
  applySoleRrpSourceToUploadRow,
  logCategoryRuleDecision,
  applyRrpOnlyFromPriceSource,
  buildUploadBarcodeQueuePlaceholderItem,
  applyUploadBarcodeIntakeSnapshotToRow,
  mergeCatalogIntoUploadQueueRow,
  uploadNosposStockSnapshotFromScrape,
  mergeUploadNosposStockFieldLevel,
  resolvePersistedCexRrp,
  filterProductCategoriesForBuilderTopHeaders,
  resolveUploadTableItemName,
} from '../utils/negotiationHelpers';
import {
  EBAY_TOP_LEVEL_CATEGORY,
  CASH_CONVERTERS_TOP_LEVEL_CATEGORY,
  CASH_GENERATOR_TOP_LEVEL_CATEGORY,
} from '../constants';
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
  uploadPendingSlotIdsFromItems,
  UPLOAD_BARCODE_WORKSPACE_VERSION,
} from "./listWorkspaceUtils";
import {
  buildWebEposProductCreatePayloadFromUploadRow,
  mergeUploadSessionItemIdsFromApiLines,
} from "../utils/webEposProductCreatePayload";
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

  const uploadHubSkipInitial =
    moduleKey !== "upload" ||
    resumingUploadSessionFromNav ||
    (Array.isArray(cartItems) && cartItems.length > 0) ||
    location.state?.uploadBarcodeWorkspace?.version === UPLOAD_BARCODE_WORKSPACE_VERSION ||
    (Array.isArray(location.state?.uploadPendingSlotIds) && location.state.uploadPendingSlotIds.length > 0) ||
    (Array.isArray(location.state?.uploadScanSlotIds) && location.state.uploadScanSlotIds.length > 0);

  const [uploadMainFlowStarted, setUploadMainFlowStarted] = useState(() => uploadHubSkipInitial);

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
  /** Full-screen barcode intake (new upload only — not when resuming a DB session from reports). */
  const [uploadBarcodeIntakeOpen, setUploadBarcodeIntakeOpen] = useState(
    () => moduleKey === 'upload' && !resumingUploadSessionFromNav
  );
  const [uploadBarcodeIntakeDone, setUploadBarcodeIntakeDone] = useState(false);
  /** Upload workspace: NosPos stock edit scrape result keyed by scan/pending slot id (scraped when user selects or single-match). */
  const [uploadStockDetailsBySlotId, setUploadStockDetailsBySlotId] = useState({});
  const uploadStockScrapeGenBySlotRef = useRef({});

  /** Upload audit mode: buyer is editing existing Web EPOS products, not creating new ones. */
  const [uploadAuditMode, setUploadAuditMode] = useState(false);
  /** Per-slot Web EPOS edit-page scrape: { productHref, loading, originalPrice, originalName, categoryLevels, derivedCategoryObject, error }. */
  const [webeposAuditDetailsBySlotId, setWebeposAuditDetailsBySlotId] = useState({});
  /** Map<extractedBarcode, { productHref, productName, price, ... }> — seeded from audit entry hub. */
  const auditRowsByBarcodeRef = useRef({});
  /** Queue of remaining audit barcodes to process sequentially (shared with beginUploadScanBarcodeLine). */
  const auditQueueRef = useRef([]);
  /** Cached /all-categories/ flat rows, used for Web EPOS → CG reverse mapping. */
  const allCategoriesFlatRef = useRef(null);
  const webeposAuditScrapeGenBySlotRef = useRef({});
  /** Wired after {@link useListWorkspaceNegotiationPersistence} so CG/NosPos AI can flush draft to DB immediately. */
  const flushNegotiationSaveRef = useRef(null);

  const [completedBarcodes, setCompletedBarcodes] = useState({});
  const [completedItems, setCompletedItems] = useState([]);

  const [showNewRepricingConfirm, setShowNewRepricingConfirm] = useState(false);

  const stripResearchCompletionOnlyKeys = useCallback((state) => {
    if (!state || typeof state !== 'object') return state;
    const { uploadRrpOverridePerUnit: _u, ...rest } = state;
    return rest;
  }, []);

  const applyEbayRepriceResearch = useCallback((item, state) => ({
    ...item,
    ebayResearchData: stripResearchCompletionOnlyKeys(state),
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), [stripResearchCompletionOnlyKeys]);
  const applyCCRepriceResearch = useCallback((item, state) => ({
    ...item,
    cashConvertersResearchData: stripResearchCompletionOnlyKeys(state),
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), [stripResearchCompletionOnlyKeys]);
  const applyCGRepriceResearch = useCallback((item, state) => ({
    ...item,
    cgResearchData: stripResearchCompletionOnlyKeys(state),
    ...(state?.resolvedCategory ? { categoryObject: state.resolvedCategory } : {}),
  }), [stripResearchCompletionOnlyKeys]);

  const [cgCategoryRows, setCgCategoryRows] = useState(null);
  const [cgCategoryPickerModal, setCgCategoryPickerModal] = useState(null);
  /** Same tree as AppHeader builder tabs — for upload row context menu “Get data using database”. */
  const [uploadProductCategoriesRaw, setUploadProductCategoriesRaw] = useState([]);

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

  useEffect(() => {
    if (!useUploadSessions) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProductCategories();
        if (!cancelled) setUploadProductCategoriesRaw(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setUploadProductCategoriesRaw([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useUploadSessions]);

  const uploadBuilderTopCategories = useMemo(
    () => filterProductCategoriesForBuilderTopHeaders(uploadProductCategoriesRaw),
    [uploadProductCategoriesRaw]
  );

  const scheduleCgAiForUploadLine = useCallback(
    (item, opts = {}) => {
      const force = opts.force === true;
      const lineId = item?.id;
      if (!lineId || item?.isRemoved) return;
      const catId = item?.categoryObject?.id;
      const isCeXNoInternalLeaf = item?.isCustomCeXItem === true && catId == null;
      const hasCexSku = item?.cexSku != null && String(item.cexSku).trim() !== '';
      const hasCexRefRrp = resolvePersistedCexRrp(item) != null;
      if (catId == null && !isCeXNoInternalLeaf && !hasCexSku && !hasCexRefRrp) return;
      if (!force && getAiSuggestedCgStockCategoryFromItem(item)) return;
      void (async () => {
        let mergedCgToSession = false;
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
          mergedCgToSession = true;
        } catch (e) {
          console.warn('[CG Suite][CgPathMatch][upload]', e);
        } finally {
          setItems((prev) => prev.map((r) => (r.id === lineId ? { ...r, cgCategoryAiPending: false } : r)));
          if (mergedCgToSession && useUploadSessions) {
            setTimeout(() => flushNegotiationSaveRef.current?.(), 0);
          }
        }
      })();
    },
    [setItems, useUploadSessions]
  );

  const runUploadCategoryAndCgAfterValidRrp = useCallback(
    (item) => {
      if (!useUploadSessions || !item?.id || item.isRemoved) return;
      const rrp = resolveUploadPipelineSalePrice(item);
      if (rrp == null || !Number.isFinite(Number(rrp)) || Number(rrp) <= 0) return;

      const lineId = item.id;
      const internalCategoryId =
        item.isCustomCeXItem === true && item.categoryObject?.id != null
          ? Number(item.categoryObject.id)
          : null;

      void (async () => {
        let merged = item;
        if (internalCategoryId != null && Number.isFinite(internalCategoryId)) {
          try {
            const summary = summariseNegotiationItemForAi(item);
            const match = await runNosposStockCategoryAiMatchBackground({
              internalCategoryId,
              itemSummary: summary,
              logTag: `[CG Suite][NosposPathMatch][upload-rrp][${lineId}]`,
            });
            if (match?.nosposId) {
              const hint = {
                nosposId: Number(match.nosposId),
                fullName: match.fullName || '',
                pathSegments: match.pathSegments,
                fromInternalProductCategory: true,
                manuallySelected: false,
                savedAt: new Date().toISOString(),
              };
              merged = mergeNosposAiOntoNegotiationRow(item, hint, null);
              setItems((prev) =>
                prev.map((r) => (r.id === lineId ? mergeNosposAiOntoNegotiationRow(r, hint, null) : r))
              );
              setTimeout(() => flushNegotiationSaveRef.current?.(), 0);
            }
          } catch (e) {
            console.warn('[CG Suite][NosposPathMatch][upload-rrp]', e);
          }
        }
        const forCg = clearCgAiSuggestionFromNegotiationRow(merged);
        scheduleCgAiForUploadLine(forCg, { force: true });
      })();
    },
    [useUploadSessions, setItems, scheduleCgAiForUploadLine]
  );

  const onAfterResearchMergeForUpload = useCallback(
    (mergedItem) => setTimeout(() => runUploadCategoryAndCgAfterValidRrp(mergedItem), 0),
    [runUploadCategoryAndCgAfterValidRrp]
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
    resolveSalePrice: resolveUploadPipelineSalePrice,
    onAfterResearchMerge: useUploadSessions ? onAfterResearchMergeForUpload : undefined,
  });
  useMarketplaceSearchPrefetch(items, setItems);

  const {
    uploadWebEposReady,
    webEposProductsSnapshot,
    webEposProductsScrapeLoading,
    webEposProductsScrapeError,
    bumpWebEposScrape,
  } = useWebEposUploadWorkspace({
    /** Fresh upload only: opening from upload report / session resume skips Web EPOS gate + product scrape. */
    enabled: useUploadSessions && !resumingUploadSessionFromNav,
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
  /** After Web EPOS product-create batch succeeds — drives “Restart in workspace” sidebar vs NosPos-style completion UI. */
  const [uploadPostWebEposComplete, setUploadPostWebEposComplete] = useState(false);
  const [uploadCompletionStatus, setUploadCompletionStatus] = useState(null); // 'savingToDB' | 'completed' | null
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
  const uploadPendingSlotIds = useMemo(
    () => (useUploadSessions ? uploadPendingSlotIdsFromItems(items) : []),
    [useUploadSessions, items]
  );
  const scanCartKey =
    useUploadSessions && items.length === 0 && uploadScanSlotIds.length > 0
      ? `upload-scan:${uploadScanSlotIds.join('|')}`
      : '';
  const activeCartKey = scanCartKey || getCartKey(activeItems);

  const { lastHandledCompletionRef, rrpCompleteCallbackRef } = useListWorkspaceRepricingCompletion({
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

  const handleRestartUploadInWorkspace = useCallback(async () => {
    if (!useUploadSessions) return;
    try {
      if (dbSessionId) {
        await updateUploadSession(dbSessionId, { status: 'IN_PROGRESS' });
      }
    } catch (e) {
      showNotification(e?.message || copy.uploadRestartSessionError, 'error');
      return;
    }
    lastHandledCompletionRef.current = '';
    setUploadPostWebEposComplete(false);
    setIsRepricingFinished(false);
    setRepricingJob(null);
    setCompletedItemsData([]);
    showNotification(copy.uploadRestartedInWorkspaceToast, 'success');
  }, [
    useUploadSessions,
    dbSessionId,
    showNotification,
    copy.uploadRestartSessionError,
    copy.uploadRestartedInWorkspaceToast,
    setIsRepricingFinished,
    setRepricingJob,
    setCompletedItemsData,
    lastHandledCompletionRef,
  ]);

  const { flushNegotiationSave } = useListWorkspaceNegotiationPersistence({
    useUploadSessions,
    copy,
    items,
    barcodes,
    nosposLookups,
    uploadScanSlotIds,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadStockDetailsBySlotId,
    uploadAuditMode,
    webeposAuditDetailsBySlotId,
    auditRowsByBarcodeRef,
    auditQueueRef,
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
  flushNegotiationSaveRef.current = flushNegotiationSave;

  /** Stable pointer to `enterUploadMainFlowWithAuditBarcodes` so the bootstrap can delegate (declared below). */
  const enterUploadMainFlowWithAuditBarcodesRef = useRef(null);

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
    setUploadBarcodeIntakeOpen,
    setUploadBarcodeIntakeDone,
    setUploadStockDetailsBySlotId,
    setBarcodeModal,
    setBarcodeInput,
    setIsLoading,
    isCreatingSession,
    enterUploadMainFlowWithAuditBarcodesRef,
    setUploadAuditMode,
    setWebeposAuditDetailsBySlotId,
    auditRowsByBarcodeRef,
    auditQueueRef,
  });

  useEffect(() => {
    if (activeCartKey && (Object.keys(barcodes).length > 0 || Object.keys(nosposLookups).length > 0)) {
      saveRepricingProgress(activeCartKey, { barcodes, nosposLookups });
    }
  }, [barcodes, nosposLookups, activeCartKey]);

  /** Sole available RRP column (CeX / eBay / CC / CG) → set as `rrpOffersSource` automatically. */
  useEffect(() => {
    if (!useUploadSessions) return;
    setItems((prev) => {
      let changed = false;
      const out = [];
      for (let i = 0; i < prev.length; i += 1) {
        const row = prev[i];
        if (row?.isRemoved) {
          out.push(row);
          continue;
        }
        const n = applySoleRrpSourceToUploadRow(row);
        if (n !== row) changed = true;
        out.push(n);
      }
      return changed ? out : prev;
    });
  }, [items, useUploadSessions]);

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

  const everyUploadRowHasPipelineRrp =
    !useUploadSessions ||
    activeItems.every((item) => {
      const n = resolveUploadPipelineSalePrice(item);
      return n != null && Number.isFinite(Number(n)) && Number(n) > 0;
    });

  const uploadListMissingRrp =
    useUploadSessions &&
    activeItems.length > 0 &&
    activeItems.every((item) => isItemReadyForRepricing(item.id)) &&
    !everyUploadRowHasPipelineRrp;

  const allItemsReadyForRepricing =
    activeItems.length > 0 &&
    everyUploadRowHasPipelineRrp &&
    activeItems.every((item) => isItemReadyForRepricing(item.id));
  const isBackgroundRepricingRunning = repricingJob?.running && repricingJob?.cartKey === activeCartKey;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleRemoveItem = useCallback((item) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
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
    if (useUploadSessions) {
      setUploadStockDetailsBySlotId((prev) => {
        if (!prev[item.id]) return prev;
        const g = (uploadStockScrapeGenBySlotRef.current[item.id] ?? 0) + 1;
        uploadStockScrapeGenBySlotRef.current[item.id] = g;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
    showNotification(copy.removedFromList(item.title), 'info');
  }, [showNotification, copy, useUploadSessions]);

  const addItemsWithBarcodePrepopulation = useCallback((newItems) => {
    const { barcodes: newBarcodes, nosposLookups: newLookups } = buildNosposMapsFromNegotiationItems(
      newItems,
      maxBarcodesPerItem
    );
    const mappedNew = newItems.map((it) =>
      useUploadSessions ? withUploadListRrpSourceDefaults(it) : withDefaultRrpOffersSource(it)
    );
    setItems((prev) => [...prev, ...mappedNew]);
    if (Object.keys(newBarcodes).length > 0) {
      setBarcodes((prev) => ({ ...prev, ...newBarcodes }));
      setNosposLookups((prev) => ({ ...prev, ...newLookups }));
    }
    if (useUploadSessions) {
      mappedNew.forEach((it) => runUploadCategoryAndCgAfterValidRrp(it));
    }
  }, [maxBarcodesPerItem, useUploadSessions, runUploadCategoryAndCgAfterValidRrp]);

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
      if (useUploadSessions) {
        setTimeout(() => flushNegotiationSaveRef.current?.(), 0);
      }
    },
    [setItems, showNotification, useUploadSessions]
  );

  const handleAddRepricingItem = useCallback((cartItem, opts = {}) => {
    if (!cartItem) return;

    if (useUploadSessions) {
      if (uploadBarcodeIntakeOpen) {
        showNotification(copy.uploadFinishBarcodeIntakeFirst, 'error');
        return;
      }
      const placeholdersInTableOrder = items.filter((i) => !i.isRemoved && i.isUploadBarcodeQueuePlaceholder);
      if (placeholdersInTableOrder.length === 0) {
        showNotification(copy.uploadNoBarcodesLeft, 'warning');
        return;
      }
      const head = placeholdersInTableOrder[0];
      const slotId = head.id;
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

      const scraped = uploadStockDetailsBySlotId[slotId];
      const placeholder = items.find((i) => i.id === slotId);

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
      if (placeholder) {
        const merged = mergeCatalogIntoUploadQueueRow(placeholder, cartItem, {
          nosposBarcodes,
          scraped,
        });
        const rawCartQty = Number(cartItem.quantity);
        const mergedQty =
          Number.isFinite(rawCartQty) && rawCartQty > 0 ? rawCartQty : merged.quantity || 1;
        const item = { ...merged, quantity: mergedQty };
        const newId = item.id;

        setBarcodes((prev) => {
          const next = { ...prev };
          const typedCodesForSlot = prev[slotId] || [];
          const code = String(lk?.stockBarcode || typedCodesForSlot[0] || '').trim();
          if (String(newId) !== String(slotId)) {
            delete next[slotId];
            if (code) next[newId] = [code];
          } else if (code) {
            next[newId] = [code];
          }
          return next;
        });
        setNosposLookups((prev) => {
          const next = { ...prev };
          const oldKey = `${slotId}_0`;
          const slotLk = prev[oldKey];
          if (String(newId) !== String(slotId)) {
            delete next[oldKey];
            if (slotLk) next[`${newId}_0`] = { ...slotLk };
          }
          return next;
        });

        logCategoryRuleDecision({
          context: 'repricing-item-added',
          item,
          categoryObject: item.categoryObject,
          rule: {
            source: item.isCustomCeXItem ? 'cex-reference-rule' : 'builder-precomputed-rule',
            referenceDataPresent: Boolean(item.referenceData),
          },
        });
        setItems((prev) => prev.map((i) => (i.id === slotId ? item : i)));
        runUploadCategoryAndCgAfterValidRrp(item);
        showNotification(copy.addedOne(item.title), 'success');
        return;
      }

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

      const newId = cartItem.id || (crypto.randomUUID?.() ?? `upload-item-${Date.now()}`);
      const uploadNosposStockFromBarcode = uploadNosposStockSnapshotFromScrape(scraped);

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
    items,
    barcodes,
    nosposLookups,
    isItemReadyForRepricing,
    uploadStockDetailsBySlotId,
    items,
    runUploadCategoryAndCgAfterValidRrp,
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

  const handleCashConvertersResearchCompleteFromHeader = useCallback(
    (data) => {
      if (!data) return;
      if (useUploadSessions) {
        if (uploadBarcodeIntakeOpen) {
          showNotification(copy.uploadFinishBarcodeIntakeFirst, 'error');
          return;
        }
        showNotification(copy.uploadNoEbayLines, 'warning');
        return;
      }
      const searchTitle = data.searchTerm?.trim()?.slice(0, 200) || 'Cash Converters Research Item';
      const resolved = data.resolvedCategory?.id != null ? data.resolvedCategory : null;
      const categoryObject = resolved ?? CASH_CONVERTERS_TOP_LEVEL_CATEGORY;
      const categoryName = categoryObject?.name ?? CASH_CONVERTERS_TOP_LEVEL_CATEGORY.name;
      const customItem = {
        id: crypto.randomUUID?.() ?? `reprice-cc-${Date.now()}`,
        title: searchTitle,
        subtitle: 'Cash Converters Research',
        quantity: 1,
        category: categoryName,
        categoryObject,
        offers: [],
        cashOffers: [],
        voucherOffers: [],
        cashConvertersResearchData: data,
        isCustomCashConvertersItem: true,
        selectedOfferId: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? Number(formatOfferPrice(data.stats.suggestedPrice)) : null,
        nosposBarcodes: [],
        ebayResearchData: null,
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
    },
    [addItemsWithBarcodePrepopulation, showNotification, copy, useUploadSessions, uploadBarcodeIntakeOpen]
  );

  const handleCashGeneratorResearchCompleteFromHeader = useCallback(
    (data) => {
      if (!data) return;
      if (useUploadSessions) {
        if (uploadBarcodeIntakeOpen) {
          showNotification(copy.uploadFinishBarcodeIntakeFirst, 'error');
          return;
        }
        showNotification(copy.uploadNoEbayLines, 'warning');
        return;
      }
      const searchTitle = data.searchTerm?.trim()?.slice(0, 200) || 'Cash Generator Research Item';
      const resolved = data.resolvedCategory?.id != null ? data.resolvedCategory : null;
      const categoryObject = resolved ?? CASH_GENERATOR_TOP_LEVEL_CATEGORY;
      const categoryName = categoryObject?.name ?? CASH_GENERATOR_TOP_LEVEL_CATEGORY.name;
      const customItem = {
        id: crypto.randomUUID?.() ?? `reprice-cg-${Date.now()}`,
        title: searchTitle,
        subtitle: 'Cash Generator Research',
        quantity: 1,
        category: categoryName,
        categoryObject,
        offers: [],
        cashOffers: [],
        voucherOffers: [],
        cgResearchData: data,
        isCustomCashGeneratorItem: true,
        selectedOfferId: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? Number(formatOfferPrice(data.stats.suggestedPrice)) : null,
        nosposBarcodes: [],
        ebayResearchData: null,
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
      showNotification(copy.addedOne(customItem.title), 'success');
    },
    [addItemsWithBarcodePrepopulation, showNotification, copy, useUploadSessions, uploadBarcodeIntakeOpen]
  );

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
    const usedSlotIds = uploadScanSlotIds.filter((id) => {
      const codes = barcodes[id] || [];
      return Array.isArray(codes) && codes.length > 0 && codes.some((c) => String(c ?? '').trim() !== '');
    });
    if (usedSlotIds.length === 0) {
      showNotification(copy.uploadScanNeedOneLine, 'error');
      return;
    }
    if (usedSlotIds.some((id) => !isItemReadyForRepricing(id))) {
      showNotification(copy.uploadScanAllVerified, 'error');
      return;
    }
    const usedSet = new Set(usedSlotIds.map(String));
    const slotsSnapshot = uploadScanSlotIds.filter((id) => usedSet.has(String(id)));
    const snapshotBarcodes = barcodes;
    const snapshotLookups = nosposLookups;
    const snapshotStock = uploadStockDetailsBySlotId;
    const snapshotWebeposAudit = webeposAuditDetailsBySlotId;

    const existingRowIdSet = new Set(items.filter((i) => !i.isRemoved).map((i) => String(i.id)));
    const newSlotIdsOnly = slotsSnapshot.filter((id) => !existingRowIdSet.has(String(id)));
    const intakeCtx = {
      barcodes: snapshotBarcodes,
      nosposLookups: snapshotLookups,
      uploadStockDetailsBySlotId: snapshotStock,
      webeposAuditDetailsBySlotId: snapshotWebeposAudit,
    };

    const placeholders = newSlotIdsOnly.map((slotId) =>
      buildUploadBarcodeQueuePlaceholderItem(slotId, intakeCtx)
    );

    const existingRowsRefreshedForAi = items
      .filter(
        (r) =>
          !r.isRemoved &&
          usedSet.has(String(r.id)) &&
          existingRowIdSet.has(String(r.id))
      )
      .map((row) => applyUploadBarcodeIntakeSnapshotToRow(row, row.id, intakeCtx));

    setUploadScanSlotIds([]);
    setUploadBarcodeIntakeDone(true);
    setUploadBarcodeIntakeOpen(false);
    setBarcodeModal(null);
    setBarcodeInput('');
    setNosposResultsPanel(null);

    setItems((prev) => {
      const next = prev.map((row) => {
        if (row.isRemoved) return row;
        if (!usedSet.has(String(row.id)) || !existingRowIdSet.has(String(row.id))) return row;
        return applyUploadBarcodeIntakeSnapshotToRow(row, row.id, intakeCtx);
      });
      return [...next, ...placeholders];
    });

    const { barcodes: fromPlaceholders, nosposLookups: lookupsFromPlaceholders } =
      buildNosposMapsFromNegotiationItems(placeholders, maxBarcodesPerItem);
    setBarcodes((prev) => ({ ...fromPlaceholders, ...prev }));
    setNosposLookups((prev) => ({ ...lookupsFromPlaceholders, ...prev }));

    queueMicrotask(() => {
      placeholders.forEach((it) => scheduleCgAiForUploadLine(it));
      existingRowsRefreshedForAi.forEach((it) => scheduleCgAiForUploadLine(it));
    });

    if (newSlotIdsOnly.length > 0) {
      showNotification('Add CeX products from the header — each line fills the table from the top down.', 'success');
    } else {
      showNotification(copy.uploadIntakeMergedExistingOnly, 'success');
    }
  }, [
    useUploadSessions,
    uploadScanSlotIds,
    barcodes,
    nosposLookups,
    uploadStockDetailsBySlotId,
    isItemReadyForRepricing,
    showNotification,
    copy,
    scheduleCgAiForUploadLine,
    maxBarcodesPerItem,
    items,
  ]);

  const openAddMoreUploadBarcodeIntake = useCallback(() => {
    if (!useUploadSessions || uploadBarcodeIntakeOpen) return;
    const active = items.filter((i) => !i.isRemoved);
    if (active.length === 0) return;

    const { barcodes: fromItems, nosposLookups: lookupsFromItems } = buildNosposMapsFromNegotiationItems(
      active,
      maxBarcodesPerItem
    );
    setBarcodes((prev) => ({ ...fromItems, ...prev }));
    setNosposLookups((prev) => ({ ...lookupsFromItems, ...prev }));

    const draftId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `upload-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    uploadIntakeEditorReadyBaselineRef.current = false;
    setUploadScanSlotIds([...active.map((i) => i.id), draftId]);
    setUploadBarcodeIntakeOpen(true);
    setBarcodeModal({ item: { id: draftId, title: 'New barcode line' } });
    setBarcodeInput('');
  }, [useUploadSessions, uploadBarcodeIntakeOpen, items, maxBarcodesPerItem]);

  /** Late scrape: fill NosPos cost / retail / buyer / date on queue rows while the slot is still pending. */
  useEffect(() => {
    if (!useUploadSessions) return;
    const pendingSet = new Set(uploadPendingSlotIdsFromItems(items));
    if (pendingSet.size === 0) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (!pendingSet.has(String(row.id))) return row;
        const det = uploadStockDetailsBySlotId[row.id];
        const patch = uploadNosposStockSnapshotFromScrape(det);
        if (!patch) return row;
        const mergedStock = mergeUploadNosposStockFieldLevel(row.uploadNosposStockFromBarcode, patch);
        const a = row.uploadNosposStockFromBarcode;
        const changeLogSame =
          JSON.stringify(a?.changeLog || []) === JSON.stringify(mergedStock?.changeLog || []);
        const same =
          a &&
          mergedStock &&
          changeLogSame &&
          ['costPrice', 'retailPrice', 'boughtBy', 'createdAt'].every(
            (k) => String(a[k] ?? '').trim() === String(mergedStock[k] ?? '').trim()
          );
        if (same) return row;
        changed = true;
        return { ...row, uploadNosposStockFromBarcode: mergedStock };
      });
      return changed ? next : prev;
    });
  }, [useUploadSessions, uploadStockDetailsBySlotId, items]);

  const onAfterCexRowUpdatedForUpload = useCallback(
    (row) => setTimeout(() => runUploadCategoryAndCgAfterValidRrp(row), 0),
    [runUploadCategoryAndCgAfterValidRrp]
  );

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers: false,
    // Upload mode: skip the "use CeX as RRP?" confirmation modal — apply RRP immediately
    setCexPencilRrpSourceModal: useUploadSessions ? null : setCexPencilRrpSourceModal,
    onAfterCexRowUpdated: useUploadSessions ? onAfterCexRowUpdatedForUpload : undefined,
  });

  // ── Sale price handlers (shared component interface) ────────────────────────
  const handleOurSalePriceChange = useCallback((itemId, value) => {
    setItems((prev) =>
      prev.map((i) => (String(i.id) !== String(itemId) ? i : { ...i, ourSalePriceInput: value }))
    );
  }, []);

  const handleOurSalePriceBlur = useCallback((item) => {
    const salePriceDisplayValue = getEditableSalePriceState(item).displayValue;
    const raw = (item.ourSalePriceInput ?? salePriceDisplayValue).replace(/[£,]/g, '').trim();
    const parsedTotal = parseFloat(raw);
    const qty = item.quantity || 1;
    let updatedForPipeline = null;
    setItems((prev) =>
      prev.map((i) => {
        if (String(i.id) !== String(item.id)) return i;
        const next = { ...i };
        delete next.ourSalePriceInput;
        if (raw === '') {
          next.ourSalePrice = '';
          return next;
        }
        if (Number.isNaN(parsedTotal) || parsedTotal <= 0) return next;
        next.ourSalePrice = String(normalizeExplicitSalePrice(parsedTotal / qty));
        updatedForPipeline = next;
        return next;
      })
    );
    if (raw !== '' && (Number.isNaN(parsedTotal) || parsedTotal <= 0)) {
      showNotification(
        useUploadSessions ? copy.uploadRrpMustBePositive : 'Our sale price must be greater than £0',
        'error'
      );
    } else if (useUploadSessions && updatedForPipeline) {
      setTimeout(() => runUploadCategoryAndCgAfterValidRrp(updatedForPipeline), 0);
    }
  }, [showNotification, useUploadSessions, copy, runUploadCategoryAndCgAfterValidRrp]);

  const handleOurSalePriceFocus = useCallback((itemId, displayValue) => {
    setItems((prev) =>
      prev.map((i) => (String(i.id) !== String(itemId) ? i : { ...i, ourSalePriceInput: displayValue }))
    );
  }, []);

  const handleUploadTableItemNameChange = useCallback((itemId, value) => {
    if (!useUploadSessions) return;
    setItems((prev) =>
      prev.map((i) => (String(i.id) !== String(itemId) ? i : { ...i, uploadTableItemName: value }))
    );
  }, [useUploadSessions]);

  const handleApplyRrpPriceSource = useCallback((item, zone) => {
    const { item: next, errorMessage } = applyRrpOnlyFromPriceSource(item, zone);
    if (errorMessage) {
      showNotification(errorMessage, 'error');
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    showNotification(
      useUploadSessions ? copy.uploadRrpUpdatedFromSource : 'New Sale Price updated from selected source.',
      'success'
    );
    if (useUploadSessions) {
      setTimeout(() => runUploadCategoryAndCgAfterValidRrp(next), 0);
    }
  }, [showNotification, useUploadSessions, copy, runUploadCategoryAndCgAfterValidRrp]);

  const uploadBeginLineSyncLockRef = useRef(false);
  /** Stable ref to triggerUploadStockScrapeForSlot — avoids temporal dead zone in beginUploadScanBarcodeLine. */
  const triggerUploadStockScrapeForSlotRef = useRef(null);

  const beginUploadScanBarcodeLine = useCallback(() => {
    if (!useUploadSessions) return;
    if (uploadBeginLineSyncLockRef.current) return;
    uploadBeginLineSyncLockRef.current = true;
    const id = crypto.randomUUID?.() ?? `upload-scan-${Date.now()}`;
    const nextBarcode = auditQueueRef.current.shift() ?? null;
    setUploadScanSlotIds((prev) => [...prev, id]);
    setBarcodeModal({ item: { id, title: nextBarcode ? 'Audit barcode' : 'New barcode line' } });
    setBarcodeInput('');
    if (nextBarcode) {
      setBarcodes((prev) => ({ ...prev, [id]: [nextBarcode] }));
      // Audit mode only: if this barcode has a known Web EPOS productHref, scrape the edit page in
      // parallel with the NosPos search so the row has both sides of the diff by the time the user
      // sees it. Misses (no productHref) fall through as a regular NosPos-only barcode.
      const auditRow = auditRowsByBarcodeRef.current?.[String(nextBarcode).trim()] || null;
      if (auditRow?.productHref) {
        triggerWebEposAuditScrapeForSlotRef.current?.(id, auditRow.productHref);
      }
      // Fire NosPos lookup for this audit barcode immediately
      setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'searching' } }));
      searchNosposBarcode(nextBarcode).then((result) => {
        if (result?.loginRequired) {
          showNotification('NosPos lookup needs you to be logged in first.', 'error');
          setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'error', error: 'Log in to NosPos first' } }));
        } else if (result?.ok) {
          const results = result.results || [];
          if (results.length === 0) {
            setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'not_found', results: [] } }));
          } else if (results.length === 1) {
            setNosposLookups((prev) => ({
              ...prev,
              [`${id}_0`]: {
                status: 'selected', results,
                stockBarcode: results[0].barserial,
                stockName: results[0].name || '',
                stockUrl: `https://nospos.com${results[0].href}`,
              },
            }));
            triggerUploadStockScrapeForSlotRef.current?.(id, `https://nospos.com${results[0].href}`);
          } else {
            setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'found', results } }));
            setNosposResultsPanel((prev) => prev ?? { itemId: id, barcodeIndex: 0 });
          }
        } else {
          setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'error', error: result?.error || 'Search failed' } }));
        }
      }).catch((err) => {
        setNosposLookups((prev) => ({ ...prev, [`${id}_0`]: { status: 'error', error: err?.message || 'Extension unavailable' } }));
      });
    }
    queueMicrotask(() => {
      uploadBeginLineSyncLockRef.current = false;
    });
  }, [useUploadSessions, showNotification]);

  /** Keep a draft line + composer whenever intake is open and there is nothing to edit yet. */
  useEffect(() => {
    if (!useUploadSessions || !uploadBarcodeIntakeOpen) return;
    if (uploadScanSlotIds.length > 0 || barcodeModal) return;
    beginUploadScanBarcodeLine();
  }, [useUploadSessions, uploadBarcodeIntakeOpen, uploadScanSlotIds.length, barcodeModal, beginUploadScanBarcodeLine]);

  /** When the active intake line becomes NosPos-verified, open the next line automatically (no extra “Add line”). */
  const uploadIntakeEditorReadyBaselineRef = useRef(false);
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
  triggerUploadStockScrapeForSlotRef.current = triggerUploadStockScrapeForSlot;

  /**
   * Audit mode only: open the Web EPOS edit page for this barcode's product (via the existing
   * upload worker tab), read the current title, price, and category levels, then reverse-map to
   * a CG categoryObject.
   */
  const triggerWebEposAuditScrapeForSlot = useCallback((slotId, productHref) => {
    if (!useUploadSessions || !slotId || !productHref) return;
    const gen = (webeposAuditScrapeGenBySlotRef.current[slotId] ?? 0) + 1;
    webeposAuditScrapeGenBySlotRef.current[slotId] = gen;
    setWebeposAuditDetailsBySlotId((prev) => ({
      ...prev,
      [slotId]: { loading: true, productHref },
    }));
    void (async () => {
      try {
        if (!Array.isArray(allCategoriesFlatRef.current)) {
          try {
            allCategoriesFlatRef.current = (await fetchAllCategoriesFlat()) || [];
          } catch {
            allCategoriesFlatRef.current = [];
          }
        }
        const r = await scrapeWebEposEditPageForAudit({ productHref });
        if (webeposAuditScrapeGenBySlotRef.current[slotId] !== gen) return;
        if (r?.ok && r.details) {
          const details = r.details;
          const derivedCategoryObject = reverseLookupWebEposCategory(
            details.categoryLevels,
            allCategoriesFlatRef.current
          );
          setWebeposAuditDetailsBySlotId((prev) => ({
            ...prev,
            [slotId]: {
              loading: false,
              productHref,
              originalTitle: details.title || '',
              originalPrice: details.price || '',
              categoryLevels: Array.isArray(details.categoryLevels) ? details.categoryLevels : [],
              derivedCategoryObject: derivedCategoryObject || null,
            },
          }));
        } else {
          setWebeposAuditDetailsBySlotId((prev) => ({
            ...prev,
            [slotId]: {
              loading: false,
              productHref,
              error: r?.error || 'Could not read Web EPOS product.',
            },
          }));
        }
      } catch (e) {
        if (webeposAuditScrapeGenBySlotRef.current[slotId] !== gen) return;
        setWebeposAuditDetailsBySlotId((prev) => ({
          ...prev,
          [slotId]: { loading: false, productHref, error: e?.message || 'Extension unavailable.' },
        }));
      }
    })();
  }, [useUploadSessions]);
  /** Stable ref so beginUploadScanBarcodeLine (declared earlier) can call this without a TDZ. */
  const triggerWebEposAuditScrapeForSlotRef = useRef(null);
  triggerWebEposAuditScrapeForSlotRef.current = triggerWebEposAuditScrapeForSlot;

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
    const isUploadScanSlot = useUploadSessions && uploadScanSlotIds.includes(itemId);
    if (isUploadScanSlot && existing.length >= 1) {
      const lookup0 = nosposLookups[`${itemId}_0`];
      if (lookup0?.status === 'searching') {
        showNotification('Still searching NosPos for this barcode. Wait for the result before entering another.', 'info');
        return;
      }
    }
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
  }, [
    barcodeModal,
    barcodeInput,
    barcodes,
    nosposLookups,
    runNosposLookup,
    maxBarcodesPerItem,
    useUploadSessions,
    uploadScanSlotIds,
    showNotification,
  ]);

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
      setUploadPostWebEposComplete(false);
      showNotification(
        uploadAuditMode ? 'Updating existing Web EPOS products…' : copy.uploadOpeningWebEposNewProduct,
        'info'
      );
      try {
        await flushNegotiationSaveRef.current?.();
        let rowsForWebEpos = activeItems;
        if (dbSessionId) {
          try {
            const detail = await fetchUploadSessionDetail(dbSessionId);
            const lineItems = detail?.items;
            if (Array.isArray(lineItems) && lineItems.length > 0) {
              rowsForWebEpos = mergeUploadSessionItemIdsFromApiLines(activeItems, lineItems);
              setItems((prev) => mergeUploadSessionItemIdsFromApiLines(prev, lineItems));
            }
          } catch (_) { /* keep rowsForWebEpos = activeItems */ }
        }

        const activeAuditMode = uploadAuditMode;

        // Build repricingData for ALL items with NosPos barcodes.
        // In audit mode, this is filtered down to items needing a NosPos update (name or RRP diff).
        const allRepricingDataUnfiltered = rowsForWebEpos
          .filter((item) => !item.isRemoved && getVerifiedBarcodesForItem(item.id).length > 0)
          .map((item) => {
            const uploadRrp = resolveUploadPipelineSalePrice(item);
            const rawNosposRrp = item?.uploadNosposStockFromBarcode?.retailPrice;
            const nosposRrp = rawNosposRrp
              ? Number.parseFloat(String(rawNosposRrp).replace(/[£,\s]/g, ''))
              : null;
            // For price: use upload RRP if available, else keep existing NosPos price
            const salePrice =
              uploadRrp != null
                ? uploadRrp
                : Number.isFinite(nosposRrp)
                ? nosposRrp
                : null;
            const verifiedEntries = (barcodes[item.id] || []).flatMap((_, index) => {
              const lk = nosposLookups[`${item.id}_${index}`];
              return lk?.status === 'selected' && lk.stockBarcode
                ? [{ barcode: lk.stockBarcode, stockUrl: lk.stockUrl || '' }]
                : [];
            });
            const nameForUpload = (() => {
              const n = resolveUploadTableItemName(item);
              return n === '—' ? '' : n;
            })();
            const nosposName = String(item?.uploadNosposStockFromBarcode?.stockName || '').trim();
            const priceChangedOnNospos =
              Number.isFinite(Number(salePrice)) &&
              Number.isFinite(nosposRrp) &&
              Math.abs(Number(salePrice) - Number(nosposRrp)) > 0.005;
            const priceChangedForceInsert =
              !Number.isFinite(nosposRrp) && Number.isFinite(Number(salePrice));
            const nameChangedOnNospos =
              nameForUpload && nosposName && nameForUpload !== nosposName;
            return {
              __item: item,
              __nosposName: nosposName,
              __priceChangedOnNospos: priceChangedOnNospos || priceChangedForceInsert,
              __nameChangedOnNospos: Boolean(nameChangedOnNospos),
              itemId: item.id,
              title: nameForUpload,
              salePrice,
              ourSalePriceAtRepricing: uploadRrp,
              cexSellAtRepricing: item.cexSellPrice ?? null,
              raw_data: item.ebayResearchData || {},
              cash_converters_data: item.cashConvertersResearchData || {},
              cg_data: item.cgResearchData || {},
              barcodes: verifiedEntries.map(e => e.barcode),
              stockUrls: verifiedEntries.map(e => e.stockUrl),
            };
          });

        // Audit-mode NosPos filter: only push items where price or name actually changed.
        const allRepricingData = activeAuditMode
          ? allRepricingDataUnfiltered.filter(
              (r) => r.__priceChangedOnNospos || r.__nameChangedOnNospos
            )
          : allRepricingDataUnfiltered;
        // Strip audit-only metadata before handing to the bridge.
        const cleanedRepricingData = allRepricingData.map(
          ({ __item, __nosposName, __priceChangedOnNospos, __nameChangedOnNospos, ...rest }) => rest
        );

        if (!activeAuditMode && cleanedRepricingData.length === 0) {
          showNotification(copy.uploadWebEposNeedServerLineIds, 'error');
          return;
        }

        // Audit-mode Web EPOS edit list (price always, category only if changed vs scraped levels).
        const webEposEditList = activeAuditMode
          ? rowsForWebEpos
              .filter((item) => !item.isRemoved && item.webeposProductHref)
              .map((item) => {
                const uploadRrp = resolveUploadPipelineSalePrice(item);
                const priceStr = Number.isFinite(Number(uploadRrp))
                  ? String(Number(uploadRrp).toFixed(2))
                  : null;
                const currentLabels = cgCategoryObjectToWebEposLabels(item.categoryObject);
                const scrapedLabels = Array.isArray(item.webeposCategoryLevels)
                  ? item.webeposCategoryLevels.map((lvl) => String(lvl?.label || '').trim()).filter(Boolean)
                  : [];
                const categoryChanged =
                  currentLabels.length > 0 &&
                  (currentLabels.length !== scrapedLabels.length ||
                    currentLabels.some((l, i) => l.toLowerCase() !== String(scrapedLabels[i] || '').toLowerCase()));
                const webeposOriginalNum = Number.parseFloat(
                  String(item.webeposOriginalPrice || '').replace(/[£,\s]/g, '')
                );
                const priceChangedOnWebepos =
                  Number.isFinite(Number(uploadRrp)) &&
                  (!Number.isFinite(webeposOriginalNum) ||
                    Math.abs(Number(uploadRrp) - webeposOriginalNum) > 0.005);
                if (!priceChangedOnWebepos && !categoryChanged) return null;
                const entry = {
                  productHref: item.webeposProductHref,
                  barcode: (barcodes[item.id] || [])[0] || '',
                };
                if (priceChangedOnWebepos && priceStr) entry.price = priceStr;
                if (categoryChanged && currentLabels.length > 0) {
                  entry.categoryLevelLabels = currentLabels;
                }
                return entry;
              })
              .filter(Boolean)
          : [];

        const webEposProductCreateList = activeAuditMode
          ? []
          : rowsForWebEpos
              .map((item) => buildWebEposProductCreatePayloadFromUploadRow(item, getVerifiedBarcodesForItem(item.id)))
              .filter(Boolean);

        if (activeAuditMode && webEposEditList.length === 0 && cleanedRepricingData.length === 0) {
          showNotification('Nothing to sync — neither Web EPOS nor NosPos has changes.', 'info');
          try {
            if (dbSessionId) {
              await updateUploadSession(dbSessionId, { status: 'COMPLETED', mode: 'AUDIT' });
            }
          } catch (_) {}
          if (dbSessionId) {
            setTimeout(() => navigate(`/upload-sessions/${dbSessionId}/view`), 300);
          }
          return;
        }

        // Callback fires after NosPos pass completes → WEBEPOS edit (audit) or new-product (upload)
        rrpCompleteCallbackRef.current = async () => {
          try {
            const res = activeAuditMode
              ? await editWebEposProductsForAuditWithTimeout({
                  webEposEditList,
                  uploadProgressCartKey: activeCartKey,
                })
              : await openWebEposProductCreateForUploadWithTimeout({
                  webEposProductCreateList,
                  uploadProgressCartKey: activeCartKey,
                });
            const n = Number(res?.tabsFilled);
            const successMsg = activeAuditMode
              ? `Web EPOS updated in place${Number.isFinite(n) && n > 1 ? ` (${n} products)` : ''}.`
              : Number.isFinite(n) && n > 1
                ? `${copy.uploadWebEposNewProductOpened} (${n} products)`
                : copy.uploadWebEposNewProductOpened;
            showNotification(successMsg, 'success');
            try {
              await flushNegotiationSaveRef.current?.();
              if (dbSessionId) {
                await updateUploadSession(dbSessionId, {
                  status: 'COMPLETED',
                  ...(activeAuditMode ? { mode: 'AUDIT' } : {}),
                });
              }
            } catch (persistErr) {
              console.warn(copy.saveFailLog, persistErr);
            }
            useAppStore.getState().clearRepricingSessionDraft();
            setIsRepricingFinished(true);
            setRepricingJob((prev) =>
              prev && prev.cartKey === activeCartKey
                ? { ...prev, running: false, done: true, step: 'completed', message: copy.jobCompletedMessage }
                : prev
            );
            setUploadCompletionStatus('savingToDB');
            try {
              if (dbSessionId) {
                await fetchUploadSessionDetail(dbSessionId);
                setUploadCompletionStatus('completed');
                setTimeout(() => {
                  navigate(`/upload-sessions/${dbSessionId}/view`);
                }, 300);
              }
            } catch (fetchErr) {
              console.warn('Failed to fetch completed session:', fetchErr);
              setUploadCompletionStatus(null);
            }
          } catch (webeposErr) {
            setRepricingJob((prev) =>
              prev && prev.cartKey === activeCartKey
                ? { ...prev, running: false, done: true, step: 'error', message: webeposErr?.message || copy.webEposOpenFailed }
                : prev
            );
            showNotification(webeposErr?.message || copy.webEposOpenFailed, 'error');
          }
        };

        const totalItems = cleanedRepricingData.length;
        if (activeAuditMode && cleanedRepricingData.length === 0) {
          // Audit mode with only Web EPOS changes: skip NosPos, run the callback immediately.
          showNotification('Updating Web EPOS (NosPos is already in sync)…', 'info');
          setRepricingJob({
            cartKey: activeCartKey,
            running: true,
            done: false,
            step: 'webEposEdit',
            message: 'Updating Web EPOS…',
            currentBarcode: '',
            currentItemId: '',
            currentItemTitle: webEposEditList[0]?.barcode || '',
            totalBarcodes: webEposEditList.length,
            completedBarcodeCount: 0,
            completedBarcodes: {},
            completedItems: [],
            logs: [{ timestamp: new Date().toISOString(), level: 'info', message: copy.jobLogStart }],
          });
          const cb = rrpCompleteCallbackRef.current;
          rrpCompleteCallbackRef.current = null;
          if (typeof cb === 'function') await cb();
          return;
        }

        showNotification(`Syncing ${totalItems} item${totalItems !== 1 ? 's' : ''} on NosPos…`, 'info');
        setRepricingJob({
          cartKey: activeCartKey,
          running: true,
          done: false,
          step: 'rrpUpdate',
          message: `Syncing ${totalItems} item${totalItems !== 1 ? 's' : ''} on NosPos…`,
          currentBarcode: '',
          currentItemId: '',
          currentItemTitle: cleanedRepricingData[0]?.title || '',
          totalBarcodes: activeAuditMode ? webEposEditList.length : webEposProductCreateList.length,
          completedBarcodeCount: 0,
          completedBarcodes: {},
          completedItems: [],
          logs: [{ timestamp: new Date().toISOString(), level: 'info', message: copy.jobLogStart }],
        });

        await openNospos(cleanedRepricingData, {
          completedBarcodes: {},
          completedItems: [],
          cartKey: activeCartKey,
        });
      } catch (err) {
        rrpCompleteCallbackRef.current = null;
        setRepricingJob((prev) =>
          prev && prev.cartKey === activeCartKey
            ? { ...prev, running: false, done: true, step: 'error', message: err?.message || copy.webEposOpenFailed }
            : prev
        );
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

  const awaitingWebEposForUploadHub =
    useUploadSessions &&
    !uploadMainFlowStarted &&
    (!uploadWebEposReady || webEposProductsScrapeLoading);

  const showWorkspaceLoader = isLoading || awaitingWebEposForUploadHub;

  const workspaceLoaderMessage = (() => {
    if (!useUploadSessions || uploadMainFlowStarted) return copy.loadingList;
    if (!isLoading && !uploadWebEposReady) return copy.startBackground;
    if (!isLoading && uploadWebEposReady && webEposProductsScrapeLoading) return copy.webEposProductsSyncing;
    return copy.loadingList;
  })();

  const uploadWebEposHubActive = useMemo(
    () =>
      Boolean(
        useUploadSessions &&
          !uploadMainFlowStarted &&
          uploadWebEposReady &&
          !webEposProductsScrapeLoading
      ),
    [useUploadSessions, uploadMainFlowStarted, uploadWebEposReady, webEposProductsScrapeLoading]
  );

  const enterUploadMainFlow = useCallback(() => {
    setUploadMainFlowStarted(true);
  }, []);

  const enterUploadMainFlowWithAuditBarcodes = useCallback((auditBarcodeList, auditRowList = null) => {
    if (!Array.isArray(auditBarcodeList) || auditBarcodeList.length === 0) {
      setUploadMainFlowStarted(true);
      return;
    }
    auditQueueRef.current = [...auditBarcodeList];
    const rowsByBarcode = {};
    if (Array.isArray(auditRowList)) {
      for (const row of auditRowList) {
        const key = String(row?.barcode || '').trim();
        if (key) rowsByBarcode[key] = row;
      }
    }
    auditRowsByBarcodeRef.current = rowsByBarcode;
    setUploadAuditMode(true);
    setUploadScanSlotIds([]);
    setBarcodes({});
    setNosposLookups({});
    setWebeposAuditDetailsBySlotId({});
    setUploadBarcodeIntakeOpen(true);
    setBarcodeModal(null);
    setBarcodeInput('');
    setUploadMainFlowStarted(true);
    // The effect watching uploadBarcodeIntakeOpen + empty slots fires beginUploadScanBarcodeLine automatically
  }, []);

  enterUploadMainFlowWithAuditBarcodesRef.current = enterUploadMainFlowWithAuditBarcodes;

  return {
    showWorkspaceLoader,
    workspaceLoaderMessage,
    uploadWebEposHubActive,
    enterUploadMainFlow,
    enterUploadMainFlowWithAuditBarcodes,
    uploadAuditMode,
    webeposAuditDetailsBySlotId,
    uploadListMissingRrp,
    webEposProductsSnapshot,
    webEposProductsScrapeError,
    bumpWebEposScrape,
    features,
    copy,
    useUploadSessions,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    beginUploadScanBarcodeLine,
    removeUploadScanSlotById,
    completeUploadBarcodeIntake,
    openAddMoreUploadBarcodeIntake,
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
    uploadPostWebEposComplete,
    uploadCompletionStatus,
    setUploadCompletionStatus,
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
    handleCashConvertersResearchCompleteFromHeader,
    handleCashGeneratorResearchCompleteFromHeader,
    handleRefreshCeXData,
    handleOurSalePriceChange,
    handleOurSalePriceBlur,
    handleOurSalePriceFocus,
    handleUploadTableItemNameChange,
    handleApplyRrpPriceSource,
    runUploadCategoryAndCgAfterValidRrp,
    addBarcode,
    removeBarcode,
    runNosposLookup,
    selectNosposResult,
    skipNosposLookup,
    handleProceed,
    handleRestartUploadInWorkspace,
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
    openBarcodePrintTab,
    cgCategoryRows,
    cgCategoryPickerModal,
    setCgCategoryPickerModal,
    handleOpenCgCategoryPicker,
    handleCgCategorySelected,
    uploadBuilderTopCategories,
  };
}
