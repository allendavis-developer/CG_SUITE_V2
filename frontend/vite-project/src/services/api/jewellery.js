import { API_BASE_URL } from './http';

/** Same endpoints as negotiation category picker: all-categories → products → product-variants. */
const JEWELLERY_PRODUCT_ORDER = [
  'Earrings',
  'Scrap',
  'Bangles',
  'Rings',
  'Necklaces',
  'Bracelets',
  'Chains',
  'Pendant',
  'Bullion (gold)',
  'Coin',
  'Bullion (other)',
];

/** Labels aligned with the jewellery reference-price scrape (migrations 0038–0039). */
const JEWELLERY_SCRAPE_MATERIAL_GRADES = new Set([
  '9ct gold',
  '14ct gold',
  '18ct gold',
  '22ct gold',
  '24ct gold',
  'Silver',
  'Platinum',
  'Palladium',
  'Full Sovereign',
  'Half Sovereign',
  'Krugerrand',
]);

export async function fetchJewelleryCatalog() {
  try {
    const flatRes = await fetch(`${API_BASE_URL}/all-categories/`);
    const flatData = await flatRes.json();
    if (!flatRes.ok || !Array.isArray(flatData)) return null;

    const jew = flatData.find((c) => c.name === 'Jewellery');
    if (!jew?.category_id) return null;

    const prodRes = await fetch(`${API_BASE_URL}/products/?category_id=${jew.category_id}`);
    const productsRaw = await prodRes.json();
    if (!prodRes.ok || !Array.isArray(productsRaw)) return null;

    const pmap = new Map(productsRaw.map((p) => [p.name, p]));
    const products = [];
    for (const name of JEWELLERY_PRODUCT_ORDER) {
      const p = pmap.get(name);
      if (p) products.push({ product_id: p.product_id, name: p.name });
    }
    for (const p of productsRaw) {
      if (!JEWELLERY_PRODUCT_ORDER.includes(p.name)) {
        products.push({ product_id: p.product_id, name: p.name });
      }
    }

    const variantResults = await Promise.all(
      productsRaw.map((p) =>
        fetch(`${API_BASE_URL}/product-variants/?product_id=${p.product_id}`).then(async (r) => ({
          ok: r.ok,
          product: p,
          data: await r.json(),
        }))
      )
    );

    const variants = [];
    const gradeLabels = new Set();
    for (const { ok, product: p, data } of variantResults) {
      if (!ok || !data?.variants?.length) continue;
      for (const v of data.variants) {
        const sku = String(v.cex_sku || '');
        if (!sku.toUpperCase().startsWith('JEW-')) continue;
        const mg = v.attribute_values?.material_grade ?? '';
        if (!JEWELLERY_SCRAPE_MATERIAL_GRADES.has(mg)) continue;
        if (mg) gradeLabels.add(mg);
        variants.push({
          variant_id: v.variant_id,
          product_id: p.product_id,
          product_name: p.name,
          material_grade: mg,
          title: v.title,
          cex_sku: v.cex_sku,
        });
      }
    }

    const material_grades = Array.from(gradeLabels)
      .sort()
      .map((value, idx) => ({ attribute_value_id: idx, value }));

    return {
      category_id: jew.category_id,
      products,
      material_grades,
      variants,
    };
  } catch (err) {
    console.error('Error building jewellery catalog:', err);
    return null;
  }
}
