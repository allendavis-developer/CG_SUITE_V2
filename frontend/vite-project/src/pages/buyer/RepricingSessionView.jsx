import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import { useNotification } from "@/contexts/NotificationContext";
import { fetchRepricingSessionDetail } from "@/services/api";
import { formatMoney, getResearchMedian } from "./utils/repricingDisplay";

const RepricingSessionView = () => {
  const navigate = useNavigate();
  const { repricingSessionId } = useParams();
  const { showNotification } = useNotification();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);

  const hasSavedState = (data) => !!(data && typeof data === "object" && Object.keys(data).length > 0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchRepricingSessionDetail(repricingSessionId);
        setSession(data);
      } catch (err) {
        showNotification(`Failed to load repricing session: ${err.message}`, "error");
        navigate('/repricing-overview', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [repricingSessionId, navigate, showNotification]);

  if (loading) {
    return <div className="bg-gray-50 min-h-screen flex items-center justify-center"><p className="text-gray-600 font-semibold">Loading repricing session...</p></div>;
  }

  if (!session) return null;

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <style>{`
        :root {
          --brand-blue: #144584;
          --ui-border: #e5e7eb;
          --text-muted: #64748b;
          --ui-bg: #f8f9fa;
          --text-main: #1a1a1a;
        }
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
        .spreadsheet-table td {
          padding: 0.5rem 0.75rem;
          border-right: 1px solid var(--ui-border);
          vertical-align: middle;
        }
        .spreadsheet-table tr {
          border-bottom: 1px solid var(--ui-border);
        }
      `}</style>

      <AppHeader />

      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="p-6 border-b" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex items-center justify-between gap-6">
              <button
                onClick={() => navigate('/repricing-overview')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all hover:shadow-md"
                style={{ borderColor: 'var(--ui-border)', color: 'var(--brand-blue)' }}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Back to Repricing
              </button>

              <div className="flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ borderColor: 'rgba(20,69,132,0.2)', background: 'rgba(20,69,132,0.03)' }}>
                <span className="material-symbols-outlined text-2xl" style={{ color: 'var(--brand-blue)' }}>sell</span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>Repricing Session</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {session.item_count} item{session.item_count !== 1 ? 's' : ''}, {session.barcode_count} barcode{session.barcode_count !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Session ID</p>
                <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>#{session.repricing_session_id}</p>
              </div>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full spreadsheet-table border-collapse text-left">
              <thead>
                <tr>
                  <th className="min-w-[220px]">Item</th>
                  <th className="w-40">Typed Barcode</th>
                  <th className="w-40">Stock Barcode</th>
                  <th className="w-28">Old Retail</th>
                  <th className="w-28">New Sale Price</th>
                  <th className="w-28">CeX Sell</th>
                  <th className="w-28">eBay</th>
                  <th className="w-32">Cash Converters</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {(session.items || []).map((item) => (
                  <tr key={item.repricing_session_item_id}>
                    <td>
                      <div className="font-bold text-[13px]" style={{ color: 'var(--brand-blue)' }}>{item.title || 'N/A'}</div>
                    </td>
                    <td className="font-mono font-semibold">{item.barcode}</td>
                    <td className="font-mono font-semibold">{item.stock_barcode || item.barcode || 'N/A'}</td>
                    <td className="font-semibold">{formatMoney(item.old_retail_price)}</td>
                    <td className="font-semibold text-emerald-700">{formatMoney(item.new_retail_price ?? item.our_sale_price_at_repricing)}</td>
                    <td className="font-semibold text-blue-800">{formatMoney(item.cex_sell_at_repricing)}</td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getResearchMedian(item.raw_data)}</span>
                        <button
                          className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!hasSavedState(item.raw_data) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          style={{ background: '#f7b918', color: '#144584' }}
                          onClick={() => hasSavedState(item.raw_data) && setResearchItem(item)}
                          title={hasSavedState(item.raw_data) ? 'View eBay Research (Read-only)' : 'No research available'}
                          disabled={!hasSavedState(item.raw_data)}
                        >
                          <span className="material-symbols-outlined text-[16px]">search_insights</span>
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getResearchMedian(item.cash_converters_data)}</span>
                        <button
                          className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!hasSavedState(item.cash_converters_data) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          style={{ background: '#f7b918', color: '#144584' }}
                          onClick={() => hasSavedState(item.cash_converters_data) && setCashConvertersResearchItem(item)}
                          title={hasSavedState(item.cash_converters_data) ? 'View Cash Converters Research (Read-only)' : 'No research available'}
                          disabled={!hasSavedState(item.cash_converters_data)}
                        >
                          <span className="material-symbols-outlined text-[16px]">store</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {researchItem && (
        <EbayResearchForm
          mode="modal"
          category={{ name: "Repricing", path: ["Repricing"] }}
          savedState={researchItem.raw_data}
          onComplete={() => setResearchItem(null)}
          initialHistogramState={true}
          readOnly={true}
          showManualOffer={false}
        />
      )}

      {cashConvertersResearchItem && (
        <CashConvertersResearchForm
          mode="modal"
          category={{ name: "Repricing", path: ["Repricing"] }}
          savedState={cashConvertersResearchItem.cash_converters_data}
          onComplete={() => setCashConvertersResearchItem(null)}
          initialHistogramState={true}
          readOnly={true}
          showManualOffer={false}
        />
      )}
    </div>
  );
};

export default RepricingSessionView;
