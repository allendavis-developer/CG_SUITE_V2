import { useCallback, useMemo } from 'react';
import {
  hasNosposMirrorCgSyncMarker,
  resolveNosposMirrorItemDescriptionField,
} from '../utils/nosposMirrorSyncMarkers';

export function isNosposMirrorCardComplete(card) {
  if (!card) return false;
  return !(card.fields || []).some((field) => {
    if (!field?.required || !field?.name) return false;
    const value = field.value != null ? String(field.value).trim() : '';
    return value === '';
  });
}

export function buildNosposMirrorRowCardMap(sourceLines = [], snapshot = null, testingOutcomeByRow = {}, requestId = null) {
  const cards = snapshot?.cards || [];

  const failedRows = new Set();
  if (testingOutcomeByRow && typeof testingOutcomeByRow === 'object') {
    for (const [rawIdx, outcome] of Object.entries(testingOutcomeByRow)) {
      if (outcome !== 'failed') continue;
      const rowIdx = Number(rawIdx);
      if (Number.isInteger(rowIdx) && rowIdx >= 0) failedRows.add(rowIdx);
    }
  }

  const activeRowIndexes = sourceLines
    .map((_, rowIdx) => rowIdx)
    .filter((rowIdx) => !failedRows.has(rowIdx));

  const rowToCardIndex = new Map();
  const cardToRowIndex = new Map();
  const unmatchedCardIndexes = [];
  const matchedRowIndexes = new Set();

  cards.forEach((card, cardIdx) => {
    const descriptionField = resolveNosposMirrorItemDescriptionField(card);
    if (!descriptionField) {
      unmatchedCardIndexes.push(cardIdx);
      return;
    }

    let matchedRowIdx = null;
    for (const rowIdx of activeRowIndexes) {
      if (matchedRowIndexes.has(rowIdx)) continue;
      const sourceItem = sourceLines?.[rowIdx] || null;
      if (!hasNosposMirrorCgSyncMarker(descriptionField.value, sourceItem, rowIdx, requestId)) continue;
      matchedRowIdx = rowIdx;
      break;
    }

    if (matchedRowIdx == null) {
      unmatchedCardIndexes.push(cardIdx);
      return;
    }

    matchedRowIndexes.add(matchedRowIdx);
    rowToCardIndex.set(matchedRowIdx, cardIdx);
    cardToRowIndex.set(cardIdx, matchedRowIdx);
  });

  const unmatchedActiveRows = activeRowIndexes.filter((rowIdx) => !matchedRowIndexes.has(rowIdx));
  const fallbackPairCount = Math.min(unmatchedActiveRows.length, unmatchedCardIndexes.length);
  for (let i = 0; i < fallbackPairCount; i++) {
    const rowIdx = unmatchedActiveRows[i];
    const cardIdx = unmatchedCardIndexes[i];
    rowToCardIndex.set(rowIdx, cardIdx);
    cardToRowIndex.set(cardIdx, rowIdx);
  }

  const rowStates = sourceLines.map((_, rowIdx) => {
    const outcome = testingOutcomeByRow?.[rowIdx] ?? null;
    const isFailed = outcome === 'failed';
    const cardIdx = rowToCardIndex.get(rowIdx);
    const card = Number.isInteger(cardIdx) ? (cards[cardIdx] || null) : null;
    const isAdded = Boolean(card);
    const isComplete = isNosposMirrorCardComplete(card);
    const isProcessed = outcome === 'passed' || outcome === 'failed' || isComplete;
    return {
      rowIdx,
      outcome,
      isFailed,
      cardIdx: Number.isInteger(cardIdx) ? cardIdx : null,
      card,
      isAdded,
      isComplete,
      isProcessed,
    };
  });

  const rowStateByIndex = new Map(rowStates.map((state) => [state.rowIdx, state]));
  const nextRowToAdd = activeRowIndexes.find((rowIdx) => !rowToCardIndex.has(rowIdx)) ?? null;
  const expectedCardCount = activeRowIndexes.length;
  const missingCardCount = activeRowIndexes.filter((rowIdx) => !rowToCardIndex.has(rowIdx)).length;
  const allRowsProcessed =
    sourceLines.length > 0 &&
    rowStates.length === sourceLines.length &&
    rowStates.every((state) => state.isProcessed);

  return {
    failedRows,
    activeRowIndexes,
    rowToCardIndex,
    cardToRowIndex,
    rowStates,
    rowStateByIndex,
    nextRowToAdd,
    expectedCardCount,
    missingCardCount,
    allRowsProcessed,
  };
}

export default function useNosposMirrorRowCardMap(sourceLines = [], snapshot = null, testingOutcomeByRow = {}, requestId = null) {
  const mapping = useMemo(
    () => buildNosposMirrorRowCardMap(sourceLines, snapshot, testingOutcomeByRow, requestId),
    [sourceLines, snapshot, testingOutcomeByRow, requestId]
  );

  const getCardIndexForRow = useCallback(
    (rowIdx) => mapping.rowToCardIndex.get(rowIdx) ?? null,
    [mapping.rowToCardIndex]
  );

  const getSourceRowIndexForCard = useCallback(
    (cardIdx) => mapping.cardToRowIndex.get(cardIdx) ?? cardIdx,
    [mapping.cardToRowIndex]
  );

  return {
    ...mapping,
    getCardIndexForRow,
    getSourceRowIndexForCard,
  };
}
