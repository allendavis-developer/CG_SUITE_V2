/**
 * Buyer module handler.
 *
 * Owns all cart / selection / transaction behaviour specific to the buying
 * workspace: offer validation, backend persistence through request_item_id,
 * customer/request reset on workspace clear, and toggle-off on re-selecting
 * a cart item.
 *
 * Never branches on workspace kind — it *is* the buyer kind. Sibling
 * handlers (reprice, upload) live alongside and share helpers from shared.js.
 */

import {
  updateRequestItemOffer,
  fetchProductModels,
  fetchVariantPrices,
  fetchCeXProductPrices,
} from '@/services/api';
import { persistItemOffer, buildItemOfferPayload } from '@/negotiation/persistItemOffer';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import { validateBuyerCartItemOffers } from '@/utils/cartOfferValidation';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { ROUTE_ENTRY_CUSTOMER } from '@/store/workspaceRouteBootstrap';
import { BUYER_WORKSPACE } from '../descriptors.js';
import {
  findDuplicateIndex,
  recalcOffersForTransactionType,
  coerceQuantity,
} from './shared.js';

const CART_KEY = BUYER_WORKSPACE.cartStateKey;

export const buyerHandler = {
  kind: 'buyer',
  descriptor: BUYER_WORKSPACE,

  addToCart({ set, get }, item, { showNotification } = {}) {
    const { customerData } = get();
    const cartItems = get()[CART_KEY];

    const useVoucherOffers = customerData?.transactionType === 'store_credit';
    const offerErr = validateBuyerCartItemOffers(item, useVoucherOffers);
    if (offerErr) {
      showNotification?.(offerErr, 'error');
      return;
    }

    if (item.forceNew) {
      const { forceNew: _, ...clean } = item;
      set({ [CART_KEY]: [...cartItems, clean] });
      showNotification?.(`${clean.title} added to cart as a new item`, 'success');
      return;
    }

    const existingIdx = findDuplicateIndex(cartItems, item);
    const existing = existingIdx !== -1 ? cartItems[existingIdx] : null;
    const sameOffer = existing && (existing.selectedOfferId ?? null) === (item.selectedOfferId ?? null);

    const msg = !existing
      ? `${item.title} added to cart`
      : sameOffer
      ? `Quantity increased to ${(existing.quantity || 1) + 1} for ${item.title}`
      : `Offer updated for ${item.title}`;

    set((state) => {
      const items = [...state[CART_KEY]];
      const idx = findDuplicateIndex(items, item);
      if (idx === -1) return { [CART_KEY]: [...items, item] };

      const ex = items[idx];
      const sameSel = (ex.selectedOfferId ?? null) === (item.selectedOfferId ?? null);
      if (sameSel) {
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
      return { [CART_KEY]: items };
    });

    setTimeout(() => showNotification?.(msg, 'success'), 0);
  },

  updateCartItem({ set, get }, itemId, updates) {
    const nextUpdates = { ...updates };
    if (nextUpdates.quantity != null) {
      nextUpdates.quantity = coerceQuantity(nextUpdates.quantity);
    }

    if (nextUpdates.quantity != null) {
      const item = get()[CART_KEY]?.find((i) => i.id === itemId);
      if (item?.request_item_id) {
        updateRequestItemOffer(item.request_item_id, { quantity: nextUpdates.quantity }).catch((err) => {
          console.error('[Store] Failed to persist quantity:', err);
        });
      }
    }

    set((state) => ({
      [CART_KEY]: state[CART_KEY].map((i) => (i.id === itemId ? { ...i, ...nextUpdates } : i)),
    }));
  },

  updateCartItemOffers({ set, get }, cartItemId, updatedOfferData) {
    const cartItems = get()[CART_KEY];
    const item = cartItems.find((i) => i.id === cartItemId);

    if (item?.request_item_id) {
      void persistItemOffer(item, updatedOfferData);
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
      [CART_KEY]: state[CART_KEY].map((i) => (i.id === cartItemId ? { ...i, ...merged } : i)),
    }));
  },

  setTransactionType({ set, get }, newType) {
    const { customerData } = get();
    if (newType === customerData.transactionType) return;

    const cartItems = get()[CART_KEY];
    const prevUseVoucher = customerData.transactionType === 'store_credit';
    const newUseVoucher = newType === 'store_credit';

    const nextCartItems = cartItems.map((item) =>
      recalcOffersForTransactionType(item, prevUseVoucher, newUseVoucher)
    );

    set({
      customerData: { ...customerData, transactionType: newType },
      intent: mapTransactionTypeToIntent(newType),
      [CART_KEY]: nextCartItems,
    });

    for (let i = 0; i < cartItems.length; i++) {
      const prevItem = cartItems[i];
      const nextItem = nextCartItems[i];
      if (
        nextItem?.request_item_id &&
        (prevItem?.selectedOfferId ?? null) !== (nextItem?.selectedOfferId ?? null)
      ) {
        void persistItemOffer(nextItem, {
          selectedOfferId: nextItem.selectedOfferId,
          manualOffer: nextItem.manualOffer,
        });
      }
    }
  },

  async resetWorkspace({ set, get }, { showNotification } = {}) {
    const currentCart = get()[CART_KEY];

    if (currentCart.length > 0) {
      const promises = [];
      for (const item of currentCart) {
        if (!item?.request_item_id) continue;
        const payload = buildItemOfferPayload({
          selectedOfferId: item.selectedOfferId,
          manualOffer: item.manualOffer,
          ourSalePrice: item.ourSalePrice,
          cashOffers: item.cashOffers,
          voucherOffers: item.voucherOffers,
        });
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
      [CART_KEY]: [],
      selectedCartItemId: null,
      customerData: { ...ROUTE_ENTRY_CUSTOMER },
      intent: null,
      request: null,
      isCustomerModalOpen: true,
      cexProductData: null,
      cexLoading: false,
      isQuickRepriceOpen: false,
      resetKey: get().resetKey + 1,
    });

    showNotification?.('Buying module reset', 'success');
  },

  async selectCartItem({ set, get }, item) {
    const { selectedCartItemId, customerData } = get();

    if (selectedCartItemId === item.id) {
      set({
        selectedCartItemId: null,
        selectedCategory: null,
        selectedModel: null,
        availableModels: [],
        cexProductData: null,
      });
      return;
    }

    await runSelectionHydration({ set, get, item, customerData, cartKey: CART_KEY });
  },
};

/**
 * Price-hydration pipeline shared by buyer, reprice, and upload selection.
 * Exported so sibling handlers can reuse without re-implementing.
 */
export async function runSelectionHydration({ set, get, item, customerData, cartKey }) {
  const isCustomResearchOnlyItem =
    item.isCustomEbayItem ||
    item.isCustomCeXItem ||
    item.isCustomCashConvertersItem ||
    item.isCustomCashGeneratorItem;

  const immediateUpdates = {
    cexProductData: null,
    selectedCartItemId: item.id,
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
      fetchProductModels(item.categoryObject)
        .then((models) => {
          if (get()._modelsRequestId !== reqId) return;
          set({ availableModels: models, isLoadingModels: false });
        })
        .catch(() => {
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
        [cartKey]: state[cartKey].map((ci) => (ci.id === item.id ? activeItem : ci)),
      }));
    } catch {
      /* render with available data */
    }
  }

  if (
    !activeItem.isCustomEbayItem &&
    !activeItem.isCustomCeXItem &&
    !activeItem.isCustomCashConvertersItem &&
    !activeItem.isCustomCashGeneratorItem &&
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
        [cartKey]: state[cartKey].map((ci) => (ci.id === item.id ? activeItem : ci)),
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
        [cartKey]: state[cartKey].map((ci) => (ci.id === item.id ? activeItem : ci)),
      }));
    } catch {
      /* render with available data */
    }
  }
}
