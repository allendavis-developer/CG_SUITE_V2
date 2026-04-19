import React from 'react';
import { NosposSchemaCellSpinner } from '@/pages/buyer/components/NosposRequiredFieldsColumnCell';

/**
 * Shared “mirror stock category” cell: NosPos retail tree or CG retail tree (breadcrumb + optional picker).
 */
export default function MirroredStockCategoryColumnCell({
  mode,
  item,
  breadcrumb,
  categoriesLoading,
  onOpenPicker,
  pickerTitle,
  emptyCta,
}) {
  if (item.isRemoved) {
    return <div className="text-[10px] text-slate-400">—</div>;
  }
  if (categoriesLoading) {
    return (
      <div className="py-1">
        <NosposSchemaCellSpinner />
      </div>
    );
  }
  const hasBreadcrumb = Boolean(breadcrumb);
  const canPick = mode === 'negotiate' && typeof onOpenPicker === 'function';

  return (
    <div className="flex flex-col gap-0.5">
      {canPick ? (
        <button
          type="button"
          onClick={() => onOpenPicker(item)}
          className={`group flex w-full items-start gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-100 ${
            hasBreadcrumb ? '' : 'border border-dashed border-amber-300 bg-amber-50/60 hover:bg-amber-50'
          }`}
          title={
            hasBreadcrumb
              ? `${pickerTitle} — current: ${breadcrumb}`
              : emptyCta || `No ${pickerTitle} — click to set one`
          }
        >
          {hasBreadcrumb ? (
            <>
              <span className="min-w-0 flex-1 break-words text-[10px] font-medium leading-snug" style={{ color: 'var(--text-muted)' }}>
                {breadcrumb}
              </span>
              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                edit
              </span>
            </>
          ) : (
            <span className="text-[10px] font-semibold leading-snug text-amber-700">{emptyCta || 'No category set'}</span>
          )}
        </button>
      ) : (
        <div className="text-[10px] font-medium leading-snug break-words" style={{ color: 'var(--text-muted)' }}>
          {breadcrumb || '—'}
        </div>
      )}
    </div>
  );
}
