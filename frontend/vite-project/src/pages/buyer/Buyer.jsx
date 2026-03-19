import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from '@/components/ui/components';
import AppHeader from '@/components/AppHeader';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import QuickRepriceModal from "@/components/modals/QuickRepriceModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';
import { loadSnapshot, saveSnapshot, clearSnapshot, defaultSnapshot } from '@/pages/buyer/buyerPageStore';

import { fetchProductModels, updateRequestItemRawData, updateRequestItemOffer, fetchRequestDetail, fetchCeXProductPrices, fetchVariantPrices, deleteRequestItem } from '@/services/api';
import { getDataFromListingPage } from '@/services/extensionClient';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { mapRequestItemsToCartItems, mapRequestToCustomerData } from '@/utils/requestToCartMapping';

function getInitialSnapshot(mode) {
  return loadSnapshot(mode);
}

function normalizeOffersForPersistence(offers) {
  if (!Array.isArray(offers)) return undefined;
  return offers.map((offer) => ({
    id: offer.id,
    title: offer.title,
    price: Number(offer.price),
  }));
}

export default function Buyer({ mode = 'buyer' }) {
  const isRepricing = mode === 'repricing';
  const location = useLocation();
  const { showNotification } = useNotification();

  const initialSnapshotRef = useRef(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = getInitialSnapshot(mode);
  }
  const snap = initialSnapshotRef.current;

  const [selectedCategory, setSelectedCategory] = useState(() => snap.selectedCategory ?? null);
  const [availableModels, setAvailableModels] = useState(() => snap.availableModels ?? []);
  const [selectedModel, setSelectedModel] = useState(() => snap.selectedModel ?? null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [cartItems, setCartItems] = useState(() => snap.cartItems ?? []);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(() =>
    snap.isCustomerModalOpen !== undefined ? snap.isCustomerModalOpen : !isRepricing
  );
  const [selectedCartItem, setSelectedCartItem] = useState(null);

  const [customerData, setCustomerData] = useState(() => snap.customerData ?? {
    id: null,
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale'
  });

  const [intent, setIntent] = useState(() => snap.intent ?? null);
  const [request, setRequest] = useState(null);
  const modelsRequestIdRef = useRef(0);

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingTransactionType, setPendingTransactionType] = useState(null);

  const [cexLoading, setCexLoading] = useState(false);
  const [cexProductData, setCexProductData] = useState(() => snap.cexProductData ?? null);

  const [isQuickRepriceOpen, setIsQuickRepriceOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Pending offer updates not yet reflected in state (user may click New Buy before re-render)
  const pendingOfferUpdatesRef = useRef({});

  const persistRef = useRef(null);
  persistRef.current = {
    selectedCategory,
    availableModels,
    selectedModel,
    cartItems,
    selectedCartItemId: selectedCartItem?.id ?? null,
    customerData,
    intent,
    requestId: request?.request_id ?? null,
    isCustomerModalOpen,
    cexProductData,
  };

  useEffect(() => {
    if (persistRef.current) {
      saveSnapshot(mode, persistRef.current);
    }
  }, [
    mode,
    selectedCategory,
    availableModels,
    selectedModel,
    cartItems,
    selectedCartItem,
    customerData,
    intent,
    request,
    isCustomerModalOpen,
    cexProductData,
  ]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (persistRef.current) saveSnapshot(mode, persistRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [mode]);

  useEffect(() => {
    const s = initialSnapshotRef.current;
    const resetBuyerSetup = () => {
      clearSnapshot('buyer');
      const def = defaultSnapshot();
      setSelectedCategory(null);
      setAvailableModels([]);
      setSelectedModel(null);
      setCartItems([]);
      setSelectedCartItem(null);
      setCustomerData(def.customerData);
      setIntent(null);
      setRequest(null);
      setCexProductData(null);
    };
    if (s?.selectedCartItemId && Array.isArray(s.cartItems) && s.cartItems.length > 0) {
      const found = s.cartItems.find((i) => i.id === s.selectedCartItemId);
      if (found) setSelectedCartItem(found);
    }
    if (s?.requestId) {
      fetchRequestDetail(s.requestId).then((data) => {
        if (!data) return;
        const status = data.current_status ?? data.status_history?.[0]?.status;
        if (status !== 'QUOTE') {
          resetBuyerSetup();
          return;
        }
        setRequest(data);
      }).catch(() => {});
    }
  }, []);

  // Open quote request from Requests Overview (continue editing)
  useEffect(() => {
    const req = location.state?.openQuoteRequest;
    if (req && req.current_status === 'QUOTE') {
      pendingOfferUpdatesRef.current = {};
      const transactionType =
        req.intent === 'DIRECT_SALE'
          ? 'sale'
          : req.intent === 'BUYBACK'
            ? 'buyback'
            : 'store_credit';
      const customerData = mapRequestToCustomerData(req);
      const cartItems = mapRequestItemsToCartItems(req.items, transactionType);

      setCustomerData(customerData);
      setIntent(mapTransactionTypeToIntent(transactionType));
      setRequest(req);
      setCartItems(cartItems);
      setCustomerModalOpen(false);
      setSelectedCartItem(null);
      setSelectedCategory(null);
      setSelectedModel(null);

      window.history.replaceState({}, document.title);
    }
  }, [location.state?.openQuoteRequest]);

  // Restore cart state on navigation (e.g. from negotiation or repricing-negotiation with preserveCart)
  useEffect(() => {
    if (location.state?.preserveCart) {
      if (location.state.cartItems) {
        const useVoucher = location.state.customerData?.transactionType === 'store_credit';
        const itemsWithOffers = location.state.cartItems.map((item) => {
          const nextOffers = useVoucher ? (item.voucherOffers ?? []) : (item.cashOffers ?? []);
          return { ...item, offers: nextOffers.length ? nextOffers : (item.offers || []) };
        });
        setCartItems(itemsWithOffers);
      }
      if (location.state.customerData) {
        setCustomerData(location.state.customerData);
        setCustomerModalOpen(false);
        // Restore intent based on transaction type
        if (location.state.customerData.transactionType) {
          const mappedIntent = mapTransactionTypeToIntent(location.state.customerData.transactionType);
          setIntent(mappedIntent);
        }
      }
      // Restore request if provided (optional, but helpful if available)
      const resetBuyerSetup = () => {
        clearSnapshot('buyer');
        const def = defaultSnapshot();
        setSelectedCategory(null);
        setAvailableModels([]);
        setSelectedModel(null);
        setCartItems([]);
        setSelectedCartItem(null);
        setCustomerData(def.customerData);
        setIntent(null);
        setRequest(null);
        setCexProductData(null);
      };

      if (location.state.request) {
        const req = location.state.request;
        const status = req.current_status ?? req.status_history?.[0]?.status;
        if (status === 'QUOTE') {
          setRequest(req);
        } else {
          resetBuyerSetup();
        }
      } else if (location.state.currentRequestId && !request) {
        fetchRequestDetail(location.state.currentRequestId).then(requestData => {
          if (!requestData) return;
          const status = requestData.current_status ?? requestData.status_history?.[0]?.status;
          if (status !== 'QUOTE') {
            resetBuyerSetup();
            return;
          }
          setRequest(requestData);
        }).catch(err => {
          console.error('Failed to fetch request when restoring state:', err);
        });
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Hydrate internal DB items that lack offers (e.g. opened from quote mode before we saved offers)
  useEffect(() => {
    if (isRepricing || !cartItems.length) return;

    const toHydrate = cartItems.filter(
      (item) =>
        !item.isCustomEbayItem &&
        !item.isCustomCeXItem &&
        !item.isCustomCashConvertersItem &&
        item.variantId &&
        item.cexSku &&
        (!item.cashOffers?.length || !item.voucherOffers?.length)
    );
    if (toHydrate.length === 0) return;

    const useVoucher = customerData?.transactionType === 'store_credit';
    let cancelled = false;

    Promise.all(
      toHydrate.map(async (item) => {
        try {
          const priceData = await fetchVariantPrices(item.cexSku);
          return {
            item,
            cashOffers: priceData.cash_offers || [],
            voucherOffers: priceData.voucher_offers || [],
            referenceData: priceData.referenceData || {},
          };
        } catch {
          return { item, cashOffers: [], voucherOffers: [], referenceData: {} };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setCartItems((prev) =>
        prev.map((ci) => {
          const r = results.find((x) => x.item.id === ci.id);
          if (!r) return ci;
          const offers = useVoucher ? r.voucherOffers : r.cashOffers;
          return {
            ...ci,
            cashOffers: r.cashOffers.length ? r.cashOffers : ci.cashOffers,
            voucherOffers: r.voucherOffers.length ? r.voucherOffers : ci.voucherOffers,
            offers: offers.length ? offers : (useVoucher ? ci.voucherOffers : ci.cashOffers) ?? [],
            referenceData: Object.keys(r.referenceData).length ? r.referenceData : ci.referenceData,
          };
        })
      );
      setSelectedCartItem((current) => {
        if (!current) return current;
        const r = results.find((x) => x.item.id === current.id);
        if (!r) return current;
        const offers = useVoucher ? r.voucherOffers : r.cashOffers;
        return {
          ...current,
          cashOffers: r.cashOffers.length ? r.cashOffers : current.cashOffers,
          voucherOffers: r.voucherOffers.length ? r.voucherOffers : current.voucherOffers,
          offers: offers.length ? offers : (useVoucher ? current.voucherOffers : current.cashOffers) ?? [],
          referenceData: Object.keys(r.referenceData).length ? r.referenceData : current.referenceData,
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [cartItems, customerData?.transactionType, isRepricing]);

  useEffect(() => {
    if (!cartItems.length) return;

    const useVoucher = customerData.transactionType === 'store_credit';

    setCartItems(prevItems =>
      prevItems.map(item => {
        // eBay-only items also need their offers updated
        if (item.isCustomEbayItem) {
          const nextOffers = useVoucher
            ? item.voucherOffers ?? []
            : item.cashOffers ?? [];
          return { ...item, offers: nextOffers, offerType: useVoucher ? 'voucher' : 'cash' };
        }

        // CeX Add-from-CeX items
        if (item.isCustomCeXItem) {
          const nextOffers = useVoucher ? item.voucherOffers ?? [] : item.cashOffers ?? [];
          return { ...item, offers: nextOffers, offerType: useVoucher ? 'voucher' : 'cash' };
        }

        const nextOffers = useVoucher
          ? item.voucherOffers ?? []
          : item.cashOffers ?? [];

        return {
          ...item,
          offers: nextOffers,
          offerType: useVoucher ? 'voucher' : 'cash'
        };
      })
    );
  }, [customerData.transactionType]);


  // Handle customer selection
  const handleCustomerSelected = (customerInfo) => {
    setCustomerModalOpen(false);
    if (!customerInfo) return;

    // Map the transaction type to the Django intent
    const mappedIntent = mapTransactionTypeToIntent(customerInfo.transactionType);

    const c = customerInfo.customer || {};
    setCustomerData({
      id: customerInfo.id,
      name: customerInfo.customerName,
      cancelRate: customerInfo.cancelRate || 0,
      transactionType: customerInfo.transactionType || 'sale',
      isNewCustomer: customerInfo.isNewCustomer ?? false,
      // NoSpos stat fields
      joined:          c.joined          || null,
      lastTransacted:  c.lastTransacted  || null,
      buyBackRate:     c.buyBackRate     || null,
      buyBackRateRaw:  c.buyBackRateRaw  || null,
      renewRate:       c.renewRate       || null,
      renewRateRaw:    c.renewRateRaw    || null,
      cancelRateStr:   c.cancelRate      || null,  // string e.g. "86%"
      cancelRateRaw:   c.cancelRateRaw   || null,
      faultyRate:      c.faultyRate      || null,
      faultyRateRaw:   c.faultyRateRaw   || null,
      buyingCount:     c.buyingCount     || null,
      salesCount:      c.salesCount      || null,
    });

    setIntent(mappedIntent);
  };

  const handleTransactionTypeChange = (newType) => {
      // If cart has items, show confirmation dialog
      if (cartItems.length > 0 && newType !== customerData.transactionType) {
        setPendingTransactionType(newType);
        setShowConfirmDialog(true);
      } else {
        // No items in cart, change immediately
        applyTransactionTypeChange(newType);
      }
  };
  
  const applyTransactionTypeChange = (newType) => {
      setCustomerData(prev => ({
        ...prev,
        transactionType: newType
      }));

      // Keep intent in sync too
      setIntent(mapTransactionTypeToIntent(newType));
      
      // Close dialog and reset pending state
      setShowConfirmDialog(false);
      setPendingTransactionType(null);
  };
  
  const cancelTransactionTypeChange = () => {
      setShowConfirmDialog(false);
      setPendingTransactionType(null);
  };

  /**
   * "Add from CeX" flow: ask extension to open CeX and wait for user to land on a product-detail page
   * and click "Yes" in the "Have you got the data yet?" panel. The extension opens uk.webuy.com;
   * when the user navigates to a product-detail URL the content script sends LISTING_PAGE_READY,
   * background sends WAITING_FOR_DATA to that tab, and the panel appears. If the panel never appears,
   * check DevTools console on the CeX tab and on the extension service worker (chrome://extensions → CG Suite → service worker) for logs.
   */
  const handleAddFromCeX = async () => {
    setCexLoading(true);
    setCexProductData(null);
    try {
      const data = await getDataFromListingPage('CeX');

      if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
        const product = data.results[0];
        const payload = {
          sellPrice: product.sellPrice ?? product.price,
          tradeInCash: product.tradeInCash ?? 0,
          tradeInVoucher: product.tradeInVoucher ?? 0,
          title: product.title,
          category: product.category,
          image: product.image,
          id: product.id
        };
        const priceData = await fetchCeXProductPrices(payload);
        const merged = { ...product, ...priceData, listingPageUrl: data.listingPageUrl };
        setCexProductData(merged);
        showNotification('CeX product loaded', 'success');
      } else {
        showNotification(data?.error || 'No data returned', 'error');
      }
    } catch (err) {
      console.error('[CG Suite] handleAddFromCeX error:', err);
      showNotification(err?.message || 'Extension communication failed. Is the Chrome extension installed?', 'error');
    } finally {
      setCexLoading(false);
    }
  };

  const handleClearCeXProduct = () => {
    setCexProductData(null);
  };

  /**
   * Reset the entire buying module state: clear cart, customer, category, request, etc.
   * Persists the cleared state so it survives navigation.
   * Flushes current offer/price state to backend before clearing so no changes are lost.
   */
  const handleResetBuy = async () => {
    // Persist current cart offer state before clearing (merge pending updates in case state hasn't committed)
    if (!isRepricing && cartItems.length > 0) {
      const pending = pendingOfferUpdatesRef.current;
      const persistPromises = [];
      for (const item of cartItems) {
        if (!item?.request_item_id) continue;
        const merged = { ...item, ...pending[item.id] };
        const payload = {};
        if (merged.selectedOfferId !== undefined) {
          payload.selected_offer_id = merged.selectedOfferId;
          payload.manual_offer_used = merged.selectedOfferId === 'manual';
        }
        if (merged.manualOffer !== undefined && merged.manualOffer !== '') {
          const parsed = parseFloat(String(merged.manualOffer).replace(/[£,]/g, ''));
          payload.manual_offer_gbp = !isNaN(parsed) ? parsed : null;
        }
        if (merged.ourSalePrice !== undefined) {
          const parsed = parseFloat(String(merged.ourSalePrice).replace(/[£,]/g, ''));
          payload.our_sale_price_at_negotiation = !isNaN(parsed) && parsed > 0 ? parsed : null;
        }
        if (Array.isArray(merged.cashOffers)) {
          payload.cash_offers_json = normalizeOffersForPersistence(merged.cashOffers);
        }
        if (Array.isArray(merged.voucherOffers)) {
          payload.voucher_offers_json = normalizeOffersForPersistence(merged.voucherOffers);
        }
        if (Object.keys(payload).length > 0) {
          persistPromises.push(
            updateRequestItemOffer(item.request_item_id, payload).catch((err) => {
              console.error('[Buyer] Failed to persist offer before reset:', err);
            })
          );
        }
      }
      if (persistPromises.length > 0) {
        await Promise.all(persistPromises);
      }
      pendingOfferUpdatesRef.current = {};
    }

    const defaults = defaultSnapshot();
    clearSnapshot(mode);
    saveSnapshot(mode, { ...defaults, isCustomerModalOpen: !isRepricing });

    setSelectedCategory(null);
    setAvailableModels([]);
    setSelectedModel(null);
    setCartItems([]);
    setSelectedCartItem(null);
    setCustomerData(defaults.customerData);
    setIntent(null);
    setRequest(null);
    setCustomerModalOpen(!isRepricing);
    setCexProductData(null);
    setShowConfirmDialog(false);
    setPendingTransactionType(null);
    setIsQuickRepriceOpen(false);
    setCexLoading(false);
    setResetKey(k => k + 1);

    // Update ref so persist on unmount uses clean state
    initialSnapshotRef.current = { ...defaults, isCustomerModalOpen: !isRepricing };
    showNotification('Buying module reset', 'success');
  };

  /**
   * Called by QuickRepriceModal when the user confirms adding items.
   * Converts the lookup results into cart items and adds them to the reprice list.
   */
  const handleQuickRepriceAddItems = (foundItems) => {
    let addedCount = 0;
    for (const result of foundItems) {
      const cartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
              path: [result.category_name]
            }
          : null,
        condition: result.condition || '',
        attributeValues: result.attribute_values || {},
        ourSalePrice: result.our_sale_price ?? null,
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
      addToCart(cartItem);
      addedCount++;
    }
    showNotification(
      `${addedCount} item${addedCount !== 1 ? 's' : ''} added to reprice list`,
      'success'
    );
  };

  const handleCategorySelect = async (category) => {
    // Start a new models request; any older in-flight responses will be ignored
    const requestId = ++modelsRequestIdRef.current;

    setSelectedCartItem(null);
    setCexProductData(null);
    setSelectedCategory(category);
    setSelectedModel(null);
    setAvailableModels([]); // Clear old models to avoid showing stale options
    setIsLoadingModels(true);

    try {
      const models = await fetchProductModels(category);
      if (modelsRequestIdRef.current !== requestId) return; // Stale response
      setAvailableModels(models);
    } finally {
      if (modelsRequestIdRef.current === requestId) {
        setIsLoadingModels(false);
      }
    }
  };

  const handleItemAddedToCart = () => {
    setSelectedCategory(null);
    setSelectedModel(null);
    setSelectedCartItem(null);
  };

  const updateCartItemOffers = (cartItemId, updatedOfferData) => {
    const item = cartItems.find(i => i.id === cartItemId);
    if (!isRepricing && item?.request_item_id && (
      updatedOfferData.selectedOfferId !== undefined ||
      updatedOfferData.manualOffer !== undefined ||
      updatedOfferData.ourSalePrice !== undefined ||
      updatedOfferData.cashOffers !== undefined ||
      updatedOfferData.voucherOffers !== undefined
    )) {
      // Store pending update so New Buy can persist it before state commits
      pendingOfferUpdatesRef.current[cartItemId] = {
        ...pendingOfferUpdatesRef.current[cartItemId],
        ...updatedOfferData,
      };
      const payload = {};
      if (updatedOfferData.selectedOfferId !== undefined) {
        payload.selected_offer_id = updatedOfferData.selectedOfferId;
        payload.manual_offer_used = updatedOfferData.selectedOfferId === 'manual';
      }
      if (updatedOfferData.manualOffer !== undefined && updatedOfferData.manualOffer !== '') {
        const parsed = parseFloat(String(updatedOfferData.manualOffer).replace(/[£,]/g, ''));
        payload.manual_offer_gbp = !isNaN(parsed) ? parsed : null;
      }
      if (updatedOfferData.ourSalePrice !== undefined) {
        const parsed = parseFloat(String(updatedOfferData.ourSalePrice).replace(/[£,]/g, ''));
        payload.our_sale_price_at_negotiation = !isNaN(parsed) && parsed > 0 ? parsed : null;
      }
      if (Array.isArray(updatedOfferData.cashOffers)) {
        payload.cash_offers_json = normalizeOffersForPersistence(updatedOfferData.cashOffers);
      }
      if (Array.isArray(updatedOfferData.voucherOffers)) {
        payload.voucher_offers_json = normalizeOffersForPersistence(updatedOfferData.voucherOffers);
      }
      if (Object.keys(payload).length > 0) {
        updateRequestItemOffer(item.request_item_id, payload).catch((err) => {
          console.error('[Buyer] Failed to persist offer/price selection:', err);
        });
      }
    }
    setCartItems(prev => prev.map(i =>
      i.id === cartItemId ? { ...i, ...updatedOfferData } : i
    ));
    setSelectedCartItem(prev =>
      prev?.id === cartItemId ? { ...prev, ...updatedOfferData } : prev
    );
  };

  const addToCart = (item) => {
    // Force-new items bypass duplicate detection and are always appended
    if (item.forceNew) {
      const { forceNew: _, ...cleanItem } = item;
      setCartItems(prev => [...prev, cleanItem]);
      setTimeout(() => showNotification(`${cleanItem.title} added to cart as a new item`, 'success'), 0);
      return;
    }

    // Helper function to find existing item index
    const findExistingItemIndex = (items) => {
      return items.findIndex(cartItem => {
        // For CeX items, one line per variant; same variant = update offer or merge qty
        if (!item.isCustomEbayItem && !item.isCustomCashConvertersItem && item.variantId != null) {
          return cartItem.variantId === item.variantId;
        }
        
        // For eBay items, one line per (title, category); same as CeX: update offer or merge qty
        if (item.isCustomEbayItem) {
          return (
            cartItem.isCustomEbayItem &&
            cartItem.title === item.title &&
            cartItem.category === item.category
          );
        }

        // For Cash Converters items, match by search term and category
        if (item.isCustomCashConvertersItem) {
          return (
            cartItem.isCustomCashConvertersItem &&
            cartItem.title === item.title &&
            cartItem.category === item.category
          );
        }

        // For CeX items from Add from CeX, match by title and subtitle
        if (item.isCustomCeXItem) {
          return (
            cartItem.isCustomCeXItem &&
            cartItem.title === item.title &&
            cartItem.subtitle === item.subtitle
          );
        }
        
        return false;
      });
    };

    // Check current state synchronously to determine notification message and behavior
    const existingItemIndex = findExistingItemIndex(cartItems);
    const isExistingItem = existingItemIndex !== -1;
    let notificationMessage = null;
    const existingItem = isExistingItem ? cartItems[existingItemIndex] : null;
    const sameOffer = existingItem && (
      (existingItem.selectedOfferId ?? null) === (item.selectedOfferId ?? null)
    );

    if (isExistingItem) {
      if (isRepricing) {
        notificationMessage = `${item.title} is already in the reprice list`;
      } else if (sameOffer) {
        const newQuantity = (existingItem.quantity || 1) + 1;
        notificationMessage = `Quantity increased to ${newQuantity} for ${item.title}`;
      } else {
        notificationMessage = `Offer updated for ${item.title}`;
      }
    } else {
      notificationMessage = `${item.title} added to cart`;
    }

    setCartItems((prev) => {
      const existingIndex = findExistingItemIndex(prev);
      if (existingIndex === -1) {
        return [...prev, item];
      }
    
      const updatedItems = [...prev];
      const existing = updatedItems[existingIndex];
      const sameSelectedOffer = (existing.selectedOfferId ?? null) === (item.selectedOfferId ?? null);
    
      if (isRepricing) {
        updatedItems[existingIndex] = {
          ...existing,
          ...item,
          id: existing.id,
          quantity: 1
        };
      } else if (sameSelectedOffer) {
        updatedItems[existingIndex] = {
          ...existing,
          quantity: (existing.quantity || 1) + 1
        };
      } else {
        updatedItems[existingIndex] = {
          ...existing,
          selectedOfferId: item.selectedOfferId,
          offers: item.offers ?? existing.offers,
          cashOffers: item.cashOffers ?? existing.cashOffers,
          voucherOffers: item.voucherOffers ?? existing.voucherOffers
        };
      }
      return updatedItems;
    });
    
    // Show notification once after state update
    setTimeout(() => {
      showNotification(notificationMessage, 'success');
    }, 0);
  };

  const handleRemoveItem = async (item) => {
    if (request?.request_id && item.request_item_id) {
      try {
        await deleteRequestItem(item.request_item_id);
      } catch (err) {
        showNotification(err?.message || 'Failed to remove item from quote', 'error');
        return;
      }
    }
    setCartItems(prev => prev.filter(i => i.id !== item.id));
    if (selectedCartItem?.id === item.id) setSelectedCartItem(null);
  };

  const handleCartItemSelect = async (item) => {
    // In repricing, repeated clicks on the active item should not clear selection
    // while pricing/models are still hydrating.
    if (selectedCartItem?.id === item.id) {
      if (isRepricing) {
        return;
      }
      setSelectedCartItem(null);
      return;
    }

    // Clear cexProductData so MainContent shows the selected cart item, not the Add from CeX flow
    setCexProductData(null);

    // Set immediately so the sidebar highlights the item and MainContent renders right away
    setSelectedCartItem(item);

    // Hydrate Quick Reprice items with pricing / reference data on first click
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
            : {
                id: item.cexSku,
                title: item.title,
                category: item.category || item.subtitle || 'CeX',
                image: item.image || '',
              },
          fromQuickReprice: false, // cached — don't re-fetch on subsequent clicks
        };
        setSelectedCartItem(activeItem);
        setCartItems(prev => prev.map(ci => ci.id === item.id ? activeItem : ci));
      } catch {
        // Silently fall through — panel will render with whatever data is available
      }
    }

    // Hydrate internal DB items (from product selection) that lack offers (e.g. loaded from quote overview)
    if (
      !item.isCustomEbayItem &&
      !item.isCustomCeXItem &&
      !item.isCustomCashConvertersItem &&
      item.variantId &&
      item.cexSku &&
      (!item.cashOffers?.length || !item.voucherOffers?.length)
    ) {
      try {
        const priceData = await fetchVariantPrices(item.cexSku);
        const cashOffers = priceData.cash_offers || item.cashOffers || [];
        const voucherOffers = priceData.voucher_offers || item.voucherOffers || [];
        const useVoucher = customerData?.transactionType === 'store_credit';
        activeItem = {
          ...item,
          cashOffers,
          voucherOffers,
          offers: useVoucher ? voucherOffers : cashOffers,
          referenceData: priceData.referenceData || item.referenceData || {},
        };
        setSelectedCartItem(activeItem);
        setCartItems(prev => prev.map(ci => ci.id === item.id ? activeItem : ci));
      } catch {
        // Silently fall through — panel will render with whatever data is available
      }
    }

    // Hydrate Add from CeX items that lack cexProductData/offers (e.g. loaded from quote overview)
    if (
      item.isCustomCeXItem &&
      !item.fromQuickReprice &&
      (item.cexSku || item.cexProductData?.id) &&
      (!item.cexProductData || (!item.cashOffers?.length && !item.voucherOffers?.length))
    ) {
      try {
        const sku = item.cexSku || item.cexProductData?.id;
        const priceData = await fetchCeXProductPrices({
          sellPrice: item.cexSellPrice,
          tradeInCash: item.cexBuyPrice,
          tradeInVoucher: item.cexVoucherPrice,
          title: item.title,
          category: item.category || item.subtitle || 'CeX',
          image: item.image || item.cexProductData?.image || '',
          id: sku,
        });
        activeItem = {
          ...item,
          cashOffers: priceData.cash_offers || item.cashOffers || [],
          voucherOffers: priceData.voucher_offers || item.voucherOffers || [],
          offers: (priceData.cash_offers?.length ? priceData.cash_offers : item.cashOffers) || [],
          referenceData: priceData.referenceData || item.referenceData || {},
          cexProductData: {
            id: sku,
            title: item.title,
            category: item.category || item.subtitle || 'CeX',
            image: item.image || item.cexProductData?.image || '',
            specifications: item.cexProductData?.specifications || {},
            ...item.cexProductData,
          },
        };
        setSelectedCartItem(activeItem);
        setCartItems(prev => prev.map(ci => ci.id === item.id ? activeItem : ci));
      } catch {
        // Silently fall through — panel will render with whatever data is available
      }
    }

    // eBay and CeX items don't use variants – skip models fetch for instant display
    const isEbayOrCex = activeItem.isCustomEbayItem || activeItem.isCustomCeXItem;
    if (isEbayOrCex && activeItem.categoryObject) {
      setSelectedCategory(activeItem.categoryObject);
      return;
    }

    if (activeItem.categoryObject) {
      const requestId = ++modelsRequestIdRef.current;
      setSelectedCategory(activeItem.categoryObject);
      setIsLoadingModels(true);

      try {
        const models = await fetchProductModels(activeItem.categoryObject);
        if (modelsRequestIdRef.current !== requestId) return; // Ignore stale responses
        setAvailableModels(models);
        // MainContent's Step-1 effect depends on [selectedCartItem, availableModels]
        // so it will re-run and pick up the correct model once models are available
      } finally {
        if (modelsRequestIdRef.current === requestId) {
          setIsLoadingModels(false);
        }
      }
    }
  };

  /**
   * Update cart item with eBay research data
   * This handles both local state update AND backend sync
   */
  const updateCartItemEbayData = async (variantId, ebayData) => {
    setCartItems(prevItems => {
      return prevItems.map(item => {
        if (item.variantId === variantId) {
          const updatedItem = {
            ...item,
            ebayResearchData: ebayData
          };

          if (item.request_item_id) {
            updateRequestItemRawData(item.request_item_id, { raw_data: ebayData }).catch(() => {});
          }

          return updatedItem;
        }
        return item;
      });
    });
  };

  /**
   * Update cart item with Cash Converters research data
   * Mirrors updateCartItemEbayData - updates local state for the matching cart item
   */
  const updateCartItemCashConvertersData = (variantId, ccData) => {
    setCartItems(prevItems => {
      return prevItems.map(item => {
        if (item.variantId === variantId) {
          if (item.request_item_id) {
            updateRequestItemRawData(item.request_item_id, { cash_converters_data: ccData }).catch(() => {});
          }
          return {
            ...item,
            cashConvertersResearchData: ccData
          };
        }
        return item;
      });
    });
  };

  return (
    <div className="bg-gray-50 text-gray-900 h-screen flex flex-col overflow-hidden text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      {!isRepricing && (
        <CustomerIntakeModal
          key={resetKey}
          open={isCustomerModalOpen}
          onClose={handleCustomerSelected}
        />
      )}

      {isQuickRepriceOpen && (
        <QuickRepriceModal
          onClose={() => setIsQuickRepriceOpen(false)}
          onAddItems={handleQuickRepriceAddItems}
        />
      )}

      <AppHeader />
      <main className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          onCategorySelect={handleCategorySelect}
          onAddFromCeX={handleAddFromCeX}
          isCeXLoading={cexLoading}
          onQuickReprice={isRepricing ? () => setIsQuickRepriceOpen(true) : null}
          customerData={isRepricing ? null : customerData}
          onTransactionTypeChange={isRepricing ? null : handleTransactionTypeChange}
        />
        <MainContent 
          selectedCategory={selectedCategory} 
          availableModels={availableModels}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          isLoadingModels={isLoadingModels}
          addToCart={addToCart}
          updateCartItemEbayData={updateCartItemEbayData}
          updateCartItemCashConvertersData={updateCartItemCashConvertersData}
          updateCartItemOffers={updateCartItemOffers}
          customerData={customerData}
          intent={intent}
          setIntent={setIntent}
          request={request}
          setRequest={setRequest}
          selectedCartItem={selectedCartItem}
          cartItems={cartItems}
          cexProductData={cexProductData}
          setCexProductData={setCexProductData}
          onClearCeXProduct={handleClearCeXProduct}
          onDeselectCartItem={() => setSelectedCartItem(null)}
          onItemAddedToCart={handleItemAddedToCart}
          mode={mode}
        />
      <CartSidebar 
        cartItems={cartItems} 
        setCartItems={setCartItems}
        onRemoveItem={!isRepricing ? handleRemoveItem : undefined}
        onResetBuy={isRepricing ? null : handleResetBuy}
        customerData={customerData}
        currentRequestId={request?.request_id}
        onItemSelect={handleCartItemSelect}
        selectedCartItemId={selectedCartItem?.id}
        onTransactionTypeChange={!isRepricing ? handleTransactionTypeChange : null}
        mode={mode}
      />

      </main>
      
      {/* Transaction Type Change Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px] shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-100 p-2 rounded-lg">
                <span className="material-symbols-outlined text-yellow-600 text-2xl">warning</span>
              </div>
              <h2 className="text-xl font-bold text-blue-900">Change Transaction Type?</h2>
            </div>
            
            <p className="text-sm text-gray-700 mb-2">
              You are about to change the transaction type to{' '}
              <span className="font-bold text-blue-900">
                {pendingTransactionType === 'store_credit' ? 'Store Credit' : 
                 pendingTransactionType === 'buyback' ? 'Buy Back' : 'Direct Sale'}
              </span>.
            </p>
            
            <p className="text-sm text-gray-700 mb-4">
              {pendingTransactionType === 'store_credit' ? (
                <>This will switch all offers to <span className="font-bold">voucher prices</span>.</>
              ) : (
                <>This will switch all offers to <span className="font-bold">cash prices</span>.</>
              )}
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
              <p className="text-xs text-blue-800 mb-2">
                <span className="material-symbols-outlined text-sm mr-1" style={{ fontSize: '14px', verticalAlign: 'middle' }}>info</span>
                All {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} in your cart will be updated with new valuations.
              </p>
              {pendingTransactionType === 'store_credit' && (
                <p className="text-xs text-blue-700 ml-5">
                  • CeX items: Updated to CeX voucher prices<br/>
                  • eBay items: Cash offers +10%
                </p>
              )}
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelTransactionTypeChange}
                className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => applyTransactionTypeChange(pendingTransactionType)}
                className="px-6 py-2.5 text-sm font-bold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors shadow-md"
              >
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}