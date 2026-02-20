import { useState } from 'react';
import { createRequest, addRequestItem, updateRequestItemRawData } from '@/services/api';

export const useCartItemCreation = ({
  customerData,
  intent,
  request,
  setRequest,
  addToCart,
  updateCartItemEbayData, // This is for updating existing cart items' ebay data
  selectedModel,
  variant,
  offers,
  referenceData,
  attributeValues,
  ourSalePrice,
  selectedCategory,
  variants: allVariants, // Renamed to avoid conflict with local 'variant'
  useVoucherOffers,
}) => {
  const [ebayData, setEbayData] = useState(null);
  const [savedEbayState, setSavedEbayState] = useState(null);

  const createOrAppendRequestItem = async ({ variantId, rawData }) => {
    const itemPayload = {
      variant: variantId ?? null,
      expectation_gbp: null,
      raw_data: rawData,
      notes: ''
    };

    if (!request) {
      // Validate required fields before creating request
      if (!customerData?.id) {
        throw new Error('Customer must be selected before adding items');
      }
      if (!intent) {
        throw new Error('Transaction type must be selected before adding items');
      }
      
      const payload = {
        customer_id: customerData.id,
        intent,
        item: itemPayload
      };

      const newRequest = await createRequest(payload);
      setRequest(newRequest);
      return newRequest.items[0].request_item_id;
    } else {
      const created = await addRequestItem(request.request_id, itemPayload);
      return created.request_item_id;
    }
  };

  const handleAddToCart = async () => {
    if (!selectedModel || !variant) {
      alert('Please select a variant');
      return;
    }

    if (!offers || offers.length === 0) {
      alert('No offers available. Please wait for offers to load.');
      return;
    }

    const selectedVariant = allVariants.find(v => v.cex_sku === variant);

    const normalizedOffers = offers.map(o => ({
      id: o.id,
      title: o.title,
      price: Number(o.price)
    }));

    const cashOffers = referenceData?.cash_offers?.map(o => ({
      id: o.id,
      title: o.title,
      price: Number(o.price)
    })) || [];

    const voucherOffers = referenceData?.voucher_offers?.map(o => ({
      id: o.id,
      title: o.title,
      price: Number(o.price)
    })) || [];

    const cartItem = {
      id: Date.now(),
      title: selectedModel.name,
      subtitle:
        selectedVariant?.title ||
        Object.values(attributeValues).filter(v => v).join(' / ') ||
        'Standard',
      offers: normalizedOffers,
      cashOffers: cashOffers,
      voucherOffers: voucherOffers,
      quantity: 1,
      variantId: selectedVariant?.variant_id,
      category: selectedCategory?.name,
      categoryObject: selectedCategory,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      color: attributeValues.color || selectedVariant?.color,
      storage: attributeValues.storage || selectedVariant?.storage,
      network: attributeValues.network || selectedVariant?.network,
      ourSalePrice: ourSalePrice ? Number(ourSalePrice) : null,
      cexSellPrice: referenceData?.cex_sale_price ? Number(referenceData.cex_sale_price) : null,
      cexBuyPrice: referenceData?.cex_tradein_cash ? Number(referenceData.cex_tradein_cash) : null,
      cexVoucherPrice: referenceData?.cex_tradein_voucher ? Number(referenceData.cex_tradein_voucher) : null,
      ebayResearchData: savedEbayState || null,
      referenceData: referenceData,
      request_item_id: null,
      offerType: useVoucherOffers ? 'voucher' : 'cash'
    };

    try {
      const requestItemId = await createOrAppendRequestItem({
        variantId: cartItem.variantId,
        rawData: cartItem.ebayResearchData
      });

      cartItem.request_item_id = requestItemId;
      addToCart(cartItem);

    } catch (err) {
      console.error('Failed to add item to request:', err);
      alert('Failed to add item to request. Check console for details.');
    }
  };

  const handleEbayResearchComplete = async (data) => {
    setEbayData(data);
    setSavedEbayState(data);

    const isEbayCategory = selectedCategory?.path?.some(p => p.toLowerCase() === 'ebay') ||
                           selectedCategory?.name.toLowerCase() === 'ebay';

    if (isEbayCategory) {
      const apiFilterValues = Object.values(data.selectedFilters.apiFilters).flat();
      const basicFilterValues = data.selectedFilters.basic;
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0
        ? allFilters.join(' / ')
        : (data.searchTerm || 'No filters applied');

      const customCartItem = {
        id: Date.now(),
        title: data.searchTerm || "eBay Research Item",
        subtitle: filterSubtitle,
        quantity: 1,
        category: selectedCategory?.name,
        categoryObject: selectedCategory,
        offers: data.buyOffers.map((o, idx) => ({
          id: `ebay-${Date.now()}-${idx}`,
          title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
          price: Number(o.price)
        })),
        ebayResearchData: data,
        isCustomEbayItem: true,
        variantId: null,
        request_item_id: null
      };

      try {
        const requestItemId = await createOrAppendRequestItem({
          variantId: null,
          rawData: data
        });

        customCartItem.request_item_id = requestItemId;
        addToCart(customCartItem);

      } catch (err) {
        console.error('Failed to add eBay item to request:', err);
        alert('Failed to add eBay item to request. Check console for details.');
      }

    } else {
      const selectedVariant = allVariants.find(v => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      
      if (targetId && typeof updateCartItemEbayData === 'function') {
        updateCartItemEbayData(targetId, data);
      }
    }
  };

  return { handleAddToCart, handleEbayResearchComplete, ebayData, savedEbayState, setSavedEbayState, setEbayData };
};
