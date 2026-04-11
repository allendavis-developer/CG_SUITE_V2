import React, { useState } from 'react';
import { Icon, Breadcrumb } from '@/components/ui/components';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import CexMarketPricingStrip from './CexMarketPricingStrip';
import WorkspacePricingStatCards from './WorkspacePricingStatCards';
import OfferSelection from './OfferSelection';
import EbayResearchForm from '@/components/forms/EbayResearchForm.jsx';
import CashConvertersResearchForm from '@/components/forms/CashConvertersResearchForm.jsx';
import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';
import { validateBuyerCartItemOffers } from '@/utils/cartOfferValidation';
import { buildInitialSearchQuery, buildCeXProductResearchInitialQuery } from '@/pages/buyer/utils/negotiationHelpers';

function formatInHouseCategoryBreadcrumb(categoryObject) {
  if (!categoryObject?.id) return '';
  const p = categoryObject.path;
  if (Array.isArray(p) && p.length > 0) {
    return p.map((s) => String(s).trim()).filter(Boolean).join(' › ');
  }
  if (categoryObject.name != null && String(categoryObject.name).trim() !== '') {
    return String(categoryObject.name).trim();
  }
  return '';
}

function InHouseCategoryAiLine({ categoryObject, aiFromCascade }) {
  if (!aiFromCascade) return null;
  const crumb = formatInHouseCategoryBreadcrumb(categoryObject);
  if (!crumb) return null;
  return (
    <p className="mt-2 text-xs leading-snug text-gray-700">
      <span className="font-bold uppercase tracking-wide text-brand-blue">In-house category (AI)</span>
      <span className="mx-1.5 text-gray-400" aria-hidden>
        ·
      </span>
      <span className="font-medium text-gray-800">{crumb}</span>
    </p>
  );
}

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
  /** Called when the X button is pressed to cancel without adding. Falls back to onClearCeXProduct. */
  onCancelCeXProduct = null,
  cartItems = [],
  setCexProductData,
  onItemAddedToCart,
  showNotification,
  onUpdateCartItemResearch,
  blockedOfferSlots = null,
  onBlockedOfferClick = null,
  /** When set (header CeX workspace), keeps one negotiation row id for preview AI + Add to Cart. */
  negotiationClientLineId = null,
}) {
  const [isCeXEbayModalOpen, setCeXEbayModalOpen] = useState(false);
  const [isCeXCashConvertersModalOpen, setCeXCashConvertersModalOpen] = useState(false);
  const resolvedItemCategory =
    item?.categoryObject ||
    (item?.category ? { name: item.category, path: [item.category] } : { name: 'CeX', path: ['CeX'] });

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
        <div className="flex flex-col gap-4 px-8 py-4 bg-gray-50 border-b border-gray-200 sticky top-0 z-40 sm:flex-row sm:items-stretch sm:gap-4">
          <div className="flex min-w-0 shrink-0 items-center gap-3 self-stretch sm:max-w-[min(100%,20rem)]">
            <div className="bg-brand-blue p-1.5 rounded shrink-0 self-center">
              <span className="material-symbols-outlined text-brand-orange text-sm">add_link</span>
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <h2 className="text-sm font-bold text-brand-blue">{item.title || 'CeX Product'}</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Viewing saved item</p>
              <InHouseCategoryAiLine
                categoryObject={item.categoryObject}
                aiFromCascade={item.cexProductData?.aiInternalCategoryFromCascade === true}
              />
            </div>
          </div>
          <div className="flex min-w-0 w-full flex-1 flex-col gap-3 self-stretch sm:flex-row sm:items-stretch">
            <WorkspacePricingStatCards
              referenceData={refData}
              ourSalePrice={resolvedOurSalePrice}
              hideBuyInPrice={isRepricing}
              cexOutOfStock={item.cexProductData?.isOutOfStock || item.cexOutOfStock}
            />
            {!isRepricing && displayOffers.length > 0 ? (
              <>
                <div
                  className="mx-1 hidden w-px shrink-0 self-stretch rounded-full bg-gray-200/70 sm:block"
                  aria-hidden
                />
                <div className="flex min-w-0 w-full flex-1 flex-col justify-center self-stretch">
                <OfferSelection
                  className="min-w-0 w-full"
                  variant="cex"
                  offers={displayOffers}
                  referenceData={refWithOurSale}
                  offerType={useVoucherOffers ? 'voucher' : 'cash'}
                  initialSelectedOfferId={item?.selectedOfferId ?? null}
                  syncKey={`${item?.id ?? 'cex'}:${useVoucherOffers ? 'voucher' : 'cash'}`}
                  onAddToCart={onSelectOfferForCartItem}
                  showAddActionCard={false}
                  toolbarLayout
                  toolbarFillWidth
                  hideSectionHeader
                />
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="p-8 space-y-8">
          <ProductDetailsCard title={item.title} imageUrl={imageUrl} specs={specs} stockStatus={item.cexProductData?.isOutOfStock || item.cexProductData?.stockStatus} />
          <CexMarketPricingStrip
            variant={item.cexProductData?.id || item.cexSku || 'cex'}
            competitorStats={cexCompetitorStats}
            ourSalePrice={resolvedOurSalePrice}
            referenceData={refData}
            cexProductUrl={item.cexUrl}
            ebayData={item.ebayResearchData || null}
            cashConvertersData={item.cashConvertersResearchData || null}
            onOpenEbayResearch={() => setCeXEbayModalOpen(true)}
            onOpenCashConvertersResearch={() => setCeXCashConvertersModalOpen(true)}
            cexSku={item.cexProductData?.id || item.cexSku}
            hideBuyInPrice={isRepricing}
            omitCorePricing
          />

          {isCeXEbayModalOpen && (
            <EbayResearchForm
              mode="modal" category={resolvedItemCategory} savedState={item.ebayResearchData}
              initialHistogramState={false} showManualOffer={false} referenceData={refData}
              ourSalePrice={resolvedOurSalePrice} initialSearchQuery={buildInitialSearchQuery(item) ?? item.title ?? item.model}
              marketComparisonContext={buildItemMarketContext()}
              hideOfferCards={isRepricing}
              hideAddAction={true}
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
              mode="modal" category={resolvedItemCategory} savedState={item.cashConvertersResearchData}
              initialHistogramState={false} referenceData={refData} ourSalePrice={resolvedOurSalePrice}
              initialSearchQuery={buildInitialSearchQuery(item) ?? item.title ?? item.model} marketComparisonContext={buildItemMarketContext()}
              useVoucherOffers={useVoucherOffers}
              hideAddAction={true}
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
    const researchQuery = buildCeXProductResearchInitialQuery(data);
    const existingByLine =
      negotiationClientLineId != null
        ? cartItems.find((ci) => ci.id === negotiationClientLineId)
        : null;
    return {
      id:
        negotiationClientLineId ??
        crypto.randomUUID?.() ??
        `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: data.title || 'CeX Product',
      subtitle: data.category || '',
      variantName: researchQuery || undefined,
      quantity: 1,
      category: data.category || 'CeX',
      categoryObject: data.categoryObject || (data.category ? { name: data.category, path: [data.category] } : { name: 'CeX', path: ['CeX'] }),
      offers,
      cashOffers,
      voucherOffers,
      isCustomCeXItem: true,
      variantId: null,
      request_item_id: existingByLine?.request_item_id ?? null,
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
    if (!isRepricing) {
      const offerErr = validateBuyerCartItemOffers(cartItem, useVoucherOffers);
      if (offerErr) {
        showNotification?.(offerErr, 'error');
        return;
      }
    }
    const isDuplicate = cartItems.some((ci) => ci.isCustomCeXItem && ci.title === cartItem.title && ci.subtitle === cartItem.subtitle);
    try {
      if (isRepricing || isDuplicate) {
        onAddToCart(cartItem, { showNotification });
      } else {
        let reqItemId = cartItem.request_item_id;
        if (reqItemId == null || reqItemId === '') {
          reqItemId = await createOrAppendRequestItem({
            variantId: null, rawData: data, cashConvertersData: data.cashConvertersResearchData || null,
            cexSku: data.id, cashOffers: cartItem.cashOffers, voucherOffers: cartItem.voucherOffers,
            selectedOfferId: cartItem.selectedOfferId, manualOffer: cartItem.manualOffer, ourSalePrice: cartItem.ourSalePrice,
          });
        }
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
      <div className="border-b border-gray-200 bg-gray-50/50 px-8 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-4">
          <div className="flex min-w-0 shrink-0 flex-col justify-center self-stretch lg:max-w-[min(100%,28rem)] xl:max-w-[32rem]">
            <Breadcrumb items={['CeX']} />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-900">{data.title || 'CeX Product'}</h1>
            <InHouseCategoryAiLine
              categoryObject={data.categoryObject}
              aiFromCascade={data.aiInternalCategoryFromCascade === true}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch sm:flex-row sm:items-stretch">
            <WorkspacePricingStatCards
              referenceData={refData}
              ourSalePrice={cexBasedRounded != null ? String(cexBasedRounded) : ''}
              hideBuyInPrice={isRepricing}
              cexOutOfStock={data.isOutOfStock ?? false}
            />
            {!isRepricing && offers.length > 0 ? (
              <>
                <div
                  className="mx-1 hidden w-px shrink-0 self-stretch rounded-full bg-gray-200/70 sm:block"
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center self-stretch">
                <OfferSelection
                  className="min-w-0 w-full"
                  variant="cex"
                  offers={offers}
                  referenceData={refWithOurSale}
                  offerType={useVoucherOffers ? 'voucher' : 'cash'}
                  onAddToCart={handleAdd}
                  blockedOfferSlots={blockedOfferSlots}
                  onBlockedOfferClick={onBlockedOfferClick}
                  toolbarLayout
                  toolbarFillWidth
                  hideSectionHeader
                />
                </div>
              </>
            ) : null}
            {(onCancelCeXProduct || onClearCeXProduct) && (
              <div className="flex shrink-0 items-center sm:self-center">
                <WorkspaceCloseButton
                  title="Close CeX product"
                  onClick={onCancelCeXProduct ?? onClearCeXProduct}
                  className="shrink-0"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        <ProductDetailsCard title={data.title} imageUrl={imageUrl} specs={data.specifications} stockStatus={data.isOutOfStock || data.stockStatus} />

        {isRepricing && !cartItems.some((ci) => ci.isCustomCeXItem && ci.title === data.title && ci.subtitle === (data.category || '')) && (
          <button
            type="button"
            onClick={() => handleAdd(null)}
            className="w-full py-4 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors flex items-center justify-center gap-2"
            style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
          >
            <span className="material-symbols-outlined text-[20px]">sell</span>
            Add to reprice list
          </button>
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
