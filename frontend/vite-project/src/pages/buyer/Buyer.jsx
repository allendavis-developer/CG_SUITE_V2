import React, { useState, useEffect } from 'react';
import { Header, Sidebar } from '@/components/ui/components';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';

import { fetchProductModels } from '@/services/api';

/**
 * Main Buyer application component
 */
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

  // ✅ Restore state when coming back from negotiation page
  useEffect(() => {
    if (location.state?.preserveCart) {
      console.log('Restoring cart state from navigation:', location.state);
      
      if (location.state.cartItems) setCartItems(location.state.cartItems);
      if (location.state.customerData) {
        setCustomerData(location.state.customerData);
        setCustomerModalOpen(false);
      }

      // 2. CRITICAL: Clear the state so a browser refresh doesn't trigger this again
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);
    setSelectedModel(null);
    const models = await fetchProductModels(category);
    setAvailableModels(models);
  };

  const addToCart = (item) => {
    setCartItems((prev) => [...prev, item]);
  };

  //  NEW FUNCTION: Update cart item with eBay research data
  const updateCartItemEbayData = (variantId, ebayData) => {
    console.log("Attempting to update item:", variantId);
    console.log("Current Cart Items:", cartItems.map(i => i.variantId));
    setCartItems(prevItems => {
      return prevItems.map(item =>
        item.variantId === variantId 
          ? { ...item, ebayResearchData: ebayData } 
          : item
      );
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
        onClose={(customerInfo) => {
          setCustomerModalOpen(false);
          if (customerInfo) {
            setCustomerData({
              id: customerInfo.id,
              name: customerInfo.customerName,
              cancelRate: customerInfo.cancelRate || 0,
              transactionType: customerInfo.transactionType || 'sale'
            });
            console.log("Selected customer:", customerInfo);
          }
        }}
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
        />
        <CartSidebar 
          cartItems={cartItems} 
          setCartItems={setCartItems}
          customerData={customerData}
        />
      </main>
    </div>
  );
}
