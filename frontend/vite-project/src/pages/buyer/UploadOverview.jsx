import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { useNotification } from "@/contexts/NotificationContext";
import {
  fetchUploadSessionsOverview,
  fetchUploadSessionDetail,
  updateUploadSession,
} from "@/services/api";
import useAppStore from "@/store/useAppStore";
import { attachBarcodesFromSessionItems, deduplicateBarcodes } from "./utils/repricingSessionMapping";
import { UPLOAD_BARCODE_WORKSPACE_VERSION } from "./listWorkspace/listWorkspaceUtils";

const STATUS_FILTERS = ['ALL', 'IN_PROGRESS', 'COMPLETED'];

const UploadOverview = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUploadSessionsOverview();
        setSessions(data || []);
      } catch (err) {
        setError(err.message);
        showNotification(`Failed to load upload sessions: ${err.message}`, "error");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [showNotification]);

  const filteredSessions = useMemo(
    () => filterStatus === 'ALL' ? sessions : sessions.filter(s => s.status === filterStatus),
    [sessions, filterStatus]
  );

  const totalBarcodeCount = useMemo(
    () => sessions.reduce((sum, session) => sum + (Number(session.barcode_count) || 0), 0),
    [sessions]
  );

  const inProgressCount = useMemo(
    () => sessions.filter(s => s.status === 'IN_PROGRESS').length,
    [sessions]
  );

  const completedCount = useMemo(
    () => sessions.filter(s => s.status === 'COMPLETED').length,
    [sessions]
  );

  const getItemsSummary = (session) => {
    const items = session.session_data?.items;
    if (!Array.isArray(items) || items.length === 0) return '';
    return items
      .map((it) => String(it?.title ?? '').trim() || 'Untitled')
      .join(', ');
  };

  /** Build React Router state for the upload workspace (`/upload`). */
  const buildWorkspaceNavigationState = (session, detail = null) => {
    const sd = detail?.session_data ?? session.session_data;
    if (!sd) return null;
    const uploadScanSlotIds = Array.isArray(sd.uploadScanSlotIds) ? sd.uploadScanSlotIds : [];
    const uploadPendingSlotIds = Array.isArray(sd.uploadPendingSlotIds) ? sd.uploadPendingSlotIds : [];
    const uploadBarcodeIntakeDone = sd.uploadBarcodeIntakeDone !== false;
    const hasWorkspace = sd.uploadBarcodeWorkspace?.version === UPLOAD_BARCODE_WORKSPACE_VERSION;
    const resumeExtras = hasWorkspace
      ? {
          uploadBarcodeWorkspace: sd.uploadBarcodeWorkspace,
          uploadBarcodeIntakeOpen:
            typeof sd.uploadBarcodeIntakeOpen === "boolean"
              ? sd.uploadBarcodeIntakeOpen
              : Boolean(sd.uploadBarcodeWorkspace.intakeOpen),
          uploadStockDetailsBySlotId: sd.uploadStockDetailsBySlotId ?? null,
        }
      : {};
    /**
     * Audit sessions need the audit flag to ride on every `/upload` nav or the workspace
     * falls back to the create-new-product flow and overwrites live Web EPOS items
     * (including forcing On Sale off). UploadSessionView already does this; mirror it here
     * so clicking an in-progress audit tile (or Redo) doesn't lose the flag.
     */
    const isAudit = String(session.mode || '').toUpperCase() === 'AUDIT';
    const auditExtras = isAudit
      ? {
          uploadAuditMode: true,
          auditQueue: sd.auditQueue ?? null,
          auditWebeposProductHrefByBarcode: sd.auditWebeposProductHrefByBarcode ?? null,
          auditWebeposRrpByBarcode: sd.auditWebeposRrpByBarcode ?? null,
        }
      : {};

    if (hasWorkspace) {
      if (Array.isArray(sd.items) && sd.items.length > 0) {
        const lineItems = detail?.items ?? session.items ?? [];
        const mapped = sd.items.map((item) => ({
          ...item,
          nosposBarcodes: deduplicateBarcodes(item.nosposBarcodes),
        }));
        const cartItems = attachBarcodesFromSessionItems(mapped, lineItems);
        return {
          cartItems,
          sessionId: session.upload_session_id,
          sessionBarcodes: sd.barcodes ?? null,
          sessionNosposLookups: sd.nosposLookups ?? null,
          uploadPendingSlotIds,
          uploadBarcodeIntakeDone,
          ...resumeExtras,
          ...auditExtras,
        };
      }
      return {
        cartItems: [],
        sessionId: session.upload_session_id,
        sessionBarcodes: sd.barcodes ?? null,
        sessionNosposLookups: sd.nosposLookups ?? null,
        ...resumeExtras,
        ...auditExtras,
      };
    }

    if (Array.isArray(sd.items) && sd.items.length > 0) {
      const lineItems = detail?.items ?? session.items ?? [];
      const mapped = sd.items.map((item) => ({
        ...item,
        nosposBarcodes: deduplicateBarcodes(item.nosposBarcodes),
      }));
      const cartItems = attachBarcodesFromSessionItems(mapped, lineItems);
      return {
        cartItems,
        sessionId: session.upload_session_id,
        sessionBarcodes: sd.barcodes ?? null,
        sessionNosposLookups: sd.nosposLookups ?? null,
        uploadPendingSlotIds,
        uploadBarcodeIntakeDone,
        ...auditExtras,
      };
    }
    if (uploadPendingSlotIds.length > 0) {
      return {
        cartItems: [],
        sessionId: session.upload_session_id,
        sessionBarcodes: sd.barcodes ?? null,
        sessionNosposLookups: sd.nosposLookups ?? null,
        uploadPendingSlotIds,
        uploadBarcodeIntakeDone,
        ...auditExtras,
      };
    }
    if (uploadScanSlotIds.length > 0) {
      return {
        cartItems: [],
        sessionId: session.upload_session_id,
        sessionBarcodes: sd.barcodes ?? null,
        sessionNosposLookups: sd.nosposLookups ?? null,
        uploadScanSlotIds,
        uploadBarcodeIntakeDone: false,
        ...auditExtras,
      };
    }
    return null;
  };

  const handleSessionClick = async (session) => {
    if (session.status === 'COMPLETED') {
      navigate(`/upload-sessions/${session.upload_session_id}/view`);
      return;
    }

    let navState = buildWorkspaceNavigationState(session);
    if (!navState) {
      try {
        const detail = await fetchUploadSessionDetail(session.upload_session_id);
        if (detail) navState = buildWorkspaceNavigationState(session, detail);
      } catch (err) {
        showNotification(`Could not load session: ${err.message}`, 'error');
      }
    }
    if (navState) {
      navigate('/upload', { state: navState });
      return;
    }
    navigate('/upload', {
      state: { sessionId: session.upload_session_id, cartItems: [] },
    });
  };

  const handleRedoUpload = async (e, session) => {
    e.stopPropagation();
    let navState = buildWorkspaceNavigationState(session);
    if (!navState) {
      try {
        const detail = await fetchUploadSessionDetail(session.upload_session_id);
        if (detail) navState = buildWorkspaceNavigationState(session, detail);
      } catch (err) {
        showNotification(`Could not load session: ${err.message}`, 'error');
        return;
      }
    }
    if (!navState) {
      showNotification('No item data available to redo this session.', 'error');
      return;
    }
    try {
      await updateUploadSession(session.upload_session_id, { status: 'IN_PROGRESS' });
    } catch {}
    navigate('/upload', { state: navState });
  };

  const handleNewUpload = () => {
    useAppStore.getState().resetRepricingWorkspace({
      homePath: '/upload',
      negotiationPath: '/upload-negotiation',
    });
    navigate('/upload');
  };

  const FILTER_LABELS = { ALL: 'All', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed' };

  if (loading) {
    return (
      <div className="bg-ui-bg min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
          <span className="text-sm font-medium">Loading upload sessions…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-ui-bg min-h-screen flex items-center justify-center">
        <div className="cg-card p-6 flex items-start gap-3 max-w-sm">
          <span className="material-symbols-outlined text-red-500 text-xl shrink-0 mt-0.5">error</span>
          <div>
            <p className="text-sm font-semibold text-slate-800">Failed to load sessions</p>
            <p className="text-xs text-slate-500 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-ui-bg text-slate-900 min-h-screen flex flex-col text-sm">
      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
        <aside className="w-60 bg-brand-blue flex flex-col shrink-0 overflow-y-auto">
          <div className="p-5 space-y-6">
            <div>
              <p className="text-white/40 text-[9.5px] font-bold uppercase tracking-widest mb-3">Navigation</p>
              <nav className="space-y-0.5">
                <div className="flex items-center gap-2.5 text-white py-2 bg-white/10 rounded-lg px-3">
                  <span className="material-symbols-outlined text-[18px] text-brand-orange">upload</span>
                  <span className="text-sm font-semibold">Overview</span>
                </div>
              </nav>
            </div>

            <div>
              <p className="text-white/40 text-[9.5px] font-bold uppercase tracking-widest mb-3">Session Stats</p>
              <div className="space-y-2">
                {[
                  { label: 'Total Sessions', value: sessions.length, cls: 'bg-white/5 border-white/10', valCls: 'text-white' },
                  inProgressCount > 0 ? { label: 'In Progress', value: inProgressCount, cls: 'bg-amber-500/10 border-amber-400/25', valCls: 'text-amber-300' } : null,
                  { label: 'Completed', value: completedCount, cls: 'bg-emerald-500/10 border-emerald-400/25', valCls: 'text-emerald-300' },
                  { label: 'Barcodes processed', value: totalBarcodeCount, cls: 'bg-white/5 border-white/10', valCls: 'text-white' },
                ].filter(Boolean).map((stat) => (
                  <div key={stat.label} className={`${stat.cls} border rounded-lg px-3 py-2.5`}>
                    <p className="text-white/45 text-[9.5px] font-bold uppercase tracking-wider">{stat.label}</p>
                    <p className={`text-lg font-extrabold mt-0.5 tabular-nums ${stat.valCls}`}>{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-slate-200 bg-white shrink-0 gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-brand-blue">Upload Overview</h1>
              <span className="bg-brand-blue/8 text-brand-blue text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border border-brand-blue/15">
                {filteredSessions.length}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilterStatus(f)}
                    className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap ${
                      filterStatus === f
                        ? 'bg-brand-blue text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    {FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-blue-hover transition-colors font-semibold text-sm shadow-sm"
                onClick={handleNewUpload}
              >
                <span className="material-symbols-outlined text-[17px] leading-none">add</span>
                New upload
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            {filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
                <span className="material-symbols-outlined text-4xl">upload</span>
                <p className="text-sm font-medium">No upload sessions found</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-24">Session</th>
                    <th className="w-32">Status</th>
                    <th className="min-w-[220px] max-w-[380px]">Items</th>
                    <th className="w-20">Count</th>
                    <th className="w-40">Created</th>
                    <th className="w-40">Last Updated</th>
                    <th className="w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((session) => {
                    const isInProgress = session.status === 'IN_PROGRESS';
                    const isAudit = String(session.mode || '').toUpperCase() === 'AUDIT';
                    const itemsSummary = getItemsSummary(session);
                    const hasSessionItems =
                      Array.isArray(session.session_data?.items) &&
                      session.session_data.items.length > 0;
                    return (
                      <tr
                        key={session.upload_session_id}
                        onClick={() => handleSessionClick(session)}
                      >
                        <td>
                          <span className="font-mono text-xs font-semibold text-brand-blue bg-brand-blue/6 px-2 py-0.5 rounded">
                            #{session.upload_session_id}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isInProgress ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <span className="size-1.5 rounded-full bg-amber-500" />
                                In Progress
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                Completed
                              </span>
                            )}
                            {isAudit && (
                              <span
                                title="Audit session: editing existing Web EPOS products in place"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-violet-50 text-violet-700 border border-violet-200"
                              >
                                <span className="material-symbols-outlined text-[12px] leading-none">fact_check</span>
                                Audit
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[380px]" title={itemsSummary || undefined}>
                          {itemsSummary ? (
                            <span className="line-clamp-2 break-words text-xs text-slate-700 font-medium leading-snug">
                              {itemsSummary}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-xs">No item data</span>
                          )}
                        </td>
                        <td className="font-semibold text-slate-700 tabular-nums">{session.item_count || 0}</td>
                        <td className="text-slate-500 tabular-nums">
                          {new Date(session.created_at).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="text-slate-400 tabular-nums">
                          {session.updated_at
                            ? new Date(session.updated_at).toLocaleString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            {isInProgress ? (
                              <button
                                type="button"
                                onClick={() => handleSessionClick(session)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px] leading-none">play_arrow</span>
                                Resume
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSessionClick(session)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10.5px] font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px] leading-none">visibility</span>
                                  View
                                </button>
                                {hasSessionItems && (
                                  <button
                                    type="button"
                                    title="Mark session in progress again and open the upload workspace with this list"
                                    onClick={(e) => handleRedoUpload(e, session)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10.5px] font-bold bg-brand-blue/6 text-brand-blue border border-brand-blue/15 hover:bg-brand-blue/10 transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-[14px] leading-none">edit_note</span>
                                    Resume
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 shrink-0 flex items-center justify-between">
            <p className="text-xs text-slate-500 font-medium">
              Showing <span className="font-semibold text-slate-700">{filteredSessions.length}</span> of{' '}
              <span className="font-semibold text-slate-700">{sessions.length}</span> sessions
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default UploadOverview;
