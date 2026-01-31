import React, { useState, useEffect } from 'react';
import {
  Icon,
  Button,
  Tab,
  Breadcrumb,
  SearchableDropdown
} from '@/components/ui/components';

import EbayResearchModal from "@/components/modals/EbayResearchModal.jsx";
import EmptyState from './EmptyState';
import ProductSelection from './ProductSelection';
import AttributeConfiguration from './AttributeConfiguration';
import VariantSelector from './VariantSelector';
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
  addToCart 
}) => {
  const [activeTab, setActiveTab] = useState('info');
  const [variants, setVariants] = useState([]);
  const [competitorStats, setCompetitorStats] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [manualOfferPrice, setManualOfferPrice] = useState('');
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [ebayData, setEbayData] = useState(null);

  const {
    attributes,
    attributeValues,
    dependencies,
    variant,
    setVariant,
    handleAttributeChange
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
    if (!selectedModel || !selectedOfferId) {
      alert('Please select an offer to give the customer');
      return;
    }

    const selectedVariant = variants.find(v => v.cex_sku === variant);

    let cartItem;

    if (selectedOfferId === 'manual') {
      if (!manualOfferPrice || parseFloat(manualOfferPrice) <= 0) return;

      cartItem = {
        id: Date.now(),
        title: selectedModel.name,
        subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
        price: formatGBP(parseFloat(manualOfferPrice)),
        customerExpectation: 0,
        highlighted: false,
        offerId: 'manual',
        offerTitle: 'Manual Offer',
        variantId: selectedVariant?.variant_id
      };
    } else {
      const selectedOffer = offers.find(offer => offer.id === selectedOfferId);
      if (!selectedOffer) return;

      cartItem = {
        id: Date.now(),
        title: selectedModel.name,
        subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
        price: formatGBP(parseFloat(selectedOffer.price)),
        customerExpectation: 0,
        highlighted: false,
        offerId: selectedOffer.id,
        offerTitle: selectedOffer.title,
        variantId: selectedVariant?.variant_id
      };
    }

    addToCart(cartItem);
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
        <div className="flex items-center justify-center h-full">
          <div className="text-center px-8 py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-900/10 rounded-full mb-4">
              <Icon name="construction" className="text-blue-900 text-2xl" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Work in Progress</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              eBay Research functionality is currently under development
            </p>
          </div>
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
            />

            <VariantSelector
              attributes={attributes}
              attributeValues={attributeValues}
              variants={variants}
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

            <OfferSelection
              variant={variant}
              offers={offers}
              ourSalePrice={ourSalePrice}
              selectedOfferId={selectedOfferId}
              setSelectedOfferId={setSelectedOfferId}
              manualOfferPrice={manualOfferPrice}
              setManualOfferPrice={setManualOfferPrice}
            />
          </div>

          <EbayResearchModal
            open={isEbayModalOpen}
            onClose={() => setEbayModalOpen(false)}
            category={selectedCategory}
            onResearchComplete={(data) => {
              console.log('eBay research done', data);
              setEbayData(data);
              setEbayModalOpen(false);
            }}
          />
        </>
      )}
    </section>
  );
};

export default MainContent;