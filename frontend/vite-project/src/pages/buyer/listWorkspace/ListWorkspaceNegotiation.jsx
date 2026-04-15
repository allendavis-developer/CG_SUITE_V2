import React from "react";
import AppHeader from "@/components/AppHeader";
import QuickRepriceModal from "@/components/modals/QuickRepriceModal";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import CexPencilRrpSourceModal from "@/components/modals/CexPencilRrpSourceModal";
import ResearchOverlayPanel from "../components/ResearchOverlayPanel";
import TinyModal from "@/components/ui/TinyModal";
import NegotiationDocumentHead from "../components/negotiation/NegotiationDocumentHead";
import NegotiationTablesSection from "../components/negotiation/NegotiationTablesSection";
import NegotiationRowContextMenu from "../components/NegotiationRowContextMenu";
import RepricingBarcodeSidebar from "../components/repricing/RepricingBarcodeSidebar";
import RepricingJobOverlay from "../components/repricing/RepricingJobOverlay";
import {
  UnverifiedBarcodeModal,
  AmbiguousBarcodeModal,
  ZeroSalePriceModal,
  RepricingBarcodeModal,
} from "../components/repricing/RepricingCompletionModals";
import { cancelNosposRepricing } from "@/services/extensionClient";
import { handlePriceSourceAsRrpOffersSource } from "../utils/priceSourceAsRrpOffers";
import { useListWorkspaceNegotiation } from "./useListWorkspaceNegotiation";

/**
 * Repricing / upload list UI — rendered from {@link Negotiation} when `listWorkspaceModuleKey` is set.
 * All behaviour lives in useListWorkspaceNegotiation; this file is presentation only.
 */
export default function ListWorkspaceNegotiation({ moduleKey = "repricing" }) {
  const w = useListWorkspaceNegotiation(moduleKey);

  if (w.showWorkspaceLoader) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--ui-bg)" }}>
        <p className="text-sm text-gray-500">{w.workspaceLoaderMessage}</p>
      </div>
    );
  }

  const {
    features,
    copy,
    useUploadSessions,
    items,
    setItems,
    selectedCategory,
    selectCategory,
    handleAddFromCeX,
    cexLoading,
    cexProductData,
    setCexProductData,
    clearCexProduct,
    headerWorkspaceOpen,
    activeItems,
    barcodes,
    barcodeModal,
    setBarcodeModal,
    barcodeInput,
    setBarcodeInput,
    nosposLookups,
    nosposResultsPanel,
    setNosposResultsPanel,
    completedBarcodes,
    researchItem,
    cashConvertersResearchItem,
    cgResearchItem,
    salePriceConfirmModal,
    setSalePriceConfirmModal,
    handleResearchComplete,
    handleCashConvertersResearchComplete,
    handleCashGeneratorResearchComplete,
    handleResearchItemCategoryResolved,
    isRepricingFinished,
    completedItemsData,
    ambiguousBarcodeModal,
    setAmbiguousBarcodeModal,
    unverifiedModal,
    setUnverifiedModal,
    repricingJob,
    zeroSalePriceModal,
    setZeroSalePriceModal,
    contextMenu,
    setContextMenu,
    cexPencilRrpSourceModal,
    setCexPencilRrpSourceModal,
    activeCartKey,
    isItemReadyForRepricing,
    allItemsReadyForRepricing,
    isBackgroundRepricingRunning,
    handleRemoveItem,
    handleAddRepricingItem,
    handleEbayResearchCompleteFromHeader,
    handleRefreshCeXData,
    handleOurSalePriceChange,
    handleOurSalePriceBlur,
    handleOurSalePriceFocus,
    handleApplyRrpPriceSource,
    addBarcode,
    removeBarcode,
    runNosposLookup,
    selectNosposResult,
    skipNosposLookup,
    handleProceed,
    handleConfirmNewRepricing,
    handleRetryAmbiguousBarcodes,
    renderBarcodeCell,
    showNotification,
    maxBarcodesPerItem,
    showNewRepricingConfirm,
    setShowNewRepricingConfirm,
    setResearchItem,
    setCashConvertersResearchItem,
    setCgResearchItem,
    isQuickRepriceOpen,
    setIsQuickRepriceOpen,
    handleQuickRepriceItems,
    handleViewWebEposProducts,
    viewWebEposProductsDisabled,
    openBarcodePrintTab,
  } = w;

  return (
    <div className="text-sm overflow-hidden min-h-screen flex flex-col" style={{ background: "#f8f9fa", color: "#1a1a1a" }}>
      <NegotiationDocumentHead />

      <AppHeader
        buyerControls={{
          enabled: true,
          repricingWorkspace: true,
          reserveWorkspaceRightForRepriceRail: features.hasRepriceListSidebar,
          selectedCategory,
          onCategorySelect: selectCategory,
          onAddFromCeX: (opts) => handleAddFromCeX({ showNotification, awaitPricing: false, ...opts }),
          isCeXLoading: cexLoading,
          enableNegotiationItemBuilder: true,
          useVoucherOffers: false,
          onAddNegotiationItem: handleAddRepricingItem,
          onEbayResearchComplete: handleEbayResearchCompleteFromHeader,
          cexProductData,
          setCexProductData,
          clearCexProduct,
          existingItems: items,
          showNotification,
          ...(features.hasQuickReprice ? { onQuickReprice: () => setIsQuickRepriceOpen(true) } : {}),
        }}
      />

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NegotiationTablesSection
            mode="negotiate"
            actualRequestId={null}
            researchSandboxBookedView={false}
            jewelleryNegotiationItems={[]}
            mainNegotiationItems={items}
            handleSelectOffer={() => {}}
            setContextMenu={setContextMenu}
            setItemOfferModal={() => {}}
            handleCustomerExpectationChange={() => {}}
            handleJewelleryItemNameChange={() => {}}
            handleJewelleryWeightChange={() => {}}
            handleJewelleryCoinUnitsChange={() => {}}
            blockedOfferSlots={null}
            handleBlockedOfferClick={() => {}}
            parkExcludedItems={new Set()}
            handleToggleParkExcludeItem={() => {}}
            handleQuantityChange={() => {}}
            handleOurSalePriceChange={handleOurSalePriceChange}
            handleOurSalePriceBlur={handleOurSalePriceBlur}
            handleOurSalePriceFocus={handleOurSalePriceFocus}
            handleRefreshCeXData={handleRefreshCeXData}
            handleApplyRrpPriceSource={handleApplyRrpPriceSource}
            handleApplyOffersPriceSource={null}
            setResearchItem={setResearchItem}
            setCashConvertersResearchItem={setCashConvertersResearchItem}
            setCgResearchItem={setCgResearchItem}
            useVoucherOffers={false}
            nosposCategoriesResults={null}
            nosposCategoryMappings={null}
            onOpenNosposRequiredFieldsEditor={null}
            onOpenNosposCategoryPicker={null}
            hideNosposRequiredColumn
            hideNosposCategoryColumn={useUploadSessions}
            hideQuantityColumn={useUploadSessions}
            hideCexVoucherCashColumns={useUploadSessions}
            hideOfferColumns={!features.hasOffers}
            hideCustomerExpectation={!features.hasCustomer}
            salePriceLabel={features.salePriceLabel}
            renderRowSuffix={renderBarcodeCell}
          />

          {features.hasRepriceListSidebar ? (
            <RepricingBarcodeSidebar
              variant="sidebar"
              workspace={copy.workspace}
              activeItems={activeItems}
              barcodes={barcodes}
              isItemReadyForRepricing={isItemReadyForRepricing}
              allItemsReadyForRepricing={allItemsReadyForRepricing}
              isRepricingFinished={isRepricingFinished}
              isBackgroundRepricingRunning={isBackgroundRepricingRunning}
              completedItemsData={completedItemsData}
              headerWorkspaceOpen={headerWorkspaceOpen}
              researchItem={researchItem}
              cashConvertersResearchItem={cashConvertersResearchItem}
              cgResearchItem={cgResearchItem}
              onProceed={handleProceed}
              onOpenBarcodePrintTab={openBarcodePrintTab}
              onNewRepricing={() => setShowNewRepricingConfirm(true)}
              onViewWebEposProducts={useUploadSessions ? handleViewWebEposProducts : undefined}
              viewWebEposProductsDisabled={useUploadSessions ? viewWebEposProductsDisabled : undefined}
            />
          ) : null}

          <ResearchOverlayPanel
            items={items}
            researchItem={researchItem}
            cashConvertersResearchItem={cashConvertersResearchItem}
            cgResearchItem={cgResearchItem}
            onResearchComplete={handleResearchComplete}
            onCashConvertersResearchComplete={handleCashConvertersResearchComplete}
            onCashGeneratorResearchComplete={handleCashGeneratorResearchComplete}
            hideOfferCards={features.hideOfferCards}
            onCategoryResolved={handleResearchItemCategoryResolved}
            reserveRightSidebar={features.hasRepriceListSidebar}
          />
        </div>

        {!features.hasRepriceListSidebar ? (
          <RepricingBarcodeSidebar
            variant="actionsOnly"
            workspace={copy.workspace}
            activeItems={activeItems}
            barcodes={barcodes}
            isItemReadyForRepricing={isItemReadyForRepricing}
            allItemsReadyForRepricing={allItemsReadyForRepricing}
            isRepricingFinished={isRepricingFinished}
            isBackgroundRepricingRunning={isBackgroundRepricingRunning}
            completedItemsData={completedItemsData}
            headerWorkspaceOpen={headerWorkspaceOpen}
            researchItem={researchItem}
            cashConvertersResearchItem={cashConvertersResearchItem}
            cgResearchItem={cgResearchItem}
            onProceed={handleProceed}
            onOpenBarcodePrintTab={openBarcodePrintTab}
            onNewRepricing={() => setShowNewRepricingConfirm(true)}
            onViewWebEposProducts={useUploadSessions ? handleViewWebEposProducts : undefined}
            viewWebEposProductsDisabled={useUploadSessions ? viewWebEposProductsDisabled : undefined}
          />
        ) : null}
      </main>

      {contextMenu && (
        <NegotiationRowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          zone={contextMenu.zone}
          removeLabel={copy.contextRemoveLabel}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveItem(contextMenu.item)}
          onUseAsRrpOffersSource={() =>
            handlePriceSourceAsRrpOffersSource(contextMenu.item, contextMenu.zone, {
              showNotification,
              setItems,
              useVoucherOffers: false,
              repricingRrpOnly: true,
            })}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={false}
        priceLabel={features.salePriceLabel}
        repricingMode
        showNotification={showNotification}
      />

      <CexPencilRrpSourceModal
        modalState={cexPencilRrpSourceModal}
        items={items}
        setItems={setItems}
        onClose={() => setCexPencilRrpSourceModal(null)}
        useVoucherOffers={false}
        showNotification={showNotification}
      />

      {showNewRepricingConfirm && (
        <TinyModal title={copy.newConfirmTitle} onClose={() => setShowNewRepricingConfirm(false)}>
          <p className="text-xs text-slate-600 mb-5">{copy.newConfirmBody}</p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: "white", color: "var(--text-muted)", border: "1px solid var(--ui-border)" }}
              onClick={() => setShowNewRepricingConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: "var(--brand-orange)", color: "var(--brand-blue)" }}
              onClick={handleConfirmNewRepricing}
            >
              {copy.newConfirmYes}
            </button>
          </div>
        </TinyModal>
      )}

      {isBackgroundRepricingRunning && (
        <RepricingJobOverlay
          workspace={copy.workspace}
          repricingJob={repricingJob}
          activeCartKey={activeCartKey}
          onCancel={async (cartKey) => {
            try {
              await cancelNosposRepricing(cartKey);
              showNotification(copy.cancelOk, "info");
            } catch {
              showNotification(copy.cancelErr, "error");
            }
          }}
        />
      )}

      <UnverifiedBarcodeModal entries={unverifiedModal?.entries} onClose={() => setUnverifiedModal(null)} />

      <AmbiguousBarcodeModal
        modal={ambiguousBarcodeModal}
        onClose={() => setAmbiguousBarcodeModal(null)}
        onChange={(index, value) => {
          setAmbiguousBarcodeModal((prev) => {
            if (!prev) return prev;
            const entries = prev.entries.map((entry, i) =>
              i === index ? { ...entry, replacementBarcode: value } : entry
            );
            return { ...prev, entries };
          });
        }}
        onRetry={handleRetryAmbiguousBarcodes}
      />

      <ZeroSalePriceModal modal={zeroSalePriceModal} onClose={() => setZeroSalePriceModal(null)} />

      <RepricingBarcodeModal
        barcodeModal={barcodeModal}
        barcodes={barcodes}
        barcodeInput={barcodeInput}
        setBarcodeInput={setBarcodeInput}
        nosposLookups={nosposLookups}
        nosposResultsPanel={nosposResultsPanel}
        setNosposResultsPanel={setNosposResultsPanel}
        completedBarcodes={completedBarcodes}
        maxBarcodesPerItem={maxBarcodesPerItem}
        onClose={() => {
          setBarcodeModal(null);
          setNosposResultsPanel(null);
        }}
        onAddBarcode={addBarcode}
        onRemoveBarcode={removeBarcode}
        onRunNosposLookup={runNosposLookup}
        onSelectNosposResult={selectNosposResult}
        onSkipNosposLookup={skipNosposLookup}
      />

      {features.hasQuickReprice && isQuickRepriceOpen ? (
        <QuickRepriceModal onClose={() => setIsQuickRepriceOpen(false)} onAddItems={handleQuickRepriceItems} />
      ) : null}
    </div>
  );
}
