import { apiFetch } from './http';

export const fetchVariantPrices = async (sku) => {
  if (!sku) return { cash_offers: [], voucher_offers: [], referenceData: null };
  try {
    const data = await apiFetch(`/variant-prices/?sku=${sku}`);
    return {
      cash_offers: data.cash_offers || [],
      voucher_offers: data.voucher_offers || [],
      referenceData: data.reference_data,
    };
  } catch (err) {
    console.error('Error fetching offers:', err);
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }
};

export const fetchCeXProductPrices = async (cexData) => {
  if (!cexData) return { cash_offers: [], voucher_offers: [], referenceData: null };
  try {
    const data = await apiFetch('/cex-product-prices/', {
      method: 'POST',
      body: {
        sell_price: cexData.sellPrice,
        tradein_cash: cexData.tradeInCash,
        tradein_voucher: cexData.tradeInVoucher,
        title: cexData.title,
        category: cexData.category,
        category_id: cexData.categoryId ?? null,
        image: cexData.image,
        image_url: cexData.image,
        sku: cexData.id,
      },
    });
    return {
      cash_offers: data.cash_offers || [],
      voucher_offers: data.voucher_offers || [],
      referenceData: data.reference_data,
    };
  } catch (err) {
    console.error('[CG Suite] fetchCeXProductPrices error:', err);
    return { cash_offers: [], voucher_offers: [], referenceData: null };
  }
};
