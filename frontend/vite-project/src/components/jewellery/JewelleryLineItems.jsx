import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import NegotiationRowContextMenu from '@/pages/buyer/components/NegotiationRowContextMenu';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';
import {
  SPREADSHEET_TABLE_STYLES,
  SPREADSHEET_TABLE_WORKSPACE_PERF_STYLES,
} from '@/styles/spreadsheetTableStyles';
import { formatOfferPrice, roundOfferPrice, calculatePctOfSale } from '@/utils/helpers';
import { useOfferMetricDisplay } from '@/store/useAppStore';
import JewelleryLineDetailsBlockingModal from '@/components/jewellery/JewelleryLineDetailsBlockingModal';
import {
  tierOfferGbpFromReference,
  computeWorkspaceLineTotal,
  isJewelleryCoinLine,
  isJewelleryCoinSilverOzLine,
  lineNeedsJewelleryWorkspaceDetail,
  resolveJewelleryTierMarginsPct,
  sanitizeJewelleryCoinUnitsInput,
  sanitizeJewelleryWeightInput,
} from '@/components/jewellery/jewelleryNegotiationCart';
import { troyOzSilverReferenceFromCatalog } from '@/components/jewellery/jewellerySilverCoinReference';
import { fetchJewelleryCatalog } from '@/services/api';
import { materialGradesForLeaf, OTHER_MATERIAL_GRADE } from '@/services/api/jewellery';
import useAppStore from '@/store/useAppStore';
import { getBlockedOfferSlots, isBlockedForItem } from '@/utils/customerOfferRules';
const PICKER_PAGE_SIZE = 20;

/** Survives unmount when leaving the jewellery workspace so we do not re-open the picker on remount. */
let lastJewelleryPickerOpenNonceHandled = 0;

/** Reference entry for lines with no scrap price (i.e. "Other" material grade). Kept as
 *  a PER_G line so the Weight column still shows a g/kg selector; the line's total is driven
 *  by the buyer-entered `overrideReferenceTotal`, not weight × rate. */
const OTHER_REFERENCE_ENTRY = Object.freeze({
  catalogId: 'synth:other',
  sectionTitle: 'Other',
  displayName: 'Other',
  sourceKind: 'PER_G',
  ratePerGram: null,
  unitPrice: null,
});

/**
 * A single-step scrollable list with search + pagination. Callers either:
 *  - pass `isBranch` (treats items as a NosPos tree — renders smartphone/folder icons
 *    + a chevron_right only for branches), or
 *  - omit `isBranch` (flat list — no leading icon, trailing chevron on every row).
 * "Other*" labels are always pinned to the bottom, even after search filtering.
 */
function JewelleryPickerList({
  items,
  isLoading = false,
  onSelect,
  getLabel,
  getKey,
  isBranch = null,
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
    const matches = q ? items.filter((m) => getLabel(m).toLowerCase().includes(q)) : items;
    /** "Other" (and "Other (…)") always sinks to the bottom of any list it appears in. */
    const nonOther = [];
    const other = [];
    for (const it of matches) {
      (getLabel(it).toLowerCase().startsWith('other') ? other : nonOther).push(it);
    }
    return [...nonOther, ...other];
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
              {pageItems.map((row, i) => {
                /** `branch` is tri-state: true → folder row, false → smartphone row, null → flat list (no icons). */
                const branch = isBranch ? isBranch(row) : null;
                const leadingIcon = branch == null ? null : branch ? 'folder' : 'smartphone';
                const showTrailingChevron = branch == null || branch;
                return (
                  <tr
                    key={getKey(row)}
                    onClick={() => onSelect(row)}
                    className={`cursor-pointer border-b border-gray-200/80 transition-colors hover:bg-brand-blue/5 hover:text-brand-blue ${
                      i % 2 === 0 ? 'bg-white' : 'bg-brand-blue/10'
                    }`}
                  >
                    {leadingIcon ? (
                      <td className="w-10 pl-4 pr-1 py-3 text-left">
                        <span className="material-symbols-outlined align-middle text-[20px] text-gray-500">
                          {leadingIcon}
                        </span>
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-medium text-gray-900">{getLabel(row)}</td>
                    <td className="w-10 px-4 py-3 text-right">
                      {showTrailingChevron ? (
                        <span className="material-symbols-outlined align-middle text-[20px] text-gray-400">
                          chevron_right
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
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

/** Mastermelt "Gold Coins" block: list price is per coin, not per gram. */
function isGoldCoinsSection(sectionTitle) {
  const t = String(sectionTitle || '').toLowerCase().trim();
  return t === 'gold coins' || t.includes('gold coin');
}

function buildCatalog(sections) {
  const out = [];
  (sections || []).forEach((sec) => {
    (sec?.rows || []).forEach((r, i) => {
      let sourceKind = normalizeSourceUnit(r.unit);
      const priceNumeric = parsePriceNumber(r.priceGbp);
      const coinRow = isGoldCoinsSection(sec.title) && priceNumeric > 0;
      if (coinRow) sourceKind = 'UNIT';
      const catalogId = `${sec.title}::${r.label}::${i}`;
      out.push({
        catalogId,
        sectionTitle: sec.title,
        displayName: `${sec.title} — ${r.label}`,
        sourceKind,
        ratePerGram: coinRow ? null : ratePerGramFromPrice(sourceKind, priceNumeric),
        unitPrice: coinRow ? priceNumeric : sourceKind === 'UNIT' ? priceNumeric : null,
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

/** Reference scrap: unit suffix in-cell (/g, ea, /unit for gold coins, /oz for silver coin). */
function ScrapReferenceCell({ line }) {
  if (line.sourceKind === 'UNIT') {
    const u = line.unitPrice;
    if (u != null && Number.isFinite(u) && u > 0) {
      const unitSuffix = isJewelleryCoinSilverOzLine(line) ? '/oz' : isJewelleryCoinLine(line) ? '/unit' : 'ea';
      return (
        <td className="font-semibold tabular-nums text-gray-900">
          £{formatOfferPrice(u)}
          <span className="ml-0.5 text-[10px] font-medium text-gray-500">{unitSuffix}</span>
        </td>
      );
    }
    return (
      <td className="tabular-nums text-gray-400" aria-label="Scrap reference">
        —
      </td>
    );
  }
  const r = line.ratePerGram;
  if (r != null && Number.isFinite(r) && r > 0) {
    return (
      <td
        className="font-semibold tabular-nums text-gray-900"
        title="Reference price per gram (totals and tiers use weight × this rate)"
      >
        £{formatOfferPrice(r)}
        <span className="ml-0.5 text-[10px] font-medium text-gray-500">/g</span>
      </td>
    );
  }
  return (
    <td className="tabular-nums text-gray-400" aria-label="Scrap per gram">
      —
    </td>
  );
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
  /** Gold Coins section rows (labels match attribute values + scrape `label` column). */
  if (
    exact === 'full sovereign' ||
    exact === 'half sovereign' ||
    exact === 'krugerrand'
  ) {
    return bySection('gold coins');
  }
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

function bestReferenceEntry(catalog, materialGrade, productName) {
  if (!catalog.length) return null;
  const prod = String(productName ?? '').trim().toLowerCase();
  const mg = String(materialGrade ?? '').trim().toLowerCase();
  if (prod === 'coin' && mg === 'silver') {
    const oz = troyOzSilverReferenceFromCatalog(catalog);
    if (oz) return oz;
  }
  const ranked = suggestReferenceEntries(catalog, materialGrade);
  return ranked[0] ?? catalog[0] ?? null;
}

/** Scrap reference for a picked variant. "Other" gets a null-priced placeholder so the line
 *  still renders cleanly and the buyer enters Manual £. */
function referenceEntryForVariant(catalog, variant) {
  if (variant.material_grade === OTHER_MATERIAL_GRADE) return OTHER_REFERENCE_ENTRY;
  return bestReferenceEntry(catalog, variant.material_grade, variant.product_name);
}

/** Assemble one workspace-table row from a chosen variant + resolved scrap reference. */
function buildJewelleryWorkspaceLine({ variant, reference, categoryLabel, jewelleryDbCategoryId }) {
  const coin = isJewelleryCoinLine({ productName: variant.product_name, materialGrade: variant.material_grade });
  const isUnitLine = reference.sourceKind === 'UNIT';
  /** Weight is the per-unit multiplier for UNIT lines and the gram count for weight lines.
   *  Coins use the coinUnits field instead and leave weight locked at '1'. */
  const defaultWeight = coin || isUnitLine ? '1' : '';
  return {
    id: crypto.randomUUID?.() ?? `jewellery-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    request_item_id: null,
    jewelleryDbCategoryId,
    variantId: variant.variant_id,
    variantTitle: variant.title,
    categoryLabel,
    itemName: categoryLabel,
    productName: variant.product_name,
    materialGrade: variant.material_grade,
    referenceEntry: reference,
    sourceKind: reference.sourceKind,
    ratePerGram: reference.ratePerGram,
    unitPrice: reference.unitPrice,
    weightUnit: isUnitLine ? 'each' : defaultWeightUnit(reference.sourceKind),
    weight: defaultWeight,
    ...(coin ? { coinUnits: '' } : {}),
    selectedOfferTierPct: null,
    manualOfferInput: '',
    manualOfferAuthBy: null,
    selectedOfferTierAuthBy: null,
    authorisedOfferSlots: [],
    customerExpectation: '',
  };
}

function JewelleryTierOfferCell({ referenceTotalGbp, marginPct, isSelected, onSelect, blocked = false, approvedBy = null }) {
  const metricDisplay = useOfferMetricDisplay();
  const metricLabel = metricDisplay === 'pctOfSale' ? '% sale' : '% margin';
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
  const pctOfSaleFromRoundedOffer = calculatePctOfSale(offerAmt, referenceTotalGbp);
  const metricValue = metricDisplay === 'pctOfSale' ? pctOfSaleFromRoundedOffer : marginFromRoundedOfferPct;
  return (
    <td
      role="button"
      tabIndex={0}
      className="align-top text-[13px] leading-snug relative cursor-pointer"
      style={
        blocked
          ? { background: 'rgba(239,68,68,0.06)', color: '#9ca3af', fontWeight: 600 }
          : isSelected
            ? {
                background: 'rgba(34, 197, 94, 0.15)',
                fontWeight: 700,
                color: '#166534',
              }
            : { fontWeight: 600, color: '#111827' }
      }
      aria-label={`${metricDisplay === 'pctOfSale' ? `${metricValue}% sale` : `${marginFromRoundedOfferPct.toFixed(1)}% margin`} on rounded offer${isSelected ? ', selected' : ''}`}
      aria-pressed={isSelected}
      title={blocked ? 'Blocked — requires senior management authorisation' : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={blocked ? 'opacity-60' : ''}>
        <div>£{formatOfferPrice(offerAmt)}</div>
        <div
          className={`text-[9px] font-medium ${blocked ? 'text-gray-400' : isSelected ? 'text-green-800' : 'text-brand-blue'}`}
        >
          {metricDisplay === 'pctOfSale'
            ? `${metricValue}${metricLabel}`
            : `${metricValue >= 0 ? '+' : ''}${Number(metricValue).toFixed(1)}${metricLabel}`}
        </div>
        {isSelected && approvedBy && (
          <div className={`text-[9px] mt-1 font-semibold ${blocked ? 'text-gray-400' : 'text-red-700'}`}>
            Approved by: {approvedBy}
          </div>
        )}
      </div>
      {blocked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined text-red-400 text-[18px] opacity-70">lock</span>
        </div>
      )}
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
  onCloseWorkspace = null,
}) {
  const scrapSectionsCatalog = useMemo(() => buildCatalog(sections), [sections]);
  const [dbCatalog, setDbCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [internalLines, setInternalLines] = useState([]);
  const controlled = linesProp != null && typeof onLinesChange === 'function';
  const lines = controlled ? linesProp : internalLines;
  const setLines = controlled ? onLinesChange : setInternalLines;
  /**
   * Single source of truth for the picker. `null` when closed; otherwise `{ step, parent, leaf }`:
   *   step 'product'     — browsing the top-level NosPos tree (parent=null, leaf=null)
   *   step 'subcategory' — drilled into a branch (parent=branchProduct, leaf=null)
   *   step 'variant'     — picking a material grade (leaf set; parent set iff drilled via subcategory)
   */
  const [picker, setPicker] = useState(null);
  const modalOpen = picker !== null;
  const [jewelleryContextMenu, setJewelleryContextMenu] = useState(null);
  const [syncMarginsOpen, setSyncMarginsOpen] = useState(false);
  const [syncMarginInput, setSyncMarginInput] = useState('');
  const customerData = useAppStore((s) => s.customerData);
  const customerOfferRulesData = useAppStore((s) => s.customerOfferRulesData);
  const jewelleryPickerOpenNonce = useAppStore((s) => s.jewelleryPickerOpenNonce);
  const jewelleryTierMargins = useMemo(
    () => resolveJewelleryTierMarginsPct(customerOfferRulesData?.settings),
    [customerOfferRulesData]
  );
  const jewelleryBlockedSlots = useMemo(
    () => getBlockedOfferSlots(customerData, customerOfferRulesData?.rules, customerOfferRulesData?.settings),
    [customerData, customerOfferRulesData]
  );
  const [jewelleryOfferAuthModal, setJewelleryOfferAuthModal] = useState(null);
  const [jewelleryOfferAuthName, setJewelleryOfferAuthName] = useState('');
  const draftJewelleryLines = useMemo(
    () => lines.filter((l) => l.request_item_id == null || String(l.request_item_id).trim() === ''),
    [lines]
  );
  const draftNeedsJewelleryDetail = useMemo(
    () => draftJewelleryLines.some(lineNeedsJewelleryWorkspaceDetail),
    [draftJewelleryLines]
  );
  const [jewelleryDraftDetailsModalOpen, setJewelleryDraftDetailsModalOpen] = useState(false);

  useEffect(() => {
    if (draftNeedsJewelleryDetail) setJewelleryDraftDetailsModalOpen(true);
  }, [draftNeedsJewelleryDetail]);

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

  /** Material-step list for the current leaf. The grade list is defined by NosPos rules
   *  (see materialGradesForLeaf); real DB variants are reused where a grade matches, otherwise
   *  we synthesise so every leaf offers the same set of choices including "Other". */
  const variantsForProduct = useMemo(() => {
    const leaf = picker?.leaf;
    if (!dbCatalog || !leaf) return [];
    return materialGradesForLeaf(leaf).map((grade) => {
      const dbVariant = leaf.dbProductId != null
        ? dbCatalog.variants.find((v) => v.product_id === leaf.dbProductId && v.material_grade === grade)
        : null;
      return dbVariant ?? {
        variant_id: null,
        product_id: leaf.dbProductId,
        product_name: leaf.dbName ?? leaf.name,
        material_grade: grade,
        title: `${leaf.name} — ${grade}`,
        cex_sku: null,
      };
    });
  }, [dbCatalog, picker]);

  const openPickerModal = useCallback(() => {
    setPicker({ step: 'product', parent: null, leaf: null });
  }, []);
  const closePicker = useCallback(() => setPicker(null), []);

  useEffect(() => {
    const nonce = jewelleryPickerOpenNonce;
    if (nonce === lastJewelleryPickerOpenNonceHandled) return;
    if (modalOpen) {
      lastJewelleryPickerOpenNonceHandled = nonce;
      return;
    }
    const canOpen = scrapSectionsCatalog.length > 0 && Boolean(dbCatalog?.products?.length);
    if (!canOpen) return;
    openPickerModal();
    lastJewelleryPickerOpenNonceHandled = nonce;
  }, [jewelleryPickerOpenNonce, modalOpen, scrapSectionsCatalog, dbCatalog, openPickerModal]);

  /** Advances the picker by one step. Top-level branches go to subcategory; everything else
   *  short-circuits to the material-grade list, using the picked item as the leaf. */
  const handlePickerSelect = (item) => {
    setPicker((prev) => {
      if (!prev) return prev;
      if (prev.step === 'product') {
        return item.children?.length
          ? { step: 'subcategory', parent: item, leaf: null }
          : { step: 'variant', parent: null, leaf: item };
      }
      if (prev.step === 'subcategory') {
        return { step: 'variant', parent: prev.parent, leaf: item };
      }
      return prev;
    });
  };

  const handlePickerBack = () => {
    setPicker((prev) => {
      if (!prev) return prev;
      if (prev.step === 'subcategory') return { step: 'product', parent: null, leaf: null };
      if (prev.step === 'variant') {
        return prev.parent
          ? { step: 'subcategory', parent: prev.parent, leaf: null }
          : { step: 'product', parent: null, leaf: null };
      }
      return prev;
    });
  };

  const addLineForVariant = (variant) => {
    const reference = referenceEntryForVariant(scrapSectionsCatalog, variant);
    if (!reference) return;
    /** When a subcategory was drilled into, label the line "Parent > Child"; top-level picks keep v.title. */
    const categoryLabel = picker?.parent && picker?.leaf
      ? `${picker.parent.name} > ${picker.leaf.name}`
      : variant.title;
    const line = buildJewelleryWorkspaceLine({
      variant,
      reference,
      categoryLabel,
      jewelleryDbCategoryId: dbCatalog?.category_id ?? null,
    });
    setLines((prev) => [...prev, line]);
    closePicker();
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id, patch) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        if (isJewelleryCoinLine(l) && (patch.weight !== undefined || patch.weightUnit !== undefined)) {
          const { weight: _w, weightUnit: _u, ...rest } = patch;
          return Object.keys(rest).length ? { ...l, ...rest } : l;
        }
        return { ...l, ...patch };
      })
    );
  };

  const handleManualOfferInputChange = useCallback(
    (line, nextRaw) => {
      const manualValue = parseFloat(String(nextRaw ?? '').replace(/[£,]/g, '').trim());
      const maxAllowed = computeWorkspaceLineTotal(line);
      if (
        String(nextRaw ?? '').trim() !== '' &&
        Number.isFinite(manualValue) &&
        manualValue > 0 &&
        Number.isFinite(maxAllowed) &&
        maxAllowed > 0 &&
        manualValue > maxAllowed
      ) {
        showNotification?.('This is not allowed, enter a new manual offer or cancel.', 'error');
        return;
      }
      updateLine(line.id, {
        manualOfferInput: nextRaw,
        selectedOfferTierPct: null,
        selectedOfferTierAuthBy: null,
        manualOfferAuthBy: null,
      });
    },
    [showNotification]
  );

  const handleSelectJewelleryTier = useCallback((lineId, marginPct, authBy = undefined, slot = null) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const nextPct = l.selectedOfferTierPct === marginPct ? null : marginPct;
        let authorisedOfferSlots = Array.isArray(l.authorisedOfferSlots) ? [...l.authorisedOfferSlots] : [];
        if (slot && !authorisedOfferSlots.includes(slot)) authorisedOfferSlots.push(slot);
        if (nextPct != null) {
          authorisedOfferSlots = authorisedOfferSlots.filter((s) => s !== 'manual');
        }
        return {
          ...l,
          selectedOfferTierPct: nextPct,
          selectedOfferTierAuthBy:
            nextPct == null ? null : authBy !== undefined ? authBy : null,
          ...(nextPct != null ? { manualOfferInput: '', manualOfferAuthBy: null } : {}),
          authorisedOfferSlots,
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
        const total = computeWorkspaceLineTotal(line);
        if (!(total > 0)) return line;
        const offer = tierOfferGbpFromReference(total, n);
        return {
          ...line,
          selectedOfferTierPct: null,
          selectedOfferTierAuthBy: null,
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
      const t = computeWorkspaceLineTotal(line);
      if (!(t > 0)) {
        showNotification?.('Each new jewellery row needs a positive reference total.', 'error');
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
      const ref = computeWorkspaceLineTotal(line);
      if (!(ref > 0)) continue;
      const pct = line.selectedOfferTierPct;
      const manualRaw = String(line.manualOfferInput ?? '').trim();
      const manualVal = parseFloat(manualRaw.replace(/[£,]/g, ''));
      let offerAmt = null;
      if (pct != null && jewelleryTierMargins.includes(pct)) {
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
  }, [jewelleryTierMargins, lines]);

  if (!scrapSectionsCatalog.length && lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-4 text-xs text-gray-600">
        After reference prices load, use <span className="font-semibold text-gray-800">Jewellery</span> in the header
        (diamond) to add a row. If you already have jewellery on the quote, use{' '}
        <span className="font-semibold text-gray-800">Update reference data</span> above to load the price table.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <style>{`${SPREADSHEET_TABLE_STYLES}\n${SPREADSHEET_TABLE_WORKSPACE_PERF_STYLES}`}</style>
      <div className="shrink-0 border-b border-gray-200 px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-brand-blue">Your items</h3>
          <div className="flex w-full flex-wrap items-stretch justify-end gap-4 sm:w-auto sm:items-center sm:gap-6">
            {modalOpen ? (
              <button
                type="button"
                onClick={closePicker}
                className="inline-flex min-h-[2.75rem] w-full flex-1 items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-gray-800 shadow-sm transition-all hover:bg-gray-50 sm:w-auto sm:min-w-[200px] sm:flex-initial"
              >
                <span className="material-symbols-outlined text-[24px] leading-none">close</span>
                Close picker
              </button>
            ) : (
              <>
                {onAddJewelleryToNegotiation ? (
                  <button
                    type="button"
                    disabled={lines.length === 0}
                    onClick={handleCompleteJewelleryToNegotiation}
                    className="inline-flex min-h-[2.75rem] w-full flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-brand-blue shadow-md transition-all hover:brightness-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[200px] sm:flex-initial"
                    style={{
                      background: 'var(--brand-orange)',
                      boxShadow: '0 8px 20px -6px rgba(247, 185, 24, 0.45)',
                    }}
                    title="Add drafted rows to the negotiation"
                  >
                    <span className="material-symbols-outlined text-[24px] leading-none">task_alt</span>
                    Complete
                  </button>
                ) : null}
                {onCloseWorkspace ? (
                  <div className="flex shrink-0 items-center justify-center border-t border-gray-200 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                    <WorkspaceCloseButton title="Close workspace" onClick={onCloseWorkspace} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        {catalogError ? <p className="mt-2 text-xs text-red-600">{catalogError}</p> : null}
        {onAddJewelleryToNegotiation && !modalOpen ? (
          <p className="mt-2 text-[11px] leading-relaxed text-gray-600 sm:text-right">
            Only <span className="font-semibold text-gray-800">new</span> rows (not yet on the quote) are added when you
            complete. Existing lines stay listed so you can add more. Use{' '}
            <span className="font-semibold text-gray-800">Jewellery</span> in the header to open the picker again.
          </p>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 pb-3 pt-2">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <p className="text-xs font-black uppercase tracking-wider text-brand-blue">Add jewellery item</p>
            {picker.step === 'product' ? (
              <span className="text-[11px] font-medium text-gray-500">Step 1 — choose item type</span>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-bold text-brand-blue hover:underline"
                onClick={handlePickerBack}
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                {picker.step === 'variant' && picker.parent ? `Back to ${picker.parent.name}` : 'Back to types'}
              </button>
            )}
          </div>
          {picker.step === 'product' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <JewelleryPickerList
                items={dbCatalog?.products || []}
                isLoading={catalogLoading}
                onSelect={handlePickerSelect}
                getLabel={(p) => p.name}
                getKey={(p) => p.product_id}
                isBranch={(p) => Boolean(p.children?.length)}
                searchPlaceholder="Search types…"
                statsHeading="Types in catalogue"
                entitySingular="type"
                entityPlural="types"
              />
            </div>
          ) : null}
          {picker.step === 'subcategory' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="shrink-0 border-b border-gray-100 bg-gray-50/80 px-4 py-2">
                <p className="text-[11px] font-semibold text-gray-600">
                  Step 2 — <span className="text-gray-900">{picker.parent.name}</span> subcategory
                </p>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <JewelleryPickerList
                  items={picker.parent.children || []}
                  onSelect={handlePickerSelect}
                  getLabel={(c) => c.name}
                  getKey={(c) => c.product_id}
                  isBranch={() => false}
                  searchPlaceholder={`Search ${picker.parent.name.toLowerCase()}…`}
                  statsHeading={`${picker.parent.name} subcategories`}
                  entitySingular="subcategory"
                  entityPlural="subcategories"
                />
              </div>
            </div>
          ) : null}
          {picker.step === 'variant' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="shrink-0 border-b border-gray-100 bg-gray-50/80 px-4 py-2">
                <p className="text-[11px] font-semibold text-gray-600">
                  {picker.parent ? (
                    <>
                      Step 3 — <span className="text-gray-900">Material / grade</span>
                      <span className="ml-2 text-gray-500">({picker.parent.name} › {picker.leaf.name})</span>
                    </>
                  ) : (
                    <>Step 2 — <span className="text-gray-900">Material / grade</span></>
                  )}
                </p>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
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
            </div>
          ) : null}
        </div>
      ) : null}

      {!modalOpen && lines.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">
          Use <span className="font-semibold text-gray-700">Jewellery</span> in the header (diamond) to choose type and
          material. Right-click a row to remove. Optionally click a tier for a pre-selected offer; use{' '}
          <span className="font-semibold text-gray-700">Complete</span> above to add new rows to the negotiation (tiers stay
          available there if you skip them here).
        </p>
      ) : null}

      {!modalOpen && lines.length > 0 ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <table className="w-full table-fixed spreadsheet-table spreadsheet-table--static-header spreadsheet-table--workspace border-collapse text-left">
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
                  Scrap
                </th>
                <th scope="col" className="w-32">
                  Customer expectation
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
                <th scope="col" className="w-24 spreadsheet-th-offer-tier">
                  4th
                </th>
                <th scope="col" className="min-w-[5.5rem] w-[6.5rem]">
                  Manual £
                </th>
                <th scope="col" className="w-28">
                  RRP Total
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {lines.map((line) => {
                const total = computeWorkspaceLineTotal(line);
                const isCoinLine = isJewelleryCoinLine(line);
                const isSilverOzCoin = isJewelleryCoinSilverOzLine(line);
                const isUnit = line.sourceKind === 'UNIT';
                const manualSelected = String(line.manualOfferInput ?? '').trim() !== '';
                const manualBlocked = isBlockedForItem('manual', jewelleryBlockedSlots, line);
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-8 w-full rounded border border-gray-300 px-2 font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                        aria-label="Item name"
                      />
                    </td>
                    <td>
                      {isCoinLine ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={line.coinUnits ?? '0'}
                          onChange={(e) =>
                            updateLine(line.id, {
                              coinUnits: sanitizeJewelleryCoinUnitsInput(e.target.value),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          className="h-8 w-full min-w-[3.5rem] rounded border border-gray-300 px-2 font-semibold tabular-nums text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                          title={
                            isSilverOzCoin
                              ? 'Number of troy ounces at the reference silver £/oz price'
                              : 'Number of coins at the reference table price per unit'
                          }
                          aria-label="Coin or bullion unit count"
                        />
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={line.weight}
                          onChange={(e) => {
                            const cleaned = sanitizeJewelleryWeightInput(e.target.value, false);
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
                      )}
                    </td>
                    <td>
                      {isCoinLine ? (
                        <span className="text-gray-500">{isSilverOzCoin ? 't oz' : 'coin'}</span>
                      ) : isUnit ? (
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
                    <ScrapReferenceCell line={line} />
                    <td className="p-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.customerExpectation ?? ''}
                        onChange={(e) => updateLine(line.id, { customerExpectation: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="£0.00"
                        className="h-8 w-full min-w-[4.5rem] border-0 bg-slate-50 px-2 text-xs font-semibold tabular-nums text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-blue/35"
                        aria-label="Customer expectation GBP"
                      />
                    </td>
                    {jewelleryTierMargins.map((pct, tierIdx) => {
                      const slot = `offer${tierIdx + 1}`;
                      const tierBlocked = isBlockedForItem(slot, jewelleryBlockedSlots, line);
                      return (
                        <JewelleryTierOfferCell
                          key={pct}
                          referenceTotalGbp={total}
                          marginPct={pct}
                          isSelected={line.selectedOfferTierPct === pct}
                          approvedBy={line.selectedOfferTierAuthBy}
                          blocked={tierBlocked}
                          onSelect={() => {
                            if (tierBlocked) {
                              setJewelleryOfferAuthModal({ kind: 'tier', lineId: line.id, marginPct: pct, slot });
                              setJewelleryOfferAuthName('');
                            } else {
                              handleSelectJewelleryTier(line.id, pct);
                            }
                          }}
                        />
                      );
                    })}
                    <td
                      style={
                        manualSelected
                          ? {
                              background: 'rgba(34, 197, 94, 0.15)',
                              fontWeight: 700,
                              color: '#166534',
                            }
                          : manualBlocked
                            ? { background: 'rgba(239,68,68,0.06)' }
                            : undefined
                      }
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        readOnly={manualBlocked}
                        value={line.manualOfferInput ?? ''}
                        onClick={() => {
                          if (manualBlocked) {
                            setJewelleryOfferAuthModal({ kind: 'manual', lineId: line.id });
                            setJewelleryOfferAuthName('');
                          }
                        }}
                        onChange={(e) => handleManualOfferInputChange(line, e.target.value)}
                        placeholder={manualBlocked ? 'Auth required' : '—'}
                        className={`h-8 w-full min-w-[4.5rem] rounded border border-gray-300 px-2 font-semibold tabular-nums text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30 bg-transparent ${manualBlocked ? 'cursor-pointer' : ''}`}
                        aria-label="Manual offer GBP"
                      />
                    </td>
                    <td className="font-semibold tabular-nums text-gray-900">
                      {line.materialGrade === OTHER_MATERIAL_GRADE ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.rrpTotalInput ?? (line.overrideReferenceTotal != null ? String(line.overrideReferenceTotal) : '')}
                          onChange={(e) => {
                            /** Raw string preserves in-progress decimals ("5."); overrideReferenceTotal is
                             *  the parsed number consumed by computeWorkspaceLineTotal + tier offers + persistence. */
                            const raw = String(e.target.value ?? '').replace(/[^0-9.]/g, '');
                            const n = parseFloat(raw);
                            updateLine(line.id, {
                              rrpTotalInput: raw,
                              overrideReferenceTotal: Number.isFinite(n) && n >= 0 ? n : null,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder="£"
                          className="h-8 w-full rounded border border-gray-300 px-2 font-semibold tabular-nums text-gray-900 placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                          aria-label="RRP total GBP"
                        />
                      ) : (
                        <>£{formatOfferPrice(total)}</>
                      )}
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
        </div>
      ) : null}

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

      <JewelleryLineDetailsBlockingModal
        open={jewelleryDraftDetailsModalOpen}
        onClose={() => setJewelleryDraftDetailsModalOpen(false)}
        lines={draftJewelleryLines}
        onCommitLines={(commits) => {
          for (const c of commits) {
            updateLine(c.id, {
              itemName: c.itemName,
              ...(c.weight !== undefined ? { weight: c.weight } : {}),
              ...(c.coinUnits !== undefined ? { coinUnits: c.coinUnits } : {}),
            });
          }
        }}
        showNotification={showNotification}
        zClass="z-[310]"
      />

      {jewelleryOfferAuthModal ? (
        <TinyModal
          title="Senior Management Authorisation"
          zClass="z-[290]"
          closeOnBackdrop={false}
          showCloseButton={false}
          onClose={() => {
            setJewelleryOfferAuthModal(null);
            setJewelleryOfferAuthName('');
          }}
        >
          <p className="text-xs text-slate-600 mb-3">
            {jewelleryOfferAuthModal.kind === 'manual'
              ? 'Manual offer entry is restricted for this customer. Enter the approver&apos;s name to continue.'
              : 'This offer tier is restricted for this customer. Enter the approver&apos;s name to select it.'}
          </p>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5 text-brand-blue">
            Authorised by*
          </label>
          <input
            autoFocus
            type="text"
            className="w-full px-3 py-2.5 border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 mb-4"
            style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
            placeholder="Senior manager's name"
            value={jewelleryOfferAuthName}
            onChange={(e) => setJewelleryOfferAuthName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && jewelleryOfferAuthName.trim()) {
                const name = jewelleryOfferAuthName.trim();
                const { kind, lineId, marginPct, slot } = jewelleryOfferAuthModal;
                if (kind === 'tier') {
                  handleSelectJewelleryTier(lineId, marginPct, name, slot);
                } else {
                  setLines((prev) =>
                    prev.map((l) => {
                      if (l.id !== lineId) return l;
                      const authorisedOfferSlots = Array.isArray(l.authorisedOfferSlots) ? [...l.authorisedOfferSlots] : [];
                      if (!authorisedOfferSlots.includes('manual')) authorisedOfferSlots.push('manual');
                      return { ...l, manualOfferAuthBy: name, authorisedOfferSlots };
                    })
                  );
                }
                setJewelleryOfferAuthModal(null);
                setJewelleryOfferAuthName('');
              }
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 py-2.5 rounded-lg border text-sm font-semibold hover:bg-slate-50"
              style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
              onClick={() => {
                setJewelleryOfferAuthModal(null);
                setJewelleryOfferAuthName('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!jewelleryOfferAuthName.trim()}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-40"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
              onClick={() => {
                const name = jewelleryOfferAuthName.trim();
                if (!name) return;
                const { kind, lineId, marginPct, slot } = jewelleryOfferAuthModal;
                if (kind === 'tier') {
                  handleSelectJewelleryTier(lineId, marginPct, name, slot);
                } else {
                  setLines((prev) =>
                    prev.map((l) => {
                      if (l.id !== lineId) return l;
                      const authorisedOfferSlots = Array.isArray(l.authorisedOfferSlots) ? [...l.authorisedOfferSlots] : [];
                      if (!authorisedOfferSlots.includes('manual')) authorisedOfferSlots.push('manual');
                      return { ...l, manualOfferAuthBy: name, authorisedOfferSlots };
                    })
                  );
                }
                setJewelleryOfferAuthModal(null);
                setJewelleryOfferAuthName('');
              }}
            >
              Proceed
            </button>
          </div>
        </TinyModal>
      ) : null}
    </div>
  );
}
