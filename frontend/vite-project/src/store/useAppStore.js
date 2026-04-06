import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  fetchProductModels,
  fetchVariantPrices,
  fetchCeXProductPrices,
  fetchAllCategoriesFlat,
  createRequest,
  addRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
  deleteRequestItem,
  fetchRequestDetail,
  fetchEbayOfferMargins,
  fetchCustomerOfferRules,
} from '@/services/api';
import { getDataFromListingPage } from '@/services/extensionClient';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { normalizeExplicitSalePrice, roundSalePrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import { mapRequestItemsToCartItems, mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { withDefaultRrpOffersSource } from '@/pages/buyer/utils/negotiationHelpers';
import { validateBuyerCartItemOffers } from '@/utils/cartOfferValidation';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import { matchCexCategoryNameToDb } from '@/utils/cexCategoryMatch';

const DEFAULT_CUSTOMER = {
  id: null,
  name: 'No Customer Selected',
  cancelRate: 0,
  transactionType: 'sale',
};

function normalizeOffers(offers) {
  if (!Array.isArray(offers)) return [];
  return offers.map((o) => ({ id: o.id, title: o.title, price: normalizeExplicitSalePrice(o.price) }));
}

function generateId() {
  return crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findDuplicateIndex(items, newItem, isRepricing) {
  return items.findIndex((ci) => {
    if (!newItem.isCustomEbayItem && !newItem.isCustomCashConvertersItem && newItem.variantId != null) {
      return ci.variantId === newItem.variantId;
    }
    if (newItem.isCustomEbayItem) {
      return ci.isCustomEbayItem && ci.title === newItem.title && ci.category === newItem.category;
    }
    if (newItem.isCustomCashConvertersItem) {
      return ci.isCustomCashConvertersItem && ci.title === newItem.title && ci.category === newItem.category;
    }
    if (newItem.isCustomCeXItem) {
      return ci.isCustomCeXItem && ci.title === newItem.title && ci.subtitle === newItem.subtitle;
    }
    return false;
  });
}

/**
 * Switch display offers between cash and voucher lists while keeping the same *slot*
 * selected (1st ↔ 1st, 2nd ↔ 2nd), since cash/voucher entries use different ids.
 */
function recalcOffersForTransactionType(item, prevUseVoucher, newUseVoucher) {
  const prevOffers = prevUseVoucher
    ? (item.voucherOffers?.length ? item.voucherOffers : item.offers ?? [])
    : (item.cashOffers?.length ? item.cashOffers : item.offers ?? []);
  const nextOffers = newUseVoucher ? (item.voucherOffers ?? []) : (item.cashOffers ?? []);

  let selectedOfferId = item.selectedOfferId;

  if (selectedOfferId !== 'manual' && selectedOfferId != null && selectedOfferId !== '') {
    const prevIndex = prevOffers.findIndex((o) => o.id === selectedOfferId);
    if (prevIndex >= 0 && nextOffers[prevIndex]) {
      selectedOfferId = nextOffers[prevIndex].id;
    } else if (!nextOffers.some((o) => o.id === selectedOfferId)) {
      selectedOfferId = null;
    }
  }

  return {
    ...item,
    offers: nextOffers,
    offerType: newUseVoucher ? 'voucher' : 'cash',
    selectedOfferId,
  };
}

try { sessionStorage.removeItem('cg-suite-store'); } catch {}

const useAppStore = create(
    (set, get) => {

      const _cartKey = () => get().mode === 'repricing' ? 'repricingCartItems' : 'cartItems';
      const _getCart = () => get()[_cartKey()];

    return ({
      // ─── Mode ───────────────────────────────────────────────────────────
      mode: 'buyer',
      repricingSessionId: null,
      /** Incremented when starting a blank repricing workspace so the route remounts even if path is unchanged. */
      repricingWorkspaceNonce: 0,
      /** True when the AppHeader workspace panel (builder/eBay/CeX) is mounted. */
      headerWorkspaceOpen: false,
      /** Synced from AppHeader: `builder` | `ebay` | `cex` | `jewellery` */
      headerWorkspaceMode: 'builder',
      /** Increment to ask AppHeader to run full workspace reset (e.g. after jewellery Complete). */
      closeHeaderWorkspaceTick: 0,

      bumpRepricingWorkspace: () =>
        set((s) => ({ repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1 })),

      setMode: (newMode) => {
        const { mode: currentMode } = get();
        if (newMode === currentMode) return;
        set({
          mode: newMode,
          cartItems: [],
          repricingCartItems: [],
          repricingSessionId: null,
          customerData: { ...DEFAULT_CUSTOMER },
          intent: null,
          request: null,
          selectedCategory: null,
          availableModels: [],
          selectedModel: null,
          selectedCartItemId: null,
          cexProductData: null,
          cexLoading: false,
          isQuickRepriceOpen: false,
          isCustomerModalOpen: false,
          resetKey: get().resetKey + 1,
          headerWorkspaceOpen: false,
          headerWorkspaceMode: 'builder',
        });
      },
      resetBuyerWorkspace: ({ openCustomerModal = false } = {}) =>
        set((s) => ({
          mode: 'buyer',
          cartItems: [],
          customerData: { ...DEFAULT_CUSTOMER },
          intent: null,
          request: null,
          selectedCategory: null,
          availableModels: [],
          selectedModel: null,
          selectedCartItemId: null,
          cexProductData: null,
          cexLoading: false,
          isQuickRepriceOpen: false,
          isCustomerModalOpen: Boolean(openCustomerModal),
          resetKey: s.resetKey + 1,
          headerWorkspaceOpen: false,
          headerWorkspaceMode: 'builder',
        })),
      resetRepricingWorkspace: () =>
        set((s) => ({
          mode: 'repricing',
          repricingSessionId: null,
          repricingCartItems: [],
          selectedCategory: null,
          selectedModel: null,
          selectedCartItemId: null,
          cexProductData: null,
          cexLoading: false,
          isQuickRepriceOpen: false,
          repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
          headerWorkspaceOpen: false,
          headerWorkspaceMode: 'builder',
        })),
      setHeaderWorkspaceOpen: (open) => set({ headerWorkspaceOpen: Boolean(open) }),
      setHeaderWorkspaceMode: (mode) =>
        set({ headerWorkspaceMode: typeof mode === 'string' && mode ? mode : 'builder' }),
      requestCloseHeaderWorkspace: () =>
        set((s) => ({ closeHeaderWorkspaceTick: s.closeHeaderWorkspaceTick + 1 })),
      setRepricingSessionId: (id) => set({ repricingSessionId: id }),
      clearRepricingSessionDraft: () => set({ repricingSessionId: null, repricingCartItems: [] }),

      // ─── Customer offer rules (loaded once on app start) ──────────────────────────────────────
      customerOfferRulesData: null,
      loadCustomerOfferRulesData: async () => {
        try {
          const data = await fetchCustomerOfferRules();
          set({ customerOfferRulesData: data });
          return data;
        } catch (err) {
          console.warn('[CG Suite] Failed to load customer offer rules:', err);
          return null;
        }
      },

      // ─── eBay / Cash Converters offer % of sale (API keys ebay_offer_margin_*; four tiers) ──
      ebayOfferMargins: null,
      _ebayMarginsByCategory: {},
      loadEbayOfferMargins: async (categoryId) => {
        try {
          const data = await fetchEbayOfferMargins(categoryId);
          const margins = [
            data.ebay_offer_margin_1_pct,
            data.ebay_offer_margin_2_pct,
            data.ebay_offer_margin_3_pct,
            data.ebay_offer_margin_4_pct,
          ];
          if (categoryId) {
            set((s) => ({
              _ebayMarginsByCategory: { ...s._ebayMarginsByCategory, [categoryId]: margins },
            }));
          } else {
            set({ ebayOfferMargins: margins });
          }
          return margins;
        } catch (err) {
          console.warn('[CG Suite] Failed to load eBay/Cash Converters offer % of sale:', err);
          return null;
        }
      },
      invalidateEbayMarginCache: () => set({ _ebayMarginsByCategory: {} }),

      // ─── Cart (buyer and repricing have separate arrays) ──────────────
      cartItems: [],
      repricingCartItems: [],

      addToCart: (item, { showNotification } = {}) => {
        const { mode, customerData } = get();
        const key = _cartKey();
        const cartItems = _getCart();
        const isRepricing = mode === 'repricing';

        if (!isRepricing) {
          const useVoucherOffers = customerData?.transactionType === 'store_credit';
          const offerErr = validateBuyerCartItemOffers(item, useVoucherOffers);
          if (offerErr) {
            showNotification?.(offerErr, 'error');
            return;
          }
        }

        if (item.forceNew) {
          const { forceNew: _, ...clean } = item;
          set({ [key]: [...cartItems, clean] });
          showNotification?.(`${clean.title} added to cart as a new item`, 'success');
          return;
        }

        const existingIdx = findDuplicateIndex(cartItems, item, isRepricing);
        const existing = existingIdx !== -1 ? cartItems[existingIdx] : null;
        const sameOffer = existing && (existing.selectedOfferId ?? null) === (item.selectedOfferId ?? null);

        let msg;
        if (existing) {
          if (isRepricing) msg = `${item.title} is already in the reprice list`;
          else if (sameOffer) msg = `Quantity increased to ${(existing.quantity || 1) + 1} for ${item.title}`;
          else msg = `Offer updated for ${item.title}`;
        } else {
          msg = `${item.title} added to cart`;
        }

        set((state) => {
          const items = [...state[key]];
          const idx = findDuplicateIndex(items, item, isRepricing);
          if (idx === -1) return { [key]: [...items, item] };

          const ex = items[idx];
          const sameSel = (ex.selectedOfferId ?? null) === (item.selectedOfferId ?? null);

          if (isRepricing) {
            items[idx] = { ...ex, ...item, id: ex.id, quantity: 1 };
          } else if (sameSel) {
            items[idx] = { ...ex, quantity: (ex.quantity || 1) + 1 };
          } else {
            items[idx] = {
              ...ex,
              selectedOfferId: item.selectedOfferId,
              offers: item.offers ?? ex.offers,
              cashOffers: item.cashOffers ?? ex.cashOffers,
              voucherOffers: item.voucherOffers ?? ex.voucherOffers,
            };
          }
          return { [key]: items };
        });

        setTimeout(() => showNotification?.(msg, 'success'), 0);
      },

      removeFromCart: async (item, { showNotification } = {}) => {
        const { request } = get();
        const key = _cartKey();
        if (request?.request_id && item.request_item_id) {
          try {
            await deleteRequestItem(item.request_item_id);
          } catch (err) {
            showNotification?.(err?.message || 'Failed to remove item from quote', 'error');
            return;
          }
        }
        set((state) => {
          const next = state[key].filter((i) => i.id !== item.id);
          const sel = state.selectedCartItemId === item.id ? null : state.selectedCartItemId;
          return { [key]: next, selectedCartItemId: sel };
        });
      },

      updateCartItem: (itemId, updates) => {
        const key = _cartKey();
        const { mode } = get();
        const isRepricing = mode === 'repricing';

        // Persist quantity changes to the backend immediately so reopening
        // the request form always shows the latest quantity.
        if (!isRepricing && updates.quantity != null) {
          const item = get()[key]?.find((i) => i.id === itemId);
          if (item?.request_item_id) {
            updateRequestItemOffer(item.request_item_id, { quantity: updates.quantity }).catch((err) => {
              console.error('[Store] Failed to persist quantity:', err);
            });
          }
        }

        set((state) => ({
          [key]: state[key].map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
        }));
      },

      updateCartItemOffers: (cartItemId, updatedOfferData) => {
        const { mode, request } = get();
        const key = _cartKey();
        const cartItems = _getCart();
        const isRepricing = mode === 'repricing';
        const item = cartItems.find((i) => i.id === cartItemId);

        if (
          !isRepricing &&
          item?.request_item_id &&
          (updatedOfferData.selectedOfferId !== undefined ||
            updatedOfferData.manualOffer !== undefined ||
            updatedOfferData.ourSalePrice !== undefined ||
            updatedOfferData.cashOffers !== undefined ||
            updatedOfferData.voucherOffers !== undefined)
        ) {
          const payload = {};
          if (updatedOfferData.selectedOfferId !== undefined) {
            payload.selected_offer_id = updatedOfferData.selectedOfferId;
            payload.manual_offer_used = updatedOfferData.selectedOfferId === 'manual';
          }
          if (updatedOfferData.manualOffer !== undefined && updatedOfferData.manualOffer !== '') {
            const parsed = parseFloat(String(updatedOfferData.manualOffer).replace(/[£,]/g, ''));
            payload.manual_offer_gbp = !isNaN(parsed) ? normalizeExplicitSalePrice(parsed) : null;
          }
          if (updatedOfferData.ourSalePrice !== undefined) {
            const parsed = parseFloat(String(updatedOfferData.ourSalePrice).replace(/[£,]/g, ''));
            payload.our_sale_price_at_negotiation = !isNaN(parsed) && parsed > 0 ? normalizeExplicitSalePrice(parsed) : null;
          }
          if (Array.isArray(updatedOfferData.cashOffers)) {
            payload.cash_offers_json = normalizeOffers(updatedOfferData.cashOffers);
          }
          if (Array.isArray(updatedOfferData.voucherOffers)) {
            payload.voucher_offers_json = normalizeOffers(updatedOfferData.voucherOffers);
          }
          if (Object.keys(payload).length > 0) {
            updateRequestItemOffer(item.request_item_id, payload).catch((err) => {
              console.error('[Store] Failed to persist offer:', err);
            });
          }
        }

        let merged = { ...updatedOfferData };
        if (
          updatedOfferData.selectedOfferId !== undefined &&
          updatedOfferData.selectedOfferId !== 'manual'
        ) {
          merged = {
            ...merged,
            ...revokeManualOfferAuthorisationIfSwitchingAway(item, updatedOfferData.selectedOfferId),
          };
        }

        set((state) => ({
          [key]: state[key].map((i) => (i.id === cartItemId ? { ...i, ...merged } : i)),
        }));
      },

      updateCartItemResearchData: (variantId, type, data) => {
        const key = _cartKey();
        set((state) => ({
          [key]: state[key].map((item) => {
            if (item.variantId !== variantId) return item;
            const updated =
              type === 'ebay' ? { ...item, ebayResearchData: data } : { ...item, cashConvertersResearchData: data };
            if (item.request_item_id) {
              const payload =
                type === 'ebay'
                  ? {
                      raw_data: buildPersistedEbayRawData(data, {
                        categoryObject: item.categoryObject,
                        referenceData: item.referenceData,
                      }),
                    }
                  : { cash_converters_data: data };
              updateRequestItemRawData(item.request_item_id, payload).catch(() => {});
            }
            return updated;
          }),
        }));
      },

      setCartItems: (items) => set({ [_cartKey()]: items }),

      // ─── Customer ──────────────────────────────────────────────────────
      customerData: { ...DEFAULT_CUSTOMER },
      intent: null,

      setCustomer: (info) => {
        if (!info) return;
        const mappedIntent = mapTransactionTypeToIntent(info.transactionType || 'sale');
        const c = info.customer || {};
        set({
          customerData: {
            id: info.id,
            name: info.customerName,
            cancelRate: info.cancelRate || 0,
            transactionType: info.transactionType || 'sale',
            isNewCustomer: info.isNewCustomer ?? false,
            nospos_customer_id:
              info.nospos_customer_id ??
              c.nosposCustomerId ??
              c.nospos_customer_id ??
              null,
            joined: c.joined || null,
            lastTransacted: c.lastTransacted || null,
            buyBackRate: c.buyBackRate || null,
            buyBackRateRaw: c.buyBackRateRaw || null,
            renewRate: c.renewRate || null,
            renewRateRaw: c.renewRateRaw || null,
            cancelRateStr: c.cancelRate || null,
            cancelRateRaw: c.cancelRateRaw || null,
            faultyRate: c.faultyRate || null,
            faultyRateRaw: c.faultyRateRaw || null,
            buyingCount: c.buyingCount || null,
            salesCount: c.salesCount || null,
            bypassReason: info.bypassReason || null,
          },
          intent: mappedIntent,
          isCustomerModalOpen: false,
        });
      },

      setCustomerData: (data) => set({ customerData: data }),

      setTransactionType: (newType) => {
        const { customerData, mode } = get();
        const key = _cartKey();
        const cartItems = _getCart();
        if (newType === customerData.transactionType) return;

        const prevUseVoucher = customerData.transactionType === 'store_credit';
        const newUseVoucher = newType === 'store_credit';

        const nextCartItems = cartItems.map((item) =>
          recalcOffersForTransactionType(item, prevUseVoucher, newUseVoucher)
        );

        set({
          customerData: { ...customerData, transactionType: newType },
          intent: mapTransactionTypeToIntent(newType),
          [key]: nextCartItems,
        });

        if (mode !== 'repricing') {
          for (let i = 0; i < cartItems.length; i++) {
            const prevItem = cartItems[i];
            const nextItem = nextCartItems[i];
            if (
              nextItem?.request_item_id &&
              (prevItem?.selectedOfferId ?? null) !== (nextItem?.selectedOfferId ?? null)
            ) {
              const payload = {
                selected_offer_id: nextItem.selectedOfferId,
                manual_offer_used: nextItem.selectedOfferId === 'manual',
              };
              if (nextItem.manualOffer != null && nextItem.manualOffer !== '') {
                const parsed = parseFloat(String(nextItem.manualOffer).replace(/[£,]/g, ''));
                if (!isNaN(parsed)) payload.manual_offer_gbp = normalizeExplicitSalePrice(parsed);
              }
              updateRequestItemOffer(nextItem.request_item_id, payload).catch((err) => {
                console.error('[Store] Persist offer after transaction type change failed:', err);
              });
            }
          }
        }
      },

      // ─── Request ────────────────────────────────────────────────────────
      request: null,

      setRequest: (req) => set({ request: req }),

      createOrAppendRequestItem: async (itemPayload) => {
        const { request, customerData, intent } = get();
        const resolvedIntent = intent || mapTransactionTypeToIntent(customerData?.transactionType);

        const payload = {
          variant: itemPayload.variantId ?? null,
          expectation_gbp: null,
          raw_data: itemPayload.rawData,
          cash_converters_data: itemPayload.cashConvertersData,
          notes: '',
        };
        if (itemPayload.cexSku != null) payload.cex_sku = itemPayload.cexSku;
        if (Array.isArray(itemPayload.cashOffers) && itemPayload.cashOffers.length > 0) {
          payload.cash_offers_json = normalizeOffers(itemPayload.cashOffers);
        }
        if (Array.isArray(itemPayload.voucherOffers) && itemPayload.voucherOffers.length > 0) {
          payload.voucher_offers_json = normalizeOffers(itemPayload.voucherOffers);
        }
        if (itemPayload.selectedOfferId != null && itemPayload.selectedOfferId !== '') {
          payload.selected_offer_id = itemPayload.selectedOfferId;
          payload.manual_offer_used = itemPayload.selectedOfferId === 'manual';
        }
        if (itemPayload.manualOffer != null && itemPayload.manualOffer !== '' && !isNaN(parseFloat(itemPayload.manualOffer))) {
          payload.manual_offer_gbp = normalizeExplicitSalePrice(parseFloat(itemPayload.manualOffer));
        }
        if (itemPayload.ourSalePrice != null && itemPayload.ourSalePrice !== '' && !isNaN(parseFloat(itemPayload.ourSalePrice))) {
          payload.our_sale_price_at_negotiation = normalizeExplicitSalePrice(parseFloat(itemPayload.ourSalePrice));
        }

        if (!request) {
          if (!customerData?.id) throw new Error('Customer must be selected before adding items');
          if (!resolvedIntent) throw new Error('Transaction type must be selected before adding items');

          const reqPayload = {
            customer_id: customerData.id,
            intent: resolvedIntent,
            item: payload,
            ...(customerData && { customer_enrichment: customerData }),
          };
          const newRequest = await createRequest(reqPayload);
          set({ request: newRequest });
          const firstItem = newRequest?.items?.[0];
          if (!firstItem?.request_item_id) throw new Error('Invalid response: no request_item_id returned');
          return firstItem.request_item_id;
        } else {
          const addPayload = { ...payload, ...(customerData && { customer_enrichment: customerData }) };
          const created = await addRequestItem(request.request_id, addPayload);
          return created.request_item_id;
        }
      },

      // ─── Product Selection ──────────────────────────────────────────────
      selectedCategory: null,
      availableModels: [],
      selectedModel: null,
      isLoadingModels: false,
      _modelsRequestId: 0,

      selectCategory: async (category) => {
        if (category == null) {
          set((s) => ({
            _modelsRequestId: s._modelsRequestId + 1,
            selectedCategory: null,
            selectedModel: null,
            availableModels: [],
            isLoadingModels: false,
          }));
          return;
        }
        const id = get()._modelsRequestId + 1;
        set({
          _modelsRequestId: id,
          selectedCartItemId: null,
          cexProductData: null,
          selectedCategory: category,
          selectedModel: null,
          availableModels: [],
          isLoadingModels: true,
        });
        try {
          const models = await fetchProductModels(category);
          if (get()._modelsRequestId !== id) return;
          set({ availableModels: models });
        } finally {
          if (get()._modelsRequestId === id) set({ isLoadingModels: false });
        }
      },

      setSelectedModel: (model) => set({ selectedModel: model }),

      // ─── CeX Product (Add from CeX) ────────────────────────────────────
      cexProductData: null,
      cexLoading: false,

      handleAddFromCeX: async ({ showNotification, searchQuery } = {}) => {
        const trimmedQuery =
          searchQuery != null && String(searchQuery).trim() !== ''
            ? String(searchQuery).trim()
            : undefined;
        set({ cexLoading: true, cexProductData: null });
        try {
          const data = await getDataFromListingPage('CeX', trimmedQuery);
          if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
            const product = data.results[0];
            // Resolve category first so we can pass the DB id to the pricing API
            let categoryObject = product?.category
              ? { name: product.category, path: [product.category] }
              : null;
            try {
              const flat = await fetchAllCategoriesFlat();
              const matched = matchCexCategoryNameToDb(product?.category, flat);
              if (matched) categoryObject = matched;
            } catch (_) {
              // best effort: keep category text-only object
            }

            const payload = {
              sellPrice: product.sellPrice ?? product.price,
              tradeInCash: product.tradeInCash ?? 0,
              tradeInVoucher: product.tradeInVoucher ?? 0,
              title: product.title,
              category: product.category,
              categoryId: categoryObject?.id ?? null,
              image: product.image,
              id: product.id,
            };
            const priceData = await fetchCeXProductPrices(payload);
            const merged = { ...product, ...priceData, categoryObject, listingPageUrl: data.listingPageUrl };
            if (typeof console !== 'undefined') {
              const ref = merged?.referenceData || {};
              console.log('[CG Suite][CategoryRule]', {
                context: 'cex-product-loaded-from-extension',
                categoryName: merged?.categoryObject?.name ?? merged?.category ?? null,
                categoryId: merged?.categoryObject?.id ?? null,
                categoryPath: merged?.categoryObject?.path ?? (merged?.category ? [merged.category] : null),
                rule: {
                  source: 'cex-reference-rule',
                  firstOfferPctOfCex: ref.first_offer_pct_of_cex ?? ref.firstOfferPctOfCex ?? null,
                  secondOfferPctOfCex: ref.second_offer_pct_of_cex ?? ref.secondOfferPctOfCex ?? null,
                  thirdOfferPctOfCex: ref.third_offer_pct_of_cex ?? ref.thirdOfferPctOfCex ?? null,
                  cexBasedSalePrice: ref.cex_based_sale_price ?? null,
                },
              });
            }
            set({ cexProductData: merged });
            showNotification?.('CeX product loaded', 'success');
            return merged;
          } else if (data?.cancelled) {
            // Tab closed or extension cancelled — workspace closes in AppHeader; no error toast
            return null;
          } else {
            showNotification?.(data?.error || 'No data returned', 'error');
            return null;
          }
        } catch (err) {
          console.error('[Store] handleAddFromCeX error:', err);
          showNotification?.(err?.message || 'Extension communication failed', 'error');
          return null;
        } finally {
          set({ cexLoading: false });
        }
      },

      setCexProductData: (dataOrFn) => set((state) => ({
        cexProductData: typeof dataOrFn === 'function' ? dataOrFn(state.cexProductData) : dataOrFn,
      })),
      clearCexProduct: () => set({ cexProductData: null }),

      // ─── UI State ──────────────────────────────────────────────────────
      selectedCartItemId: null,
      isCustomerModalOpen: true,
      isQuickRepriceOpen: false,
      resetKey: 0,

      selectCartItem: async (item) => {
        const { selectedCartItemId, mode, customerData } = get();
        const key = _cartKey();
        const isRepricing = mode === 'repricing';

        if (selectedCartItemId === item.id) {
          if (isRepricing) return;
          set({
            selectedCartItemId: null,
            selectedCategory: null,
            selectedModel: null,
            availableModels: [],
            cexProductData: null,
          });
          return;
        }

        const isCustomResearchOnlyItem =
          item.isCustomEbayItem || item.isCustomCeXItem || item.isCustomCashConvertersItem;
        const immediateUpdates = {
          cexProductData: null,
          selectedCartItemId: item.id,
          // Always clear model state first so MainContent cannot hydrate attributes
          // against a stale product while we resolve the selected cart item's model.
          selectedModel: null,
          availableModels: [],
          isLoadingModels: false,
        };
        if (item.categoryObject) {
          immediateUpdates.selectedCategory = item.categoryObject;
          if (!isCustomResearchOnlyItem) {
            const reqId = get()._modelsRequestId + 1;
            immediateUpdates._modelsRequestId = reqId;
            immediateUpdates.isLoadingModels = true;
            fetchProductModels(item.categoryObject).then(models => {
              if (get()._modelsRequestId !== reqId) return;
              set({ availableModels: models, isLoadingModels: false });
            }).catch(() => {
              if (get()._modelsRequestId === reqId) set({ isLoadingModels: false });
            });
          }
        }
        set(immediateUpdates);

        let activeItem = item;

        if (item.fromQuickReprice && item.cexSku) {
          try {
            const priceData = item.variantId
              ? await fetchVariantPrices(item.cexSku)
              : await fetchCeXProductPrices({
                  sellPrice: item.cexSellPrice,
                  tradeInCash: item.cexBuyPrice,
                  tradeInVoucher: item.cexVoucherPrice,
                  title: item.title,
                  category: item.category || item.subtitle || 'CeX',
                  image: item.image || '',
                  id: item.cexSku,
                });
            activeItem = {
              ...item,
              cashOffers: priceData.cash_offers || [],
              voucherOffers: priceData.voucher_offers || [],
              referenceData: priceData.referenceData || null,
              cexProductData: item.variantId
                ? item.cexProductData
                : { id: item.cexSku, title: item.title, category: item.category || 'CeX', image: item.image || '' },
              fromQuickReprice: false,
            };
            set((state) => ({
              [key]: state[key].map((ci) => (ci.id === item.id ? activeItem : ci)),
            }));
          } catch {
            /* render with available data */
          }
        }

        if (
          !activeItem.isCustomEbayItem &&
          !activeItem.isCustomCeXItem &&
          !activeItem.isCustomCashConvertersItem &&
          activeItem.variantId &&
          activeItem.cexSku &&
          (!activeItem.cashOffers?.length || !activeItem.voucherOffers?.length)
        ) {
          try {
            const priceData = await fetchVariantPrices(activeItem.cexSku);
            const cashOffers = priceData.cash_offers || activeItem.cashOffers || [];
            const voucherOffers = priceData.voucher_offers || activeItem.voucherOffers || [];
            const useVoucher = customerData?.transactionType === 'store_credit';
            activeItem = {
              ...activeItem,
              cashOffers,
              voucherOffers,
              offers: useVoucher ? voucherOffers : cashOffers,
              referenceData: priceData.referenceData || activeItem.referenceData || {},
            };
            set((state) => ({
              [key]: state[key].map((ci) => (ci.id === item.id ? activeItem : ci)),
            }));
          } catch {
            /* render with available data */
          }
        }

        if (
          activeItem.isCustomCeXItem &&
          !activeItem.fromQuickReprice &&
          (activeItem.cexSku || activeItem.cexProductData?.id) &&
          (!activeItem.cexProductData || (!activeItem.cashOffers?.length && !activeItem.voucherOffers?.length))
        ) {
          try {
            const sku = activeItem.cexSku || activeItem.cexProductData?.id;
            const priceData = await fetchCeXProductPrices({
              sellPrice: activeItem.cexSellPrice,
              tradeInCash: activeItem.cexBuyPrice,
              tradeInVoucher: activeItem.cexVoucherPrice,
              title: activeItem.title,
              category: activeItem.category || activeItem.subtitle || 'CeX',
              image: activeItem.image || activeItem.cexProductData?.image || '',
              id: sku,
            });
            activeItem = {
              ...activeItem,
              cashOffers: priceData.cash_offers || activeItem.cashOffers || [],
              voucherOffers: priceData.voucher_offers || activeItem.voucherOffers || [],
              offers: (priceData.cash_offers?.length ? priceData.cash_offers : activeItem.cashOffers) || [],
              referenceData: priceData.referenceData || activeItem.referenceData || {},
              cexProductData: {
                id: sku,
                title: activeItem.title,
                category: activeItem.category || 'CeX',
                image: activeItem.image || activeItem.cexProductData?.image || '',
                specifications: activeItem.cexProductData?.specifications || {},
                ...activeItem.cexProductData,
              },
            };
            set((state) => ({
              [key]: state[key].map((ci) => (ci.id === item.id ? activeItem : ci)),
            }));
          } catch {
            /* render with available data */
          }
        }

      },

      deselectCartItem: () => set({ selectedCartItemId: null }),
      setCustomerModalOpen: (v) => set({ isCustomerModalOpen: v }),
      setQuickRepriceOpen: (v) => set({ isQuickRepriceOpen: v }),

      onItemAddedToCart: () => {
        set({ selectedCategory: null, selectedModel: null, selectedCartItemId: null });
      },

      // ─── Reset ──────────────────────────────────────────────────────────
      resetBuyer: async ({ showNotification } = {}) => {
        const { mode, request } = get();
        const isRepricing = mode === 'repricing';
        const key = _cartKey();
        const currentCart = _getCart();

        if (!isRepricing && currentCart.length > 0) {
          const promises = [];
          for (const item of currentCart) {
            if (!item?.request_item_id) continue;
            const payload = {};
            if (item.selectedOfferId !== undefined) {
              payload.selected_offer_id = item.selectedOfferId;
              payload.manual_offer_used = item.selectedOfferId === 'manual';
            }
            if (item.manualOffer !== undefined && item.manualOffer !== '') {
              const parsed = parseFloat(String(item.manualOffer).replace(/[£,]/g, ''));
              payload.manual_offer_gbp = !isNaN(parsed) ? normalizeExplicitSalePrice(parsed) : null;
            }
            if (item.ourSalePrice !== undefined) {
              const parsed = parseFloat(String(item.ourSalePrice).replace(/[£,]/g, ''));
              payload.our_sale_price_at_negotiation = !isNaN(parsed) && parsed > 0 ? normalizeExplicitSalePrice(parsed) : null;
            }
            if (Array.isArray(item.cashOffers)) {
              payload.cash_offers_json = normalizeOffers(item.cashOffers);
            }
            if (Array.isArray(item.voucherOffers)) {
              payload.voucher_offers_json = normalizeOffers(item.voucherOffers);
            }
            if (Object.keys(payload).length > 0) {
              promises.push(updateRequestItemOffer(item.request_item_id, payload).catch(() => {}));
            }
          }
          if (promises.length > 0) await Promise.all(promises);
        }

        set({
          selectedCategory: null,
          availableModels: [],
          selectedModel: null,
          [key]: [],
          selectedCartItemId: null,
          ...(isRepricing ? {} : { customerData: { ...DEFAULT_CUSTOMER }, intent: null, request: null }),
          isCustomerModalOpen: !isRepricing,
          cexProductData: null,
          cexLoading: false,
          isQuickRepriceOpen: false,
          ...(isRepricing ? { repricingSessionId: null } : {}),
          resetKey: get().resetKey + 1,
        });

        showNotification?.('Buying module reset', 'success');
      },

      // ─── Restore from API (quote) ──────────────────────────────────────
      restoreFromQuoteRequest: (req) => {
        if (!req || req.current_status !== 'QUOTE') return;
        const transactionType =
          req.intent === 'DIRECT_SALE' ? 'sale' : req.intent === 'BUYBACK' ? 'buyback' : 'store_credit';
        const customer = mapRequestToCustomerData(req);
        const items = mapRequestItemsToCartItems(req.items, transactionType);

        set({
          customerData: customer,
          intent: mapTransactionTypeToIntent(transactionType),
          request: req,
          cartItems: items,
          isCustomerModalOpen: false,
          selectedCartItemId: null,
          selectedCategory: null,
          selectedModel: null,
        });
      },

      hydrateFromRequest: async (requestId) => {
        if (!requestId) return;
        try {
          const data = await fetchRequestDetail(requestId);
          if (!data) return;
          const status = data.current_status ?? data.status_history?.[0]?.status;
          if (status !== 'QUOTE') {
            get().resetBuyer();
            return;
          }
          set({ request: data });
        } catch {
          /* ignore */
        }
      },

      // ─── Quick Reprice Items ────────────────────────────────────────────
      addQuickRepriceItems: (foundItems, { showNotification } = {}) => {
        const { addToCart } = get();
        let count = 0;
        for (const result of foundItems) {
          const cartItem = {
            id: generateId(),
            title: result.title,
            subtitle: result.subtitle || result.condition || '',
            offers: [],
            cashOffers: [],
            voucherOffers: [],
            quantity: 1,
            variantId: result.variant_id ?? null,
            cexSku: result.cex_sku,
            model: result.product_name || result.title,
            category: result.category_name || '',
            categoryObject: result.category_name
              ? {
                  ...(result.category_id != null ? { id: result.category_id } : {}),
                  name: result.category_name,
                  path: [result.category_name],
                }
              : null,
            condition: result.condition || '',
            attributeValues: result.attribute_values || {},
            ourSalePrice:
              result.our_sale_price != null && Number.isFinite(Number(result.our_sale_price))
                ? roundSalePrice(Number(result.our_sale_price))
                : null,
            cexSellPrice: result.cex_sale_price ?? null,
            cexBuyPrice: result.cex_tradein_cash ?? null,
            cexVoucherPrice: result.cex_tradein_voucher ?? null,
            image: result.image || '',
            nosposBarcodes: result.nosposBarcodes || [],
            isCustomCeXItem: !result.in_db,
            fromQuickReprice: true,
            offerType: 'cash',
            selectedOfferId: null,
            ebayResearchData: null,
            cashConvertersResearchData: null,
            referenceData: null,
            request_item_id: null,
          };
          addToCart(withDefaultRrpOffersSource(cartItem));
          count++;
        }
        showNotification?.(`${count} item${count !== 1 ? 's' : ''} added to reprice list`, 'success');
      },
    });}
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const useCartItems = () => useAppStore((s) => s.mode === 'repricing' ? s.repricingCartItems : s.cartItems);
export const useCustomerData = () => useAppStore((s) => s.customerData);
export const useIsRepricing = () => useAppStore((s) => s.mode === 'repricing');
export const useUseVoucherOffers = () => useAppStore((s) => s.customerData?.transactionType === 'store_credit');
export const useEbayOfferMargins = (categoryId) =>
  useAppStore((s) => {
    if (categoryId && s._ebayMarginsByCategory[categoryId]) {
      return s._ebayMarginsByCategory[categoryId];
    }
    return s.ebayOfferMargins;
  });

export const useSelectedCartItem = () =>
  useAppStore((s) => {
    if (!s.selectedCartItemId) return null;
    const cart = s.mode === 'repricing' ? s.repricingCartItems : s.cartItems;
    return cart.find((i) => i.id === s.selectedCartItemId) ?? null;
  });

export const useOfferTotals = () =>
  useAppStore(
    useShallow((s) => {
      const cart = s.mode === 'repricing' ? s.repricingCartItems : s.cartItems;
      let min = 0,
        max = 0,
        total = 0;
      let allSelected = true;

      for (const item of cart) {
        const qty = item.quantity || 1;
        const prices = (item.offers || []).map((o) => Number(o.price)).filter((p) => !isNaN(p) && p >= 0);
        if (prices.length > 0) {
          min += Math.min(...prices) * qty;
          max += Math.max(...prices) * qty;
        }

        if (item.selectedOfferId === 'manual' && item.manualOffer != null) {
          total += Number(item.manualOffer) * qty;
        } else if (item.selectedOfferId && item.offers?.length > 0) {
          const sel = item.offers.find((o) => o.id === item.selectedOfferId);
          if (sel) total += Number(sel.price) * qty;
          else allSelected = false;
        } else {
          allSelected = false;
        }
      }

      return {
        offerMin: cart.length > 0 ? min : null,
        offerMax: cart.length > 0 ? max : null,
        totalOffer: cart.length > 0 && allSelected ? total : null,
      };
    })
  );

export default useAppStore;
