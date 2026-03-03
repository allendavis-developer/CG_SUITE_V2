import React from 'react';
import { Icon, SearchableDropdown } from '@/components/ui/components';

/**
 * Product selection state component
 */
const ProductSelection = ({ availableModels, setSelectedModel, isLoading = false }) => {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-2xl px-8 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-900/10 rounded-full mb-4">
            <Icon name="search" className="text-blue-900 text-2xl" />
          </div>
          <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Select a Product</h3>
          <p className="text-sm text-gray-500">
            Search and select the product model to continue
          </p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Icon name="sync" className="animate-spin text-3xl text-blue-900 mb-3" />
            <p className="text-sm text-gray-500">Loading models for this category…</p>
          </div>
        ) : (
          <SearchableDropdown
            value="Search for a product..."
            options={availableModels.length > 0 ? availableModels.map(m => m.name) : ['No models available']}
            onChange={(name) => {
              const model = availableModels.find(m => m.name === name);
              if (model) setSelectedModel(model);
            }}
            autoFocus={true}
          />
        )}
      </div>
    </div>
  );
};

export default ProductSelection;