import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button, Icon, Header } from "@/components/ui/components";
import EbayResearchForm from "@/components/forms/EbayResearchForm";

const Negotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartItems, customerData, currentRequestId } = location.state || {};
  const [items, setItems] = useState(cartItems || []);
  const [researchItem, setResearchItem] = useState(null);

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

  // Redirect if no cart data
  useEffect(() => {
    if (!items || items.length === 0 || !customerData?.id) {
      navigate("/buyer", { replace: true });
    }
  }, [items, customerData, navigate]);

  if (!items || items.length === 0 || !customerData?.id) {
    return null;
  }

  // Calculate totals
  const totalOfferPrice = items.reduce((sum, item) => {
    if (item.selectedOfferId === 'manual' && item.manualOffer) {
      // Parse manual offer value, removing £ symbol and converting to number
      const manualValue = parseFloat(item.manualOffer.replace(/[£,]/g, '')) || 0;
      return sum + manualValue;
    }
    const selected = item.offers?.find(o => o.id === item.selectedOfferId);
    return sum + (selected ? selected.price : 0);
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
      <header className="flex items-center justify-between whitespace-nowrap border-b border-ui-border px-6 py-3 sticky top-0 z-50" style={{ background: 'var(--brand-blue)' }}>
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-4" style={{ color: 'var(--brand-orange)' }}>
            <div className="size-6 flex items-center justify-center rounded" style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}>
              <span className="material-symbols-outlined text-sm font-bold">receipt_long</span>
            </div>
            <h2 className="text-white text-lg font-bold leading-tight tracking-tight">Trade-In Batch Review</h2>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex flex-col min-w-64 h-9">
              <div className="flex w-full flex-1 items-stretch rounded-lg h-full overflow-hidden border" style={{ borderColor: 'rgba(255, 255, 255, 0.2)' }}>
                <div className="flex items-center justify-center pl-3" style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.6)' }}>
                  <span className="material-symbols-outlined text-sm">search</span>
                </div>
                <input 
                  className="flex w-full min-w-0 flex-1 resize-none overflow-hidden text-white focus:outline-0 focus:ring-0 border-none h-full text-sm font-normal px-2" 
                  style={{ background: 'rgba(255, 255, 255, 0.1)' }}
                  placeholder="Search Batch Items..."
                />
              </div>
            </label>
          </div>
        </div>
        <div className="flex flex-1 justify-end gap-6 items-center">
          <nav className="flex items-center gap-6">
            <a className="text-sm font-semibold" style={{ color: 'var(--brand-orange)' }} href="#">Current Batch</a>
            <a className="text-sm font-medium hover:text-brand-orange transition-colors" style={{ color: 'rgba(255, 255, 255, 0.7)' }} href="#">History</a>
          </nav>
          <div className="flex gap-2">
            <button className="flex items-center justify-center rounded-lg h-9 w-9 text-white transition-colors" style={{ background: 'rgba(255, 255, 255, 0.1)' }}>
              <span className="material-symbols-outlined text-sm">notifications</span>
            </button>
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-extrabold" style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}>
              {customerData.name?.split(' ').map(n => n[0]).join('') || 'JD'}
            </div>
          </div>
        </div>
      </header>

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
                      defaultValue={totalOfferPrice.toFixed(2)}
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
                  <th className="w-24">1st Offer</th>
                  <th className="w-24">2nd Offer</th>
                  <th className="w-24">3rd Offer</th>
                  <th className="w-32">Manual Offer</th>
                  <th className="w-32">Customer Expectation</th>
                  <th className="w-36">eBay Price</th>
                  <th className="w-36">Cash Converters</th>
                </tr>
              </thead>
              <tbody className="text-xs">

                {/* Item Rows */}
                {items.map((item, index) => {
                  const selectedOffer = item.offers?.find(o => o.id === item.selectedOfferId);
                  const ebayData = item.ebayResearchData;
                  const offer1 = item.offers?.[0];
                  const offer2 = item.offers?.[1];
                  const offer3 = item.offers?.[2];

                  return (
                    <tr key={item.id || index}>
                      {/* Qty */}
                      <td className="text-center font-bold">1</td>

                      {/* Item Name & Attributes */}
                      <td>
                        <div className="font-bold text-[13px]" style={{ color: 'var(--brand-blue)' }}>
                          {item.title || 'N/A'}
                        </div>
                        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {item.subtitle || item.category || 'No details'} {item.model && `| ${item.model}`}
                        </div>
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
                        {offer1 ? `£${offer1.price.toFixed(2)}` : '-'}
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
                        {offer2 ? `£${offer2.price.toFixed(2)}` : '-'}
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
                        {offer3 ? `£${offer3.price.toFixed(2)}` : '-'}
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
                            <span className="text-[13px] font-bold" style={{ color: 'var(--brand-blue)' }}>
                              £{Number(ebayData.stats.median).toFixed(2)}
                            </span>
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
          <div className="bg-white p-6">
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--brand-blue)' }}>
              {customerData.name}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-sm font-medium" style={{ color: 'rgba(20, 69, 132, 0.8)' }}>
                Cancel Rate: {customerData.cancelRate}%
              </p>
              <span style={{ color: 'rgba(20, 69, 132, 0.4)' }}>•</span>
              <p className={`text-sm font-bold ${
                customerData.transactionType === 'sale' 
                  ? 'text-emerald-600' 
                  : 'text-purple-600'
              }`}>
                {customerData.transactionType === 'sale' ? 'Direct Sale' : 'Buy Back'}
              </p>
            </div>
          </div>

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