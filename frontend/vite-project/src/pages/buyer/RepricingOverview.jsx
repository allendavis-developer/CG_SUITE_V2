import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { useNotification } from "@/contexts/NotificationContext";
import { fetchRepricingSessionsOverview, updateRepricingSession } from "@/services/api";
import useAppStore from "@/store/useAppStore";

const STATUS_FILTERS = ['ALL', 'IN_PROGRESS', 'COMPLETED'];

function deduplicateBarcodes(barcodes) {
  if (!Array.isArray(barcodes)) return [];
  const seen = new Set();
  return barcodes.filter(b => {
    const key = b.barserial || b.barcode || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachBarcodesFromSessionItems(cartItems, sessionItems) {
  if (!Array.isArray(sessionItems) || sessionItems.length === 0) return cartItems;
  const byItemId = {};
  for (const si of sessionItems) {
    const id = si.item_identifier;
    if (!id || !si.stock_barcode) continue;
    if (!byItemId[id]) byItemId[id] = [];
    byItemId[id].push({
      barserial: si.stock_barcode,
      href: si.stock_url || '',
      name: si.title || '',
    });
  }
  return cartItems.map(item => {
    const sessionBarcodes = byItemId[item.id] || [];
    const existing = item.nosposBarcodes || [];
    const merged = [...existing, ...sessionBarcodes];
    return { ...item, nosposBarcodes: deduplicateBarcodes(merged) };
  });
}

const RepricingOverview = () => {
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
        const data = await fetchRepricingSessionsOverview();
        setSessions(data || []);
      } catch (err) {
        setError(err.message);
        showNotification(`Failed to load repricing sessions: ${err.message}`, "error");
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

  const getItemSummary = (session) => {
    const items = session.session_data?.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const first = items[0]?.title || 'Untitled';
    if (items.length === 1) return first;
    return `${first} +${items.length - 1} more`;
  };

  const handleSessionClick = (session) => {
    if (session.status === 'IN_PROGRESS' && session.session_data?.items?.length) {
      const items = session.session_data.items.map(item => ({
        ...item,
        nosposBarcodes: deduplicateBarcodes(item.nosposBarcodes),
      }));
      useAppStore.setState({
        repricingCartItems: items,
        repricingSessionId: session.repricing_session_id,
        mode: 'repricing',
        isCustomerModalOpen: false,
      });
      navigate('/repricing');
    } else {
      navigate(`/repricing-sessions/${session.repricing_session_id}/view`);
    }
  };

  const handleRedoRepricing = async (e, session) => {
    e.stopPropagation();
    const rawItems = session.session_data?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      showNotification('No item data available to redo this session.', 'error');
      return;
    }
    const items = attachBarcodesFromSessionItems(rawItems, session.items);
    try {
      await updateRepricingSession(session.repricing_session_id, { status: 'IN_PROGRESS' });
    } catch {}
    useAppStore.setState({
      repricingCartItems: items,
      repricingSessionId: session.repricing_session_id,
      mode: 'repricing',
      isCustomerModalOpen: false,
    });
    navigate('/repricing');
  };

  const handleNewRepricing = () => {
    useAppStore.setState({ repricingSessionId: null, repricingCartItems: [], mode: 'repricing' });
    navigate('/repricing', { state: { freshStart: true } });
  };

  if (loading) {
    return <div className="bg-gray-50 min-h-screen flex items-center justify-center"><p className="text-gray-600 font-semibold">Loading repricing sessions...</p></div>;
  }

  if (error) {
    return <div className="bg-gray-50 min-h-screen flex items-center justify-center"><p className="text-red-600 font-semibold">Error: {error}</p></div>;
  }

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <style>{`
        .material-symbols-outlined { font-size: 20px; }
        .data-table th {
          background: #f8fafc;
          color: #144584;
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid #e5e7eb;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .data-table td {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid #e5e7eb;
          vertical-align: middle;
        }
        .data-table tr {
          cursor: pointer;
          transition: background-color 150ms;
        }
        .data-table tr:hover {
          background-color: #f8fafc;
        }
      `}</style>

      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
        <aside className="w-64 bg-blue-900 flex flex-col shrink-0">
          <div className="p-6 space-y-8">
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">Main Menu</h3>
              <nav className="space-y-1">
                <div className="flex items-center gap-3 text-white py-2 bg-white/10 rounded-lg px-3 -mx-3">
                  <span className="material-symbols-outlined text-sm text-amber-400">sell</span>
                  <span className="text-sm font-bold">Overview</span>
                </div>
              </nav>
            </div>
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">Stats</h3>
              <div className="space-y-4">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Total Sessions</p>
                  <p className="text-xl font-extrabold text-white mt-1">{sessions.length}</p>
                </div>
                {inProgressCount > 0 && (
                  <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-400/30">
                    <p className="text-amber-300/70 text-[10px] font-bold uppercase tracking-wider">In Progress</p>
                    <p className="text-xl font-extrabold text-amber-300 mt-1">{inProgressCount}</p>
                  </div>
                )}
                <div className="bg-emerald-500/10 p-3 rounded-lg border border-emerald-400/30">
                  <p className="text-emerald-300/70 text-[10px] font-bold uppercase tracking-wider">Completed</p>
                  <p className="text-xl font-extrabold text-emerald-300 mt-1">{completedCount}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Barcodes Repriced</p>
                  <p className="text-xl font-extrabold text-white mt-1">{totalBarcodeCount}</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200 bg-white">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-extrabold text-blue-900">Repricing Overview</h1>
              <span className="bg-blue-900/10 text-blue-900 text-[11px] font-black px-2.5 py-0.5 rounded-full">
                {filteredSessions.length} TOTAL
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                      filterStatus === f
                        ? 'bg-blue-900 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {f === 'ALL' ? 'All' : f === 'IN_PROGRESS' ? 'In Progress' : 'Completed'}
                  </button>
                ))}
              </div>
              <button
                className="flex items-center gap-2 px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition-colors font-bold"
                onClick={handleNewRepricing}
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span>New Repricing</span>
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            {filteredSessions.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500 font-semibold">No repricing sessions found.</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-24">Session</th>
                    <th className="w-32">Status</th>
                    <th className="min-w-[200px]">Items</th>
                    <th className="w-24">Count</th>
                    <th className="w-28">Barcodes</th>
                    <th className="w-40">Created</th>
                    <th className="w-40">Last Updated</th>
                    <th className="w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {filteredSessions.map((session) => {
                    const isInProgress = session.status === 'IN_PROGRESS';
                    const itemSummary = getItemSummary(session);
                    const hasSessionItems = Array.isArray(session.session_data?.items) && session.session_data.items.length > 0;
                    return (
                      <tr key={session.repricing_session_id} onClick={() => handleSessionClick(session)}>
                        <td className="font-bold text-gray-600">#{session.repricing_session_id}</td>
                        <td>
                          {isInProgress ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              In Progress
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Completed
                            </span>
                          )}
                        </td>
                        <td>
                          {itemSummary ? (
                            <span className="text-blue-900 font-semibold text-[12px]">{itemSummary}</span>
                          ) : (
                            <span className="text-gray-400 italic">No item data</span>
                          )}
                        </td>
                        <td className="font-semibold text-blue-900">{session.item_count || 0}</td>
                        <td className="font-semibold text-blue-900">{session.barcode_count || 0}</td>
                        <td className="text-gray-600">
                          {new Date(session.created_at).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="text-gray-500">
                          {session.updated_at ? new Date(session.updated_at).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          }) : '—'}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {isInProgress ? (
                              <span
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                                title="Resume session"
                              >
                                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                                Resume
                              </span>
                            ) : (
                              <>
                                <span
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
                                  title="View session details"
                                >
                                  <span className="material-symbols-outlined text-[14px]">visibility</span>
                                  View
                                </span>
                                {hasSessionItems && (
                                  <button
                                    onClick={(e) => handleRedoRepricing(e, session)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                                    title="Start a new repricing session with the same items"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">refresh</span>
                                    Redo
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

          <div className="px-6 py-4 border-t border-gray-200 bg-slate-50 flex items-center justify-between">
            <p className="text-[11px] text-gray-600 font-bold uppercase tracking-widest">
              Showing {filteredSessions.length} of {sessions.length} sessions
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default RepricingOverview;
