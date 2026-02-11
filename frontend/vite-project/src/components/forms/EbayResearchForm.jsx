import React, { useCallback, useEffect } from 'react';
import ResearchFormShell from './ResearchFormShell';
import { useEbayResearch } from '@/pages/buyer/hooks/useEbayResearch';

/**
 * eBay Research Form Component
 * 
 * Thin wrapper that connects eBay-specific data hook to the generic research shell.
 * All eBay-specific logic (URL building, category mapping, scraping) is in useEbayResearch hook.
 * All UI/presentation logic is in ResearchFormShell component.
 */
export default function EbayResearchForm({ 
  onComplete, 
  category, 
  mode = "modal", 
  savedState = null, 
  initialHistogramState = null, 
  readOnly = false,
  showManualOffer = false 
}) {
  const research = useEbayResearch(category, savedState);

  // Handle initialHistogramState prop
  useEffect(() => {
    if (initialHistogramState !== null) {
      research.setShowHistogram(initialHistogramState);
    } else if (savedState?.showHistogram !== undefined) {
      research.setShowHistogram(savedState.showHistogram);
    } else if (mode === "modal") {
      research.setShowHistogram(true);
    }
  }, [initialHistogramState, savedState?.showHistogram, mode, research]);

  // Handle completion
  const handleComplete = useCallback(() => {
    onComplete?.(research.getCurrentState());
  }, [onComplete, research]);

  // Custom controls for eBay (e.g., "Behave like eBay" checkbox)
  const customControls = (
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
        checked={research.behaveAsEbay}
        onChange={readOnly ? undefined : (e) => research.setBehaveAsEbay(e.target.checked)}
              disabled={readOnly}
            />
            <span>Behave like eBay</span>
            <span className="text-[10px] text-gray-500">(ignore category-based search)</span>
          </label>
  );

  return (
    <ResearchFormShell
      // Data
      searchTerm={research.searchTerm}
      listings={research.listings}
      displayedListings={research.displayedListings}
      stats={research.stats}
      displayedStats={research.displayedStats}
      filterOptions={research.filterOptions}
      selectedFilters={research.selectedFilters}
      loading={research.loading}
      showHistogram={research.showHistogram}
      drillHistory={research.drillHistory}
      buyOffers={research.buyOffers}
      manualOffer={research.manualOffer}
      
      // Handlers
      onSearchTermChange={research.setSearchTerm}
      onSearch={research.handleSearch}
      onBasicFilterChange={research.handleBasicFilterChange}
      onApiFilterChange={research.handleApiFilterChange}
      onShowHistogramChange={research.setShowHistogram}
      onDrillDown={research.handleDrillDown}
      onZoomOut={research.handleZoomOut}
      onNavigateToDrillLevel={research.handleNavigateToDrillLevel}
      onComplete={handleComplete}
      onManualOfferChange={showManualOffer ? research.setManualOffer : null}
      
      // Configuration
      mode={mode}
                  readOnly={readOnly}
      basicFilterOptions={["Completed & Sold", "Used", "UK Only"]}
      searchPlaceholder="Search eBay listings..."
      headerTitle="eBay Market Research"
      headerSubtitle="Real-time valuation lookup"
      headerIcon="search_insights"
      customControls={customControls}
      allowHistogramToggle={initialHistogramState !== false}
      showManualOffer={showManualOffer}
    />
  );
}
