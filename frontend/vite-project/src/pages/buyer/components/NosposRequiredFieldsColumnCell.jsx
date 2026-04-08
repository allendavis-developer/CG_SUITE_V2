import React, { useMemo } from 'react';
import {
  buildRequiredNosposFieldEditorModel,
  negotiationLineNosposFieldAiPending,
} from '@/pages/buyer/utils/nosposAgreementFirstItemFill';

function useRequiredNosposFieldEditorModel({
  item,
  negotiationIndex,
  nosposCategoriesResults,
  nosposCategoryMappings,
  useVoucherOffers,
  requestId,
}) {
  return useMemo(() => {
    if (nosposCategoriesResults == null) return null;
    return buildRequiredNosposFieldEditorModel(item, negotiationIndex, {
      useVoucherOffers,
      categoriesResults: nosposCategoriesResults,
      categoryMappings: nosposCategoryMappings || [],
      requestId,
    });
  }, [item, negotiationIndex, useVoucherOffers, nosposCategoriesResults, nosposCategoryMappings, requestId]);
}

/** Shown in NosPos category / required columns while the category mirror API is still loading. */
export function NosposSchemaCellSpinner({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 text-slate-500 ${className}`}
      title="Loading NosPos definitions…"
      aria-busy="true"
      role="status"
    >
      <span className="material-symbols-outlined text-[18px] animate-spin leading-none text-brand-blue/75">
        progress_activity
      </span>
      <span className="sr-only">Loading NosPos…</span>
    </span>
  );
}

function countMissingRequiredNosposValues(requiredRows) {
  return requiredRows.filter((r) => !r.satisfiedByPreset && !String(r.value || '').trim()).length;
}

/**
 * Compact control matching {@link NosposRequiredFieldsColumnCell} — for negotiate mode when that column is hidden (button lives under NosPos category).
 */
export function NosposRequiredFieldsEditorTriggerButton({
  item,
  negotiationIndex,
  nosposCategoriesResults,
  nosposCategoryMappings,
  useVoucherOffers,
  requestId,
  onOpenEditor,
}) {
  const model = useRequiredNosposFieldEditorModel({
    item,
    negotiationIndex,
    nosposCategoriesResults,
    nosposCategoryMappings,
    useVoucherOffers,
    requestId,
  });

  if (item?.isRemoved || nosposCategoriesResults == null) return null;
  if (!model || model.stockAssessment !== 'ready') return null;

  if (negotiationLineNosposFieldAiPending(item)) {
    return (
      <button
        type="button"
        disabled
        className="mt-1 inline-flex w-full max-w-full cursor-wait items-center justify-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-slate-500 opacity-90"
        title="NosPos stock field AI is finishing — editor opens when suggestions are ready"
      >
        <span className="material-symbols-outlined shrink-0 text-[14px] animate-spin leading-none text-slate-400">
          progress_activity
        </span>
        <span className="min-w-0 truncate">Stock AI…</span>
      </button>
    );
  }

  const missingRequiredCount = countMissingRequiredNosposValues(model.requiredRows);
  const hasReqId = item?.request_item_id != null && String(item.request_item_id).trim() !== '';

  if (missingRequiredCount === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (!hasReqId) return;
        onOpenEditor?.(item, negotiationIndex);
      }}
      disabled={!hasReqId}
      className={`mt-1 inline-flex w-full max-w-full items-center justify-center gap-0.5 rounded-md border border-amber-400 bg-amber-50 px-1.5 py-1 text-left text-[9px] font-bold uppercase tracking-wide text-amber-900 transition-colors hover:bg-amber-100 ${
        !hasReqId ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
      title={
        !hasReqId
          ? 'Line must be saved on the request before NosPos fields can be stored'
          : 'Click to edit required NosPos values'
      }
    >
      <span className="material-symbols-outlined shrink-0 text-[14px] leading-none" aria-hidden>
        tune
      </span>
      <span className="min-w-0 truncate">{`${missingRequiredCount} missing`}</span>
    </button>
  );
}

/**
 * Table cell: required NosPos stock fields — complete when every required field is filled (or satisfied by preset).
 * Zero required fields ⇒ complete. Unresolved leaf (cannot assess) ⇒ em dash.
 */
export default function NosposRequiredFieldsColumnCell({
  item,
  negotiationIndex,
  nosposCategoriesResults,
  nosposCategoryMappings,
  useVoucherOffers,
  requestId,
  onOpenEditor,
  onContextMenu,
}) {
  const model = useRequiredNosposFieldEditorModel({
    item,
    negotiationIndex,
    nosposCategoriesResults,
    nosposCategoryMappings,
    useVoucherOffers,
    requestId,
  });

  if (item?.isRemoved) {
    return (
      <td className="align-top text-[11px] text-slate-400" onContextMenu={onContextMenu}>
        —
      </td>
    );
  }

  if (nosposCategoriesResults == null) {
    return (
      <td className="align-top py-2" onContextMenu={onContextMenu}>
        <NosposSchemaCellSpinner />
      </td>
    );
  }

  if (model.stockAssessment !== 'ready') {
    return (
      <td className="align-top text-[11px] text-slate-400" onContextMenu={onContextMenu}>
        —
      </td>
    );
  }

  if (negotiationLineNosposFieldAiPending(item)) {
    return (
      <td className="align-top max-w-[150px]" onContextMenu={onContextMenu}>
        <button
          type="button"
          disabled
          className="w-full cursor-wait rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500 opacity-90"
          title="NosPos stock field AI is finishing — editor opens when suggestions are ready"
        >
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined animate-spin text-[14px] leading-none text-slate-400">
              progress_activity
            </span>
            Stock AI…
          </span>
        </button>
      </td>
    );
  }

  const missingRequiredCount = countMissingRequiredNosposValues(model.requiredRows);
  const requiredStockFieldCount = model.requiredRows.length;
  const hasReqId = item?.request_item_id != null && String(item.request_item_id).trim() !== '';
  const isComplete = missingRequiredCount === 0;

  return (
    <td className="align-top max-w-[150px]" onContextMenu={onContextMenu}>
      <button
        type="button"
        onClick={() => {
          if (!hasReqId) return;
          onOpenEditor?.(item, negotiationIndex);
        }}
        disabled={!hasReqId}
        className={`w-full rounded-lg border px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide transition-colors ${
          !isComplete
            ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
            : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
        } ${!hasReqId ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        title={
          !hasReqId
            ? 'Line must be saved on the request before NosPos fields can be stored'
            : requiredStockFieldCount === 0
              ? 'No required stock fields for this category — open to view'
              : 'Click to edit required NosPos values'
        }
      >
        {isComplete ? 'Complete' : `${missingRequiredCount} missing`}
      </button>
    </td>
  );
}
