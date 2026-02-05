import React, { useState, useEffect } from 'react';
import { Header, Sidebar } from '@/components/ui/components';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';

import { fetchProductModels, updateRequestItemRawData } from '@/services/api';

export default function Buyer() {
  const location = useLocation();
  
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  
  const [cartItems, setCartItems] = useState([]);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(true);
  
  const [customerData, setCustomerData] = useState({
    id: null,
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale'
  });

  const [intent, setIntent] = useState('UNKNOWN'); // default intent - matches Django model

  // Restore cart state on navigation
  useEffect(() => {
    if (location.state?.preserveCart) {
      if (location.state.cartItems) setCartItems(location.state.cartItems);
      if (location.state.customerData) {
        setCustomerData(location.state.customerData);
        setCustomerModalOpen(false);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Map frontend transaction types to Django RequestIntent values
  const mapTransactionTypeToIntent = (transactionType) => {
    const intentMap = {
      'sale': 'DIRECT_SALE',
      'buyback': 'BUYBACK',
      'store_credit': 'STORE_CREDIT'
    };
    return intentMap[transactionType] || 'UNKNOWN';
  };

  // Handle customer selection
  const handleCustomerSelected = (customerInfo) => {
    setCustomerModalOpen(false);
    if (!customerInfo) return;

    // Map the transaction type to the Django intent
    const mappedIntent = mapTransactionTypeToIntent(customerInfo.transactionType);

    setCustomerData({
      id: customerInfo.id,
      name: customerInfo.customerName,
      cancelRate: customerInfo.cancelRate || 0,
      transactionType: customerInfo.transactionType || 'sale'
    });

    


    // Set the intent based on transaction type
    setIntent(mappedIntent);

    console.log("Selected customer:", customerInfo);
    console.log("Mapped intent:", mappedIntent);
  };

  const handleTransactionTypeChange = (newType) => {
      setCustomerData(prev => ({
        ...prev,
        transactionType: newType
      }));

      // Keep intent in sync too
      setIntent(mapTransactionTypeToIntent(newType));
  };


  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);
    setSelectedModel(null);
    const models = await fetchProductModels(category);
    setAvailableModels(models);
  };

  const addToCart = (item) => {
    setCartItems((prev) => [...prev, item]);
  };

  /**
   * Update cart item with eBay research data
   * This handles both local state update AND backend sync
   */
  const updateCartItemEbayData = async (variantId, ebayData) => {
    setCartItems(prevItems => {
      return prevItems.map(item => {
        if (item.variantId === variantId) {
          const updatedItem = {
            ...item,
            ebayResearchData: ebayData
          };

          // ✅ If the item already has a request_item_id, update the backend
          if (item.request_item_id) {
            updateRequestItemRawData(item.request_item_id, ebayData)
              .then(result => {
                if (result) {
                  console.log('✅ Successfully updated raw_data on backend for request_item_id:', item.request_item_id);
                } else {
                  console.error('❌ Failed to update raw_data on backend');
                }
              })
              .catch(err => {
                console.error('❌ Error updating raw_data:', err);
              });
          } else {
            console.log('ℹ️ Item does not have request_item_id yet, will be included when added to cart');
          }

          return updatedItem;
        }
        return item;
      });
    });
  };

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      <CustomerIntakeModal
        open={isCustomerModalOpen}
        onClose={handleCustomerSelected}
      />

      <Header onSearch={(val) => console.log('Search:', val)} />
      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        <Sidebar onCategorySelect={handleCategorySelect} />
        <MainContent 
          selectedCategory={selectedCategory} 
          availableModels={availableModels}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          addToCart={addToCart}
          updateCartItemEbayData={updateCartItemEbayData}
          customerData={customerData}
          intent={intent}
          setIntent={setIntent}
        />
      <CartSidebar 
        cartItems={cartItems} 
        setCartItems={setCartItems}
        customerData={customerData}
        onTransactionTypeChange={handleTransactionTypeChange}
      />

      </main>
    </div>
  );
}