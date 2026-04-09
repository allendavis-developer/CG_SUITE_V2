import React from 'react';
import JewelleryReferencePricesModal from '@/components/jewellery/JewelleryReferencePricesModal';
import NewCustomerDetailsModal from '@/components/modals/NewCustomerDetailsModal';
import SalePriceConfirmModal from '@/components/modals/SalePriceConfirmModal';
import TinyModal from '@/components/ui/TinyModal';
import { revokeManualOfferAuthorisationIfSwitchingAway } from '@/utils/customerOfferRules';
import { TargetOfferModal, ItemOfferModal, SeniorMgmtModal, MarginResultModal, BlockedOfferAuthModal } from '../NegotiationModals';
import NegotiationRowContextMenu from '../NegotiationRowContextMenu';
import ParkAgreementProgressModal from '../ParkAgreementProgressModal';
import MissingNosposRequiredFieldsModal from '@/components/modals/MissingNosposRequiredFieldsModal';
import MissingNosposCategoryModal from '@/components/modals/MissingNosposCategoryModal';
import NosposCategoryPickerModal from '@/components/modals/NosposCategoryPickerModal';
import NosposRequiredFieldsEditorModal from '@/components/modals/NosposRequiredFieldsEditorModal';
import { handlePriceSourceAsRrpOffersSource } from '../../utils/priceSourceAsRrpOffers';

export default function NegotiationModalsLayer({
  contextMenu,
  setContextMenu,
  handleRemoveFromNegotiation,
  showNotification,
  setItems,
  useVoucherOffers,
  showTargetModal,
  setShowTargetModal,
  targetOffer,
  setTargetOffer,
  itemOfferModal,
  setItemOfferModal,
  items,
  applyManualOffer,
  seniorMgmtModal,
  setSeniorMgmtModal,
  marginResultModal,
  setMarginResultModal,
  blockedOfferModal,
  setBlockedOfferModal,
  customerData,
  customerOfferRulesData,
  markItemSlotAuthorised,
  salePriceConfirmModal,
  setSalePriceConfirmModal,
  showNewCustomerDetailsModal,
  setShowNewCustomerDetailsModal,
  setPendingFinishPayload,
  handleNewCustomerDetailsSubmit,
  showNewBuyConfirm,
  setShowNewBuyConfirm,
  handleConfirmNewBuy,
  parkProgressModal,
  setParkProgressModal,
  parkNosposTabRef,
  handleParkFieldPatch,
  handleRetryParkLine,
  parkRetryBusyUi,
  persistedNosposAgreementId,
  handleViewParkedAgreement,
  handleDownloadParkLog,
  showJewelleryReferenceModal,
  setShowJewelleryReferenceModal,
  jewelleryReferenceScrape,
  missingRequiredNosposModal,
  handleMissingNosposRecheckContinue,
  missingGateItems,
  missingGateNosposCategories,
  missingGateNosposMappings,
  onSaveMissingGateNosposFields,
  nosposRequiredFieldsEditor,
  nosposRequiredEditorLiveItem,
  nosposSchemaCategories,
  nosposSchemaMappings,
  actualRequestId,
  onCloseNosposRequiredFieldsEditor,
  onSaveNosposRequiredFieldsFromModal,
  nosposRequiredFieldsRequireCompletion = false,
  /** When true, park modal hides per-line &ldquo;Retry / re-sync&rdquo; in Progress and under each item table. */
  parkHidePerItemTableRetry = false,
  // NosPos category picker
  nosposCategoryPickerModal,
  onCloseCategoryPicker,
  onNosposCategorySelected,
  nosposPickerCategories,
  // Missing NosPos category gate
  missingNosposCategoryModal,
  handleMissingNosposCategoryRecheckContinue,
  onOpenCategoryPickerForItem,
}) {
  return (
    <>
      {contextMenu && (
        <NegotiationRowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          zone={contextMenu.zone}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveFromNegotiation(contextMenu.item)}
          onUseAsRrpOffersSource={() =>
            handlePriceSourceAsRrpOffersSource(contextMenu.item, contextMenu.zone, {
              showNotification,
              setItems,
              useVoucherOffers,
            })}
        />
      )}

      {showTargetModal && (
        <TargetOfferModal targetOffer={targetOffer} onSetTarget={setTargetOffer} onClose={() => setShowTargetModal(false)} />
      )}

      {itemOfferModal && (
        <ItemOfferModal
          item={itemOfferModal.item}
          items={items}
          targetOffer={targetOffer}
          useVoucherOffers={useVoucherOffers}
          onApply={(it, perUnit) => applyManualOffer(it, perUnit, itemOfferModal.seniorMgmtOverride ?? null)}
          onClose={() => setItemOfferModal(null)}
          showNotification={showNotification}
        />
      )}

      {seniorMgmtModal && (
        <SeniorMgmtModal
          item={seniorMgmtModal.item}
          proposedPerUnit={seniorMgmtModal.proposedPerUnit}
          onConfirm={(name) => applyManualOffer(seniorMgmtModal.item, seniorMgmtModal.proposedPerUnit, name)}
          onClose={() => setSeniorMgmtModal(null)}
        />
      )}

      {marginResultModal && (
        <MarginResultModal
          item={marginResultModal.item}
          offerPerUnit={marginResultModal.offerPerUnit}
          ourSalePrice={marginResultModal.ourSalePrice}
          marginPct={marginResultModal.marginPct}
          marginGbp={marginResultModal.marginGbp}
          confirmedBy={marginResultModal.confirmedBy}
          onClose={() => setMarginResultModal(null)}
        />
      )}

      {blockedOfferModal && (
        <BlockedOfferAuthModal
          slot={blockedOfferModal.slot}
          offer={blockedOfferModal.offer}
          item={blockedOfferModal.item}
          customerData={customerData}
          customerOfferRulesData={customerOfferRulesData}
          onAuthorise={(approverName) => {
            const { slot, offer, item: bItem, onAuthoriseAction } = blockedOfferModal;
            if (typeof onAuthoriseAction === 'function') {
              Promise.resolve(onAuthoriseAction(approverName)).finally(() => {
                setBlockedOfferModal(null);
              });
              return;
            }
            if (slot === 'manual') {
              if (bItem?.id) markItemSlotAuthorised(bItem.id, 'manual', approverName);
              setItemOfferModal({ item: bItem, seniorMgmtOverride: approverName });
            } else if (offer && bItem) {
              setItems((prev) =>
                prev.map((it) => {
                  if (it.id !== bItem.id) return it;
                  const revokePatch = revokeManualOfferAuthorisationIfSwitchingAway(it, offer.id);
                  const baseSlots = Array.isArray(revokePatch.authorisedOfferSlots)
                    ? [...revokePatch.authorisedOfferSlots]
                    : Array.isArray(it.authorisedOfferSlots)
                      ? [...it.authorisedOfferSlots]
                      : [];
                  if (!baseSlots.includes(slot)) baseSlots.push(slot);
                  return {
                    ...it,
                    ...revokePatch,
                    selectedOfferId: offer.id,
                    seniorMgmtApprovedBy: approverName,
                    authorisedOfferSlots: baseSlots,
                  };
                })
              );
            }
            setBlockedOfferModal(null);
          }}
          onClose={() => {
            if (typeof blockedOfferModal?.onCancelAction === 'function') {
              blockedOfferModal.onCancelAction();
            }
            setBlockedOfferModal(null);
          }}
        />
      )}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={true}
        priceLabel="Our RRP"
        useVoucherOffers={useVoucherOffers}
        showNotification={showNotification}
      />

      <NewCustomerDetailsModal
        open={showNewCustomerDetailsModal}
        onClose={() => { setShowNewCustomerDetailsModal(false); setPendingFinishPayload(null); }}
        onSubmit={handleNewCustomerDetailsSubmit}
        initialName={customerData?.name || ""}
      />

      {showNewBuyConfirm && (
        <TinyModal
          title="Start a new buy?"
          onClose={() => setShowNewBuyConfirm(false)}
        >
          <p className="text-xs text-slate-600 mb-5">
            This will clear your current cart and customer details. You can start again from the buyer page.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: 'white', color: 'var(--text-muted)', border: '1px solid var(--ui-border)' }}
              onClick={() => setShowNewBuyConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors hover:opacity-90"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={handleConfirmNewBuy}
            >
              Yes, start new buy
            </button>
          </div>
        </TinyModal>
      )}

      {parkProgressModal ? (
        <ParkAgreementProgressModal
          open
          onClose={() => {
            parkNosposTabRef.current = null;
            setParkProgressModal(null);
          }}
          systemSteps={parkProgressModal.systemSteps}
          itemTables={parkProgressModal.itemTables}
          footerError={parkProgressModal.footerError}
          allowClose={parkProgressModal.allowClose}
          onPatchField={handleParkFieldPatch}
          onRetryParkLine={handleRetryParkLine}
          parkRetryBusy={parkRetryBusyUi}
          parkLineRetryEnabled={
            parkProgressModal.allowClose === true || Boolean(parkProgressModal.footerError)
          }
          parkedAgreementId={persistedNosposAgreementId}
          onViewParkedAgreement={handleViewParkedAgreement}
          onDownloadLog={handleDownloadParkLog}
          hidePerItemTableRetry={parkHidePerItemTableRetry}
        />
      ) : null}

      {missingNosposCategoryModal?.length ? (
        <MissingNosposCategoryModal
          lines={missingNosposCategoryModal}
          onSetCategory={onOpenCategoryPickerForItem}
          onRecheckContinue={handleMissingNosposCategoryRecheckContinue}
        />
      ) : null}

      {nosposCategoryPickerModal ? (
        <NosposCategoryPickerModal
          nosposCategoriesResults={nosposPickerCategories}
          currentNosposId={nosposCategoryPickerModal.currentNosposId}
          onSelect={(cat) => onNosposCategorySelected(nosposCategoryPickerModal.item, cat)}
          onClose={onCloseCategoryPicker}
        />
      ) : null}

      {missingRequiredNosposModal?.length ? (
        <MissingNosposRequiredFieldsModal
          lines={missingRequiredNosposModal}
          items={missingGateItems}
          nosposCategoriesResults={missingGateNosposCategories}
          nosposCategoryMappings={missingGateNosposMappings}
          useVoucherOffers={useVoucherOffers}
          actualRequestId={actualRequestId}
          onSaveLineFields={onSaveMissingGateNosposFields}
          onRecheckContinue={handleMissingNosposRecheckContinue}
        />
      ) : null}

      {nosposRequiredFieldsEditor && nosposRequiredEditorLiveItem && nosposSchemaCategories != null ? (
        <NosposRequiredFieldsEditorModal
          key={nosposRequiredEditorLiveItem.id}
          item={nosposRequiredEditorLiveItem}
          negotiationIndex={nosposRequiredFieldsEditor.negotiationIndex}
          nosposSiteCategories={nosposSchemaCategories}
          nosposCategoryMappings={nosposSchemaMappings}
          useVoucherOffers={useVoucherOffers}
          requestId={actualRequestId}
          onSave={onSaveNosposRequiredFieldsFromModal}
          onClose={onCloseNosposRequiredFieldsEditor}
          requireCompletionUntilSave={nosposRequiredFieldsRequireCompletion}
        />
      ) : null}

      <JewelleryReferencePricesModal
        open={Boolean(showJewelleryReferenceModal)}
        onClose={() => setShowJewelleryReferenceModal(false)}
        sections={jewelleryReferenceScrape?.sections}
      />
    </>
  );
}
