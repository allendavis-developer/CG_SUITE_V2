import { useRef, useEffect, useCallback } from "react";
import useAppStore from "@/store/useAppStore";
import {
  buildNegotiationSessionDataSnapshot,
  listWorkspaceCartKeyFromState,
} from "./listWorkspaceUtils";

/**
 * DB draft session + debounced autosave for list workspace (repricing or upload).
 */
export function useListWorkspaceNegotiationPersistence({
  useUploadSessions,
  copy,
  items,
  barcodes,
  nosposLookups,
  uploadScanSlotIds,
  uploadPendingSlotIds,
  uploadBarcodeIntakeOpen,
  uploadBarcodeIntakeDone,
  uploadStockDetailsBySlotId,
  dbSessionId,
  setDbSessionId,
  isRepricingFinished,
  isLoading,
  updateWorkspaceSession,
  saveWorkspaceSession,
  readSessionIdFromResponse,
  isCartInitiallyEmptyRef,
  isCreatingSession,
}) {
  const autoSaveTimer = useRef(null);
  const hasPendingSave = useRef(false);
  const uploadSessionDraftStartedRef = useRef(false);

  const latestStateRef = useRef({
    items,
    barcodes,
    nosposLookups,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadStockDetailsBySlotId,
  });
  latestStateRef.current = {
    items,
    barcodes,
    nosposLookups,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadStockDetailsBySlotId,
  };

  const flushNegotiationSave = useCallback(
    (opts = {}) => {
      if (!dbSessionId || isRepricingFinished) return;
      const state = latestStateRef.current;
      const activeCount = state.items.filter((i) => !i.isRemoved).length;
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      hasPendingSave.current = false;
      updateWorkspaceSession(
        dbSessionId,
        {
          session_data: buildNegotiationSessionDataSnapshot(state, useUploadSessions),
          cart_key: listWorkspaceCartKeyFromState(state, useUploadSessions),
          item_count: activeCount,
        },
        opts
      ).catch((err) => console.warn(copy.saveFailLog, err));
    },
    [dbSessionId, isRepricingFinished, updateWorkspaceSession, copy.saveFailLog, useUploadSessions]
  );

  useEffect(() => {
    if (!dbSessionId || isLoading || isRepricingFinished) return;
    hasPendingSave.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      hasPendingSave.current = false;
      const activeCount = items.filter((i) => !i.isRemoved).length;
      const snapState = {
        items,
        barcodes,
        nosposLookups,
        uploadScanSlotIds,
        uploadPendingSlotIds,
        uploadBarcodeIntakeOpen,
        uploadBarcodeIntakeDone,
        uploadStockDetailsBySlotId,
      };
      updateWorkspaceSession(dbSessionId, {
        session_data: buildNegotiationSessionDataSnapshot(snapState, useUploadSessions),
        cart_key: listWorkspaceCartKeyFromState(snapState, useUploadSessions),
        item_count: activeCount,
      }).catch((err) => console.warn("[CG Suite] Auto-save failed:", err));
    }, 1500);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [
    items,
    barcodes,
    nosposLookups,
    uploadScanSlotIds,
    uploadPendingSlotIds,
    uploadBarcodeIntakeOpen,
    uploadBarcodeIntakeDone,
    uploadStockDetailsBySlotId,
    dbSessionId,
    isLoading,
    isRepricingFinished,
    updateWorkspaceSession,
    useUploadSessions,
  ]);

  useEffect(() => {
    return () => {
      if (hasPendingSave.current) flushNegotiationSave();
    };
  }, [flushNegotiationSave]);

  useEffect(() => {
    const handleUnload = () => flushNegotiationSave({ keepalive: true });
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [flushNegotiationSave]);

  useEffect(() => {
    if (!isCartInitiallyEmptyRef.current) return;
    if (dbSessionId || isCreatingSession.current || uploadSessionDraftStartedRef.current) return;
    const snap = latestStateRef.current;
    const hasWork =
      snap.items.length > 0 ||
      (useUploadSessions &&
        (snap.uploadScanSlotIds.length > 0 || snap.uploadPendingSlotIds.length > 0));
    if (!hasWork) return;
    uploadSessionDraftStartedRef.current = true;
    isCreatingSession.current = true;
    saveWorkspaceSession({
      cart_key: listWorkspaceCartKeyFromState(snap, useUploadSessions),
      item_count: snap.items.length,
      session_data: buildNegotiationSessionDataSnapshot(snap, useUploadSessions),
    })
      .then((resp) => {
        const sid = readSessionIdFromResponse(resp);
        if (sid) {
          setDbSessionId(sid);
          useAppStore.getState().setRepricingSessionId(sid);
        }
      })
      .catch((err) => {
        console.warn("[CG Suite] Failed to create draft session:", err);
      })
      .finally(() => {
        isCreatingSession.current = false;
      });
  }, [
    items.length,
    uploadScanSlotIds.length,
    uploadPendingSlotIds.length,
    dbSessionId,
    useUploadSessions,
    saveWorkspaceSession,
    readSessionIdFromResponse,
    setDbSessionId,
    isCartInitiallyEmptyRef,
  ]);

  return { latestStateRef, flushNegotiationSave };
}
