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
  const rrpCompleteCallbackRef = useRef(null);

  const persistCompletedRepricing = useCallback(
    async (payload) => {
      if (!payload?.cart_key || payload.cart_key !== activeCartKey) return false;

      const fingerprint = JSON.stringify(payload);
      if (lastHandledCompletionRef.current === fingerprint) return false;
      lastHandledCompletionRef.current = fingerprint;

      // RRP-then-WEBEPOS mode: save prices and hand off to callback instead of normal completion
      const rrpCallback = rrpCompleteCallbackRef.current;
      if (rrpCallback) {
        rrpCompleteCallbackRef.current = null;
        const savePayload = buildSessionSavePayload(payload);
        try {
          if (dbSessionId && Array.isArray(savePayload.items_data) && savePayload.items_data.length > 0) {
            await updateWorkspaceSession(dbSessionId, { items_data: savePayload.items_data });
          }
          await clearLastRepricingResult().catch(() => {});
        } catch {}
        clearRepricingProgress(activeCartKey);
        rrpCallback();
        return true;
      }

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
        const payload = e.data.payload;
        const { cartKey: msgCartKey, completedBarcodes: cb, completedItems: ci } = payload;
        if (msgCartKey && msgCartKey === activeCartKey) {
          setCompletedBarcodes(cb || {});
          setCompletedItems(ci || []);
          setRepricingJob((prev) => {
            // Always merge logs so the stack never gets cleared between phases.
            const existingLogs = prev?.logs || [];
            const incomingLogs = payload.logs || [];
            const existingTs = new Set(existingLogs.map((l) => l.timestamp));
            const newLogs = incomingLogs.filter((l) => !existingTs.has(l.timestamp));
            const mergedLogs = newLogs.length ? [...existingLogs, ...newLogs] : existingLogs;
            // During NosPos phase keep the product count stable (it's barcode-level progress,
            // not product-level). The product count only advances during webEposUpload.
            if (payload.step !== 'webEposUpload' && prev?.step === 'webEposUpload') return prev;
            if (payload.step !== 'webEposUpload') {
              return { ...payload, logs: mergedLogs, completedBarcodeCount: prev?.completedBarcodeCount ?? 0, totalBarcodes: prev?.totalBarcodes ?? payload.totalBarcodes };
            }
            return { ...payload, logs: mergedLogs };
          });
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
    let timerId = null;

    // Poll fast while a matching NosPos job is live; back off hard when idle
    // (upload module usually has no active job — was burning a call every 1.5s).
    const ACTIVE_INTERVAL_MS = 1500;
    const IDLE_INTERVAL_MS = 20000;

    const syncLiveStatus = async () => {
      let matched = false;
      try {
        const response = await getNosposRepricingStatus();
        const payload = response?.ok ? response.payload : null;
        if (cancelled) return;
        if (payload && payload.cartKey === activeCartKey) {
          matched = true;
          setRepricingJob((prev) => {
            const existingLogs = prev?.logs || [];
            const incomingLogs = payload.logs || [];
            const existingTs = new Set(existingLogs.map((l) => l.timestamp));
            const newLogs = incomingLogs.filter((l) => !existingTs.has(l.timestamp));
            const mergedLogs = newLogs.length ? [...existingLogs, ...newLogs] : existingLogs;
            if (payload.step !== 'webEposUpload' && prev?.step === 'webEposUpload') return prev;
            if (payload.step !== 'webEposUpload') {
              return { ...payload, logs: mergedLogs, completedBarcodeCount: prev?.completedBarcodeCount ?? 0, totalBarcodes: prev?.totalBarcodes ?? payload.totalBarcodes };
            }
            return { ...payload, logs: mergedLogs };
          });
          setCompletedBarcodes(payload.completedBarcodes || {});
          setCompletedItems(payload.completedItems || []);
        }
      } catch {
        /* swallow: transient bridge errors shouldn't kill the poll loop */
      }
      if (!cancelled) {
        timerId = window.setTimeout(syncLiveStatus, matched ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
      }
    };

    const checkForCompletedResult = async () => {
      try {
        const response = await getLastRepricingResult();
        if (cancelled || !response?.ok || !response.payload) return;
        await persistCompletedRepricing(response.payload);
      } catch {
        /* swallow: retried on next focus / visibility change */
      }
    };

    syncLiveStatus();
    checkForCompletedResult();
    window.addEventListener("focus", checkForCompletedResult);
    document.addEventListener("visibilitychange", checkForCompletedResult);

    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
      window.removeEventListener("focus", checkForCompletedResult);
      document.removeEventListener("visibilitychange", checkForCompletedResult);
    };
  }, [activeCartKey, persistCompletedRepricing, setCompletedBarcodes, setCompletedItems, setRepricingJob]);

  useEffect(() => {
    lastHandledCompletionRef.current = "";
  }, [activeCartKey]);

  return { lastHandledCompletionRef, rrpCompleteCallbackRef };
}
