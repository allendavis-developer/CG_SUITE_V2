import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import { useNotification } from "@/contexts/NotificationContext";
import { fetchRepricingSessionDetail, updateRepricingSession } from "@/services/api";
import { formatMoney, getResearchMedian } from "./utils/repricingDisplay";
import { SPREADSHEET_TABLE_STYLES } from "./spreadsheetTableStyles";
import { TableCheckbox } from "@/components/ui/components";
import { attachBarcodesFromSessionItems } from "./utils/repricingSessionMapping";

/** Listing title as shown on NosPos (from saved lookup / Quick Reprice metadata), not the reprice-list label. */
function resolveNosposListingName(sessionData, lineItem) {
  if (!sessionData || !lineItem) return '';
  const id = String(lineItem.item_identifier || '').trim();
  if (!id) return '';
  const cartItem = (sessionData.items || []).find((it) => String(it.id) === id);
  if (!cartItem) return '';

  const stockBc = (lineItem.stock_barcode || '').trim();
  if (stockBc) {
    const fromPreset = (cartItem.nosposBarcodes || []).find(
      (b) => b && String(b.barserial || '').trim() === stockBc
    );
    if (fromPreset?.name && String(fromPreset.name).trim()) return String(fromPreset.name).trim();
  }

  const typedBarcodes = sessionData.barcodes?.[cartItem.id];
  if (Array.isArray(typedBarcodes) && lineItem.barcode != null && lineItem.barcode !== '') {
    const idx = typedBarcodes.findIndex((c) => String(c).trim() === String(lineItem.barcode).trim());
    if (idx >= 0) {
      const lookup = sessionData.nosposLookups?.[`${cartItem.id}_${idx}`];
      const name = lookup?.stockName;
      if (name && String(name).trim()) return String(name).trim();
    }
  }
  return '';
}

/** Research / list label: eBay or CC search term and saved display fields, then persisted list title. */
function resolveResearchListName(lineItem) {
  if (!lineItem) return '';
  const raw = lineItem.raw_data;
  if (raw && typeof raw === 'object') {
    const t = raw.searchTerm || raw.display_title || raw.title;
    if (t != null && String(t).trim()) return String(t).trim();
  }
  const cc = lineItem.cash_converters_data;
  if (cc && typeof cc === 'object') {
    const t = cc.searchTerm || cc.display_title || cc.title;
    if (t != null && String(t).trim()) return String(t).trim();
  }
  return (lineItem.title || '').trim();
}

const RepricingSessionView = () => {
  const navigate = useNavigate();
  const { repricingSessionId } = useParams();
  const { showNotification } = useNotification();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());

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

  const getNosposId = (stockUrl) => {
    if (!stockUrl) return "";
    try {
      const url = new URL(stockUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("stock");
      if (idx !== -1 && parts[idx + 1]) {
        const candidate = parts[idx + 1];
        // Only return valid numeric NosPos stock IDs — reject path segments like 'search' or 'edit'
        return /^\d+$/.test(candidate) ? candidate : "";
      }
      return "";
    } catch {
      return "";
    }
  };

  const handlePrintNewBarcodes = () => {
    const items = session.items || [];
    const hasSelection = selectedItemIds && selectedItemIds.size > 0;

    const ids = Array.from(
      new Set(
        items
          .filter((item) =>
            !hasSelection || selectedItemIds.has(item.repricing_session_item_id)
          )
          .map((item) => getNosposId(item.stock_url))
          .filter((id) => id && id.trim() !== "")
      )
    );

    if (!ids.length) {
      return;
    }

    const stockIdsParam = encodeURIComponent(ids.join(","));
    const url = `https://nospos.com/print/barcode?stock_ids=${stockIdsParam}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <style>{SPREADSHEET_TABLE_STYLES}</style>

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

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handlePrintNewBarcodes}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-xs uppercase tracking-wide transition-all hover:shadow-md"
                  style={{ backgroundColor: 'var(--brand-blue)', color: 'white', border: 'none' }}
                >
                  <span className="material-symbols-outlined text-base">print</span>
                  {selectedItemIds.size > 0 ? "Print Selected Barcodes" : "Print All Barcodes"}
                </button>
                {session.session_data?.items?.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const rawItems = session.session_data.items;
                      const items = attachBarcodesFromSessionItems(rawItems, session.items, { mergeExisting: false });
                      try {
                        await updateRepricingSession(session.repricing_session_id, { status: 'IN_PROGRESS' });
                      } catch {}
                      navigate('/repricing', {
                        state: {
                          cartItems: items,
                          sessionId: session.repricing_session_id,
                          sessionBarcodes: session.session_data?.barcodes || null,
                          sessionNosposLookups: session.session_data?.nosposLookups || null,
                        },
                      });
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-xs uppercase tracking-wide transition-all hover:shadow-md border"
                    style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)', background: 'white' }}
                  >
                    <span className="material-symbols-outlined text-base">refresh</span>
                    Redo Repricing
                  </button>
                )}
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Session ID</p>
                  <p className="text-lg font-bold" style={{ color: 'var(--brand-blue)' }}>#{session.repricing_session_id}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full spreadsheet-table border-collapse text-left">
              <thead>
                <tr>
                  <th className="w-8">
                    <TableCheckbox
                      aria-label="Select all rows"
                      checked={
                        (session.items || []).length > 0 &&
                        selectedItemIds.size === (session.items || []).length
                      }
                      indeterminate={
                        selectedItemIds.size > 0 &&
                        selectedItemIds.size < (session.items || []).length
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedItemIds(
                            new Set(
                              (session.items || []).map(
                                (item) => item.repricing_session_item_id
                              )
                            )
                          );
                        } else {
                          setSelectedItemIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="min-w-[180px]">NoSpos listing</th>
                  <th className="min-w-[180px]">Research / list</th>
                  <th className="w-40">Typed Barcode</th>
                  <th className="w-40">Stock Barcode</th>
                  <th className="w-28">NoSPos ID</th>
                  <th className="w-28">Old Retail</th>
                  <th className="w-28">New Retail</th>
                  <th className="w-28 spreadsheet-th-cex">Sell</th>
                  <th className="w-28">eBay</th>
                  <th className="w-32">Cash Converters</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {(session.items || []).map((item) => (
                  <tr key={item.repricing_session_item_id}>
                    <td>
                      <TableCheckbox
                        aria-label="Select row"
                        checked={selectedItemIds.has(item.repricing_session_item_id)}
                        onChange={(e) => {
                          setSelectedItemIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(item.repricing_session_item_id);
                            } else {
                              next.delete(item.repricing_session_item_id);
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>
                      <div className="font-bold text-[13px] leading-snug" style={{ color: 'var(--brand-blue)' }}>
                        {resolveNosposListingName(session.session_data, item) || '—'}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold text-[13px] leading-snug text-slate-800">
                        {resolveResearchListName(item) || '—'}
                      </div>
                    </td>
                    <td className="font-mono font-semibold">{item.barcode}</td>
                    <td className="font-mono font-semibold">{item.stock_barcode || item.barcode || 'N/A'}</td>
                    <td className="font-mono font-semibold">
                      {item.stock_url ? (
                        <a
                          href={item.stock_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted"
                          title={item.stock_url}
                        >
                          {getNosposId(item.stock_url) || '—'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="font-semibold">{formatMoney(item.old_retail_price)}</td>
                    <td className="font-semibold text-emerald-700">
                      {formatMoney(item.new_retail_price ?? item.our_sale_price_at_repricing)}
                    </td>
                    <td className="font-semibold text-red-700">{formatMoney(item.cex_sell_at_repricing)}</td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getResearchMedian(item.raw_data)}</span>
                        <button
                          className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${!hasSavedState(item.raw_data) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
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
                          style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
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
