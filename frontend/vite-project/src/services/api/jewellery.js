import { API_BASE_URL } from './http';

/** Canonical jewellery material grades, aligned with the reference-price scrape (migrations 0038–0039). */
export const JEWELLERY_MATERIAL_GRADES = [
  '9ct gold', '14ct gold', '18ct gold', '22ct gold', '24ct gold',
  'Silver', 'Platinum', 'Palladium',
  'Full Sovereign', 'Half Sovereign', 'Krugerrand',
];

const GOLD_GRADES = new Set(['9ct gold', '14ct gold', '18ct gold', '22ct gold', '24ct gold']);
const COIN_GRADES = new Set(['Full Sovereign', 'Half Sovereign', 'Krugerrand']);
const BULLION_GOLD_DB_NAME = 'Bullion (gold)';

/** "Other" is appended to every material-grade list and creates a line with no reference
 *  price — the buyer fills in a Manual £ offer. */
export const OTHER_MATERIAL_GRADE = 'Other';

/** NosPos "Jewellery & Watches" tree — drives the jewellery buying picker one-for-one.
 *  Nodes with `children` are branches (rendered as folders); everything else is a leaf.
 *  `dbName` points at the backing `products` row where one exists; subcategories inherit
 *  it from the parent so DB variant lookups keep working on drill-down.
 *  Leaves without a backing DB product still reach the material step — see
 *  `materialGradesForLeaf` + `variantsForProduct` in JewelleryLineItems.jsx. */
const JEWELLERY_TREE = [
  { name: 'Bangles', dbName: 'Bangles' },
  { name: 'Bracelets', dbName: 'Bracelets' },
  { name: 'Bullion / Bars (Gold - VAT Exempt)', dbName: BULLION_GOLD_DB_NAME },
  { name: 'Bullion / Bars (Silver & Other Non Gold Bars)', dbName: 'Bullion (other)' },
  { name: 'Chains', dbName: 'Chains' },
  { name: 'Charms', children: ['Pandora', 'Other'] },
  {
    name: 'Coins',
    dbName: 'Coin',
    children: [
      'Britannia Coins',
      'Britannia Coins (Silver)',
      'Krugerrands',
      'Sovereigns',
      'Other (Standard Margin VAT)',
      'Other (VAT Exempt)',
    ],
  },
  { name: 'Costume Jewellery', children: ['Pandora', 'Other'] },
  { name: 'Earrings', dbName: 'Earrings' },
  { name: 'Miscellaneous' },
  { name: 'Necklaces', dbName: 'Necklaces' },
  { name: 'Pendant', dbName: 'Pendant' },
  { name: 'Rings', dbName: 'Rings', children: ['Engagement Ring', 'Pandora', 'Wedding Band', 'Other'] },
  { name: 'Scrap', dbName: 'Scrap' },
  {
    name: 'Watches',
    children: [
      'Audemars Piguet', 'Baume & Mercier', 'Benson', 'Breitling', 'Cartier', 'Casio',
      'Chopard', 'Christopher Ward', 'Citizen', 'DKNY', 'Dietrich', 'Ebel', 'Fossil',
      'G-Shock', 'Gucci', 'Hublot', 'Hugo Boss', 'IWC', 'Jaeger-LeCoultre', 'Longines',
      'Louifrey', 'Michael Kors', 'Montblanc', 'Omega', 'Panerai', 'Patek Philippe',
      'Porsche Design', 'Rado', 'Raymond Weil', 'Rolex', 'Rotary', 'Seiko', 'Sekonda',
      'Tag Heuer', 'Tiffany', 'Tissot', 'Tudor', 'Wakamann', 'Zenith', 'Other',
    ],
  },
  { name: 'Other' },
];

/** Grades offered for a picker leaf. Three rules:
 *    - Coin grades are locked to the Coins branch.
 *    - Bullion (gold) only offers gold grades.
 *    - "Other" is appended to every list as a manual-price escape hatch. */
export function materialGradesForLeaf(leaf) {
  const isBullionGold = leaf?.dbName === BULLION_GOLD_DB_NAME;
  const isUnderCoins = leaf?.parentName === 'Coins' || leaf?.name === 'Coins';
  const grades = JEWELLERY_MATERIAL_GRADES.filter((g) => {
    if (isBullionGold) return GOLD_GRADES.has(g);
    if (COIN_GRADES.has(g)) return isUnderCoins;
    return true;
  });
  return [...grades, OTHER_MATERIAL_GRADE];
}

/** Flatten the tree into picker-ready products. Top-level leaves and branches get the DB id
 *  of their backing product (if any); children inherit the parent's DB id so the variant
 *  table still resolves on drill-down. `product_id` is only used as a unique React key. */
function buildPickerProducts(dbProducts) {
  const dbByName = new Map(dbProducts.map((p) => [p.name, p]));
  return JEWELLERY_TREE.map((node) => {
    const db = node.dbName ? dbByName.get(node.dbName) : null;
    const dbProductId = db?.product_id ?? null;
    const dbName = db?.name ?? null;
    const children = node.children?.map((childName) => ({
      product_id: `nospos:${node.name}/${childName}`,
      name: childName,
      parentName: node.name,
      dbProductId,
      dbName,
    })) ?? null;
    return {
      product_id: dbProductId != null ? String(dbProductId) : `nospos:${node.name}`,
      name: node.name,
      dbProductId,
      dbName,
      children,
    };
  });
}

/** Pull every jewellery variant with a JEW- SKU and a known material grade. */
async function fetchJewelleryVariants(dbProducts) {
  const responses = await Promise.all(
    dbProducts.map(async (p) => {
      const res = await fetch(`${API_BASE_URL}/product-variants/?product_id=${p.product_id}`);
      return { ok: res.ok, product: p, data: await res.json() };
    })
  );
  const variants = [];
  for (const { ok, product, data } of responses) {
    if (!ok) continue;
    for (const v of data?.variants ?? []) {
      const sku = String(v.cex_sku || '').toUpperCase();
      const mg = v.attribute_values?.material_grade ?? '';
      if (!sku.startsWith('JEW-') || !JEWELLERY_MATERIAL_GRADES.includes(mg)) continue;
      variants.push({
        variant_id: v.variant_id,
        product_id: product.product_id,
        product_name: product.name,
        material_grade: mg,
        title: v.title,
        cex_sku: v.cex_sku,
      });
    }
  }
  return variants;
}

export async function fetchJewelleryCatalog() {
  try {
    const catsRes = await fetch(`${API_BASE_URL}/all-categories/`);
    const cats = await catsRes.json();
    const jew = catsRes.ok && Array.isArray(cats) ? cats.find((c) => c.name === 'Jewellery') : null;
    if (!jew?.category_id) return null;

    const prodRes = await fetch(`${API_BASE_URL}/products/?category_id=${jew.category_id}`);
    const dbProducts = await prodRes.json();
    if (!prodRes.ok || !Array.isArray(dbProducts)) return null;

    return {
      category_id: jew.category_id,
      products: buildPickerProducts(dbProducts),
      variants: await fetchJewelleryVariants(dbProducts),
    };
  } catch (err) {
    console.error('Error building jewellery catalog:', err);
    return null;
  }
}
