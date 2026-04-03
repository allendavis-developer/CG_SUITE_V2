import { useCallback, useEffect, useRef } from 'react';
import { nosposAgreementApplyFields } from '@/services/extensionClient';
import { buildApplyFieldKey } from '../utils/nosposMirrorKeys';

export default function useNosposMirrorQueuedApplies({
  snapshotRef,
  setApplyingCards,
  setFormError,
}) {
  const pendingFieldApplyRef = useRef(new Map());
  const applyFlushTimerRef = useRef(null);
  const applyInFlightRef = useRef(false);
  const applyNeedsAnotherPassRef = useRef(false);
  const flushQueuedFieldAppliesRef = useRef(null);

  useEffect(() => {
    flushQueuedFieldAppliesRef.current = async function flushQueuedFieldAppliesInternal() {
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
      if (applyInFlightRef.current) {
        applyNeedsAnotherPassRef.current = true;
        return;
      }

      const pendingEntries = [...pendingFieldApplyRef.current.values()];
      if (pendingEntries.length === 0) return;

      applyInFlightRef.current = true;
      applyNeedsAnotherPassRef.current = false;
      pendingFieldApplyRef.current = new Map();

      const currentCards = snapshotRef.current?.cards || [];
      const currentSnapshotByKey = new Map();
      for (let cardIdx = 0; cardIdx < currentCards.length; cardIdx++) {
        const card = currentCards[cardIdx];
        for (const field of card.fields || []) {
          if (!field?.name) continue;
          currentSnapshotByKey.set(
            buildApplyFieldKey(field.name, cardIdx, card.cardId || null),
            field.value != null ? String(field.value) : ''
          );
        }
      }

      let fields = pendingEntries.filter((field) => {
        const fieldKey = buildApplyFieldKey(field.name, field.cardIndex, field.cardId || null);
        return (currentSnapshotByKey.get(fieldKey) ?? '') !== field.value;
      });

      const cardIdxs = [...new Set(
        fields.map((field) => field.cardIndex).filter((idx) => Number.isInteger(idx))
      )];

      if (fields.length === 0) {
        applyInFlightRef.current = false;
        if (applyNeedsAnotherPassRef.current || pendingFieldApplyRef.current.size > 0) {
          void flushQueuedFieldAppliesRef.current();
        }
        return;
      }

      if (cardIdxs.length > 0) {
        setApplyingCards((prev) => new Set([...prev, ...cardIdxs]));
      }

      try {
        let pendingFields = [...fields];
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (pendingFields.length === 0) break;
          const response = await nosposAgreementApplyFields(pendingFields);
          if (!response?.ok && !Array.isArray(response?.missing) && !Array.isArray(response?.failed)) {
            throw new Error(response?.error || 'Could not update the NosPos form. Is the agreement tab still open?');
          }
          const missing = Array.isArray(response?.missing) ? response.missing : [];
          const failed = Array.isArray(response?.failed) ? response.failed : [];
          const retryKeys = new Set(
            [...missing, ...failed]
              .map((entry) => buildApplyFieldKey(entry?.name, entry?.cardIndex, entry?.cardId || null))
              .filter((key) => key !== buildApplyFieldKey('', null, null))
          );
          if (retryKeys.size === 0) {
            pendingFields = [];
            break;
          }
          pendingFields = pendingFields.filter((field) =>
            retryKeys.has(buildApplyFieldKey(field.name, field.cardIndex, field.cardId || null))
          );
          if (pendingFields.length > 0) await new Promise((resolve) => setTimeout(resolve, 80));
        }

        if (pendingFields.length > 0) {
          const latestCards = snapshotRef.current?.cards || [];
          const latestByKey = new Map();
          for (let cardIdx = 0; cardIdx < latestCards.length; cardIdx++) {
            const card = latestCards[cardIdx];
            for (const field of card.fields || []) {
              if (!field?.name) continue;
              latestByKey.set(
                buildApplyFieldKey(field.name, cardIdx, card.cardId || null),
                field.value != null ? String(field.value) : ''
              );
            }
          }
          pendingFields = pendingFields.filter((field) => {
            const key = buildApplyFieldKey(field.name, field.cardIndex, field.cardId || null);
            return (latestByKey.get(key) ?? '') !== field.value;
          });
        }

        if (pendingFields.length > 0) {
          const names = pendingFields.slice(0, 5).map((field) => field.name).join(', ');
          const more = pendingFields.length > 5 ? ', ...' : '';
          throw new Error(`Could not copy all fields to NosPos (${pendingFields.length} field(s) still failing): ${names}${more}`);
        }

        setFormError(null);
      } catch (error) {
        setFormError(error?.message || 'Could not update the NosPos form.');
      } finally {
        applyInFlightRef.current = false;
        if (cardIdxs.length > 0) {
          setApplyingCards((prev) => {
            const next = new Set(prev);
            cardIdxs.forEach((idx) => next.delete(idx));
            return next;
          });
        }
        if (applyNeedsAnotherPassRef.current || pendingFieldApplyRef.current.size > 0) {
          void flushQueuedFieldAppliesRef.current();
        }
      }
    };
  });

  const flushQueuedFieldApplies = useCallback(
    () => flushQueuedFieldAppliesRef.current?.(),
    []
  );

  const queueFieldApply = useCallback((name, value, cardIdx, cardId = null) => {
    if (!name) return;
    const normalized = {
      name,
      value: value != null ? String(value) : '',
      cardIndex: Number.isInteger(cardIdx) ? cardIdx : null,
      cardId: cardId || null,
    };
    pendingFieldApplyRef.current.set(
      buildApplyFieldKey(normalized.name, normalized.cardIndex, normalized.cardId),
      normalized
    );
    if (applyFlushTimerRef.current) clearTimeout(applyFlushTimerRef.current);
    applyFlushTimerRef.current = setTimeout(() => {
      applyFlushTimerRef.current = null;
      void flushQueuedFieldAppliesRef.current?.();
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (applyFlushTimerRef.current) {
        clearTimeout(applyFlushTimerRef.current);
        applyFlushTimerRef.current = null;
      }
    };
  }, []);

  const resetQueuedApplies = useCallback(() => {
    pendingFieldApplyRef.current = new Map();
    applyNeedsAnotherPassRef.current = false;
    applyInFlightRef.current = false;
    if (applyFlushTimerRef.current) {
      clearTimeout(applyFlushTimerRef.current);
      applyFlushTimerRef.current = null;
    }
  }, []);

  return {
    pendingFieldApplyRef,
    applyFlushTimerRef,
    applyInFlightRef,
    applyNeedsAnotherPassRef,
    queueFieldApply,
    flushQueuedFieldApplies,
    resetQueuedApplies,
  };
}
