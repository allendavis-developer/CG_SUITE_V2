import { useCallback, useEffect, useRef } from 'react';
import useAppStore from '@/store/useAppStore';
import {
  buildJewelleryNegotiationCartItem,
  computeWorkspaceLineTotal,
} from '@/components/jewellery/jewelleryNegotiationCart';
import {
  negotiationJewelleryItemToWorkspaceLine,
  deriveNegotiationJewelleryCoinUnitsUpdate,
  deriveNegotiationJewelleryWeightUpdate,
} from '@/components/jewellery/jewelleryWorkspaceMapping';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import {
  deleteRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
  fetchJewelleryCatalog,
  fetchNosposCategories,
  fetchNosposCategoryMappings,
  fetchAllCategoriesFlat,
} from '@/services/api';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import {
  normalizeCartItemForNegotiation,
  getDisplayOffers,
  resolveOurSalePrice,
  logCategoryRuleDecision,
  resolveCustomerExpectationDraftForAdd,
  applyRrpOnlyFromPriceSource,
  applyOffersOnlyFromPriceSource,
} from '../utils/negotiationHelpers';
import {
  summariseNegotiationItemForAi,
  runNosposStockCategoryAiMatchBackground,
  isProductCategoryRootReadyForBuilder,
  getInternalProductCategoryRootMeta,
} from '@/services/aiCategoryPathCascade';
import {
  getAiSuggestedNosposStockCategoryFromItem,
  getAiSuggestedNosposStockFieldValuesFromItem,
  resolveNosposStockLeafIdForNegotiationLine,
} from '@/utils/nosposCategoryMappings';
import { buildNosposStockFieldAiPayload } from '../utils/nosposFieldAiAtAdd';
import { makeSalePriceBlurHandler } from './useResearchOverlay';
import { useRefreshCexRowData } from './useRefreshCexRowData';
import { EBAY_TOP_LEVEL_CATEGORY } from '../constants';
import { ENABLE_NOSPOS_STOCK_FIELD_AI } from '@/config/cgSuiteFeatureFlags';
import {
  buildMergedNosposStockFieldValuesBlob,
  applyNosposStockFieldBlobToNegotiationItems,
} from '@/pages/buyer/utils/negotiationMissingNosposRequired';
import { getJewelleryNosposWeightSyncPlan } from '@/pages/buyer/utils/nosposAgreementFirstItemFill';

function mergeNosposAiOntoNegotiationRow(row, aiSuggestedNosposStockCategory, aiSuggestedNosposStockFieldValues) {
  const prevFv = getAiSuggestedNosposStockFieldValuesFromItem(row);
  let fieldBlob = aiSuggestedNosposStockFieldValues;

  if (fieldBlob?.byNosposFieldId && typeof fieldBlob.byNosposFieldId === 'object') {
    const newHasValue = Object.keys(fieldBlob.byNosposFieldId).some(
      (k) => String(fieldBlob.byNosposFieldId[k] ?? '').trim() !== ''
    );
    const prevById = prevFv?.byNosposFieldId;
    if (!newHasValue) {
      fieldBlob = null;
    } else if (prevById && typeof prevById === 'object') {
      fieldBlob = {
        ...prevFv,
        ...fieldBlob,
        byNosposFieldId: { ...prevById, ...fieldBlob.byNosposFieldId },
      };
    }
  } else if (fieldBlob && (!fieldBlob.byNosposFieldId || typeof fieldBlob.byNosposFieldId !== 'object')) {
    fieldBlob = null;
  }

  const nextRaw =
    row.rawData != null && typeof row.rawData === 'object'
      ? {
          ...row.rawData,
          aiSuggestedNosposStockCategory,
          ...(fieldBlob ? { aiSuggestedNosposStockFieldValues: fieldBlob } : {}),
        }
      : {
          aiSuggestedNosposStockCategory,
          ...(fieldBlob ? { aiSuggestedNosposStockFieldValues: fieldBlob } : {}),
        };
  if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
    return {
      ...row,
      aiSuggestedNosposStockCategory,
      ...(fieldBlob ? { aiSuggestedNosposStockFieldValues: fieldBlob } : {}),
      rawData: nextRaw,
      ebayResearchData: {
        ...row.ebayResearchData,
        aiSuggestedNosposStockCategory,
        ...(fieldBlob ? { aiSuggestedNosposStockFieldValues: fieldBlob } : {}),
      },
    };
  }
  return {
    ...row,
    aiSuggestedNosposStockCategory,
    ...(fieldBlob ? { aiSuggestedNosposStockFieldValues: fieldBlob } : {}),
    rawData: nextRaw,
  };
}

function negotiationOffersJsonForApi(offers) {
  if (!Array.isArray(offers)) return [];
  return offers.map((o) => ({
    id: o.id,
    title: o.title,
    price: normalizeExplicitSalePrice(o.price),
  }));
}

/** NosPos leaf for suggest-fields using the same resolution order as the rest of negotiation. */
async function resolveNosposLeafIdForNegotiationFieldAi(negotiationItem) {
  try {
    const [catData, mappings] = await Promise.all([fetchNosposCategories(), fetchNosposCategoryMappings()]);
    const catResults = Array.isArray(catData?.results) ? catData.results : [];
    const mapList = Array.isArray(mappings) ? mappings : [];
    const id = resolveNosposStockLeafIdForNegotiationLine(negotiationItem, {
      categoryMappings: mapList,
      nosposCategoriesResults: catResults,
    });
    if (id != null && Number(id) > 0) return id;
    return null;
  } catch {
    return null;
  }
}

export function useNegotiationItemHandlers({
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
  getPendingCustomerExpectationMap = null,
  consumeCustomerExpectationDraftKeys = null,
  nosposCategoriesResults = null,
  nosposCategoryMappings = null,
  setCexPencilRrpSourceModal = null,
}) {
  const jewelleryNosposEarlyAiStartedRef = useRef(new Set());
  const handleQuantityChange = useCallback((itemId, newQty) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, quantity: newQty } : i)));
  }, [setItems]);

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
  }, [setItems]);

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
  }, [setItems]);

  const handleBlockedOfferClick = useCallback((slot, offer, item) => {
    setBlockedOfferModal({ slot, offer, item });
  }, [setBlockedOfferModal]);

  const handleResearchBlockedOfferClick = useCallback(
    (payload, contextItem) => {
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
    },
    [markItemSlotAuthorised, setBlockedOfferModal, setItemOfferModal, setItems, useVoucherOffers]
  );

  const handleCustomerExpectationChange = useCallback((itemId, value) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, customerExpectation: value } : i)));
  }, [setItems]);

  const handleOurSalePriceChange = useCallback((itemId, value) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ourSalePriceInput: value } : i)));
  }, [setItems]);

  const handleOurSalePriceBlur = useCallback(
    makeSalePriceBlurHandler(setItems, normalizeExplicitSalePrice, showNotification),
    [setItems, showNotification]
  );

  const handleOurSalePriceFocus = useCallback((itemId, currentValue) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ourSalePriceInput: currentValue } : i)));
  }, [setItems]);

  const handleRemoveFromNegotiation = useCallback(
    async (item) => {
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
    },
    [showNotification, storeRequest, setRequest, setItems, setJewelleryWorkspaceLines, setContextMenu]
  );

  const handleCancelWorkspacePreviewItem = useCallback(
    async (lineId) => {
      if (!lineId) return;
      const item = items.find((i) => i.id === lineId);
      if (!item) return;
      if (item.request_item_id) {
        try {
          await deleteRequestItem(item.request_item_id);
        } catch (err) {
          console.error('[CG Suite] Failed to clean up cancelled workspace preview item:', err);
        }
      }
      setItems((prev) => prev.filter((i) => i.id !== lineId));
    },
    [items, setItems]
  );

  const handleCancelCeXPreview = handleCancelWorkspacePreviewItem;

  /** Close jewellery workspace (X): drop only draft rows not yet on the quote — never remove saved lines. */
  const handleCancelJewelleryPreview = useCallback(
    async (lines) => {
      const list = Array.isArray(lines) ? lines : [];
      const draftIds = new Set(
        list.filter((l) => l?.id && !l.request_item_id).map((l) => l.id)
      );
      if (draftIds.size > 0) {
        setItems((prev) => prev.filter((i) => !draftIds.has(i.id)));
      }
      setJewelleryWorkspaceLines((prev) => prev.filter((l) => l.request_item_id));
    },
    [setItems, setJewelleryWorkspaceLines]
  );

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
  }, [setItems]);

  const handleJewelleryWeightChange = useCallback(
    (item, nextWeight) => {
      const derived = deriveNegotiationJewelleryWeightUpdate(
        item,
        nextWeight,
        useVoucherOffers,
        customerOfferRulesData?.settings
      );
      if (!derived) return;
      const { cleaned, d, ourSale } = derived;
      const updatedLine = negotiationJewelleryItemToWorkspaceLine(item);
      const itemName =
        updatedLine?.itemName || updatedLine?.categoryLabel || updatedLine?.variantTitle || null;

      const cats = Array.isArray(nosposCategoriesResults) ? nosposCategoriesResults : [];
      const maps = Array.isArray(nosposCategoryMappings) ? nosposCategoryMappings : [];
      const rowForPlan = {
        ...item,
        cashOffers: d.cashOffers,
        voucherOffers: d.voucherOffers,
        offers: d.offers,
        selectedOfferId: d.selectedOfferId,
        manualOffer: d.manualOffer,
        manualOfferUsed: d.manualOfferUsed,
        ourSalePrice: ourSale,
        referenceData: d.referenceData,
      };
      const plan = cats.length ? getJewelleryNosposWeightSyncPlan(rowForPlan, cats, maps) : null;
      let weightBlob = null;
      if (plan) {
        weightBlob = buildMergedNosposStockFieldValuesBlob(
          item,
          plan.leafNosposId,
          { [plan.fieldId]: plan.gramsString },
          { deleteIfEmpty: true }
        );
      }

      setItems((prev) => {
        let next = prev.map((row) => {
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
        });
        if (weightBlob) {
          next = applyNosposStockFieldBlobToNegotiationItems(next, item.id, weightBlob);
        }
        return next;
      });
      setJewelleryWorkspaceLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, weight: cleaned } : l)));
      if (item.request_item_id) {
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
        const rawPayload = {
          referenceData: {
            ...d.referenceData,
            item_name: itemName,
          },
          ...(weightBlob ? { aiSuggestedNosposStockFieldValues: weightBlob } : {}),
        };
        updateRequestItemRawData(item.request_item_id, { raw_data: rawPayload }).catch(() => {});
      }
    },
    [
      useVoucherOffers,
      customerOfferRulesData?.settings,
      normalizeOffersForApi,
      setItems,
      setJewelleryWorkspaceLines,
      nosposCategoriesResults,
      nosposCategoryMappings,
    ]
  );

  const handleJewelleryCoinUnitsChange = useCallback(
    (item, nextCoinUnitsRaw) => {
      const derived = deriveNegotiationJewelleryCoinUnitsUpdate(
        item,
        nextCoinUnitsRaw,
        useVoucherOffers,
        customerOfferRulesData?.settings
      );
      if (!derived) return;
      const { cleaned, d } = derived;
      const updatedLine = negotiationJewelleryItemToWorkspaceLine(item);
      const itemName =
        updatedLine?.itemName || updatedLine?.categoryLabel || updatedLine?.variantTitle || null;
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
      setJewelleryWorkspaceLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, coinUnits: cleaned } : l)));
      if (item.request_item_id) {
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
        const rawPayload = {
          referenceData: {
            ...d.referenceData,
            item_name: itemName,
          },
        };
        updateRequestItemRawData(item.request_item_id, { raw_data: rawPayload }).catch(() => {});
      }
    },
    [
      useVoucherOffers,
      customerOfferRulesData?.settings,
      normalizeOffersForApi,
      setItems,
      setJewelleryWorkspaceLines,
    ]
  );

  /** Run NosPos stock path AI + optional field AI; persist to `request_item_id` and merge into `items`. */
  const scheduleNosposStockAiForNegotiationLine = useCallback((normalizedItem, meta) => {
    const reqItemId = normalizedItem?.request_item_id;
    const lineId = normalizedItem?.id;
    const catId = normalizedItem?.categoryObject?.id;
    const isCeXNoInternalLeaf = normalizedItem?.isCustomCeXItem === true && catId == null;
    if (!reqItemId || !lineId) return;
    if (catId == null && !isCeXNoInternalLeaf) return;

    const {
      pathLogTag = '[CG Suite][NosposPathMatch][background]',
      categorySource = 'negotiation_ai',
      fieldAiSource = categorySource,
      fieldAiLogLabel = 'negotiation',
      /** When true, reuse existing path-mapped NosPos hint and only run field AI (e.g. after eBay research enriches the line). */
      skipNosposCategoryPathAi = false,
    } = meta || {};

    void (async () => {
      if (ENABLE_NOSPOS_STOCK_FIELD_AI) {
        setItems((prev) =>
          prev.map((row) => (row.id === lineId ? { ...row, nosposStockFieldAiPending: true } : row))
        );
      }
      try {
        const itemSummary = summariseNegotiationItemForAi(normalizedItem);

        const pathHint =
          skipNosposCategoryPathAi ? getAiSuggestedNosposStockCategoryFromItem(normalizedItem) : null;
        const reusePathMatch =
          skipNosposCategoryPathAi &&
          pathHint &&
          pathHint.fromInternalProductCategory !== true &&
          pathHint.nosposId != null &&
          Number(pathHint.nosposId) > 0;

        let aiSuggestedNosposStockCategory;
        let fieldNosposCategoryId = null;
        let rowWithCategoryHint;

        if (reusePathMatch) {
          aiSuggestedNosposStockCategory = { ...pathHint };
          fieldNosposCategoryId = Number(pathHint.nosposId);
          rowWithCategoryHint = {
            ...normalizedItem,
            aiSuggestedNosposStockCategory,
            rawData:
              normalizedItem.rawData != null && typeof normalizedItem.rawData === 'object'
                ? { ...normalizedItem.rawData, aiSuggestedNosposStockCategory }
                : { aiSuggestedNosposStockCategory },
          };
        } else {
          let flatArr = [];
          try {
            const flat = await fetchAllCategoriesFlat();
            flatArr = Array.isArray(flat) ? flat : [];
          } catch {
            flatArr = [];
          }

          let match = null;
          if (isCeXNoInternalLeaf) {
            match = await runNosposStockCategoryAiMatchBackground({
              internalCategoryId: null,
              itemSummary,
              allCategoriesFlat: flatArr,
              logTag: pathLogTag,
            });
          } else {
            const rootReady = flatArr.length > 0 && isProductCategoryRootReadyForBuilder(flatArr, catId);
            if (rootReady) {
              match = await runNosposStockCategoryAiMatchBackground({
                internalCategoryId: catId,
                itemSummary,
                allCategoriesFlat: flatArr,
                logTag: pathLogTag,
              });
              if (!match) return;
            }
          }

          const co = normalizedItem.categoryObject || {};
          const pathSegs = Array.isArray(co.path)
            ? co.path.map((s) => String(s).trim()).filter(Boolean)
            : [];
          const productBreadcrumb =
            pathSegs.length > 0
              ? pathSegs.join(' > ')
              : co.name != null && String(co.name).trim()
                ? String(co.name).trim()
                : String(normalizedItem.categoryName || normalizedItem.category || '').trim();

          if (match) {
            aiSuggestedNosposStockCategory = {
              nosposId: match.nosposId != null ? Number(match.nosposId) : null,
              fullName: match.fullName,
              pathSegments: match.pathSegments,
              source: categorySource,
              savedAt: new Date().toISOString(),
            };
            fieldNosposCategoryId =
              match.nosposId != null && Number(match.nosposId) > 0 ? Number(match.nosposId) : null;
          } else {
            const fullName =
              productBreadcrumb ||
              (co.name != null && String(co.name).trim() ? String(co.name).trim() : '') ||
              (catId != null ? `Category ${catId}` : '');
            const numericCat = catId != null && Number.isFinite(Number(catId)) ? Number(catId) : null;
            aiSuggestedNosposStockCategory = {
              ...(numericCat != null
                ? { nosposId: numericCat, internalCategoryId: numericCat }
                : { nosposId: null }),
              fullName,
              pathSegments: pathSegs.length ? pathSegs : null,
              fromInternalProductCategory: true,
              source: categorySource,
              savedAt: new Date().toISOString(),
            };
            console.log('[CG Suite][NosposPathMatch] category', {
              context: pathLogTag,
              item: itemSummary.name,
              lineId,
              internalCategoryId: catId ?? null,
              productCategoryRoot:
                catId != null ? getInternalProductCategoryRootMeta(flatArr, catId) : null,
              outcome: 'internal_hint',
              nospos: {
                nosposId: aiSuggestedNosposStockCategory.nosposId,
                fullName: aiSuggestedNosposStockCategory.fullName,
                pathSegments: aiSuggestedNosposStockCategory.pathSegments,
              },
              error: null,
            });
          }

          rowWithCategoryHint = {
            ...normalizedItem,
            aiSuggestedNosposStockCategory,
            rawData:
              normalizedItem.rawData != null && typeof normalizedItem.rawData === 'object'
                ? { ...normalizedItem.rawData, aiSuggestedNosposStockCategory }
                : { aiSuggestedNosposStockCategory },
          };

          if (!match) {
            fieldNosposCategoryId = await resolveNosposLeafIdForNegotiationFieldAi(rowWithCategoryHint);
          }

          await updateRequestItemRawData(reqItemId, {
            raw_data: { aiSuggestedNosposStockCategory },
          });
        }
        let aiSuggestedNosposStockFieldValues = null;
        if (
          ENABLE_NOSPOS_STOCK_FIELD_AI &&
          fieldNosposCategoryId != null &&
          Number(fieldNosposCategoryId) > 0
        ) {
          try {
            aiSuggestedNosposStockFieldValues = await buildNosposStockFieldAiPayload({
              nosposCategoryId: fieldNosposCategoryId,
              negotiationItem: rowWithCategoryHint,
              source: fieldAiSource,
            });
          } catch (fe) {
            console.warn('[CG Suite][NosposFieldAi] fields', {
              context: fieldAiLogLabel,
              item: itemSummary.name,
              lineId,
              outcome: 'error',
              error: fe instanceof Error ? fe.message : String(fe),
            });
          }
          if (aiSuggestedNosposStockFieldValues) {
            const fvSaveResult = await updateRequestItemRawData(reqItemId, {
              raw_data: { aiSuggestedNosposStockFieldValues },
            });
            if (!fvSaveResult) {
              console.warn('[CG Suite][NosposFieldAi] fields', {
                context: fieldAiLogLabel,
                item: itemSummary.name,
                lineId,
                outcome: 'save_failed',
                requestItemId: reqItemId,
              });
            }
          }
        }
        let mergedForPrompt = null;
        setItems((prev) => {
          const base = prev.find((r) => r.id === lineId);
          if (!base) return prev;
          mergedForPrompt = mergeNosposAiOntoNegotiationRow(
            base,
            aiSuggestedNosposStockCategory,
            aiSuggestedNosposStockFieldValues
          );
          const nextRow =
            ENABLE_NOSPOS_STOCK_FIELD_AI
              ? { ...mergedForPrompt, nosposStockFieldAiPending: false }
              : mergedForPrompt;
          return prev.map((row) => (row.id === lineId ? nextRow : row));
        });

      } catch (e) {
        console.warn('[CG Suite][NosposPathMatch] category', {
          context: pathLogTag,
          item: summariseNegotiationItemForAi(normalizedItem).name,
          lineId,
          outcome: 'persist_error',
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (ENABLE_NOSPOS_STOCK_FIELD_AI) {
          setItems((prev) =>
            prev.map((row) => (row.id === lineId ? { ...row, nosposStockFieldAiPending: false } : row))
          );
        }
      }
    })();
  }, [setItems]);

  const notifyEbayResearchMergedForNosposAi = useCallback(
    (mergedItem) => {
      if (!mergedItem?.request_item_id) return;
      if (mergedItem.categoryObject?.id == null && mergedItem.isCustomCeXItem !== true) return;

      const hint = getAiSuggestedNosposStockCategoryFromItem(mergedItem);
      const nid = hint?.nosposId != null ? Number(hint.nosposId) : null;
      const existingFv = getAiSuggestedNosposStockFieldValuesFromItem(mergedItem);
      const byId = existingFv?.byNosposFieldId;
      const hasFilledStockFields =
        byId &&
        typeof byId === 'object' &&
        Object.keys(byId).some((k) => String(byId[k] ?? '').trim() !== '');
      const categoryAligned =
        nid != null &&
        nid > 0 &&
        existingFv?.nosposCategoryId != null &&
        Number(existingFv.nosposCategoryId) === nid;

      if (categoryAligned && hasFilledStockFields) {
        return;
      }

      // Line already went through NosPos *path* AI (add-time or picker). Completing eBay research only needs
      // stock field AI with the enriched title/listings — not a second full category cascade.
      const fromPathMappedNosposLeaf =
        nid != null &&
        nid > 0 &&
        hint?.fromInternalProductCategory !== true;

      const metaBase = {
        pathLogTag: mergedItem.isCustomEbayItem
          ? '[CG Suite][NosposPathMatch][ebay_research_complete]'
          : '[CG Suite][NosposPathMatch][negotiation_research_complete]',
        categorySource: mergedItem.isCustomEbayItem ? 'ebay_research_complete' : 'negotiation_research_complete',
        fieldAiSource: mergedItem.isCustomEbayItem ? 'ebay_research_complete' : 'negotiation_research_complete',
        fieldAiLogLabel: mergedItem.isCustomEbayItem ? 'ebay_overlay' : 'negotiation_overlay',
      };

      if (fromPathMappedNosposLeaf) {
        scheduleNosposStockAiForNegotiationLine(mergedItem, {
          ...metaBase,
          skipNosposCategoryPathAi: true,
        });
        return;
      }

      scheduleNosposStockAiForNegotiationLine(mergedItem, metaBase);
    },
    [scheduleNosposStockAiForNegotiationLine]
  );

  const handleAddNegotiationItem = useCallback(
    async (cartItem, options = {}) => {
      if (!cartItem) return false;
      const {
        skipSuccessNotification = false,
        addedFromBuilder = false,
        runNosposCategoryAiForInternalLeaf = false,
        /** When true, do not run post-add NosPos stock field AI (e.g. Other workspace — fields already chosen). */
        skipNosposStockFieldAi = false,
        onCommitted = null,
      } = options;
      const pendingMap =
        typeof getPendingCustomerExpectationMap === 'function' ? getPendingCustomerExpectationMap() : {};
      const expectationDraft = resolveCustomerExpectationDraftForAdd(cartItem, pendingMap);
      const lineCartItem = expectationDraft.value
        ? { ...cartItem, customerExpectation: expectationDraft.value }
        : cartItem;
      try {
        const existingLine =
          lineCartItem.id != null ? items.find((i) => i.id === lineCartItem.id) : null;
        let reqItemId = lineCartItem.request_item_id;
        if ((reqItemId == null || reqItemId === '') && existingLine?.request_item_id) {
          reqItemId = existingLine.request_item_id;
        }
        const isClientLineUpdate = Boolean(lineCartItem.id != null && existingLine && reqItemId != null && reqItemId !== '');
        if (reqItemId == null || reqItemId === '') {
          const rawDataPayload =
            lineCartItem.rawData != null && typeof lineCartItem.rawData === 'object'
              ? lineCartItem.rawData
              : lineCartItem.ebayResearchData != null && typeof lineCartItem.ebayResearchData === 'object'
                ? buildPersistedEbayRawData(lineCartItem.ebayResearchData, {
                    categoryObject: lineCartItem.categoryObject,
                    referenceData: lineCartItem.referenceData,
                    cashOffers: lineCartItem.cashOffers || [],
                    voucherOffers: lineCartItem.voucherOffers || [],
                  })
                : lineCartItem.referenceData != null && typeof lineCartItem.referenceData === 'object'
                  ? { referenceData: lineCartItem.referenceData }
                  : null;
          reqItemId = await createOrAppendRequestItem({
            variantId: lineCartItem.variantId,
            rawData: rawDataPayload,
            cashConvertersData: lineCartItem.cashConvertersResearchData || null,
            cashOffers: lineCartItem.cashOffers || [],
            voucherOffers: lineCartItem.voucherOffers || [],
            selectedOfferId: lineCartItem.selectedOfferId ?? null,
            manualOffer: lineCartItem.manualOffer ?? null,
            ourSalePrice: lineCartItem.ourSalePrice ?? null,
            cexSku: lineCartItem.cexSku ?? null,
            customerExpectation: lineCartItem.customerExpectation ?? null,
          });
        }
        const withRequestId = { ...lineCartItem, request_item_id: reqItemId };
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
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.id === normalizedItem.id);
          if (idx >= 0) {
            const prevRow = prev[idx];
            const nextRow = {
              ...prevRow,
              ...normalizedItem,
              request_item_id: prevRow.request_item_id ?? reqItemId,
              aiSuggestedNosposStockCategory:
                prevRow.aiSuggestedNosposStockCategory ?? normalizedItem.aiSuggestedNosposStockCategory,
              aiSuggestedNosposStockFieldValues:
                prevRow.aiSuggestedNosposStockFieldValues ?? normalizedItem.aiSuggestedNosposStockFieldValues,
              rawData:
                prevRow.rawData != null && typeof prevRow.rawData === 'object'
                  ? {
                      ...prevRow.rawData,
                      ...(normalizedItem.rawData != null && typeof normalizedItem.rawData === 'object'
                        ? normalizedItem.rawData
                        : {}),
                    }
                  : normalizedItem.rawData,
              ebayResearchData: prevRow.ebayResearchData ?? normalizedItem.ebayResearchData,
            };
            const next = [...prev];
            next[idx] = nextRow;
            return next;
          }
          return [...prev, normalizedItem];
        });

        if (isClientLineUpdate && reqItemId) {
          void updateRequestItemOffer(reqItemId, {
            selected_offer_id: normalizedItem.selectedOfferId,
            manual_offer_used: normalizedItem.selectedOfferId === 'manual',
            manual_offer_gbp:
              normalizedItem.selectedOfferId === 'manual' && normalizedItem.manualOffer
                ? normalizeExplicitSalePrice(
                    parseFloat(String(normalizedItem.manualOffer).replace(/[£,]/g, ''))
                  )
                : null,
            our_sale_price_at_negotiation: resolveOurSalePrice(normalizedItem) ?? null,
            cash_offers_json: negotiationOffersJsonForApi(normalizedItem.cashOffers),
            voucher_offers_json: negotiationOffersJsonForApi(normalizedItem.voucherOffers),
          }).catch(() => {});
        }

        const existingAiCat = existingLine ? getAiSuggestedNosposStockCategoryFromItem(existingLine) : null;
        const scheduledFullNosposAi =
          reqItemId &&
          (normalizedItem.categoryObject?.id != null || normalizedItem.isCustomCeXItem === true) &&
          (addedFromBuilder || runNosposCategoryAiForInternalLeaf) &&
          !existingAiCat;

        if (scheduledFullNosposAi) {
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
          scheduleNosposStockAiForNegotiationLine(normalizedItem, {
            pathLogTag,
            categorySource,
            fieldAiSource,
            fieldAiLogLabel,
          });
        }

        if (normalizedItem.isJewelleryItem && reqItemId && Array.isArray(nosposCategoriesResults) && nosposCategoriesResults.length > 0) {
          const plan = getJewelleryNosposWeightSyncPlan(
            normalizedItem,
            nosposCategoriesResults,
            Array.isArray(nosposCategoryMappings) ? nosposCategoryMappings : []
          );
          if (plan) {
            const weightBlob = buildMergedNosposStockFieldValuesBlob(
              normalizedItem,
              plan.leafNosposId,
              { [plan.fieldId]: plan.gramsString },
              { deleteIfEmpty: true }
            );
            void updateRequestItemRawData(reqItemId, {
              raw_data: { aiSuggestedNosposStockFieldValues: weightBlob },
            })
              .then((res) => {
                if (res) {
                  setItems((prev) =>
                    applyNosposStockFieldBlobToNegotiationItems(prev, normalizedItem.id, weightBlob)
                  );
                }
              })
              .catch(() => {});
          }
        }

        if (ENABLE_NOSPOS_STOCK_FIELD_AI && !scheduledFullNosposAi && reqItemId && !skipNosposStockFieldAi) {
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
              if (ENABLE_NOSPOS_STOCK_FIELD_AI) {
                setItems((prev) =>
                  prev.map((row) => (row.id === lineId ? { ...row, nosposStockFieldAiPending: true } : row))
                );
              }
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
                if (!fvSaveResult) {
                  console.warn('[CG Suite][NosposFieldAi] fields', {
                    context: 'negotiation_add',
                    item: summariseNegotiationItemForAi(normalizedItem).name,
                    lineId,
                    outcome: 'save_failed',
                    requestItemId: reqItemId,
                  });
                }
                setItems((prev) =>
                  prev.map((row) => {
                    if (row.id !== lineId) return row;
                    const nextRaw =
                      row.rawData != null && typeof row.rawData === 'object'
                        ? { ...row.rawData, aiSuggestedNosposStockFieldValues }
                        : { aiSuggestedNosposStockFieldValues };
                    const pendingClear =
                      ENABLE_NOSPOS_STOCK_FIELD_AI ? { nosposStockFieldAiPending: false } : {};
                    if (row.ebayResearchData != null && typeof row.ebayResearchData === 'object') {
                      return {
                        ...row,
                        ...pendingClear,
                        aiSuggestedNosposStockFieldValues,
                        rawData: nextRaw,
                        ebayResearchData: {
                          ...row.ebayResearchData,
                          aiSuggestedNosposStockFieldValues,
                        },
                      };
                    }
                    return { ...row, ...pendingClear, aiSuggestedNosposStockFieldValues, rawData: nextRaw };
                  })
                );
              } catch (e) {
                console.warn('[CG Suite][NosposFieldAi] fields', {
                  context: 'negotiation_add',
                  item: summariseNegotiationItemForAi(normalizedItem).name,
                  lineId: normalizedItem.id,
                  outcome: 'error',
                  error: e instanceof Error ? e.message : String(e),
                });
              } finally {
                if (ENABLE_NOSPOS_STOCK_FIELD_AI) {
                  setItems((prev) =>
                    prev.map((row) =>
                      row.id === lineId ? { ...row, nosposStockFieldAiPending: false } : row
                    )
                  );
                }
              }
            })();
          }
        }

        if (normalizedItem.selectedOfferId === 'manual') {
          const manualPerUnit = parseManualOfferValue(normalizedItem.manualOffer);
          const ourSalePrice = resolveOurSalePrice(normalizedItem);
          if (Number.isFinite(manualPerUnit) && manualPerUnit > 0 && ourSalePrice && ourSalePrice > 0) {
            if (manualPerUnit > ourSalePrice) {
              const cleanedManualItem = {
                ...normalizedItem,
                selectedOfferId: null,
                manualOffer: '',
                manualOfferUsed: false,
              };
              setItems((prev) =>
                prev.map((row) => (row.id === normalizedItem.id ? { ...row, ...cleanedManualItem } : row))
              );
              showNotification('This is not allowed, enter a new manual offer or cancel.', 'error');
              setSeniorMgmtModal({ item: cleanedManualItem, proposedPerUnit: manualPerUnit });
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
          showNotification(`Added "${lineCartItem.title}" to negotiation`, 'success');
        }
        if (
          expectationDraft.consumeKeys?.length > 0 &&
          typeof consumeCustomerExpectationDraftKeys === 'function'
        ) {
          consumeCustomerExpectationDraftKeys(expectationDraft.consumeKeys);
        }
        onCommitted?.({ id: normalizedItem.id, request_item_id: reqItemId });
        return true;
      } catch (err) {
        console.error('Failed to add negotiation item:', err);
        showNotification(err?.message || 'Failed to add item', 'error');
        return false;
      }
    },
    [
      items,
      createOrAppendRequestItem,
      parseManualOfferValue,
      showNotification,
      useVoucherOffers,
      setItems,
      setSeniorMgmtModal,
      setMarginResultModal,
      scheduleNosposStockAiForNegotiationLine,
      getPendingCustomerExpectationMap,
      consumeCustomerExpectationDraftKeys,
      nosposCategoriesResults,
      nosposCategoryMappings,
    ]
  );

  const handleAddNegotiationItemRef = useRef(handleAddNegotiationItem);
  handleAddNegotiationItemRef.current = handleAddNegotiationItem;

  useEffect(() => {
    const lines = jewelleryWorkspaceLines;
    if (!Array.isArray(lines)) return;
    const ids = new Set(lines.map((l) => l?.id).filter(Boolean));
    for (const id of [...jewelleryNosposEarlyAiStartedRef.current]) {
      if (!ids.has(id)) jewelleryNosposEarlyAiStartedRef.current.delete(id);
    }
  }, [jewelleryWorkspaceLines]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'jewellery') return;
    if (!Array.isArray(jewelleryWorkspaceLines) || jewelleryWorkspaceLines.length === 0) return;

    let cancelled = false;
    void (async () => {
      let fallbackJewelleryCategoryId = null;
      try {
        const jewCat = await fetchJewelleryCatalog();
        fallbackJewelleryCategoryId = jewCat?.category_id ?? null;
      } catch {
        /* best effort */
      }
      if (cancelled) return;

      for (const line of jewelleryWorkspaceLines) {
        if (!line?.id || line.request_item_id) continue;
        if (jewelleryNosposEarlyAiStartedRef.current.has(line.id)) continue;
        let total = 0;
        try {
          total = computeWorkspaceLineTotal(line);
        } catch {
          continue;
        }
        if (!Number.isFinite(total) || total <= 0) continue;

        jewelleryNosposEarlyAiStartedRef.current.add(line.id);
        try {
          const cartItem = buildJewelleryNegotiationCartItem(
            line,
            useVoucherOffers,
            customerOfferRulesData?.settings,
            fallbackJewelleryCategoryId
          );
          const add = handleAddNegotiationItemRef.current;
          if (!add) continue;
          await add(cartItem, {
            skipSuccessNotification: true,
            runNosposCategoryAiForInternalLeaf: true,
            onCommitted: ({ id, request_item_id: rid }) => {
              if (cancelled || !rid) return;
              setJewelleryWorkspaceLines((prev) =>
                prev.map((l) => (l.id === id ? { ...l, request_item_id: rid } : l))
              );
            },
          });
        } catch (e) {
          jewelleryNosposEarlyAiStartedRef.current.delete(line.id);
          console.error('[CG Suite] jewellery workspace early NosPos AI', e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    headerWorkspaceOpen,
    headerWorkspaceMode,
    jewelleryWorkspaceLines,
    useVoucherOffers,
    customerOfferRulesData?.settings,
    setJewelleryWorkspaceLines,
  ]);

  const handleNegotiationBuilderOffersDisplayed = useCallback(
    async (previewItem) => {
      if (mode !== 'negotiate' || !previewItem?.id || previewItem.categoryObject?.id == null) return;
      if (items.some((i) => i.id === previewItem.id)) return;
      await handleAddNegotiationItem(previewItem, {
        skipSuccessNotification: true,
        addedFromBuilder: true,
      });
    },
    [mode, items, handleAddNegotiationItem]
  );

  const handleNegotiationCexProductDisplayed = useCallback(
    async (previewItem) => {
      if (mode !== 'negotiate' || !previewItem?.id) return;
      if (items.some((i) => i.id === previewItem.id)) return;
      await handleAddNegotiationItem(previewItem, {
        skipSuccessNotification: true,
        runNosposCategoryAiForInternalLeaf: true,
      });
    },
    [mode, items, handleAddNegotiationItem]
  );

  const handleWorkspaceBlockedOfferAttempt = useCallback(
    (payload) => {
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
    },
    [handleAddNegotiationItem, headerWorkspaceMode, setBlockedOfferModal]
  );

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
        /* best effort */
      }
      for (const line of draftWorkspaceLines) {
        try {
          const cartItem = buildJewelleryNegotiationCartItem(
            line,
            useVoucherOffers,
            customerOfferRulesData?.settings,
            fallbackJewelleryCategoryId
          );
          const existingNeg = items.find((i) => i.id === cartItem.id);
          const ok = await handleAddNegotiationItem(cartItem, {
            skipSuccessNotification: true,
            runNosposCategoryAiForInternalLeaf: !getAiSuggestedNosposStockCategoryFromItem(existingNeg),
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
    [
      customerOfferRulesData?.settings,
      handleAddNegotiationItem,
      useVoucherOffers,
      showNotification,
      setJewelleryWorkspaceLines,
      items,
    ]
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
    [items, handleRemoveFromNegotiation, setJewelleryWorkspaceLines]
  );

  const handleEbayResearchCompleteFromHeader = useCallback(
    async (data) => {
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
      await handleAddNegotiationItem(customItem, {
        runNosposCategoryAiForInternalLeaf: Boolean(categoryObject?.id),
      });
    },
    [handleAddNegotiationItem, useVoucherOffers]
  );

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers,
    setCexPencilRrpSourceModal,
  });

  const handleApplyRrpPriceSource = useCallback(
    (row, zone) => {
      const { item: next, errorMessage } = applyRrpOnlyFromPriceSource(row, zone);
      if (errorMessage) {
        showNotification?.(errorMessage, 'error');
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === row.id ? next : i)));
      showNotification?.('Our RRP updated from selected source.', 'success');
    },
    [setItems, showNotification]
  );

  const handleApplyOffersPriceSource = useCallback(
    (row, zone) => {
      const { item: next, errorMessage } = applyOffersOnlyFromPriceSource(row, zone, useVoucherOffers);
      if (errorMessage) {
        showNotification?.(errorMessage, 'error');
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === row.id ? next : i)));
      showNotification?.('Offer tiers updated from selected source.', 'success');
    },
    [setItems, showNotification, useVoucherOffers]
  );

  return {
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
  };
}
