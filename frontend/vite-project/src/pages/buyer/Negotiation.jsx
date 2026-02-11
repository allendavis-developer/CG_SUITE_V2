import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { Button, Icon, Header } from "@/components/ui/components";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import { CustomDropdown } from "@/components/ui/components";
import CustomerTransactionHeader from './components/CustomerTransactionHeader'
import { finishRequest, fetchRequestDetail } from '@/services/api';
import { useNotification } from '@/contexts/NotificationContext';


const TRANSACTION_OPTIONS = [
  { value: 'sale', label: 'Direct Sale' },
  { value: 'buyback', label: 'Buy Back' },
  { value: 'store_credit', label: 'Store Credit' }
];

const TRANSACTION_META = {
  sale: 'text-emerald-600',
  buyback: 'text-purple-600',
  store_credit: 'text-blue-600'
};



const Negotiation = ({ mode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId: paramsRequestId } = useParams(); // Get requestId from URL params
  const { cartItems, customerData: initialCustomerData, currentRequestId: initialRequestId } = location.state || {};
  
  // Determine the actual requestId to use (from params if in view mode, else from location state)
  const actualRequestId = mode === 'view' ? paramsRequestId : initialRequestId;

  const [items, setItems] = useState([]); // Initialize empty
  const [customerData, setCustomerData] = useState({}); // Initialize empty
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [totalExpectation, setTotalExpectation] = useState("");
  const [transactionType, setTransactionType] = useState('sale'); // Default to 'sale'
  const [isLoading, setIsLoading] = useState(true); // Always start loading, then set to false once initialized for any mode

  const { showNotification } = useNotification();

  // Determine if we should show voucher offers
  const useVoucherOffers = transactionType === 'store_credit';

  // Function to handle finalizing the transaction
  const handleFinalizeTransaction = async () => {
    if (!actualRequestId) { // Use actualRequestId here
      console.error("No current request ID available to finalize.");
      return;
    }

    // --- Validation ---
    for (const item of items) {
      if (!item.selectedOfferId) {
        showNotification(`Please select an offer for item: ${item.title || 'Unknown Item'}`, 'error');
        return; // Stop if validation fails
      }

      if (item.selectedOfferId === 'manual') {
        const manualValue = parseFloat(item.manualOffer?.replace(/[£,]/g, '')) || 0;
        if (manualValue <= 0) {
          showNotification(`Please enter a valid manual offer for item: ${item.title || 'Unknown Item'}`, 'error');
          return; // Stop if validation fails
        }
      }
    }

    // Calculate negotiated_price_gbp for each item
    const itemsData = items.map(item => {
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

      return {
        request_item_id: item.request_item_id, // Use the backend-assigned request_item_id
        quantity: quantity,
        selected_offer_id: item.selectedOfferId,
        manual_offer_gbp: item.manualOffer ? (parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0) : null,
        customer_expectation_gbp: item.customerExpectation ? (parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0) : null,
        negotiated_price_gbp: negotiatedPrice * quantity,
        cash_offers_json: item.cashOffers || [],       // New dedicated field
        voucher_offers_json: item.voucherOffers || [], // New dedicated field
        raw_data: item.ebayResearchData || {},          // Only ebayResearchData
        cash_converters_data: item.cashConvertersResearchData || {} // Cash Converters research data
      };
    });

    const payload = {
      items_data: itemsData,
      overall_expectation_gbp: parseFloat(totalExpectation.replace(/[£,]/g, '')) || 0,
      negotiated_grand_total_gbp: totalOfferPrice // totalOfferPrice is already a number
    };

    try {
      await finishRequest(actualRequestId, payload); // Use actualRequestId here
      showNotification("Transaction finalized successfully and booked for testing!", 'success');
      navigate("/transaction-complete"); // Navigate to the new transaction complete page
    } catch (error) {
      console.error("Error finalizing transaction:", error);
      showNotification(`Failed to finalize transaction: ${error.message}`, 'error');
    }
  };

  useEffect(() => {
    if (mode === 'view' && actualRequestId) {
      const loadRequestDetails = async () => {
        setIsLoading(true);
        try {
          const data = await fetchRequestDetail(actualRequestId);
          if (data) {
            // Map backend data to frontend state format
            setCustomerData({
                id: data.customer_details.customer_id, // Corrected to customer_details
                name: data.customer_details.name, // Corrected to customer_details
                cancelRate: data.customer_details.cancel_rate, // Corrected to customer_details
                transactionType: (data.intent === 'DIRECT_SALE' ? 'sale' : data.intent === 'BUYBACK' ? 'buyback' : 'store_credit')
            });
            setTotalExpectation(data.overall_expectation_gbp?.toString() || '');
            setTransactionType(data.intent === 'DIRECT_SALE' ? 'sale' : data.intent === 'BUYBACK' ? 'buyback' : 'store_credit');

            const mappedItems = data.items.map(item => {
                const ebayResearchData = item.raw_data || null; // raw_data now contains only ebayResearchData
                const cashConvertersResearchData = item.cash_converters_data || null; // Cash Converters research data

                // Extract saved offers from dedicated fields
                let savedCashOffers = item.cash_offers_json || [];
                let savedVoucherOffers = item.voucher_offers_json || [];

                // --- NEW LOGIC FOR EBAY ITEMS WITH MISSING VOUCHER OFFERS ---
                // Check if it's an eBay research item based on raw_data presence
                // and if cash offers exist but voucher offers are missing, generate them.
                if (ebayResearchData && savedCashOffers.length > 0 && savedVoucherOffers.length === 0) {
                    savedVoucherOffers = savedCashOffers.map(offer => ({
                        id: `ebay-voucher-${offer.id}`, // Ensure unique IDs
                        title: offer.title,
                        price: Number((offer.price * 1.10).toFixed(2)) // 10% more, rounded to 2 decimal places
                    }));
                }
                // --- END NEW LOGIC ---

                // Determine the currently displayed offers based on transaction type (for local logic)
                const displayOffers = (transactionType === 'store_credit') ? savedVoucherOffers : savedCashOffers;

                // Prefer CeX data for title/subtitle when available, fall back to eBay research
                const cexTitle = item.variant_details?.title;
                const cexSubtitle = item.variant_details?.cex_sku;
                const ebaySubtitleFromFilters =
                    ebayResearchData
                        ? (Object.values(ebayResearchData.selectedFilters?.apiFilters || {})
                            .flat()
                            .join(' / ') ||
                           ebayResearchData.selectedFilters?.basic?.join(' / ') ||
                           'eBay Filters')
                        : null;

                return {
                    id: item.request_item_id,
                    request_item_id: item.request_item_id,
                    title: cexTitle || ebayResearchData?.searchTerm || cashConvertersResearchData?.searchTerm || 'N/A',
                    subtitle: cexSubtitle || ebaySubtitleFromFilters || 'No details',
                    quantity: item.quantity,
                    selectedOfferId: item.selected_offer_id,
                    manualOffer: item.manual_offer_gbp?.toString() || '',
                    customerExpectation: item.customer_expectation_gbp?.toString() || '',
                    ebayResearchData: ebayResearchData,
                    cashConvertersResearchData: cashConvertersResearchData, // Load Cash Converters data
                    cexBuyPrice: (mode === 'view' && item.cex_buy_cash_at_negotiation !== null)
                                ? parseFloat(item.cex_buy_cash_at_negotiation)
                                : (item.variant_details?.tradein_cash ? parseFloat(item.variant_details.tradein_cash) : null),
                    cexVoucherPrice: (mode === 'view' && item.cex_buy_voucher_at_negotiation !== null)
                                ? parseFloat(item.cex_buy_voucher_at_negotiation)
                                : (item.variant_details?.tradein_voucher ? parseFloat(item.variant_details.tradein_voucher) : null),
                    cexSellPrice: (mode === 'view' && item.cex_sell_at_negotiation !== null)
                                ? parseFloat(item.cex_sell_at_negotiation)
                                : (item.variant_details?.current_price_gbp ? parseFloat(item.variant_details.current_price_gbp) : null),
                    
                    offers: displayOffers, 
                    cashOffers: savedCashOffers, 
                    voucherOffers: savedVoucherOffers, 
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
        // For negotiate mode, initialize from location.state if state is currently empty
        // This prevents overwriting user selections during validation re-renders
        if (cartItems && cartItems.length > 0 && items.length === 0) { // Only set if items are empty and cartItems exist
            setItems(cartItems);
        }
        if (initialCustomerData?.id && !customerData?.id) { // Only set if customerData is empty and initialCustomerData exists
            setCustomerData(initialCustomerData);
            setTotalExpectation(initialCustomerData?.overall_expectation_gbp?.toString() || "");
            setTransactionType(initialCustomerData?.transactionType || 'sale');
        }

        // If data is still missing, redirect
        if ((!cartItems || cartItems.length === 0 || !initialCustomerData?.id) && !isLoading) { // Add !isLoading check
            navigate("/buyer", { replace: true });
        } else {
            setIsLoading(false); // Finished initial setup for negotiate mode
        }
    }
  }, [mode, actualRequestId, navigate, initialCustomerData, cartItems, showNotification]);


  useEffect(() => {
    if (customerData?.transactionType) {
      setTransactionType(customerData.transactionType);
    }
  }, [customerData]);

  // Track previous transaction type so we can keep the same offer index
  // when toggling between cash and store credit in negotiate mode.
  const prevTransactionTypeRef = useRef(transactionType);

  useEffect(() => {
    if (mode !== 'negotiate') {
      prevTransactionTypeRef.current = transactionType;
      return;
    }

    const prevType = prevTransactionTypeRef.current;
    
    // Only run if transaction type actually changed
    if (prevType === transactionType) {
      return;
    }

    console.log('Transaction type changed from', prevType, 'to', transactionType);

    setItems(prevItems =>
      prevItems.map(item => {
        // Don't override manual selections
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

        console.log('Item:', item.title);
        console.log('  selectedOfferId:', item.selectedOfferId);
        console.log('  prevOffers:', prevOffers?.map(o => o.id));
        console.log('  newOffers:', newOffers?.map(o => o.id));

        if (!prevOffers || !newOffers) {
          console.log('  -> No offers, returning unchanged');
          return item;
        }

        const prevIndex = prevOffers.findIndex(o => o.id === item.selectedOfferId);
        console.log('  prevIndex:', prevIndex);
        
        if (prevIndex < 0) {
          console.log('  -> Selected offer not found in prevOffers, returning unchanged');
          return item;
        }
        
        if (!newOffers[prevIndex]) {
          console.log('  -> No offer at index', prevIndex, 'in newOffers, returning unchanged');
          return item;
        }

        console.log('  -> Setting selectedOfferId to', newOffers[prevIndex].id);
        return {
          ...item,
          selectedOfferId: newOffers[prevIndex].id,
        };
      })
    );

    prevTransactionTypeRef.current = transactionType;
  }, [transactionType, mode]);


  const handleReopenResearch = (item) => {
    setResearchItem(item);
  };

  const handleResearchComplete = (updatedState) => {
    // Only update items if not in view mode (read-only)
    if (updatedState && researchItem && mode !== 'view') {
      setItems(prevItems => prevItems.map(i => 
        i.id === researchItem.id 
          ? { ...i, ebayResearchData: updatedState } 
          : i
      ));
    }
    setResearchItem(null);
  };

  const handleReopenCashConvertersResearch = (item) => {
    setCashConvertersResearchItem(item);
  };

  const handleCashConvertersResearchComplete = (updatedState) => {
    // Only update items if not in view mode (read-only)
    if (updatedState && cashConvertersResearchItem && mode !== 'view') {
      setItems(prevItems => prevItems.map(i => 
        i.id === cashConvertersResearchItem.id 
          ? { ...i, cashConvertersResearchData: updatedState } 
          : i
      ));
    }
    setCashConvertersResearchItem(null);
  };

  // Calculate total from individual item expectations
  const calculateTotalFromItems = () => {
    return items.reduce((sum, item) => {
      if (item.customerExpectation) {
        const value = parseFloat(item.customerExpectation.replace(/[£,]/g, '')) || 0;
        const quantity = item.quantity || 1;
        return sum + (value * quantity);
      }
      return sum;
    }, 0);
  };

  // Update total expectation when items change
  useEffect(() => {
    const total = calculateTotalFromItems();
    if (total > 0) {
      setTotalExpectation(total.toFixed(2));
    } else if (mode === 'view' && customerData?.id) {
        // If in view mode, use the stored overall_expectation_gbp directly
        setTotalExpectation(customerData.overall_expectation_gbp?.toFixed(2) || "");
    }
  }, [items, mode, customerData]);



  if (isLoading) {
    return (
        <div className="bg-ui-bg min-h-screen flex items-center justify-center">
            <p>Loading request details...</p>
        </div>
    );
  }



  // Calculate totals with quantity
  const totalOfferPrice = items.reduce((sum, item) => {
    const quantity = item.quantity || 1;
    
    if (item.selectedOfferId === 'manual' && item.manualOffer) {
      // Parse manual offer value, removing £ symbol and converting to number
      const manualValue = parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0;
      return sum + (manualValue * quantity);
    }
    
    // Select the appropriate offers based on transaction type
    const displayOffers = useVoucherOffers 
      ? (item.voucherOffers || item.offers) 
      : (item.cashOffers || item.offers);
    
    const selected = displayOffers?.find(o => o.id === item.selectedOfferId);
    return sum + (selected ? selected.price * quantity : 0);
  }, 0);

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
      <Header 
        userName={customerData.name?.split(' ').map(n => n[0]).join('') || 'JD'}
      />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        {/* Main Table Section */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Top Controls Section */}
          <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center justify-between gap-6">
              {/* Back to Cart Button */}
              <button
                onClick={() => navigate(mode === 'view' ? '/requests-overview' : '/buyer', { 
                  state: mode === 'negotiate' ? { 
                    preserveCart: true,
                    cartItems: items,
                    customerData,
                    currentRequestId: actualRequestId
                  } : undefined
                })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all ${mode === 'view' ? '' : 'hover:shadow-md'}`}
                style={{ 
                  borderColor: 'var(--ui-border)',
                  color: 'var(--brand-blue)'
                }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                {mode === 'view' ? 'Back to Requests' : 'Back to Cart'}
              </button>

              {/* Total Expectation Input */}
              <div className="flex-1 max-w-md">
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
                  <th className="w-32">Manual Offer</th>
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
                  
                  // Select the appropriate offers based on transaction type
                  const displayOffers = useVoucherOffers 
                    ? (item.voucherOffers || item.offers) 
                    : (item.cashOffers || item.offers);
                  
                  const selectedOffer = displayOffers?.find(o => o.id === item.selectedOfferId);
                  const ebayData = item.ebayResearchData;
                  const offer1 = displayOffers?.[0];
                  const offer2 = displayOffers?.[1];
                  const offer3 = displayOffers?.[2];
                  const isViewMode = mode === 'view';

                  // Calculate Our Sale Price for margin calculations
                  const ourSalePrice =
                    item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
                      ? Number(item.ourSalePrice)
                      : (item.ebayResearchData?.stats?.suggestedPrice != null
                          ? Number(item.ebayResearchData.stats.suggestedPrice)
                          : null);

                  // Helper function to calculate margin percentage
                  const calculateMargin = (offerPrice) => {
                    if (!ourSalePrice || !offerPrice || ourSalePrice <= 0) return null;
                    return ((ourSalePrice - offerPrice) / ourSalePrice) * 100;
                  };

                  return (
                    <tr key={item.id || index}>
                      {/* Qty (editable in negotiate mode) */}
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
                              setItems(prev =>
                                prev.map(i =>
                                  i.id === item.id
                                    ? { ...i, quantity: safeQuantity }
                                    : i
                                )
                              );
                            }}
                          />
                        )}
                      </td>

                      {/* Item Name & Attributes */}
                      <td>
                        <div className="font-bold text-[13px]" style={{ color: 'var(--brand-blue)' }}>
                          {item.title || 'N/A'}
                        </div>
                        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {item.subtitle || item.category || 'No details'} {item.model && `| ${item.model}`}
                        </div>
                      </td>
                      
                      {/* CeX Buy (Cash) Column */}
                      <td className="font-medium text-emerald-700">
                        {item.cexBuyPrice ? (
                          <div>
                            <div>£{(item.cexBuyPrice * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">
                                (£{item.cexBuyPrice.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* CeX Buy (Voucher) Column */}
                      <td className="font-medium text-amber-700">
                        {item.cexVoucherPrice ? (
                          <div>
                            <div>£{(item.cexVoucherPrice * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">
                                (£{item.cexVoucherPrice.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* CeX Sell Column */}
                      <td className="font-medium text-blue-800">
                        {item.cexSellPrice ? (
                          <div>
                            <div>£{(item.cexSellPrice * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px] opacity-70">
                                (£{item.cexSellPrice.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>


                      {/* 1st Offer */}
                      <td 
                        className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                        style={item.selectedOfferId === offer1?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer1 && mode !== 'view' && setItems(prev =>
                          prev.map(i =>
                            i.id === item.id
                              ? { ...i, selectedOfferId: offer1.id }
                              : i
                          )
                        )}
                      >
                        {offer1 ? (
                          <div>
                            <div>£{(offer1.price * quantity).toFixed(2)}</div>
                            {(() => {
                              const margin = calculateMargin(offer1.price);
                              return margin !== null ? (
                                <div className="text-[9px] font-medium" style={{ 
                                  color: margin >= 0 ? '#059669' : '#dc2626' 
                                }}>
                                  {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                </div>
                              ) : null;
                            })()}
                            {quantity > 1 && (
                              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                (£{offer1.price.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '-'}
                      </td>

                      {/* 2nd Offer */}
                      <td 
                        className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                        style={item.selectedOfferId === offer2?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer2 && mode !== 'view' && setItems(prev =>
                          prev.map(i =>
                            i.id === item.id
                              ? { ...i, selectedOfferId: offer2.id }
                              : i
                          )
                        )}
                      >
                        {offer2 ? (
                          <div>
                            <div>£{(offer2.price * quantity).toFixed(2)}</div>
                            {(() => {
                              const margin = calculateMargin(offer2.price);
                              return margin !== null ? (
                                <div className="text-[9px] font-medium" style={{ 
                                  color: margin >= 0 ? '#059669' : '#dc2626' 
                                }}>
                                  {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                </div>
                              ) : null;
                            })()}
                            {quantity > 1 && (
                              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                (£{offer2.price.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '-'}
                      </td>

                      {/* 3rd Offer */}
                      <td 
                        className={`font-semibold ${mode === 'view' ? '' : 'cursor-pointer'}`}
                        style={item.selectedOfferId === offer3?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer3 && mode !== 'view' && setItems(prev =>
                          prev.map(i =>
                            i.id === item.id
                              ? { ...i, selectedOfferId: offer3.id }
                              : i
                          )
                        )}
                      >
                        {offer3 ? (
                          <div>
                            <div>£{(offer3.price * quantity).toFixed(2)}</div>
                            {(() => {
                              const margin = calculateMargin(offer3.price);
                              return margin !== null ? (
                                <div className="text-[9px] font-medium" style={{ 
                                  color: margin >= 0 ? '#059669' : '#dc2626' 
                                }}>
                                  {margin >= 0 ? '+' : ''}{margin.toFixed(1)}% margin
                                </div>
                              ) : null;
                            })()}
                            {quantity > 1 && (
                              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                (£{offer3.price.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '-'}
                      </td>

                      {/* Manual Offer */}
                      <td className="p-0 relative group">
                        {(() => {
                          // Calculate min/max for tooltip
                          const offerPrices = displayOffers?.map(o => o.price) || [];
                          const minOffer = offerPrices.length > 0 ? Math.min(...offerPrices) : 0;
                          const maxOffer = offerPrices.length > 0 ? Math.max(...offerPrices) : 0;
                          
                          // Check if manual offer is outside reasonable range
                          const manualValue = item.manualOffer ? parseFloat(item.manualOffer.replace(/[£,]/g, '')) : null;
                          const isOutOfRange = manualValue && (manualValue < minOffer * 0.5 || manualValue > maxOffer * 1.5);
                          
                          // Calculate margin for manual offer
                          const manualMargin = manualValue ? calculateMargin(manualValue) : null;
                          
                          return (
                            <div className="flex flex-col">
                              <div className="relative">
                                <input 
                                  className="w-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
                                  style={{ 
                                    background: item.manualOffer && item.selectedOfferId === 'manual' 
                                      ? (isOutOfRange ? 'rgba(239, 68, 68, 0.1)' : 'rgba(247, 185, 24, 0.1)')
                                      : 'transparent',
                                    color: item.manualOffer && item.selectedOfferId === 'manual'
                                      ? (isOutOfRange ? '#dc2626' : 'var(--brand-blue)')
                                      : 'inherit',
                                    fontWeight: item.manualOffer && item.selectedOfferId === 'manual' 
                                      ? 'bold' 
                                      : 'semibold'
                                  }}
                                  placeholder="£0.00" 
                                  type="text"
                                  value={item.manualOffer || ''}
                                  title={offerPrices.length > 0 ? `Suggested range: £${minOffer.toFixed(2)} - £${maxOffer.toFixed(2)}` : ''}
                                  onChange={mode === 'view' ? undefined : (e) => {
                                    const value = e.target.value;
                                    setItems(prev =>
                                      prev.map(i =>
                                        i.id === item.id
                                          ? { 
                                              ...i, 
                                              manualOffer: value,
                                              selectedOfferId: value ? 'manual' : i.selectedOfferId
                                            }
                                          : i
                                      )
                                    );
                                  }}
                                  onClick={mode === 'view' ? undefined : () => {
                                    if (item.manualOffer) {
                                      setItems(prev =>
                                        prev.map(i =>
                                          i.id === item.id
                                            ? { ...i, selectedOfferId: 'manual' }
                                            : i
                                        )
                                      );
                                    }
                                  }}
                                  readOnly={mode === 'view'}
                                />
                                {/* Warning for out of range */}
                                {isOutOfRange && item.selectedOfferId === 'manual' && (
                                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                    <span className="material-symbols-outlined text-red-600 text-xs" title="Manual offer is significantly outside the suggested range">
                                      warning
                                    </span>
                                  </div>
                                )}
                              </div>
                              {/* Margin display */}
                              {manualMargin !== null && item.manualOffer && item.selectedOfferId === 'manual' && (
                                <div className="text-[9px] font-medium px-3 pb-1" style={{ 
                                  color: manualMargin >= 0 ? '#059669' : '#dc2626' 
                                }}>
                                  {manualMargin >= 0 ? '+' : ''}{manualMargin.toFixed(1)}% margin
                                </div>
                              )}
                              {/* Tooltip showing range */}
                              {mode !== 'view' && offerPrices.length > 0 && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                                  <div className="bg-blue-900 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                                    Suggested: £{minOffer.toFixed(2)} - £{maxOffer.toFixed(2)}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-blue-900 rotate-45"></div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Customer Expectation */}
                      <td className="p-0">
                        <input 
                          className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
                          style={{ 
                            borderColor: 'var(--ui-border)',
                            background: '#f8fafc',
                            outline: 'none'
                          }}
                          placeholder="£0.00" 
                          type="text"
                          value={item.customerExpectation || ''}
                          onChange={mode === 'view' ? undefined : (e) => {
                            const value = e.target.value;
                            setItems(prev =>
                              prev.map(i =>
                                i.id === item.id
                                  ? { ...i, customerExpectation: value }
                                  : i
                              )
                            );
                          }}
                          readOnly={mode === 'view'}
                        />
                      </td>

                      {/* Our Sale Price (editable in negotiate mode) */}
                      <td className="font-medium text-purple-700">
                        {(() => {
                          const baseOurPrice =
                            item.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== ''
                              ? Number(item.ourSalePrice)
                              : (item.ebayResearchData?.stats?.suggestedPrice != null
                                  ? Number(item.ebayResearchData.stats.suggestedPrice)
                                  : null);

                          const displayValue =
                            item.ourSalePrice !== undefined && item.ourSalePrice !== null
                              ? String(item.ourSalePrice)
                              : (baseOurPrice != null ? String(baseOurPrice) : '');

                          // View mode: keep as read-only display
                          if (mode === 'view') {
                            return baseOurPrice != null ? (
                              <div>
                                <div>£{(baseOurPrice * quantity).toFixed(2)}</div>
                                {quantity > 1 && (
                                  <div className="text-[9px] opacity-70">
                                    (£{baseOurPrice.toFixed(2)} × {quantity})
                                  </div>
                                )}
                              </div>
                            ) : '—';
                          }

                          // Negotiate mode: editable input (per-unit), with total shown underneath
                          return (
                            <div>
                              <input
                                className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0 bg-white rounded"
                                placeholder="£0.00"
                                type="text"
                                value={displayValue}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setItems(prev =>
                                    prev.map(i =>
                                      i.id === item.id
                                        ? { ...i, ourSalePrice: value }
                                        : i
                                    )
                                  );
                                }}
                              />
                              {displayValue && !isNaN(Number(displayValue)) && (
                                <div className="text-[9px] opacity-70 mt-0.5">
                                  £{(Number(displayValue) * quantity).toFixed(2)}
                                  {quantity > 1 && (
                                    <span>{` ( £${Number(displayValue).toFixed(2)} × ${quantity} )`}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

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
                              style={{ 
                                background: 'var(--brand-orange)',
                                color: 'var(--brand-blue)'
                              }}
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
                              style={{ 
                                background: 'var(--brand-orange)',
                                color: 'var(--brand-blue)'
                              }}
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
                          const isViewMode = mode === 'view';
                          
                          return cashConvertersData?.stats?.median ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[13px] font-medium" style={{ color: 'var(--brand-blue)' }}>
                                <div>£{(Number(cashConvertersData.stats.median) * quantity).toFixed(2)}</div>
                                {quantity > 1 && (
                                  <div className="text-[9px] opacity-70">
                                    (£{Number(cashConvertersData.stats.median).toFixed(2)} × {quantity})
                                  </div>
                                )}
                              </div>
                              <button 
                                className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!cashConvertersData && isViewMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                style={{ 
                                  background: 'var(--brand-orange)',
                                  color: 'var(--brand-blue)'
                                }}
                                onClick={(!cashConvertersData && isViewMode) ? undefined : () => handleReopenCashConvertersResearch(item)}
                                title={isViewMode ? 'View Cash Converters Research (Read-only)' : 'View/Refine Research'}
                                disabled={!cashConvertersData && isViewMode}
                              >
                                <span className="material-symbols-outlined text-[16px]">store</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
                              <button 
                                className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!cashConvertersData && isViewMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                                style={{ 
                                  background: 'var(--brand-orange)',
                                  color: 'var(--brand-blue)'
                                }}
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

                {/* Empty rows for spacing */}
                <tr className="h-10 opacity-50"><td colSpan="9"></td></tr>
                <tr className="h-10 opacity-50"><td colSpan="9"></td></tr>
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
            {/* Space for future content */}
          </div>

          {/* Footer Actions */}
          <div className="p-6 bg-white border-t space-y-4" style={{ borderColor: 'rgba(20, 69, 132, 0.2)' }}>
            <div className="flex justify-between items-end">
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--brand-blue)' }}>
                  Grand Total
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Based on selected offers
                </span>
              </div>
              <span className="text-3xl font-black tracking-tighter leading-none" style={{ color: 'var(--brand-blue)' }}>
                £{totalOfferPrice.toFixed(2)}
              </span>
            </div>
            <button 
              className={`w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98] ${mode === 'view' ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          </div>
        </aside>
      </main>

      {/* Research Modal Overlay */}
      {researchItem && (
        <EbayResearchForm
          mode="modal"
          category={researchItem.categoryObject || { path: [researchItem.category], name: researchItem.category }}
          savedState={researchItem.ebayResearchData}
          onComplete={handleResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
        />
      )}

      {/* Cash Converters Research Modal Overlay */}
      {cashConvertersResearchItem && (
        <CashConvertersResearchForm
          mode="modal"
          category={cashConvertersResearchItem.categoryObject || { path: [cashConvertersResearchItem.category], name: cashConvertersResearchItem.category }}
          savedState={cashConvertersResearchItem.cashConvertersResearchData}
          onComplete={handleCashConvertersResearchComplete}
          initialHistogramState={true}
          readOnly={mode === 'view'}
        />
      )}
    </div>
  );
};

export default Negotiation;