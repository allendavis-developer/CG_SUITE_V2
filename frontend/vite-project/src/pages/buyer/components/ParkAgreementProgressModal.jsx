import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';

/** Core agreement fields filled by CG Suite — not editable from this modal. */
const PARK_LOCKED_PATCH_KINDS = new Set([
  'category',
  'name',
  'quantity',
  'retail_price',
  'bought_for',
]);

function isParkLockedNosposRow(row) {
  if (!row || row.displayOnly || row.patchKind === 'none') return false;
  const pk = String(row.patchKind || '');
  if (PARK_LOCKED_PATCH_KINDS.has(pk)) return true;
  const label = String(row.field || '').trim();
  if (!label) return false;
  if (/\brate\b/i.test(label)) return true;
  return false;
}

function StepIcon({ status }) {
  if (status === 'done') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <span className="material-symbols-outlined text-[20px] leading-none">check</span>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
        <span className="material-symbols-outlined text-[20px] leading-none">close</span>
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <span className="material-symbols-outlined text-[18px] leading-none">remove</span>
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-blue)] border-t-transparent" />
      </span>
    );
  }
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white" />;
}

function ParkItemFieldTable({ tbl, onPatch }) {
  const [optionalOpen, setOptionalOpen] = useState(false);
  const primaryRows = tbl.rows.filter((r) => r.required === true || r.displayOnly === true);
  const optionalRows = tbl.rows.filter((r) => r.required !== true && !r.displayOnly);

  const renderRow = (row) => (
    <tr key={row.id} className="align-top">
      <td className="align-top font-semibold text-[var(--text-main)]">
        {row.field}
        {row.required ? <span className="text-red-600"> *</span> : null}
      </td>
      <td className="align-top">
        <EditableNosposCell
          row={row}
          lineIndex={tbl.itemIndex}
          patchEnabled={tbl.patchEnabled === true}
          onPatch={onPatch}
        />
      </td>
      <td className="align-top leading-relaxed text-[var(--text-muted)]">{row.note || '—'}</td>
    </tr>
  );

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--ui-border)] bg-white">
      <table className="w-full min-w-[420px] spreadsheet-table spreadsheet-table--static-header border-collapse text-left">
        <thead>
          <tr>
            <th className="min-w-[120px]">Field</th>
            <th className="min-w-[200px]">Set on NoSpos</th>
            <th className="min-w-[140px]">Note</th>
          </tr>
        </thead>
        <tbody className="text-xs text-[var(--text-main)]">
          {primaryRows.map(renderRow)}
          {optionalRows.length > 0 ? (
            <>
              <tr className="bg-[var(--ui-bg)]">
                <td colSpan={3} className="p-0">
                  <button
                    type="button"
                    onClick={() => setOptionalOpen((o) => !o)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--brand-blue)] transition hover:bg-[var(--ui-card)]"
                    aria-expanded={optionalOpen}
                  >
                    <span
                      className={`material-symbols-outlined text-[18px] leading-none transition-transform ${optionalOpen ? 'rotate-90' : ''}`}
                    >
                      chevron_right
                    </span>
                    Optional fields
                    <span className="font-semibold normal-case tracking-normal text-[var(--text-muted)]">
                      ({optionalRows.length})
                    </span>
                  </button>
                </td>
              </tr>
              {optionalOpen ? optionalRows.map(renderRow) : null}
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function EditableNosposCell({ row, lineIndex, patchEnabled, onPatch }) {
  const [local, setLocal] = useState(row.nosposValue ?? '');
  const debounceRef = useRef(null);
  /** When true, next blur was caused by Enter — patch already sent, skip duplicate in onBlur. */
  const skipNextBlurPatchRef = useRef(false);

  useEffect(() => {
    setLocal(row.nosposValue ?? '');
  }, [row.nosposValue, row.id]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const patch = useCallback(
    (value) => {
      if (!patchEnabled || row.displayOnly || row.patchKind === 'none' || isParkLockedNosposRow(row))
        return;
      onPatch({
        lineIndex,
        rowId: row.id,
        patchKind: row.patchKind,
        fieldLabel: row.fieldLabel != null && String(row.fieldLabel).trim() !== '' ? row.fieldLabel : row.field,
        value: String(value),
      });
    },
    [patchEnabled, row, lineIndex, onPatch]
  );

  if (row.displayOnly || !patchEnabled || row.patchKind === 'none' || isParkLockedNosposRow(row)) {
    const d = row.nosposDisplay || row.nosposValue || '—';
    return <span className="text-[var(--text-main)]">{d}</span>;
  }

  const opts = Array.isArray(row.options) && row.options.length > 0 ? row.options : [];

  if (row.inputKind === 'select' && opts.length) {
    return (
      <select
        value={local}
        className="w-full max-w-[min(100%,320px)] rounded-lg border border-[var(--ui-border)] bg-white px-2 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]"
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          patch(v);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
      >
        {opts.map((o) => (
          <option key={`${row.id}-${o.value}-${o.label}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (row.inputKind === 'number') {
    return (
      <input
        type="number"
        step={row.step != null && row.step !== '' ? row.step : 'any'}
        min={row.min != null && row.min !== '' ? row.min : undefined}
        value={local}
        className="w-full max-w-[200px] rounded-lg border border-[var(--ui-border)] bg-white px-2 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (skipNextBlurPatchRef.current) {
            skipNextBlurPatchRef.current = false;
            return;
          }
          patch(local);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          skipNextBlurPatchRef.current = true;
          patch(local);
          e.currentTarget.blur();
        }}
      />
    );
  }

  return (
    <input
      type="text"
      value={local}
      className="w-full max-w-[min(100%,320px)] rounded-lg border border-[var(--ui-border)] bg-white px-2 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]"
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => patch(v), 450);
      }}
      onBlur={() => {
        if (skipNextBlurPatchRef.current) {
          skipNextBlurPatchRef.current = false;
          return;
        }
        patch(local);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        skipNextBlurPatchRef.current = true;
        patch(local);
        e.currentTarget.blur();
      }}
    />
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} [props.onClose]
 * @param {Array<{ key: string, label: string, status: string, detail?: string|null, itemIndex?: number, excluded?: boolean }>} props.systemSteps
 * @param {Array<{ itemIndex: number, title: string, patchEnabled: boolean, footNote?: string|null, excluded?: boolean, rows: object[] }>|null} props.itemTables
 * @param {string|null} [props.footerError]
 * @param {boolean} [props.allowClose]
 * @param {(p: { lineIndex: number, rowId: string, patchKind: string, fieldLabel: string, value: string }) => void} [props.onPatchField]
 * @param {(itemIndex: number) => void} [props.onRetryParkLine]
 * @param {boolean} [props.parkRetryBusy]
 * @param {boolean} [props.parkLineRetryEnabled] — false while the automatic run is in progress (avoid overlapping extension calls)
 * @param {string|null} [props.parkedAgreementId]
 * @param {() => void|Promise<void>} [props.onViewParkedAgreement] — when the run finished cleanly; opens saved agreement URL in a new tab (no extension)
 */
export default function ParkAgreementProgressModal({
  open,
  onClose,
  systemSteps,
  itemTables,
  footerError,
  allowClose = false,
  onPatchField,
  onRetryParkLine,
  parkRetryBusy = false,
  parkLineRetryEnabled = false,
  parkedAgreementId = null,
  onViewParkedAgreement,
}) {
  const noopPatch = useCallback(() => {}, []);
  const patch = onPatchField || noopPatch;
  const canRetryLine = typeof onRetryParkLine === 'function';
  const [viewNoSposBusy, setViewNoSposBusy] = useState(false);

  const showViewParkedCta = useMemo(() => {
    if (!allowClose || footerError || typeof onViewParkedAgreement !== 'function') return false;
    if (!Array.isArray(systemSteps) || systemSteps.length === 0) return false;
    return systemSteps.every((s) => s.status === 'done' || s.status === 'skipped');
  }, [allowClose, footerError, onViewParkedAgreement, systemSteps]);

  const handleViewParked = useCallback(async () => {
    if (!onViewParkedAgreement) return;
    setViewNoSposBusy(true);
    try {
      await onViewParkedAgreement();
    } finally {
      setViewNoSposBusy(false);
    }
  }, [onViewParkedAgreement]);

  if (!open) return null;

  const showWait = itemTables == null && !footerError && allowClose === false;

  return (
    <div
      className="fixed inset-0 z-[130] flex min-h-0 flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="park-agreement-progress-title"
    >
      <style>{SPREADSHEET_TABLE_STYLES}</style>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ui-border)] bg-[var(--ui-card)] px-6 py-4 sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h2 id="park-agreement-progress-title" className="text-xl font-bold tracking-tight text-[var(--brand-blue)]">
            Park agreement
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
            NoSpos opens in a new tab (inactive). Each step shows what the extension is doing (reload waits are capped at 20
            seconds). Tap a line in Progress or use &ldquo;Retry / re-sync&rdquo; under a table to find the row by description
            marker (request + item id), or add it and fill fields again. Category, name, quantity, retail, offer, and rate are
            read-only here; other fields patch the NoSpos tab when you edit them. Optional fields are grouped below—expand to
            review or edit.
          </p>
        </div>
        {allowClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-[var(--ui-border)] p-2.5 text-[var(--text-main)] transition hover:bg-[var(--ui-bg)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <section>
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-blue">Progress</h3>
          <ul className="mt-4 space-y-4">
            {systemSteps.map((row) => {
              const isParkItem = row.itemIndex != null && Number.isFinite(Number(row.itemIndex));
              const isExcluded = isParkItem && row.excluded === true;
              const canRetryHere = isParkItem && canRetryLine && parkLineRetryEnabled && !parkRetryBusy;
              return (
                <li key={row.key} className="flex gap-4">
                  <StepIcon status={row.status} />
                  <div className="min-w-0 flex-1 pt-1">
                    {canRetryHere && !isExcluded ? (
                      <button
                        type="button"
                        onClick={() => onRetryParkLine(Number(row.itemIndex))}
                        className="w-full rounded-lg border border-transparent text-left transition hover:border-[var(--ui-border)] hover:bg-[var(--ui-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]"
                      >
                        <p className="text-[15px] font-semibold text-[var(--text-main)] leading-snug">{row.label}</p>
                        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-blue)]">
                          Retry / re-sync this line
                        </p>
                        {row.detail ? (
                          <p className="mt-1 break-all text-xs leading-relaxed text-[var(--text-muted)]">{row.detail}</p>
                        ) : null}
                      </button>
                    ) : (
                      <>
                        <p className={`text-[15px] font-semibold leading-snug ${isExcluded ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-main)]'}`}>
                          {row.label}
                        </p>
                        {row.detail ? (
                          <p className="mt-1 break-all text-xs leading-relaxed text-[var(--text-muted)]">{row.detail}</p>
                        ) : null}
                      </>
                    )}
                    {isParkItem && !isExcluded && parkRetryBusy ? (
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">Working on a line…</p>
                    ) : null}
                    {isParkItem && !isExcluded && !parkLineRetryEnabled && !parkRetryBusy ? (
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Retry is available after this run pauses or finishes.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {showWait ? (
          <p className="mt-8 text-sm text-[var(--text-muted)]">Applying data to NoSpos…</p>
        ) : null}
          </div>

          {showViewParkedCta ? (
            <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[min(100%,380px)] lg:self-start">
              <div className="rounded-2xl border-2 border-[var(--brand-blue)] bg-gradient-to-br from-[var(--brand-orange)] via-amber-300 to-amber-100 p-1 shadow-lg">
                <button
                  type="button"
                  disabled={viewNoSposBusy}
                  onClick={handleViewParked}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-[14px] bg-white px-5 py-8 text-center shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70 focus:outline-none focus:ring-4 focus:ring-[var(--brand-blue)]/25"
                >
                  {viewNoSposBusy ? (
                    <span className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--brand-blue)] border-t-transparent" />
                  ) : (
                    <span className="material-symbols-outlined text-5xl text-[var(--brand-blue)]">open_in_new</span>
                  )}
                  <span className="text-lg font-black uppercase tracking-wide text-[var(--brand-blue)]">
                    View parked agreement
                  </span>
                  {parkedAgreementId ? (
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-blue)]">
                      ID {parkedAgreementId}
                    </span>
                  ) : null}
                  <span className="max-w-[260px] text-xs leading-snug text-[var(--text-muted)]">
                    Opens the NoSpos agreement items page for this saved agreement ID.
                  </span>
                </button>
              </div>
            </aside>
          ) : null}
        </div>

        {itemTables != null && itemTables.length > 0 ? (
          <div className="mt-10 space-y-10 border-t border-[var(--ui-border)] pt-10">
            {itemTables.map((tbl) => (
              <section key={tbl.itemIndex}>
                <h3 className={`text-[11px] font-black uppercase tracking-[0.2em] ${tbl.excluded ? 'text-[var(--text-muted)]' : 'text-brand-blue'}`}>
                  {tbl.title}
                </h3>
                {tbl.footNote ? (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{tbl.footNote}</p>
                ) : null}
                {canRetryLine && parkLineRetryEnabled && !tbl.excluded ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={parkRetryBusy}
                      onClick={() => onRetryParkLine(tbl.itemIndex)}
                      className="rounded-lg border border-[var(--ui-border)] bg-white px-3 py-2 text-xs font-bold text-[var(--brand-blue)] transition hover:bg-[var(--ui-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Retry / re-sync this line on NoSpos
                    </button>
                  </div>
                ) : null}
                <ParkItemFieldTable tbl={tbl} onPatch={patch} />
              </section>
            ))}
          </div>
        ) : null}

        {footerError ? (
          <p className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {footerError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
