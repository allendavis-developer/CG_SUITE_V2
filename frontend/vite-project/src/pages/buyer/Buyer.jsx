import React, { useState, useEffect, useRef } from 'react';
import { Header, Sidebar } from '@/components/ui/components';
import CustomerIntakeModal from "@/components/modals/CustomerIntakeModal.jsx";
import MainContent from '@/pages/buyer/components/MainContent';
import CartSidebar from '@/pages/buyer/components/CartSidebar';
import { useLocation } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';

import { fetchProductModels, updateRequestItemRawData, fetchRequestDetail, fetchCeXProductPrices } from '@/services/api';
import { getDataFromListingPage } from '@/services/extensionClient';
import { mapTransactionTypeToIntent } from '@/utils/transactionConstants';

export default function Buyer({ mode = 'buyer' }) {
  const isRepricing = mode === 'repricing';
  const location = useLocation();
  const { showNotification } = useNotification();
  
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  
  const [cartItems, setCartItems] = useState([]);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(!isRepricing);
  const [selectedCartItem, setSelectedCartItem] = useState(null); // Track selected cart item

  const [customerData, setCustomerData] = useState({
    id: null,
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale'
  });

  const [intent, setIntent] = useState(null); // intent must be set when customer is selected
  const [request, setRequest] = useState(null);
  const modelsRequestIdRef = useRef(0);
  
  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingTransactionType, setPendingTransactionType] = useState(null);

  // CeX Add from listing flow (waits for user to go to product-detail page)
  const [cexLoading, setCexLoading] = useState(false);
  const [cexProductData, setCexProductData] = useState(null);

  // Restore cart state on navigation
  useEffect(() => {
    if (location.state?.preserveCart) {
      if (location.state.cartItems) setCartItems(location.state.cartItems);
      if (location.state.customerData) {
        setCustomerData(location.state.customerData);
        setCustomerModalOpen(false);
        // Restore intent based on transaction type
        if (location.state.customerData.transactionType) {
          const mappedIntent = mapTransactionTypeToIntent(location.state.customerData.transactionType);
          setIntent(mappedIntent);
        }
      }
      // Restore request if provided (optional, but helpful if available)
      if (location.state.request) {
        setRequest(location.state.request);
      } else if (location.state.currentRequestId && !request) {
        // If we have a requestId but no request object, fetch it
        fetchRequestDetail(location.state.currentRequestId).then(requestData => {
          if (requestData) {
            setRequest(requestData);
          }
        }).catch(err => {
          console.error('Failed to fetch request when restoring state:', err);
        });
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
          return { ...item, offers: nextOffers, offerType: useVoucher ? 'voucher' : 'cash' };
        }

        // CeX Add-from-CeX items
        if (item.isCustomCeXItem) {
          const nextOffers = useVoucher ? item.voucherOffers ?? [] : item.cashOffers ?? [];
          return { ...item, offers: nextOffers, offerType: useVoucher ? 'voucher' : 'cash' };
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
      transactionType: customerInfo.transactionType || 'sale',
      isNewCustomer: customerInfo.isNewCustomer ?? false,
    });

    setIntent(mappedIntent);
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

  /**
   * "Add from CeX" flow: ask extension to open CeX and wait for user to land on a product-detail page
   * and click "Yes" in the "Have you got the data yet?" panel. The extension opens uk.webuy.com;
   * when the user navigates to a product-detail URL the content script sends LISTING_PAGE_READY,
   * background sends WAITING_FOR_DATA to that tab, and the panel appears. If the panel never appears,
   * check DevTools console on the CeX tab and on the extension service worker (chrome://extensions → CG Suite → service worker) for logs.
   */
  const handleAddFromCeX = async () => {
    setCexLoading(true);
    setCexProductData(null);
    try {
      const data = await getDataFromListingPage('CeX');

      if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
        const product = data.results[0];
        const payload = {
          sellPrice: product.sellPrice ?? product.price,
          tradeInCash: product.tradeInCash ?? 0,
          tradeInVoucher: product.tradeInVoucher ?? 0,
          title: product.title,
          category: product.category,
          image: product.image,
          id: product.id
        };
        const priceData = await fetchCeXProductPrices(payload);
        const merged = { ...product, ...priceData, listingPageUrl: data.listingPageUrl };
        setCexProductData(merged);
        showNotification('CeX product loaded', 'success');
      } else {
        showNotification(data?.error || 'No data returned', 'error');
      }
    } catch (err) {
      console.error('[CG Suite] handleAddFromCeX error:', err);
      showNotification(err?.message || 'Extension communication failed. Is the Chrome extension installed?', 'error');
    } finally {
      setCexLoading(false);
    }
  };

  const handleClearCeXProduct = () => {
    setCexProductData(null);
  };

  const handleCategorySelect = async (category) => {
    // Start a new models request; any older in-flight responses will be ignored
    const requestId = ++modelsRequestIdRef.current;

    setSelectedCartItem(null);
    setCexProductData(null);
    setSelectedCategory(category);
    setSelectedModel(null);
    setAvailableModels([]); // Clear old models to avoid showing stale options
    setIsLoadingModels(true);

    try {
      const models = await fetchProductModels(category);
      if (modelsRequestIdRef.current !== requestId) return; // Stale response
      setAvailableModels(models);
    } finally {
      if (modelsRequestIdRef.current === requestId) {
        setIsLoadingModels(false);
      }
    }
  };

  const addToCart = (item) => {
    // Helper function to find existing item index
    const findExistingItemIndex = (items) => {
      return items.findIndex(cartItem => {
        // For CeX items, one line per variant; same variant = update offer or merge qty
        if (!item.isCustomEbayItem && !item.isCustomCashConvertersItem && item.variantId != null) {
          return cartItem.variantId === item.variantId;
        }
        
        // For eBay items, one line per (title, category); same as CeX: update offer or merge qty
        if (item.isCustomEbayItem) {
          return (
            cartItem.isCustomEbayItem &&
            cartItem.title === item.title &&
            cartItem.category === item.category
          );
        }

        // For Cash Converters items, match by search term and category
        if (item.isCustomCashConvertersItem) {
          return (
            cartItem.isCustomCashConvertersItem &&
            cartItem.title === item.title &&
            cartItem.category === item.category
          );
        }

        // For CeX items from Add from CeX, match by title and subtitle
        if (item.isCustomCeXItem) {
          return (
            cartItem.isCustomCeXItem &&
            cartItem.title === item.title &&
            cartItem.subtitle === item.subtitle
          );
        }
        
        return false;
      });
    };

    // Check current state synchronously to determine notification message and behavior
    const existingItemIndex = findExistingItemIndex(cartItems);
    const isExistingItem = existingItemIndex !== -1;
    let notificationMessage = null;
    const existingItem = isExistingItem ? cartItems[existingItemIndex] : null;
    const sameOffer = existingItem && (
      (existingItem.selectedOfferId ?? null) === (item.selectedOfferId ?? null)
    );

    if (isExistingItem) {
      if (sameOffer) {
        const newQuantity = (existingItem.quantity || 1) + 1;
        notificationMessage = `Quantity increased to ${newQuantity} for ${item.title}`;
      } else {
        notificationMessage = `Offer updated for ${item.title}`;
      }
    } else {
      notificationMessage = `${item.title} added to cart`;
    }

    // Update cart state
    setCartItems((prev) => {
      const existingIndex = findExistingItemIndex(prev);
      if (existingIndex === -1) {
        return [...prev, item];
      }

      const updatedItems = [...prev];
      const existing = updatedItems[existingIndex];
      const sameSelectedOffer = (existing.selectedOfferId ?? null) === (item.selectedOfferId ?? null);

      if (sameSelectedOffer) {
        updatedItems[existingIndex] = {
          ...existing,
          quantity: (existing.quantity || 1) + 1
        };
      } else {
        updatedItems[existingIndex] = {
          ...existing,
          selectedOfferId: item.selectedOfferId,
          offers: item.offers ?? existing.offers,
          cashOffers: item.cashOffers ?? existing.cashOffers,
          voucherOffers: item.voucherOffers ?? existing.voucherOffers
        };
      }
      return updatedItems;
    });
    
    // Show notification once after state update
    setTimeout(() => {
      showNotification(notificationMessage, 'success');
    }, 0);
  };

  const handleCartItemSelect = async (item) => {
    // If clicking the same item, deselect it
    if (selectedCartItem?.id === item.id) {
      setSelectedCartItem(null);
      return;
    }

    // Set immediately so the sidebar highlights the item and MainContent renders right away
    setSelectedCartItem(item);

    // eBay and CeX items don't use variants – skip models fetch for instant display
    const isEbayOrCex = item.isCustomEbayItem || item.isCustomCeXItem;
    if (isEbayOrCex && item.categoryObject) {
      setSelectedCategory(item.categoryObject);
      return;
    }

    if (item.categoryObject) {
      const requestId = ++modelsRequestIdRef.current;
      setSelectedCategory(item.categoryObject);
      setIsLoadingModels(true);

      try {
        const models = await fetchProductModels(item.categoryObject);
        if (modelsRequestIdRef.current !== requestId) return; // Ignore stale responses
        setAvailableModels(models);
        // MainContent's Step-1 effect depends on [selectedCartItem, availableModels]
        // so it will re-run and pick up the correct model once models are available
      } finally {
        if (modelsRequestIdRef.current === requestId) {
          setIsLoadingModels(false);
        }
      }
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

          if (item.request_item_id) {
            updateRequestItemRawData(item.request_item_id, ebayData).catch(() => {});
          }

          return updatedItem;
        }
        return item;
      });
    });
  };

  /**
   * Update cart item with Cash Converters research data
   * Mirrors updateCartItemEbayData - updates local state for the matching cart item
   */
  const updateCartItemCashConvertersData = (variantId, ccData) => {
    setCartItems(prevItems => {
      return prevItems.map(item => {
        if (item.variantId === variantId) {
          return {
            ...item,
            cashConvertersResearchData: ccData
          };
        }
        return item;
      });
    });
  };

  return (
    <div className="bg-gray-50 text-gray-900 h-screen flex flex-col overflow-hidden text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      {!isRepricing && (
        <CustomerIntakeModal
          open={isCustomerModalOpen}
          onClose={handleCustomerSelected}
        />
      )}

      <Header
        customerData={!isRepricing ? customerData : null}
        onTransactionTypeChange={!isRepricing ? handleTransactionTypeChange : null}
      />
      <main className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          onCategorySelect={handleCategorySelect}
          onAddFromCeX={handleAddFromCeX}
          isCeXLoading={cexLoading}
        />
        <MainContent 
          selectedCategory={selectedCategory} 
          availableModels={availableModels}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          isLoadingModels={isLoadingModels}
          addToCart={addToCart}
          updateCartItemEbayData={updateCartItemEbayData}
          updateCartItemCashConvertersData={updateCartItemCashConvertersData}
          customerData={customerData}
          intent={intent}
          setIntent={setIntent}
          request={request}
          setRequest={setRequest}
          selectedCartItem={selectedCartItem}
          cartItems={cartItems}
          cexProductData={cexProductData}
          setCexProductData={setCexProductData}
          onClearCeXProduct={handleClearCeXProduct}
          onDeselectCartItem={() => setSelectedCartItem(null)}
          mode={mode}
        />
      <CartSidebar 
        cartItems={cartItems} 
        setCartItems={setCartItems}
        customerData={customerData}
        currentRequestId={request?.request_id}
        onItemSelect={handleCartItemSelect}
        selectedCartItemId={selectedCartItem?.id}
        mode={mode}
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