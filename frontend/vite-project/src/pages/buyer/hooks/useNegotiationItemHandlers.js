import { useCallback } from 'react';
import useAppStore from '@/store/useAppStore';
import { buildJewelleryNegotiationCartItem, getJewelleryWorkspaceDerivedState } from '@/components/jewellery/jewelleryNegotiationCart';
import { negotiationJewelleryItemToWorkspaceLine } from '@/components/jewellery/jewelleryWorkspaceMapping';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { normalizeExplicitSalePrice, formatOfferPrice } from '@/utils/helpers';
import {
  deleteRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
  fetchJewelleryCatalog,
} from '@/services/api';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import {
  normalizeCartItemForNegotiation,
  getDisplayOffers,
  resolveOurSalePrice,
  logCategoryRuleDecision,
} from '../utils/negotiationHelpers';
import {
  summariseNegotiationItemForAi,
  runNosposStockCategoryAiMatchBackground,
} from '@/services/aiCategoryPathCascade';
import {
  getAiSuggestedNosposStockCategoryFromItem,
  getAiSuggestedNosposStockFieldValuesFromItem,
} from '@/utils/nosposCategoryMappings';
import { buildNosposStockFieldAiPayload } from '../utils/nosposFieldAiAtAdd';
import { makeSalePriceBlurHandler } from './useResearchOverlay';
import { useRefreshCexRowData } from './useRefreshCexRowData';
import { EBAY_TOP_LEVEL_CATEGORY } from '../constants';
import { ENABLE_NOSPOS_STOCK_FIELD_AI } from '@/config/cgSuiteFeatureFlags';

export function useNegotiationItemHandlers({
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
}) {
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
      setJewelleryWorkspaceLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, weight: cleaned } : l)));
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
    },
    [useVoucherOffers, customerOfferRulesData?.settings, normalizeOffersForApi, setItems, setJewelleryWorkspaceLines]
  );

  const handleAddNegotiationItem = useCallback(
    async (cartItem, options = {}) => {
      if (!cartItem) return false;
      const {
        skipSuccessNotification = false,
        addedFromBuilder = false,
        runNosposCategoryAiForInternalLeaf = false,
        nosposAiSkipReadyForBuilderCheck = false,
      } = options;
      try {
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
              if (
                ENABLE_NOSPOS_STOCK_FIELD_AI &&
                match.nosposId != null &&
                Number(match.nosposId) > 0
              ) {
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
                        Object.entries(aiSuggestedNosposStockFieldValues.byNosposFieldId || {}).map(([id, val]) => [
                          id,
                          val,
                        ])
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

        if (ENABLE_NOSPOS_STOCK_FIELD_AI && !scheduledFullNosposAi && reqItemId) {
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
                  console.error(
                    '[CG Suite][NosposFieldAi][negotiation_add] DB save FAILED — updateRequestItemRawData returned null',
                    { reqItemId }
                  );
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
    },
    [
      createOrAppendRequestItem,
      parseManualOfferValue,
      showNotification,
      useVoucherOffers,
      setItems,
      setSeniorMgmtModal,
      setMarginResultModal,
    ]
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
    [customerOfferRulesData?.settings, handleAddNegotiationItem, useVoucherOffers, showNotification, setJewelleryWorkspaceLines]
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
      await handleAddNegotiationItem(customItem);
    },
    [handleAddNegotiationItem, useVoucherOffers]
  );

  const handleRefreshCeXData = useRefreshCexRowData({
    handleAddFromCeX,
    clearCexProduct,
    setItems,
    showNotification,
    useVoucherOffers,
  });

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
    handleAddNegotiationItem,
    handleWorkspaceBlockedOfferAttempt,
    handleAddJewelleryItemsFromWorkspace,
    handleRemoveJewelleryWorkspaceRow,
    handleEbayResearchCompleteFromHeader,
    handleRefreshCeXData,
  };
}
