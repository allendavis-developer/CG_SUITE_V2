import React, { useState, useEffect, useCallback } from 'react';
import { Icon, Button, Tab, Breadcrumb, SearchableDropdown } from '@/components/ui/components';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm.jsx';
import EmptyState from './EmptyState';
import ProductSelection from './ProductSelection';
import AttributeConfiguration from './AttributeConfiguration';
import MarketComparisonsTable from './MarketComparisonsTable';
import OfferSelection from './OfferSelection';
import CexProductView from './CexProductView';
import EbayCartItemView from './EbayCartItemView';
import CashConvertersCartItemView from './CashConvertersCartItemView';

import { useProductAttributes } from '@/pages/buyer/hooks/useProductAttributes';
import { fetchVariantPrices } from '@/services/api';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { roundOfferPrice, roundSalePrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import useAppStore, { useCartItems, useSelectedCartItem, useIsRepricing, useUseVoucherOffers } from '@/store/useAppStore';
import { useNotification } from '@/contexts/NotificationContext';

const EBAY_TOP_LEVEL_CATEGORY = { name: 'eBay', path: ['eBay'] };
const VARIANT_SELECTIONS_STORAGE_PREFIX = 'buyerMainContentVariantSelections';

const loadPersistedVariantSelections = (mode) => {
  try {
    const raw = sessionStorage.getItem(`${VARIANT_SELECTIONS_STORAGE_PREFIX}:${mode}`);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const savePersistedVariantSelections = (mode, selections) => {
  try { sessionStorage.setItem(`${VARIANT_SELECTIONS_STORAGE_PREFIX}:${mode}`, JSON.stringify(selections)); } catch {}
};
const getPersistedVariantForKey = (selections, key) => {
  const saved = selections?.[key];
  return typeof saved === 'string' ? saved : (saved?.variant || '');
};

const MainContent = ({ mode = 'buyer' }) => {
  const isRepricing = useIsRepricing();
  const useVoucherOffers = useUseVoucherOffers();
  const selectedCartItem = useSelectedCartItem();

  const {
    selectedCategory, availableModels, selectedModel, setSelectedModel, isLoadingModels,
    customerData, intent, request,
    cexProductData, setCexProductData, clearCexProduct,
    addToCart, updateCartItemOffers, updateCartItemResearchData,
    createOrAppendRequestItem, onItemAddedToCart, deselectCartItem,
  } = useAppStore();

  const cartItems = useCartItems();

  const { showNotification } = useNotification();
  
  const [activeTab, setActiveTab] = useState('info');
  const [variants, setVariants] = useState([]);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [isCashConvertersModalOpen, setCashConvertersModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [ebayData, setEbayData] = useState(null);
  const [savedEbayState, setSavedEbayState] = useState(null);
  const [cashConvertersData, setCashConvertersData] = useState(null);
  const [savedCashConvertersState, setSavedCashConvertersState] = useState(null);
  const [isCeXEbayModalOpen, setCeXEbayModalOpen] = useState(false);
  const [isCeXCashConvertersModalOpen, setCeXCashConvertersModalOpen] = useState(false);
  const [pendingDuplicateItem, setPendingDuplicateItem] = useState(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const persistedVariantSelectionsRef = React.useRef(null);
  const [hydratedSelectionKey, setHydratedSelectionKey] = useState(null);

  if (persistedVariantSelectionsRef.current === null) {
    persistedVariantSelectionsRef.current = loadPersistedVariantSelections(mode);
  }

  const { attributes, attributeValues, variant, setVariant, handleAttributeChange, setAllAttributeValues } =
    useProductAttributes(selectedModel?.product_id, variants);

  const isEbayCategory = selectedCategory?.path?.some((p) => p.toLowerCase() === 'ebay') || selectedCategory?.name?.toLowerCase() === 'ebay';
  const variantSelectionKey = !isEbayCategory && selectedModel?.product_id ? `${selectedModel.product_id}` : null;

  const resolveVariantFromCartItem = useCallback(
    (cartItem) => {
      if (!cartItem || variants.length === 0) return null;
      return variants.find((c) =>
        (cartItem.variantId != null && String(c.variant_id) === String(cartItem.variantId)) ||
        (cartItem.cexSku && c.cex_sku === cartItem.cexSku)
    ) || null;
    },
    [variants]
  );

  // Reset on category change
  useEffect(() => {
    setVariants([]);
    setActiveTab(isEbayCategory ? 'research' : 'info');
  }, [selectedCategory, isEbayCategory]);

  // Clear research when deselecting cart item
  useEffect(() => {
    if (!selectedCartItem) {
      if (isEbayCategory) { setSavedEbayState(null); setEbayData(null); }
      const isCC = selectedCategory?.path?.some((p) => p.toLowerCase() === 'cash converters') || selectedCategory?.name?.toLowerCase() === 'cash converters';
      if (isCC) { setSavedCashConvertersState(null); setCashConvertersData(null); }
    }
  }, [selectedCartItem, isEbayCategory, selectedCategory]);

  // Load variants
  useEffect(() => {
    if (!selectedModel?.product_id) { setVariants([]); return; }
    const loadVariants = async () => {
      try {
        const res = await fetch(`/api/product-variants/?product_id=${selectedModel.product_id}`);
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        setVariants(data.variants || []);
      } catch { setVariants([]); }
    };
    loadVariants();
  }, [selectedModel]);

  // Variant selection persistence
  useEffect(() => { setHydratedSelectionKey(null); }, [variantSelectionKey]);

  useEffect(() => {
    if (!variantSelectionKey || hydratedSelectionKey === variantSelectionKey || selectedCartItem || isEbayCategory || cexProductData) return;
    if (!selectedModel?.product_id || attributes.length === 0 || variants.length === 0) return;
    const savedVariant = getPersistedVariantForKey(persistedVariantSelectionsRef.current, variantSelectionKey);
    const matched = savedVariant ? variants.find((v) => v.cex_sku === savedVariant) : null;
    if (matched) { setAllAttributeValues(matched.attribute_values || {}); setVariant(matched.cex_sku); }
    setHydratedSelectionKey(variantSelectionKey);
  }, [attributes.length, cexProductData, hydratedSelectionKey, isEbayCategory, selectedCartItem, selectedModel?.product_id, setAllAttributeValues, setVariant, variantSelectionKey, variants.length]);

  useEffect(() => {
    if (!variantSelectionKey || hydratedSelectionKey !== variantSelectionKey || selectedCartItem || isEbayCategory || cexProductData) return;
    const prev = getPersistedVariantForKey(persistedVariantSelectionsRef.current, variantSelectionKey);
    if (prev === (variant || '')) return;
    const next = { ...(persistedVariantSelectionsRef.current || {}) };
    if (variant) next[variantSelectionKey] = variant; else delete next[variantSelectionKey];
    persistedVariantSelectionsRef.current = next;
    savePersistedVariantSelections(mode, next);
  }, [cexProductData, hydratedSelectionKey, isEbayCategory, mode, selectedCartItem, variant, variantSelectionKey]);

  // Load offers when variant changes
  useEffect(() => {
    if (!variant) { setOffers([]); setReferenceData(null); setOurSalePrice(''); setEbayData(null); setSavedEbayState(null); setCashConvertersData(null); setSavedCashConvertersState(null); return; }
    const load = async () => {
      setIsLoadingOffers(true);
      try {
        const data = await fetchVariantPrices(variant);
        setOffers(useVoucherOffers ? data.voucher_offers : data.cash_offers);
        const cexBased = data.referenceData?.cex_based_sale_price;
        setReferenceData({
          ...data.referenceData,
          cash_offers: data.cash_offers,
          voucher_offers: data.voucher_offers,
          our_sale_price: cexBased != null && Number.isFinite(Number(cexBased)) ? roundSalePrice(Number(cexBased)) : null,
        });
        if (cexBased != null && Number.isFinite(Number(cexBased))) {
          setOurSalePrice(String(roundSalePrice(Number(cexBased))));
        }
      } catch { setOffers([]); setReferenceData(null); setOurSalePrice(''); }
      finally { setIsLoadingOffers(false); }
    };
    load();
  }, [variant, useVoucherOffers]);

  // Restore cart item state (model, variant, research)
  useEffect(() => {
    if (!selectedCartItem) return;
    if (selectedCartItem.isCustomEbayItem) {
      if (selectedCartItem.ebayResearchData) { setSavedEbayState(selectedCartItem.ebayResearchData); setEbayData(selectedCartItem.ebayResearchData); setActiveTab('research'); }
      return;
    }
    if (selectedCartItem.isCustomCashConvertersItem) {
      if (selectedCartItem.cashConvertersResearchData) { setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData); setCashConvertersData(selectedCartItem.cashConvertersResearchData); setActiveTab('research'); }
      return;
    }
    const modelToSet = availableModels.find((m) => m.name === selectedCartItem.model);
    if (modelToSet && selectedModel?.product_id !== modelToSet.product_id) setSelectedModel(modelToSet);
    const matched = resolveVariantFromCartItem(selectedCartItem);
    if (matched?.attribute_values) setAllAttributeValues(matched.attribute_values);
    else if (attributes.length > 0 && selectedCartItem.attributeValues) setAllAttributeValues(selectedCartItem.attributeValues);
    if (matched?.cex_sku) setVariant(matched.cex_sku);
    else if (variants.length > 0 && selectedCartItem.cexSku) setVariant(selectedCartItem.cexSku);
    if (selectedCartItem.ebayResearchData) { setSavedEbayState(selectedCartItem.ebayResearchData); setEbayData(selectedCartItem.ebayResearchData); }
    if (selectedCartItem.cashConvertersResearchData) { setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData); setCashConvertersData(selectedCartItem.cashConvertersResearchData); }
    if (selectedCartItem.referenceData) {
      setReferenceData(selectedCartItem.referenceData);
      const display = useVoucherOffers ? (selectedCartItem.voucherOffers || selectedCartItem.offers) : (selectedCartItem.cashOffers || selectedCartItem.offers);
      if (display) setOffers(display);
    }
    setOurSalePrice(
      selectedCartItem.ourSalePrice != null && Number.isFinite(Number(selectedCartItem.ourSalePrice))
        ? String(roundSalePrice(Number(selectedCartItem.ourSalePrice)))
        : ''
    );
  }, [selectedCartItem, availableModels, selectedModel?.product_id, setSelectedModel, attributes, variants, setAllAttributeValues, setVariant, useVoucherOffers, resolveVariantFromCartItem]);

  // Variant + attribute restore from cart item (when variants load)
  useEffect(() => {
    if (!selectedCartItem || variants.length === 0 || selectedCartItem.isCustomEbayItem || selectedCartItem.isCustomCashConvertersItem) return;
    const v = resolveVariantFromCartItem(selectedCartItem);
    if (v) { if (v.attribute_values) setAllAttributeValues(v.attribute_values); setVariant(v.cex_sku); }
    if (selectedCartItem.ebayResearchData) { setSavedEbayState(selectedCartItem.ebayResearchData); setEbayData(selectedCartItem.ebayResearchData); }
    if (selectedCartItem.cashConvertersResearchData) { setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData); setCashConvertersData(selectedCartItem.cashConvertersResearchData); }
    if (selectedCartItem.referenceData) {
      setReferenceData(selectedCartItem.referenceData);
      const display = useVoucherOffers ? (selectedCartItem.voucherOffers || selectedCartItem.offers) : (selectedCartItem.cashOffers || selectedCartItem.offers);
      if (display) setOffers(display);
      if (selectedCartItem.ourSalePrice != null && Number.isFinite(Number(selectedCartItem.ourSalePrice))) {
        setOurSalePrice(String(roundSalePrice(Number(selectedCartItem.ourSalePrice))));
      }
    }
  }, [selectedCartItem, variants, useVoucherOffers, resolveVariantFromCartItem, setAllAttributeValues, setVariant]);

  // ── Cart item creation ──
  const buildCartItem = (selectedOfferIdForItem, manualOfferPerUnit) => {
    const selectedVariant = variants.find((v) => v.cex_sku === variant);
    const cashOffers = referenceData?.cash_offers?.map((o) => ({ id: o.id, title: o.title, price: roundOfferPrice(o.price) })) || [];
    const voucherOffers = referenceData?.voucher_offers?.map((o) => ({ id: o.id, title: o.title, price: roundOfferPrice(o.price) })) || [];
    return {
      id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: selectedModel.name,
      subtitle: selectedVariant?.title || Object.values(attributeValues).filter((v) => v).join(' / ') || 'Standard',
      offers: offers.map((o) => ({ id: o.id, title: o.title, price: roundOfferPrice(o.price) })),
      cashOffers, voucherOffers, quantity: 1,
      variantId: selectedVariant?.variant_id,
      category: selectedCategory?.name,
      categoryObject: selectedCategory,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      attributeValues: { ...attributeValues },
      ourSalePrice: ourSalePrice ? roundSalePrice(Number(ourSalePrice)) : null,
      cexSellPrice: referenceData?.cex_sale_price ? Number(referenceData.cex_sale_price) : null,
      cexBuyPrice: referenceData?.cex_tradein_cash ? Number(referenceData.cex_tradein_cash) : null,
      cexVoucherPrice: referenceData?.cex_tradein_voucher ? Number(referenceData.cex_tradein_voucher) : null,
      cexOutOfStock: referenceData?.cex_out_of_stock ?? false,
      cexSku: selectedVariant?.cex_sku ?? null,
      cexUrl: selectedVariant?.cex_sku ? `https://uk.webuy.com/product-detail?id=${selectedVariant.cex_sku}` : null,
      ebayResearchData: savedEbayState || null,
      cashConvertersResearchData: savedCashConvertersState || null,
      referenceData, request_item_id: null,
      offerType: useVoucherOffers ? 'voucher' : 'cash',
      selectedOfferId: selectedOfferIdForItem,
      manualOffer: manualOfferPerUnit != null ? formatOfferPrice(manualOfferPerUnit) : null,
    };
  };

  const handleAddToCart = async (offerArg) => {
    if (!selectedModel || !variant) { alert('Please select a variant'); return; }
    if (!isRepricing && (!offers || offers.length === 0)) { alert('No offers available.'); return; }

    let selectedOfferIdForItem = null, manualOfferPerUnit = null;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferIdForItem = 'manual';
      manualOfferPerUnit = Number(offerArg.amount);
      if (!manualOfferPerUnit || manualOfferPerUnit <= 0) { alert('Please enter a valid amount.'); return; }
    } else {
      selectedOfferIdForItem = isRepricing ? null : (offerArg === undefined ? (offers[0]?.id ?? null) : offerArg);
    }

    const cartItem = buildCartItem(selectedOfferIdForItem, manualOfferPerUnit);
    const isDuplicate = cartItems.some((ci) => !ci.isCustomEbayItem && !ci.isCustomCashConvertersItem && ci.variantId === cartItem.variantId);

    try {
      if (isRepricing) {
        addToCart(cartItem, { showNotification });
        onItemAddedToCart?.();
      } else if (isDuplicate) {
        setPendingDuplicateItem(cartItem);
        setShowDuplicateDialog(true);
      } else {
        const reqItemId = await createOrAppendRequestItem({
          variantId: cartItem.variantId, rawData: cartItem.ebayResearchData, cashConvertersData: cartItem.cashConvertersResearchData,
          cashOffers: cartItem.cashOffers, voucherOffers: cartItem.voucherOffers,
          selectedOfferId: cartItem.selectedOfferId, manualOffer: cartItem.manualOffer, ourSalePrice: cartItem.ourSalePrice,
        });
        cartItem.request_item_id = reqItemId;
        addToCart(cartItem, { showNotification });
        onItemAddedToCart?.();
      }
    } catch (err) {
      console.error('Failed to add item:', err);
      alert('Failed to add item. Check console.');
    }
  };

  const handleDuplicateIncreaseQty = () => {
    setShowDuplicateDialog(false);
    const cartItem = pendingDuplicateItem;
    setPendingDuplicateItem(null);
    const existing = cartItems.find((ci) => ci.variantId === cartItem.variantId);
    addToCart({ ...cartItem, selectedOfferId: existing?.selectedOfferId ?? cartItem.selectedOfferId }, { showNotification });
    onItemAddedToCart?.();
  };

  const handleDuplicateAddNew = async () => {
    setShowDuplicateDialog(false);
    const cartItem = pendingDuplicateItem;
    setPendingDuplicateItem(null);
    try {
      const reqItemId = await createOrAppendRequestItem({
        variantId: cartItem.variantId, rawData: cartItem.ebayResearchData, cashConvertersData: cartItem.cashConvertersResearchData,
        cashOffers: cartItem.cashOffers, voucherOffers: cartItem.voucherOffers,
        selectedOfferId: cartItem.selectedOfferId, manualOffer: cartItem.manualOffer, ourSalePrice: cartItem.ourSalePrice,
      });
      cartItem.request_item_id = reqItemId;
    } catch (err) { console.error('Failed to create request item:', err); }
    addToCart({ ...cartItem, forceNew: true }, { showNotification });
    onItemAddedToCart?.();
  };

  // ── Research completion handlers ──
  const handleEbayResearchComplete = useCallback(async (data) => {
    setEbayData(data);
    setSavedEbayState(data);
    if (isEbayCategory) {
      const apiFilterValues = Object.values(data.selectedFilters?.apiFilters || {}).flat();
      const basicFilterValues = data.selectedFilters?.basic || [];
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0 ? allFilters.join(' / ') : (data.searchTerm || 'No filters applied');
      const cashOffers = (data.buyOffers || []).map((o, idx) => ({ id: `ebay-cash-${idx}`, title: ['1st Offer', '2nd Offer', '3rd Offer'][idx] || 'Offer', price: roundOfferPrice(o.price) }));
      const voucherOffers = cashOffers.map((o) => ({ id: `ebay-voucher-${o.id}`, title: o.title, price: toVoucherOfferPrice(o.price) }));
      const displayOffers = useVoucherOffers ? voucherOffers : cashOffers;

      let selectedOfferId = null, manualOfferValue = null;
      if (data.selectedOfferIndex === 'manual' && data.manualOffer) {
        selectedOfferId = 'manual';
        const parsed = parseFloat(String(data.manualOffer).replace(/[£,]/g, ''));
        if (!Number.isNaN(parsed) && parsed > 0) manualOfferValue = formatOfferPrice(parsed);
      } else if (data.selectedOfferIndex != null && typeof data.selectedOfferIndex === 'number' && displayOffers[data.selectedOfferIndex]) {
        selectedOfferId = displayOffers[data.selectedOfferIndex].id;
      }

      const customCartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: data.searchTerm || 'eBay Research Item', subtitle: filterSubtitle, quantity: 1,
        category: EBAY_TOP_LEVEL_CATEGORY.name, categoryObject: EBAY_TOP_LEVEL_CATEGORY,
        offers: displayOffers, cashOffers, voucherOffers, ebayResearchData: data, isCustomEbayItem: true,
        variantId: null, request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? roundSalePrice(Number(data.stats.suggestedPrice)) : null,
        selectedOfferId, manualOffer: manualOfferValue,
      };

      const isDuplicate = cartItems.some((ci) => ci.isCustomEbayItem && ci.title === customCartItem.title && ci.category === customCartItem.category);
      try {
        if (isRepricing || isDuplicate) {
          addToCart(customCartItem, { showNotification });
        } else {
          const reqItemId = await createOrAppendRequestItem({
            variantId: null, rawData: { ...data, cash_offers: cashOffers, voucher_offers: voucherOffers },
            cashConvertersData: null, cashOffers, voucherOffers,
            selectedOfferId: customCartItem.selectedOfferId, manualOffer: customCartItem.manualOffer, ourSalePrice: customCartItem.ourSalePrice,
          });
          customCartItem.request_item_id = reqItemId;
          addToCart(customCartItem, { showNotification });
        }
        setSavedEbayState(null); setEbayData(null);
      } catch (err) { console.error('Failed to add eBay item:', err); alert('Failed to add eBay item.'); }
    } else {
      const selectedVariant = variants.find((v) => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      if (targetId) updateCartItemResearchData(targetId, 'ebay', data);
    }
  }, [addToCart, cartItems, createOrAppendRequestItem, isEbayCategory, isRepricing, updateCartItemResearchData, useVoucherOffers, variant, variants, showNotification]);

  const handleCashConvertersResearchComplete = async (data) => {
    setCashConvertersData(data);
    setSavedCashConvertersState(data);
    const isCCCategory = selectedCategory?.path?.some((p) => p.toLowerCase() === 'cash converters') || selectedCategory?.name?.toLowerCase() === 'cash converters';

    if (isCCCategory) {
      const apiFilterValues = Object.values(data.selectedFilters?.apiFilters || {}).flat();
      const basicFilterValues = data.selectedFilters?.basic || [];
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0 ? allFilters.join(' / ') : (data.searchTerm || 'No filters applied');
      const cashOffers = data.buyOffers.map((o, idx) => ({ id: `cc-cash-${Date.now()}-${idx}`, title: ['1st Offer', '2nd Offer', '3rd Offer'][idx] || 'Offer', price: Number(o.price) }));
      const voucherOffers = cashOffers.map((o) => ({ id: `cc-voucher-${o.id}`, title: o.title, price: Number((o.price * 1.10).toFixed(2)) }));

      const customCartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: data.searchTerm || 'Cash Converters Research Item', subtitle: filterSubtitle, quantity: 1,
        category: selectedCategory?.name, categoryObject: selectedCategory,
        offers: useVoucherOffers ? voucherOffers : cashOffers, cashOffers, voucherOffers,
        cashConvertersResearchData: data, isCustomCashConvertersItem: true, variantId: null, request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? roundSalePrice(Number(data.stats.suggestedPrice)) : null,
      };

      const isDuplicate = cartItems.some((ci) => ci.isCustomCashConvertersItem && ci.title === customCartItem.title && ci.category === customCartItem.category);
      try {
        if (isRepricing || isDuplicate) { addToCart(customCartItem, { showNotification }); }
        else {
          const reqItemId = await createOrAppendRequestItem({
            variantId: null, rawData: null, cashConvertersData: data,
            cashOffers: customCartItem.cashOffers, voucherOffers: customCartItem.voucherOffers,
            selectedOfferId: customCartItem.selectedOfferId, manualOffer: customCartItem.manualOffer, ourSalePrice: customCartItem.ourSalePrice,
          });
          customCartItem.request_item_id = reqItemId;
          addToCart(customCartItem, { showNotification });
        }
      } catch (err) { console.error('Failed to add CC item:', err); alert('Failed to add item.'); }
    } else {
      const selectedVariant = variants.find((v) => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      if (targetId) updateCartItemResearchData(targetId, 'cashConverters', data);
    }
  };

  // ── Offer editing callbacks ──
  const handleOfferPriceChange = useCallback((offerId, newPrice) => {
    if (!selectedCartItem) return;
    const normalized = roundOfferPrice(Number(newPrice));
    const update = (arr) => (arr || []).map((o) => (o.id === offerId ? { ...o, price: normalized } : o));
    updateCartItemOffers(selectedCartItem.id, { offers: update(selectedCartItem.offers), cashOffers: update(selectedCartItem.cashOffers), voucherOffers: update(selectedCartItem.voucherOffers) });
  }, [selectedCartItem, updateCartItemOffers]);

  const handleSelectedOfferChange = useCallback((offerId) => {
    if (!selectedCartItem) return;
    updateCartItemOffers(selectedCartItem.id, { selectedOfferId: offerId });
  }, [selectedCartItem, updateCartItemOffers]);

  const isViewingCartItem = Boolean(selectedCartItem) && !selectedCartItem?.isCustomEbayItem && !selectedCartItem?.isCustomCashConvertersItem && !selectedCartItem?.isCustomCeXItem;

  const isAlreadyInCart = React.useMemo(() => {
    if (!isRepricing) return false;
    if (selectedCartItem) return true;
    if (variant) return cartItems.some((ci) => ci.cexSku === variant || (ci.variantId != null && String(ci.variantId) === String(variant)));
    if (cexProductData) return cartItems.some((ci) => ci.isCustomCeXItem && ci.title === cexProductData.title && ci.subtitle === (cexProductData.category || ''));
    return false;
  }, [isRepricing, selectedCartItem, variant, cexProductData, cartItems]);

  const handleAttributeChangeWithDeselect = useCallback((...args) => {
    if (isViewingCartItem) deselectCartItem();
    handleAttributeChange(...args);
  }, [handleAttributeChange, isViewingCartItem, deselectCartItem]);

  const setVariantWithDeselect = useCallback((nextVariant) => {
    if (isViewingCartItem) deselectCartItem();
    setVariant(nextVariant);
  }, [isViewingCartItem, deselectCartItem, setVariant]);

  // Build market comparison context for research modals
  const buildMarketContext = useCallback((item) => {
    const base = {
      cexSalePrice: referenceData?.cex_sale_price ?? null,
      ourSalePrice: ourSalePrice ? roundSalePrice(Number(ourSalePrice)) : null,
      ebaySalePrice: ebayData?.stats?.median ?? null,
      cashConvertersSalePrice: cashConvertersData?.stats?.median ?? null,
      itemTitle: selectedModel?.name || selectedCategory?.name || null,
      itemCondition: attributeValues?.condition || null,
      ebaySearchTerm: ebayData?.searchTerm || null,
      cashConvertersSearchTerm: cashConvertersData?.searchTerm || null,
    };
    if (Object.values(attributeValues || {}).some((v) => v)) {
      base.itemSpecs = Object.fromEntries(
        Object.entries(attributeValues || {}).filter(([, v]) => v).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])
      );
    }
    return base;
  }, [referenceData, ourSalePrice, ebayData, cashConvertersData, selectedModel, selectedCategory, attributeValues]);

  // ── Routing: which view to show ──

  // CeX cart item selected
  if (selectedCartItem?.isCustomCeXItem) {
    return (
      <CexProductView
        item={selectedCartItem}
        isRepricing={isRepricing}
        useVoucherOffers={useVoucherOffers}
        customerData={customerData}
        onOfferPriceChange={handleOfferPriceChange}
        onSelectedOfferChange={handleSelectedOfferChange}
        onUpdateCartItemResearch={(itemId, type, data) => {
          const field = type === 'ebay' ? 'ebayResearchData' : 'cashConvertersResearchData';
          useAppStore.getState().updateCartItem(itemId, { [field]: data });
        }}
      />
    );
  }

  // CeX product from "Add from CeX" flow
  if (cexProductData) {
    return (
      <CexProductView
        cexProduct={cexProductData}
        isRepricing={isRepricing}
        useVoucherOffers={useVoucherOffers}
        customerData={customerData}
        onAddToCart={addToCart}
        createOrAppendRequestItem={createOrAppendRequestItem}
        onClearCeXProduct={clearCexProduct}
        cartItems={cartItems}
        setCexProductData={setCexProductData}
        onItemAddedToCart={onItemAddedToCart}
        showNotification={showNotification}
      />
    );
  }

  // eBay cart item selected
  if (selectedCartItem?.isCustomEbayItem) {
    return (
      <EbayCartItemView
        item={selectedCartItem}
        isRepricing={isRepricing}
        useVoucherOffers={useVoucherOffers}
              onOfferPriceChange={handleOfferPriceChange}
              onSelectedOfferChange={handleSelectedOfferChange}
        onEbayResearchComplete={handleEbayResearchComplete}
        onDeselectCartItem={deselectCartItem}
      />
    );
  }

  // Cash Converters cart item selected
  if (selectedCartItem?.isCustomCashConvertersItem) {
    return (
      <CashConvertersCartItemView
        item={selectedCartItem}
              savedState={savedCashConvertersState}
        onDeselectCartItem={deselectCartItem}
      />
    );
  }

  // No category selected
  if (!selectedCategory) {
    return (
      <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
        <EmptyState />
      </section>
    );
  }

  // Category selected but no model (product selection)
  if (!selectedModel && !isEbayCategory) {
    return (
      <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
        <ProductSelection availableModels={availableModels} setSelectedModel={setSelectedModel} isLoading={isLoadingModels} />
      </section>
    );
  }

  // ── Main product/eBay view ──
  return (
    <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
      {!isEbayCategory && (
        <div className="sticky top-0 z-40 flex flex-col bg-white border-b border-gray-200">
          <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200">
            <Tab icon="info" label="Product Info" isActive={activeTab === 'info'} onClick={() => setActiveTab('info')} />
          </div>
          <div className="px-8 py-6 bg-gray-50/50">
            <Breadcrumb items={selectedCategory.path} />
            <div className="mb-4">
              {isLoadingModels ? (
                <div className="flex items-center gap-3 text-sm text-gray-600 py-2">
                  <Icon name="sync" className="animate-spin text-xl text-blue-900" />
                  <span>Loading models…</span>
                </div>
              ) : (
                <SearchableDropdown
                  value={selectedModel?.name || 'Select a model'}
                  options={availableModels.length > 0 ? availableModels.map((m) => m.name) : ['No models available']}
                  onChange={(name) => { const m = availableModels.find((x) => x.name === name); if (m) setSelectedModel(m); }}
                />
              )}
            </div>
              <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {selectedModel?.name || selectedCategory.name}
              {Object.keys(attributeValues).length > 0 && <span> - {Object.values(attributeValues).filter((v) => v).join(' / ')}</span>}
              </h1>
          </div>
        </div>
      )}
      
      {isEbayCategory && (
        <>
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
        </div>
        <div className="p-8">
          {!savedEbayState && cartItems.some((ci) => ci.isCustomEbayItem) && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-3">
              <span className="material-symbols-outlined text-blue-600 text-xl">info</span>
                <p className="text-sm text-blue-900">Click on an item on the right to view its per-item research data.</p>
            </div>
          )}
          <EbayResearchForm
            key={savedEbayState ? 'ebay-with-data' : 'ebay-empty'}
              mode="page" category={EBAY_TOP_LEVEL_CATEGORY}
              onComplete={handleEbayResearchComplete} savedState={savedEbayState}
              initialHistogramState={false} showManualOffer={false}
              addActionLabel={isRepricing ? 'Add to Reprice List' : 'Add to Cart'} hideOfferCards={isRepricing}
          />
        </div>
        </>
      )}

      {!isEbayCategory && (
        <>
          <div className="p-8 space-y-8">
            <AttributeConfiguration
              attributes={attributes} attributeValues={attributeValues} variants={variants}
              handleAttributeChange={handleAttributeChangeWithDeselect} setAllAttributeValues={setAllAttributeValues}
              variant={variant} setVariant={setVariant} onUserSetVariant={setVariantWithDeselect}
              variantImageUrl={referenceData?.cex_image_urls?.large || referenceData?.cex_image_urls?.medium || referenceData?.cex_image_urls?.small}
            />

            {variant && (
              <MarketComparisonsTable
                variant={variant} competitorStats={[]} ourSalePrice={ourSalePrice} referenceData={referenceData}
                ebayData={ebayData} setEbayModalOpen={setEbayModalOpen}
                cashConvertersData={cashConvertersData} setCashConvertersModalOpen={setCashConvertersModalOpen}
                cexSku={variant} hideBuyInPrice={isRepricing}
              />
            )}

            {isRepricing ? (
              variant && !isAlreadyInCart && (
                <div className="flex justify-end pt-4">
                  <Button variant="primary" icon="sell" className="px-6 py-3 font-bold uppercase tracking-tight" onClick={() => handleAddToCart(null)}>
                    Add to Reprice List
                  </Button>
                </div>
              )
            ) : isLoadingOffers ? (
              <div className="flex items-center justify-center py-8">
                <Icon name="sync" className="animate-spin text-2xl text-blue-900 mr-3" />
                <span className="text-sm text-gray-600">Loading {useVoucherOffers ? 'voucher' : 'cash'} offers...</span>
              </div>
            ) : isViewingCartItem ? (
              <OfferSelection
                variant={variant}
                offers={useVoucherOffers ? (selectedCartItem.voucherOffers?.length ? selectedCartItem.voucherOffers : offers) : (selectedCartItem.cashOffers?.length ? selectedCartItem.cashOffers : offers)}
                referenceData={referenceData} offerType={useVoucherOffers ? 'voucher' : 'cash'}
                initialSelectedOfferId={selectedCartItem?.selectedOfferId ?? null} editMode={true}
                syncKey={`${selectedCartItem?.id ?? variant ?? 'item'}:${useVoucherOffers ? 'voucher' : 'cash'}`}
                onOfferPriceChange={handleOfferPriceChange} onSelectedOfferChange={handleSelectedOfferChange}
              />
            ) : (
              <OfferSelection variant={variant} offers={offers} referenceData={referenceData} offerType={useVoucherOffers ? 'voucher' : 'cash'} onAddToCart={handleAddToCart} />
            )}
          </div>

          {isEbayModalOpen && (
            <EbayResearchForm
              mode="modal" category={selectedCategory} savedState={savedEbayState}
              initialHistogramState={false} showManualOffer={false} referenceData={referenceData}
              ourSalePrice={ourSalePrice} initialSearchQuery={selectedModel?.name || undefined}
              marketComparisonContext={buildMarketContext()}
              hideOfferCards
              onComplete={(data) => { if (data?.cancel) { setEbayModalOpen(false); return; } handleEbayResearchComplete(data); setEbayModalOpen(false); }}
            />
          )}

          {isCashConvertersModalOpen && (
            <CashConvertersResearchForm
              mode="modal" category={selectedCategory} savedState={savedCashConvertersState}
              initialHistogramState={false} referenceData={referenceData} ourSalePrice={ourSalePrice}
              initialSearchQuery={ebayData?.searchTerm || selectedModel?.name || undefined}
              marketComparisonContext={buildMarketContext()}
              onComplete={(data) => { if (data?.cancel) { setCashConvertersModalOpen(false); return; } handleCashConvertersResearchComplete(data); setCashConvertersModalOpen(false); }}
            />
          )}
        </>
      )}

      {showDuplicateDialog && pendingDuplicateItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-sm border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-500/10 p-2 rounded-lg">
                <span className="material-symbols-outlined text-yellow-600 text-xl">inventory_2</span>
              </div>
              <h2 className="text-base font-extrabold text-gray-900">Item Already in Cart</h2>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              <span className="font-semibold text-gray-900">{pendingDuplicateItem.title}</span> is already in your cart.
            </p>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={handleDuplicateIncreaseQty}
                className="w-full px-4 py-3 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-800 transition-colors flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">add_circle</span>Increase Quantity
              </button>
              <button type="button" onClick={handleDuplicateAddNew}
                className="w-full px-4 py-3 border-2 border-blue-900 text-blue-900 rounded-xl font-bold hover:bg-blue-50 transition-colors flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">add_box</span>Add as Separate Item
              </button>
              <button type="button" onClick={() => { setShowDuplicateDialog(false); setPendingDuplicateItem(null); }}
                className="w-full px-4 py-2 text-gray-500 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default MainContent;
