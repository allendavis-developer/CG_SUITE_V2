import React, { useState, useEffect } from 'react';
import { Header, Sidebar } from '@/components/ui/components';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';

import { fetchProductModels, updateRequestItemRawData } from '@/services/api';

export default function Buyer() {
  const location = useLocation();
  const { showNotification } = useNotification();
  
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  
  const [cartItems, setCartItems] = useState([]);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(true);
  const [selectedCartItem, setSelectedCartItem] = useState(null); // Track selected cart item

  const [customerData, setCustomerData] = useState({
    id: null,
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale'
  });

  const [intent, setIntent] = useState('UNKNOWN'); // default intent - matches Django model
  const [request, setRequest] = useState(null);
  
  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingTransactionType, setPendingTransactionType] = useState(null);

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

  useEffect(() => {
    if (!cartItems.length) return;

    const useVoucher = customerData.transactionType === 'store_credit';

    setCartItems(prevItems =>
      prevItems.map(item => {
        // eBay-only items also need their offers updated
        if (item.isCustomEbayItem) {
          const nextOffers = useVoucher
            ? item.voucherOffers ?? []
            : item.cashOffers ?? [];
          
          return {
            ...item,
            offers: nextOffers,
            offerType: useVoucher ? 'voucher' : 'cash'
          };
        }

        const nextOffers = useVoucher
          ? item.voucherOffers ?? []
          : item.cashOffers ?? [];

        return {
          ...item,
          offers: nextOffers,
          offerType: useVoucher ? 'voucher' : 'cash'
        };
      })
    );
  }, [customerData.transactionType]);


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
      // If cart has items, show confirmation dialog
      if (cartItems.length > 0 && newType !== customerData.transactionType) {
        setPendingTransactionType(newType);
        setShowConfirmDialog(true);
      } else {
        // No items in cart, change immediately
        applyTransactionTypeChange(newType);
      }
  };
  
  const applyTransactionTypeChange = (newType) => {
      setCustomerData(prev => ({
        ...prev,
        transactionType: newType
      }));

      // Keep intent in sync too
      setIntent(mapTransactionTypeToIntent(newType));
      
      // Close dialog and reset pending state
      setShowConfirmDialog(false);
      setPendingTransactionType(null);
  };
  
  const cancelTransactionTypeChange = () => {
      setShowConfirmDialog(false);
      setPendingTransactionType(null);
  };


  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);
    setSelectedModel(null);
    const models = await fetchProductModels(category);
    setAvailableModels(models);
  };

  const addToCart = (item) => {
    setCartItems((prev) => {
      // Check if item already exists in cart
      const existingItemIndex = prev.findIndex(cartItem => {
        // For CeX items, match by variantId
        if (!item.isCustomEbayItem && item.variantId) {
          return cartItem.variantId === item.variantId;
        }
        
        // For eBay items, match by search term and category
        if (item.isCustomEbayItem) {
          return (
            cartItem.isCustomEbayItem &&
            cartItem.title === item.title &&
            cartItem.category === item.category
          );
        }
        
        return false;
      });

      // If item exists, increment quantity
      if (existingItemIndex !== -1) {
        const updatedItems = [...prev];
        const newQuantity = (updatedItems[existingItemIndex].quantity || 1) + 1;
        updatedItems[existingItemIndex] = {
          ...updatedItems[existingItemIndex],
          quantity: newQuantity
        };
        
        // Show notification
        showNotification(`Quantity increased to ${newQuantity} for ${item.title}`, 'success');
        
        return updatedItems;
      }

      // Otherwise, add as new item
      showNotification(`${item.title} added to cart`, 'success');
      return [...prev, item];
    });
  };

  const handleCartItemSelect = async (item) => {
    // If clicking the same item, deselect it
    if (selectedCartItem?.id === item.id) {
      setSelectedCartItem(null);
    } else {
      // Load the category and models WITHOUT resetting selectedModel
      if (item.categoryObject) {
        setSelectedCategory(item.categoryObject);
        const models = await fetchProductModels(item.categoryObject);
        setAvailableModels(models);
      }
      // Set the selected cart item AFTER models are loaded
      setSelectedCartItem(item);
    }
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
          request={request}
          setRequest={setRequest}
          selectedCartItem={selectedCartItem}
        />
      <CartSidebar 
        cartItems={cartItems} 
        setCartItems={setCartItems}
        customerData={customerData}
        onTransactionTypeChange={handleTransactionTypeChange}
        currentRequestId={request?.request_id}
        onItemSelect={handleCartItemSelect}
        selectedCartItemId={selectedCartItem?.id}
      />

      </main>
      
      {/* Transaction Type Change Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px] shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-100 p-2 rounded-lg">
                <span className="material-symbols-outlined text-yellow-600 text-2xl">warning</span>
              </div>
              <h2 className="text-xl font-bold text-blue-900">Change Transaction Type?</h2>
            </div>
            
            <p className="text-sm text-gray-700 mb-2">
              You are about to change the transaction type to{' '}
              <span className="font-bold text-blue-900">
                {pendingTransactionType === 'store_credit' ? 'Store Credit' : 
                 pendingTransactionType === 'buyback' ? 'Buy Back' : 'Direct Sale'}
              </span>.
            </p>
            
            <p className="text-sm text-gray-700 mb-4">
              {pendingTransactionType === 'store_credit' ? (
                <>This will switch all offers to <span className="font-bold">voucher prices</span>.</>
              ) : (
                <>This will switch all offers to <span className="font-bold">cash prices</span>.</>
              )}
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
              <p className="text-xs text-blue-800 mb-2">
                <span className="material-symbols-outlined text-sm mr-1" style={{ fontSize: '14px', verticalAlign: 'middle' }}>info</span>
                All {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} in your cart will be updated with new valuations.
              </p>
              {pendingTransactionType === 'store_credit' && (
                <p className="text-xs text-blue-700 ml-5">
                  • CeX items: Updated to CeX voucher prices<br/>
                  • eBay items: Cash offers +10%
                </p>
              )}
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelTransactionTypeChange}
                className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => applyTransactionTypeChange(pendingTransactionType)}
                className="px-6 py-2.5 text-sm font-bold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors shadow-md"
              >
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}