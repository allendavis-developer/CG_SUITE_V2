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
  updateCartItemEbayData  // ✅ New prop to update cart items
}) => {
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

  // Load offers when variant changes
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
        setOffers(data.offers);
        setReferenceData(data.referenceData);
        
        if (data.referenceData && data.referenceData.cex_based_sale_price) {
          setOurSalePrice(data.referenceData.cex_based_sale_price.toString());
        }
        
        if (data.offers && data.offers.length > 0) {
          setSelectedOfferId(data.offers[0].id);
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
  }, [variant]);

  // Reset selected offer when variant changes
  useEffect(() => {
    setSelectedOfferId(null);
  }, [variant]);

  const handleAddToCart = () => {
    // We only need to check if the model and variant exist now
    if (!selectedModel || !variant) {
      alert('Please select a variant');
      return;
    }

    const selectedVariant = variants.find(v => v.cex_sku === variant);

    const normalizedOffers = offers.map(o => ({
      id: o.id,
      title: o.title,
      price: Number(o.price)
    }));

    const cartItem = {
      id: Date.now(),
      title: selectedModel.name,
      subtitle:
        selectedVariant?.title ||
        Object.values(attributeValues).filter(v => v).join(' / ') ||
        'Standard',
      // We keep the offers array for reference, but remove selectedOfferId
      offers: normalizedOffers,
      variantId: selectedVariant?.variant_id, // THIS is the key
      category: selectedCategory?.name,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      color: attributeValues.color || selectedVariant?.color,
      storage: attributeValues.storage || selectedVariant?.storage,
      network: attributeValues.network || selectedVariant?.network,
      ebayResearchData: savedEbayState || null,
      referenceData: referenceData
    };

    console.log('Adding to cart (Offers included as reference only):', cartItem);
    addToCart(cartItem);
  };

  const handleEbayResearchComplete = (data) => {
    console.log('eBay research done', data);
    setEbayData(data);
    setSavedEbayState(data);
    
    //  FIX: Find the actual variant object to get its variant_id
    const selectedVariant = variants.find(v => v.cex_sku === variant);
    const targetId = selectedVariant?.variant_id;

    if (targetId && typeof updateCartItemEbayData === 'function') {
      // Pass the numeric ID that matches what's in the cart
      updateCartItemEbayData(targetId, data);
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

            <OfferSelection
              variant={variant}
              offers={offers}
              ourSalePrice={ourSalePrice}
            />
          </div>

          <EbayResearchModal
            open={isEbayModalOpen}
            onClose={() => setEbayModalOpen(false)}
            category={selectedCategory}
            savedState={savedEbayState}
            onResearchComplete={(data) => {
            // 1. This handles local state AND the cart update logic
            handleEbayResearchComplete(data); 
            
            // 2. Close the modal
            setEbayModalOpen(false);
          }}
          />
        </>
      )}
    </section>
  );
};

export default MainContent;