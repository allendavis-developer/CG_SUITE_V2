import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import EbayResearchForm from "@/components/forms/EbayResearchForm";
import CashConvertersResearchForm from "@/components/forms/CashConvertersResearchForm";
import CashGeneratorResearchForm from "@/components/forms/CashGeneratorResearchForm";
import { useNotification } from "@/contexts/NotificationContext";
import { fetchUploadSessionDetail, updateUploadSession } from "@/services/api";
import { formatMoney, getResearchMedian } from "./utils/repricingDisplay";
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import { TableCheckbox } from "@/components/ui/components";
import { attachBarcodesFromSessionItems } from "./utils/repricingSessionMapping";

/** Listing title as shown on NosPos (from saved lookup metadata), not the workspace list label. */
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
  const cg = lineItem.cg_data;
  if (cg && typeof cg === 'object') {
    const t = cg.searchTerm || cg.display_title || cg.title;
    if (t != null && String(t).trim()) return String(t).trim();
  }
  return (lineItem.title || '').trim();
}

const UploadSessionView = () => {
  const navigate = useNavigate();
  const { uploadSessionId } = useParams();
  const { showNotification } = useNotification();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [researchItem, setResearchItem] = useState(null);
  const [cashConvertersResearchItem, setCashConvertersResearchItem] = useState(null);
  const [cgResearchItem, setCgResearchItem] = useState(null);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());

  const hasSavedState = (data) => !!(data && typeof data === "object" && Object.keys(data).length > 0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchUploadSessionDetail(uploadSessionId);
        setSession(data);
      } catch (err) {
        showNotification(`Failed to load upload session: ${err.message}`, "error");
        navigate('/upload-overview', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [uploadSessionId, navigate, showNotification]);

  if (loading) {
    return (
      <div className="bg-ui-bg min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
          <span className="text-sm font-medium">Loading upload session…</span>
        </div>
      </div>
    );
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
        return /^\d+$/.test(candidate) ? candidate : "";
      }
      return "";
    } catch {
      return "";
    }
  };

  const resolveCexUrl = (sessionData, lineItem) => {
    const cartItem = (sessionData?.items || []).find(
      (i) => String(i.id) === String(lineItem.item_identifier)
    );
    return cartItem?.cexUrl || null;
  };

  const handlePrintNewBarcodes = () => {
    const items = session.items || [];
    const hasSelection = selectedItemIds && selectedItemIds.size > 0;

    const ids = Array.from(
      new Set(
        items
          .filter((item) =>
            !hasSelection || selectedItemIds.has(item.upload_session_item_id)
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

  const isChangedItem = (item) => {
    const oldP = parseFloat(item.old_retail_price);
    const newP = parseFloat(item.new_retail_price ?? item.our_sale_price_at_repricing);
    const rrpChanged = !isNaN(oldP) && !isNaN(newP) && Math.abs(oldP - newP) > 0.005;
    const nosposName = resolveNosposListingName(session.session_data, item);
    const nameChanged = Boolean(nosposName && item.title && nosposName !== item.title);
    return rrpChanged || nameChanged;
  };

  const handlePrintChangedBarcodes = () => {
    const changed = (session.items || []).filter(isChangedItem);
    const ids = Array.from(
      new Set(changed.map((item) => getNosposId(item.stock_url)).filter((id) => id && id.trim() !== ""))
    );
    if (!ids.length) return;
    window.open(
      `https://nospos.com/print/barcode?stock_ids=${encodeURIComponent(ids.join(','))}`,
      '_blank',
      'noopener'
    );
  };

  const uploadCategory = { name: "Upload", path: ["Upload"] };

  const changedItemsCount = (session.items || []).filter(isChangedItem).length;
  const isAuditMode = String(session.mode || '').toUpperCase() === 'AUDIT';

  return (
    <div className="bg-ui-bg text-text-main min-h-screen flex flex-col text-sm overflow-hidden">
      <style>{SPREADSHEET_TABLE_STYLES}</style>

      <AppHeader />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex-1 bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-white shrink-0">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/upload-overview')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 font-medium text-sm text-brand-blue hover:bg-brand-blue/5 hover:border-brand-blue/30 transition-colors"
                >
                  <span className="material-symbols-outlined text-[17px] leading-none">arrow_back</span>
                  Back
                </button>
                <div className="flex items-center gap-2.5 px-4 py-2 rounded-lg border border-brand-blue/15 bg-brand-blue/5">
                  <span className="material-symbols-outlined text-[18px] text-brand-blue">
                    {isAuditMode ? 'fact_check' : 'upload'}
                  </span>
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-brand-blue/60">
                      {isAuditMode ? 'Audit session' : 'Upload session'}
                    </p>
                    <p className="text-xs font-semibold text-brand-blue">
                      {session.item_count} item{session.item_count !== 1 ? 's' : ''} · {session.barcode_count} barcode{session.barcode_count !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {session.status === 'COMPLETED' && changedItemsCount > 0 && (
                  <button
                    type="button"
                    onClick={handlePrintChangedBarcodes}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-colors"
                  >
                    <span className="material-symbols-outlined text-[17px] leading-none">print</span>
                    Print Changed Barcodes ({changedItemsCount})
                  </button>
                )}
                {!isAuditMode && (
                  <button
                    type="button"
                    onClick={handlePrintNewBarcodes}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-blue hover:bg-brand-blue-hover text-white font-semibold text-sm shadow-sm transition-colors"
                  >
                    <span className="material-symbols-outlined text-[17px] leading-none">print</span>
                    {selectedItemIds.size > 0 ? 'Print selected' : 'Print all barcodes'}
                  </button>
                )}
                {session.session_data?.items?.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const rawItems = session.session_data.items;
                      const items = attachBarcodesFromSessionItems(rawItems, session.items, { mergeExisting: false });
                      try {
                        await updateUploadSession(session.upload_session_id, { status: 'IN_PROGRESS' });
                      } catch {}
                      navigate('/upload', {
                        state: {
                          cartItems: items,
                          sessionId: session.upload_session_id,
                          sessionBarcodes: session.session_data?.barcodes || null,
                          sessionNosposLookups: session.session_data?.nosposLookups || null,
                          uploadBarcodeWorkspace: session.session_data?.uploadBarcodeWorkspace || null,
                          uploadBarcodeIntakeOpen: session.session_data?.uploadBarcodeIntakeOpen,
                          uploadStockDetailsBySlotId: session.session_data?.uploadStockDetailsBySlotId || null,
                          uploadScanSlotIds: session.session_data?.uploadScanSlotIds,
                          uploadPendingSlotIds: session.session_data?.uploadPendingSlotIds,
                          uploadBarcodeIntakeDone: session.session_data?.uploadBarcodeIntakeDone,
                          ...(isAuditMode
                            ? {
                                uploadAuditMode: true,
                                auditQueue: session.session_data?.auditQueue || null,
                              }
                            : {}),
                        },
                      });
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-brand-blue/20 text-brand-blue bg-white hover:bg-brand-blue/5 font-semibold text-sm transition-colors"
                  >
                    <span className="material-symbols-outlined text-[17px] leading-none">edit_note</span>
                    {isAuditMode
                      ? (session.status === 'COMPLETED' ? 'Resume audit' : 'Continue audit')
                      : (session.status === 'COMPLETED' ? 'Resume in workspace' : 'Continue upload')}
                  </button>
                )}
                <div className="pl-2 border-l border-slate-200 ml-1">
                  <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Session ID</p>
                  <p className="text-sm font-bold text-brand-blue tabular-nums">#{session.upload_session_id}</p>
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
                                (item) => item.upload_session_item_id
                              )
                            )
                          );
                        } else {
                          setSelectedItemIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="min-w-[180px]">NosPos item name</th>
                  <th className="min-w-[180px]">Uploaded item name</th>
                  <th className="w-40">Stock Barcode</th>
                  <th className="w-28">NoSPos ID</th>
                  <th className="w-28">Old Retail</th>
                  <th className="w-28">New Retail</th>
                  <th className="w-28 spreadsheet-th-cex">Sell</th>
                  <th className="w-24 px-1 text-left">eBay</th>
                  <th className="w-24 px-1 text-left">CC</th>
                  <th className="w-24 px-1 text-left">CG</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {(session.items || []).map((item) => (
                  <tr key={item.upload_session_item_id}>
                    <td>
                      <TableCheckbox
                        aria-label="Select row"
                        checked={selectedItemIds.has(item.upload_session_item_id)}
                        onChange={(e) => {
                          setSelectedItemIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(item.upload_session_item_id);
                            } else {
                              next.delete(item.upload_session_item_id);
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>
                      <div className="font-semibold text-xs text-brand-blue leading-snug">
                        {resolveNosposListingName(session.session_data, item) || '—'}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold text-[13px] leading-snug text-slate-800">
                        {item.title || '—'}
                      </div>
                    </td>
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
                    <td className="font-semibold text-red-700">
                      {(() => {
                        const cexUrl = resolveCexUrl(session.session_data, item);
                        const val = formatMoney(item.cex_sell_at_repricing);
                        return cexUrl ? (
                          <a href={cexUrl} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">
                            {val}
                          </a>
                        ) : (
                          val
                        );
                      })()}
                    </td>
                    <td className="px-1 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <span className="min-w-0 text-right font-semibold tabular-nums">{getResearchMedian(item.raw_data)}</span>
                        <button
                          type="button"
                          className={`flex items-center justify-center size-7 rounded bg-brand-orange text-brand-blue transition-colors shrink-0 hover:bg-brand-orange-hover ${!hasSavedState(item.raw_data) ? 'opacity-40 cursor-not-allowed' : ''}`}
                          onClick={() => hasSavedState(item.raw_data) && setResearchItem(item)}
                          title={hasSavedState(item.raw_data) ? 'View eBay research (read-only)' : 'No research available'}
                          disabled={!hasSavedState(item.raw_data)}
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none">search_insights</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-1 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <span className="min-w-0 text-right font-semibold tabular-nums">{getResearchMedian(item.cash_converters_data)}</span>
                        <button
                          type="button"
                          className={`flex items-center justify-center size-7 rounded bg-brand-orange text-brand-blue transition-colors shrink-0 hover:bg-brand-orange-hover ${!hasSavedState(item.cash_converters_data) ? 'opacity-40 cursor-not-allowed' : ''}`}
                          onClick={() => hasSavedState(item.cash_converters_data) && setCashConvertersResearchItem(item)}
                          title={hasSavedState(item.cash_converters_data) ? 'View CC research (read-only)' : 'No research available'}
                          disabled={!hasSavedState(item.cash_converters_data)}
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none">search_insights</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-1 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <span className="min-w-0 text-right font-semibold tabular-nums">{getResearchMedian(item.cg_data)}</span>
                        <button
                          type="button"
                          className={`flex items-center justify-center size-7 rounded bg-brand-orange text-brand-blue transition-colors shrink-0 hover:bg-brand-orange-hover ${!hasSavedState(item.cg_data) ? 'opacity-40 cursor-not-allowed' : ''}`}
                          onClick={() => hasSavedState(item.cg_data) && setCgResearchItem(item)}
                          title={hasSavedState(item.cg_data) ? 'View CG research (read-only)' : 'No research available'}
                          disabled={!hasSavedState(item.cg_data)}
                        >
                          <span className="material-symbols-outlined text-[15px] leading-none">search_insights</span>
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
          category={uploadCategory}
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
          category={uploadCategory}
          savedState={cashConvertersResearchItem.cash_converters_data}
          onComplete={() => setCashConvertersResearchItem(null)}
          initialHistogramState={true}
          readOnly={true}
          showManualOffer={false}
        />
      )}

      {cgResearchItem && (
        <CashGeneratorResearchForm
          mode="modal"
          category={uploadCategory}
          savedState={cgResearchItem.cg_data}
          onComplete={() => setCgResearchItem(null)}
          initialHistogramState={true}
          readOnly={true}
          showManualOffer={false}
        />
      )}
    </div>
  );
};

export default UploadSessionView;
