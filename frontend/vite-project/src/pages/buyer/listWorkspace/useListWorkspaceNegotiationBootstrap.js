import { useEffect, useRef } from "react";
import useAppStore from "@/store/useAppStore";
import { loadRepricingProgress, getCartKey } from "@/utils/repricingProgress";
import {
  UPLOAD_BARCODE_WORKSPACE_VERSION,
  expandUploadBarcodeWorkspace,
  buildUploadBarcodeWorkspaceSnapshot,
  buildNosposMapsFromNegotiationItems,
  pickNegotiationItemForSession,
  uploadWorkspaceHasRecordedBarcode,
} from "./listWorkspaceUtils";

/**
 * One-shot hydration from router `location.state` / local progress (empty deps by design).
 */
export function useListWorkspaceNegotiationBootstrap({
  moduleKey,
  location,
  cartItems,
  resumingUploadSessionFromNav,
  maxBarcodesPerItem,
  saveWorkspaceSession,
  readSessionIdFromResponse,
  setDbSessionId,
  setItems,
  setBarcodes,
  setNosposLookups,
  setUploadScanSlotIds,
  setUploadBarcodeIntakeOpen,
  setUploadBarcodeIntakeDone,
  setUploadStockDetailsBySlotId,
  setBarcodeModal,
  setBarcodeInput,
  setIsLoading,
  isCreatingSession,
  enterUploadMainFlowWithAuditBarcodesRef,
  setUploadAuditMode,
  auditQueueRef,
  auditWebeposProductHrefByBarcodeRef,
  auditWebeposRrpByBarcodeRef,
}) {
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const resumeSessionId = location.state?.sessionId || useAppStore.getState().repricingSessionId;
    const sessionBarcodes = location.state?.sessionBarcodes || null;
    const sessionNosposLookups = location.state?.sessionNosposLookups || null;
    const navUploadScanSlotIds = location.state?.uploadScanSlotIds;
    const navUploadPendingSlotIds = location.state?.uploadPendingSlotIds;
    const navUploadBarcodeIntakeDone = location.state?.uploadBarcodeIntakeDone;
    const navUploadBarcodeWorkspace = location.state?.uploadBarcodeWorkspace;
    const auditBarcodes = useAppStore.getState().auditBarcodes || [];
    const auditRows = useAppStore.getState().auditRows || [];

    // Resume audit mode from a saved session (Continue button → route state passes these).
    const resumeAuditMode = location.state?.uploadAuditMode === true;
    const resumeAuditQueue = location.state?.auditQueue || null;
    const resumeAuditHrefs = location.state?.auditWebeposProductHrefByBarcode || null;
    const resumeAuditRrps = location.state?.auditWebeposRrpByBarcode || null;
    if (resumeAuditMode) {
      if (typeof setUploadAuditMode === 'function') setUploadAuditMode(true);
      if (auditQueueRef && Array.isArray(resumeAuditQueue)) {
        auditQueueRef.current = [...resumeAuditQueue];
      }
      /**
       * Restore per-barcode Web EPOS productHref + RRP maps. Without these on resume,
       * `auditWebeposPriceUpdateList` comes out empty (every row gets filtered by the
       * `if (!productHref) return null` guard) and the workspace either early-exits with
       * "Nothing to sync" or — before this fix — fell through to the create flow and
       * turned On Sale off on live products.
       */
      if (auditWebeposProductHrefByBarcodeRef && resumeAuditHrefs && typeof resumeAuditHrefs === 'object') {
        auditWebeposProductHrefByBarcodeRef.current = { ...resumeAuditHrefs };
      }
      if (auditWebeposRrpByBarcodeRef && resumeAuditRrps && typeof resumeAuditRrps === 'object') {
        auditWebeposRrpByBarcodeRef.current = { ...resumeAuditRrps };
      }
    }

    if (
      resumeSessionId &&
      (cartItems?.length ||
        (Array.isArray(navUploadScanSlotIds) && navUploadScanSlotIds.length > 0) ||
        (Array.isArray(navUploadPendingSlotIds) && navUploadPendingSlotIds.length > 0) ||
        navUploadBarcodeWorkspace?.version === UPLOAD_BARCODE_WORKSPACE_VERSION)
    ) {
      setDbSessionId(resumeSessionId);
    }

    if (!cartItems || cartItems.length === 0) {
      if (
        moduleKey === "upload" &&
        navUploadBarcodeWorkspace?.version === UPLOAD_BARCODE_WORKSPACE_VERSION
      ) {
        const ex = expandUploadBarcodeWorkspace(navUploadBarcodeWorkspace);
        if (ex) {
          if (resumeSessionId) setDbSessionId(resumeSessionId);
          setUploadScanSlotIds(ex.uploadScanSlotIds);
          setUploadBarcodeIntakeOpen(
            resumingUploadSessionFromNav ? false : ex.uploadBarcodeIntakeOpen
          );
          setUploadBarcodeIntakeDone(ex.uploadBarcodeIntakeDone);
          if (resumingUploadSessionFromNav) {
            setBarcodeModal(null);
            setBarcodeInput("");
          }
          const sb = sessionBarcodes && typeof sessionBarcodes === "object" ? sessionBarcodes : {};
          const sl =
            sessionNosposLookups && typeof sessionNosposLookups === "object" ? sessionNosposLookups : {};
          setBarcodes({ ...sb, ...ex.barcodes });
          setNosposLookups({ ...sl, ...ex.nosposLookups });
          const persistedStock = location.state?.uploadStockDetailsBySlotId;
          if (persistedStock && typeof persistedStock === "object") {
            setUploadStockDetailsBySlotId(persistedStock);
          }
          setIsLoading(false);
          return;
        }
      }
      if (Array.isArray(navUploadPendingSlotIds) && navUploadPendingSlotIds.length > 0) {
        setUploadBarcodeIntakeDone(navUploadBarcodeIntakeDone !== false);
        setUploadBarcodeIntakeOpen(false);
        if (sessionBarcodes && Object.keys(sessionBarcodes).length > 0) {
          setBarcodes(sessionBarcodes);
          setNosposLookups(sessionNosposLookups || {});
        } else {
          const scanK = `upload-scan:${navUploadPendingSlotIds.join("|")}`;
          const locSaved = scanK ? loadRepricingProgress(scanK) : null;
          if (
            locSaved &&
            (Object.keys(locSaved.barcodes || {}).length > 0 ||
              Object.keys(locSaved.nosposLookups || {}).length > 0)
          ) {
            setBarcodes(locSaved.barcodes || {});
            setNosposLookups(locSaved.nosposLookups || {});
          }
        }
      } else if (Array.isArray(navUploadScanSlotIds) && navUploadScanSlotIds.length > 0) {
        setUploadScanSlotIds(navUploadScanSlotIds);
        setUploadBarcodeIntakeDone(false);
        setUploadBarcodeIntakeOpen(!resumingUploadSessionFromNav);
        if (resumingUploadSessionFromNav) {
          setBarcodeModal(null);
          setBarcodeInput("");
        }
        if (sessionBarcodes && Object.keys(sessionBarcodes).length > 0) {
          setBarcodes(sessionBarcodes);
          setNosposLookups(sessionNosposLookups || {});
        } else {
          const scanK = `upload-scan:${navUploadScanSlotIds.join("|")}`;
          const locSaved = scanK ? loadRepricingProgress(scanK) : null;
          if (
            locSaved &&
            (Object.keys(locSaved.barcodes || {}).length > 0 ||
              Object.keys(locSaved.nosposLookups || {}).length > 0)
          ) {
            setBarcodes(locSaved.barcodes || {});
            setNosposLookups(locSaved.nosposLookups || {});
          }
        }
      }
      if (moduleKey === "upload" && resumingUploadSessionFromNav) {
        setBarcodeModal(null);
        setBarcodeInput("");
      }
      setIsLoading(false);
      return;
    }

    const pendingTag = new Set((navUploadPendingSlotIds || []).map(String));
    setItems(
      cartItems.map((item) => {
        const next = { ...item };
        if (moduleKey !== "upload") return next;
        const hasVerifiedNosposRow =
          Array.isArray(item.nosposBarcodes) &&
          item.nosposBarcodes.some((b) => String(b?.barserial || "").trim());
        if (hasVerifiedNosposRow) {
          next.isUploadBarcodeQueuePlaceholder = false;
        } else if (pendingTag.has(String(item.id))) {
          next.isUploadBarcodeQueuePlaceholder = true;
        }
        return next;
      })
    );
    if (moduleKey === "upload") {
      const uw = location.state?.uploadBarcodeWorkspace;
      if (uw?.version === UPLOAD_BARCODE_WORKSPACE_VERSION) {
        const ex = expandUploadBarcodeWorkspace(uw);
        if (ex) {
          setUploadScanSlotIds(ex.uploadScanSlotIds);
          setUploadBarcodeIntakeOpen(
            resumingUploadSessionFromNav ? false : ex.uploadBarcodeIntakeOpen
          );
          setUploadBarcodeIntakeDone(ex.uploadBarcodeIntakeDone);
          if (resumingUploadSessionFromNav) {
            setBarcodeModal(null);
            setBarcodeInput("");
          }
        } else {
          setUploadBarcodeIntakeOpen(false);
          setUploadBarcodeIntakeDone(true);
        }
      } else {
        setUploadBarcodeIntakeOpen(false);
        setUploadBarcodeIntakeDone(true);
      }
      const persistedStock = location.state?.uploadStockDetailsBySlotId;
      if (persistedStock && typeof persistedStock === "object") {
        setUploadStockDetailsBySlotId(persistedStock);
      }
      if (resumingUploadSessionFromNav) {
        setBarcodeModal(null);
        setBarcodeInput("");
      }
      if (Array.isArray(auditBarcodes) && auditBarcodes.length > 0) {
        // Delegate to the hook's audit entry so both intake paths go through the same queue.
        const entry = enterUploadMainFlowWithAuditBarcodesRef?.current;
        if (typeof entry === 'function') {
          entry(auditBarcodes, Array.isArray(auditRows) ? auditRows : []);
        } else {
          const slotIds = auditBarcodes.map(
            () =>
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `audit-slot-${Date.now()}-${Math.random().toString(36).slice(2)}`
          );
          setUploadScanSlotIds(slotIds);
          setUploadBarcodeIntakeOpen(true);
          setUploadBarcodeIntakeDone(false);
          setBarcodeModal({ item: { id: slotIds[0], title: 'Audit barcode' } });
          const barcodeMap = {};
          slotIds.forEach((slotId, idx) => {
            barcodeMap[slotId] = [auditBarcodes[idx]];
          });
          setBarcodes(barcodeMap);
          if (typeof setUploadAuditMode === 'function') setUploadAuditMode(true);
        }
        useAppStore.setState({ auditBarcodes: [], auditRows: [] });
      }
    }
    const cartKey = getCartKey(cartItems);
    const saved = cartKey ? loadRepricingProgress(cartKey) : null;

    if (
      saved &&
      (Object.keys(saved.barcodes || {}).length > 0 || Object.keys(saved.nosposLookups || {}).length > 0)
    ) {
      setBarcodes(saved.barcodes || {});
      setNosposLookups(saved.nosposLookups || {});
    } else if (sessionBarcodes && Object.keys(sessionBarcodes).length > 0) {
      setBarcodes(sessionBarcodes);
      setNosposLookups(sessionNosposLookups || {});
    } else {
      const { barcodes: prePopulated, nosposLookups: prePopulatedLookups } =
        buildNosposMapsFromNegotiationItems(cartItems, maxBarcodesPerItem);
      if (Object.keys(prePopulated).length > 0) {
        setBarcodes(prePopulated);
        setNosposLookups(prePopulatedLookups);
      }
    }

    if (moduleKey === "upload") {
      const uwMerge = location.state?.uploadBarcodeWorkspace;
      if (uwMerge?.version === UPLOAD_BARCODE_WORKSPACE_VERSION) {
        const exMerge = expandUploadBarcodeWorkspace(uwMerge);
        if (exMerge) {
          setBarcodes((prev) => ({ ...(prev || {}), ...exMerge.barcodes }));
          setNosposLookups((prev) => ({ ...(prev || {}), ...exMerge.nosposLookups }));
        }
      }
    }

    if (!resumeSessionId && !isCreatingSession.current) {
      isCreatingSession.current = true;
      const itemsSnapshot = cartItems.map(pickNegotiationItemForSession);
      const restoredBarcodes = saved?.barcodes || sessionBarcodes || {};
      const restoredLookups = saved?.nosposLookups || sessionNosposLookups || {};
      const baseSessionData = {
        items: itemsSnapshot,
        barcodes: restoredBarcodes,
        nosposLookups: restoredLookups,
        uploadScanSlotIds: [],
        uploadPendingSlotIds: [],
        uploadBarcodeIntakeOpen: false,
        uploadBarcodeIntakeDone: true,
      };
      if (moduleKey === "upload") {
        const uwNav = location.state?.uploadBarcodeWorkspace;
        if (uwNav?.version === UPLOAD_BARCODE_WORKSPACE_VERSION) {
          const exNav = expandUploadBarcodeWorkspace(uwNav);
          if (exNav?.barcodes) {
            baseSessionData.barcodes = { ...(baseSessionData.barcodes || {}), ...exNav.barcodes };
            baseSessionData.nosposLookups = {
              ...(baseSessionData.nosposLookups || {}),
              ...exNav.nosposLookups,
            };
          }
        }
        baseSessionData.uploadBarcodeWorkspace = buildUploadBarcodeWorkspaceSnapshot({
          ...baseSessionData,
        });
        baseSessionData.uploadStockDetailsBySlotId = {};
      }
      if (moduleKey === "upload" && !uploadWorkspaceHasRecordedBarcode(baseSessionData)) {
        isCreatingSession.current = false;
      } else {
        saveWorkspaceSession({
          cart_key: cartKey,
          item_count: cartItems.length,
          session_data: baseSessionData,
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
      }
    }

    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot bootstrap from navigation
  }, []);
}
