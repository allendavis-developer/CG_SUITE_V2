import { normalizeExplicitSalePrice, roundSalePrice } from '@/utils/helpers';
import { resolvePersistedCexRrp } from './negotiationHelpers';

export const formatMoney = (value) => {
  const num = value == null ? null : Number(value);
  return num == null || Number.isNaN(num) ? "—" : `£${num.toFixed(2)}`;
};

export const getResearchMedian = (data) => {
  const median = data?.stats?.median;
  return median == null ? "—" : formatMoney(median);
};

export const resolveRepricingSalePrice = (item) => {
  if (item?.ourSalePrice !== undefined && item.ourSalePrice !== null && item.ourSalePrice !== '') {
    const n = Number(item.ourSalePrice);
    return Number.isFinite(n) && n > 0 ? normalizeExplicitSalePrice(n) : null;
  }
  if (item?.ebayResearchData?.stats?.suggestedPrice != null) {
    const n = Number(item.ebayResearchData.stats.suggestedPrice);
    return Number.isFinite(n) ? roundSalePrice(n) : null;
  }
  if (item?.cashConvertersResearchData?.stats?.suggestedPrice != null) {
    const n = Number(item.cashConvertersResearchData.stats.suggestedPrice);
    return Number.isFinite(n) ? roundSalePrice(n) : null;
  }
  if (item?.cgResearchData?.stats?.suggestedPrice != null) {
    const n = Number(item.cgResearchData.stats.suggestedPrice);
    return Number.isFinite(n) ? roundSalePrice(n) : null;
  }
  return null;
};

/**
 * List/upload workspace: effective per-unit retail for pipelines (Upload RRP column, then CeX
 * reference layers after pencil merge — same layers as {@link resolvePersistedCexRrp}).
 */
export function resolveUploadPipelineSalePrice(item) {
  const fromFields = resolveRepricingSalePrice(item);
  if (fromFields != null) return fromFields;
  const fromCex = resolvePersistedCexRrp(item);
  if (fromCex != null && Number.isFinite(Number(fromCex)) && Number(fromCex) > 0) return Number(fromCex);
  return null;
}

export const getEditableSalePriceState = (item, quantity = 1) => {
  const perUnitSalePrice = resolveRepricingSalePrice(item);
  const totalSalePrice =
    perUnitSalePrice != null && !Number.isNaN(perUnitSalePrice)
      ? perUnitSalePrice * quantity
      : null;
  const isEditingRowTotal = item?.ourSalePriceInput !== undefined;
  const displayValue = isEditingRowTotal
    ? item.ourSalePriceInput
    : (totalSalePrice != null && !Number.isNaN(totalSalePrice) ? totalSalePrice.toFixed(2) : '');

  return {
    perUnitSalePrice,
    totalSalePrice,
    isEditingRowTotal,
    displayValue,
  };
};

/**
 * Gross margin % for upload rows: (Upload RRP − NosPos unit cost) ÷ Upload RRP.
 * Uses {@link resolveUploadPipelineSalePrice} for RRP and `uploadNosposStockFromBarcode.costPrice` for cost.
 * @returns {number | null}
 */
export function resolveUploadMarginPct(item) {
  const rrp = resolveUploadPipelineSalePrice(item);
  const raw = item?.uploadNosposStockFromBarcode?.costPrice;
  if (raw == null || String(raw).trim() === '') return null;
  const cost = Number.parseFloat(String(raw).replace(/[£,\s]/g, ''));
  if (rrp == null || !Number.isFinite(rrp) || rrp <= 0) return null;
  if (!Number.isFinite(cost) || cost < 0) return null;
  return ((rrp - cost) / rrp) * 100;
}
