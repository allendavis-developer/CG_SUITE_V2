import React, { useEffect, useState } from "react";
import { Header } from "@/components/ui/components";
import { fetchAllRequests } from "@/services/api"; // Will create this

const AllRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRequestId, setExpandedRequestId] = useState(null);

  useEffect(() => {
    const getRequests = async () => {
      try {
        setLoading(true);
        const data = await fetchAllRequests();
        setRequests(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    getRequests();
  }, []);

  const toggleExpand = (requestId) => {
    setExpandedRequestId(prevId => (prevId === requestId ? null : requestId));
  };

  if (loading) {
    return (
      <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
        <Header userName="JD" />
        <main className="flex-1 p-6">
          <p>Loading requests...</p>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
        <Header userName="JD" />
        <main className="flex-1 p-6">
          <p className="text-red-500">Error: {error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        :root {
          --brand-blue: #144584;
          --brand-blue-hover: #0d315e;
          --brand-orange: #f7b918;
          --brand-orange-hover: #e5ab14;
          --ui-bg: #f8f9fa;
          --ui-card: #ffffff;
          --ui-border: #e5e7eb;
          --text-main: #1a1a1a;
          --text-muted: #64748b;
        }
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #144584; }
        .spreadsheet-table th {
          background: var(--brand-blue);
          color: white;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.75rem;
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .spreadsheet-table th:last-child {
          border-right: 0;
        }
        .spreadsheet-table td {
          padding: 0.5rem 0.75rem;
          border-right: 1px solid var(--ui-border);
          vertical-align: middle;
        }
        .spreadsheet-table td:last-child {
          border-right: 0;
        }
        .spreadsheet-table tr {
          border-bottom: 1px solid var(--ui-border);
        }
        .spreadsheet-table tr:hover {
          background: rgba(20, 69, 132, 0.05);
        }
      `}</style>
      <Header userName="JD" /> {/* Placeholder user name */}
      <main className="flex-1 p-6 overflow-auto">
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--brand-blue)' }}>All Customer Requests</h1>

        {/* Filter/Search Bar - Placeholder */}
        <div className="mb-4 p-4 border rounded-lg bg-white" style={{ borderColor: 'var(--ui-border)' }}>
          <input
            type="text"
            placeholder="Search requests by ID, customer name, or status..."
            className="w-full p-2 border rounded-md"
            style={{ borderColor: 'var(--ui-border)' }}
          />
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full spreadsheet-table border-collapse text-left">
            <thead>
              <tr>
                <th className="w-20">ID</th>
                <th className="min-w-[150px]">Customer Name</th>
                <th className="w-32">Status</th>
                <th className="w-32">Type</th>
                <th className="w-32">Total Offer</th>
                <th className="w-16 text-center">Details</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <React.Fragment key={request.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="font-bold" style={{ color: 'var(--brand-blue)' }}>#{request.id}</td>
                    <td>{request.customer_name || 'N/A'}</td>
                    <td>{request.status?.replace(/_/g, ' ') || 'N/A'}</td>
                    <td>{request.intent?.replace(/_/g, ' ') || 'N/A'}</td>
                    <td>£{request.total_offer_price?.toFixed(2) || '0.00'}</td>
                    <td className="text-center">
                      <button
                        onClick={() => toggleExpand(request.id)}
                        className="p-1 rounded-full hover:bg-gray-200 transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">
                          {expandedRequestId === request.id ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {expandedRequestId === request.id && (
                    <tr>
                      <td colSpan="6" className="p-4 bg-gray-50 border-t">
                        <div className="space-y-4">
                          <p><strong>Customer Email:</strong> {request.customer_email || 'N/A'}</p>
                          <p><strong>Customer Phone:</strong> {request.customer_phone_number || 'N/A'}</p>
                          <h3 className="font-semibold mt-4">Items:</h3>
                          {request.items && request.items.length > 0 ? (
                            <div className="space-y-3 pl-4">
                              {request.items.map(item => (
                                <div key={item.id} className="border-l-2 border-brand-blue pl-3">
                                  <p><strong>{item.variant_name || 'N/A'}</strong></p>
                                  <p className="text-xs text-gray-600">Customer Expectation: £{item.customer_expectation_gbp?.toFixed(2) || '0.00'}</p>
                                  {item.raw_data && (
                                    <div className="mt-2 text-xs bg-gray-100 p-2 rounded-md font-mono overflow-auto max-h-40">
                                      <p><strong>Raw eBay Data:</strong></p>
                                      <pre>{JSON.stringify(item.raw_data, null, 2)}</pre>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="pl-4 text-gray-500">No items for this request.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls - Placeholder */}
        <div className="mt-6 flex justify-center items-center space-x-2 text-sm">
          <button className="px-3 py-1 border rounded-md hover:bg-gray-100">Previous</button>
          <span className="px-3 py-1 border rounded-md bg-brand-blue text-white">1</span>
          <button className="px-3 py-1 border rounded-md hover:bg-gray-100">2</button>
          <button className="px-3 py-1 border rounded-md hover:bg-gray-100">3</button>
          <button className="px-3 py-1 border rounded-md hover:bg-gray-100">Next</button>
        </div>
      </main>
    </div>
  );
};

export default AllRequests;
