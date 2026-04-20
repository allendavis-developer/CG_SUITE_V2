import React from "react";
import AppHeader from "@/components/AppHeader";
import QuickRepriceModal from "@/components/modals/QuickRepriceModal";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import CexPencilRrpSourceModal from "@/components/modals/CexPencilRrpSourceModal";
import ResearchOverlayPanel from "../components/ResearchOverlayPanel";
import CgCategoryPickerModal from "@/components/modals/CgCategoryPickerModal";
import TinyModal from "@/components/ui/TinyModal";
import UploadBarcodeIntakeModal from "@/components/modals/UploadBarcodeIntakeModal.jsx";
import UploadNosposChangesModal from "@/components/modals/UploadNosposChangesModal.jsx";
import UploadConditionModal from "@/components/modals/UploadConditionModal.jsx";
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
import useAppStore from "@/store/useAppStore";
import { handlePriceSourceAsRrpOffersSource } from "../utils/priceSourceAsRrpOffers";
import { getAvailableRrpZonesForNegotiationItem } from "../utils/negotiationHelpers";
import { useListWorkspaceNegotiation } from "./useListWorkspaceNegotiation";
import UploadWebEposHubScreen from "./UploadWebEposHubScreen";

/**
 * Repricing / upload list UI — rendered from {@link Negotiation} when `listWorkspaceModuleKey` is set.
 * All behaviour lives in useListWorkspaceNegotiation; this file is presentation only.
 */
export default function ListWorkspaceNegotiation({ moduleKey = "repricing" }) {
  const w = useListWorkspaceNegotiation(moduleKey);

  /** Must run before any conditional return (Rules of Hooks). Uses `w` only. */
  const uploadListRowBarcodeModalLocked = React.useMemo(
    () =>
      Boolean(
        w.useUploadSessions &&
          w.barcodeModal &&
          (w.items || []).some(
            (i) => String(i.id) === String(w.barcodeModal.item.id) && !i.isRemoved
          )
      ),
    [w.useUploadSessions, w.barcodeModal, w.items]
  );

  const uploadGetDataFromDatabaseMenu = React.useMemo(() => {
    if (!w.useUploadSessions || !w.contextMenu?.item) return null;
    if (getAvailableRrpZonesForNegotiationItem(w.contextMenu.item).length > 0) return null;
    return {
      menuLabel: w.copy.uploadContextGetDataFromDatabase,
      flyoutTitle: w.copy.uploadContextDatabaseFlyoutTitle,
      loadingLabel: w.copy.uploadContextDatabaseCategoriesLoading,
      categories: w.uploadBuilderTopCategories,
      onPickCategory: (categoryId) => {
        useAppStore.getState().requestOpenBuilderTopCategory(categoryId);
        w.setContextMenu(null);
      },
    };
  }, [
    w.useUploadSessions,
    w.contextMenu,
    w.copy.uploadContextGetDataFromDatabase,
    w.copy.uploadContextDatabaseFlyoutTitle,
    w.copy.uploadContextDatabaseCategoriesLoading,
    w.uploadBuilderTopCategories,
    w.setContextMenu,
  ]);

  const [uploadNosposChangesModalItem, setUploadNosposChangesModalItem] = React.useState(null);
  const [uploadConditionModalItem, setUploadConditionModalItem] = React.useState(null);

  if (w.showWorkspaceLoader) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4"
        style={{ background: "var(--ui-bg)" }}
      >
        <span
          className="material-symbols-outlined animate-spin text-4xl"
          style={{ color: "var(--brand-blue)" }}
          aria-hidden
        >
          progress_activity
        </span>
        <p className="text-sm text-gray-500">{w.workspaceLoaderMessage}</p>
      </div>
    );
  }

  if (w.uploadWebEposHubActive) {
    return (
      <UploadWebEposHubScreen
        copy={w.copy}
        snapshot={w.webEposProductsSnapshot}
        scrapeError={w.webEposProductsScrapeError}
        onRetryScrape={() => w.bumpWebEposScrape()}
        onEnterUpload={w.enterUploadMainFlow}
      />
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
    uploadPostWebEposComplete,
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
    handleUploadTableItemNameChange,
    handleApplyRrpPriceSource,
    runUploadCategoryAndCgAfterValidRrp,
    addBarcode,
    removeBarcode,
    runNosposLookup,
    selectNosposResult,
    skipNosposLookup,
    handleProceed,
    handleRestartUploadInWorkspace,
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
    openBarcodePrintTab,
    cgCategoryRows,
    cgCategoryPickerModal,
    setCgCategoryPickerModal,
    handleOpenCgCategoryPicker,
    handleCgCategorySelected,
    uploadBarcodeIntakeOpen,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    beginUploadScanBarcodeLine,
    completeUploadBarcodeIntake,
    openAddMoreUploadBarcodeIntake,
    uploadListMissingRrp,
  } = w;

  const uploadRestartInWorkspaceAction =
    useUploadSessions && uploadPostWebEposComplete ? handleRestartUploadInWorkspace : undefined;

  const uploadIntakeEmbeddedBarcode =
    useUploadSessions &&
    uploadBarcodeIntakeOpen &&
    barcodeModal &&
    uploadScanSlotIds.includes(barcodeModal.item.id);

  return (
    <div className="text-sm overflow-hidden min-h-screen flex flex-col" style={{ background: "#f8f9fa", color: "#1a1a1a" }}>
      <NegotiationDocumentHead />

      <AppHeader
        buyerControls={{
          enabled: !useUploadSessions || !uploadBarcodeIntakeOpen,
          repricingWorkspace: true,
          reserveWorkspaceRightForRepriceRail: features.hasRepriceListSidebar,
          selectedCategory,
          onCategorySelect: selectCategory,
          onAddFromCeX: (opts) => handleAddFromCeX({ showNotification, awaitPricing: false, ...opts }),
          isCeXLoading: cexLoading,
          enableNegotiationItemBuilder:
            !useUploadSessions || (!uploadBarcodeIntakeOpen && uploadPendingSlotIds.length > 0),
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
        {useUploadSessions ? (
          <UploadBarcodeIntakeModal
            open={uploadBarcodeIntakeOpen}
            slotIds={uploadScanSlotIds}
            barcodes={barcodes}
            isItemReadyForRepricing={isItemReadyForRepricing}
            onDone={completeUploadBarcodeIntake}
            inlineBarcodeEditor={
              uploadIntakeEmbeddedBarcode ? (
                <RepricingBarcodeModal
                  embedded
                  embeddedBare
                  composerFirst
                  hideNosposSkip
                  allowRemoveBarcode
                  barcodeModal={barcodeModal}
                  barcodes={barcodes}
                  barcodeInput={barcodeInput}
                  setBarcodeInput={setBarcodeInput}
                  nosposLookups={nosposLookups}
                  nosposResultsPanel={nosposResultsPanel}
                  setNosposResultsPanel={setNosposResultsPanel}
                  completedBarcodes={completedBarcodes}
                  maxBarcodesPerItem={maxBarcodesPerItem}
                  uploadIntakePriorSlotIds={uploadScanSlotIds.filter(
                    (id) => String(id) !== String(barcodeModal.item.id)
                  )}
                  onAddBarcode={addBarcode}
                  onRemoveBarcode={removeBarcode}
                  onRunNosposLookup={runNosposLookup}
                  onSelectNosposResult={selectNosposResult}
                  onSkipNosposLookup={skipNosposLookup}
                />
              ) : null
            }
          />
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <NegotiationTablesSection
            mode="negotiate"
            actualRequestId={null}
            researchSandboxBookedView={false}
            pageGutter={useUploadSessions ? 'wide' : 'default'}
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
            showCgCategoryColumn={useUploadSessions}
            cgCategoriesResults={cgCategoryRows}
            onOpenCgCategoryPicker={useUploadSessions ? handleOpenCgCategoryPicker : undefined}
            hideQuantityColumn={useUploadSessions}
            hideCexVoucherCashColumns={useUploadSessions}
            hideOfferColumns={!features.hasOffers}
            hideCustomerExpectation={!features.hasCustomer}
            salePriceLabel={features.salePriceLabel}
            showUploadNosposStockColumns={useUploadSessions}
            renderRowSuffix={renderBarcodeCell}
            onUploadTableItemNameChange={useUploadSessions ? handleUploadTableItemNameChange : undefined}
            onOpenUploadNosposChanges={
              useUploadSessions ? (row) => setUploadNosposChangesModalItem(row) : undefined
            }
            itemsHeadingEndAction={
              useUploadSessions && !uploadBarcodeIntakeOpen && activeItems.length > 0 ? (
                <button
                  type="button"
                  onClick={openAddMoreUploadBarcodeIntake}
                  title={copy.uploadAddMoreBarcodesTitle}
                  className="inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-xs font-semibold tracking-tight transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                  style={{ borderColor: "var(--brand-blue)", color: "var(--brand-blue)" }}
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden>
                    barcode_scanner
                  </span>
                  {copy.uploadAddMoreBarcodes}
                </button>
              ) : null
            }
          />
          </div>

          {features.hasRepriceListSidebar ? (
            <RepricingBarcodeSidebar
              variant="sidebar"
              workspace={copy.workspace}
              activeItems={activeItems}
              uploadScanSlotCount={
                useUploadSessions
                  ? uploadBarcodeIntakeOpen
                    ? uploadScanSlotIds.length
                    : uploadPendingSlotIds.length
                  : undefined
              }
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
              uploadBarcodeIntakeOpen={useUploadSessions ? uploadBarcodeIntakeOpen : false}
              verifyHintOverride={uploadListMissingRrp ? copy.uploadEveryRrpRequiredHint : null}
              onRestartInWorkspace={uploadRestartInWorkspaceAction}
              restartInWorkspaceLabel={useUploadSessions ? copy.uploadRestartInWorkspace : null}
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
            enableUploadRepricingCustomSalePrice
          />
        </div>

        {cgCategoryPickerModal ? (
        <CgCategoryPickerModal
          open
          rows={cgCategoryRows || []}
          currentCgCategoryId={cgCategoryPickerModal.currentCgCategoryId}
          onClose={() => setCgCategoryPickerModal(null)}
          onSelect={(row) => handleCgCategorySelected(cgCategoryPickerModal.item, row)}
        />
      ) : null}

      {!features.hasRepriceListSidebar ? (
          <RepricingBarcodeSidebar
            variant="actionsOnly"
            workspace={copy.workspace}
            activeItems={activeItems}
            uploadScanSlotCount={
              useUploadSessions
                ? uploadBarcodeIntakeOpen
                  ? uploadScanSlotIds.length
                  : uploadPendingSlotIds.length
                : undefined
            }
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
            uploadBarcodeIntakeOpen={useUploadSessions ? uploadBarcodeIntakeOpen : false}
            verifyHintOverride={uploadListMissingRrp ? copy.uploadEveryRrpRequiredHint : null}
            onRestartInWorkspace={uploadRestartInWorkspaceAction}
            restartInWorkspaceLabel={useUploadSessions ? copy.uploadRestartInWorkspace : null}
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
              successMessageRrpOnly: useUploadSessions ? copy.uploadRrpUpdatedFromSource : undefined,
              onAfterRrpOnlyApplied: useUploadSessions
                ? (next) => queueMicrotask(() => runUploadCategoryAndCgAfterValidRrp(next))
                : undefined,
            })}
          getDataFromDatabase={uploadGetDataFromDatabaseMenu}
          onChangeUploadCondition={useUploadSessions ? () => setUploadConditionModalItem(contextMenu.item) : null}
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
        onRepricingPriceCommitted={
          useUploadSessions
            ? (row) => queueMicrotask(() => runUploadCategoryAndCgAfterValidRrp(row))
            : undefined
        }
      />

      <CexPencilRrpSourceModal
        modalState={cexPencilRrpSourceModal}
        items={items}
        setItems={setItems}
        onClose={() => setCexPencilRrpSourceModal(null)}
        useVoucherOffers={false}
        showNotification={showNotification}
        onAfterCexRrpCommit={
          useUploadSessions
            ? (row) => queueMicrotask(() => runUploadCategoryAndCgAfterValidRrp(row))
            : undefined
        }
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
          onCancel={
            copy.workspace === "upload"
              ? undefined
              : async (cartKey) => {
                  try {
                    await cancelNosposRepricing(cartKey);
                    showNotification(copy.cancelOk, "info");
                  } catch {
                    showNotification(copy.cancelErr, "error");
                  }
                }
          }
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
        barcodeModal={uploadIntakeEmbeddedBarcode ? null : barcodeModal}
        barcodes={barcodes}
        barcodeInput={barcodeInput}
        setBarcodeInput={setBarcodeInput}
        nosposLookups={nosposLookups}
        nosposResultsPanel={nosposResultsPanel}
        setNosposResultsPanel={setNosposResultsPanel}
        completedBarcodes={completedBarcodes}
        maxBarcodesPerItem={maxBarcodesPerItem}
        zClass="z-[120]"
        allowRemoveBarcode={!uploadListRowBarcodeModalLocked}
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

      <UploadNosposChangesModal
        open={Boolean(uploadNosposChangesModalItem)}
        onClose={() => setUploadNosposChangesModalItem(null)}
        rows={uploadNosposChangesModalItem?.uploadNosposStockFromBarcode?.changeLog}
        titleLine={uploadNosposChangesModalItem?.variantName || uploadNosposChangesModalItem?.title || ''}
      />

      <UploadConditionModal
        open={Boolean(uploadConditionModalItem)}
        item={uploadConditionModalItem}
        onClose={() => setUploadConditionModalItem(null)}
        onSave={(changes) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === uploadConditionModalItem?.id ? { ...item, ...changes } : item
            )
          );
          setUploadConditionModalItem(null);
        }}
      />
    </div>
  );
}
