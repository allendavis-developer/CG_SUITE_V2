import React, { useState, useEffect } from 'react';
import {
  Icon,
  Button,
  Tab,
  Breadcrumb,
  SearchableDropdown
} from '@/components/ui/components';

import EbayResearchModal from "@/components/modals/EbayResearchModal.jsx";
import EbayResearchForm from "@/components/forms/EbayResearchForm.jsx";
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
  customerData,
  intent,
  request,
  setRequest

}) => {
  // Determine if we should use voucher offers based on transaction type
  const useVoucherOffers = customerData?.transactionType === 'store_credit';
  
  const [activeTab, setActiveTab] = useState('info');
  const [variants, setVariants] = useState([]);
  const [competitorStats, setCompetitorStats] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [ebayData, setEbayData] = useState(null);
  const [savedEbayState, setSavedEbayState] = useState(null);

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
          voucher_offers: data.voucher_offers
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

  const createOrAppendRequestItem = async ({ variantId, rawData }) => {
    const itemPayload = {
      variant: variantId ?? null,   // 👈 key line
      expectation_gbp: null,
      raw_data: rawData,
      notes: ''
    };

    if (!request) {
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
        variantId: null, // ✅ eBay items have no variant
        request_item_id: null
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
            />


            {savedEbayState && savedEbayState.listings && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-900 p-2 rounded-lg">
                      <Icon name="analytics" className="text-yellow-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-blue-900">
                        Previous eBay Research Available
                      </h3>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Search: <span className="font-bold">{savedEbayState.searchTerm}</span>
                        {' • '}
                        <span className="font-bold">{savedEbayState.listings.length}</span> listings
                        {' • '}
                        Median: <span className="font-bold">£{savedEbayState.stats?.median}</span>
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    icon="open_in_new"
                    onClick={() => setEbayModalOpen(true)}
                  >
                    Reopen Research
                  </Button>
                </div>
              </div>
            )}

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

          <EbayResearchModal
            open={isEbayModalOpen}
            onClose={() => setEbayModalOpen(false)}
            category={selectedCategory}
            savedState={savedEbayState}
            onResearchComplete={(data) => {
              handleEbayResearchComplete(data);
              setEbayModalOpen(false);
            }}
          />
        </>
      )}
    </section>
  );
};

export default MainContent;