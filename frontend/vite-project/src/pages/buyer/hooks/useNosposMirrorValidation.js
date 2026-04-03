import { useCallback, useMemo } from 'react';

function isEmptyForValidation(field, raw) {
  const value = raw != null ? String(raw).trim() : '';
  return value === '';
}

export default function useNosposMirrorValidation({
  snapshot,
  values,
  hasUserOverride,
  getSourceRowIndexForCard,
  failedRowsForParking,
}) {
  const allFields = useMemo(() => {
    if (!snapshot) return [];
    const list = [];
    for (const card of snapshot.cards || []) {
      for (const field of card.fields || []) {
        if (field?.name) list.push(field);
      }
    }
    return list;
  }, [snapshot]);

  const getValidationErrorsForCard = useCallback((cardIdx, candidateValues) => {
    const errs = new Set();
    const card = snapshot?.cards?.[cardIdx];
    if (!card) return errs;
    for (const field of card.fields || []) {
      if (!field?.required || !field?.name) continue;
      const localValue = candidateValues?.[field.name];
      const localIsEmpty = isEmptyForValidation(field, localValue);
      const wasUserOverridden = hasUserOverride(field.name);
      const effectiveValue =
        !localIsEmpty || wasUserOverridden
          ? localValue
          : (field.value != null ? String(field.value) : '');
      if (isEmptyForValidation(field, effectiveValue)) errs.add(field.name);
    }
    return errs;
  }, [snapshot, hasUserOverride]);

  const validationErrors = useMemo(() => {
    const errs = new Set();
    for (const field of allFields) {
      if (!field.required) continue;
      const localValue = values[field.name];
      const localIsEmpty = isEmptyForValidation(field, localValue);
      const wasUserOverridden = hasUserOverride(field.name);
      const effectiveValue =
        !localIsEmpty || wasUserOverridden
          ? localValue
          : (field.value != null ? String(field.value) : '');
      if (isEmptyForValidation(field, effectiveValue)) errs.add(field.name);
    }
    return errs;
  }, [allFields, values, hasUserOverride]);

  const getValidationErrorsForParking = useCallback((candidateValues) => {
    const errs = new Set();
    const cards = snapshot?.cards || [];
    for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
      const sourceRowIdx = getSourceRowIndexForCard(cardIdx);
      if (failedRowsForParking.has(sourceRowIdx)) continue;
      const cardErrs = getValidationErrorsForCard(cardIdx, candidateValues);
      cardErrs.forEach((name) => errs.add(name));
    }
    return errs;
  }, [snapshot, getSourceRowIndexForCard, failedRowsForParking, getValidationErrorsForCard]);

  return {
    allFields,
    validationErrors,
    getValidationErrorsForCard,
    getValidationErrorsForParking,
  };
}
