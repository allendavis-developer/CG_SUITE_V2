export function resolvePersistedResearchCategory(researchData, fallbackCategoryObject = null) {
  const candidates = [
    researchData?.resolvedCategory,
    researchData?.categoryObject,
    fallbackCategoryObject,
  ];
  return candidates.find((cat) => cat && typeof cat === 'object' && String(cat.name ?? '').trim() !== '') || null;
}

export function buildPersistedEbayRawData(
  researchData,
  { categoryObject = null, referenceData = null, cashOffers = null, voucherOffers = null } = {}
) {
  const base = researchData && typeof researchData === 'object' ? { ...researchData } : {};
  const resolvedCategory = base?.resolvedCategory?.id != null ? base.resolvedCategory : null;
  const persistedCategoryObject = resolvePersistedResearchCategory(base, categoryObject);
  const categoryName =
    base.category ||
    resolvedCategory?.name ||
    persistedCategoryObject?.name ||
    null;

  if (resolvedCategory) base.resolvedCategory = resolvedCategory;
  if (persistedCategoryObject) base.categoryObject = persistedCategoryObject;
  if (categoryName) base.category = categoryName;
  if (referenceData) base.referenceData = referenceData;
  if (Array.isArray(cashOffers)) base.cash_offers = cashOffers;
  if (Array.isArray(voucherOffers)) base.voucher_offers = voucherOffers;

  return base;
}
