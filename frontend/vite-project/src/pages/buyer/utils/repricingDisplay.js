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
    return Number(item.ourSalePrice);
  }
  if (item?.ebayResearchData?.stats?.suggestedPrice != null) {
    return Number(item.ebayResearchData.stats.suggestedPrice);
  }
  return null;
};

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
