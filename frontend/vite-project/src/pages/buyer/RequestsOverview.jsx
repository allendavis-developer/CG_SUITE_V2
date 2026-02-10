import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '@/contexts/NotificationContext';
import { API_BASE_URL } from '@/services/api';
import { Header, Icon, CustomDropdown } from '@/components/ui/components';

const RequestsOverview = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL');

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      setError(null);
      try {
        let url = `${API_BASE_URL}/requests/overview/`;
        if (filterStatus !== 'ALL') {
          url += `?status=${filterStatus}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setRequests(data);
      } catch (err) {
        console.error("Error fetching requests:", err);
        setError(err.message);
        showNotification(`Failed to load requests: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [filterStatus, showNotification]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'OPEN': 
        return 'bg-blue-600/10 text-blue-600';
      case 'BOOKED_FOR_TESTING': 
        return 'bg-amber-600/10 text-amber-600'; // Changed color for 'TESTING'
      case 'TESTING':
        return 'bg-amber-600/10 text-amber-600';
      case 'CANCELLED': 
        return 'bg-red-500/10 text-red-500';
      case 'TESTING_COMPLETE': 
        return 'bg-purple-600/10 text-purple-600';
      default: 
        return 'bg-gray-600/10 text-gray-600';
    }
  };

  const formatStatus = (status) => {
    if (status === 'BOOKED_FOR_TESTING') {
      return 'Testing';
    }
    return status.replace(/_/g, ' ');
  };

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatIntent = (intent) => {
    switch (intent) {
      case 'DIRECT_SALE':
        return 'Direct Sale';
      case 'BUYBACK':
        return 'Buy Back';
      case 'STORE_CREDIT':
        return 'Store Credit';
      default:
        return intent.replace(/_/g, ' ');
    }
  };

  const getFilterTitle = (status) => {
    switch (status) {
      case 'ALL':
        return 'All Requests';
      case 'OPEN':
        return 'Open Requests';
      case 'BOOKED_FOR_TESTING':
        return 'Booked For Testing';
      case 'CANCELLED':
        return 'Cancelled Requests';
      case 'TESTING_COMPLETE':
        return 'Completed Requests';
      default:
        return 'Requests';
    }
  };

  // Calculate stats
  const stats = {
    total: requests.filter(r => r.current_status === 'OPEN').length,
    booked: requests.filter(r => r.current_status === 'BOOKED_FOR_TESTING').length,
    completed: requests.filter(r => r.current_status === 'TESTING_COMPLETE').length,
  };

  // Filter requests by search query
  const filteredRequests = requests;

  // Calculate total grand value
  const totalGrandValue = filteredRequests.reduce((sum, request) => {
    return sum + (Number(request.negotiated_grand_total_gbp) || 0);
  }, 0);

  if (loading) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <p className="text-gray-600 font-semibold">Loading requests...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-50 min-h-screen flex items-center justify-center">
        <p className="text-red-600 font-semibold">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <style>{`
        .material-symbols-outlined { font-size: 20px; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #144584; }
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

      {/* Header */}
      <Header />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
        {/* Sidebar */}
        <aside className="w-64 bg-blue-900 flex flex-col shrink-0">
          <div className="p-6 space-y-8">
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">Main Menu</h3>
              <nav className="space-y-1">
                <a 
                  className="flex items-center gap-3 text-white py-2 bg-white/10 rounded-lg px-3 -mx-3 cursor-pointer"
                  onClick={() => navigate('/requests-overview')}
                >
                  <span className="material-symbols-outlined text-sm text-amber-400">receipt_long</span>
                  <span className="text-sm font-bold">Overview</span>
                </a>
              </nav>
            </div>
            <div>
              <h3 className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-4">Today's Stats</h3>
              <div className="space-y-4">
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Open Requests</p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.total}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Booked / Total</p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.booked} / {requests.length}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Completed</p>
                  <p className="text-xl font-extrabold text-white mt-1">{stats.completed}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-auto p-6 border-t border-white/10">
            <button className="w-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white py-3 rounded-lg flex items-center justify-center gap-2 transition-all">
              <span className="material-symbols-outlined text-sm">logout</span>
              <span className="text-xs font-bold uppercase tracking-wider">Logout</span>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-200 bg-white">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-extrabold text-blue-900">{getFilterTitle(filterStatus)}</h1>
              <span className="bg-blue-900/10 text-blue-900 text-[11px] font-black px-2.5 py-0.5 rounded-full">
                {filteredRequests.length} TOTAL
              </span>
              <span className="bg-blue-900/10 text-blue-900 text-[11px] font-black px-2.5 py-0.5 rounded-full">
                £{totalGrandValue.toFixed(2)} VALUE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CustomDropdown
                label=""
                value={getFilterTitle(filterStatus)}
                options={['ALL', 'OPEN', 'BOOKED_FOR_TESTING', 'TESTING_COMPLETE']}
                onChange={(value) => setFilterStatus(value)}
              />
              <button 
                className="flex items-center gap-2 px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition-colors font-bold"
                onClick={() => navigate('/buyer')}
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span>New Request</span>
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            {filteredRequests.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500 font-semibold">No requests found.</p>
              </div>
            ) : (
              <table className="w-full data-table border-collapse text-left">
                <thead>
                  <tr>
                    <th className="w-24">ID</th>
                    <th className="min-w-[200px]">Customer Name</th>
                    <th className="w-32">Intent</th>
                    <th className="w-32">Item Count</th>
                    <th className="w-40">Total Value</th>
                    <th className="w-32">Status</th>
                    <th className="w-40">Created At</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {filteredRequests.map((requestItem) => (
                    <tr key={requestItem.request_id} onClick={() => navigate(`/requests/${requestItem.request_id}/view`)}>
                      <td className="font-bold text-gray-600">#{requestItem.request_id}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-blue-900 text-[11px]">
                            {getInitials(requestItem.customer_details.name)}
                          </div>
                          <div className="font-bold text-blue-900 text-[13px]">
                            {requestItem.customer_details.name}
                          </div>
                        </div>
                      </td>
                      <td className="font-semibold text-gray-600">{formatIntent(requestItem.intent)}</td>
                      <td className="font-semibold">{requestItem.items.length} Item{requestItem.items.length !== 1 ? 's' : ''}</td>
                      <td className="font-bold text-blue-900 text-[13px]">£{Number(requestItem.negotiated_grand_total_gbp)?.toFixed(2) || '0.00'}</td>
                      <td>
                        <span className={`status-pill ${getStatusColor(requestItem.current_status)}`}>
                          {formatStatus(requestItem.current_status === 'BOOKED_FOR_TESTING' ? 'TESTING' : requestItem.current_status)}
                        </span>
                      </td>
                      <td className="text-gray-600">
                        {new Date(requestItem.created_at).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </td>
                      <td className="text-right">
                        <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-200 bg-slate-50 flex items-center justify-between">
            <p className="text-[11px] text-gray-600 font-bold uppercase tracking-widest">
              Showing {filteredRequests.length} of {requests.length} results
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default RequestsOverview;