import React from 'react';
import { Tab } from '@/components/ui/components';
import EbayResearchForm from "@/components/forms/EbayResearchForm.jsx";

const EbayCategoryContent = ({
  selectedCategory,
  handleEbayResearchComplete,
  savedEbayState,
  activeTab,
  setActiveTab
}) => {
  return (
    <>
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
      </div>

      <div className="p-8">
        <EbayResearchForm
          mode="page"
          category={selectedCategory}
          onComplete={handleEbayResearchComplete}
          savedState={savedEbayState}
          initialHistogramState={false}
        />
      </div>
    </>
  );
};

export default EbayCategoryContent;
