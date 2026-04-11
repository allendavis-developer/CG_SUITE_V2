import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';
import { fetchRequestDetail, fetchRequestsOverview } from '@/services/api';
import { CustomDropdown } from '@/components/ui/components';
import AppHeader from '@/components/AppHeader';
import {
  formatIntent,
  getFilterTitle,
  REQUEST_OVERVIEW_STATUS_FILTERS,
} from '@/utils/transactionConstants';
import { formatRequestItemNamesList } from '@/utils/requestToCartMapping';

const FILTER_LABELS = REQUEST_OVERVIEW_STATUS_FILTERS.map((f) => f.label);

function labelToFilterValue(label) {
  return REQUEST_OVERVIEW_STATUS_FILTERS.find((f) => f.label === label)?.value ?? 'ALL';
}

const getStatusColor = (status) => {
  switch (status) {
    case 'QUOTE':
      return 'bg-brand-blue/10 text-brand-blue';
    case 'BOOKED_FOR_TESTING':
      return 'bg-amber-600/10 text-amber-600';
    case 'COMPLETE':
      return 'bg-purple-600/10 text-purple-600';
    default:
      return 'bg-gray-600/10 text-gray-600';
  }
};

const formatStatus = (status) => {
  if (status === 'BOOKED_FOR_TESTING') return 'Booked for Testing';
  if (status === 'QUOTE') return 'Quote';
  if (status === 'COMPLETE') return 'Complete';
  return String(status).replace(/_/g, ' ');
};

const getInitials = (name) => {
  if (!name || typeof name !== 'string') return '?';
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

/** Date + time for overview (API sends ISO datetime on `created_at`). */
function formatRequestCreatedAt(iso) {
  if (iso == null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RequestsOverview = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const [requests, setRequests] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [error, setError] = useState(null);
  /** Full-page spinner only before the first successful load (filter changes do not blank the UI). */
  const [initialLoading, setInitialLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const loadRequests = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    if (isFirstLoad) {
      setInitialLoading(true);
    } else {
      setListRefreshing(true);
    }
    setError(null);
    try {
      const data = await fetchRequestsOverview(filterStatus);
      setRequests(data);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      console.error('Error fetching requests:', err);
      const message = err?.message || 'Failed to load requests';
      setError(message);
      showNotification(`Failed to load requests: ${message}`, 'error');
    } finally {
      setInitialLoading(false);
      setListRefreshing(false);
    }
  }, [filterStatus, showNotification]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const stats = useMemo(() => {
    // Derived from the current server response (already filtered). Sidebar counts = “in this view”.
    return {
      quotes: requests.filter((r) => r.current_status === 'QUOTE').length,
      booked: requests.filter((r) => r.current_status === 'BOOKED_FOR_TESTING').length,
      completed: requests.filter((r) => r.current_status === 'COMPLETE').length,
    };
  }, [requests]);

  const totalGrandValue = useMemo(
    () =>
      requests.reduce((sum, request) => sum + (Number(request.negotiated_grand_total_gbp) || 0), 0),
    [requests]
  );

  const onRowNavigate = useCallback(
    async (requestItem) => {
      if (requestItem.current_status === 'QUOTE') {
        try {
          const data = await fetchRequestDetail(requestItem.request_id);
          if (data) {
            navigate('/buyer', { state: { openQuoteRequest: data } });
          } else {
            navigate(`/requests/${requestItem.request_id}/view`);
          }
        } catch {
          navigate(`/requests/${requestItem.request_id}/view`);
        }
      } else {
        navigate(`/requests/${requestItem.request_id}/view`);
      }
    },
    [navigate]
  );

  const onFilterLabelChange = useCallback((label) => {
    setFilterStatus(labelToFilterValue(label));
  }, []);

  if (initialLoading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <p className="text-gray-600 font-semibold">Loading requests...</p>
      </div>
    );
  }

  if (error && requests.length === 0) {
    return (
      <div className="bg-gray-50 min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-600 font-semibold">Error: {error}</p>
        <button
          type="button"
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white"
          onClick={() => loadRequests()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <style>{`
        .material-symbols-outlined { font-size: 20px; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .data-table th {
          background: var(--ui-bg);
          color: var(--brand-blue);
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--ui-border);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .data-table td {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--ui-border);
          vertical-align: middle;
        }
        .data-table tr {
          cursor: pointer;
          transition: background-color 150ms;
        }
        .data-table tr:hover {
          background-color: var(--ui-bg);
        }
        .status-pill {
          padding: 0.25rem 0.625rem;
          border-radius: 9999px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>

      <AppHeader />

      <main className="relative flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
        {listRefreshing ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-brand-orange/80"
            aria-hidden
          />
        ) : null}

        <aside className="w-64 bg-brand-blue flex flex-col shrink-0">
          <div className="p-6 space-y-8">
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">
                Main Menu
              </h3>
              <nav className="space-y-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 text-white py-2 bg-white/10 rounded-lg px-3 -mx-3 cursor-pointer text-left"
                  onClick={() => navigate('/requests-overview')}
                >
                  <span className="material-symbols-outlined text-sm text-brand-orange">
                    receipt_long
                  </span>
                  <span className="text-sm font-bold">Overview</span>
                </button>
              </nav>
            </div>
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">
                In this view
              </h3>
              <p className="text-white/35 text-[9px] font-medium mb-3 leading-snug">
                Counts match the table below (respects status filter).
              </p>
              <div className="space-y-4">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">
                    Quote rows
                  </p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.quotes}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">
                    Booked rows
                  </p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.booked}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">
                    Complete rows
                  </p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.completed}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">
                    Rows shown
                  </p>
                  <p className="text-xl font-extrabold text-white mt-1">{requests.length}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-auto p-6 border-t border-white/10">
            <button
              type="button"
              className="w-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white py-3 rounded-lg flex items-center justify-center gap-2 transition-all"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              <span className="text-xs font-bold uppercase tracking-wider">Logout</span>
            </button>
          </div>
        </aside>

        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200 bg-white">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-extrabold text-brand-blue">{getFilterTitle(filterStatus)}</h1>
              <span className="bg-brand-blue/10 text-brand-blue text-[11px] font-black px-2.5 py-0.5 rounded-full">
                {requests.length} TOTAL
              </span>
              <span className="bg-brand-blue/10 text-brand-blue text-[11px] font-black px-2.5 py-0.5 rounded-full">
                £{totalGrandValue.toFixed(2)} VALUE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CustomDropdown
                label=""
                value={getFilterTitle(filterStatus)}
                options={FILTER_LABELS}
                onChange={onFilterLabelChange}
              />
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-blue-hover transition-colors font-bold"
                onClick={() => navigate('/buyer')}
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span>New Request</span>
              </button>
            </div>
          </div>

          <div
            className={`overflow-auto flex-1 transition-opacity duration-150 ${listRefreshing ? 'opacity-60' : ''}`}
          >
            {requests.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500 font-semibold">No requests found.</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-24">ID</th>
                    <th className="min-w-[200px]">Customer Name</th>
                    <th className="min-w-[220px] max-w-[420px]">Items</th>
                    <th className="w-32">Intent</th>
                    <th className="w-32">Item Count</th>
                    <th className="w-40">Total Value</th>
                    <th className="w-32">Status</th>
                    <th className="w-40">Created At</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {requests.map((requestItem) => {
                    const itemsSummary = formatRequestItemNamesList(requestItem);
                    return (
                    <tr key={requestItem.request_id} onClick={() => onRowNavigate(requestItem)}>
                      <td className="font-bold text-gray-600">#{requestItem.request_id}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-brand-blue text-[11px]">
                            {getInitials(requestItem.customer_details?.name)}
                          </div>
                          <div className="font-bold text-brand-blue text-[13px]">
                            {requestItem.customer_details?.name ?? '—'}
                          </div>
                        </div>
                      </td>
                      <td
                        className="max-w-[420px] text-gray-700 align-middle"
                        title={itemsSummary || undefined}
                      >
                        <span className="line-clamp-3 break-words text-[12px] font-medium leading-snug">
                          {itemsSummary || '—'}
                        </span>
                      </td>
                      <td className="font-semibold text-gray-600">
                        {formatIntent(requestItem.intent)}
                      </td>
                      <td className="font-semibold">
                        {requestItem.items?.length ?? 0} Item
                        {(requestItem.items?.length ?? 0) !== 1 ? 's' : ''}
                      </td>
                      <td className="font-bold text-brand-blue text-[13px]">
                        £{Number(requestItem.negotiated_grand_total_gbp)?.toFixed(2) || '0.00'}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${getStatusColor(requestItem.current_status)}`}
                        >
                          {formatStatus(requestItem.current_status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-gray-600 tabular-nums">
                        {formatRequestCreatedAt(requestItem.created_at)}
                      </td>
                      <td className="text-right">
                        <span className="material-symbols-outlined text-slate-300">chevron_right</span>
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
              Showing {requests.length} result{requests.length !== 1 ? 's' : ''}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default RequestsOverview;
