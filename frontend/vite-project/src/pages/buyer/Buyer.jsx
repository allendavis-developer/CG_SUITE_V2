import React, { useState, useEffect } from 'react';
import { Header, Sidebar } from '@/components/ui/components';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';

import { fetchProductModels } from '@/services/api';
import { 
  createRequest as apiCreateRequest, 
  addItemToRequest as apiAddItemToRequest,
  finalizeTransaction as apiFinalizeTransaction 
} from '@/services/api';

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
  
  const [currentRequestId, setCurrentRequestId] = useState(null);
  const [requestStatus, setRequestStatus] = useState(null);
  
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
      
      if (location.state.cartItems) {
        setCartItems(location.state.cartItems);
      }
      
      if (location.state.customerData) {
        setCustomerData(location.state.customerData);
        setCustomerModalOpen(false); // Don't show modal if we have customer data
      }
      
      if (location.state.currentRequestId) {
        setCurrentRequestId(location.state.currentRequestId);
        setRequestStatus('OPEN');
      }
    }
  }, [location.state]);

  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);
    setSelectedModel(null);
    const models = await fetchProductModels(category);
    setAvailableModels(models);
  };

  const createRequest = async (firstItem) => {
    if (!customerData.id) {
      alert('No customer selected');
      return null;
    }

    try {
      const data = await apiCreateRequest(
        customerData.id,
        customerData.transactionType,
        firstItem
      );

      setCurrentRequestId(data.request_id);
      setRequestStatus('OPEN');
      
      console.log('Request created:', data);
      return data.request_id;
    } catch (error) {
      console.error('Error creating request:', error);
      alert('Failed to create request. Please try again. Error: ' + error.message);
      return null;
    }
  };

  const addItemToRequest = async (item) => {
    if (!currentRequestId) {
      console.error('No active request');
      return false;
    }

    try {
      const data = await apiAddItemToRequest(currentRequestId, item);
      console.log('Item added to request:', data);
      return true;
    } catch (error) {
      console.error('Error adding item to request:', error);
      alert('Failed to add item to request. Please try again.');
      return false;
    }
  };

  const finalizeTransaction = async () => {
    if (!currentRequestId) {
      alert('No active request to finalize');
      return;
    }

    try {
      const data = await apiFinalizeTransaction(currentRequestId);
      setRequestStatus('BOOKED_FOR_TESTING');
      
      console.log('Transaction finalized:', data);
      alert(`Request #${currentRequestId} has been booked for testing!`);
      
      setCartItems([]);
      setCurrentRequestId(null);
      setRequestStatus(null);
      
      setCustomerModalOpen(true);
    } catch (error) {
      console.error('Error finalizing transaction:', error);
      throw error;
    }
  };

  const addToCart = async (item) => {
    if (cartItems.length === 0) {
      const requestId = await createRequest(item);
      if (!requestId) {
        return;
      }
    } else {
      const success = await addItemToRequest(item);
      if (!success) {
        return;
      }
    }

    setCartItems((prev) => [...prev, item]);
  };

  // ✅ NEW FUNCTION: Update cart item with eBay research data
  const updateCartItemEbayData = (variantId, ebayData) => {
    setCartItems((prevItems) => 
      prevItems.map((item) => {
        // Match by variantId
        if (item.variantId === variantId) {
          console.log('Updating cart item with eBay data:', item.title);
          return {
            ...item,
            ebayResearchData: ebayData
          };
        }
        return item;
      })
    );
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
          updateCartItemEbayData={updateCartItemEbayData}  // ✅ Pass the update function
        />
        <CartSidebar 
          cartItems={cartItems} 
          setCartItems={setCartItems}
          customerData={customerData}
          currentRequestId={currentRequestId}
          onFinalize={finalizeTransaction}
        />
      </main>
    </div>
  );
}