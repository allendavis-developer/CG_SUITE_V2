import React, { useEffect, useId, useState } from 'react';
import { formatOfferPrice } from '@/utils/helpers';
import { SPREADSHEET_TABLE_STYLES } from '@/pages/buyer/spreadsheetTableStyles';
import JewelleryLineItems from '@/components/jewellery/JewelleryLineItems';

const TROY_OZ_GRAMS = 31.1034768;

function normalizeSourceUnit(unitRaw) {
  const s = String(unitRaw || '').toLowerCase();
  if (s.includes('kg')) return 'PER_KG';
  if (s.includes('gm') || /\bper g\b/.test(s)) return 'PER_G';
  return 'UNIT';
}

function pricePerGram(sourceKind, priceNumeric) {
  if (!Number.isFinite(priceNumeric)) return null;
  if (sourceKind === 'PER_G') return priceNumeric;
  if (sourceKind === 'PER_KG') return priceNumeric / 1000;
  return null;
}

function displayAmount(weightPerChoice, sourceKind, priceNumeric) {
  if (sourceKind === 'UNIT') return { amount: priceNumeric };
  const perGram = pricePerGram(sourceKind, priceNumeric);
  if (perGram == null) return { amount: priceNumeric };
  switch (weightPerChoice) {
    case 'kg':
      return { amount: perGram * 1000 };
    case 'troy':
      return { amount: perGram * TROY_OZ_GRAMS };
    default:
      return { amount: perGram };
  }
}

function defaultPerChoice(sourceKind) {
  if (sourceKind === 'PER_KG') return 'kg';
  if (sourceKind === 'PER_G') return 'g';
  return 'unit';
}

export default function JewelleryReferencePricesTable({
  sections,
  useVoucherOffers = false,
  onAddJewelleryToNegotiation = null,
  showNotification = null,
  workspaceLines = null,
  onWorkspaceLinesChange = null,
  onRemoveJewelleryWorkspaceRow = null,
  onUpdateReferenceRequest = null,
  updateReferenceLoading = false,
}) {
  const panelBaseId = useId();
  const toggleId = `${panelBaseId}-toggle`;
  const panelId = `${panelBaseId}-panel`;

  const [perByRow, setPerByRow] = useState({});
  const [open, setOpen] = useState(false);
  const hasSections = (sections || []).length > 0;

  useEffect(() => {
    const next = {};
    (sections || []).forEach((sec) => {
      (sec?.rows || []).forEach((r, i) => {
        const key = `${sec.id || sec.title}-${r.label}-${i}`;
        next[key] = defaultPerChoice(normalizeSourceUnit(r.unit));
      });
    });
    setPerByRow(next);
  }, [sections]);

  // Collapse only when there is no data to show (e.g. cleared scrape). Do not close on refresh —
  // `sections` gets a new reference after Update and would wrongly collapse an open table.
  useEffect(() => {
    if (!hasSections) setOpen(false);
  }, [hasSections]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white shadow-sm">
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-2 py-2 sm:px-3">
        <button
          type="button"
          id={toggleId}
          aria-expanded={open}
          aria-controls={hasSections ? panelId : undefined}
          disabled={!hasSections}
          onClick={() => hasSections && setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue/40 disabled:cursor-default disabled:opacity-60"
        >
          <span className="material-symbols-outlined shrink-0 text-xl text-brand-blue" aria-hidden>
            {hasSections ? (open ? 'expand_less' : 'expand_more') : 'table_chart'}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-brand-blue">Reference prices</span>
        </button>
        {onUpdateReferenceRequest ? (
          <button
            type="button"
            disabled={updateReferenceLoading}
            onClick={() => onUpdateReferenceRequest()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide text-brand-blue shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateReferenceLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-lg leading-none">progress_activity</span>
                Updating…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg leading-none">sync</span>
                Update reference data
              </>
            )}
          </button>
        ) : null}
      </div>
      {!hasSections ? (
        <p className="px-3 py-3 text-xs leading-relaxed text-gray-600">
          {updateReferenceLoading ? (
            <>Loading reference prices from Mastermelt…</>
          ) : (
            <>
              No reference data yet — opening the jewellery workspace fetches prices automatically when this quote does
              not have saved reference data. Use <span className="font-semibold text-gray-800">Update reference data</span>{' '}
              anytime to refresh. Saved quotes reuse stored prices until you update.
            </>
          )}
        </p>
      ) : null}
      {hasSections && open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={toggleId}
          className="border-t border-gray-200"
        >
          <table className="w-full spreadsheet-table spreadsheet-table--static-header border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="min-w-[140px]">
                  Item
                </th>
                <th scope="col" className="w-32">
                  Price
                </th>
                <th scope="col" className="min-w-[9rem]">
                  Per
                </th>
              </tr>
            </thead>
            {(sections || []).map((sec, secIdx) => {
              const rows = sec?.rows || [];
              if (!rows.length) return null;

              return (
                <tbody key={sec.id || sec.title || secIdx} className="text-xs">
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        background: 'var(--brand-blue-alpha-10)',
                        borderBottom: '1px solid var(--ui-border)',
                        borderTop: secIdx > 0 ? '2px solid var(--ui-border)' : undefined,
                        fontWeight: 700,
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--brand-blue)',
                      }}
                    >
                      {sec.title}
                    </td>
                  </tr>
                  {rows.map((r, i) => {
                    const rowKey = `${sec.id || sec.title}-${r.label}-${i}`;
                    const sourceKind = normalizeSourceUnit(r.unit);
                    const priceNumeric = parseFloat(String(r.priceGbp || '').replace(/,/g, ''));
                    const choice =
                      sourceKind === 'UNIT'
                        ? 'unit'
                        : (perByRow[rowKey] || defaultPerChoice(sourceKind));
                    const { amount } = displayAmount(choice, sourceKind, priceNumeric);
                    const priceStr = formatOfferPrice(amount);

                    return (
                      <tr key={rowKey}>
                        <td className="text-gray-900">{r.label}</td>
                        <td className="font-semibold tabular-nums text-gray-900">
                          £{priceStr}
                        </td>
                        <td className="text-gray-800">
                          {sourceKind === 'UNIT' ? (
                            <span className="text-gray-500">Unit price</span>
                          ) : (
                            <select
                              value={choice}
                              onChange={(e) =>
                                setPerByRow((prev) => ({
                                  ...prev,
                                  [rowKey]: e.target.value,
                                }))
                              }
                              className="h-8 w-full max-w-[11rem] rounded border border-gray-300 bg-white px-2 text-left text-xs font-semibold text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
                            >
                              <option value="g">per g</option>
                              <option value="kg">per kg</option>
                              <option value="troy">per troy oz</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : null}
    </div>
    <JewelleryLineItems
      sections={sections || []}
      useVoucherOffers={useVoucherOffers}
      onAddJewelleryToNegotiation={onAddJewelleryToNegotiation}
      showNotification={showNotification}
      lines={workspaceLines}
      onLinesChange={onWorkspaceLinesChange}
      onRemoveJewelleryWorkspaceRow={onRemoveJewelleryWorkspaceRow}
    />
    </div>
  );
}
