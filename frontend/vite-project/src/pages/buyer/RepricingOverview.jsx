import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { useNotification } from "@/contexts/NotificationContext";
import { fetchRepricingSessionsOverview } from "@/services/api";
import useAppStore from "@/store/useAppStore";

const RepricingOverview = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const totalBarcodeCount = useMemo(
    () => sessions.reduce((sum, session) => sum + (Number(session.barcode_count) || 0), 0),
    [sessions]
  );

  const inProgressCount = useMemo(
    () => sessions.filter(s => s.status === 'IN_PROGRESS').length,
    [sessions]
  );

  const handleSessionClick = (session) => {
    if (session.status === 'IN_PROGRESS' && session.session_data?.items?.length) {
      useAppStore.setState({
        repricingCartItems: session.session_data.items,
        repricingSessionId: session.repricing_session_id,
        isCustomerModalOpen: false,
      });
      navigate('/repricing', { state: { preserveCart: true, cartItems: session.session_data.items } });
    } else {
      navigate(`/repricing-sessions/${session.repricing_session_id}/view`);
    }
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
            <div className="space-y-4">
              <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Sessions</p>
                <p className="text-xl font-extrabold text-white mt-1">{sessions.length}</p>
              </div>
              {inProgressCount > 0 && (
                <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-400/30">
                  <p className="text-amber-300/70 text-[10px] font-bold uppercase tracking-wider">In Progress</p>
                  <p className="text-xl font-extrabold text-amber-300 mt-1">{inProgressCount}</p>
                </div>
              )}
              <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Barcodes Repriced</p>
                <p className="text-xl font-extrabold text-white mt-1">{totalBarcodeCount}</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200 bg-white">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-extrabold text-blue-900">Repricing Overview</h1>
              <span className="bg-blue-900/10 text-blue-900 text-[11px] font-black px-2.5 py-0.5 rounded-full">
                {sessions.length} TOTAL
              </span>
            </div>
            <button
              className="flex items-center gap-2 px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition-colors font-bold"
              onClick={() => navigate('/repricing')}
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>New Repricing</span>
            </button>
          </div>

          <div className="overflow-auto flex-1">
            {sessions.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500 font-semibold">No repricing sessions found.</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-28">Session</th>
                    <th className="w-32">Status</th>
                    <th className="w-40">Created</th>
                    <th className="w-40">Last Updated</th>
                    <th className="w-32">Items</th>
                    <th className="w-40">Barcodes</th>
                    <th>Cart Key</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {sessions.map((session) => {
                    const isInProgress = session.status === 'IN_PROGRESS';
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
                        <td className="font-semibold text-blue-900">{session.item_count || 0}</td>
                        <td className="font-semibold text-blue-900">{session.barcode_count || 0}</td>
                        <td className="font-mono text-[11px] text-gray-500">{session.cart_key || '—'}</td>
                        <td className="text-right">
                          {isInProgress ? (
                            <span className="material-symbols-outlined text-amber-500" title="Resume session">play_arrow</span>
                          ) : (
                            <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default RepricingOverview;
