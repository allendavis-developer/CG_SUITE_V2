import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import NegotiationRowContextMenu from '@/pages/buyer/components/NegotiationRowContextMenu';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import { SPREADSHEET_TABLE_STYLES } from '@/pages/buyer/spreadsheetTableStyles';
import { formatOfferPrice, roundOfferPrice } from '@/utils/helpers';
import { JEWELLERY_TIER_MARGINS_PCT, tierOfferGbpFromReference } from '@/components/jewellery/jewelleryNegotiationCart';
import { fetchJewelleryCatalog } from '@/services/api';
const PICKER_PAGE_SIZE = 20;

const BULLION_GOLD_PRODUCT_NAME = 'Bullion (gold)';
/** Same order as negotiation cart / scrape remap. */
const JEWELLERY_OFFER_TIER_MARGINS_PCT = JEWELLERY_TIER_MARGINS_PCT;

const GOLD_ONLY_MATERIAL_GRADES = new Set([
  '9ct gold',
  '14ct gold',
  '18ct gold',
  '22ct gold',
  '24ct gold',
]);

function JewelleryPickerList({
  items,
  isLoading = false,
  onSelect,
  getLabel,
  getKey,
  searchPlaceholder,
  statsHeading,
  entitySingular,
  entityPlural,
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!isLoading && items.length > 0) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [isLoading, items.length]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => getLabel(m).toLowerCase().includes(q));
  }, [items, query, getLabel]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PICKER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PICKER_PAGE_SIZE, safePage * PICKER_PAGE_SIZE);

  const handleKey = (e) => {
    if (e.key === 'Enter' && pageItems.length === 1) {
      onSelect(pageItems[0]);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
        <span className="material-symbols-outlined animate-spin text-3xl text-brand-blue">sync</span>
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-gray-400">
            search
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          ) : null}
        </div>
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{statsHeading}</p>
              {filtered.length === items.length ? (
                <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                  {items.length}
                  <span className="ml-1.5 text-base font-bold text-gray-700">
                    {items.length === 1 ? entitySingular : entityPlural}
                  </span>
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-brand-blue">
                    {filtered.length}
                    <span className="mx-1 text-lg font-bold text-gray-400">/</span>
                    <span className="text-xl font-bold text-gray-700">{items.length}</span>
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-gray-600">
                    Showing matches for your search — {items.length} total
                  </p>
                </>
              )}
            </div>
            {totalPages > 1 ? (
              <p className="text-xs font-semibold text-gray-600">
                Page <span className="tabular-nums text-gray-900">{safePage}</span> of{' '}
                <span className="tabular-nums text-gray-900">{totalPages}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-gray-500">
            <span className="material-symbols-outlined mb-3 text-4xl text-gray-400">
              {query.trim() ? 'search_off' : 'inventory_2'}
            </span>
            {query.trim() ? (
              <>
                <p className="text-sm font-semibold text-gray-800">No matches</p>
                <p className="mt-1 max-w-sm text-sm text-gray-600">
                  Try different keywords, or clear the search to see all {items.length}{' '}
                  {items.length === 1 ? entitySingular : entityPlural}.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-800">Nothing to show</p>
                <p className="mt-1 max-w-sm text-sm text-gray-600">There are no options in this list yet.</p>
              </>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {pageItems.map((row, i) => (
                <tr
                  key={getKey(row)}
                  onClick={() => onSelect(row)}
                  className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${
                    i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{getLabel(row)}</td>
                  <td className="w-10 px-4 py-3 text-right">
                    <span className="material-symbols-outlined align-middle text-[20px] text-gray-400">chevron_right</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 border-t border-gray-200 bg-brand-blue/10 px-4 py-4 sm:justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">chevron_left</span>
            Prev
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '…' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-sm font-medium text-gray-500">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                      p === safePage
                        ? 'border-brand-blue bg-brand-blue text-white shadow-sm'
                        : 'border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
          </div>

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="flex min-h-11 min-w-[7rem] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
            <span className="material-symbols-outlined text-[22px] leading-none">chevron_right</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function normalizeSourceUnit(unitRaw) {
  const s = String(unitRaw || '').toLowerCase();
  if (s.includes('kg')) return 'PER_KG';
  if (s.includes('gm') || /\bper g\b/.test(s)) return 'PER_G';
  return 'UNIT';
}

function parsePriceNumber(raw) {
  return parseFloat(String(raw ?? '').replace(/,/g, '')) || 0;
}

function ratePerGramFromPrice(sourceKind, priceNumeric) {
  if (!Number.isFinite(priceNumeric) || priceNumeric <= 0) return null;
  if (sourceKind === 'PER_G') return priceNumeric;
  if (sourceKind === 'PER_KG') return priceNumeric / 1000;
  return null;
}

function buildCatalog(sections) {
  const out = [];
  (sections || []).forEach((sec) => {
    (sec?.rows || []).forEach((r, i) => {
      const sourceKind = normalizeSourceUnit(r.unit);
      const priceNumeric = parsePriceNumber(r.priceGbp);
      const catalogId = `${sec.title}::${r.label}::${i}`;
      out.push({
        catalogId,
        sectionTitle: sec.title,
        displayName: `${sec.title} — ${r.label}`,
        sourceKind,
        ratePerGram: ratePerGramFromPrice(sourceKind, priceNumeric),
        unitPrice: sourceKind === 'UNIT' ? priceNumeric : null,
      });
    });
  });
  return out;
}

function defaultWeightUnit(sourceKind) {
  if (sourceKind === 'UNIT') return 'each';
  // Scrape may quote silver per kg, but we always default entry to grams (rate is per-gram internally).
  return 'g';
}

function computeLineTotal(line) {
  if (line.sourceKind === 'UNIT') {
    const n = parseFloat(line.weight) || 0;
    return Math.round(n * (line.unitPrice || 0) * 100) / 100;
  }
  const w = parseFloat(line.weight) || 0;
  const rate = line.ratePerGram;
  if (rate == null || !Number.isFinite(rate)) return 0;
  const grams = line.weightUnit === 'kg' ? w * 1000 : w;
  return Math.round(grams * rate * 100) / 100;
}

function sectionNorm(s) {
  return String(s || '')
    .toLowerCase()
    .trim();
}

/** Narrow scraped rows by metal section so e.g. "Silver" only matches the silver section, not gold rows. */
function catalogSliceForMaterialGrade(catalog, materialGrade) {
  const raw = String(materialGrade || '').trim();
  if (!raw || !catalog.length) return catalog;

  const exact = raw.toLowerCase();
  const bySection = (needle) =>
    catalog.filter((c) => {
      const t = sectionNorm(c.sectionTitle);
      return t === needle || t.includes(needle);
    });

  if (exact === 'silver') return bySection('silver');
  if (exact === 'platinum') return bySection('platinum');
  if (exact === 'palladium') return bySection('palladium');
  if (/\d+ct\s*gold/i.test(raw)) return bySection('gold');

  return catalog;
}

function suggestReferenceEntries(catalog, materialGrade) {
  if (!materialGrade || !catalog.length) return catalog;
  const slice = catalogSliceForMaterialGrade(catalog, materialGrade);
  const pool = slice.length ? slice : catalog;
  const mg = materialGrade.toLowerCase().trim();
  const tokens = mg.split(/[\s/]+/).filter((t) => t.length >= 2);
  const scored = pool
    .map((c) => {
      const d = c.displayName.toLowerCase();
      let score = 0;
      if (d.includes(mg)) score += 10;
      for (const t of tokens) {
        if (d.includes(t)) score += 2;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored.map((x) => x.c) : slice.length ? slice : catalog;
}

function bestReferenceEntry(catalog, materialGrade) {
  if (!catalog.length) return null;
  const ranked = suggestReferenceEntries(catalog, materialGrade);
  return ranked[0] ?? catalog[0] ?? null;
}

function JewelleryTierOfferCell({ referenceTotalGbp, marginPct, isSelected, onSelect }) {
  if (!Number.isFinite(referenceTotalGbp) || referenceTotalGbp <= 0) {
    return (
      <td className="align-top text-[13px] text-gray-400" aria-label={`Offer tier ${marginPct}%`}>
        —
      </td>
    );
  }
  const offerAmt = tierOfferGbpFromReference(referenceTotalGbp, marginPct);
  /** Margin vs reference (RRP) from rounded offer — not the nominal tier %, which ignores £2/£5 rounding. */
  const marginFromRoundedOfferPct = ((referenceTotalGbp - offerAmt) / referenceTotalGbp) * 100;
  return (
    <td
      role="button"
      tabIndex={0}
      className="cursor-pointer align-top text-[13px] leading-snug"
      style={
        isSelected
          ? {
              background: 'rgba(34, 197, 94, 0.15)',
              fontWeight: 700,
              color: '#166534',
            }
          : { fontWeight: 600, color: '#111827' }
      }
      aria-label={`${marginFromRoundedOfferPct.toFixed(1)}% margin on rounded offer${isSelected ? ', selected' : ''}`}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div>£{formatOfferPrice(offerAmt)}</div>
      <div
        className={`text-[9px] font-medium ${isSelected ? 'text-green-800' : 'text-brand-blue'}`}
      >
        {marginFromRoundedOfferPct >= 0 ? '+' : ''}
        {marginFromRoundedOfferPct.toFixed(1)}% margin
      </div>
    </td>
  );
}

export default function JewelleryLineItems({
  sections,
  useVoucherOffers = false,
  onAddJewelleryToNegotiation = null,
  showNotification = null,
  lines: linesProp = null,
  onLinesChange = null,
  onRemoveJewelleryWorkspaceRow = null,
}) {
  const scrapSectionsCatalog = useMemo(() => buildCatalog(sections), [sections]);
  const [dbCatalog, setDbCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [internalLines, setInternalLines] = useState([]);
  const controlled = linesProp != null && typeof onLinesChange === 'function';
  const lines = controlled ? linesProp : internalLines;
  const setLines = controlled ? onLinesChange : setInternalLines;
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState('product');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [jewelleryContextMenu, setJewelleryContextMenu] = useState(null);
  const [syncMarginsOpen, setSyncMarginsOpen] = useState(false);
  const [syncMarginInput, setSyncMarginInput] = useState('');

  useEffect(() => {
    if (!controlled) {
      setInternalLines([]);
    }
  }, [sections, controlled]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogError(null);
      setCatalogLoading(true);
      const data = await fetchJewelleryCatalog();
      if (cancelled) return;
      setCatalogLoading(false);
      if (!data || !data.products?.length) {
        setCatalogError('Jewellery catalogue could not be loaded.');
        setDbCatalog(null);
        return;
      }
      setDbCatalog(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const variantsForProduct = useMemo(() => {
    if (!dbCatalog?.variants || selectedProductId == null) return [];
    let list = dbCatalog.variants.filter((v) => v.product_id === selectedProductId);
    const product = dbCatalog.products?.find((p) => p.product_id === selectedProductId);
    if (product?.name === BULLION_GOLD_PRODUCT_NAME) {
      list = list.filter((v) => GOLD_ONLY_MATERIAL_GRADES.has(v.material_grade));
    }
    return list;
  }, [dbCatalog, selectedProductId]);

  const openModal = () => {
    setStep('product');
    setSelectedProductId(null);
    setModalOpen(true);
  };

  const pickProduct = (product) => {
    setSelectedProductId(product.product_id);
    setStep('variant');
  };

  const addLineForVariant = (v) => {
    const ref = bestReferenceEntry(scrapSectionsCatalog, v.material_grade);
    if (!ref) return;
    const wu = defaultWeightUnit(ref.sourceKind);
    const id = crypto.randomUUID?.() ?? `jewellery-item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLines((prev) => [
      ...prev,
      {
        id,
        request_item_id: null,
        variantId: v.variant_id,
        variantTitle: v.title,
        categoryLabel: v.title,
        itemName: v.title,
        productName: v.product_name,
        materialGrade: v.material_grade,
        referenceEntry: ref,
        sourceKind: ref.sourceKind,
        ratePerGram: ref.ratePerGram,
        unitPrice: ref.unitPrice,
        weightUnit: ref.sourceKind === 'UNIT' ? 'each' : wu,
        weight: '1',
        selectedOfferTierPct: null,
        manualOfferInput: '',
      },
    ]);
    setModalOpen(false);
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id, patch) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleSelectJewelleryTier = useCallback((lineId, marginPct) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const nextPct = l.selectedOfferTierPct === marginPct ? null : marginPct;
        return {
          ...l,
          selectedOfferTierPct: nextPct,
          ...(nextPct != null ? { manualOfferInput: '' } : {}),
        };
      })
    );
  }, []);

  const applySyncMargins = useCallback(() => {
    const n = parseFloat(String(syncMarginInput).replace(/[%,]/g, '').trim());
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      showNotification?.('Enter a margin between 0 and 100 (e.g. 25 for 25%).', 'error');
      return;
    }
    setLines((prev) =>
      prev.map((line) => {
        const total = computeLineTotal(line);
        if (!(total > 0)) return line;
        const offer = tierOfferGbpFromReference(total, n);
        return {
          ...line,
          selectedOfferTierPct: null,
          manualOfferInput: formatOfferPrice(offer),
        };
      })
    );
    setSyncMarginsOpen(false);
    setSyncMarginInput('');
    showNotification?.(`Manual offers set to ~${n}% margin vs reference on each row.`, 'success');
  }, [setLines, showNotification, syncMarginInput]);

  const handleCompleteJewelleryToNegotiation = useCallback(async () => {
    if (!onAddJewelleryToNegotiation) return;
    const drafts = lines.filter((l) => !l.request_item_id);
    if (drafts.length === 0) {
      try {
        await onAddJewelleryToNegotiation([]);
      } catch (err) {
        console.error(err);
        showNotification?.(err?.message || 'Could not complete jewellery workspace', 'error');
      }
      return;
    }
    for (const line of drafts) {
      const t = computeLineTotal(line);
      if (!(t > 0)) {
        showNotification?.('Each new jewellery row needs a positive reference total (check weight).', 'error');
        return;
      }
    }
    try {
      await onAddJewelleryToNegotiation(drafts);
      if (!controlled) {
        setInternalLines([]);
        showNotification?.(
          `${drafts.length} jewellery item${drafts.length !== 1 ? 's' : ''} added to negotiation`,
          'success'
        );
      }
    } catch (err) {
      console.error(err);
      showNotification?.(err?.message || 'Could not add jewellery items to negotiation', 'error');
    }
  }, [lines, onAddJewelleryToNegotiation, showNotification, controlled]);

  const jewellerySelectionSummary = useMemo(() => {
    let offerSum = 0;
    let refSum = 0;
    let selectedRows = 0;
    for (const line of lines) {
      const ref = computeLineTotal(line);
      if (!(ref > 0)) continue;
      const pct = line.selectedOfferTierPct;
      const manualRaw = String(line.manualOfferInput ?? '').trim();
      const manualVal = parseFloat(manualRaw.replace(/[£,]/g, ''));
      let offerAmt = null;
      if (pct != null && JEWELLERY_OFFER_TIER_MARGINS_PCT.includes(pct)) {
        offerAmt = tierOfferGbpFromReference(ref, pct);
      } else if (Number.isFinite(manualVal) && manualVal > 0) {
        offerAmt = roundOfferPrice(manualVal);
      }
      if (offerAmt == null) continue;
      offerSum += offerAmt;
      refSum += ref;
      selectedRows += 1;
    }
    const blendedMarginPct = refSum > 0 ? ((refSum - offerSum) / refSum) * 100 : null;
    return {
      totalOffer: offerSum,
      referenceForSelected: refSum,
      blendedMarginPct,
      selectedRows,
    };
  }, [lines]);

  if (!scrapSectionsCatalog.length && lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-4 text-xs text-gray-600">
        Add rows here after reference prices are loaded. If you already have jewellery on the quote, use{' '}
        <span className="font-semibold text-gray-800">Update reference data</span> above to load the price table.
      </p>
    );
  }

  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white shadow-sm">
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div className="border-b border-gray-200 px-3 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-brand-blue">Your items</h3>
          <button
            type="button"
            onClick={openModal}
            disabled={!scrapSectionsCatalog.length || !dbCatalog?.products?.length}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-brand-blue shadow-md transition-all hover:brightness-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[200px]"
            style={{
              background: 'var(--brand-orange)',
              boxShadow: '0 8px 20px -6px rgba(247, 185, 24, 0.45)',
            }}
            title="Add a jewellery item"
          >
            <span className="material-symbols-outlined text-[24px] leading-none">add_circle</span>
            Add jewellery item
          </button>
        </div>
        {catalogError ? <p className="mt-2 text-xs text-red-600">{catalogError}</p> : null}
      </div>

      {lines.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">
          Load reference prices above, then use <span className="font-semibold text-gray-700">Add jewellery item</span> to
          choose the item type and material. Right-click a row to remove. Optionally click a tier for a pre-selected offer;
          use <span className="font-semibold text-gray-700">Complete</span> to add rows to the negotiation (tiers stay
          available there if you skip them here).
        </p>
      ) : (
        <div className="min-w-0">
          <table className="w-full table-fixed spreadsheet-table spreadsheet-table--static-header border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="w-40">
                  Category
                </th>
                <th scope="col" className="min-w-[120px]">
                  Item Name
                </th>
                <th scope="col" className="w-24">
                  Weight
                </th>
                <th scope="col" className="w-24">
                  Unit
                </th>
                <th scope="col" className="w-28">
                  Total
                </th>
                <th scope="col" className="w-24 spreadsheet-th-offer-tier">
                  1st
                </th>
                <th scope="col" className="w-24 spreadsheet-th-offer-tier">
                  2nd
                </th>
                <th scope="col" className="w-24 spreadsheet-th-offer-tier">
                  3rd
                </th>
                <th scope="col" className="min-w-[5.5rem] w-[6.5rem]">
                  Manual £
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {lines.map((line) => {
                const total = computeLineTotal(line);
                const isUnit = line.sourceKind === 'UNIT';
                const manualSelected = String(line.manualOfferInput ?? '').trim() !== '';
                return (
                  <tr
                    key={line.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setJewelleryContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        lineId: line.id,
                      });
                    }}
                  >
                    <td className="break-words font-medium text-gray-900">{line.categoryLabel || line.variantTitle || '—'}</td>
                    <td>
                      <input
                        type="text"
                        value={line.itemName ?? line.categoryLabel ?? line.variantTitle ?? ''}
                        onChange={(e) => updateLine(line.id, { itemName: e.target.value })}
                        className="h-8 w-full rounded border border-gray-300 px-2 font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                        aria-label="Item name"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={line.weight}
                        onChange={(e) => {
                          const cleaned = String(e.target.value || '').replace(/[^0-9.]/g, '');
                          updateLine(line.id, { weight: cleaned });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-8 w-full min-w-[3.5rem] rounded border border-gray-300 px-2 font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                        aria-label="Weight or quantity"
                      />
                    </td>
                    <td>
                      {isUnit ? (
                        <span className="text-gray-500">each</span>
                      ) : (
                        <select
                          value={line.weightUnit}
                          onChange={(e) => updateLine(line.id, { weightUnit: e.target.value })}
                          className="h-8 w-full max-w-[5.5rem] rounded border border-gray-300 bg-white px-1 text-xs font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                          aria-label="Weight unit"
                        >
                          <option value="g">g</option>
                          <option value="kg">kg</option>
                        </select>
                      )}
                    </td>
                    <td className="font-semibold tabular-nums text-gray-900">£{formatOfferPrice(total)}</td>
                    {JEWELLERY_OFFER_TIER_MARGINS_PCT.map((pct) => (
                      <JewelleryTierOfferCell
                        key={pct}
                        referenceTotalGbp={total}
                        marginPct={pct}
                        isSelected={line.selectedOfferTierPct === pct}
                        onSelect={() => handleSelectJewelleryTier(line.id, pct)}
                      />
                    ))}
                    <td
                      style={
                        manualSelected
                          ? {
                              background: 'rgba(34, 197, 94, 0.15)',
                              fontWeight: 700,
                              color: '#166534',
                            }
                          : undefined
                      }
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.manualOfferInput ?? ''}
                        onChange={(e) =>
                          updateLine(line.id, {
                            manualOfferInput: e.target.value,
                            selectedOfferTierPct: null,
                          })
                        }
                        placeholder="—"
                        className="h-8 w-full min-w-[4.5rem] rounded border border-gray-300 px-2 font-semibold tabular-nums text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30 bg-transparent"
                        aria-label="Manual offer GBP"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            className="border-t border-gray-200 bg-gray-50/90 px-4 py-3 text-gray-900"
            style={{ borderColor: 'rgba(20, 69, 132, 0.15)' }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setSyncMarginInput('');
                    setSyncMarginsOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold uppercase tracking-wide shadow-md transition-colors"
                  style={{
                    background: 'var(--brand-blue)',
                    color: 'white',
                    boxShadow: '0 7px 18px -6px rgba(15, 23, 42, 0.45)',
                  }}
                >
                  <span className="material-symbols-outlined text-[18px] leading-none">tune</span>
                  Sync margins
                </button>
                <p
                  className="mt-3 text-[10px] font-black uppercase tracking-wider"
                  style={{ color: 'var(--brand-blue)' }}
                >
                  Selected totals
                </p>
                <p className="text-[11px] text-gray-600">
                  Totals use a selected tier or a manual £ amount per row (typing manual clears tier selection).
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end sm:text-right">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Total offer
                  </span>
                  <div
                    className="text-2xl font-black tabular-nums leading-none tracking-tight"
                    style={{ color: 'var(--brand-blue)' }}
                  >
                    {jewellerySelectionSummary.selectedRows > 0
                      ? `£${formatOfferPrice(jewellerySelectionSummary.totalOffer)}`
                      : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Margin</span>
                  <div className="text-lg font-bold tabular-nums text-brand-blue">
                    {jewellerySelectionSummary.blendedMarginPct != null
                      ? `${jewellerySelectionSummary.blendedMarginPct >= 0 ? '+' : ''}${jewellerySelectionSummary.blendedMarginPct.toFixed(1)}%`
                      : '—'}
                  </div>
                  {jewellerySelectionSummary.selectedRows > 0 ? (
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      Blended vs reference on {jewellerySelectionSummary.selectedRows} item
                      {jewellerySelectionSummary.selectedRows !== 1 ? 's' : ''} with a selection
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          {onAddJewelleryToNegotiation ? (
            <div
              className="border-t border-gray-200 px-4 py-3 text-gray-900"
              style={{ borderColor: 'rgba(20, 69, 132, 0.15)' }}
            >
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={handleCompleteJewelleryToNegotiation}
                className="w-full rounded-xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide transition-all disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: 'var(--brand-orange)',
                  color: 'var(--brand-blue)',
                  boxShadow: '0 8px 20px -6px rgba(247, 185, 24, 0.35)',
                }}
              >
                Complete
              </button>
              <p className="mt-2 text-center text-[11px] text-gray-600">
                Only <span className="font-semibold text-gray-800">new</span> rows (not yet on the quote) are added.
                Existing quote lines stay listed so you can add more next to them.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {syncMarginsOpen ? (
        <TinyModal
          title="Sync margins"
          zClass="z-[280]"
          onClose={() => {
            setSyncMarginsOpen(false);
            setSyncMarginInput('');
          }}
        >
          <p className="mb-3 text-xs text-gray-600">
            Set the same margin vs reference on every row that has a positive reference total. Manual £ is filled in
            (tier selection cleared) using the same rounding as the tier columns.
          </p>
          <label className="block text-xs font-semibold text-gray-700" htmlFor="jew-sync-margin-pct">
            Margin %
          </label>
          <input
            id="jew-sync-margin-pct"
            type="text"
            inputMode="decimal"
            value={syncMarginInput}
            onChange={(e) => setSyncMarginInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
            placeholder="e.g. 25"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSyncMarginsOpen(false);
                setSyncMarginInput('');
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applySyncMargins}
              className="rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm"
              style={{ background: 'var(--brand-blue)' }}
            >
              Apply
            </button>
          </div>
        </TinyModal>
      ) : null}

      {jewelleryContextMenu ? (
        <NegotiationRowContextMenu
          x={jewelleryContextMenu.x}
          y={jewelleryContextMenu.y}
          zone={NEGOTIATION_ROW_CONTEXT.ITEM_META}
          onClose={() => setJewelleryContextMenu(null)}
          onRemove={() => {
            const line = lines.find((l) => l.id === jewelleryContextMenu.lineId);
            if (onRemoveJewelleryWorkspaceRow && line) {
              onRemoveJewelleryWorkspaceRow(line);
            } else if (line) {
              removeLine(line.id);
            }
            setJewelleryContextMenu(null);
          }}
          removeLabel="Remove jewellery item"
        />
      ) : null}

      {modalOpen ? (
        <TinyModal
          title="Add jewellery item"
          zClass="z-[280]"
          panelClassName="!max-w-xl !h-[min(96vh,960px)] !max-h-[min(96vh,960px)] flex min-w-0 flex-col overflow-hidden"
          bodyScroll={false}
          onClose={() => setModalOpen(false)}
        >
          <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3 overflow-hidden">
            {step === 'product' ? (
              <>
                <p className="shrink-0 text-xs font-semibold text-gray-600">1. Choose item type</p>
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200">
                  <JewelleryPickerList
                    items={dbCatalog?.products || []}
                    isLoading={catalogLoading}
                    onSelect={pickProduct}
                    getLabel={(p) => p.name}
                    getKey={(p) => p.product_id}
                    searchPlaceholder="Search types…"
                    statsHeading="Types in catalogue"
                    entitySingular="type"
                    entityPlural="types"
                  />
                </div>
              </>
            ) : null}

            {step === 'variant' ? (
              <>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    className="inline-flex w-fit items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
                    onClick={() => setStep('product')}
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    Back
                  </button>
                  <p className="text-xs font-semibold text-gray-600">2. Material / grade</p>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200">
                  <JewelleryPickerList
                    items={variantsForProduct}
                    isLoading={false}
                    onSelect={addLineForVariant}
                    getLabel={(v) => v.material_grade}
                    getKey={(v) => v.variant_id}
                    searchPlaceholder="Search materials…"
                    statsHeading="Materials for this type"
                    entitySingular="material"
                    entityPlural="materials"
                  />
                </div>
              </>
            ) : null}
          </div>
        </TinyModal>
      ) : null}
    </div>
  );
}
