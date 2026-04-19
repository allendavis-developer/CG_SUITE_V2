import { useRef, useEffect, useCallback } from "react";
import useAppStore from "@/store/useAppStore";
import { clearLastRepricingResult, getLastRepricingResult, getNosposRepricingStatus } from "@/services/extensionClient";
import { clearRepricingProgress } from "@/utils/repricingProgress";
import {
  buildSessionSavePayload,
  buildAmbiguousBarcodeEntries,
  buildUnverifiedBarcodeEntries,
  openBarcodePrintTab,
} from "./listWorkspaceUtils";

/**
 * Extension / polling completion flow + deduped persistence for repricing & upload workspaces.
 */
export function useListWorkspaceRepricingCompletion({
  activeCartKey,
  dbSessionId,
  useUploadSessions,
  updateWorkspaceSession,
  saveWorkspaceSession,
  copy,
  showNotification,
  setIsRepricingFinished,
  setRepricingJob,
  setCompletedItemsData,
  setUnverifiedModal,
  setAmbiguousBarcodeModal,
  setCompletedBarcodes,
  setCompletedItems,
}) {
  const lastHandledCompletionRef = useRef("");

  const persistCompletedRepricing = useCallback(
    async (payload) => {
      if (!payload?.cart_key || payload.cart_key !== activeCartKey) return false;

      const fingerprint = JSON.stringify(payload);
      if (lastHandledCompletionRef.current === fingerprint) return false;
      lastHandledCompletionRef.current = fingerprint;

      const savePayload = buildSessionSavePayload(payload);
      const ambiguousEntries = buildAmbiguousBarcodeEntries(payload);
      const unverifiedEntries = buildUnverifiedBarcodeEntries(payload);

      try {
        if (dbSessionId) {
          const updateData = { status: "COMPLETED" };
          if (savePayload.barcode_count > 0) {
            updateData.items_data = savePayload.items_data;
            updateData.barcode_count = savePayload.barcode_count;
            updateData.item_count = savePayload.item_count;
            updateData.cart_key = savePayload.cart_key;
          }
          try {
            await updateWorkspaceSession(dbSessionId, updateData);
          } catch {}
          if (savePayload.barcode_count > 0) clearRepricingProgress(activeCartKey);
          useAppStore.getState().clearRepricingSessionDraft();
        } else if (savePayload.barcode_count > 0) {
          await saveWorkspaceSession(savePayload);
          clearRepricingProgress(activeCartKey);
        }

        try {
          await clearLastRepricingResult();
        } catch {}

        setIsRepricingFinished(true);
        setRepricingJob((prev) =>
          prev
            ? {
                ...prev,
                running: false,
                done: true,
                step: "completed",
                message: copy.jobCompletedMessage,
              }
            : prev
        );

        if (savePayload.barcode_count > 0) {
          setCompletedItemsData(savePayload.items_data);
          openBarcodePrintTab(savePayload.items_data);
        }

        if (unverifiedEntries.length > 0) {
          setUnverifiedModal({ entries: unverifiedEntries });
        }

        if (ambiguousEntries.length > 0) {
          setAmbiguousBarcodeModal({ entries: ambiguousEntries, isRetrying: false });
          if (savePayload.barcode_count > 0) {
            showNotification(copy.persistSavedWithIssues(unverifiedEntries.length), "warning");
          } else {
            showNotification(copy.persistNoItemsRetry, "warning");
          }
        } else if (savePayload.barcode_count > 0) {
          showNotification(
            unverifiedEntries.length > 0
              ? copy.persistDoneWithUnverified(unverifiedEntries.length)
              : copy.persistDoneSaved,
            unverifiedEntries.length > 0 ? "warning" : "success"
          );
        } else {
          showNotification(copy.persistNoItems, "info");
        }

        return true;
      } catch (err) {
        lastHandledCompletionRef.current = "";
        showNotification(err?.message || copy.persistSaveError, "error");
        return false;
      }
    },
    [
      activeCartKey,
      dbSessionId,
      updateWorkspaceSession,
      saveWorkspaceSession,
      copy,
      showNotification,
      setIsRepricingFinished,
      setRepricingJob,
      setCompletedItemsData,
      setUnverifiedModal,
      setAmbiguousBarcodeModal,
    ]
  );

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "REPRICING_PROGRESS" && e.data.payload) {
        const { cartKey: msgCartKey, completedBarcodes: cb, completedItems: ci } = e.data.payload;
        if (msgCartKey && msgCartKey === activeCartKey) {
          setCompletedBarcodes(cb || {});
          setCompletedItems(ci || []);
          setRepricingJob(e.data.payload);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeCartKey, setCompletedBarcodes, setCompletedItems, setRepricingJob]);

  useEffect(() => {
    const handler = async (e) => {
      if (e.data?.type !== "REPRICING_COMPLETE" || !e.data.payload) return;
      await persistCompletedRepricing(e.data.payload);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [persistCompletedRepricing]);

  useEffect(() => {
    if (!activeCartKey) return;
    let cancelled = false;

    const syncLiveStatus = async () => {
      try {
        const response = await getNosposRepricingStatus();
        const payload = response?.ok ? response.payload : null;
        if (cancelled || !payload || payload.cartKey !== activeCartKey) return;
        setRepricingJob(payload);
        setCompletedBarcodes(payload.completedBarcodes || {});
        setCompletedItems(payload.completedItems || []);
      } catch {}
    };

    const checkForCompletedResult = async () => {
      try {
        const response = await getLastRepricingResult();
        if (cancelled || !response?.ok || !response.payload) return;
        await persistCompletedRepricing(response.payload);
      } catch {}
    };

    syncLiveStatus();
    checkForCompletedResult();
    const intervalId = window.setInterval(syncLiveStatus, 1500);
    window.addEventListener("focus", checkForCompletedResult);
    document.addEventListener("visibilitychange", checkForCompletedResult);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkForCompletedResult);
      document.removeEventListener("visibilitychange", checkForCompletedResult);
    };
  }, [activeCartKey, persistCompletedRepricing, setCompletedBarcodes, setCompletedItems, setRepricingJob]);

  useEffect(() => {
    lastHandledCompletionRef.current = "";
  }, [activeCartKey]);

  return { lastHandledCompletionRef };
}
