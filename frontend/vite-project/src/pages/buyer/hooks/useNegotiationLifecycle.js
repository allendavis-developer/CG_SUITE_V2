import { useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import useAppStore from '@/store/useAppStore';
import { fetchRequestDetail, saveQuoteDraft, fetchCustomerOfferRules } from '@/services/api';
import { mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import {
  calculateTotalOfferPrice,
  buildFinishPayload,
  isQuoteDraftPayloadSaveable,
  mapApiItemToNegotiationItem,
  normalizeCartItemForNegotiation,
  getDisplayOffers,
} from '../utils/negotiationHelpers';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import {
  applyJewelleryScrapeToNegotiationItem,
  remapJewelleryWorkspaceLines,
} from '@/components/jewellery/jewelleryScrapeRemap';

export function useNegotiationLifecycle({
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
}) {
  useEffect(() => {
    fetchCustomerOfferRules()
      .then((data) => setCustomerOfferRulesData(data))
      .catch(() => {});
  }, [setCustomerOfferRulesData]);

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
  }, [mode, actualRequestId, prevNegotiationRequestIdRef, setJewelleryReferenceScrape]);

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
  }, [mode, actualRequestId, storeRequest, setJewelleryReferenceScrape]);

  const handleJewelleryReferenceScrapeResult = useCallback(
    (scrape) => {
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
    },
    [customerOfferRulesData?.settings, useVoucherOffers, setItems, setJewelleryReferenceScrape, setJewelleryWorkspaceLines]
  );

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
            showNotification('Request details not found.', 'error');
            navigate('/requests-overview', { replace: true });
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

          const mappedItems = data.items.map((apiItem) => {
            const mapped = mapApiItemToNegotiationItem(apiItem, txType, mode);
            const isRemoved = isBookedOrComplete && (apiItem.negotiated_price_gbp == null || apiItem.negotiated_price_gbp === '');
            return { ...mapped, isRemoved };
          });
          setItems(mappedItems);

          hydrateFromSavedState(data.park_agreement_state_json, mappedItems);

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
          console.error('Failed to load request details:', err);
          showNotification(`Failed to load request details: ${err.message}`, 'error');
          navigate('/requests-overview', { replace: true });
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
        setTotalExpectation(initialCustomerData?.overall_expectation_gbp?.toString() || '');
        setTargetOffer(initialCustomerData?.target_offer_gbp?.toString() || '');
        setTransactionType(initialCustomerData?.transactionType || 'sale');
      }

      setIsLoading(false);
    }
  }, [
    mode,
    actualRequestId,
    navigate,
    initialCustomerData,
    initialCartItems,
    showNotification,
    hydrateFromSavedState,
    location.state?.openQuoteRequest,
    hasInitializedNegotiateRef,
    setCustomerData,
    setIsLoading,
    setItems,
    setJewelleryReferenceScrape,
    setRequest,
    setTargetOffer,
    setTotalExpectation,
    setTransactionType,
    setViewRequestStatus,
  ]);

  useEffect(() => {
    if (customerData?.transactionType) setTransactionType(customerData.transactionType);
  }, [customerData, setTransactionType]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    const hasCustomer = Boolean(customerData?.id) || Boolean(initialCustomerData?.id);
    setCustomerModalOpen(!hasCustomer);
  }, [mode, customerData?.id, initialCustomerData?.id, setCustomerModalOpen]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    if (!customerData?.id) return;
    if (transactionType && transactionType !== customerData.transactionType) {
      setStoreTransactionType(transactionType);
    }
  }, [mode, transactionType, customerData?.id, customerData?.transactionType, setStoreTransactionType]);

  useEffect(() => {
    if (mode !== 'negotiate' || prevTransactionTypeRef.current === transactionType) {
      prevTransactionTypeRef.current = transactionType;
      return;
    }
    const prevType = prevTransactionTypeRef.current;
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.selectedOfferId === 'manual') return item;
        const prevUseVoucher = prevType === 'store_credit';
        const newUseVoucher = transactionType === 'store_credit';
        const prevOffers = getDisplayOffers(item, prevUseVoucher);
        const newOffers = getDisplayOffers(item, newUseVoucher);
        if (!prevOffers || !newOffers) return item;
        const prevIndex = prevOffers.findIndex((o) => o.id === item.selectedOfferId);
        if (prevIndex < 0 || !newOffers[prevIndex]) return item;
        const nextId = newOffers[prevIndex].id;
        return {
          ...item,
          selectedOfferId: nextId,
          ...revokeManualOfferAuthorisationIfSwitchingAway(item, nextId),
        };
      })
    );
    prevTransactionTypeRef.current = transactionType;
  }, [transactionType, mode, prevTransactionTypeRef, setItems]);

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

  useEffect(() => {
    if (!isQuoteDraftPayloadSaveable(draftPayload) || completedRef.current) return;
    const timer = setTimeout(() => {
      if (completedRef.current) return;
      saveQuoteDraft(actualRequestId, draftPayloadRef.current).catch((err) => {
        console.warn('Quote draft save failed:', err);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [draftPayload, actualRequestId, completedRef, draftPayloadRef]);

  useEffect(() => {
    if (mode !== 'negotiate') return;
    const activeItems = items.filter((i) => !i.isRemoved);
    if (activeItems.length === 0) return;
    const parsed = activeItems.map((i) => parseFloat(String(i.customerExpectation ?? '').replace(/[£,]/g, '').trim()));
    if (parsed.every((v) => Number.isFinite(v) && v >= 0)) {
      const sum = parsed.reduce((acc, v) => acc + v, 0);
      setTotalExpectation(sum.toFixed(2));
    }
  }, [items, mode, setTotalExpectation]);

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
  }, [mode, actualRequestId, completedRef, draftPayloadRef]);

  return { draftPayload, handleJewelleryReferenceScrapeResult };
}
