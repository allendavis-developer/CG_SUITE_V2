import React, { useState, useEffect } from 'react';
import {
  Icon,
  Button,
  Tab,
  Breadcrumb,
  SearchableDropdown
} from '@/components/ui/components';

import EbayResearchForm from "@/components/forms/EbayResearchForm.jsx";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm.jsx";
import EmptyState from './EmptyState';
import ProductSelection from './ProductSelection';
import AttributeConfiguration from './AttributeConfiguration';
import MarketComparisonsTable from './MarketComparisonsTable';
import OfferSelection from './OfferSelection';

import { useProductAttributes } from '@/pages/buyer/hooks/useProductAttributes';
import { fetchCompetitorStats, fetchVariantPrices } from '@/services/api';
import { createRequest, addRequestItem, updateRequestItemRawData } from '@/services/api';

import { formatGBP } from '@/utils/helpers';

/**
 * Main content area component
 */
const MainContent = ({ 
  selectedCategory, 
  availableModels, 
  selectedModel, 
  setSelectedModel, 
  addToCart,
  updateCartItemEbayData,
  updateCartItemCashConvertersData,
  customerData,
  intent,
  request,
  setRequest,
  selectedCartItem = null  // <--- new: cart item to populate details from

}) => {
  // Determine if we should use voucher offers based on transaction type
  const useVoucherOffers = customerData?.transactionType === 'store_credit';
  
  const [activeTab, setActiveTab] = useState('info');
  const [variants, setVariants] = useState([]);
  const [competitorStats, setCompetitorStats] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [isCashConvertersModalOpen, setCashConvertersModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [ebayData, setEbayData] = useState(null);
  const [savedEbayState, setSavedEbayState] = useState(null);
  const [cashConvertersData, setCashConvertersData] = useState(null);
  const [savedCashConvertersState, setSavedCashConvertersState] = useState(null);

  const {
    attributes,
    attributeValues,
    dependencies,
    variant,
    setVariant,
    handleAttributeChange,
    setAllAttributeValues
  } = useProductAttributes(selectedModel?.product_id, variants);

  // Reset state when category changes
  useEffect(() => {
    setVariants([]);
    
    if (selectedCategory?.name.toLowerCase() === 'ebay') {
      setActiveTab('research');
    } else {
      setActiveTab('info');
    }
  }, [selectedCategory]);

  // Load variants when attributes are loaded
  useEffect(() => {
    const loadVariants = async () => {
      if (!selectedModel?.product_id) {
        setVariants([]);
        return;
      }

      try {
        const res = await fetch(`http://127.0.0.1:8000/api/product-variants/?product_id=${selectedModel.product_id}`);
        if (!res.ok) throw new Error('Network response was not ok');
        const data = await res.json();
        setVariants(data.variants || []);
      } catch (err) {
        console.error('Error fetching variants:', err);
        setVariants([]);
      }
    };

    loadVariants();
  }, [selectedModel]);

  // Load competitor stats when variant changes
  useEffect(() => {
    if (!variant) {
      setCompetitorStats([]);
      return;
    }

    const selectedVariant = variants.find(v => v.cex_sku === variant);
    if (!selectedVariant) return;

    const loadStats = async () => {
      setIsLoadingStats(true);
      const data = await fetchCompetitorStats(
        selectedVariant.cex_sku,
        selectedVariant.title
      );
      setCompetitorStats(data);
      setIsLoadingStats(false);
    };

    loadStats();
  }, [variant, variants]);

  // Load offers when variant changes - now transaction-type aware
  useEffect(() => {
    if (!variant) {
      setOffers([]);
      setReferenceData(null);
      setOurSalePrice('');
      setEbayData(null);
      setSavedEbayState(null);
      setCashConvertersData(null);
      setSavedCashConvertersState(null);
      return;
    }

    const loadOffers = async () => {
      setIsLoadingOffers(true);
      
      try {
        const data = await fetchVariantPrices(variant);
        
        // Select appropriate offers based on transaction type for display
        const selectedOffers = useVoucherOffers ? data.voucher_offers : data.cash_offers;
        setOffers(selectedOffers);
        
        // Store the full data for later use
        setReferenceData({
          ...data.referenceData,
          cash_offers: data.cash_offers,
          voucher_offers: data.voucher_offers,
          our_sale_price: data.referenceData?.cex_based_sale_price || null
        });
        
        if (data.referenceData && data.referenceData.cex_based_sale_price) {
          setOurSalePrice(data.referenceData.cex_based_sale_price.toString());
        }
        
        if (selectedOffers && selectedOffers.length > 0) {
          setSelectedOfferId(selectedOffers[0].id);
        }
      } catch (err) {
        console.error('Error fetching offers:', err);
        setOffers([]);
        setReferenceData(null);
        setOurSalePrice('');
      } finally {
        setIsLoadingOffers(false);
      }
    };

    loadOffers();
  }, [variant, useVoucherOffers]); // Add useVoucherOffers to dependencies

  // Step 1: Set model when cart item is selected
  useEffect(() => {
    if (!selectedCartItem) {
      return;
    }

    // Skip eBay-only items (they have no variant)
    if (selectedCartItem.isCustomEbayItem) {
      // For eBay items, restore the eBay research data and switch to research tab
      if (selectedCartItem.ebayResearchData) {
        setSavedEbayState(selectedCartItem.ebayResearchData);
        setEbayData(selectedCartItem.ebayResearchData);
        setActiveTab('research');
      }
      return;
    }

    // Skip Cash Converters-only items (they have no variant)
    if (selectedCartItem.isCustomCashConvertersItem) {
      if (selectedCartItem.cashConvertersResearchData) {
        setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData);
        setCashConvertersData(selectedCartItem.cashConvertersResearchData);
        setActiveTab('research');
      }
      return;
    }

    // Find and set the model (this will trigger variants to load)
    const modelToSet = availableModels.find(m => m.name === selectedCartItem.model);
    if (modelToSet) {
      // Always set the model to ensure variants reload, even if it's the same model
      setSelectedModel(modelToSet);
    }
  }, [selectedCartItem, availableModels]);

  // Step 2: Set variant and attributes once variants are loaded
  useEffect(() => {
    if (!selectedCartItem || !variants || variants.length === 0) {
      return;
    }

    // Skip eBay-only items
    if (selectedCartItem.isCustomEbayItem) {
      return;
    }

    // Skip Cash Converters-only items
    if (selectedCartItem.isCustomCashConvertersItem) {
      return;
    }

    // Find the variant by variantId
    const variantToSet = variants.find(v => v.variant_id === selectedCartItem.variantId);
    if (variantToSet) {
      // Set attribute values from the variant's attribute_values
      // This should happen BEFORE setting the variant to avoid race conditions
      if (variantToSet.attribute_values) {
        setAllAttributeValues(variantToSet.attribute_values);
      }
      
      // Then set the variant
      setVariant(variantToSet.cex_sku);
    }

    // Restore eBay research data if available
    if (selectedCartItem.ebayResearchData) {
      setSavedEbayState(selectedCartItem.ebayResearchData);
      setEbayData(selectedCartItem.ebayResearchData);
    }

    // Restore Cash Converters research data if available
    if (selectedCartItem.cashConvertersResearchData) {
      setSavedCashConvertersState(selectedCartItem.cashConvertersResearchData);
      setCashConvertersData(selectedCartItem.cashConvertersResearchData);
    }

    // Restore reference data and offers if available (don't wait for variant to load)
    if (selectedCartItem.referenceData) {
      setReferenceData(selectedCartItem.referenceData);
      
      // Set offers based on transaction type
      const displayOffers = useVoucherOffers 
        ? selectedCartItem.voucherOffers || selectedCartItem.offers 
        : selectedCartItem.cashOffers || selectedCartItem.offers;
      
      if (displayOffers) {
        setOffers(displayOffers);
      }
      
      // Restore sale price
      if (selectedCartItem.ourSalePrice) {
        setOurSalePrice(selectedCartItem.ourSalePrice.toString());
      }
    }
  }, [selectedCartItem, variants, useVoucherOffers]);

  const createOrAppendRequestItem = async ({ variantId, rawData }) => {
    const itemPayload = {
      variant: variantId ?? null,   // 👈 key line
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


  // Reset selected offer when variant changes
  useEffect(() => {
    setSelectedOfferId(null);
  }, [variant]);

  const handleAddToCart = async () => {
    if (!selectedModel || !variant) {
      alert('Please select a variant');
      return;
    }

    if (!offers || offers.length === 0) {
      alert('No offers available. Please wait for offers to load.');
      return;
    }

    const selectedVariant = variants.find(v => v.cex_sku === variant);

    // Get the currently displayed offers (based on transaction type)
    const normalizedOffers = offers.map(o => ({
      id: o.id,
      title: o.title,
      price: Number(o.price)
    }));

    // Store both cash and voucher offers for flexibility in negotiation
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
      offers: normalizedOffers, // Currently selected offers (cash or voucher)
      cashOffers: cashOffers, // Store cash offers separately
      voucherOffers: voucherOffers, // Store voucher offers separately
      quantity: 1,
      variantId: selectedVariant?.variant_id,
      category: selectedCategory?.name,
      categoryObject: selectedCategory,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      color: attributeValues.color || selectedVariant?.color,
      storage: attributeValues.storage || selectedVariant?.storage,
      network: attributeValues.network || selectedVariant?.network,
      
      // Added specific price fields for easy access
      ourSalePrice: ourSalePrice ? Number(ourSalePrice) : null,
      cexSellPrice: referenceData?.cex_sale_price ? Number(referenceData.cex_sale_price) : null,
      cexBuyPrice: referenceData?.cex_tradein_cash ? Number(referenceData.cex_tradein_cash) : null,
      cexVoucherPrice: referenceData?.cex_tradein_voucher ? Number(referenceData.cex_tradein_voucher) : null,
      ebayResearchData: savedEbayState || null,
      cashConvertersResearchData: savedCashConvertersState || null,
      referenceData: referenceData,
      request_item_id: null,
      offerType: useVoucherOffers ? 'voucher' : 'cash' // Track which type of offers were used
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

    if (isEbayCategory) {
      // eBay-only items: variant is null
      const apiFilterValues = Object.values(data.selectedFilters.apiFilters).flat();
      const basicFilterValues = data.selectedFilters.basic;
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0 
        ? allFilters.join(' / ') 
        : 'No filters applied';

      const cashOffers = data.buyOffers.map((o, idx) => ({
          id: `ebay-cash-${Date.now()}-${idx}`, // Make IDs unique for cash
          title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
          price: Number(o.price)
      }));

      const voucherOffers = cashOffers.map(offer => ({
          id: `ebay-voucher-${offer.id}`, // Make IDs unique for voucher
          title: offer.title,
          price: Number((offer.price * 1.10).toFixed(2)) // 10% more, rounded to 2 decimal places
      }));

      const customCartItem = {
        id: Date.now(),
        title: data.searchTerm || "eBay Research Item",
        subtitle: filterSubtitle,
        quantity: 1,
        category: selectedCategory?.name,
        categoryObject: selectedCategory,
        offers: useVoucherOffers ? voucherOffers : cashOffers, // Default to appropriate offer type
        cashOffers: cashOffers, // Store cash offers
        voucherOffers: voucherOffers, // Store voucher offers
        ebayResearchData: data,
        isCustomEbayItem: true,
        variantId: null, // ✅ eBay items have no variant
        request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice ? Number(data.stats.suggestedPrice) : null
      };

      try {
        const requestItemId = await createOrAppendRequestItem({
          variantId: null,   // 👈 this is the ONLY difference for eBay
          rawData: data
        });

        customCartItem.request_item_id = requestItemId;
        addToCart(customCartItem);

      } catch (err) {
        console.error('Failed to add eBay item to request:', err);
        alert('Failed to add eBay item to request. Check console for details.');
      }

    } else {
      // Non-eBay items with eBay research: update raw_data
      const selectedVariant = variants.find(v => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      
      if (targetId && typeof updateCartItemEbayData === 'function') {
        // Update cart item locally
        updateCartItemEbayData(targetId, data);
        
        //  Update raw_data on backend if item already exists
        // Find the cart item with this variant to get request_item_id
        // This assumes you have access to cart items or can pass request_item_id
        // For now, we'll update via the parent component's callback
      }
    }
  };

  const handleCashConvertersResearchComplete = async (data) => {
    setCashConvertersData(data);
    setSavedCashConvertersState(data);

    // Check if this is a Cash Converters-only category
    const isCashConvertersCategory = selectedCategory?.path?.some(p => p.toLowerCase() === 'cash converters') || 
                                     selectedCategory?.name.toLowerCase() === 'cash converters';

    if (isCashConvertersCategory) {
      // Cash Converters-only items: variant is null, add to cart
      const apiFilterValues = Object.values(data.selectedFilters?.apiFilters || {}).flat();
      const basicFilterValues = data.selectedFilters?.basic || [];
      const allFilters = [...basicFilterValues, ...apiFilterValues].filter(Boolean);
      const filterSubtitle = allFilters.length > 0 
        ? allFilters.join(' / ') 
        : 'No filters applied';

      const cashOffers = data.buyOffers.map((o, idx) => ({
          id: `cc-cash-${Date.now()}-${idx}`, // Make IDs unique for cash
          title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
          price: Number(o.price)
      }));

      const voucherOffers = cashOffers.map(offer => ({
          id: `cc-voucher-${offer.id}`, // Make IDs unique for voucher
          title: offer.title,
          price: Number((offer.price * 1.10).toFixed(2)) // 10% more, rounded to 2 decimal places
      }));

      const customCartItem = {
        id: Date.now(),
        title: data.searchTerm || "Cash Converters Research Item",
        subtitle: filterSubtitle,
        quantity: 1,
        category: selectedCategory?.name,
        categoryObject: selectedCategory,
        offers: useVoucherOffers ? voucherOffers : cashOffers, // Default to appropriate offer type
        cashOffers: cashOffers, // Store cash offers
        voucherOffers: voucherOffers, // Store voucher offers
        cashConvertersResearchData: data,
        isCustomCashConvertersItem: true,
        variantId: null,
        request_item_id: null,
        ourSalePrice: data.stats?.suggestedPrice ? Number(data.stats.suggestedPrice) : null
      };

      try {
        const requestItemId = await createOrAppendRequestItem({
          variantId: null,
          rawData: data
        });

        customCartItem.request_item_id = requestItemId;
        addToCart(customCartItem);

      } catch (err) {
        console.error('Failed to add Cash Converters item to request:', err);
        alert('Failed to add Cash Converters item to request. Check console for details.');
      }
    } else {
      // Non-CC items with Cash Converters research: update existing cart item
      const selectedVariant = variants.find(v => v.cex_sku === variant);
      const targetId = selectedVariant?.variant_id;
      
      if (targetId && typeof updateCartItemCashConvertersData === 'function') {
        updateCartItemCashConvertersData(targetId, data);
      }
    }
  };

  // Special handling for selected eBay cart items
  if (selectedCartItem?.isCustomEbayItem) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <div className="flex items-center gap-3 py-4">
            <div className="bg-blue-900 p-1.5 rounded">
              <span className="material-symbols-outlined text-yellow-400 text-sm">analytics</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-blue-900">eBay Research Item</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved research</p>
            </div>
          </div>
        </div>
        
        <div className="p-8">
          {selectedCartItem.ebayResearchData ? (
            <EbayResearchForm
              key={selectedCartItem.id}
              mode="page"
              category={selectedCategory}
              onComplete={handleEbayResearchComplete}
              savedState={selectedCartItem.ebayResearchData}
              initialHistogramState={false}
              showManualOffer={false}
            />
          ) : (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-4xl text-gray-300 mb-2">search_off</span>
              <p className="text-sm text-gray-500">No research data available</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Special handling for selected Cash Converters cart items
  if (selectedCartItem?.isCustomCashConvertersItem) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <div className="flex items-center gap-3 py-4">
            <div className="bg-blue-900 p-1.5 rounded">
              <span className="material-symbols-outlined text-yellow-400 text-sm">store</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-blue-900">Cash Converters Research Item</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved research</p>
            </div>
          </div>
        </div>
        
        <div className="p-8">
          {savedCashConvertersState ? (
            <CashConvertersResearchForm
              mode="page"
              category={selectedCartItem.categoryObject || { name: 'Cash Converters', path: ['Cash Converters'] }}
              onComplete={() => {}} // Read-only mode
              savedState={savedCashConvertersState}
              initialHistogramState={false}
              readOnly={true}
            />
          ) : (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-4xl text-gray-300 mb-2">search_off</span>
              <p className="text-sm text-gray-500">No research data available</p>
            </div>
          )}
        </div>
      </section>
    );
  }
  
  if (!selectedCategory) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <EmptyState />
      </section>
    );
  }

  const isEbayCategory = selectedCategory?.path?.some(p => p.toLowerCase() === 'ebay') || 
                        selectedCategory?.name.toLowerCase() === 'ebay';
  
  if (!selectedModel && !isEbayCategory) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <ProductSelection 
          availableModels={availableModels} 
          setSelectedModel={setSelectedModel} 
        />
      </section>
    );
  }

  return (
    <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
      {!isEbayCategory && (
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <Tab icon="info" label="Product Info" isActive={activeTab === 'info'} onClick={() => setActiveTab('info')} />
        </div>
      )}
      
      {isEbayCategory && (
        <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
        </div>
      )}

      {isEbayCategory && (
        <div className="p-8">
          <EbayResearchForm
            mode="page"
            category={selectedCategory}
            onComplete={handleEbayResearchComplete}
            savedState={savedEbayState}
            initialHistogramState={false}
            showManualOffer={false}
          />
        </div>
      )}

      {!isEbayCategory && (
        <>
          <div className="px-8 py-6 border-b border-gray-200 bg-gray-50/50">
            <Breadcrumb items={selectedCategory.path} />

            <div className="mb-4">
              <SearchableDropdown
                value={selectedModel?.name || 'Select a model'}
                options={availableModels.length > 0 ? availableModels.map(m => m.name) : ['No models available']}
                onChange={(name) => {
                  const model = availableModels.find(m => m.name === name);
                  if (model) setSelectedModel(model);
                }}
              />
            </div>

            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {selectedModel?.name || selectedCategory.name}
                  {Object.keys(attributeValues).length > 0 && (
                    <span> - {Object.values(attributeValues).filter(v => v).join(' / ')}</span>
                  )}
                </h1>
              </div>
              <Button
                variant="primary"
                icon="add_shopping_cart"
                className="px-8 py-4 text-base font-bold"
                onClick={handleAddToCart}
              >
                Add to Cart
              </Button>
            </div>
          </div>

          <div className="p-8 space-y-8">
            <AttributeConfiguration
              attributes={attributes}
              attributeValues={attributeValues}
              variants={variants}
              handleAttributeChange={handleAttributeChange}
              setAllAttributeValues={setAllAttributeValues}
              variant={variant}
              setVariant={setVariant}
            />

            <MarketComparisonsTable
              variant={variant}
              competitorStats={competitorStats}
              ourSalePrice={ourSalePrice}
              referenceData={referenceData}
              ebayData={ebayData}
              setEbayModalOpen={setEbayModalOpen}
              cashConvertersData={cashConvertersData}
              setCashConvertersModalOpen={setCashConvertersModalOpen}
            />

            {isLoadingOffers ? (
              <div className="flex items-center justify-center py-8">
                <Icon name="sync" className="animate-spin text-2xl text-blue-900 mr-3" />
                <span className="text-sm text-gray-600">
                  Loading {useVoucherOffers ? 'voucher' : 'cash'} offers...
                </span>
              </div>
            ) : (
              <OfferSelection
                variant={variant}
                offers={offers}
                referenceData={referenceData}
                offerType={useVoucherOffers ? 'voucher' : 'cash'}
              />
            )}
          </div>

          {isEbayModalOpen && (
            <EbayResearchForm
              mode="modal"
              category={selectedCategory}
              savedState={savedEbayState}
              initialHistogramState={false}
              showManualOffer={false}
              onComplete={(data) => {
                handleEbayResearchComplete(data);
                setEbayModalOpen(false);
              }}
            />
          )}

          {isCashConvertersModalOpen && (
            <CashConvertersResearchForm
              mode="modal"
              category={selectedCategory}
              savedState={savedCashConvertersState}
              initialHistogramState={false}
              onComplete={(data) => {
                handleCashConvertersResearchComplete(data);
                setCashConvertersModalOpen(false);
              }}
            />
          )}
        </>
      )}
    </section>
  );
};

export default MainContent;