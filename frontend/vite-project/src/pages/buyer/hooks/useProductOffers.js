import { useState, useEffect } from 'react';
import { fetchVariantPrices } from '@/services/api';

export const useProductOffers = (variant, useVoucherOffers) => {
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!variant) {
      setOffers([]);
      setReferenceData(null);
      setOurSalePrice('');
      setSelectedOfferId(null); // Reset selected offer when variant is cleared
      return;
    }

    const loadOffers = async () => {
      setIsLoadingOffers(true);
      setError(null);
      try {
        const data = await fetchVariantPrices(variant);
        
        // Select appropriate offers based on transaction type for display
        const selectedOffers = useVoucherOffers ? data.voucher_offers : data.cash_offers;
        setOffers(selectedOffers);
        
        // Store the full data for later use
        setReferenceData({
          ...data.referenceData,
          cash_offers: data.cash_offers,
          voucher_offers: data.voucher_offers
        });
        
        if (data.referenceData && data.referenceData.cex_based_sale_price) {
          setOurSalePrice(data.referenceData.cex_based_sale_price.toString());
        }
        
        if (selectedOffers && selectedOffers.length > 0) {
          setSelectedOfferId(selectedOffers[0].id);
        } else {
          setSelectedOfferId(null);
        }
      } catch (err) {
        console.error('Error fetching offers:', err);
        setError(err);
        setOffers([]);
        setReferenceData(null);
        setOurSalePrice('');
        setSelectedOfferId(null);
      } finally {
        setIsLoadingOffers(false);
      }
    };

    loadOffers();
  }, [variant, useVoucherOffers]);

  // Reset selected offer when variant changes (this was originally a separate effect, now integrated)
  useEffect(() => {
    if (!variant) {
      setSelectedOfferId(null);
    }
  }, [variant]);


  return { offers, isLoadingOffers, selectedOfferId, referenceData, ourSalePrice, setSelectedOfferId, error };
};
