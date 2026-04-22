import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  fetchProductModels,
  createRequest,
  addRequestItem,
  updateRequestItemRawData,
  deleteRequestItem,
  fetchRequestDetail,
  fetchEbayOfferMargins,
  fetchCustomerOfferRules,
} from '@/services/api';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';
import { resolveMarketplaceDescriptor, MARKETPLACE_DESCRIPTORS } from '@/marketplace/descriptors';
import { getActiveCart, getActiveWorkspaceDescriptor } from '@/workspace/descriptors';
import { getActiveHandler } from '@/workspace/handlers';
import { normalizeOffers } from '@/workspace/handlers/shared';
import { runHandleAddFromCeX, runSelectCartItem } from './negotiationActions';
import { mapRequestItemsToCartItems, mapRequestToCustomerData } from '@/utils/requestToCartMapping';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { withDefaultRrpOffersSource } from '@/pages/buyer/utils/negotiationHelpers';
import { ROUTE_ENTRY_CUSTOMER } from '@/store/workspaceRouteBootstrap';

const DEFAULT_CUSTOMER = ROUTE_ENTRY_CUSTOMER;

function generateId() {
  return crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const useAppStore = create(
    (set, get) => {

      const _cartKey = () => getActiveWorkspaceDescriptor(get()).cartStateKey;
      const _getCart = () => getActiveCart(get());

    return ({
      // ─── Mode ───────────────────────────────────────────────────────────
      mode: 'buyer',
      repricingSessionId: null,
      /** When `mode === 'repricing'`: classic repricing vs upload (affects cart / header list copy). */
      repricingWorkspaceKind: 'repricing',
      /** Routes for repricing-like workspaces (repricing vs upload); Cart / negotiation use these when mode is repricing. */
      repricingHomePath: '/repricing',
      repricingNegotiationPath: '/repricing-negotiation',
      /** Incremented when starting a blank repricing workspace so the route remounts even if path is unchanged. */
      repricingWorkspaceNonce: 0,
      /** True when the AppHeader workspace panel (builder/eBay/CeX) is mounted. */
      headerWorkspaceOpen: false,
      /** Synced from AppHeader: `builder` | `ebay` | `cashConverters` | `cashGenerator` | `cex` | `jewellery` */
      headerWorkspaceMode: 'builder',
      /** Increment to ask AppHeader to run full workspace reset (e.g. after jewellery Complete). */
      closeHeaderWorkspaceTick: 0,
      /** Upload list: pick a top-level builder category from the row context menu — AppHeader applies local tree state. */
      pendingBuilderTopCategoryId: null,
      pendingBuilderTopCategoryNonce: 0,
      /**
       * Incremented when the user activates Jewellery from the header (diamond).
       * JewelleryLineItems opens the type/material picker when idle and data is ready.
       */
      jewelleryPickerOpenNonce: 0,
      /** `{ lastUrl }` when the extension reports the Web EPOS upload window was closed (reopen from launchpad). */
      webEposWorkerClosedPrompt: null,
      setWebEposWorkerClosedPrompt: (payload) => set({ webEposWorkerClosedPrompt: payload }),

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
          repricingWorkspaceKind: 'repricing',
          repricingHomePath: '/repricing',
          repricingNegotiationPath: '/repricing-negotiation',
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
          pendingBuilderTopCategoryId: null,
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
          pendingBuilderTopCategoryId: null,
        })),
      resetRepricingWorkspace: ({ homePath, negotiationPath } = {}) => {
        const hp = homePath ?? '/repricing';
        const np = negotiationPath ?? '/repricing-negotiation';
        const repricingWorkspaceKind = hp === '/upload' ? 'upload' : 'repricing';
        return set((s) => ({
          mode: 'repricing',
          repricingWorkspaceKind,
          repricingSessionId: null,
          repricingCartItems: [],
          repricingHomePath: hp,
          repricingNegotiationPath: np,
          selectedCategory: null,
          selectedModel: null,
          selectedCartItemId: null,
          cexProductData: null,
          cexLoading: false,
          isQuickRepriceOpen: false,
          repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
          headerWorkspaceOpen: false,
          headerWorkspaceMode: 'builder',
          pendingBuilderTopCategoryId: null,
        }));
      },
      setHeaderWorkspaceOpen: (open) => set({ headerWorkspaceOpen: Boolean(open) }),
      setHeaderWorkspaceMode: (mode) =>
        set({ headerWorkspaceMode: typeof mode === 'string' && mode ? mode : 'builder' }),
      requestCloseHeaderWorkspace: () =>
        set((s) => ({ closeHeaderWorkspaceTick: s.closeHeaderWorkspaceTick + 1 })),
      requestOpenBuilderTopCategory: (categoryId) =>
        set((s) => ({
          pendingBuilderTopCategoryId: categoryId != null ? String(categoryId) : null,
          pendingBuilderTopCategoryNonce: s.pendingBuilderTopCategoryNonce + 1,
        })),
      clearPendingBuilderTopCategory: () => set({ pendingBuilderTopCategoryId: null }),
      requestJewelleryPickerOpen: () =>
        set((s) => ({ jewelleryPickerOpenNonce: s.jewelleryPickerOpenNonce + 1 })),
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

      addToCart: (item, opts = {}) => {
        getActiveHandler(get()).addToCart({ set, get }, item, opts);
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
        getActiveHandler(get()).updateCartItem({ set, get }, itemId, updates);
      },

      updateCartItemOffers: (cartItemId, updatedOfferData) => {
        getActiveHandler(get()).updateCartItemOffers({ set, get }, cartItemId, updatedOfferData);
      },

      updateCartItemResearchData: (variantId, type, data) => {
        const key = _cartKey();
        const descriptor = resolveMarketplaceDescriptor(type) ?? MARKETPLACE_DESCRIPTORS.cashConverters;
        set((state) => ({
          [key]: state[key].map((item) => {
            if (item.variantId !== variantId) return item;
            const updated = { ...item, [descriptor.researchDataKey]: data };
            if (item.request_item_id) {
              const payload =
                descriptor.id === 'ebay'
                  ? {
                      raw_data: buildPersistedEbayRawData(data, {
                        categoryObject: item.categoryObject,
                        referenceData: item.referenceData,
                      }),
                    }
                  : { [descriptor.rawDataKey]: data };
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
        getActiveHandler(get()).setTransactionType({ set, get }, newType);
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
          cg_data: itemPayload.cgData ?? itemPayload.cgResearchData ?? null,
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
        if (itemPayload.customerExpectation != null && String(itemPayload.customerExpectation).trim() !== '') {
          const ceParsed = parseFloat(String(itemPayload.customerExpectation).replace(/[£,]/g, ''));
          if (!isNaN(ceParsed) && ceParsed >= 0) {
            payload.customer_expectation_gbp = normalizeExplicitSalePrice(ceParsed);
          }
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

      handleAddFromCeX: (args) => runHandleAddFromCeX({ set, get }, args),

      setCexProductData: (dataOrFn) => set((state) => ({
        cexProductData: typeof dataOrFn === 'function' ? dataOrFn(state.cexProductData) : dataOrFn,
      })),
      clearCexProduct: () => set({ cexProductData: null }),

      // ─── UI State ──────────────────────────────────────────────────────
      selectedCartItemId: null,
      isCustomerModalOpen: true,
      isQuickRepriceOpen: false,
      auditBarcodes: [],
      auditRows: [],
      resetKey: 0,

      selectCartItem: (item) => runSelectCartItem({ set, get }, item),

      deselectCartItem: () => set({ selectedCartItemId: null }),
      setCustomerModalOpen: (v) => set({ isCustomerModalOpen: v }),
      setQuickRepriceOpen: (v) => set({ isQuickRepriceOpen: v }),

      onItemAddedToCart: () => {
        set({ selectedCategory: null, selectedModel: null, selectedCartItemId: null });
      },

      // ─── Reset ──────────────────────────────────────────────────────────
      resetBuyer: async (opts = {}) => {
        await getActiveHandler(get()).resetWorkspace({ set, get }, opts);
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
            cgResearchData: null,
            referenceData: null,
            request_item_id: null,
          };
          addToCart(withDefaultRrpOffersSource(cartItem));
          count++;
        }
        const { listNoun } = getActiveWorkspaceDescriptor(get());
        showNotification?.(`${count} item${count !== 1 ? 's' : ''} added to ${listNoun}`, 'success');
      },
    });
  }
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const useCartItems = () => useAppStore((s) => getActiveCart(s));
export const useActiveWorkspace = () => useAppStore((s) => getActiveWorkspaceDescriptor(s));
export const useCustomerData = () => useAppStore((s) => s.customerData);
export const useIsRepricing = () => useAppStore((s) => s.mode === 'repricing');

/** True on /upload and /upload-negotiation (shared repricing cart + extension flows, upload copy). */
export const useIsUploadWorkspace = () =>
  useAppStore((s) => s.mode === 'repricing' && s.repricingWorkspaceKind === 'upload');
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
    return getActiveCart(s).find((i) => i.id === s.selectedCartItemId) ?? null;
  });

export const useOfferTotals = () =>
  useAppStore(
    useShallow((s) => {
      const cart = getActiveCart(s);
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
