import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import CustomerTransactionHeader from './components/CustomerTransactionHeader';
import { finishRequest, fetchRequestDetail, updateCustomer, saveQuoteDraft } from '@/services/api';
import { useNotification } from '@/contexts/NotificationContext';
import NewCustomerDetailsModal from '@/components/modals/NewCustomerDetailsModal';
import SalePriceConfirmModal from '@/components/modals/SalePriceConfirmModal';
import TinyModal from '@/components/ui/TinyModal';
import { maybeShowSalePriceConfirm } from './utils/researchCompletionHelpers';


// Context menu for item row actions (right-click)
const ItemContextMenu = ({ x, y, onClose, onRemove, onSetManualOffer }) => {
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[210px] py-1 border shadow-xl bg-white rounded-lg"
      style={{ left: x, top: y, borderColor: 'var(--ui-border)' }}
    >
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-blue-50 transition-colors flex items-center gap-2"
        style={{ color: 'var(--brand-blue)' }}
        onClick={() => { onSetManualOffer(); onClose(); }}
      >
        <span className="material-symbols-outlined text-[16px]">edit</span>
        Set manual offer
      </button>
      <div className="border-t my-1" style={{ borderColor: 'var(--ui-border)' }} />
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-2 text-red-600"
        onClick={() => { onRemove(); onClose(); }}
      >
        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
        Remove from negotiation
      </button>
    </div>
  );
};

// Reusable tiny modal shell
const Negotiation = ({ mode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId: paramsRequestId } = useParams();
  const { cartItems, customerData: initialCustomerData, currentRequestId: initialRequestId } = location.state || {};

  const actualRequestId = mode === 'view' ? paramsRequestId : initialRequestId;

  const [items, setItems] = useState([]);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [customerData, setCustomerData] = useState({});
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [totalExpectation, setTotalExpectation] = useState("");
  const [transactionType, setTransactionType] = useState('sale');
  const [isLoading, setIsLoading] = useState(true);
  const [showNewCustomerDetailsModal, setShowNewCustomerDetailsModal] = useState(false);
  const [pendingFinishPayload, setPendingFinishPayload] = useState(null);

  // Target offer state
  const [targetOffer, setTargetOffer] = useState(""); // numeric string e.g. "250.00"
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  // Item offer modal state (right-click → set manual offer)
  const [itemOfferModal, setItemOfferModal] = useState(null); // { item } | null
  const [itemOfferInput, setItemOfferInput] = useState("");

  // Senior management bypass modal
  const [seniorMgmtModal, setSeniorMgmtModal] = useState(null); // { item, proposedPerUnit } | null
  const [seniorMgmtName, setSeniorMgmtName] = useState("");

  // Margin result confirmation modal
  const [marginResultModal, setMarginResultModal] = useState(null); // { item, offerPerUnit, ourSalePrice, marginPct, marginGbp } | null

  // Our sale price update confirmation modal (after research)
  const [salePriceConfirmModal, setSalePriceConfirmModal] = useState(null); // { itemId, oldPricePerUnit, newPricePerUnit, source }

  const { showNotification } = useNotification();

  const buildItemSpecs = (item) => {
    if (!item) return null;
    if (item.cexProductData?.specifications && Object.keys(item.cexProductData.specifications).length > 0) {
      return item.cexProductData.specifications;
    }
    // Use stored attributeValues (all attributes, regardless of their code names)
    if (item.attributeValues && Object.values(item.attributeValues).some(v => v)) {
      return Object.fromEntries(
        Object.entries(item.attributeValues)
          .filter(([, v]) => v)
          .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])
      );
    }
    // Fallback to hardcoded fields for older cart items that predate attributeValues storage
    const specs = {};
    if (item.storage)   specs['Storage']   = item.storage;
    if (item.color)     specs['Colour']    = item.color;
    if (item.network)   specs['Network']   = item.network;
    if (item.condition) specs['Condition'] = item.condition;
    return Object.keys(specs).length > 0 ? specs : null;
  };

  const buildInitialSearchQuery = (item) => {
    return item?.ebayResearchData?.searchTerm
      || item?.ebayResearchData?.lastSearchedTerm
      || item?.title
      || undefined;
  };

  const useVoucherOffers = transactionType === 'store_credit';

  // Get the current total offer for an item
  const getItemOfferTotal = (item) => {
    if (item.isRemoved) return 0;
    const qty = item.quantity || 1;
    if (item.selectedOfferId === 'manual' && item.manualOffer) {
      return (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) * qty;
    }
    const displayOffers = useVoucherOffers
      ? (item.voucherOffers || item.offers)
      : (item.cashOffers || item.offers);
    const selected = displayOffers?.find(o => o.id === item.selectedOfferId);
    return selected ? selected.price * qty : 0;
  };

  // Calculate what the target implies for a given item (target minus all other items' totals)
  const calculateItemTargetContribution = (itemId) => {
    const parsedTarget = parseFloat(targetOffer);
    if (!parsedTarget || parsedTarget <= 0) return null;
    const otherTotal = items
      .filter(i => !i.isRemoved && i.id !== itemId)
      .reduce((sum, i) => sum + getItemOfferTotal(i), 0);
    return parsedTarget - otherTotal;
  };

  // Resolve ourSalePrice for an item
  const resolveOurSalePrice = (item) => {
    if (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== '') {
      return Number(item.ourSalePrice);
    }
    if (item.useResearchSuggestedPrice !== false && item.ebayResearchData?.stats?.suggestedPrice != null) {
      return Number(item.ebayResearchData.stats.suggestedPrice);
    }
    return null;
  };

  // Apply a manual offer per-unit to an item (with target + senior mgmt checks)
  // Returns false if blocked (will open senior mgmt modal or show error)
  const applyManualOffer = (item, proposedPerUnit, seniorMgmtConfirmedBy = null) => {
    const ourSalePrice = resolveOurSalePrice(item);

    if (ourSalePrice && proposedPerUnit > ourSalePrice && !seniorMgmtConfirmedBy) {
      setSeniorMgmtModal({ item, proposedPerUnit });
      setSeniorMgmtName("");
      return false;
    }

    setItems(prev => prev.map(i =>
      i.id === item.id
        ? {
            ...i,
            manualOffer: proposedPerUnit.toFixed(2),
            selectedOfferId: 'manual',
            manualOfferUsed: true,
            ...(seniorMgmtConfirmedBy && { seniorMgmtApprovedBy: seniorMgmtConfirmedBy }),
          }
        : i
    ));

    // Show margin result modal if we have a sale price
    if (ourSalePrice && ourSalePrice > 0) {
      const marginPct = ((ourSalePrice - proposedPerUnit) / ourSalePrice) * 100;
      const marginGbp = ourSalePrice - proposedPerUnit;
      setMarginResultModal({ item, offerPerUnit: proposedPerUnit, ourSalePrice, marginPct, marginGbp, confirmedBy: seniorMgmtConfirmedBy });
    }

    return true;
  };

  const buildFinishPayload = (offerPrice) => {
    const itemsData = items
      .filter(item => !item.isRemoved && item.request_item_id)
      .map(item => {
      const quantity = item.quantity || 1;
      let negotiatedPrice = 0;

      if (item.selectedOfferId === 'manual' && item.manualOffer) {
        negotiatedPrice = parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0;
      } else {
        const displayOffers = useVoucherOffers
          ? (item.voucherOffers || item.offers)
          : (item.cashOffers || item.offers);
        const selected = displayOffers?.find(o => o.id === item.selectedOfferId);
        negotiatedPrice = selected ? selected.price : 0;
      }

      const rawInput = item.ourSalePriceInput;
      const parsedFromInput = rawInput !== undefined && rawInput !== '' ? parseFloat(String(rawInput).replace(/[£,]/g, '')) : NaN;
      const ourSalePrice =
        !Number.isNaN(parsedFromInput) && parsedFromInput > 0
          ? parsedFromInput / quantity
          : (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
              ? Number(item.ourSalePrice)
              : (item.ebayResearchData?.stats?.suggestedPrice != null
                  ? Number(item.ebayResearchData.stats.suggestedPrice)
                  : null));

      const rawData = { ...(item.ebayResearchData || {}) };
      rawData.display_title = item.title ?? '';
      rawData.display_subtitle = item.subtitle ?? '';

      const cexBuyCash = item.cexBuyPrice != null ? Number(item.cexBuyPrice) : null;
      const cexBuyVoucher = item.cexVoucherPrice != null ? Number(item.cexVoucherPrice) : null;
      const cexSell = item.cexSellPrice != null ? Number(item.cexSellPrice) : null;

      return {
        request_item_id: item.request_item_id,
        quantity: quantity,
        selected_offer_id: item.selectedOfferId,
        manual_offer_gbp: item.manualOffer ? (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) : null,
        manual_offer_used: item.selectedOfferId === 'manual',
        senior_mgmt_approved_by: item.seniorMgmtApprovedBy || null,
        customer_expectation_gbp: item.customerExpectation ? (parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0) : null,
        negotiated_price_gbp: negotiatedPrice * quantity,
        our_sale_price_at_negotiation: ourSalePrice,
        cash_offers_json: item.cashOffers || [],
        voucher_offers_json: item.voucherOffers || [],
        raw_data: rawData,
        cash_converters_data: item.cashConvertersResearchData || {},
        ...(cexBuyCash != null && { cex_buy_cash_at_negotiation: cexBuyCash }),
        ...(cexBuyVoucher != null && { cex_buy_voucher_at_negotiation: cexBuyVoucher }),
        ...(cexSell != null && { cex_sell_at_negotiation: cexSell }),
      };
    });

    const overallExpectationValue = parseFloat(totalExpectation.replace(/[£,]/g, '')) || 0;
    const targetOfferValue = parseFloat(targetOffer) || null;

    return {
      items_data: itemsData,
      overall_expectation_gbp: overallExpectationValue,
      negotiated_grand_total_gbp: offerPrice,
      ...(targetOfferValue && { target_offer_gbp: targetOfferValue }),
    };
  };

  const doFinishRequest = async (payload) => {
    try {
      await finishRequest(actualRequestId, payload);
      completedRef.current = true;
      showNotification("Transaction finalized successfully and booked for testing!", 'success');
      navigate("/transaction-complete");
    } catch (error) {
      console.error("Error finalizing transaction:", error);
      showNotification(`Failed to finalize transaction: ${error.message}`, 'error');
    }
  };

  const handleFinalizeTransaction = async () => {
    if (!actualRequestId) {
      showNotification("Cannot finalize: Request ID is missing. Please return to the buyer page and start a new negotiation.", "error");
      navigate("/buyer", { replace: true });
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
    }

    // Block booking if target offer is set and grand total does not match the target (must be effectively equal)
    if (targetOffer) {
      const parsedTarget = parseFloat(targetOffer);
      if (parsedTarget > 0) {
        const delta = totalOfferPrice - parsedTarget;
        if (Math.abs(delta) > 0.005) {
          const relationText = delta < 0 ? 'has not met' : 'exceeds';
          showNotification(
            `Cannot book for testing: grand total £${totalOfferPrice.toFixed(2)} ${relationText} the target offer of £${parsedTarget.toFixed(2)}.`,
            'error'
          );
          return;
        }
      }
    }

    const payload = buildFinishPayload(totalOfferPrice);

    if (customerData?.isNewCustomer) {
      setPendingFinishPayload(payload);
      setShowNewCustomerDetailsModal(true);
    } else {
      await doFinishRequest(payload);
    }
  };

  const handleNewCustomerDetailsSubmit = async (formData) => {
    await updateCustomer(customerData.id, {
      name: formData.name,
      phone_number: formData.phone,
      email: formData.email || null,
      address: formData.address || '',
      is_temp_staging: false,
    });
    await doFinishRequest(pendingFinishPayload);
    setPendingFinishPayload(null);
    setShowNewCustomerDetailsModal(false);
  };

  const hasInitializedNegotiateRef = useRef(false);
  const completedRef = useRef(false);
  const draftPayloadRef = useRef(null);

  useEffect(() => {
    if (mode === 'view' && actualRequestId) {
      const loadRequestDetails = async () => {
        setIsLoading(true);
        try {
          const data = await fetchRequestDetail(actualRequestId);
          if (data) {
            setCustomerData({
                id: data.customer_details.customer_id,
                name: data.customer_details.name,
                cancelRate: data.customer_details.cancel_rate,
                transactionType: (data.intent === 'DIRECT_SALE' ? 'sale' : data.intent === 'BUYBACK' ? 'buyback' : 'store_credit')
            });
            setTotalExpectation(data.overall_expectation_gbp?.toString() || '');
            if (data.target_offer_gbp != null) {
              setTargetOffer(data.target_offer_gbp.toString());
            } else {
              setTargetOffer("");
            }
            setTransactionType(data.intent === 'DIRECT_SALE' ? 'sale' : data.intent === 'BUYBACK' ? 'buyback' : 'store_credit');

            const currentStatus = data.current_status || data.status_history?.[0]?.status;
            const isBookedOrComplete = currentStatus === 'BOOKED_FOR_TESTING' || currentStatus === 'COMPLETE';

            const mappedItems = data.items.map(item => {
                const ebayResearchData = item.raw_data || null;
                const cashConvertersResearchData = item.cash_converters_data || null;

                const isRemoved = isBookedOrComplete && (item.negotiated_price_gbp == null || item.negotiated_price_gbp === '');

                let savedCashOffers = item.cash_offers_json || [];
                let savedVoucherOffers = item.voucher_offers_json || [];

                const isEbayResearchPayload =
                    !!(ebayResearchData && ebayResearchData.stats && ebayResearchData.selectedFilters);

                if (isEbayResearchPayload && savedCashOffers.length > 0 && savedVoucherOffers.length === 0) {
                    savedVoucherOffers = savedCashOffers.map(offer => ({
                        id: `ebay-voucher-${offer.id}`,
                        title: offer.title,
                        price: Number((offer.price * 1.10).toFixed(2))
                    }));
                }

                const displayOffers = (transactionType === 'store_credit') ? savedVoucherOffers : savedCashOffers;

                const savedDisplayTitle = ebayResearchData?.display_title;
                const savedDisplaySubtitle = ebayResearchData?.display_subtitle;
                const hasSavedDisplay = savedDisplayTitle != null && savedDisplayTitle !== '';

                const cexTitle = item.variant_details?.title;
                const cexSubtitle = item.variant_details?.cex_sku;

                const rawCeXTitle = !isEbayResearchPayload
                    ? (ebayResearchData?.title || ebayResearchData?.modelName)
                    : null;

                const rawEbayTitle = isEbayResearchPayload
                    ? (ebayResearchData.searchTerm || ebayResearchData.title || null)
                    : null;

                const cashConvertersTitle =
                    cashConvertersResearchData?.searchTerm || cashConvertersResearchData?.title || null;

                const ebaySubtitleFromFilters = isEbayResearchPayload
                    ? (Object.values(ebayResearchData.selectedFilters?.apiFilters || {})
                        .flat()
                        .join(' / ') ||
                       ebayResearchData.selectedFilters?.basic?.join(' / ') ||
                       'eBay Filters')
                    : null;

                const isCexItem = !!(cexTitle || rawCeXTitle);

                const cexSkuFromVariant = item.variant_details?.cex_sku || null;
                const cexSkuFromRaw = !isEbayResearchPayload
                    ? (ebayResearchData?.id || ebayResearchData?.sku || null)
                    : null;
                const effectiveCexSku = cexSkuFromVariant || cexSkuFromRaw || null;

                const cexUrl =
                    (ebayResearchData && !isEbayResearchPayload && (ebayResearchData.url || ebayResearchData.listingPageUrl)) ||
                    (effectiveCexSku ? `https://uk.webuy.com/product-detail?id=${effectiveCexSku}` : null);

                return {
                    id: item.request_item_id,
                    request_item_id: item.request_item_id,
                    title: hasSavedDisplay ? savedDisplayTitle : (isCexItem ? (cexTitle || rawCeXTitle || 'N/A') : (rawEbayTitle || cashConvertersTitle || 'N/A')),
                    subtitle: hasSavedDisplay ? (savedDisplaySubtitle ?? '') : (isCexItem ? '' : (ebaySubtitleFromFilters || 'No details')),
                    quantity: item.quantity,
                    selectedOfferId: item.selected_offer_id,
                    manualOffer: item.manual_offer_gbp?.toString() || '',
                    manualOfferUsed: item.manual_offer_used ?? (item.selected_offer_id === 'manual'),
                    seniorMgmtApprovedBy: item.senior_mgmt_approved_by || null,
                    customerExpectation: item.customer_expectation_gbp?.toString() || '',
                    ebayResearchData: ebayResearchData,
                    cashConvertersResearchData: cashConvertersResearchData,
                    cexBuyPrice: (mode === 'view' && item.cex_buy_cash_at_negotiation !== null)
                                ? parseFloat(item.cex_buy_cash_at_negotiation)
                                : (item.variant_details?.tradein_cash ? parseFloat(item.variant_details.tradein_cash) : null),
                    cexVoucherPrice: (mode === 'view' && item.cex_buy_voucher_at_negotiation !== null)
                                ? parseFloat(item.cex_buy_voucher_at_negotiation)
                                : (item.variant_details?.tradein_voucher ? parseFloat(item.variant_details.tradein_voucher) : null),
                    cexSellPrice: (mode === 'view' && item.cex_sell_at_negotiation !== null)
                                ? parseFloat(item.cex_sell_at_negotiation)
                                : (item.variant_details?.current_price_gbp ? parseFloat(item.variant_details.current_price_gbp) : null),
                    cexOutOfStock: item.variant_details?.cex_out_of_stock ?? false,
                    cexUrl,
                    ourSalePrice: (mode === 'view' && item.our_sale_price_at_negotiation !== null)
                                ? parseFloat(item.our_sale_price_at_negotiation)
                                : (ebayResearchData?.stats?.suggestedPrice != null
                                    ? parseFloat(ebayResearchData.stats.suggestedPrice)
                                    : null),
                    offers: displayOffers,
                    cashOffers: savedCashOffers,
                    voucherOffers: savedVoucherOffers,
                    isRemoved,
                };
            });
            setItems(mappedItems);
          } else {
            showNotification("Request details not found.", "error");
            navigate("/requests-overview", { replace: true });
          }
        } catch (err) {
          console.error("Failed to load request details:", err);
          showNotification(`Failed to load request details: ${err.message}`, "error");
          navigate("/requests-overview", { replace: true });
        } finally {
          setIsLoading(false);
        }
      };
      loadRequestDetails();
    } else if (mode === 'negotiate') {
        if (!hasInitializedNegotiateRef.current) {
            if (cartItems && cartItems.length > 0) {
                const normalizedCartItems = cartItems.map((item) => {
                    const isEbayPayload = !!(item.ebayResearchData?.stats && item.ebayResearchData?.selectedFilters);
                    const cexName = item.variant_details?.title
                        || (!isEbayPayload && (item.ebayResearchData?.title || item.ebayResearchData?.modelName))
                        || (item.isCustomCeXItem && item.title) || null;
                    const isCexItem = !!(cexName || item.isCustomCeXItem || (item.cexBuyPrice != null || item.cexSellPrice != null));
                    const displayOffers = (initialCustomerData?.transactionType === 'store_credit')
                        ? (item.voucherOffers || item.offers)
                        : (item.cashOffers || item.offers);
                    const resolvedSelectedOfferId = (item.selectedOfferId != null && item.selectedOfferId !== '')
                        ? item.selectedOfferId
                        : null;
                    let next = item;
                    if (isCexItem) {
                        next = { ...item, title: cexName || item.title, subtitle: '' };
                    }
                    return { ...next, selectedOfferId: resolvedSelectedOfferId };
                });
                setItems(normalizedCartItems);
            }
            hasInitializedNegotiateRef.current = true;
        }
        if (initialCustomerData?.id && !customerData?.id) {
            setCustomerData(initialCustomerData);
            setTotalExpectation(initialCustomerData?.overall_expectation_gbp?.toString() || "");
            setTransactionType(initialCustomerData?.transactionType || 'sale');
        }

        if ((!cartItems || cartItems.length === 0 || !initialCustomerData?.id) && !isLoading) {
            navigate("/buyer", { replace: true });
            return;
        }

        if (!actualRequestId && !isLoading) {
            console.warn("Negotiation page loaded without requestId. Redirecting to buyer page.");
            showNotification("Session expired. Please start a new negotiation from the buyer page.", "error");
            navigate("/buyer", { replace: true });
            return;
        }

        setIsLoading(false);
    }
  }, [mode, actualRequestId, navigate, initialCustomerData, cartItems, showNotification]);


  useEffect(() => {
    if (customerData?.transactionType) {
      setTransactionType(customerData.transactionType);
    }
  }, [customerData]);

  const prevTransactionTypeRef = useRef(transactionType);

  useEffect(() => {
    if (mode !== 'negotiate') {
      prevTransactionTypeRef.current = transactionType;
      return;
    }

    const prevType = prevTransactionTypeRef.current;

    if (prevType === transactionType) {
      return;
    }

    setItems(prevItems =>
      prevItems.map(item => {
        if (item.selectedOfferId === 'manual') {
          return item;
        }

        const prevUseVoucher = prevType === 'store_credit';
        const newUseVoucher = transactionType === 'store_credit';

        const prevOffers = prevUseVoucher
          ? (item.voucherOffers || item.offers)
          : (item.cashOffers || item.offers);

        const newOffers = newUseVoucher
          ? (item.voucherOffers || item.offers)
          : (item.cashOffers || item.offers);

        if (!prevOffers || !newOffers) return item;

        const prevIndex = prevOffers.findIndex(o => o.id === item.selectedOfferId);
        if (prevIndex < 0 || !newOffers[prevIndex]) return item;

        return {
          ...item,
          selectedOfferId: newOffers[prevIndex].id,
        };
      })
    );

    prevTransactionTypeRef.current = transactionType;
  }, [transactionType, mode]);


  const handleRemoveFromNegotiation = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    setContextMenu(null);
    showNotification(`"${item.title || 'Item'}" removed from negotiation`, 'info');
  };

  const handleReopenResearch = (item) => {
    setResearchItem(item);
  };

  const handleResearchComplete = (updatedState) => {
    if (updatedState && !updatedState.cancel && researchItem && mode !== 'view') {
      const currentItem = items.find(i => i.id === researchItem.id);

      setItems(prevItems => prevItems.map(i => {
        if (i.id !== researchItem.id) return i;

        const hasCeXBasedOffers = (i.variantId != null && i.variantId !== '') || i.isCustomCeXItem === true;
        const isEbayOnlyItem =
          i.isCustomEbayItem === true ||
          (!hasCeXBasedOffers && i.ebayResearchData?.stats && i.ebayResearchData?.selectedFilters);

        let newCashOffers = i.cashOffers || [];
        let newVoucherOffers = i.voucherOffers || [];

        if (updatedState.buyOffers && updatedState.buyOffers.length > 0) {
          if (isEbayOnlyItem) {
            newCashOffers = updatedState.buyOffers.map((o, idx) => ({
              id: `ebay-cash-${Date.now()}-${idx}`,
              title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
              price: Number(o.price)
            }));
            newVoucherOffers = newCashOffers.map(offer => ({
              id: `ebay-voucher-${offer.id}`,
              title: offer.title,
              price: Number((offer.price * 1.10).toFixed(2))
            }));
          } else if (!hasCeXBasedOffers) {
            const hasExistingOffers =
              (i.cashOffers && i.cashOffers.length > 0) ||
              (i.voucherOffers && i.voucherOffers.length > 0) ||
              (i.offers && i.offers.length > 0);
            if (!hasExistingOffers) {
              newCashOffers = updatedState.buyOffers.map((o, idx) => ({
                id: `ebay-cash-${Date.now()}-${idx}`,
                title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
                price: Number(o.price)
              }));
              newVoucherOffers = newCashOffers.map(offer => ({
                id: `ebay-voucher-${offer.id}`,
                title: offer.title,
                price: Number((offer.price * 1.10).toFixed(2))
              }));
            }
          }
        }

        const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;

        let newSelectedOfferId = i.selectedOfferId;
        let newManualOffer = i.manualOffer;

        if (updatedState.selectedOfferIndex !== undefined && updatedState.selectedOfferIndex !== null) {
          if (updatedState.selectedOfferIndex === 'manual') {
            newSelectedOfferId = 'manual';
            newManualOffer = updatedState.manualOffer || i.manualOffer;
          } else if (typeof updatedState.selectedOfferIndex === 'number') {
            if (hasCeXBasedOffers) {
              const clickedPrice = updatedState.buyOffers?.[updatedState.selectedOfferIndex]?.price;
              if (clickedPrice != null) {
                newManualOffer = Number(clickedPrice).toFixed(2);
                newSelectedOfferId = 'manual';
              }
            } else {
              const selectedOffer = displayOffers[updatedState.selectedOfferIndex];
              if (selectedOffer) {
                newSelectedOfferId = selectedOffer.id;
              }
            }
          }
        } else {
          if (updatedState.manualOffer !== undefined) {
            newManualOffer = updatedState.manualOffer;
          }
          const prevOffers = useVoucherOffers ? (i.voucherOffers || i.offers) : (i.cashOffers || i.offers);
          const prevIdx = prevOffers?.findIndex(o => o.id === i.selectedOfferId);
          if (prevIdx >= 0 && displayOffers[prevIdx]) {
            newSelectedOfferId = displayOffers[prevIdx].id;
          }
        }

        return {
          ...i,
          ebayResearchData: updatedState,
          cashOffers: newCashOffers,
          voucherOffers: newVoucherOffers,
          offers: displayOffers,
          manualOffer: newManualOffer,
          selectedOfferId: newSelectedOfferId,
        };
      }));

      maybeShowSalePriceConfirm(
        updatedState,
        currentItem,
        researchItem,
        setSalePriceConfirmModal,
        resolveOurSalePrice,
        'ebay'
      );
    }
    setResearchItem(null);
  };

  const handleReopenCashConvertersResearch = (item) => {
    setCashConvertersResearchItem(item);
  };

  const handleCashConvertersResearchComplete = (updatedState) => {
    if (updatedState && !updatedState.cancel && cashConvertersResearchItem && mode !== 'view') {
      const currentItem = items.find(i => i.id === cashConvertersResearchItem.id);

      setItems(prevItems => prevItems.map(i => {
        if (i.id !== cashConvertersResearchItem.id) return i;

        let newManualOffer = i.manualOffer;
        let newSelectedOfferId = i.selectedOfferId;

        if (updatedState.selectedOfferIndex !== undefined && updatedState.selectedOfferIndex !== null) {
          if (updatedState.selectedOfferIndex === 'manual') {
            newManualOffer = updatedState.manualOffer || i.manualOffer;
            newSelectedOfferId = 'manual';
          } else if (typeof updatedState.selectedOfferIndex === 'number') {
            const clickedPrice = updatedState.buyOffers?.[updatedState.selectedOfferIndex]?.price;
            if (clickedPrice != null) {
              newManualOffer = Number(clickedPrice).toFixed(2);
              newSelectedOfferId = 'manual';
            }
          }
        } else if (updatedState.manualOffer) {
          newManualOffer = updatedState.manualOffer;
          newSelectedOfferId = 'manual';
        }

        const hasExistingOffers =
          (i.cashOffers && i.cashOffers.length > 0) ||
          (i.voucherOffers && i.voucherOffers.length > 0) ||
          (i.offers && i.offers.length > 0);

        let newCashOffers = i.cashOffers || [];
        let newVoucherOffers = i.voucherOffers || [];
        if (!hasExistingOffers && updatedState.buyOffers && updatedState.buyOffers.length > 0) {
          newCashOffers = updatedState.buyOffers.map((o, idx) => ({
            id: `cc-cash-${Date.now()}-${idx}`,
            title: ["1st Offer", "2nd Offer", "3rd Offer"][idx] || "Offer",
            price: Number(o.price)
          }));
          newVoucherOffers = newCashOffers.map(offer => ({
            id: `cc-voucher-${offer.id}`,
            title: offer.title,
            price: Number((offer.price * 1.10).toFixed(2))
          }));
        }
        const displayOffers = useVoucherOffers ? newVoucherOffers : newCashOffers;

        return {
          ...i,
          cashConvertersResearchData: updatedState,
          cashOffers: newCashOffers,
          voucherOffers: newVoucherOffers,
          offers: displayOffers,
          manualOffer: newManualOffer,
          selectedOfferId: newSelectedOfferId,
        };
      }));

      maybeShowSalePriceConfirm(
        updatedState,
        currentItem,
        cashConvertersResearchItem,
        setSalePriceConfirmModal,
        resolveOurSalePrice,
        'cashConverters'
      );
    }
    setCashConvertersResearchItem(null);
  };

  const calculateTotalFromItems = () => {
    return items.reduce((sum, item) => {
      if (item.isRemoved) return sum;
      if (item.customerExpectation) {
        const value = parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0;
        const quantity = item.quantity || 1;
        return sum + value * quantity;
      }
      return sum;
    }, 0);
  };

  const calculateTotalOfferPrice = (sourceItems) => {
    return sourceItems.reduce((sum, item) => {
      if (item.isRemoved) return sum;
      const quantity = item.quantity || 1;

      if (item.selectedOfferId === 'manual' && item.manualOffer) {
        const manualValue = parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0;
        return sum + manualValue * quantity;
      }

      const displayOffers = useVoucherOffers
        ? item.voucherOffers || item.offers
        : item.cashOffers || item.offers;

      const selected = displayOffers?.find((o) => o.id === item.selectedOfferId);
      return sum + (selected ? selected.price * quantity : 0);
    }, 0);
  };

  useEffect(() => {
    const total = calculateTotalFromItems();
    if (total > 0) {
      setTotalExpectation(total.toFixed(2));
    } else if (mode === 'view' && customerData?.id) {
        setTotalExpectation(customerData.overall_expectation_gbp?.toFixed(2) || "");
    }
  }, [items, mode, customerData]);

  // Keep draft payload ref updated and auto-save when data changes (debounced)
  useEffect(() => {
    if (mode !== 'negotiate' || !actualRequestId || items.length === 0) {
      draftPayloadRef.current = null;
      return;
    }
    const total = calculateTotalOfferPrice(items);
    const payload = buildFinishPayload(total);
    draftPayloadRef.current = payload;

    if (payload.items_data?.length === 0) return;

    const timer = setTimeout(() => {
      if (completedRef.current) return;
      saveQuoteDraft(actualRequestId, payload).catch((err) => {
        console.warn('Quote draft save failed:', err);
      });
    }, 800);

    return () => clearTimeout(timer);
  }, [items, totalExpectation, targetOffer, transactionType, mode, actualRequestId]);

  // Save quote draft on unmount (SPA navigation away) and on tab/window close
  useEffect(() => {
    if (mode !== 'negotiate' || !actualRequestId) return;

    const saveDraft = (opts = {}) => {
      if (completedRef.current) return;
      const payload = draftPayloadRef.current;
      if (payload) {
        saveQuoteDraft(actualRequestId, payload, opts).catch(() => {});
      }
    };

    const handleUnload = () => saveDraft({ keepalive: true });

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      saveDraft();
    };
  }, [mode, actualRequestId]);

  if (isLoading) {
    return (
        <div className="bg-ui-bg min-h-screen flex items-center justify-center">
            <p>Loading request details...</p>
        </div>
    );
  }



  const parsedTarget = parseFloat(targetOffer) || 0;
  const totalOfferPrice = calculateTotalOfferPrice(items);
  // Target must be matched exactly (within a small tolerance).
  const hasTarget = parsedTarget > 0;
  const targetDelta = hasTarget ? totalOfferPrice - parsedTarget : 0;
  const targetMatched = hasTarget && Math.abs(targetDelta) <= 0.005;
  const targetShortfall = hasTarget && totalOfferPrice < parsedTarget ? parsedTarget - totalOfferPrice : 0;
  const targetExcess = hasTarget && totalOfferPrice > parsedTarget ? totalOfferPrice - parsedTarget : 0;

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        :root {
          --brand-blue: #144584;
          --brand-blue-hover: #0d315e;
          --brand-orange: #f7b918;
          --brand-orange-hover: #e5ab14;
          --ui-bg: #f8f9fa;
          --ui-card: #ffffff;
          --ui-border: #e5e7eb;
          --text-main: #1a1a1a;
          --text-muted: #64748b;
        }
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #144584; }
        .spreadsheet-table th {
          background: var(--brand-blue);
          color: white;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.75rem;
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .spreadsheet-table th:last-child {
          border-right: 0;
        }
        .spreadsheet-table td {
          padding: 0.5rem 0.75rem;
          border-right: 1px solid var(--ui-border);
          vertical-align: middle;
        }
        .spreadsheet-table td:last-child {
          border-right: 0;
        }
        .spreadsheet-table tr {
          border-bottom: 1px solid var(--ui-border);
        }
        .spreadsheet-table tr:hover {
          background: rgba(20, 69, 132, 0.05);
        }
        .total-expectation-row {
          background: rgba(247, 185, 24, 0.05);
          border-bottom: 2px solid rgba(247, 185, 24, 0.2);
        }
        .total-expectation-row td {
          background: rgba(247, 185, 24, 0.1);
          border-right-color: rgba(247, 185, 24, 0.1);
        }
      `}</style>

      {/* Header */}
      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        {/* Main Table Section */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Top Controls Section */}
          <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center justify-between gap-6">
              {/* Back Button */}
              <button
                onClick={() => navigate(
                  mode === 'view' ? '/requests-overview' : '/buyer',
                  {
                    state: mode === 'negotiate' ? {
                      preserveCart: true,
                      cartItems: items,
                      customerData,
                      currentRequestId: actualRequestId
                    } : undefined
                  }
                )}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all ${mode === 'view' ? '' : 'hover:shadow-md'}`}
                style={{ borderColor: 'var(--ui-border)', color: 'var(--brand-blue)' }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                {mode === 'view' ? 'Back to Requests' : 'Back to Cart'}
              </button>

              {/* Customer Total Expectation + Target Offer */}
              <div className="flex-1 max-w-xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border" style={{
                    borderColor: 'rgba(247, 185, 24, 0.5)',
                    background: 'rgba(247, 185, 24, 0.05)'
                  }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--brand-blue)' }}>
                      Customer Total Expectation
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <input
                        className="w-full pl-8 pr-3 py-2.5 bg-white rounded-lg text-lg font-bold focus:ring-2"
                        style={{
                          border: '1px solid rgba(247, 185, 24, 0.3)',
                          color: 'var(--brand-blue)',
                          outline: 'none'
                        }}
                        type="text"
                        value={totalExpectation}
                        onChange={(e) => setTotalExpectation(e.target.value)}
                        placeholder="0.00"
                        readOnly={mode === 'view'}
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border" style={{
                    borderColor: 'rgba(20, 69, 132, 0.2)',
                    background: 'rgba(20, 69, 132, 0.02)'
                  }}>
                    <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--brand-blue)' }}>
                      Target Offer
                    </label>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      {parsedTarget > 0 ? 'Exact total offer required' : 'Not set'}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
                      <span className="text-2xl font-black tracking-tight" style={{ color: 'var(--brand-blue)' }}>
                        {parsedTarget > 0 ? parsedTarget.toFixed(2) : '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Request ID Info */}
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Request ID
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>
                  #{actualRequestId || 'N/A'}
                </p>
                {mode === 'view' && (
                  <p className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-widest text-red-600">
                    <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                    View Only
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-auto flex-1">
            <table className="w-full spreadsheet-table border-collapse text-left">
              <thead>
                <tr>
                  <th className="w-12 text-center">Qty</th>
                  <th className="min-w-[220px]">Item Name &amp; Attributes</th>
                  <th className="w-24">CeX Buy (Cash)</th>
                  <th className="w-24">CeX Buy (Voucher)</th>
                  <th className="w-24">CeX Sell</th>
                  <th className="w-24">1st Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-24">2nd Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-24">3rd Offer {useVoucherOffers ? '(Voucher)' : '(Cash)'}</th>
                  <th className="w-36">Manual Offer</th>
                  <th className="w-32">Customer Expectation</th>
                  <th className="w-24">Our Sale Price</th>
                  <th className="w-36">eBay Price</th>
                  <th className="w-36">Cash Converters</th>
                </tr>
              </thead>
              <tbody className="text-xs">

                {/* Item Rows */}
                {items.map((item, index) => {
                  const quantity = item.quantity || 1;

                  const displayOffers = useVoucherOffers
                    ? (item.voucherOffers || item.offers)
                    : (item.cashOffers || item.offers);

                  const selectedOffer = displayOffers?.find(o => o.id === item.selectedOfferId);
                  const ebayData = item.ebayResearchData;
                  const offer1 = displayOffers?.[0];
                  const offer2 = displayOffers?.[1];
                  const offer3 = displayOffers?.[2];
                  const isViewMode = mode === 'view';

                  const cexOutOfStock = item.cexOutOfStock || item.cexProductData?.isOutOfStock || false;

                  const ourSalePrice = resolveOurSalePrice(item);

                  const calculateMargin = (offerPrice) => {
                    if (!ourSalePrice || !offerPrice || ourSalePrice <= 0) return null;
                    return ((ourSalePrice - offerPrice) / ourSalePrice) * 100;
                  };

                  const manualValue = item.manualOffer ? parseFloat(item.manualOffer.replace(/[£,]/g, '')) : null;
                  const manualMargin = manualValue ? calculateMargin(manualValue) : null;
                  const manualExceedsSale = ourSalePrice && manualValue && manualValue > ourSalePrice;

                  return (
                    <tr
                      key={item.id || index}
                      className={item.isRemoved ? 'opacity-60' : ''}
                      style={item.isRemoved ? { textDecoration: 'line-through' } : {}}
                      onContextMenu={mode === 'negotiate' ? (e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, item });
                      } : undefined}
                    >
                      {/* Qty */}
                      <td className="text-center">
                        {mode === 'view' ? (
                          <span className="font-bold">{quantity}</span>
                        ) : (
                          <input
                            className="w-12 text-center border rounded px-1 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]"
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const parsed = parseInt(raw, 10);
                              const safeQuantity = Number.isNaN(parsed) || parsed <= 0 ? 1 : parsed;
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, quantity: safeQuantity } : i
                                )
                              );
                            }}
                          />
                        )}
                      </td>

                      {/* Item Name & Attributes */}
                      <td>
                        <div className="font-bold text-[13px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--brand-blue)' }}>
                          {item.title || 'N/A'}
                          {item.isRemoved && (
                            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              Removed from cart
                            </span>
                          )}
                          {cexOutOfStock && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                              CeX out of stock
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {(item.cexBuyPrice != null || item.cexSellPrice != null) ? (item.subtitle || '') : (item.subtitle || item.category || 'No details')} {item.model && `| ${item.model}`}
                        </div>
                        {mode === 'negotiate' && (
                          <div className="text-[9px] mt-1 text-slate-400 italic">Click manual offer field or right-click to set</div>
                        )}
                      </td>

                      {/* CeX Buy (Cash) */}
                      <td className="font-medium text-emerald-700 align-top">
                        {item.cexBuyPrice != null ? (
                          <div>
                            <div>£{(item.cexBuyPrice * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">(£{item.cexBuyPrice.toFixed(2)} × {quantity})</div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* CeX Buy (Voucher) */}
                      <td className="font-medium text-amber-700 align-top">
                        {item.cexVoucherPrice != null ? (
                          <div>
                            <div>£{(item.cexVoucherPrice * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">(£{item.cexVoucherPrice.toFixed(2)} × {quantity})</div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* CeX Sell */}
                      <td className="font-medium text-blue-800 align-top">
                        {item.cexSellPrice != null ? (
                          <div>
                            {item.cexUrl ? (
                              <a href={item.cexUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted">
                                £{(item.cexSellPrice * quantity).toFixed(2)}
                              </a>
                            ) : (
                              <div>£{(item.cexSellPrice * quantity).toFixed(2)}</div>
                            )}
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">(£{item.cexSellPrice.toFixed(2)} × {quantity})</div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* 1st/2nd/3rd Offer + Manual Offer + Customer Expectation + Our Sale Price */}
                      <>
                          {/* 1st Offer */}
                          <td
                            className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                            style={item.selectedOfferId === offer1?.id ? {
                              background: 'rgba(34, 197, 94, 0.15)',
                              fontWeight: 'bold',
                              color: '#166534'
                            } : {}}
                            onClick={() => {
                              if (!offer1 || mode === 'view') return;
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, selectedOfferId: offer1.id } : i
                                )
                              );
                            }}
                          >
                            {offer1 ? (
                              <div>
                                <div>£{(offer1.price * quantity).toFixed(2)}</div>
                                {(() => {
                                  const margin = calculateMargin(offer1.price);
                                  return margin !== null ? (
                                    <div className="text-[9px] font-medium" style={{ color: margin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
                                      {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                    </div>
                                  ) : null;
                                })()}
                                {quantity > 1 && (
                                  <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>(£{offer1.price.toFixed(2)} × {quantity})</div>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* 2nd Offer */}
                          <td
                            className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                            style={item.selectedOfferId === offer2?.id ? {
                              background: 'rgba(34, 197, 94, 0.15)',
                              fontWeight: 'bold',
                              color: '#166534'
                            } : {}}
                            onClick={() => {
                              if (!offer2 || mode === 'view') return;
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, selectedOfferId: offer2.id } : i
                                )
                              );
                            }}
                          >
                            {offer2 ? (
                              <div>
                                <div>£{(offer2.price * quantity).toFixed(2)}</div>
                                {(() => {
                                  const margin = calculateMargin(offer2.price);
                                  return margin !== null ? (
                                    <div className="text-[9px] font-medium" style={{ color: margin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
                                      {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                    </div>
                                  ) : null;
                                })()}
                                {quantity > 1 && (
                                  <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>(£{offer2.price.toFixed(2)} × {quantity})</div>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* 3rd Offer */}
                          <td
                            className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                            style={item.selectedOfferId === offer3?.id ? {
                              background: 'rgba(34, 197, 94, 0.15)',
                              fontWeight: 'bold',
                              color: '#166534'
                            } : {}}
                            onClick={() => {
                              if (!offer3 || mode === 'view') return;
                              setItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, selectedOfferId: offer3.id } : i
                                )
                              );
                            }}
                          >
                            {offer3 ? (
                              <div>
                                <div>£{(offer3.price * quantity).toFixed(2)}</div>
                                {(() => {
                                  const margin = calculateMargin(offer3.price);
                                  return margin !== null ? (
                                    <div className="text-[9px] font-medium" style={{ color: margin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
                                      {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                    </div>
                                  ) : null;
                                })()}
                                {quantity > 1 && (
                                  <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>(£{offer3.price.toFixed(2)} × {quantity})</div>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* Manual Offer */}
                          <td
                            className={`relative ${mode === 'negotiate' ? 'cursor-pointer' : ''}`}
                            onClick={mode === 'negotiate' ? (e) => { e.stopPropagation(); setItemOfferModal({ item }); } : undefined}
                            role={mode === 'negotiate' ? 'button' : undefined}
                            tabIndex={mode === 'negotiate' ? 0 : undefined}
                            onKeyDown={mode === 'negotiate' ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setItemOfferModal({ item }); } } : undefined}
                          >
                            {item.manualOffer && item.selectedOfferId === 'manual' ? (
                              <div
                                className="rounded px-2 py-1.5 text-xs font-bold text-center"
                                style={{
                                  background: manualExceedsSale ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.15)',
                                  color: manualExceedsSale ? '#dc2626' : '#166534',
                                  border: manualExceedsSale ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.4)'
                                }}
                              >
                                {mode === 'view' && (item.manualOfferUsed || item.selectedOfferId === 'manual') && (
                                  <div className="text-[9px] font-normal opacity-80 mb-0.5" style={{ color: 'inherit' }}>Manual offer</div>
                                )}
                                <div className="flex items-center justify-center gap-1">
                                  £{(parseFloat(item.manualOffer) * quantity).toFixed(2)}
                                  {manualExceedsSale && (
                                    <span className="material-symbols-outlined text-red-500 text-[14px]" title={item.seniorMgmtApprovedBy ? `Exceeds sale price — approved by ${item.seniorMgmtApprovedBy}` : 'Exceeds sale price — approved by senior management'}>warning</span>
                                  )}
                                </div>
                                {quantity > 1 && (
                                  <div className="text-[9px] opacity-70 mt-0.5">(£{parseFloat(item.manualOffer).toFixed(2)} × {quantity})</div>
                                )}
                                {manualMargin !== null && (
                                  <div className="text-[9px] font-semibold mt-0.5" style={{ color: manualMargin >= 0 ? 'var(--brand-blue)' : '#dc2626' }}>
                                    {manualMargin >= 0 ? '+' : ''}{manualMargin.toFixed(1)}% margin
                                    {ourSalePrice && ` (£${Math.abs(ourSalePrice - parseFloat(item.manualOffer)).toFixed(2)})`}
                                  </div>
                                )}
                                {(item.seniorMgmtApprovedBy || (manualExceedsSale && mode === 'view')) && (
                                  <div className="text-[9px] mt-1 font-semibold" style={{ color: manualExceedsSale ? '#b91c1c' : 'var(--text-muted)' }}>
                                    {item.seniorMgmtApprovedBy ? `Approved by: ${item.seniorMgmtApprovedBy}` : 'Approved by senior management'}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center text-slate-400 text-[11px]">
                                {mode === 'negotiate' ? (
                                  <span className="italic">Click or right-click to set</span>
                                ) : '—'}
                              </div>
                            )}
                          </td>

                          {/* Customer Expectation */}
                          <td className="p-0">
                            <input
                              className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
                              style={{ background: '#f8fafc', outline: 'none' }}
                              placeholder="£0.00"
                              type="text"
                              value={item.customerExpectation || ''}
                              onChange={mode === 'view' ? undefined : (e) => {
                                const value = e.target.value;
                                setItems(prev =>
                                  prev.map(i => i.id === item.id ? { ...i, customerExpectation: value } : i)
                                );
                              }}
                              readOnly={mode === 'view'}
                            />
                          </td>

                          {/* Our Sale Price */}
                          <td className="font-medium text-purple-700">
                            {(() => {
                              const perUnitOurPrice =
                                item.ourSalePrice === ''
                                  ? null
                                  : (item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
                                      ? Number(item.ourSalePrice)
                                      : (item.useResearchSuggestedPrice !== false && item.ebayResearchData?.stats?.suggestedPrice != null
                                          ? Number(item.ebayResearchData.stats.suggestedPrice)
                                          : null));

                              const totalOurPrice =
                                perUnitOurPrice != null && !Number.isNaN(perUnitOurPrice)
                                  ? perUnitOurPrice * quantity
                                  : null;

                              const isEditingRowTotal = item.ourSalePriceInput !== undefined;
                              const inputValue = isEditingRowTotal
                                ? item.ourSalePriceInput
                                : (totalOurPrice != null && !Number.isNaN(totalOurPrice) ? totalOurPrice.toFixed(2) : '');

                              if (mode === 'view') {
                                return perUnitOurPrice != null ? (
                                  <div>
                                    <div>£{(perUnitOurPrice * quantity).toFixed(2)}</div>
                                    {quantity > 1 && (
                                      <div className="text-[9px] opacity-70">(£{perUnitOurPrice.toFixed(2)} × {quantity})</div>
                                    )}
                                  </div>
                                ) : '—';
                              }

                              const handleOurSalePriceBlur = () => {
                                const raw = (item.ourSalePriceInput ?? inputValue).replace(/[£,]/g, '').trim();
                                const parsedTotal = parseFloat(raw);
                                const safeQuantity = quantity || 1;
                                setItems(prev =>
                                  prev.map(i => {
                                    if (i.id !== item.id) return i;
                                    const next = { ...i };
                                    delete next.ourSalePriceInput;
                                    if (raw === '' || Number.isNaN(parsedTotal) || parsedTotal <= 0) {
                                      next.ourSalePrice = '';
                                      return next;
                                    }
                                    next.ourSalePrice = (parsedTotal / safeQuantity).toFixed(2);
                                    return next;
                                  })
                                );
                              };

                              return (
                                <div>
                                  <input
                                    className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0 bg-white rounded"
                                    placeholder="£0.00"
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => {
                                      const value = e.target.value.replace(/[£,]/g, '').trim();
                                      setItems(prev =>
                                        prev.map(i => i.id === item.id ? { ...i, ourSalePriceInput: value } : i)
                                      );
                                    }}
                                    onBlur={handleOurSalePriceBlur}
                                    onFocus={() => {
                                      if (item.ourSalePriceInput === undefined && inputValue !== '') {
                                        setItems(prev =>
                                          prev.map(i => i.id === item.id ? { ...i, ourSalePriceInput: inputValue } : i)
                                        );
                                      }
                                    }}
                                  />
                                  {!isEditingRowTotal && totalOurPrice != null && !Number.isNaN(totalOurPrice) && (
                                    <div className="text-[9px] opacity-70 mt-0.5">
                                      £{totalOurPrice.toFixed(2)}
                                      {quantity > 1 && (
                                        <span>{` ( £${perUnitOurPrice != null && !Number.isNaN(perUnitOurPrice) ? perUnitOurPrice.toFixed(2) : '0.00'} × ${quantity} )`}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </>

                      {/* eBay Research */}
                      <td>
                        {ebayData?.stats?.median ? (
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-[13px] font-bold" style={{ color: 'var(--brand-blue)' }}>
                                £{(Number(ebayData.stats.median) * quantity).toFixed(2)}
                              </div>
                              {quantity > 1 && (
                                <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                  (£{Number(ebayData.stats.median).toFixed(2)} × {quantity})
                                </div>
                              )}
                            </div>
                            <button
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={() => handleReopenResearch(item)}
                              title={isViewMode ? 'View eBay Research (Read-only)' : 'View/Refine Research'}
                            >
                              <span className="material-symbols-outlined text-[16px]">edit_note</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
                            <button
                              className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!ebayData && mode === 'view' ? 'opacity-50 cursor-not-allowed' : ''}`}
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                              onClick={(!ebayData && mode === 'view') ? undefined : () => handleReopenResearch(item)}
                              title={(!ebayData && mode === 'view') ? 'No research available' : (!ebayData ? 'Research' : 'View eBay Research (Read-only)')}
                              disabled={!ebayData && mode === 'view'}
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Cash Converters */}
                      <td>
                        {(() => {
                          const cashConvertersData = item.cashConvertersResearchData;

                          return cashConvertersData?.stats?.median ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[13px] font-medium" style={{ color: 'var(--brand-blue)' }}>
                                <div>£{(Number(cashConvertersData.stats.median) * quantity).toFixed(2)}</div>
                                {quantity > 1 && (
                                  <div className="text-[9px] opacity-70">(£{Number(cashConvertersData.stats.median).toFixed(2)} × {quantity})</div>
                                )}
                              </div>
                              <button
                                className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                                style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                                onClick={() => handleReopenCashConvertersResearch(item)}
                                title={isViewMode ? 'View Cash Converters Research (Read-only)' : 'View/Refine Research'}
                              >
                                <span className="material-symbols-outlined text-[16px]">store</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
                              <button
                                className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!cashConvertersData && isViewMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                                onClick={(!cashConvertersData && isViewMode) ? undefined : () => handleReopenCashConvertersResearch(item)}
                                title={(!cashConvertersData && isViewMode) ? 'No research available' : (!cashConvertersData ? 'Research' : 'View Cash Converters Research (Read-only)')}
                                disabled={!cashConvertersData && isViewMode}
                              >
                                <span className="material-symbols-outlined text-[16px]">store</span>
                              </button>
                            </div>
                          );
                        })()}
                      </td>

                    </tr>
                  );
                })}

                <tr className="h-10 opacity-50"><td colSpan="13"></td></tr>
                <tr className="h-10 opacity-50"><td colSpan="13"></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Sidebar */}
        <aside className="w-80 border-l flex flex-col bg-white shrink-0" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
          <CustomerTransactionHeader
            customer={customerData}
            transactionType={transactionType}
            onTransactionChange={setTransactionType}
            readOnly={mode === 'view'}
          />

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
          </div>

          {/* Footer Actions */}
          <div className="p-6 bg-white border-t space-y-4" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
            {/* Grand Total */}
            <div
                className={`flex justify-between items-end ${mode === 'negotiate' ? 'cursor-pointer rounded-lg p-2 -mx-2 hover:bg-blue-50 transition-colors group' : ''}`}
                onClick={mode === 'negotiate' ? () => {
                  setTargetInput(targetOffer);
                  setShowTargetModal(true);
                } : undefined}
                title={mode === 'negotiate' ? 'Click to set target offer' : undefined}
              >
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>
                    Grand Total
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {mode === 'negotiate' ? 'Click to set target' : 'Based on selected offers'}
                  </span>
                </div>
                <div
                  className="text-right text-3xl font-black tracking-tighter leading-none"
                  style={{ color: 'var(--brand-blue)' }}
                >
                  <span>
                    £{totalOfferPrice.toFixed(2)}
                  </span>
                  {mode === 'negotiate' && (
                    <span
                      className="material-symbols-outlined ml-1 text-blue-300 group-hover:text-blue-600 transition-colors align-middle"
                      style={{ fontSize: 'inherit' }}
                    >
                      edit
                    </span>
                  )}
                </div>
              </div>

            {/* Target offer display */}
            {hasTarget && (
              <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${targetMatched ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <div>
                  <div className={`text-[10px] font-black uppercase tracking-wider ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>
                    Target Offer
                  </div>
                  {!targetMatched && (
                    <div className="text-[9px] text-red-600 font-medium">
                      {totalOfferPrice < parsedTarget
                        ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                        : `Grand total is too high by £${targetExcess.toFixed(2)}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xl font-black ${targetMatched ? 'text-emerald-700' : 'text-red-700'}`}>
                    £{parsedTarget.toFixed(2)}
                  </span>
                  <span className={`material-symbols-outlined text-[20px] ${targetMatched ? 'text-emerald-600' : 'text-red-500'}`}>
                    {targetMatched ? 'check_circle' : 'cancel'}
                  </span>
                  {mode === 'negotiate' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setTargetOffer(""); }}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove target"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${
                mode === 'view' || (hasTarget && !targetMatched)
                  ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)',
                boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)'
              }}
              onClick={mode === 'view' ? undefined : handleFinalizeTransaction}
              disabled={mode === 'view'}
            >
              <span className="text-base uppercase tracking-tight">Book for Testing</span>
              <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
            {hasTarget && !targetMatched && mode === 'negotiate' && (
              <p className="text-[10px] text-center text-red-600 font-semibold -mt-2">
                {totalOfferPrice < parsedTarget
                  ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                  : `Grand total is too high by £${targetExcess.toFixed(2)}`}
              </p>
            )}
          </div>
        </aside>
      </main>

      {/* ── Right-click context menu ── */}
      {contextMenu && (
        <ItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRemove={() => handleRemoveFromNegotiation(contextMenu.item)}
          onSetManualOffer={() => {
            setItemOfferModal({ item: contextMenu.item });
            setItemOfferInput("");
          }}
        />
      )}

      {/* ── Target Offer Modal ── */}
      {showTargetModal && (
        <TinyModal
          title="Set Target Total Offer"
          onClose={() => setShowTargetModal(false)}
        >
          <p className="text-xs text-slate-500 mb-4">
            What is the target total offer you want to achieve across all items?
          </p>
          <div className="relative mb-4">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
            <input
              autoFocus
              className="w-full pl-8 pr-3 py-2.5 border rounded-lg text-lg font-bold focus:outline-none focus:ring-2"
              style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseFloat(targetInput);
                  if (!isNaN(val) && val > 0) {
                    setTargetOffer(val.toFixed(2));
                    setShowTargetModal(false);
                  }
                }
              }}
            />
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
              onClick={() => setShowTargetModal(false)}
            >
              Cancel
            </button>
            <button
              className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors"
              style={{ background: 'var(--brand-blue)', color: 'white' }}
              onClick={() => {
                const val = parseFloat(targetInput);
                if (!isNaN(val) && val > 0) {
                  setTargetOffer(val.toFixed(2));
                  setShowTargetModal(false);
                }
              }}
            >
              Set Target
            </button>
          </div>
        </TinyModal>
      )}

      {/* ── Item Manual Offer Modal ── */}
      {itemOfferModal && (() => {
        const modalItem = itemOfferModal.item;
        const targetContribution = calculateItemTargetContribution(modalItem.id);
        const qty = modalItem.quantity || 1;
        const ourSalePrice = resolveOurSalePrice(modalItem);

        const modalDisplayOffers = useVoucherOffers
          ? (modalItem.voucherOffers || modalItem.offers)
          : (modalItem.cashOffers || modalItem.offers);
        const currentSelectedOffer = modalItem.selectedOfferId === 'manual' && modalItem.manualOffer
          ? parseFloat(modalItem.manualOffer.replace(/[£,]/g, ''))
          : modalDisplayOffers?.find(o => o.id === modalItem.selectedOfferId)?.price;
        const hasCurrentOffer = currentSelectedOffer != null && !isNaN(currentSelectedOffer);

        const handleApply = (perUnitValue) => {
          if (!perUnitValue || perUnitValue <= 0) {
            showNotification("Please enter a valid positive amount.", "error");
            return;
          }
          setItemOfferModal(null);
          applyManualOffer(modalItem, perUnitValue);
        };

        return (
          <TinyModal
            title={`Set Manual Offer`}
            onClose={() => setItemOfferModal(null)}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--brand-blue)' }}>
              {modalItem.title}
            </p>
            {ourSalePrice && (
              <p className={`text-[11px] text-slate-500 ${hasCurrentOffer ? 'mb-1' : 'mb-4'}`}>
                Our sale price: <span className="font-bold text-purple-700">£{ourSalePrice.toFixed(2)}</span>
              </p>
            )}
            {hasCurrentOffer && (
              <p className="text-[11px] text-slate-500 mb-4">
                Current selected offer: <span className="font-semibold" style={{ color: 'var(--brand-blue)' }}>
                  £{currentSelectedOffer.toFixed(2)}
                  {qty > 1 && ` per unit (£${(currentSelectedOffer * qty).toFixed(2)} total)`}
                </span>
              </p>
            )}

            {/* Meet target button */}
            {targetContribution !== null && (
              <div className="mb-4 p-3 rounded-lg border" style={{ borderColor: 'rgba(20,69,132,0.2)', background: 'rgba(20,69,132,0.03)' }}>
                <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--brand-blue)' }}>
                  Meet overall target (£{parsedTarget.toFixed(2)})
                </p>
                {targetContribution > 0 ? (
                  <>
                    <p className="text-xs text-slate-600 mb-2">
                      Set this item to <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>
                        £{targetContribution.toFixed(2)}
                      </span> total
                      {qty > 1 && ` (£${(targetContribution / qty).toFixed(2)} × ${qty})`}
                    </p>
                    <button
                      className="w-full py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                      style={{ background: 'var(--brand-blue)', color: 'white' }}
                      onClick={() => handleApply(targetContribution / qty)}
                    >
                      Apply — £{targetContribution.toFixed(2)} total
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-red-600">
                    Other items already exceed the target. Cannot meet target with this item alone.
                  </p>
                )}
              </div>
            )}

            <div className="relative mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                {targetContribution !== null ? 'Or enter a specific amount (row total):' : 'Enter a specific amount (row total):'}
              </p>
              <span className="absolute left-3 bottom-[9px] font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
              <input
                autoFocus={targetContribution === null}
                className="w-full pl-8 pr-3 py-2.5 border rounded-lg text-base font-bold focus:outline-none focus:ring-2"
                style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
                type="number"
                step="0.01"
                min="0"
                placeholder={qty > 1 ? `Row total for ${qty} items` : "0.00"}
                value={itemOfferInput}
                onChange={(e) => setItemOfferInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const rowTotal = parseFloat(itemOfferInput);
                    if (!isNaN(rowTotal) && rowTotal > 0) handleApply(rowTotal / qty);
                  }
                }}
              />
            </div>
            {qty > 1 && itemOfferInput && !isNaN(parseFloat(itemOfferInput)) && parseFloat(itemOfferInput) > 0 && (
              <p className="text-[11px] text-slate-500 mb-3">
                Per unit: <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>£{(parseFloat(itemOfferInput) / qty).toFixed(2)}</span>
              </p>
            )}
            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
                style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
                onClick={() => setItemOfferModal(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                onClick={() => {
                  const rowTotal = parseFloat(itemOfferInput);
                  if (!isNaN(rowTotal) && rowTotal > 0) handleApply(rowTotal / qty);
                }}
              >
                Apply
              </button>
            </div>
          </TinyModal>
        );
      })()}

      {/* ── Senior Management Bypass Modal ── */}
      {seniorMgmtModal && (() => {
        const { item, proposedPerUnit } = seniorMgmtModal;
        const salePrice = resolveOurSalePrice(item);
        const qty = item.quantity || 1;

        return (
          <TinyModal
            title="Override Confirmation Required"
            onClose={() => setSeniorMgmtModal(null)}
          >
            <div className="rounded-lg p-3 mb-4 bg-red-50 border border-red-200">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-red-500 shrink-0">warning</span>
                <div>
                  <p className="text-xs font-bold text-red-700 mb-1">
                    Offer exceeds sale price
                  </p>
                  <p className="text-[11px] text-red-600">
                    Proposed offer: <strong>£{(proposedPerUnit * qty).toFixed(2)}</strong>
                    {qty > 1 && ` (£${proposedPerUnit.toFixed(2)} × ${qty})`}
                  </p>
                  {salePrice && (
                    <p className="text-[11px] text-red-600">
                      Our sale price: <strong>£{(salePrice * qty).toFixed(2)}</strong>
                    </p>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              This offer exceeds our sale price. To proceed, please confirm it has been approved by a senior manager and enter their name below.
            </p>
            <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--brand-blue)' }}>
              Approved by (name)*
            </label>
            <input
              autoFocus
              className="w-full px-3 py-2.5 border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 mb-4"
              style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
              type="text"
              placeholder="Senior manager's name"
              value={seniorMgmtName}
              onChange={(e) => setSeniorMgmtName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && seniorMgmtName.trim()) {
                  setSeniorMgmtModal(null);
                  applyManualOffer(item, proposedPerUnit, seniorMgmtName.trim());
                }
              }}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
                style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
                onClick={() => setSeniorMgmtModal(null)}
              >
                Cancel
              </button>
              <button
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${!seniorMgmtName.trim() ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
                style={{ background: '#dc2626', color: 'white' }}
                disabled={!seniorMgmtName.trim()}
                onClick={() => {
                  if (!seniorMgmtName.trim()) return;
                  setSeniorMgmtModal(null);
                  applyManualOffer(item, proposedPerUnit, seniorMgmtName.trim());
                }}
              >
                Confirm Override
              </button>
            </div>
          </TinyModal>
        );
      })()}

      {/* ── Margin Result Confirmation Modal ── */}
      {marginResultModal && (() => {
        const { item, offerPerUnit, ourSalePrice, marginPct, marginGbp, confirmedBy } = marginResultModal;
        const qty = item.quantity || 1;
        const isPositiveMargin = marginPct >= 0;

        return (
          <TinyModal
            title="Manual Offer Applied"
            onClose={() => setMarginResultModal(null)}
          >
            <div className="mb-4">
              <p className="text-xs font-bold mb-3" style={{ color: 'var(--brand-blue)' }}>{item.title}</p>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Manual offer</span>
                  <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>
                    £{(offerPerUnit * qty).toFixed(2)}
                    {qty > 1 && ` (£${offerPerUnit.toFixed(2)} × ${qty})`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Our sale price</span>
                  <span className="font-bold text-purple-700">£{(ourSalePrice * qty).toFixed(2)}</span>
                </div>
                <div className="border-t pt-2" style={{ borderColor: 'var(--ui-border)' }}>
                  <div className="flex justify-between text-sm font-bold">
                    <span style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>
                      Margin
                    </span>
                    <div className="text-right">
                      <div style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>
                        {isPositiveMargin ? '+' : ''}{marginPct.toFixed(1)}%
                      </div>
                      <div className="text-xs font-semibold" style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>
                        {isPositiveMargin ? '+' : '-'}£{Math.abs(marginGbp * qty).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {confirmedBy && (
                <div className="mt-3 p-2 rounded bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-amber-700">
                    <span className="font-bold">Senior management override</span> confirmed by: {confirmedBy}
                  </p>
                </div>
              )}
            </div>

            <button
              className="w-full py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
              style={{ background: 'var(--brand-blue)', color: 'white' }}
              onClick={() => setMarginResultModal(null)}
            >
              OK
            </button>
          </TinyModal>
        );
      })()}

      <SalePriceConfirmModal
        modalState={salePriceConfirmModal}
        items={items}
        setItems={setItems}
        onClose={() => setSalePriceConfirmModal(null)}
        useResearchSuggestedPrice={true}
      />

      {/* Research Modal Overlay */}
      {researchItem && (
        <EbayResearchForm
          mode="modal"
          category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
          savedState={researchItem.ebayResearchData}
          onComplete={handleResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
          showManualOffer={true}
          initialSearchQuery={buildInitialSearchQuery(researchItem)}
          marketComparisonContext={{
            cexSalePrice: researchItem?.cexSellPrice ?? null,
            ourSalePrice: researchItem?.ourSalePrice ?? null,
            ebaySalePrice: researchItem?.ebayResearchData?.stats?.median ?? null,
            cashConvertersSalePrice: researchItem?.cashConvertersResearchData?.stats?.median ?? null,
            itemTitle: researchItem?.title || null,
            itemCondition: researchItem?.condition || null,
            itemSpecs: researchItem?.isCustomCeXItem ? null : buildItemSpecs(researchItem),
            cexSpecs: researchItem?.isCustomCeXItem ? buildItemSpecs(researchItem) : null,
            ebaySearchTerm: researchItem?.ebayResearchData?.searchTerm || null,
            cashConvertersSearchTerm: researchItem?.cashConvertersResearchData?.searchTerm || null,
          }}
        />
      )}

      {/* New Customer Details Modal */}
      <NewCustomerDetailsModal
        open={showNewCustomerDetailsModal}
        onClose={() => {
          setShowNewCustomerDetailsModal(false);
          setPendingFinishPayload(null);
        }}
        onSubmit={handleNewCustomerDetailsSubmit}
        initialName={customerData?.name || ""}
      />

      {/* Cash Converters Research Modal Overlay */}
      {cashConvertersResearchItem && (
        <CashConvertersResearchForm
          mode="modal"
          category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
          savedState={cashConvertersResearchItem.cashConvertersResearchData}
          onComplete={handleCashConvertersResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
          showManualOffer={true}
          initialSearchQuery={cashConvertersResearchItem?.ebayResearchData?.searchTerm || cashConvertersResearchItem?.ebayResearchData?.lastSearchedTerm || cashConvertersResearchItem?.title || undefined}
          marketComparisonContext={{
            cexSalePrice: cashConvertersResearchItem?.cexSellPrice ?? null,
            ourSalePrice: cashConvertersResearchItem?.ourSalePrice ?? null,
            ebaySalePrice: cashConvertersResearchItem?.ebayResearchData?.stats?.median ?? null,
            cashConvertersSalePrice: cashConvertersResearchItem?.cashConvertersResearchData?.stats?.median ?? null,
            itemTitle: cashConvertersResearchItem?.title || null,
            itemCondition: cashConvertersResearchItem?.condition || null,
            itemSpecs: cashConvertersResearchItem?.isCustomCeXItem ? null : buildItemSpecs(cashConvertersResearchItem),
            cexSpecs: cashConvertersResearchItem?.isCustomCeXItem ? buildItemSpecs(cashConvertersResearchItem) : null,
            ebaySearchTerm: cashConvertersResearchItem?.ebayResearchData?.searchTerm || null,
            cashConvertersSearchTerm: cashConvertersResearchItem?.cashConvertersResearchData?.searchTerm || null,
          }}
        />
      )}
    </div>
  );
};

export default Negotiation;
