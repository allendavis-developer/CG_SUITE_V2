import React, { useCallback, useEffect } from 'react';
import ResearchFormShell from './ResearchFormShell';
import { useCashConvertersResearch } from '@/pages/buyer/hooks/useCashConvertersResearch';

/**
 * Cash Converters Research Form Component
 * 
 * Thin wrapper that connects Cash Converters-specific data hook to the generic research shell.
 * For now, uses eBay data structure - can be replaced with Cash Converters specific logic later.
 */
export default function CashConvertersResearchForm({ 
  onComplete, 
  category, 
  mode = "modal", 
  savedState = null, 
  initialHistogramState = null, 
  readOnly = false 
}) {
  const research = useCashConvertersResearch(category, savedState);

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

  // Custom controls for Cash Converters (e.g., "Behave as generic" checkbox)
  const customControls = (
    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
      <input
        type="checkbox"
        className="rounded border-gray-300 text-blue-900 focus:ring-blue-900"
        checked={research.behaveAsGeneric}
        onChange={readOnly ? undefined : (e) => research.setBehaveAsGeneric(e.target.checked)}
        disabled={readOnly}
      />
      <span>Behave as generic search</span>
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
      
      // Configuration
      mode={mode}
      readOnly={readOnly}
      basicFilterOptions={[]}
      searchPlaceholder="Search Cash Converters listings..."
      headerTitle="Cash Converters Market Research"
      headerSubtitle="Real-time valuation lookup"
      headerIcon="store"
      customControls={customControls}
    />
  );
}
