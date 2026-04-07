import { useCallback, useEffect, useRef } from 'react';
import { getJewelleryWorkspaceDerivedState } from '@/components/jewellery/jewelleryNegotiationCart';
import { negotiationJewelleryItemsToWorkspaceLines } from '@/components/jewellery/jewelleryWorkspaceMapping';
import { normalizeExplicitSalePrice } from '@/utils/helpers';
import { updateRequestItemOffer, updateRequestItemRawData } from '@/services/api';

/**
 * Keeps header jewellery workspace lines in sync with negotiation rows and persists offer/raw updates.
 */
export function useNegotiationJewelleryWorkspaceSync({
  mode,
  useVoucherOffers,
  customerOfferRulesData,
  setItems,
  setJewelleryWorkspaceLines,
  jewelleryWorkspaceLines,
  jewelleryNegotiationItems,
  headerWorkspaceOpen,
  headerWorkspaceMode,
}) {
  const jewelleryWorkspaceLinesRef = useRef(jewelleryWorkspaceLines);
  jewelleryWorkspaceLinesRef.current = jewelleryWorkspaceLines;

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

      const linesToPersist = changedLineIds ? lines.filter((l) => changedLineIds.has(l.id)) : lines;

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
    [customerOfferRulesData?.settings, normalizeOffersForApi, setItems, useVoucherOffers]
  );

  const handleJewelleryWorkspaceLinesChange = useCallback(
    (updater) => {
      setJewelleryWorkspaceLines((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

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
    [setJewelleryWorkspaceLines, syncJewelleryWorkspaceLinesToNegotiation]
  );

  useEffect(() => {
    if (!headerWorkspaceOpen || headerWorkspaceMode !== 'jewellery') return;
    const fromQuote = negotiationJewelleryItemsToWorkspaceLines(jewelleryNegotiationItems);
    setJewelleryWorkspaceLines((prev) => {
      const drafts = prev.filter((l) => !l.request_item_id);
      const quoteIds = new Set(fromQuote.map((l) => l.id));
      const draftsNotInQuote = drafts.filter((d) => !quoteIds.has(d.id));
      return [...fromQuote, ...draftsNotInQuote];
    });
  }, [jewelleryNegotiationItems, headerWorkspaceOpen, headerWorkspaceMode, setJewelleryWorkspaceLines]);

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
    if (wasHeaderWorkspaceOpen && !headerWorkspaceOpen && mode === 'negotiate') {
      setJewelleryWorkspaceLines((prev) => prev.filter((l) => l.request_item_id));
    }
  }, [
    headerWorkspaceOpen,
    headerWorkspaceMode,
    mode,
    syncJewelleryWorkspaceLinesToNegotiation,
    setJewelleryWorkspaceLines,
  ]);

  return {
    normalizeOffersForApi,
    handleJewelleryWorkspaceLinesChange,
    syncJewelleryWorkspaceLinesToNegotiation,
  };
}
