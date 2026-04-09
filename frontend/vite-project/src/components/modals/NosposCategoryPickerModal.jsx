import React, { useMemo, useCallback } from 'react';
import TinyModal from '@/components/ui/TinyModal';
import HierarchicalCategoryPickerPanel from '@/components/pickers/HierarchicalCategoryPickerPanel';
import { nosposCategoriesToNestedRoots } from '@/utils/categoryPickerTree';

/**
 * NosPos stock category picker — same hierarchical + global search UX as the eBay category step.
 *
 * @param {object[]|null} nosposCategoriesResults - `GET /nospos-categories/` results; null while loading
 * @param {number|null} currentNosposId
 * @param {function} onSelect - receives the original API row (with `fullName` aligned to picked path)
 * @param {function} onClose
 */
export default function NosposCategoryPickerModal({
  nosposCategoriesResults,
  currentNosposId,
  onSelect,
  onClose,
}) {
  const roots = useMemo(
    () => nosposCategoriesToNestedRoots(nosposCategoriesResults || []),
    [nosposCategoriesResults]
  );

  const handlePick = useCallback(
    ({ node, pathNames }) => {
      const row = node._sourceRow;
      if (!row) return;
      const joined = pathNames.filter(Boolean).join(' > ');
      const fullName = joined || row.fullName;
      onSelect({ ...row, fullName });
    },
    [onSelect]
  );

  const isLoading = nosposCategoriesResults == null;
  const loadError =
    !isLoading && roots.length === 0
      ? 'No NosPos categories available. Check the API or your connection.'
      : null;

  return (
    <TinyModal
      title="Select NosPos Category"
      onClose={onClose}
      panelClassName="max-w-xl flex max-h-[min(92vh,720px)] flex-col"
      zClass="z-[250]"
      bodyScroll={true}
    >
      <div className="flex h-[min(72vh,520px)] min-h-[280px] w-full min-w-0 shrink-0 flex-col overflow-hidden">
        <HierarchicalCategoryPickerPanel
          roots={roots}
          isLoading={isLoading}
          loadError={loadError}
          filterChildren={(x) => x}
          onSelect={handlePick}
          currentSelectionCategoryId={currentNosposId}
          entitySingular="category"
          entityPlural="categories"
        />
      </div>
    </TinyModal>
  );
}
