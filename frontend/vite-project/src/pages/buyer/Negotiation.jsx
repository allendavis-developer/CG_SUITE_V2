import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button, Icon, Header } from "@/components/ui/components";
import EbayResearchForm from "@/components/forms/EbayResearchForm";

const Negotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartItems, customerData, currentRequestId } = location.state || {};
  const [items, setItems] = useState(cartItems || []);

  // Add these to your state hooks in Negotiation.jsx
  const [researchItem, setResearchItem] = useState(null);

  const handleReopenResearch = (item) => {
    setResearchItem(item); // This opens the modal
  };

  const handleResearchComplete = (updatedState) => {
    if (updatedState && researchItem) {
      setItems(prevItems => prevItems.map(i => 
        i.id === researchItem.id 
          ? { ...i, ebayResearchData: updatedState } 
          : i
      ));
    }
    setResearchItem(null); // This closes the modal
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
    const selected = item.offers?.find(o => o.id === item.selectedOfferId);
    return sum + (selected ? selected.price : 0);
  }, 0);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      <Header onSearch={(val) => console.log("Search:", val)} />

      <main className="flex flex-col flex-1 p-6 overflow-auto">
        {/* Header Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-extrabold text-blue-900 mb-2">
                Negotiation Screen
              </h1>
              <p className="text-gray-600">
                Request ID: <span className="font-semibold">#{currentRequestId || 'N/A'}</span>
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/buyer', { 
              state: { 
                preserveCart: true,
                cartItems: items,
                customerData,
                currentRequestId
              }
            })}>
              <Icon name="arrow_back" /> Back to Cart
            </Button>
          </div>

          {/* Customer Information */}
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
            <h2 className="text-lg font-bold text-gray-800 mb-3">Customer Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Customer Name</p>
                <p className="font-semibold text-gray-900">{customerData.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Customer ID</p>
                <p className="font-semibold text-gray-900">{customerData.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Transaction Type</p>
                <p className="font-semibold text-gray-900 capitalize">{customerData.transactionType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Cancel Rate</p>
                <p className="font-semibold text-gray-900">{(customerData.cancelRate)}%</p>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Items</p>
              <p className="text-2xl font-bold text-blue-900">{items.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Offer Price</p>
              <p className="text-2xl font-bold text-green-600">£{totalOfferPrice.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Item Details</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Available Offers</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Selected Offer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">eBay Research</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((item, index) => {
                  const selectedOffer = item.offers?.find(o => o.id === item.selectedOfferId);
                  const ebayData = item.ebayResearchData;

                  return (
                    <tr key={item.id || index} className="hover:bg-gray-50 transition-colors">
                      {/* Index */}
                      <td className="px-4 py-4 text-sm font-bold text-gray-900">
                        {index + 1}
                      </td>

                      {/* Item Details */}
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-blue-900">{item.title || 'N/A'}</p>
                          <p className="text-xs text-gray-600">{item.subtitle || 'No subtitle'}</p>
                          {item.category && (
                            <p className="text-xs text-gray-500">
                              <span className="font-semibold">Category:</span> {item.category}
                            </p>
                          )}
                          {item.model && (
                            <p className="text-xs text-gray-500">
                              <span className="font-semibold">Model:</span> {item.model}
                            </p>
                          )}
                        </div>
                      </td>


                      {/* Available Offers */}
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          {item.offers && item.offers.length > 0 ? (
                            item.offers.map((offer) => {
                              const isSelected = offer.id === item.selectedOfferId;

                              return (
                                <button
                                  key={offer.id}
                                  onClick={() => {
                                    setItems(prev =>
                                      prev.map(i =>
                                        i.id === item.id
                                          ? { ...i, selectedOfferId: offer.id }
                                          : i
                                      )
                                    );
                                  }}
                                  className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs transition
                                    ${isSelected
                                      ? "bg-blue-900 text-white font-bold"
                                      : "bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-900"
                                    }`}
                                >
                                  <span>{offer.name || offer.type || "Offer"}</span>
                                  <span className="font-bold">£{offer.price.toFixed(2)}</span>
                                </button>
                              );
                            })
                          ) : (
                            <p className="text-xs text-gray-500">No offers available</p>
                          )}
                        </div>
                      </td>


                      {/* Selected Offer */}
                      <td className="px-4 py-4 text-right">
                        {selectedOffer ? (
                          <div className="space-y-1">
                            <p className="text-lg font-extrabold text-blue-900">
                              £{selectedOffer.price.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {selectedOffer.name || selectedOffer.type || 'Selected'}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">None selected</p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                      {ebayData ? (
                        <div className="space-y-2 text-xs">
                          
                          {/* Drilled Median Price */}
                          {ebayData.stats?.median && (
                            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-blue-700 font-bold">
                                Market Median
                              </p>
                              <p className="text-lg font-extrabold text-blue-900">
                                £{Number(ebayData.stats.median).toFixed(2)}
                              </p>
                              {ebayData.drillHistory?.length > 0 && (
                                <p className="text-[10px] text-blue-700 mt-0.5">
                                  Based on drilled range
                                </p>
                              )}
                            </div>
                          )}

                          {/* Refine Button */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2 text-[10px]"
                            onClick={() => handleReopenResearch(item)}
                          >
                            <Icon name="edit_note" className="text-xs" />
                            Refine Research
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleReopenResearch(item)}
                        >
                          <Icon name="search" /> Start Research
                        </Button>
                      )}
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Research Modal Overlay */}
        {researchItem && (
          <EbayResearchForm
            mode="modal"
            category={{ path: [researchItem.category] }}
            savedState={researchItem.ebayResearchData} // This restores the filters/listings
            onComplete={handleResearchComplete}
          />
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" size="lg" onClick={() => navigate('/buyer', { 
            state: { 
              preserveCart: true,
              cartItems: items,
              customerData,
              currentRequestId
            }
          })}>
            <Icon name="arrow_back" /> Back to Cart
          </Button>
          <Button variant="primary" size="lg">
            <Icon name="handshake" /> Finalize Negotiation
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Negotiation;