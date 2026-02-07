import React from 'react';
import {
  Icon,
  Button,
  Tab,
  Breadcrumb,
  SearchableDropdown
} from '@/components/ui/components';

import EbayResearchModal from "@/components/modals/EbayResearchModal.jsx";
import AttributeConfiguration from './AttributeConfiguration';
import MarketComparisonsTable from './MarketComparisonsTable';
import OfferSelection from './OfferSelection';

const ProductCategoryContent = ({
  selectedCategory,
  availableModels,
  selectedModel,
  setSelectedModel,
  handleAddToCart,
  attributes,
  attributeValues,
  handleAttributeChange,
  setAllAttributeValues,
  variant,
  setVariant,
  competitorStats,
  ourSalePrice,
  referenceData,
  ebayData,
  setEbayModalOpen,
  savedEbayState,
  isLoadingOffers,
  offers,
  useVoucherOffers,
  handleEbayResearchComplete,
  isEbayModalOpen: mainContentEbayModalOpen, // Renamed to avoid prop conflict with local state
  onEbayModalClose, // Renamed to avoid prop conflict with local state
  variants // Pass variants here
}) => {
  return (
    <>
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <Tab icon="info" label="Product Info" isActive={true} onClick={() => {}} /> {/* isActive always true for this component's scope */}
      </div>
      
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
          variants={variants} // Assuming variants is passed down, or available from context/hook
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
        open={mainContentEbayModalOpen} // Use the prop for modal open state
        onClose={onEbayModalClose} // Use the prop for modal close handler
        category={selectedCategory}
        savedState={savedEbayState}
        onResearchComplete={(data) => {
          handleEbayResearchComplete(data);
          onEbayModalClose(); // Use the prop for modal close handler
        }}
      />
    </>
  );
};

export default ProductCategoryContent;
