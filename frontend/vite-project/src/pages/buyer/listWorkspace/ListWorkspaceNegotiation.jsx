import React, { useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import QuickRepriceModal from "@/components/modals/QuickRepriceModal";
import SalePriceConfirmModal from "@/components/modals/SalePriceConfirmModal";
import CexPencilRrpSourceModal from "@/components/modals/CexPencilRrpSourceModal";
import ResearchOverlayPanel from "../components/ResearchOverlayPanel";
import CgCategoryPickerModal from "@/components/modals/CgCategoryPickerModal";
import TinyModal from "@/components/ui/TinyModal";
import UploadBarcodeIntakeModal from "@/components/modals/UploadBarcodeIntakeModal.jsx";
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

  const uploadHeadNosposStockUrl = useMemo(() => {
    const head = w.uploadPendingSlotIds?.[0];
    if (!head) return "";
    const url = w.nosposLookups?.[`${head}_0`]?.stockUrl;
    return typeof url === "string" ? url.trim() : "";
  }, [w.uploadPendingSlotIds, w.nosposLookups]);

  /** Must run before any conditional return (Rules of Hooks). Uses `w` only. */
  const uploadListRowBarcodeModalLocked = useMemo(
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
    handleViewWebEposCategories,
    viewWebEposCategoriesDisabled,
    openBarcodePrintTab,
    cgCategoryRows,
    cgCategoryPickerModal,
    setCgCategoryPickerModal,
    handleOpenCgCategoryPicker,
    handleCgCategorySelected,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadCurrentBarcodeLabel,
    uploadPendingStockDetails,
    beginUploadScanBarcodeLine,
    completeUploadBarcodeIntake,
  } = w;

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
            {useUploadSessions &&
            !uploadBarcodeIntakeOpen &&
            (uploadPendingSlotIds.length > 0 || (uploadBarcodeIntakeDone && uploadPendingSlotIds.length === 0)) ? (
              <div
                className="w-full shrink-0 border-b px-4 py-5 sm:px-8 sm:py-6"
                style={{
                  borderColor: 'var(--brand-blue-alpha-15)',
                  background: 'linear-gradient(105deg, #f0f5fb 0%, #f8fafc 45%, #eef6ff 100%)',
                }}
              >
                {uploadPendingSlotIds.length > 0 ? (
                  <div className="flex w-full min-w-0 flex-col gap-5">
                    <div className="w-full min-w-0">
                      <div className="flex w-full flex-wrap items-start gap-4 sm:gap-5">
                        <span
                          className="material-symbols-outlined shrink-0 text-4xl sm:text-5xl md:text-6xl text-brand-blue opacity-90"
                          aria-hidden
                        >
                          barcode_scanner
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 sm:text-sm">
                            Current barcode — next in queue
                          </p>
                          {uploadHeadNosposStockUrl ? (
                            <a
                              href={uploadHeadNosposStockUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 block w-full break-all font-mono text-3xl font-bold leading-none tracking-tight text-brand-blue underline-offset-4 transition-opacity hover:underline hover:opacity-90 sm:text-4xl md:text-5xl"
                              title="Open this stock on NosPos"
                            >
                              {uploadCurrentBarcodeLabel || '—'}
                            </a>
                          ) : (
                            <p className="mt-2 w-full break-all font-mono text-3xl font-bold leading-none tracking-tight text-brand-blue sm:text-4xl md:text-5xl">
                              {uploadCurrentBarcodeLabel || '—'}
                            </p>
                          )}
                          <p className="mt-4 w-full text-base leading-relaxed text-slate-700 sm:text-lg">
                            <span className="font-semibold text-slate-900">
                              The next product you add from the header will use this barcode.
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div
                      className="w-full min-w-0 rounded-xl border border-white/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur-sm sm:px-6 sm:py-5"
                      style={{ borderColor: 'var(--brand-blue-alpha-15)' }}
                    >
                      <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 sm:text-xs">
                        NosPos stock for this barcode
                      </p>
                      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm sm:text-base">
                        {uploadPendingStockDetails?.loading ? (
                          <span className="text-slate-600">Loading from NosPos…</span>
                        ) : null}
                        {uploadPendingStockDetails?.error && !uploadPendingStockDetails?.loading ? (
                          <span className="text-amber-900">{uploadPendingStockDetails.error}</span>
                        ) : null}
                        {!uploadPendingStockDetails?.loading && uploadPendingStockDetails?.name ? (
                          <>
                            <span
                              className="max-w-full truncate font-semibold text-brand-blue sm:max-w-[min(100%,20rem)]"
                              title={uploadPendingStockDetails.name}
                            >
                              {uploadPendingStockDetails.name}
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span>
                              <span className="text-slate-500">Created</span>{' '}
                              <span className="font-medium text-slate-900">{uploadPendingStockDetails.createdAt || '—'}</span>
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span>
                              <span className="text-slate-500">Bought by</span>{' '}
                              <span className="font-medium text-slate-900">{uploadPendingStockDetails.boughtBy || '—'}</span>
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span>
                              <span className="text-slate-500">Cost</span>{' '}
                              <span className="font-mono font-semibold text-slate-900">
                                {(() => {
                                  const v = uploadPendingStockDetails.costPrice;
                                  if (v == null || v === '') return '—';
                                  const s = String(v).trim();
                                  return s.startsWith('£') ? s : `£${s}`;
                                })()}
                              </span>
                            </span>
                            <span className="text-slate-300" aria-hidden>
                              ·
                            </span>
                            <span>
                              <span className="text-slate-500">Retail</span>{' '}
                              <span className="font-mono font-semibold text-slate-900">
                                {(() => {
                                  const v = uploadPendingStockDetails.retailPrice;
                                  if (v == null || v === '') return '—';
                                  const s = String(v).trim();
                                  return s.startsWith('£') ? s : `£${s}`;
                                })()}
                              </span>
                            </span>
                          </>
                        ) : !uploadPendingStockDetails?.loading && !uploadPendingStockDetails?.error ? (
                          <span className="text-slate-500">NosPos details will appear here after the line is verified.</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 sm:text-sm">Barcode queue</p>
                    <p className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">Queue clear</p>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-700 sm:text-base">
                      Every verified barcode is already on the table. Use the header to add another capture line if you need
                      more barcodes in the queue.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
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
              onViewWebEposProducts={useUploadSessions ? handleViewWebEposProducts : undefined}
              viewWebEposProductsDisabled={useUploadSessions ? viewWebEposProductsDisabled : undefined}
              onViewWebEposCategories={useUploadSessions ? handleViewWebEposCategories : undefined}
              viewWebEposCategoriesDisabled={useUploadSessions ? viewWebEposCategoriesDisabled : undefined}
              uploadBarcodeIntakeOpen={useUploadSessions ? uploadBarcodeIntakeOpen : false}
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
            onViewWebEposProducts={useUploadSessions ? handleViewWebEposProducts : undefined}
            viewWebEposProductsDisabled={useUploadSessions ? viewWebEposProductsDisabled : undefined}
            onViewWebEposCategories={useUploadSessions ? handleViewWebEposCategories : undefined}
            viewWebEposCategoriesDisabled={useUploadSessions ? viewWebEposCategoriesDisabled : undefined}
            uploadBarcodeIntakeOpen={useUploadSessions ? uploadBarcodeIntakeOpen : false}
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
    </div>
  );
}
