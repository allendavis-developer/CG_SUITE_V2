import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button, Icon, Header } from "@/components/ui/components";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import { CustomDropdown } from "@/components/ui/components";
import CustomerTransactionHeader from './components/CustomerTransactionHeader'
import { finishRequest } from '@/services/api'; // Added this line
import { useNotification } from '@/contexts/NotificationContext'; // Added this line


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



const Negotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartItems, customerData, currentRequestId } = location.state || {};
  const [items, setItems] = useState(cartItems || []);
  const [researchItem, setResearchItem] = useState(null);
  const [totalExpectation, setTotalExpectation] = useState("");
  const [transactionType, setTransactionType] = useState(
    customerData?.transactionType || 'sale'
  );

  const { showNotification } = useNotification();

  // Determine if we should show voucher offers
  const useVoucherOffers = transactionType === 'store_credit';

  useEffect(() => {
    if (customerData?.transactionType) {
      setTransactionType(customerData.transactionType);
    }
  }, [customerData]);


  const handleReopenResearch = (item) => {
    setResearchItem(item);
  };

  const handleResearchComplete = (updatedState) => {
    if (updatedState && researchItem) {
      setItems(prevItems => prevItems.map(i => 
        i.id === researchItem.id 
          ? { ...i, ebayResearchData: updatedState } 
          : i
      ));
    }
    setResearchItem(null);
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
    }
  }, [items]);

  // Function to handle finalizing the transaction
  const handleFinalizeTransaction = async () => {
    if (!currentRequestId) {
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
        raw_data: item.ebayResearchData || {}
      };
    });

    const payload = {
      items_data: itemsData,
      overall_expectation_gbp: parseFloat(totalExpectation.replace(/[£,]/g, '')) || 0,
      negotiated_grand_total_gbp: totalOfferPrice // totalOfferPrice is already a number
    };

    try {
      await finishRequest(currentRequestId, payload);
      showNotification("Transaction finalized successfully and booked for testing!", 'success');
      navigate("/buyer"); // Navigate back to the buyer page
    } catch (error) {
      console.error("Error finalizing transaction:", error);
      showNotification(`Failed to finalize transaction: ${error.message}`, 'error');
    }
  };

  // Redirect if no cart data
  useEffect(() => {
    if (!items || items.length === 0 || !customerData?.id) {
      navigate("/buyer", { replace: true });
    }
  }, [items, customerData, navigate]);

  if (!items || items.length === 0 || !customerData?.id) {
    return null;
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
                onClick={() => navigate('/buyer', { 
                  state: { 
                    preserveCart: true,
                    cartItems: items,
                    customerData,
                    currentRequestId
                  }
                })}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all hover:shadow-md"
                style={{ 
                  borderColor: 'var(--ui-border)',
                  color: 'var(--brand-blue)'
                }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Back to Cart
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
                  #{currentRequestId || 'N/A'}
                </p>
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

                  return (
                    <tr key={item.id || index}>
                      {/* Qty */}
                      <td className="text-center font-bold">{quantity}</td>

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
                        className="font-semibold cursor-pointer"
                        style={item.selectedOfferId === offer1?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer1 && setItems(prev =>
                          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer1.id } : i)
                        )}
                      >
                        {offer1 ? (
                          <div>
                            <div>£{(offer1.price * quantity).toFixed(2)}</div>
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
                        className="font-semibold cursor-pointer"
                        style={item.selectedOfferId === offer2?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer2 && setItems(prev =>
                          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer2.id } : i)
                        )}
                      >
                        {offer2 ? (
                          <div>
                            <div>£{(offer2.price * quantity).toFixed(2)}</div>
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
                        className="font-semibold cursor-pointer"
                        style={item.selectedOfferId === offer3?.id ? { 
                          background: 'rgba(247, 185, 24, 0.1)', 
                          fontWeight: 'bold',
                          color: 'var(--brand-blue)'
                        } : {}}
                        onClick={() => offer3 && setItems(prev =>
                          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer3.id } : i)
                        )}
                      >
                        {offer3 ? (
                          <div>
                            <div>£{(offer3.price * quantity).toFixed(2)}</div>
                            {quantity > 1 && (
                              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                (£{offer3.price.toFixed(2)} × {quantity})
                              </div>
                            )}
                          </div>
                        ) : '-'}
                      </td>

                      {/* Manual Offer */}
                      <td className="p-0">
                        <input 
                          className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
                          style={{ 
                            background: item.manualOffer && item.selectedOfferId === 'manual' 
                              ? 'rgba(247, 185, 24, 0.1)' 
                              : 'transparent',
                            color: item.manualOffer && item.selectedOfferId === 'manual'
                              ? 'var(--brand-blue)'
                              : 'inherit',
                            fontWeight: item.manualOffer && item.selectedOfferId === 'manual' 
                              ? 'bold' 
                              : 'semibold'
                          }}
                          placeholder="£0.00" 
                          type="text"
                          value={item.manualOffer || ''}
                          onChange={(e) => {
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
                          onClick={() => {
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
                        />
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
                          onChange={(e) => {
                            const value = e.target.value;
                            setItems(prev =>
                              prev.map(i =>
                                i.id === item.id
                                  ? { ...i, customerExpectation: value }
                                  : i
                              )
                            );
                          }}
                        />
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
                              title="Refine Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit_note</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
                            <button 
                              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
                              style={{ 
                                background: 'var(--brand-orange)',
                                color: 'var(--brand-blue)'
                              }}
                              onClick={() => handleReopenResearch(item)}
                              title="Research"
                            >
                              <span className="material-symbols-outlined text-[16px]">search_insights</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Cash Converters - Work in Progress */}
                      <td>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
                          <button 
                            className="flex items-center justify-center size-7 rounded transition-colors shrink-0 opacity-50 cursor-not-allowed"
                            style={{ 
                              background: 'var(--brand-orange)',
                              color: 'var(--brand-blue)'
                            }}
                            disabled
                            title="Coming Soon"
                          >
                            <span className="material-symbols-outlined text-[16px]">search_insights</span>
                          </button>
                        </div>
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
              className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 group active:scale-[0.98]"
              style={{ 
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)',
                boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)'
              }}
              onClick={handleFinalizeTransaction}
            >
              <span className="text-base uppercase tracking-tight">Finalize Transaction</span>
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
        />
      )}
    </div>
  );
};

export default Negotiation;