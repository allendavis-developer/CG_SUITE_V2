import { useCallback } from 'react';
import useAppStore from '@/store/useAppStore';
import { updateCustomer, finishRequest } from '@/services/api';
import { resolveOurSalePrice, buildFinishPayload } from '../utils/negotiationHelpers';
import {
  fetchMissingRequiredNosposLines,
  fetchLinesWithNoNosposCategory,
} from '../utils/negotiationMissingNosposRequired';

export function useNegotiationFinalize({
  items,
  targetOffer,
  totalOfferPrice,
  useVoucherOffers,
  customerData,
  jewelleryReferenceScrape,
  actualRequestId,
  navigate,
  showNotification,
  setItems,
  setSeniorMgmtModal,
  setMarginResultModal,
  setPendingFinishPayload,
  setShowNewCustomerDetailsModal,
  setShowNewBuyConfirm,
  completedRef,
  pendingFinishPayload,
  setMissingRequiredNosposModal,
  setMissingNosposCategoryModal,
}) {
  const applyManualOffer = useCallback(
    (item, proposedPerUnit, seniorMgmtConfirmedBy = null) => {
      const ourSalePrice = resolveOurSalePrice(item);

      if (ourSalePrice && proposedPerUnit > ourSalePrice && !seniorMgmtConfirmedBy) {
        setSeniorMgmtModal({ item, proposedPerUnit });
        return false;
      }

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                manualOffer: proposedPerUnit.toFixed(2),
                selectedOfferId: 'manual',
                manualOfferUsed: true,
                ...(seniorMgmtConfirmedBy && { seniorMgmtApprovedBy: seniorMgmtConfirmedBy }),
              }
            : i
        )
      );

      if (ourSalePrice && ourSalePrice > 0) {
        const marginPct = ((ourSalePrice - proposedPerUnit) / ourSalePrice) * 100;
        const marginGbp = ourSalePrice - proposedPerUnit;
        setMarginResultModal({
          item,
          offerPerUnit: proposedPerUnit,
          ourSalePrice,
          marginPct,
          marginGbp,
          confirmedBy: seniorMgmtConfirmedBy,
        });
      }

      return true;
    },
    [setItems, setSeniorMgmtModal, setMarginResultModal]
  );

  const doFinishRequest = useCallback(
    async (payload) => {
      try {
        await finishRequest(actualRequestId, payload);
        completedRef.current = true;
        useAppStore.getState().resetBuyer();
        showNotification('Transaction finalized successfully and booked for testing!', 'success');
        navigate('/transaction-complete');
      } catch (error) {
        console.error('Error finalizing transaction:', error);
        const msg = error?.message || '';
        if (msg.toLowerCase().includes('can only finalize') || msg.toLowerCase().includes('quote request')) {
          showNotification(
            'This request has already been finalized. Please start a new negotiation from the buyer page.',
            'error'
          );
          navigate('/buyer', { replace: true });
        } else {
          showNotification(`Failed to finalize transaction: ${msg}`, 'error');
        }
      }
    },
    [actualRequestId, navigate, showNotification, completedRef]
  );

  const handleFinalizeTransaction = useCallback(async () => {
    if (!actualRequestId) {
      showNotification(
        'Cannot finalize: Request ID is missing. Please return to the buyer page and start a new negotiation.',
        'error'
      );
      navigate('/buyer', { replace: true });
      return;
    }

    for (const item of items) {
      if (item.isRemoved) continue;
      if (!item.selectedOfferId) {
        showNotification(`Please select an offer for item: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
      if (item.selectedOfferId === 'manual') {
        const manualValue = parseFloat(item.manualOffer?.replace(/[£,]/g, '')) || 0;
        if (manualValue <= 0) {
          showNotification(`Please enter a valid manual offer for item: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }

      const rawSaleInput = String(item.ourSalePriceInput ?? '').replace(/[£,]/g, '').trim();
      if (rawSaleInput !== '') {
        const parsedTotalSale = parseFloat(rawSaleInput);
        if (!Number.isFinite(parsedTotalSale) || parsedTotalSale <= 0) {
          showNotification(`Our RRP must be greater than £0 for item: ${item.title || 'Unknown Item'}`, 'error');
          return;
        }
      }

      const resolvedSalePrice = resolveOurSalePrice(item);
      if (!Number.isFinite(Number(resolvedSalePrice)) || Number(resolvedSalePrice) <= 0) {
        showNotification(`Please set a valid Our RRP above £0 for item: ${item.title || 'Unknown Item'}`, 'error');
        return;
      }
    }

    if (targetOffer) {
      const pt = parseFloat(targetOffer);
      if (pt > 0) {
        const delta = totalOfferPrice - pt;
        if (Math.abs(delta) > 0.005) {
          const relationText = delta < 0 ? 'has not met' : 'exceeds';
          showNotification(
            `Cannot book for testing: grand total £${totalOfferPrice.toFixed(2)} ${relationText} the target offer of £${pt.toFixed(2)}.`,
            'error'
          );
          return;
        }
      }
    }

    // Gate 1: every non-jewellery item must have a resolved NosPos category
    let missingCategories = [];
    try {
      missingCategories = await fetchLinesWithNoNosposCategory(items);
    } catch (e) {
      console.error('[CG Suite] fetch NosPos categories before finalize (category check)', e);
      showNotification('Could not load NosPos categories. Check your connection and try again.', 'error');
      return;
    }

    if (missingCategories.length > 0) {
      if (typeof setMissingNosposCategoryModal === 'function') {
        setMissingNosposCategoryModal(missingCategories);
      }
      return;
    }

    // Gate 2: all required NosPos linked fields must be filled
    let missingNosposRequired = [];
    try {
      missingNosposRequired = await fetchMissingRequiredNosposLines(items, useVoucherOffers);
    } catch (e) {
      console.error('[CG Suite] fetch NosPos categories/mappings before finalize', e);
      showNotification('Could not load NosPos field definitions. Check your connection and try again.', 'error');
      return;
    }

    if (missingNosposRequired.length > 0) {
      if (typeof setMissingRequiredNosposModal === 'function') {
        setMissingRequiredNosposModal(missingNosposRequired);
      }
      return;
    }

    const payload = buildFinishPayload(
      items,
      targetOffer,
      useVoucherOffers,
      totalOfferPrice,
      customerData,
      jewelleryReferenceScrape
    );

    if (customerData?.isNewCustomer) {
      setMissingRequiredNosposModal?.(null);
      setPendingFinishPayload(payload);
      setShowNewCustomerDetailsModal(true);
    } else {
      await doFinishRequest(payload);
    }
  }, [
    actualRequestId,
    items,
    targetOffer,
    totalOfferPrice,
    useVoucherOffers,
    customerData,
    jewelleryReferenceScrape,
    doFinishRequest,
    navigate,
    showNotification,
    setPendingFinishPayload,
    setShowNewCustomerDetailsModal,
    setMissingRequiredNosposModal,
    setMissingNosposCategoryModal,
  ]);

  /**
   * Re-checks missing NosPos categories; if clear, proceeds to the required-fields gate.
   * Modal must stay open until this succeeds.
   */
  const handleMissingNosposCategoryRecheckContinue = useCallback(async () => {
    try {
      const missing = await fetchLinesWithNoNosposCategory(items);
      if (missing.length > 0) {
        setMissingNosposCategoryModal(missing);
        showNotification(
          'Some items still have no NosPos category. Set a category for each item, then try again.',
          'warning'
        );
        return;
      }
      setMissingNosposCategoryModal(null);
      await handleFinalizeTransaction();
    } catch (e) {
      console.error('[CG Suite] NosPos category recheck', e);
      showNotification('Could not verify NosPos categories. Check your connection and try again.', 'error');
    }
  }, [items, setMissingNosposCategoryModal, showNotification, handleFinalizeTransaction]);

  /**
   * Re-checks required NosPos fields; only when clear does it close the gate and resume finalize
   * (new customer modal or API finish). Modal must stay open until this succeeds.
   */
  const handleMissingNosposRecheckContinue = useCallback(async () => {
    try {
      const missing = await fetchMissingRequiredNosposLines(items, useVoucherOffers);
      if (missing.length > 0) {
        setMissingRequiredNosposModal(missing);
        showNotification(
          'Required NosPos fields are still incomplete. Fill every listed field, then try again.',
          'warning'
        );
        return;
      }
      setMissingRequiredNosposModal(null);
      await handleFinalizeTransaction();
    } catch (e) {
      console.error('[CG Suite] NosPos field recheck', e);
      showNotification('Could not verify NosPos fields. Check your connection and try again.', 'error');
    }
  }, [
    items,
    useVoucherOffers,
    setMissingRequiredNosposModal,
    showNotification,
    handleFinalizeTransaction,
  ]);

  const handleNewCustomerDetailsSubmit = useCallback(
    async (formData) => {
      await updateCustomer(customerData.id, {
        name: formData.name,
        phone_number: formData.phone,
        email: formData.email || null,
        address: formData.address || '',
        is_temp_staging: false,
      });
      setMissingRequiredNosposModal?.(null);
      await doFinishRequest(pendingFinishPayload);
      setPendingFinishPayload(null);
      setShowNewCustomerDetailsModal(false);
    },
    [
      customerData,
      pendingFinishPayload,
      doFinishRequest,
      setPendingFinishPayload,
      setShowNewCustomerDetailsModal,
      setMissingRequiredNosposModal,
    ]
  );

  const handleConfirmNewBuy = useCallback(() => {
    setShowNewBuyConfirm(false);
    useAppStore.getState().resetBuyerWorkspace({ openCustomerModal: true });
    navigate('/buyer');
  }, [navigate, setShowNewBuyConfirm]);

  return {
    applyManualOffer,
    doFinishRequest,
    handleFinalizeTransaction,
    handleMissingNosposCategoryRecheckContinue,
    handleMissingNosposRecheckContinue,
    handleNewCustomerDetailsSubmit,
    handleConfirmNewBuy,
  };
}
