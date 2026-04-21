import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Icon, Button, Tab, Breadcrumb, SearchableDropdown } from '@/components/ui/components';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm.jsx';
import CashGeneratorResearchForm from '@/components/forms/CashGeneratorResearchForm.jsx';
import EmptyState from './EmptyState';
import ProductSelection from './ProductSelection';
import AttributeConfiguration from './AttributeConfiguration';
import CexMarketPricingStrip from './CexMarketPricingStrip';
import OfferSelection from './OfferSelection';
import CexProductView from './CexProductView';
import EbayCartItemView from './EbayCartItemView';
import CashConvertersCartItemView from './CashConvertersCartItemView';
import CashGeneratorCartItemView from './CashGeneratorCartItemView';

import { useProductAttributes } from '@/pages/buyer/hooks/useProductAttributes';
import { fetchVariantPrices, updateRequestItemRawData } from '@/services/api';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';
import { roundOfferPrice, roundSalePrice, toVoucherOfferPrice, formatOfferPrice } from '@/utils/helpers';
import { buildPersistedEbayRawData } from '@/utils/researchPersistence';
import { EBAY_TOP_LEVEL_CATEGORY } from '@/pages/buyer/constants';
import {
  referenceDataWithNormalizedCexOffers,
  ourSalePriceFieldFromVariantResponse,
  slimCexNegotiationOfferRows,
} from '@/utils/cexOfferMapping';
import { validateBuyerCartItemOffers } from '@/utils/cartOfferValidation';
import { titleForEbayCcOfferIndex } from '@/components/forms/researchStats';
import useAppStore, {
  useCartItems,
  useSelectedCartItem,
  useIsRepricing,
  useIsUploadWorkspace,
  useUseVoucherOffers,
} from '@/store/useAppStore';
import { useNotification } from '@/contexts/NotificationContext';

const MainContent = ({ mode = 'buyer' }) => {
  const isRepricing = useIsRepricing();
  const isUploadWorkspace = useIsUploadWorkspace();
  const repriceLikeAddLabel = isUploadWorkspace ? 'Add to upload list' : 'Add to Reprice List';
  const useVoucherOffers = useUseVoucherOffers();
  const selectedCartItem = useSelectedCartItem();

  const {
    selectedCategory, availableModels, selectedModel, setSelectedModel, isLoadingModels,
    customerData, intent, request,
    cexProductData, setCexProductData, clearCexProduct,
    addToCart, updateCartItem, updateCartItemOffers, updateCartItemResearchData,
    createOrAppendRequestItem, onItemAddedToCart, deselectCartItem,
  } = useAppStore();

  const cartItems = useCartItems();

  const { showNotification } = useNotification();
  
  const [activeTab, setActiveTab] = useState('info');
  const [variants, setVariants] = useState([]);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [isCashConvertersModalOpen, setCashConvertersModalOpen] = useState(false);
  const [isCashGeneratorModalOpen, setCashGeneratorModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [ebayData, setEbayData] = useState(null);
  const [savedEbayState, setSavedEbayState] = useState(null);
  const [cashConvertersData, setCashConvertersData] = useState(null);
  const [savedCashConvertersState, setSavedCashConvertersState] = useState(null);
  const [cgData, setCgData] = useState(null);
  const [savedCgState, setSavedCgState] = useState(null);
  const [isCeXEbayModalOpen, setCeXEbayModalOpen] = useState(false);
  const [isCeXCashConvertersModalOpen, setCeXCashConvertersModalOpen] = useState(false);
  const [pendingDuplicateItem, setPendingDuplicateItem] = useState(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const skipVariantFetchRef = useRef(false);

  const { attributes, attributeValues, variant, setVariant, handleAttributeChange, setAllAttributeValues } =
    useProductAttributes(selectedModel?.product_id, variants);

  const isEbayCategory = selectedCategory?.path?.some((p) => p.toLowerCase() === 'ebay') || selectedCategory?.name?.toLowerCase() === 'ebay';

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

  // Clear research and stale skip flag when deselecting cart item
  useEffect(() => {
    if (!selectedCartItem) {
      skipVariantFetchRef.current = false;
      if (isEbayCategory) { setSavedEbayState(null); setEbayData(null); }
      const isCC = selectedCategory?.path?.some((p) => p.toLowerCase() === 'cash converters') || selectedCategory?.name?.toLowerCase() === 'cash converters';
      if (isCC) { setSavedCashConvertersState(null); setCashConvertersData(null); }
      const isCgPath =
        selectedCategory?.path?.some((p) => String(p).toLowerCase().includes('cash generator')) ||
        selectedCategory?.name?.toLowerCase().includes('cash generator');
      if (isCgPath) { setSavedCgState(null); setCgData(null); }
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

  // Load offers when variant changes
  useEffect(() => {
    if (!variant) { setOffers([]); setReferenceData(null); setOurSalePrice(''); setEbayData(null); setSavedEbayState(null); setCashConvertersData(null); setSavedCashConvertersState(null); setCgData(null); setSavedCgState(null); return; }
    if (skipVariantFetchRef.current) {
      skipVariantFetchRef.current = false;
      setIsLoadingOffers(false);
      return;
    }
    const load = async () => {
      setIsLoadingOffers(true);
      try {
        const data = await fetchVariantPrices(variant);
        const referenceData = referenceDataWithNormalizedCexOffers(data);
        setOffers(useVoucherOffers ? referenceData.voucher_offers : referenceData.cash_offers);
        setReferenceData(referenceData);
        setOurSalePrice(ourSalePriceFieldFromVariantResponse(data));
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
    if (selectedCartItem.isCustomCashGeneratorItem) {
      if (selectedCartItem.cgResearchData) {
        setSavedCgState(selectedCartItem.cgResearchData);
        setCgData(selectedCartItem.cgResearchData);
        setActiveTab('research');
      }
      return;
    }
    const modelToSet = availableModels.find((m) => m.name === selectedCartItem.model);
    const needsModelResolution = Boolean(selectedCartItem.model) && selectedModel?.name !== selectedCartItem.model;
    if (needsModelResolution) {
      if (modelToSet && selectedModel?.product_id !== modelToSet.product_id) {
        setSelectedModel(modelToSet);
      }
      // Wait for the correct model to be selected before restoring attrs/variant.
      // This prevents hydration against stale previous-model attributes.
      return;
    }
    const matched = resolveVariantFromCartItem(selectedCartItem);
    if (matched?.attribute_values) setAllAttributeValues(matched.attribute_values);
    else if (attributes.length > 0 && selectedCartItem.attributeValues) setAllAttributeValues(selectedCartItem.attributeValues);
    const cartItemHasOffers = selectedCartItem.cashOffers?.length > 0 || selectedCartItem.voucherOffers?.length > 0;
    if (matched?.cex_sku) {
      if (cartItemHasOffers) skipVariantFetchRef.current = true;
      setVariant(matched.cex_sku);
    } else if (variants.length > 0 && selectedCartItem.cexSku) {
      if (cartItemHasOffers) skipVariantFetchRef.current = true;
      setVariant(selectedCartItem.cexSku);
    }
    if (selectedCartItem.ebayResearchData) { setSavedEbayState(selectedCartItem.ebayResearchData); setEbayData(selectedCartItem.ebayResearchData); }
    if (selectedCartItem.cashConvertersResearchData) { setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData); setCashConvertersData(selectedCartItem.cashConvertersResearchData); }
    if (selectedCartItem.cgResearchData) { setSavedCgState(selectedCartItem.cgResearchData); setCgData(selectedCartItem.cgResearchData); }
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
    if (!selectedCartItem || variants.length === 0 || selectedCartItem.isCustomEbayItem || selectedCartItem.isCustomCashConvertersItem || selectedCartItem.isCustomCashGeneratorItem) return;
    if (selectedCartItem.model && selectedModel?.name !== selectedCartItem.model) return;
    const v = resolveVariantFromCartItem(selectedCartItem);
    if (v) {
      if (v.attribute_values) setAllAttributeValues(v.attribute_values);
      const isNewVariant = v.cex_sku !== variant;
      if (isNewVariant) {
        if (selectedCartItem.cashOffers?.length > 0 || selectedCartItem.voucherOffers?.length > 0) skipVariantFetchRef.current = true;
        setVariant(v.cex_sku);
      }
    }
    if (selectedCartItem.ebayResearchData) { setSavedEbayState(selectedCartItem.ebayResearchData); setEbayData(selectedCartItem.ebayResearchData); }
    if (selectedCartItem.cashConvertersResearchData) { setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData); setCashConvertersData(selectedCartItem.cashConvertersResearchData); }
    if (selectedCartItem.cgResearchData) { setSavedCgState(selectedCartItem.cgResearchData); setCgData(selectedCartItem.cgResearchData); }
    if (selectedCartItem.referenceData) {
      setReferenceData(selectedCartItem.referenceData);
      const display = useVoucherOffers ? (selectedCartItem.voucherOffers || selectedCartItem.offers) : (selectedCartItem.cashOffers || selectedCartItem.offers);
      if (display) setOffers(display);
      if (selectedCartItem.ourSalePrice != null && Number.isFinite(Number(selectedCartItem.ourSalePrice))) {
        setOurSalePrice(String(roundSalePrice(Number(selectedCartItem.ourSalePrice))));
      }
    }
  }, [selectedCartItem, variants, useVoucherOffers, resolveVariantFromCartItem, setAllAttributeValues, setVariant, variant]);

  // ── Cart item creation ──
  const buildCartItem = (selectedOfferIdForItem, manualOfferPerUnit) => {
    const selectedVariant = variants.find((v) => v.cex_sku === variant);
    const cashOffers = slimCexNegotiationOfferRows(referenceData?.cash_offers);
    const voucherOffers = slimCexNegotiationOfferRows(referenceData?.voucher_offers);
    return {
      id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: selectedModel.name,
      subtitle: selectedVariant?.title || Object.values(attributeValues).filter((v) => v).join(' / ') || 'Standard',
      offers: slimCexNegotiationOfferRows(offers),
      cashOffers, voucherOffers, quantity: 1,
      variantId: selectedVariant?.variant_id,
      category: selectedCategory?.name,
      categoryObject: selectedCategory,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      attributeValues: { ...attributeValues },
      attributeLabels: Object.fromEntries((attributes || []).map((a) => [a.code, a.name])),
      ourSalePrice: ourSalePrice ? roundSalePrice(Number(ourSalePrice)) : null,
      cexSellPrice: referenceData?.cex_sale_price ? Number(referenceData.cex_sale_price) : null,
      cexBuyPrice: referenceData?.cex_tradein_cash ? Number(referenceData.cex_tradein_cash) : null,
      cexVoucherPrice: referenceData?.cex_tradein_voucher ? Number(referenceData.cex_tradein_voucher) : null,
      cexOutOfStock: referenceData?.cex_out_of_stock ?? false,
      cexSku: selectedVariant?.cex_sku ?? null,
      cexUrl: selectedVariant?.cex_sku ? `https://uk.webuy.com/product-detail?id=${selectedVariant.cex_sku}` : null,
      ebayResearchData: savedEbayState || null,
      cashConvertersResearchData: savedCashConvertersState || null,
      cgResearchData: savedCgState || null,
      referenceData, request_item_id: null,
      offerType: useVoucherOffers ? 'voucher' : 'cash',
      selectedOfferId: selectedOfferIdForItem,
      manualOffer: manualOfferPerUnit != null ? formatOfferPrice(manualOfferPerUnit) : null,
    };
  };

  const handleAddToCart = async (offerArg) => {
    if (!selectedModel || !variant) {
      showNotification('Please select a variant', 'error');
      return;
    }
    if (!isRepricing && (!offers || offers.length === 0)) {
      showNotification('No offers available.', 'error');
      return;
    }

    let selectedOfferIdForItem = null, manualOfferPerUnit = null;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferIdForItem = 'manual';
      manualOfferPerUnit = Number(offerArg.amount);
      if (!manualOfferPerUnit || manualOfferPerUnit <= 0) {
        showNotification('Please enter a valid amount.', 'error');
        return;
      }
    } else {
      selectedOfferIdForItem = isRepricing ? null : (offerArg === undefined ? (offers[0]?.id ?? null) : offerArg);
    }

    const cartItem = buildCartItem(selectedOfferIdForItem, manualOfferPerUnit);
    if (!isRepricing) {
      const offerErr = validateBuyerCartItemOffers(cartItem, customerData?.transactionType === 'store_credit');
      if (offerErr) {
        showNotification(offerErr, 'error');
        return;
      }
    }
    const isDuplicate = cartItems.some(
      (ci) =>
        !ci.isCustomEbayItem &&
        !ci.isCustomCashConvertersItem &&
        !ci.isCustomCashGeneratorItem &&
        ci.variantId === cartItem.variantId
    );

    try {
      if (isRepricing) {
        addToCart(cartItem, { showNotification });
        onItemAddedToCart?.();
      } else if (isDuplicate) {
        setPendingDuplicateItem(cartItem);
        setShowDuplicateDialog(true);
      } else {
        const embeddedRawData = cartItem.ebayResearchData
          ? { ...cartItem.ebayResearchData, referenceData: cartItem.referenceData }
          : cartItem.referenceData ? { referenceData: cartItem.referenceData } : null;
        const reqItemId = await createOrAppendRequestItem({
          variantId: cartItem.variantId, rawData: embeddedRawData, cashConvertersData: cartItem.cashConvertersResearchData,
          cgData: cartItem.cgResearchData ?? null,
          cashOffers: cartItem.cashOffers, voucherOffers: cartItem.voucherOffers,
          selectedOfferId: cartItem.selectedOfferId, manualOffer: cartItem.manualOffer, ourSalePrice: cartItem.ourSalePrice,
        });
        cartItem.request_item_id = reqItemId;
        addToCart(cartItem, { showNotification });
        onItemAddedToCart?.();
      }
    } catch (err) {
      console.error('Failed to add item:', err);
      showNotification(err?.message || 'Failed to add item.', 'error');
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
    const offerErr = validateBuyerCartItemOffers(cartItem, customerData?.transactionType === 'store_credit');
    if (offerErr) {
      showNotification(offerErr, 'error');
      return;
    }
    try {
      const embeddedRawData = cartItem.ebayResearchData
        ? { ...cartItem.ebayResearchData, referenceData: cartItem.referenceData }
        : cartItem.referenceData ? { referenceData: cartItem.referenceData } : null;
      const reqItemId = await createOrAppendRequestItem({
        variantId: cartItem.variantId, rawData: embeddedRawData, cashConvertersData: cartItem.cashConvertersResearchData,
        cgData: cartItem.cgResearchData ?? null,
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
      const cashOffers = (data.buyOffers || []).map((o, idx) => ({
        id: `ebay-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: roundOfferPrice(o.price),
      }));
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

      const searchTitle =
        data.searchTerm != null && String(data.searchTerm).trim() !== ''
          ? String(data.searchTerm).trim().slice(0, 200)
          : 'eBay Research Item';
      const resolved = data.resolvedCategory?.id != null ? data.resolvedCategory : null;
      const categoryObject = resolved ?? EBAY_TOP_LEVEL_CATEGORY;
      const categoryName = categoryObject?.name ?? EBAY_TOP_LEVEL_CATEGORY.name;
      const customCartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: searchTitle, subtitle: filterSubtitle, quantity: 1,
        category: categoryName, categoryObject,
        offers: displayOffers, cashOffers, voucherOffers, ebayResearchData: data, isCustomEbayItem: true,
        variantId: null, request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? roundSalePrice(Number(data.stats.suggestedPrice)) : null,
        selectedOfferId, manualOffer: manualOfferValue,
      };

      if (!isRepricing) {
        const ebayOfferErr = validateBuyerCartItemOffers(customCartItem, useVoucherOffers);
        if (ebayOfferErr) {
          showNotification(ebayOfferErr, 'error');
          return;
        }
      }

      const isDuplicate = cartItems.some((ci) => ci.isCustomEbayItem && ci.title === customCartItem.title && ci.category === customCartItem.category);
      try {
        if (isRepricing || isDuplicate) {
          addToCart(customCartItem, { showNotification });
        } else {
          const reqItemId = await createOrAppendRequestItem({
            variantId: null,
            rawData: buildPersistedEbayRawData(data, {
              categoryObject,
              cashOffers,
              voucherOffers,
            }),
            cashConvertersData: null,
            cgData: null,
            cashOffers, voucherOffers,
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
      const cashOffers = data.buyOffers.map((o, idx) => ({
        id: `cc-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: Number(o.price),
      }));
      const voucherOffers = cashOffers.map((o) => ({ id: `cc-voucher-${o.id}`, title: o.title, price: Number((o.price * 1.10).toFixed(2)) }));

      const customCartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: data.searchTerm || 'Cash Converters Research Item', subtitle: filterSubtitle, quantity: 1,
        category: selectedCategory?.name, categoryObject: selectedCategory,
        offers: useVoucherOffers ? voucherOffers : cashOffers, cashOffers, voucherOffers,
        cashConvertersResearchData: data, isCustomCashConvertersItem: true, variantId: null, request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? roundSalePrice(Number(data.stats.suggestedPrice)) : null,
      };

      if (!isRepricing) {
        const ccOfferErr = validateBuyerCartItemOffers(customCartItem, useVoucherOffers);
        if (ccOfferErr) {
          showNotification(ccOfferErr, 'error');
          return;
        }
      }

      const isDuplicate = cartItems.some((ci) => ci.isCustomCashConvertersItem && ci.title === customCartItem.title && ci.category === customCartItem.category);
      try {
        if (isRepricing || isDuplicate) { addToCart(customCartItem, { showNotification }); }
        else {
          const reqItemId = await createOrAppendRequestItem({
            variantId: null, rawData: null, cashConvertersData: data,
            cgData: null,
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

  const handleCashGeneratorResearchComplete = async (data) => {
    setCgData(data);
    setSavedCgState(data);
    const isCgCategory =
      selectedCategory?.path?.some((p) => String(p).toLowerCase().includes('cash generator')) ||
      selectedCategory?.name?.toLowerCase().includes('cash generator');

    if (isCgCategory) {
      const apiFilterValues = Object.values(data.selectedFilters?.apiFilters || {}).flat();
      const basicFilterValues = data.selectedFilters?.basic || [];
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0 ? allFilters.join(' / ') : (data.searchTerm || 'No filters applied');
      const cashOffers = (data.buyOffers || []).map((o, idx) => ({
        id: `cg-cash_${idx + 1}`,
        title: titleForEbayCcOfferIndex(idx),
        price: Number(o.price),
      }));
      const voucherOffers = cashOffers.map((o) => ({
        id: `cg-voucher-${o.id}`,
        title: o.title,
        price: Number((o.price * 1.10).toFixed(2)),
      }));

      const customCartItem = {
        id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: data.searchTerm || 'Cash Generator Research Item',
        subtitle: filterSubtitle,
        quantity: 1,
        category: selectedCategory?.name,
        categoryObject: selectedCategory,
        offers: useVoucherOffers ? voucherOffers : cashOffers,
        cashOffers,
        voucherOffers,
        cgResearchData: data,
        isCustomCashGeneratorItem: true,
        variantId: null,
        request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice != null ? roundSalePrice(Number(data.stats.suggestedPrice)) : null,
      };

      if (!isRepricing) {
        const cgOfferErr = validateBuyerCartItemOffers(customCartItem, useVoucherOffers);
        if (cgOfferErr) {
          showNotification(cgOfferErr, 'error');
          return;
        }
      }

      const isDuplicate = cartItems.some(
        (ci) => ci.isCustomCashGeneratorItem && ci.title === customCartItem.title && ci.category === customCartItem.category
      );
      try {
        if (isRepricing || isDuplicate) {
          addToCart(customCartItem, { showNotification });
        } else {
          const reqItemId = await createOrAppendRequestItem({
            variantId: null,
            rawData: null,
            cashConvertersData: null,
            cgData: data,
            cashOffers: customCartItem.cashOffers,
            voucherOffers: customCartItem.voucherOffers,
            selectedOfferId: customCartItem.selectedOfferId,
            manualOffer: customCartItem.manualOffer,
            ourSalePrice: customCartItem.ourSalePrice,
          });
          customCartItem.request_item_id = reqItemId;
          addToCart(customCartItem, { showNotification });
        }
      } catch (err) {
        console.error('Failed to add CG item:', err);
        alert('Failed to add item.');
      }
    } else {
      const selectedVariant = variants.find((v) => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      if (targetId) updateCartItemResearchData(targetId, 'cashGenerator', data);
    }
  };

  // ── eBay exclusion → live offer refresh ──
  // Called by EbayResearchForm (via EbayCartItemView) whenever the user toggles
  // an exclusion on an already-carted eBay item. Re-derives cash/voucher offers
  // from the updated buyOffers and writes them back to the cart item so that
  // the offer cards and sidebar both reflect the new prices immediately.
  const handleEbayOffersChange = useCallback(({ buyOffers: newBuyOffers, listings: newListings, stats: newStats, advancedFilterState: newAdvancedFilterState }) => {
    if (!selectedCartItem?.isCustomEbayItem) return;

    const cashOffers = (newBuyOffers || []).map((o, idx) => ({
      id: `ebay-cash_${idx + 1}`,
      title: titleForEbayCcOfferIndex(idx),
      price: roundOfferPrice(o.price),
    }));
    const voucherOffers = cashOffers.map((o) => ({
      id: `ebay-voucher-${o.id}`,
      title: o.title,
      price: toVoucherOfferPrice(o.price),
    }));
    const offers = useVoucherOffers ? voucherOffers : cashOffers;

    updateCartItemOffers(selectedCartItem.id, { cashOffers, voucherOffers, offers });

    const updatedResearchData = {
      ...selectedCartItem.ebayResearchData,
      listings: newListings,
      buyOffers: newBuyOffers,
      stats: newStats,
      ...(newAdvancedFilterState != null && typeof newAdvancedFilterState === 'object'
        ? { advancedFilterState: newAdvancedFilterState }
        : {}),
    };
    updateCartItem(selectedCartItem.id, { ebayResearchData: updatedResearchData });

    if (selectedCartItem.request_item_id) {
      updateRequestItemRawData(selectedCartItem.request_item_id, {
        raw_data: buildPersistedEbayRawData(updatedResearchData, {
          categoryObject: selectedCartItem.categoryObject,
        }),
      }).catch(() => {});
    }
  }, [selectedCartItem, updateCartItem, updateCartItemOffers, useVoucherOffers]);

  // ── Offer editing callbacks ──
  const handleSelectOfferForSelectedItem = useCallback((offerArg) => {
    if (!selectedCartItem) return;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      const amount = Number(offerArg.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      updateCartItemOffers(selectedCartItem.id, {
        selectedOfferId: 'manual',
        manualOffer: formatOfferPrice(amount),
      });
      return;
    }
    updateCartItemOffers(selectedCartItem.id, {
      selectedOfferId: offerArg,
      manualOffer: null,
    });
  }, [selectedCartItem, updateCartItemOffers]);

  const isViewingCartItem = Boolean(selectedCartItem) &&
    !selectedCartItem?.isCustomEbayItem &&
    !selectedCartItem?.isCustomCashConvertersItem &&
    !selectedCartItem?.isCustomCashGeneratorItem &&
    !selectedCartItem?.isCustomCeXItem;

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
  const buildMarketContext = useCallback(() => {
    const base = {
      cexSalePrice: referenceData?.cex_sale_price ?? null,
      ourSalePrice: ourSalePrice ? roundSalePrice(Number(ourSalePrice)) : null,
      ebaySalePrice: ebayData?.stats?.median ?? null,
      cashConvertersSalePrice: cashConvertersData?.stats?.median ?? null,
      cashGeneratorSalePrice: cgData?.stats?.median ?? null,
      itemTitle: selectedModel?.name || selectedCategory?.name || null,
      itemCondition: attributeValues?.condition || null,
      ebaySearchTerm: ebayData?.searchTerm || null,
      cashConvertersSearchTerm: cashConvertersData?.searchTerm || null,
      cashGeneratorSearchTerm: cgData?.searchTerm || null,
    };
    if (Object.values(attributeValues || {}).some((v) => v)) {
      base.itemSpecs = Object.fromEntries(
        Object.entries(attributeValues || {}).filter(([, v]) => v).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])
      );
    }
    return base;
  }, [referenceData, ourSalePrice, ebayData, cashConvertersData, cgData, selectedModel, selectedCategory, attributeValues]);

  // ── Routing: which view to show ──

  // CeX cart item selected
  if (selectedCartItem?.isCustomCeXItem) {
    return (
      <CexProductView
        item={selectedCartItem}
        isRepricing={isRepricing}
        workspaceListAddButtonLabel={repriceLikeAddLabel}
        useVoucherOffers={useVoucherOffers}
        customerData={customerData}
        onSelectOfferForCartItem={handleSelectOfferForSelectedItem}
        onUpdateCartItemResearch={(itemId, type, data) => {
          const field =
            type === 'ebay'
              ? 'ebayResearchData'
              : type === 'cg' || type === 'cashGenerator'
                ? 'cgResearchData'
                : 'cashConvertersResearchData';
          useAppStore.getState().updateCartItem(itemId, { [field]: data });
          const cartItem = useAppStore.getState()[useAppStore.getState().mode === 'repricing' ? 'repricingCartItems' : 'cartItems']
            .find((i) => i.id === itemId);
          if (cartItem?.request_item_id) {
            const payload =
              type === 'ebay'
                ? {
                    raw_data: buildPersistedEbayRawData(data, {
                      categoryObject: cartItem.categoryObject,
                      referenceData: cartItem.referenceData,
                    }),
                  }
                : type === 'cg' || type === 'cashGenerator'
                  ? { cg_data: data }
                  : { cash_converters_data: data };
            updateRequestItemRawData(cartItem.request_item_id, payload).catch(() => {});
          }
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
        workspaceListAddButtonLabel={repriceLikeAddLabel}
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
        addActionLabel={isRepricing ? repriceLikeAddLabel : 'Add to Cart'}
        useVoucherOffers={useVoucherOffers}
        onSelectOfferForCartItem={handleSelectOfferForSelectedItem}
        onEbayResearchComplete={handleEbayResearchComplete}
        onDeselectCartItem={deselectCartItem}
        onOffersChange={handleEbayOffersChange}
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
        useVoucherOffers={useVoucherOffers}
      />
    );
  }

  if (selectedCartItem?.isCustomCashGeneratorItem) {
    return (
      <CashGeneratorCartItemView
        item={selectedCartItem}
        savedState={savedCgState}
        onDeselectCartItem={deselectCartItem}
        useVoucherOffers={useVoucherOffers}
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
        <ProductSelection
          key={selectedCategory?.id ?? 'no-cat'}
          availableModels={availableModels}
          setSelectedModel={setSelectedModel}
          isLoading={isLoadingModels}
        />
      </section>
    );
  }

  // ── Main product/eBay view ──
  return (
    <section
      className={`buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col buyer-panel-scroll ${
        isEbayCategory ? 'overflow-hidden' : 'overflow-y-auto'
      }`}
    >
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
                  <Icon name="sync" className="animate-spin text-xl text-brand-blue" />
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
              <h1 className="min-w-0 shrink-0 text-2xl font-extrabold tracking-tight text-gray-900 lg:max-w-[min(100%,26rem)] xl:max-w-[30rem]">
                {selectedModel?.name || selectedCategory.name}
                {Object.keys(attributeValues).length > 0 && (
                  <span> - {Object.values(attributeValues).filter((v) => v).join(' / ')}</span>
                )}
              </h1>
              {variant && !isRepricing && (
                isLoadingOffers ? (
                  <div className="flex min-w-0 flex-1 items-center py-2">
                    <Icon name="sync" className="mr-3 animate-spin text-2xl text-brand-blue" />
                    <span className="text-sm text-gray-600">Loading {useVoucherOffers ? 'voucher' : 'cash'} offers…</span>
                  </div>
                ) : isViewingCartItem ? (
                  <div className="min-w-0 flex-1">
                    <OfferSelection
                      className="min-w-0 w-full"
                      variant={variant}
                      offers={useVoucherOffers ? (selectedCartItem.voucherOffers?.length ? selectedCartItem.voucherOffers : offers) : (selectedCartItem.cashOffers?.length ? selectedCartItem.cashOffers : offers)}
                      referenceData={referenceData} offerType={useVoucherOffers ? 'voucher' : 'cash'}
                      initialSelectedOfferId={selectedCartItem?.selectedOfferId ?? null}
                      syncKey={`${selectedCartItem?.id ?? variant ?? 'item'}:${useVoucherOffers ? 'voucher' : 'cash'}`}
                      onAddToCart={handleSelectOfferForSelectedItem}
                      showAddActionCard={false}
                      toolbarLayout
                      toolbarFillWidth
                      hideSectionHeader
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <OfferSelection
                      className="min-w-0 w-full"
                      variant={variant}
                      offers={offers}
                      referenceData={referenceData}
                      offerType={useVoucherOffers ? 'voucher' : 'cash'}
                      onAddToCart={handleAddToCart}
                      toolbarLayout
                      toolbarFillWidth
                      hideSectionHeader
                    />
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
      
      {isEbayCategory && (
        <>
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40 shrink-0">
          <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-8">
          {!savedEbayState && cartItems.some((ci) => ci.isCustomEbayItem) && (
            <div className="mb-6 shrink-0 px-4 py-3 rounded-lg bg-brand-blue/5 border border-brand-blue/20 flex items-center gap-3">
              <span className="material-symbols-outlined text-brand-blue text-xl">info</span>
                <p className="text-sm text-brand-blue">Click on an item on the right to view its per-item research data.</p>
            </div>
          )}
          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            <EbayResearchForm
              key={savedEbayState ? 'ebay-with-data' : 'ebay-empty'}
              mode="page" category={EBAY_TOP_LEVEL_CATEGORY}
              onComplete={handleEbayResearchComplete} savedState={savedEbayState}
              initialHistogramState={false} showManualOffer={false}
              addActionLabel={isRepricing ? repriceLikeAddLabel : 'Add to Cart'} hideOfferCards={isRepricing}
              useVoucherOffers={useVoucherOffers}
              lineItemContext={selectedCartItem?.isCustomEbayItem ? selectedCartItem : null}
            />
          </div>
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
              <CexMarketPricingStrip
                variant={variant}
                competitorStats={[]}
                ourSalePrice={ourSalePrice}
                referenceData={referenceData}
                ebayData={ebayData}
                cashConvertersData={cashConvertersData}
                cgData={cgData}
                onOpenEbayResearch={() => setEbayModalOpen(true)}
                onOpenCashConvertersResearch={() => setCashConvertersModalOpen(true)}
                onOpenCashGeneratorResearch={() => setCashGeneratorModalOpen(true)}
                cexSku={variant}
                hideBuyInPrice={isRepricing}
              />
            )}

            {isRepricing && variant && !isAlreadyInCart && (
              <div className="flex justify-end pt-4">
                <Button variant="primary" icon="sell" className="px-6 py-3 font-bold uppercase tracking-tight" onClick={() => handleAddToCart(null)}>
                  {repriceLikeAddLabel}
                </Button>
              </div>
            )}
          </div>

          {isEbayModalOpen && (
            <EbayResearchForm
              mode="modal" category={selectedCategory} savedState={savedEbayState}
              initialHistogramState={false} showManualOffer={false} referenceData={referenceData}
              ourSalePrice={ourSalePrice} initialSearchQuery={variants.find(v => v.cex_sku === variant)?.title || selectedModel?.name || undefined}
              marketComparisonContext={buildMarketContext()}
              onComplete={(data) => { if (data?.cancel) { setEbayModalOpen(false); return; } handleEbayResearchComplete(data); setEbayModalOpen(false); }}
              hideOfferCards={isRepricing}
              hideAddAction={Boolean(selectedCartItem)}
              useVoucherOffers={useVoucherOffers}
              lineItemContext={selectedCartItem?.isCustomEbayItem ? selectedCartItem : null}
            />
          )}

          {isCashConvertersModalOpen && (
            <CashConvertersResearchForm
              mode="modal" category={selectedCategory} savedState={savedCashConvertersState}
              initialHistogramState={false} referenceData={referenceData} ourSalePrice={ourSalePrice}
              initialSearchQuery={ebayData?.searchTerm || variants.find(v => v.cex_sku === variant)?.title || selectedModel?.name || undefined}
              marketComparisonContext={buildMarketContext()}
              onComplete={(data) => { if (data?.cancel) { setCashConvertersModalOpen(false); return; } handleCashConvertersResearchComplete(data); setCashConvertersModalOpen(false); }}
              hideOfferCards={isRepricing}
              hideAddAction={Boolean(selectedCartItem)}
              useVoucherOffers={useVoucherOffers}
            />
          )}

          {isCashGeneratorModalOpen && (
            <CashGeneratorResearchForm
              mode="modal" category={selectedCategory} savedState={savedCgState}
              initialHistogramState={false} referenceData={referenceData} ourSalePrice={ourSalePrice}
              initialSearchQuery={
                cashConvertersData?.searchTerm ||
                ebayData?.searchTerm ||
                variants.find((v) => v.cex_sku === variant)?.title ||
                selectedModel?.name ||
                undefined
              }
              marketComparisonContext={buildMarketContext()}
              onComplete={(data) => {
                if (data?.cancel) { setCashGeneratorModalOpen(false); return; }
                handleCashGeneratorResearchComplete(data);
                setCashGeneratorModalOpen(false);
              }}
              hideOfferCards={isRepricing}
              hideAddAction={Boolean(selectedCartItem)}
              useVoucherOffers={useVoucherOffers}
            />
          )}
        </>
      )}

      {showDuplicateDialog && pendingDuplicateItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/40" aria-hidden />
          <div className="cg-animate-modal-panel relative z-10 bg-white rounded-2xl shadow-2xl p-7 w-full max-w-sm border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-brand-orange/10 p-2 rounded-lg">
                <span className="material-symbols-outlined text-brand-orange-hover text-xl">inventory_2</span>
              </div>
              <h2 className="text-base font-extrabold text-gray-900">Item Already in Cart</h2>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              <span className="font-semibold text-gray-900">{pendingDuplicateItem.title}</span> is already in your cart.
            </p>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={handleDuplicateIncreaseQty}
                className="w-full px-4 py-3 bg-brand-blue text-white rounded-xl font-bold hover:bg-brand-blue-hover transition-colors flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">add_circle</span>Increase Quantity
              </button>
              <button type="button" onClick={handleDuplicateAddNew}
                className="w-full px-4 py-3 border-2 border-brand-blue text-brand-blue rounded-xl font-bold hover:bg-brand-blue/5 transition-colors flex items-center justify-center gap-2">
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
