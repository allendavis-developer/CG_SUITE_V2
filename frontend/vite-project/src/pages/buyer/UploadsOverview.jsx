import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';
import { fetchWebListingUploadsOverview, fetchWebListingUploadDetail } from '@/services/api';
import { CustomDropdown } from '@/components/ui/components';
import AppHeader from '@/components/AppHeader';
import {
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
      return 'bg-brand-blue/8 text-brand-blue border-brand-blue/15';
    case 'BOOKED_FOR_TESTING':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'COMPLETE':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};

const formatStatus = (status) => {
  if (status === 'BOOKED_FOR_TESTING') return 'Booked for Testing';
  if (status === 'QUOTE') return 'Quote';
  if (status === 'COMPLETE') return 'Complete';
  return String(status).replace(/_/g, ' ');
};

function formatCreatedAt(iso) {
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

const UploadsOverview = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const [uploads, setUploads] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [error, setError] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const loadUploads = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    if (isFirstLoad) {
      setInitialLoading(true);
    } else {
      setListRefreshing(true);
    }
    setError(null);
    try {
      const data = await fetchWebListingUploadsOverview(filterStatus);
      setUploads(data);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      console.error('Error fetching uploads:', err);
      const message = err?.message || 'Failed to load uploads';
      setError(message);
      showNotification(`Failed to load uploads: ${message}`, 'error');
    } finally {
      setInitialLoading(false);
      setListRefreshing(false);
    }
  }, [filterStatus, showNotification]);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const stats = useMemo(() => ({
    quotes: uploads.filter((r) => r.current_status === 'QUOTE').length,
    booked: uploads.filter((r) => r.current_status === 'BOOKED_FOR_TESTING').length,
    completed: uploads.filter((r) => r.current_status === 'COMPLETE').length,
  }), [uploads]);

  const totalGrandValue = useMemo(
    () => uploads.reduce((sum, u) => sum + (Number(u.negotiated_grand_total_gbp) || 0), 0),
    [uploads]
  );

  const onRowNavigate = useCallback(
    async (upload) => {
      if (upload.current_status === 'QUOTE') {
        try {
          const data = await fetchWebListingUploadDetail(upload.request_id);
          if (data) {
            navigate('/upload', { state: { openQuoteRequest: data } });
          } else {
            navigate(`/uploads/${upload.request_id}/view`);
          }
        } catch {
          navigate(`/uploads/${upload.request_id}/view`);
        }
      } else {
        navigate(`/uploads/${upload.request_id}/view`);
      }
    },
    [navigate]
  );

  const onFilterLabelChange = useCallback((label) => {
    setFilterStatus(labelToFilterValue(label));
  }, []);

  const STATUS_DOT = {
    QUOTE: 'bg-brand-blue',
    BOOKED_FOR_TESTING: 'bg-amber-500',
    COMPLETE: 'bg-emerald-500',
  };

  if (initialLoading) {
    return (
      <div className="bg-ui-bg min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
          <span className="text-sm font-medium">Loading uploads…</span>
        </div>
      </div>
    );
  }

  if (error && uploads.length === 0) {
    return (
      <div className="bg-ui-bg min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="cg-card p-6 flex items-start gap-3 max-w-sm">
          <span className="material-symbols-outlined text-red-500 text-xl shrink-0 mt-0.5">error</span>
          <div>
            <p className="text-sm font-semibold text-slate-800">Failed to load uploads</p>
            <p className="text-xs text-slate-500 mt-0.5">{error}</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg bg-brand-blue px-5 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover transition-colors shadow-sm"
          onClick={() => loadUploads()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-ui-bg text-slate-900 min-h-screen flex flex-col text-sm">
      <AppHeader />

      <main className="relative flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
        {listRefreshing && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-brand-orange/80"
            aria-hidden
          />
        )}

        {/* Sidebar */}
        <aside className="w-60 bg-brand-blue flex flex-col shrink-0 overflow-y-auto">
          <div className="p-5 space-y-6">
            <div>
              <p className="text-white/40 text-[9.5px] font-bold uppercase tracking-widest mb-3">Navigation</p>
              <nav className="space-y-0.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 text-white py-2 bg-white/10 rounded-lg px-3 text-left"
                  onClick={() => navigate('/uploads-overview')}
                >
                  <span className="material-symbols-outlined text-[18px] text-brand-orange">cloud_upload</span>
                  <span className="text-sm font-semibold">Overview</span>
                </button>
              </nav>
            </div>
            <div>
              <p className="text-white/40 text-[9.5px] font-bold uppercase tracking-widest mb-3">In This View</p>
              <p className="text-white/35 text-[9px] font-medium mb-3 leading-snug">
                Counts reflect the current status filter.
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Quote rows', value: stats.quotes },
                  { label: 'Booked rows', value: stats.booked },
                  { label: 'Complete rows', value: stats.completed },
                  { label: 'Rows shown', value: uploads.length },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                    <p className="text-white/45 text-[9.5px] font-bold uppercase tracking-wider">{stat.label}</p>
                    <p className="text-lg font-extrabold text-white mt-0.5 tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-slate-200 bg-white shrink-0 gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-bold text-brand-blue">
                {filterStatus === 'ALL' ? 'Web Listing Uploads' : getFilterTitle(filterStatus)}
              </h1>
              <span className="bg-brand-blue/8 text-brand-blue text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border border-brand-blue/15">
                {uploads.length}
              </span>
              <span className="bg-slate-100 text-slate-600 text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border border-slate-200">
                £{totalGrandValue.toFixed(2)} value
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CustomDropdown
                label=""
                value={filterStatus === 'ALL' ? 'All Statuses' : getFilterTitle(filterStatus)}
                options={FILTER_LABELS}
                onChange={onFilterLabelChange}
              />
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-blue-hover transition-colors font-semibold text-sm shadow-sm"
                onClick={() => navigate('/upload')}
              >
                <span className="material-symbols-outlined text-[17px] leading-none">add</span>
                New Upload
              </button>
            </div>
          </div>

          {/* Table */}
          <div className={`overflow-auto flex-1 transition-opacity duration-150 ${listRefreshing ? 'opacity-60' : ''}`}>
            {uploads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
                <span className="material-symbols-outlined text-4xl">cloud_upload</span>
                <p className="text-sm font-medium">No uploads found</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-20">ID</th>
                    <th className="min-w-[220px] max-w-[380px]">Items</th>
                    <th className="w-24">Items</th>
                    <th className="w-32">Total Value</th>
                    <th className="w-32">Status</th>
                    <th className="w-40">Created</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((upload) => {
                    const itemsSummary = formatRequestItemNamesList(upload);
                    const statusColor = getStatusColor(upload.current_status);
                    const statusDot = STATUS_DOT[upload.current_status] ?? 'bg-slate-400';
                    return (
                      <tr key={upload.request_id} onClick={() => onRowNavigate(upload)}>
                        <td>
                          <span className="font-mono text-xs font-semibold text-brand-blue bg-brand-blue/6 px-2 py-0.5 rounded">
                            #{upload.request_id}
                          </span>
                        </td>
                        <td className="max-w-[380px]" title={itemsSummary || undefined}>
                          <span className="line-clamp-2 break-words text-xs text-slate-600 leading-snug">
                            {itemsSummary || '—'}
                          </span>
                        </td>
                        <td className="text-xs text-slate-600 font-medium tabular-nums">
                          {upload.items?.length ?? 0}
                        </td>
                        <td className="text-sm font-bold text-brand-blue tabular-nums">
                          £{Number(upload.negotiated_grand_total_gbp)?.toFixed(2) || '0.00'}
                        </td>
                        <td>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${statusColor}`}>
                            <span className={`size-1.5 rounded-full ${statusDot}`} />
                            {formatStatus(upload.current_status)}
                          </span>
                        </td>
                        <td className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatCreatedAt(upload.created_at)}
                        </td>
                        <td>
                          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 shrink-0 flex items-center justify-between">
            <p className="text-xs text-slate-500 font-medium">
              Showing <span className="font-semibold text-slate-700">{uploads.length}</span> result{uploads.length !== 1 ? 's' : ''}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default UploadsOverview;
