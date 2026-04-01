/** 1 troy ounce in grams (international avoirdupois conversion for bullion). */
export const JEWELLERY_TROY_OZ_GRAMS = 31.1034768;

/**
 * Pick a reference catalog entry for Coin + Silver: 1 unit = 1 troy oz.
 * Prefers a scraped Silver-section row already priced per unit (oz); otherwise derives £/oz from £/g.
 */
export function troyOzSilverReferenceFromCatalog(catalog) {
  const slice = (catalog || []).filter((c) => {
    const t = String(c.sectionTitle || '')
      .toLowerCase()
      .trim();
    return t === 'silver' || t.includes('silver');
  });
  if (!slice.length) return null;
  const unitRow = slice.find(
    (c) =>
      c.sourceKind === 'UNIT' &&
      c.unitPrice != null &&
      Number.isFinite(c.unitPrice) &&
      c.unitPrice > 0
  );
  if (unitRow) return unitRow;
  const perG = slice.find(
    (c) => c.ratePerGram != null && Number.isFinite(c.ratePerGram) && c.ratePerGram > 0
  );
  if (!perG) return null;
  const unitPrice = Math.round(perG.ratePerGram * JEWELLERY_TROY_OZ_GRAMS * 100) / 100;
  return {
    ...perG,
    catalogId: `${perG.catalogId}::__troy_oz__`,
    sourceKind: 'UNIT',
    ratePerGram: null,
    unitPrice,
    displayName: `${perG.displayName} (1 troy oz)`,
  };
}
