import React, { useState } from 'react';
import { Icon, Button, Breadcrumb } from '@/components/ui/components';
import MarketComparisonsTable from './MarketComparisonsTable';
import OfferSelection from './OfferSelection';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm.jsx';
import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';

/**
 * Shared view for both:
 * 1. Viewing a saved CeX cart item (readOnly=true, item prop)
 * 2. "Add from CeX" flow (cexProduct prop)
 */
export default function CexProductView({
  item,
  cexProduct,
  isRepricing,
  useVoucherOffers,
  customerData,
  onSelectOfferForCartItem,
  readOnly = false,
  onAddToCart,
  createOrAppendRequestItem,
  onClearCeXProduct,
  cartItems = [],
  setCexProductData,
  onItemAddedToCart,
  showNotification,
  onUpdateCartItemResearch,
}) {
  const [isCeXEbayModalOpen, setCeXEbayModalOpen] = useState(false);
  const [isCeXCashConvertersModalOpen, setCeXCashConvertersModalOpen] = useState(false);

  // ── Viewing saved cart item ──
  if (item) {
    const displayOffers = useVoucherOffers ? (item.voucherOffers || []) : (item.cashOffers || []);
    const refData = item.referenceData || {};
    const rawOur = refData.cex_based_sale_price ?? item.ourSalePrice ?? '';
    const resolvedOurSalePrice =
      rawOur === '' || rawOur == null
        ? ''
        : (Number.isFinite(Number(rawOur)) ? String(roundSalePrice(Number(rawOur))) : String(rawOur));
    const refWithOurSale = {
      ...refData,
      ...(resolvedOurSalePrice !== '' && Number.isFinite(Number(resolvedOurSalePrice))
        ? { our_sale_price: Number(resolvedOurSalePrice) }
        : {}),
    };
    const imageUrl = refData.cex_image_urls?.large || refData.cex_image_urls?.medium || refData.cex_image_urls?.small || item.cexProductData?.image || item.image;
    const cexCompetitorStats = (refData.cex_sale_price != null || item.cexSellPrice != null)
      ? [{ salePrice: refData.cex_sale_price ?? item.cexSellPrice, buyPrice: refData.cex_tradein_cash ?? item.cexBuyPrice }]
      : [];
    const specs = item.cexProductData?.specifications || {};

    const buildItemMarketContext = () => ({
      cexSalePrice: refData.cex_sale_price ?? item.cexSellPrice ?? null,
      ourSalePrice: resolvedOurSalePrice || null,
      ebaySalePrice: item.ebayResearchData?.stats?.median ?? null,
      cashConvertersSalePrice: item.cashConvertersResearchData?.stats?.median ?? null,
      itemTitle: item.title || 'CeX Product',
      itemConfig: (() => { const parts = Object.entries(specs).filter(([l, v]) => v && l !== 'Grade' && l !== 'Condition').map(([, v]) => v); return parts.length ? parts.join(' / ') : null; })(),
      itemCondition: specs.Grade || specs.Condition || null,
      ebaySearchTerm: item.ebayResearchData?.searchTerm || null,
      cashConvertersSearchTerm: item.cashConvertersResearchData?.searchTerm || null,
      cexSpecs: Object.keys(specs).length > 0 ? specs : null,
    });

    return (
      <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
        <div className="flex items-center justify-between px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
          <div className="flex items-center gap-3 py-4">
            <div className="bg-blue-900 p-1.5 rounded">
              <span className="material-symbols-outlined text-yellow-400 text-sm">add_link</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-blue-900">{item.title || 'CeX Product'}</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved item</p>
            </div>
          </div>
        </div>
        <div className="p-8 space-y-8">
          <ProductDetailsCard title={item.title} imageUrl={imageUrl} specs={specs} stockStatus={item.cexProductData?.isOutOfStock || item.cexProductData?.stockStatus} />
          <MarketComparisonsTable
            variant="cex" competitorStats={cexCompetitorStats} ourSalePrice={resolvedOurSalePrice}
            referenceData={refData} ebayData={item.ebayResearchData || null}
            setEbayModalOpen={() => setCeXEbayModalOpen(true)}
            cashConvertersData={item.cashConvertersResearchData || null}
            setCashConvertersModalOpen={() => setCeXCashConvertersModalOpen(true)}
            cexSku={item.cexProductData?.id || item.cexSku} hideBuyInPrice={isRepricing}
          />
          {!isRepricing && displayOffers.length > 0 && (
            <OfferSelection
              variant="cex" offers={displayOffers} referenceData={refWithOurSale}
              offerType={useVoucherOffers ? 'voucher' : 'cash'}
              initialSelectedOfferId={item?.selectedOfferId ?? null}
              syncKey={`${item?.id ?? 'cex'}:${useVoucherOffers ? 'voucher' : 'cash'}`}
              onAddToCart={onSelectOfferForCartItem}
              showAddActionCard={false}
            />
          )}

          {isCeXEbayModalOpen && (
            <EbayResearchForm
              mode="modal" category={{ name: 'CeX', path: ['CeX'] }} savedState={item.ebayResearchData}
              initialHistogramState={false} showManualOffer={false} referenceData={refData}
              ourSalePrice={resolvedOurSalePrice} initialSearchQuery={item.title || item.model}
              marketComparisonContext={buildItemMarketContext()}
              hideOfferCards={isRepricing}
              useVoucherOffers={useVoucherOffers}
              onComplete={(d) => {
                if (d?.cancel) { setCeXEbayModalOpen(false); return; }
                onUpdateCartItemResearch?.(item.id, 'ebay', d);
                setCeXEbayModalOpen(false);
              }}
            />
          )}
          {isCeXCashConvertersModalOpen && (
            <CashConvertersResearchForm
              mode="modal" category={{ name: 'CeX', path: ['CeX'] }} savedState={item.cashConvertersResearchData}
              initialHistogramState={false} referenceData={refData} ourSalePrice={resolvedOurSalePrice}
              initialSearchQuery={item.title || item.model} marketComparisonContext={buildItemMarketContext()}
              useVoucherOffers={useVoucherOffers}
              onComplete={(d) => {
                if (d?.cancel) { setCeXCashConvertersModalOpen(false); return; }
                onUpdateCartItemResearch?.(item.id, 'cashConverters', d);
                setCeXCashConvertersModalOpen(false);
              }}
            />
          )}
        </div>
      </section>
    );
  }

  // ── "Add from CeX" flow ──
  const data = cexProduct;
  const cashOffers = (data.cash_offers || []).map((o, idx) => ({ id: o.id || `cex-cash-${data.id ?? 'cex'}-${idx}`, title: o.title || ['First Offer', 'Second Offer', 'Third Offer'][idx], price: o.price }));
  const voucherOffers = (data.voucher_offers || []).map((o, idx) => ({ id: o.id || `cex-voucher-${data.id ?? 'cex'}-${idx}`, title: o.title || ['First Offer', 'Second Offer', 'Third Offer'][idx], price: o.price }));
  const offers = useVoucherOffers ? voucherOffers : cashOffers;
  const refData = data.referenceData || {};
  const cexBasedRounded =
    refData.cex_based_sale_price != null && Number.isFinite(Number(refData.cex_based_sale_price))
      ? roundSalePrice(Number(refData.cex_based_sale_price))
      : null;
  const refWithOurSale =
    cexBasedRounded != null ? { ...refData, our_sale_price: cexBasedRounded } : { ...refData };
  const imageUrl = refData.cex_image_urls?.large || refData.cex_image_urls?.medium || data.image;

  const buildCeXCartItem = (offerArg) => {
    let selectedOfferId = null, manualOffer = null;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferId = 'manual';
      const rounded = normalizeExplicitSalePrice(offerArg.amount);
      manualOffer = rounded > 50 ? String(rounded) : rounded.toFixed(2);
    } else if (typeof offerArg === 'string') {
      selectedOfferId = offerArg;
    }
    return {
      id: crypto.randomUUID?.() ?? `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: data.title || 'CeX Product', subtitle: data.category || '', quantity: 1,
      category: 'CeX', categoryObject: { name: 'CeX', path: ['CeX'] },
      offers, cashOffers, voucherOffers, isCustomCeXItem: true, variantId: null, request_item_id: null,
      referenceData: refData,
      ourSalePrice: cexBasedRounded,
      cexSellPrice: refData.cex_sale_price ? Number(refData.cex_sale_price) : null,
      cexBuyPrice: refData.cex_tradein_cash ? Number(refData.cex_tradein_cash) : null,
      cexVoucherPrice: refData.cex_tradein_voucher ? Number(refData.cex_tradein_voucher) : null,
      cexOutOfStock: data.isOutOfStock ?? false,
      cexSku: data.id ?? null,
      cexUrl: data.id ? `https://uk.webuy.com/product-detail?id=${data.id}` : null,
      ebayResearchData: data.ebayResearchData || null,
      cashConvertersResearchData: data.cashConvertersResearchData || null,
      cexProductData: data, selectedOfferId, manualOffer,
    };
  };

  const handleAdd = async (offerArg) => {
    const cartItem = buildCeXCartItem(offerArg);
    const isDuplicate = cartItems.some((ci) => ci.isCustomCeXItem && ci.title === cartItem.title && ci.subtitle === cartItem.subtitle);
    try {
      if (isRepricing || isDuplicate) {
        onAddToCart(cartItem, { showNotification });
      } else {
        const reqItemId = await createOrAppendRequestItem({
          variantId: null, rawData: data, cashConvertersData: data.cashConvertersResearchData || null,
          cexSku: data.id, cashOffers: cartItem.cashOffers, voucherOffers: cartItem.voucherOffers,
          selectedOfferId: cartItem.selectedOfferId, manualOffer: cartItem.manualOffer, ourSalePrice: cartItem.ourSalePrice,
        });
        cartItem.request_item_id = reqItemId;
        onAddToCart(cartItem, { showNotification });
      }
      onClearCeXProduct?.();
    } catch (err) {
      console.error('[CG Suite] Failed to add CeX item:', err);
      alert('Failed to add CeX item.');
    }
  };

  const buildCeXMarketContext = () => ({
    cexSalePrice: refData.cex_sale_price ?? null,
    ourSalePrice: cexBasedRounded,
    ebaySalePrice: data.ebayResearchData?.stats?.median ?? null,
    cashConvertersSalePrice: data.cashConvertersResearchData?.stats?.median ?? null,
    itemTitle: data.title || 'CeX Product',
    itemConfig: (() => { const specs = data.specifications || {}; const parts = Object.entries(specs).filter(([l, v]) => v && l !== 'Grade' && l !== 'Condition').map(([, v]) => v); return parts.length ? parts.join(' / ') : null; })(),
    itemCondition: (() => { const specs = data.specifications || {}; return specs.Grade || specs.Condition || null; })(),
    ebaySearchTerm: data.ebayResearchData?.searchTerm || null,
    cashConvertersSearchTerm: data.cashConvertersResearchData?.searchTerm || null,
    cexSpecs: Object.keys(data.specifications || {}).length > 0 ? data.specifications : null,
  });

  return (
    <section className="buyer-main-content w-3/5 min-w-0 min-h-0 flex-1 bg-white flex flex-col overflow-y-auto buyer-panel-scroll">
      <div className="px-8 py-6 border-b border-gray-200 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <div>
            <Breadcrumb items={['CeX', data.category || 'Product'].filter(Boolean)} />
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight mt-2">{data.title || 'CeX Product'}</h1>
          </div>
          {onClearCeXProduct && (
            <button type="button" onClick={onClearCeXProduct} className="text-gray-500 hover:text-gray-700 p-2" aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>

      <div className="p-8 space-y-8">
        <ProductDetailsCard title={data.title} imageUrl={imageUrl} specs={data.specifications} stockStatus={data.isOutOfStock || data.stockStatus} />

        <MarketComparisonsTable
          variant="cex"
          competitorStats={refData.cex_sale_price != null ? [{ salePrice: refData.cex_sale_price, buyPrice: refData.cex_tradein_cash }] : []}
          ourSalePrice={cexBasedRounded != null ? String(cexBasedRounded) : ''} referenceData={refData}
          ebayData={data.ebayResearchData || null} setEbayModalOpen={setCexProductData ? () => setCeXEbayModalOpen(true) : () => {}}
          cashConvertersData={data.cashConvertersResearchData || null}
          setCashConvertersModalOpen={setCexProductData ? () => setCeXCashConvertersModalOpen(true) : () => {}}
          cexSku={data.id} hideBuyInPrice={isRepricing}
        />

        {isRepricing ? (
          !cartItems.some((ci) => ci.isCustomCeXItem && ci.title === data.title && ci.subtitle === (data.category || '')) && (
            <div className="flex justify-end pt-4">
              <Button variant="primary" icon="sell" className="px-6 py-3 font-bold uppercase tracking-tight" onClick={() => handleAdd(null)}>
                Add to Reprice List
              </Button>
            </div>
          )
        ) : offers.length > 0 && (
          <OfferSelection variant="cex" offers={offers} referenceData={refWithOurSale} offerType={useVoucherOffers ? 'voucher' : 'cash'} onAddToCart={handleAdd} />
        )}

        {isCeXEbayModalOpen && (
          <EbayResearchForm
            mode="modal" category={{ name: 'CeX', path: ['CeX'] }} savedState={data.ebayResearchData}
            initialHistogramState={false} showManualOffer={false} referenceData={refData}
            ourSalePrice={cexBasedRounded != null ? cexBasedRounded : ''} initialSearchQuery={data.title || data.modelName}
            marketComparisonContext={buildCeXMarketContext()}
            useVoucherOffers={useVoucherOffers}
            onComplete={(d) => { if (d?.cancel) { setCeXEbayModalOpen(false); return; } setCexProductData?.((prev) => ({ ...prev, ebayResearchData: d })); setCeXEbayModalOpen(false); }}
          />
        )}
        {isCeXCashConvertersModalOpen && (
          <CashConvertersResearchForm
            mode="modal" category={{ name: 'CeX', path: ['CeX'] }} savedState={data.cashConvertersResearchData}
            initialHistogramState={false} referenceData={refData} ourSalePrice={cexBasedRounded != null ? cexBasedRounded : ''}
            initialSearchQuery={data.title || data.modelName} marketComparisonContext={buildCeXMarketContext()}
            useVoucherOffers={useVoucherOffers}
            onComplete={(d) => { if (d?.cancel) { setCeXCashConvertersModalOpen(false); return; } setCexProductData?.((prev) => ({ ...prev, cashConvertersResearchData: d })); setCeXCashConvertersModalOpen(false); }}
          />
        )}
      </div>
    </section>
  );
}

function ProductDetailsCard({ title, imageUrl, specs, stockStatus }) {
  const entries = specs ? Object.entries(specs) : [];
  return (
    <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
      <div className="flex gap-8 items-start">
        {imageUrl && (
          <div className="flex-shrink-0 w-80 h-80 rounded-lg overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
            <img src={imageUrl} alt={title} className="w-full h-full object-contain" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Product details</h2>
            {stockStatus && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-red-200 bg-red-50 text-[11px] font-bold uppercase tracking-wider text-red-700">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {typeof stockStatus === 'string' ? stockStatus : 'Out of stock at CeX'}
              </span>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
            {entries.length > 0 ? entries.map(([label, value]) => (
              <li key={label} className="flex">
                <div><span className="font-semibold text-gray-700 mr-2">{label}:</span><span className="text-sm text-gray-900">{value}</span></div>
              </li>
            )) : (
              <li className="col-span-2 text-sm text-gray-500">No specifications</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
