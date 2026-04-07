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
  saveParkAgreementState,
  deleteRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
  fetchCustomerOfferRules,
  fetchNosposCategories,
  fetchJewelleryCatalog,
} from '@/services/api';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { useResearchOverlay, makeSalePriceBlurHandler } from './hooks/useResearchOverlay';
import { useRefreshCexRowData } from './hooks/useRefreshCexRowData';
import { mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import {
  checkNosposCustomerBuyingSession,
  openNosposNewAgreementCreateBackground,
  resolveNosposParkAgreementLine,
  deleteExcludedNosposAgreementLines,
  clickNosposSidebarParkAgreement,
  fillNosposParkAgreementCategory,
  fillNosposParkAgreementRest,
  patchNosposAgreementField,
  withExtensionCallTimeout,
  getNosposTabUrl,
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
import {
  summariseNegotiationItemForAi,
  runNosposStockCategoryAiMatchBackground,
} from '@/services/aiCategoryPathCascade';
import {
  getAiSuggestedNosposStockCategoryFromItem,
  getAiSuggestedNosposStockFieldValuesFromItem,
  getNosposCategoryHierarchyLabelFromItem,
  resolveNosposLeafCategoryIdForAgreementItem,
} from '@/utils/nosposCategoryMappings';
import { buildNosposAgreementFirstItemFillPayload } from './utils/nosposAgreementFirstItemFill';
import {
  buildParkAgreementSystemSteps,
  buildParkItemTablesFromFill,
} from './utils/parkAgreementProgressTables';
import { buildNosposStockFieldAiPayload } from './utils/nosposFieldAiAtAdd';
import { EBAY_TOP_LEVEL_CATEGORY } from './constants';
import { SPREADSHEET_TABLE_STYLES } from './spreadsheetTableStyles';
import ParkAgreementProgressModal from './components/ParkAgreementProgressModal';

/** NosPos “create agreement” — PA = buyback, DP = direct sale / store credit. */
function buildNosposNewAgreementCreateUrl(nosposCustomerId, transactionType) {
  const id = parseInt(String(nosposCustomerId ?? '').trim(), 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const agreementType = transactionType === 'buyback' ? 'PA' : 'DP';
  return `https://nospos.com/newagreement/agreement/create?type=${agreementType}&customer_id=${id}`;
}

function parkNegotiationLines(items) {
  if (!Array.isArray(items)) return [];
  return [
    ...items.filter((i) => i.isJewelleryItem && !i.isRemoved),
    ...items.filter((i) => !i.isJewelleryItem && !i.isRemoved),
  ];
}

/**
 * NosPos park “sequence index” for a line: count of non-excluded lines strictly before this
 * negotiation index. First included line → 0 (use row 0, no Add). Second included → 1 (one Add), etc.
 * Using the raw negotiation index breaks when leading lines are excluded (would click Add instead of filling row 0).
 */
function parkIncludedSequentialStepIndex(lines, excludedIds, negotiationIndex) {
  const ex = excludedIds && excludedIds.size ? excludedIds : null;
  let n = 0;
  for (let j = 0; j < negotiationIndex; j++) {
    const id = lines[j]?.id;
    if (ex && id && ex.has(id)) continue;
    n += 1;
  }
  return n;
}

function buildParkExtensionItemPayload(line, negotiationIdx, opts) {
  const { useVoucherOffers, categoriesResults, requestId, parkSequentialIndex } = opts || {};
  const fp = buildNosposAgreementFirstItemFillPayload(line, negotiationIdx, {
    useVoucherOffers,
    categoriesResults,
    requestId,
    parkSequentialIndex:
      parkSequentialIndex != null ? parkSequentialIndex : negotiationIdx,
  });
  const hint =
    getNosposCategoryHierarchyLabelFromItem(line) || (fp?.categoryId ? String(fp.categoryId) : '');
  return {
    categoryId: fp?.categoryId ?? '',
    categoryOurDisplay: hint,
    name: fp?.name ?? '',
    itemDescription: fp?.itemDescription ?? '',
    cgParkLineMarker: fp?.cgParkLineMarker ?? '',
    quantity: fp?.quantity ?? '1',
    retailPrice: fp?.retailPrice ?? null,
    boughtFor: fp?.boughtFor ?? null,
    stockFields: fp?.stockFields ?? [],
  };
}

function agreementParkLineTitle(item, index) {
  if (!item) return `Item ${index + 1}`;
  const ref = item.referenceData || {};
  if (item.isJewelleryItem) {
    return (
      String(
        ref.item_name ||
          ref.line_title ||
          ref.reference_display_name ||
          ref.product_name ||
          item.variantName ||
          item.title ||
          'Jewellery'
      ).trim() || 'Jewellery'
    );
  }
  return (
    String(item.variantName || item.title || ref.product_name || `Item ${index + 1}`).trim() ||
    `Item ${index + 1}`
  );
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
  const [showJewelleryReferenceModal, setShowJewelleryReferenceModal] = useState(false);
  /** @type {[null | { systemSteps: object[], itemTables: object[]|null, footerError: string|null, allowClose: boolean }, function]} */
  const [parkProgressModal, setParkProgressModal] = useState(null);
  const parkNosposTabRef = useRef(null);
  const parkFlowCategoriesRef = useRef([]);
  const parkFieldRowsByIndexRef = useRef({});
  /** NosPos DOM row index per negotiation line (may differ from item index after reloads). */
  const parkNosposDomLineByItemRef = useRef({});
  const parkRetryInFlightRef = useRef(false);
  const [parkRetryBusyUi, setParkRetryBusyUi] = useState(false);
  /** Indices of negotiation lines excluded from the NosPos park run (persists across runs). */
  const [parkExcludedItems, setParkExcludedItems] = useState(new Set());
  /** Persisted NosPos agreement URL for the current request (null = never parked). */
  const [persistedNosposUrl, setPersistedNosposUrl] = useState(null);
  const parkStateSaveTimerRef = useRef(null);
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

  const handleParkFieldPatch = useCallback(
    async ({ lineIndex, rowId, patchKind, fieldLabel, value }) => {
      const tabId = parkNosposTabRef.current;
      if (tabId == null) return;
      const domLine =
        parkNosposDomLineByItemRef.current[lineIndex] != null
          ? parkNosposDomLineByItemRef.current[lineIndex]
          : lineIndex;
      try {
        const r = await patchNosposAgreementField({
          tabId,
          lineIndex: domLine,
          patchKind,
          fieldLabel: fieldLabel || '',
          value,
        });
        if (!r?.ok) {
          showNotification(r?.error || 'Could not update NoSpos', 'warning');
          return;
        }
        setParkProgressModal((prev) => {
          if (!prev?.itemTables) return prev;
          const itemTables = prev.itemTables.map((tbl) => {
            if (tbl.itemIndex !== lineIndex) return tbl;
            const rows = tbl.rows.map((row) => {
              if (row.id !== rowId) return row;
              let display = value;
              if (row.inputKind === 'select' && Array.isArray(row.options)) {
                const hit = row.options.find((o) => String(o.value) === String(value));
                if (hit) display = hit.label;
              }
              const nextNote = r.note != null && String(r.note).trim() !== '' ? r.note : row.note;
              return {
                ...row,
                nosposValue: value,
                nosposDisplay: display,
                note: nextNote,
              };
            });
            return { ...tbl, rows };
          });
          return { ...prev, itemTables };
        });
      } catch (e) {
        showNotification(e?.message || 'Extension error', 'warning');
      }
    },
    [showNotification]
  );

  const handleRetryParkLine = useCallback(
    async (lineIndex) => {
      if (parkRetryInFlightRef.current) return;
      const tabId = parkNosposTabRef.current;
      if (tabId == null) {
        showNotification('Run Park Agreement first so a NoSpos tab is available.', 'warning');
        return;
      }
      const lines = parkNegotiationLines(items);
      const line = lines[lineIndex];
      if (!line) {
        showNotification('That line is not in the cart anymore.', 'warning');
        return;
      }
      if (line.id && parkExcludedItems.has(line.id)) {
        showNotification('This line is set to skip NosPos — uncheck Skip NosPos on the row first.', 'warning');
        return;
      }
      parkRetryInFlightRef.current = true;
      setParkRetryBusyUi(true);

      try {
        let categoriesResults = parkFlowCategoriesRef.current;
        if (!Array.isArray(categoriesResults) || categoriesResults.length === 0) {
          const catRes = await fetchNosposCategories().catch(() => ({ results: [] }));
          categoriesResults = catRes?.results || [];
          parkFlowCategoriesRef.current = categoriesResults;
        }

        const lineLabels = lines.map(
          (l, i) => `Item ${i + 1} — ${agreementParkLineTitle(l, i)}`
        );
        const catIdFirst = resolveNosposLeafCategoryIdForAgreementItem(lines[0]);
        const phaseDetails = {};

        const retryExcluded = new Set(parkExcludedItems);
        const applyDetail = (text) => {
          phaseDetails[lineIndex] = text;
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: null,
            itemStepDetails: { ...phaseDetails },
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
              excludedItemIds: retryExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: { currentLineIndex: lineIndex },
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: retryExcluded,
            }),
            allowClose: true,
          }));
        };

        const parkStepIndex = parkIncludedSequentialStepIndex(lines, retryExcluded, lineIndex);
        const itemPayload = buildParkExtensionItemPayload(line, lineIndex, {
          useVoucherOffers,
          categoriesResults,
          requestId: actualRequestId,
          parkSequentialIndex: parkStepIndex,
        });

        applyDetail(
          'Checking NoSpos item descriptions for this line (marker: request + item id)…'
        );
        const r1 = await withExtensionCallTimeout(
          resolveNosposParkAgreementLine({
            tabId,
            stepIndex: parkStepIndex,
            negotiationLineIndex: lineIndex,
            parkNegotiationLineCount: lines.length,
            item: itemPayload,
            // Retry must never click Add — find the existing row (by marker or
            // expected position) and always ensure we are on the items page.
            noAdd: true,
            ensureTab: true,
          }),
          55000,
          'Finding or adding the line on NoSpos timed out — check the NoSpos tab and retry.'
        );
        if (!r1?.ok) {
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: r1?.error || 'Could not resolve this line on NoSpos.',
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              errorIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
            }),
            allowClose: true,
          }));
          showNotification(r1?.error || 'Retry failed.', 'warning');
          return;
        }

        const targetIdx = r1.targetLineIndex;
        parkNosposDomLineByItemRef.current[lineIndex] = targetIdx;

        if (r1.reusedExistingRow) {
          applyDetail(
            'Found this line on NoSpos by marker — checking and filling missing fields only (no Add / no category reset)…'
          );
        } else if (r1.didClickAdd) {
          applyDetail(
            'Pressed Add item — waited for NosPos to reload (up to 20s). Setting category…'
          );
        } else {
          applyDetail('Using the target row — setting category…');
        }

        let rCat = { ok: true, categoryLabel: null, restLineIndex: targetIdx };
        if (!r1.reusedExistingRow) {
          rCat = await withExtensionCallTimeout(
            fillNosposParkAgreementCategory({
              tabId,
              lineIndex: targetIdx,
              item: itemPayload,
            }),
            90000,
            'Setting category on NoSpos timed out.'
          );
          if (!rCat?.ok) {
            setParkProgressModal((prev) => ({
              ...prev,
              footerError: rCat?.error || 'Could not set category on NoSpos.',
              systemSteps: buildParkAgreementSystemSteps(lineLabels, {
                errorIndex: lineIndex,
                loginStatus: 'done',
                openStatus: 'done',
                itemStepDetails: { ...phaseDetails },
              }),
              itemTables: buildParkItemTablesFromFill({
                lines,
                fieldRows: [],
                fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
                progressive: undefined,
                categoryId: catIdFirst,
                categoriesResults,
                agreementParkLineTitle,
              }),
              allowClose: true,
            }));
            showNotification(rCat?.error || 'Category step failed.', 'warning');
            return;
          }
        }

        applyDetail(
          'Category set — NosPos may have reloaded (up to 20s). Filling name, description, prices, quantity, and stock fields…'
        );

        const lineForRestRetry =
          rCat.restLineIndex != null && rCat.restLineIndex >= 0
            ? rCat.restLineIndex
            : targetIdx;
        parkNosposDomLineByItemRef.current[lineIndex] = lineForRestRetry;

        const rRest = await withExtensionCallTimeout(
          fillNosposParkAgreementRest({
            tabId,
            lineIndex: lineForRestRetry,
            item: itemPayload,
            categoryLabel: rCat.categoryLabel ?? null,
          }),
          120000,
          'Filling fields on NoSpos timed out.'
        );
        if (!rRest?.ok) {
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: rRest?.error || 'Could not fill fields on NoSpos.',
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              errorIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
            }),
            allowClose: true,
          }));
          showNotification(rRest?.error || 'Fill step failed.', 'warning');
          return;
        }

        if (Array.isArray(rRest.fieldRows) && rRest.fieldRows.length > 0) {
          parkFieldRowsByIndexRef.current = {
            ...parkFieldRowsByIndexRef.current,
            [lineIndex]: rRest.fieldRows,
          };
        }
        phaseDetails[lineIndex] = 'Filled all fields on NoSpos for this line.';
        setParkProgressModal((prev) => ({
          ...prev,
          footerError: null,
          itemStepDetails: { ...phaseDetails },
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            allDone: true,
            loginStatus: 'done',
            openStatus: 'done',
            itemStepDetails: { ...phaseDetails },
            excludedItemIds: retryExcluded,
            lines,
          }),
          itemTables: buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
            progressive: undefined,
            categoryId: catIdFirst,
            categoriesResults,
            agreementParkLineTitle,
            excludedItemIds: retryExcluded,
          }),
          allowClose: true,
        }));
        showNotification(`Item ${lineIndex + 1} re-synced on NoSpos.`, 'success');
      } catch (e) {
        showNotification(e?.message || 'Retry failed.', 'error');
      } finally {
        parkRetryInFlightRef.current = false;
        setParkRetryBusyUi(false);
      }
    },
    [items, useVoucherOffers, actualRequestId, showNotification, parkExcludedItems]
  );

  /** Debounced persist of park state (excluded items + parked URL) to the DB. */
  const scheduleParkStateSave = useCallback((url, excludedSet) => {
    if (!actualRequestId || !researchSandboxBookedView) return;
    if (parkStateSaveTimerRef.current) clearTimeout(parkStateSaveTimerRef.current);
    parkStateSaveTimerRef.current = setTimeout(() => {
      const excludedItemIds = items
        .filter((item) => excludedSet.has(item.id))
        .map((item) => String(item.request_item_id ?? item.id))
        .filter((s) => s && s !== 'undefined' && s !== 'null');
      saveParkAgreementState(actualRequestId, {
        nosposAgreementUrl: url ?? null,
        excludedItemIds,
      }).catch(() => {});
    }, 800);
  }, [actualRequestId, researchSandboxBookedView, items]);

  /** Opens the saved NosPos agreement items URL in a new browser tab only (no extension). */
  const handleViewParkedAgreement = useCallback(() => {
    const urlToOpen = persistedNosposUrl;
    if (!urlToOpen || typeof urlToOpen !== 'string') {
      showNotification(
        'No parked agreement link saved yet. Finish a park run so the items URL is stored, then try again.',
        'warning'
      );
      return;
    }
    window.open(urlToOpen, '_blank', 'noopener,noreferrer');
  }, [persistedNosposUrl, showNotification]);

  const handleToggleParkExcludeItem = useCallback((itemIndex) => {
    setParkExcludedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemIndex)) {
        next.delete(itemIndex);
      } else {
        next.add(itemIndex);
      }
      scheduleParkStateSave(persistedNosposUrl, next);
      return next;
    });
  }, [scheduleParkStateSave, persistedNosposUrl]);

  const handleParkAgreementOpenNospos = useCallback(() => {
    if (!researchSandboxBookedView) return;
    const nid = customerData?.nospos_customer_id;
    if (!buildNosposNewAgreementCreateUrl(nid, transactionType)) {
      showNotification('No NoSpos customer id on file for this request.', 'warning');
      return;
    }
    const agreementType = transactionType === 'buyback' ? 'PA' : 'DP';
    const lines = parkNegotiationLines(items);
    const firstLine = lines[0];
    const lineLabels = lines.map(
      (l, i) => `Item ${i + 1} — ${agreementParkLineTitle(l, i)}`
    );

    parkNosposTabRef.current = null;
    // Keep field rows from previous run so the modal shows existing data immediately.
    // Only reset the DOM-line map since it is tab-specific.
    parkNosposDomLineByItemRef.current = {};
    const prevFieldRowsByIndex = { ...parkFieldRowsByIndexRef.current };
    const catIdForSeed = lines[0] ? resolveNosposLeafCategoryIdForAgreementItem(lines[0]) : null;
    const catResultsForSeed = parkFlowCategoriesRef.current || [];
    const currentExcluded = new Set(parkExcludedItems);
    setParkProgressModal({
      systemSteps: buildParkAgreementSystemSteps(lineLabels, {
        activeIndex: null,
        loginStatus: 'running',
        openStatus: 'pending',
        excludedItemIds: currentExcluded,
        lines,
      }),
      itemTables: Object.keys(prevFieldRowsByIndex).length > 0
        ? buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: prevFieldRowsByIndex,
            progressive: undefined,
            categoryId: catIdForSeed,
            categoriesResults: catResultsForSeed,
            agreementParkLineTitle,
            excludedItemIds: currentExcluded,
          })
        : null,
      footerError: null,
      allowClose: false,
      itemStepDetails: {},
    });

    void (async () => {
      try {
        const check = await withExtensionCallTimeout(
          checkNosposCustomerBuyingSession(nid),
          undefined,
          'NoSpos did not respond in time — make sure the Chrome extension is active and try again.'
        );
        if (check?.loginRequired) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'error',
              openStatus: 'pending',
            }),
            itemTables: null,
            footerError: 'Sign in at nospos.com in this browser, then try Park Agreement again.',
            allowClose: true,
          });
          showNotification(
            'NosPos needs you to be logged in first. Sign in at nospos.com in Chrome, then try Park Agreement again.',
            'error'
          );
          return;
        }
        if (!check?.ok) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'error',
              openStatus: 'pending',
            }),
            itemTables: null,
            footerError: check?.error || 'Session check failed.',
            allowClose: true,
          });
          showNotification(check?.error || 'Could not verify NoSpos.', 'warning');
          return;
        }

        setParkProgressModal({
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            activeIndex: null,
            loginStatus: 'done',
            openStatus: 'running',
          }),
          itemTables: null,
          footerError: null,
          allowClose: false,
        });

        const opened = await withExtensionCallTimeout(
          openNosposNewAgreementCreateBackground(nid, { agreementType }),
          undefined,
          'NoSpos did not respond in time — make sure the Chrome extension is active and try again.'
        );
        if (!opened?.ok || opened.tabId == null) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'error',
            }),
            itemTables: null,
            footerError: opened?.error || 'Could not open NoSpos.',
            allowClose: true,
          });
          showNotification(opened?.error || 'Could not open NoSpos.', 'warning');
          return;
        }
        const { tabId } = opened;

        const catRes = await fetchNosposCategories().catch(() => ({ results: [] }));
        const categoriesResults = catRes?.results || [];
        parkFlowCategoriesRef.current = categoriesResults;
        const itemPayloads = lines.map((line, idx) =>
          buildParkExtensionItemPayload(line, idx, {
            useVoucherOffers,
            categoriesResults,
            requestId: actualRequestId,
            parkSequentialIndex: parkIncludedSequentialStepIndex(lines, currentExcluded, idx),
          })
        );

        if (!firstLine) {
          parkNosposTabRef.current = tabId;
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps([], { allDone: true }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              categoryId: null,
              categoriesResults,
              agreementParkLineTitle,
            }),
            footerError: null,
            allowClose: true,
          });
          return;
        }

        const catIdFirst = resolveNosposLeafCategoryIdForAgreementItem(firstLine);
        const itemStepDetails = {};
        /** Shown as its own Progress step (spinner while running). */
        let nosposCleanupStep = null;

        const excludedRequestItemIds = [
          ...new Set(
            lines
              .filter((line) => line?.id && currentExcluded.has(line.id))
              .map((line) => {
                const rid = line.request_item_id;
                if (rid == null || String(rid).trim() === '') return null;
                const s = String(rid).trim();
                return /^\d+$/.test(s) ? s : null;
              })
              .filter(Boolean)
          ),
        ];
        if (excludedRequestItemIds.length > 0) {
          const nDel = excludedRequestItemIds.length;
          nosposCleanupStep = {
            status: 'running',
            detail: `Deleting ${nDel} skipped line(s) on NoSpos (match \`-RI-{id}-\` in item description, then Actions → Delete). Waiting for reloads after each removal (~20s each). Keep the NoSpos tab open.`,
          };
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'done',
              nosposCleanup: nosposCleanupStep,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: null,
            allowClose: false,
          });
          const cleanupBudgetMs = 90000 + excludedRequestItemIds.length * 28000;
          try {
            const delRes = await withExtensionCallTimeout(
              deleteExcludedNosposAgreementLines({
                tabId,
                requestItemIds: excludedRequestItemIds,
              }),
              cleanupBudgetMs,
              'Removing skipped items on NoSpos took too long — finish deletes in the NoSpos tab if needed.'
            );
            nosposCleanupStep = {
              status: 'done',
              detail:
                delRes?.deleted?.length > 0
                  ? `Done — removed ${delRes.deleted.length} row(s) on NoSpos. Continuing with included lines…`
                  : 'Done — no matching rows on NoSpos (already deleted or never parked). Continuing…',
            };
            if (delRes?.deleted?.length) {
              showNotification(
                `Removed ${delRes.deleted.length} skipped item(s) from the NoSpos agreement.`,
                'success'
              );
            }
          } catch (e) {
            nosposCleanupStep = {
              status: 'error',
              detail: String(
                e?.message ||
                  'Cleanup timed out or failed — remove skipped rows manually on NoSpos if needed. Continuing with included lines…'
              ),
            };
            showNotification(
              e?.message ||
                'Could not remove all skipped rows from NoSpos — delete them manually if they still appear.',
              'warning'
            );
          }
          parkNosposDomLineByItemRef.current = {};
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'done',
              nosposCleanup: nosposCleanupStep,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: null,
            allowClose: false,
          });
        }

        const refreshModal = (i, patch = {}) => {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: patch.errorIndex != null ? null : i,
              loginStatus: 'done',
              openStatus: 'done',
              errorIndex: patch.errorIndex,
              allDone: patch.allDone,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
              nosposCleanup: nosposCleanupStep,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: patch.progressive,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: patch.footerError ?? null,
            allowClose: patch.allowClose ?? false,
            itemStepDetails: { ...itemStepDetails },
          });
        };

        for (let i = 0; i < itemPayloads.length; i++) {
          // Skip items the user has chosen to exclude from this run (matched by item ID).
          if (lines[i]?.id && currentExcluded.has(lines[i].id)) {
            itemStepDetails[i] = 'Excluded from this run — skipped on NoSpos.';
            refreshModal(i + 1, { progressive: { currentLineIndex: i + 1 } });
            continue;
          }

          const setLineDetail = (text) => {
            itemStepDetails[i] = text;
            refreshModal(i, { progressive: { currentLineIndex: i } });
          };

          setLineDetail(
            'Checking NoSpos item descriptions for this line (marker: request + item id)…'
          );

          const parkStepIndex = parkIncludedSequentialStepIndex(lines, currentExcluded, i);
          const resolveTimeoutMs = 55000;
          const r1 = await withExtensionCallTimeout(
            resolveNosposParkAgreementLine({
              tabId,
              stepIndex: parkStepIndex,
              negotiationLineIndex: i,
              parkNegotiationLineCount: lines.length,
              item: itemPayloads[i],
            }),
            resolveTimeoutMs,
            `Item ${i + 1}: finding or adding the line on NoSpos timed out.`
          );

          if (!r1?.ok) {
            parkNosposTabRef.current = tabId;
            refreshModal(i, {
              progressive: undefined,
              footerError: r1?.error || `Could not complete item ${i + 1} on NoSpos.`,
              allowClose: true,
              errorIndex: i,
            });
            showNotification(
              r1?.error || `Could not complete item ${i + 1} on NoSpos.`,
              'warning'
            );
            return;
          }

          const targetIdx = r1.targetLineIndex;
          parkNosposDomLineByItemRef.current[i] = targetIdx;

          if (r1.reusedExistingRow) {
            setLineDetail(
              'Found this line on NoSpos by marker — checking and filling missing fields only (no Add / no category reset)…'
            );
          } else if (r1.didClickAdd) {
            setLineDetail(
              'Pressed Add item — waited for NosPos to reload (up to 20s). Setting category…'
            );
          } else {
            setLineDetail('Using the target row — setting category…');
          }

          let rCat = { ok: true, categoryLabel: null, restLineIndex: targetIdx };
          if (!r1.reusedExistingRow) {
            rCat = await withExtensionCallTimeout(
              fillNosposParkAgreementCategory({
                tabId,
                lineIndex: targetIdx,
                item: itemPayloads[i],
              }),
              90000,
              `Item ${i + 1}: category step timed out on NoSpos.`
            );

            if (!rCat?.ok) {
              parkNosposTabRef.current = tabId;
              refreshModal(i, {
                progressive: undefined,
                footerError: rCat?.error || `Could not set category for item ${i + 1} on NoSpos.`,
                allowClose: true,
                errorIndex: i,
              });
              showNotification(
                rCat?.error || `Could not set category for item ${i + 1} on NoSpos.`,
                'warning'
              );
              return;
            }
          }

          setLineDetail(
            'Category set — NosPos may reload (up to 20s). Filling name, description, prices, quantity, and stock fields…'
          );

          const lineForRest =
            rCat.restLineIndex != null && rCat.restLineIndex >= 0
              ? rCat.restLineIndex
              : targetIdx;
          parkNosposDomLineByItemRef.current[i] = lineForRest;

          const stepTimeoutMs = Math.min(180000, 75000 + (itemPayloads[i].stockFields?.length || 0) * 8000);
          const rRest = await withExtensionCallTimeout(
            fillNosposParkAgreementRest({
              tabId,
              lineIndex: lineForRest,
              item: itemPayloads[i],
              categoryLabel: rCat.categoryLabel ?? null,
            }),
            stepTimeoutMs,
            `Item ${i + 1} took too long filling fields on NoSpos. Check the NoSpos tab or use Retry on that line.`
          );

          if (!rRest?.ok) {
            parkNosposTabRef.current = tabId;
            refreshModal(i, {
              progressive: undefined,
              footerError: rRest?.error || `Could not complete item ${i + 1} on NoSpos.`,
              allowClose: true,
              errorIndex: i,
            });
            showNotification(
              rRest?.error || `Could not complete item ${i + 1} on NoSpos.`,
              'warning'
            );
            return;
          }

          if (Array.isArray(rRest.fieldRows) && rRest.fieldRows.length > 0) {
            parkFieldRowsByIndexRef.current[i] = rRest.fieldRows;
          }
          itemStepDetails[i] = 'Filled all fields on NoSpos for this line.';
          refreshModal(i, { progressive: { currentLineIndex: i } });
        }

        try {
          const parkSidebarRes = await withExtensionCallTimeout(
            clickNosposSidebarParkAgreement({ tabId }),
            65000,
            'Parking the agreement on NoSpos (Next, then Actions → Park Agreement) timed out.'
          );
          if (!parkSidebarRes?.ok) {
            showNotification(
              parkSidebarRes?.error ||
                'Could not finish Park Agreement in the NoSpos sidebar — use Actions → Park Agreement there.',
              'warning'
            );
          }
        } catch (e) {
          showNotification(
            e?.message ||
              'Could not finish Park Agreement on NoSpos — use Actions → Park Agreement there.',
            'warning'
          );
        }

        parkNosposTabRef.current = tabId;
        setParkProgressModal({
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            allDone: true,
            loginStatus: 'done',
            openStatus: 'done',
            itemStepDetails: { ...itemStepDetails },
            excludedItemIds: currentExcluded,
            lines,
            nosposCleanup: nosposCleanupStep,
          }),
          itemTables: buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
            progressive: undefined,
            categoryId: catIdFirst,
            categoriesResults,
            agreementParkLineTitle,
            excludedItemIds: currentExcluded,
          }),
          footerError: null,
          allowClose: true,
          itemStepDetails: { ...itemStepDetails },
        });

        // Capture the live NosPos agreement URL and persist park state to DB
        try {
          const tabUrlResult = await getNosposTabUrl(tabId);
          const capturedUrl = tabUrlResult?.ok && tabUrlResult.url ? tabUrlResult.url : null;
          if (capturedUrl) {
            setPersistedNosposUrl(capturedUrl);
            scheduleParkStateSave(capturedUrl, currentExcluded);
          }
        } catch (_) {}

        showNotification(
          lines.length === 1
            ? 'Line updated in NoSpos. Review the table below or edit values.'
            : `${lines.length} lines updated in NoSpos. Review the tables below or edit values.`,
          'success'
        );
      } catch (err) {
        setParkProgressModal((prev) =>
          prev
            ? { ...prev, footerError: err?.message || 'Extension error', allowClose: true }
            : {
                systemSteps: buildParkAgreementSystemSteps(lineLabels, {
                  activeIndex: null,
                  loginStatus: 'error',
                  openStatus: 'pending',
                }),
                itemTables: null,
                footerError: err?.message || 'Extension error',
                allowClose: true,
              }
        );
        showNotification(
          err?.message ||
            'Chrome extension is required for Park Agreement, or the request timed out — try again.',
          'error'
        );
      }
    })();
  }, [
    items,
    researchSandboxBookedView,
    customerData?.nospos_customer_id,
    transactionType,
    showNotification,
    useVoucherOffers,
    actualRequestId,
    parkExcludedItems,
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
    const {
      skipSuccessNotification = false,
      addedFromBuilder = false,
      /** CeX header / jewellery workspace: run same NosPos stock category + field AI as builder */
      runNosposCategoryAiForInternalLeaf = false,
      /** When true, run AI even if internal category root is not `ready_for_builder` (Jewellery) */
      nosposAiSkipReadyForBuilderCheck = false,
    } = options;
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

      const scheduledFullNosposAi =
        reqItemId &&
        normalizedItem.categoryObject?.id != null &&
        (addedFromBuilder || runNosposCategoryAiForInternalLeaf);

      if (scheduledFullNosposAi) {
        const lineId = normalizedItem.id;
        const catId = normalizedItem.categoryObject.id;
        const skipReadyForBuilderCheck =
          addedFromBuilder || nosposAiSkipReadyForBuilderCheck === true;
        const pathLogTag = addedFromBuilder
          ? '[CG Suite][NosposPathMatch][builder]'
          : normalizedItem.isJewelleryItem
            ? '[CG Suite][NosposPathMatch][jewellery]'
            : '[CG Suite][NosposPathMatch][cex]';
        const categorySource = addedFromBuilder
          ? 'builder_ai'
          : normalizedItem.isJewelleryItem
            ? 'jewellery_workspace_ai'
            : 'cex_workspace_ai';
        const fieldAiSource = categorySource;
        const fieldAiLogLabel = addedFromBuilder
          ? 'builder'
          : normalizedItem.isJewelleryItem
            ? 'jewellery'
            : 'cex';
        void (async () => {
          try {
            const itemSummary = summariseNegotiationItemForAi(normalizedItem);
            const match = await runNosposStockCategoryAiMatchBackground({
              internalCategoryId: catId,
              itemSummary,
              skipReadyForBuilderCheck,
              logTag: pathLogTag,
            });
            if (!match) return;
            const aiSuggestedNosposStockCategory = {
              nosposId: match.nosposId != null ? Number(match.nosposId) : null,
              fullName: match.fullName,
              pathSegments: match.pathSegments,
              source: categorySource,
              savedAt: new Date().toISOString(),
            };
            await updateRequestItemRawData(reqItemId, {
              raw_data: { aiSuggestedNosposStockCategory },
            });
            const rowWithCategoryHint = {
              ...normalizedItem,
              aiSuggestedNosposStockCategory,
              rawData:
                normalizedItem.rawData != null && typeof normalizedItem.rawData === 'object'
                  ? { ...normalizedItem.rawData, aiSuggestedNosposStockCategory }
                  : { aiSuggestedNosposStockCategory },
            };
            let aiSuggestedNosposStockFieldValues = null;
            if (match.nosposId != null && Number(match.nosposId) > 0) {
              try {
                aiSuggestedNosposStockFieldValues = await buildNosposStockFieldAiPayload({
                  nosposCategoryId: match.nosposId,
                  negotiationItem: rowWithCategoryHint,
                  source: fieldAiSource,
                });
              } catch (fe) {
                console.log(`[CG Suite][NosposFieldAi][${fieldAiLogLabel}] error`, fe);
              }
              if (aiSuggestedNosposStockFieldValues) {
                const fvSaveResult = await updateRequestItemRawData(reqItemId, {
                  raw_data: { aiSuggestedNosposStockFieldValues },
                });
                if (fvSaveResult) {
                  console.log(`[CG Suite][NosposFieldAi][${fieldAiLogLabel}] DB save OK`, {
                    reqItemId,
                    nosposCategoryId: aiSuggestedNosposStockFieldValues.nosposCategoryId,
                    savedFields: Object.fromEntries(
                      Object.entries(aiSuggestedNosposStockFieldValues.byNosposFieldId || {}).map(
                        ([id, val]) => [id, val]
                      )
                    ),
                  });
                } else {
                  console.error(
                    `[CG Suite][NosposFieldAi][${fieldAiLogLabel}] DB save FAILED — updateRequestItemRawData returned null`,
                    { reqItemId }
                  );
                }
              }
            }
            setItems((prev) =>
              prev.map((row) => {
                if (row.id !== lineId) return row;
                const nextRaw =
                  row.rawData != null && typeof row.rawData === 'object'
                    ? {
                        ...row.rawData,
                        aiSuggestedNosposStockCategory,
                        ...(aiSuggestedNosposStockFieldValues
                          ? { aiSuggestedNosposStockFieldValues }
                          : {}),
                      }
                    : {
                        aiSuggestedNosposStockCategory,
                        ...(aiSuggestedNosposStockFieldValues
                          ? { aiSuggestedNosposStockFieldValues }
                          : {}),
                      };
                if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
                  return {
                    ...row,
                    aiSuggestedNosposStockCategory,
                    ...(aiSuggestedNosposStockFieldValues ? { aiSuggestedNosposStockFieldValues } : {}),
                    rawData: nextRaw,
                    ebayResearchData: {
                      ...row.ebayResearchData,
                      aiSuggestedNosposStockCategory,
                      ...(aiSuggestedNosposStockFieldValues
                        ? { aiSuggestedNosposStockFieldValues }
                        : {}),
                    },
                  };
                }
                return {
                  ...row,
                  aiSuggestedNosposStockCategory,
                  ...(aiSuggestedNosposStockFieldValues ? { aiSuggestedNosposStockFieldValues } : {}),
                  rawData: nextRaw,
                };
              })
            );
          } catch (e) {
            console.log(`${pathLogTag} persist error`, e);
          }
        })();
      }

      if (!scheduledFullNosposAi && reqItemId) {
        const hint = getAiSuggestedNosposStockCategoryFromItem(normalizedItem);
        const nid = hint?.nosposId != null ? Number(hint.nosposId) : null;
        const existingFv = getAiSuggestedNosposStockFieldValuesFromItem(normalizedItem);
        const already =
          existingFv?.byNosposFieldId &&
          typeof existingFv.byNosposFieldId === 'object' &&
          Object.keys(existingFv.byNosposFieldId).length > 0 &&
          Number(existingFv.nosposCategoryId) === nid;
        if (nid != null && nid > 0 && !already) {
          const lineId = normalizedItem.id;
          void (async () => {
            try {
              const aiSuggestedNosposStockFieldValues = await buildNosposStockFieldAiPayload({
                nosposCategoryId: nid,
                negotiationItem: normalizedItem,
                source: 'negotiation_add',
              });
              if (!aiSuggestedNosposStockFieldValues) return;
              const fvSaveResult = await updateRequestItemRawData(reqItemId, {
                raw_data: { aiSuggestedNosposStockFieldValues },
              });
              if (fvSaveResult) {
                console.log('[CG Suite][NosposFieldAi][negotiation_add] DB save OK', {
                  reqItemId,
                  nosposCategoryId: aiSuggestedNosposStockFieldValues.nosposCategoryId,
                  savedFields: { ...aiSuggestedNosposStockFieldValues.byNosposFieldId },
                });
              } else {
                console.error('[CG Suite][NosposFieldAi][negotiation_add] DB save FAILED — updateRequestItemRawData returned null', { reqItemId });
              }
              setItems((prev) =>
                prev.map((row) => {
                  if (row.id !== lineId) return row;
                  const nextRaw =
                    row.rawData != null && typeof row.rawData === 'object'
                      ? { ...row.rawData, aiSuggestedNosposStockFieldValues }
                      : { aiSuggestedNosposStockFieldValues };
                  if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
                    return {
                      ...row,
                      aiSuggestedNosposStockFieldValues,
                      rawData: nextRaw,
                      ebayResearchData: {
                        ...row.ebayResearchData,
                        aiSuggestedNosposStockFieldValues,
                      },
                    };
                  }
                  return { ...row, aiSuggestedNosposStockFieldValues, rawData: nextRaw };
                })
              );
            } catch (e) {
              console.log('[CG Suite][NosposFieldAi][negotiation_add] error', e);
            }
          })();
        }
      }

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
  }, [createOrAppendRequestItem, parseManualOfferValue, showNotification, useVoucherOffers, updateRequestItemRawData]);

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
        const ok = await handleAddNegotiationItem(nextItem, {
          addedFromBuilder: workspaceModeAtAttempt === 'builder',
          runNosposCategoryAiForInternalLeaf:
            workspaceModeAtAttempt === 'cex' || workspaceModeAtAttempt === 'jewellery',
          nosposAiSkipReadyForBuilderCheck: workspaceModeAtAttempt === 'jewellery',
        });
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
      let fallbackJewelleryCategoryId = null;
      try {
        const jewCat = await fetchJewelleryCatalog();
        fallbackJewelleryCategoryId = jewCat?.category_id ?? null;
      } catch {
        /* best effort — lines may still carry jewelleryDbCategoryId */
      }
      for (const line of draftWorkspaceLines) {
        try {
          const cartItem = buildJewelleryNegotiationCartItem(
            line,
            useVoucherOffers,
            customerOfferRulesData?.settings,
            fallbackJewelleryCategoryId
          );
          const ok = await handleAddNegotiationItem(cartItem, {
            skipSuccessNotification: true,
            runNosposCategoryAiForInternalLeaf: true,
            nosposAiSkipReadyForBuilderCheck: true,
          });
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

          // Restore persisted park state (excluded lines, parked agreement URL)
          const parkState = data.park_agreement_state_json;
          if (parkState && typeof parkState === 'object') {
            const savedUrl = typeof parkState.nosposAgreementUrl === 'string' && parkState.nosposAgreementUrl.trim()
              ? parkState.nosposAgreementUrl.trim()
              : null;
            setPersistedNosposUrl(savedUrl);
            if (Array.isArray(parkState.excludedItemIds) && parkState.excludedItemIds.length > 0) {
              const excluded = new Set(parkState.excludedItemIds.map(String));
              // Translate persisted item-id strings to request_item_ids matching the loaded items
              // parkExcludedItems keyed by item.id (CG cart id). For view-mode items those are
              // request_item_id values cast to strings. We match against both.
              const resolvedExcluded = new Set();
              mappedItems.forEach((item) => {
                const rid = String(item.request_item_id ?? '');
                const cid = String(item.id ?? '');
                if (excluded.has(rid) || excluded.has(cid)) resolvedExcluded.add(item.id);
              });
              if (resolvedExcluded.size > 0) setParkExcludedItems(resolvedExcluded);
            }
          }

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
                      In-store testing — Park Agreement opens NoSpos and fills the first line category when CG Suite has one
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
                  parkExcludedItems={researchSandboxBookedView ? parkExcludedItems : null}
                  onToggleParkExcludeItem={researchSandboxBookedView ? handleToggleParkExcludeItem : null}
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
                    {researchSandboxBookedView ? (
                      <th className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-amber-600">
                        Skip NosPos
                      </th>
                    ) : null}
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
                      parkExcluded={researchSandboxBookedView ? parkExcludedItems.has(item.id) : false}
                      onToggleParkExclude={researchSandboxBookedView ? () => handleToggleParkExcludeItem(item.id) : null}
                    />
                  ))}
                  <tr className="h-10 opacity-50">
                    <td colSpan={researchSandboxBookedView ? 16 : 15}></td>
                  </tr>
                  <tr className="h-10 opacity-50">
                    <td colSpan={researchSandboxBookedView ? 16 : 15}></td>
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
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98]"
                  style={{
                    background: 'var(--brand-orange)',
                    color: 'var(--brand-blue)',
                    boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)',
                  }}
                  onClick={handleParkAgreementOpenNospos}
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden>task_alt</span>
                  <span className="text-base uppercase tracking-tight">
                    {persistedNosposUrl ? 'Rerun Park Agreement' : 'Park Agreement'}
                  </span>
                  <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform" aria-hidden>arrow_forward</span>
                </button>
                {persistedNosposUrl && (
                  <button
                    type="button"
                    className="w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98]"
                    style={{
                      background: 'var(--brand-blue)',
                      color: '#fff',
                      boxShadow: '0 6px 15px -3px rgba(0,0,0,0.25)',
                    }}
                    onClick={handleViewParkedAgreement}
                  >
                    <span className="material-symbols-outlined text-xl" aria-hidden>open_in_new</span>
                    <span className="text-base uppercase tracking-tight">View Parked Agreement</span>
                  </button>
                )}
              </div>
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

      {parkProgressModal ? (
        <ParkAgreementProgressModal
          open
          onClose={() => {
            parkNosposTabRef.current = null;
            setParkProgressModal(null);
          }}
          systemSteps={parkProgressModal.systemSteps}
          itemTables={parkProgressModal.itemTables}
          footerError={parkProgressModal.footerError}
          allowClose={parkProgressModal.allowClose}
          onPatchField={handleParkFieldPatch}
          onRetryParkLine={handleRetryParkLine}
          parkRetryBusy={parkRetryBusyUi}
          parkLineRetryEnabled={
            parkProgressModal.allowClose === true || Boolean(parkProgressModal.footerError)
          }
          onViewParkedAgreement={handleViewParkedAgreement}
        />
      ) : null}

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
