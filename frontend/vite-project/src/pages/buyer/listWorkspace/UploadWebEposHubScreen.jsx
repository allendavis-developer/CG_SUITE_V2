import React, { useCallback, useMemo, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import NegotiationDocumentHead from '@/pages/buyer/components/negotiation/NegotiationDocumentHead';
import WebEposProductsTablePanel from '@/pages/buyer/components/WebEposProductsTablePanel';
import CloseListingsSoldCheckModal from '@/pages/buyer/components/CloseListingsSoldCheckModal';
import { extractWebEposBarserial } from '@/pages/buyer/webEposUploadConstants';
import { useNotification } from '@/contexts/NotificationContext';

/**
 * Upload landing: Web EPOS product snapshot + primary CTA to enter barcode / list workspace.
 */
export default function UploadWebEposHubScreen({
  copy,
  snapshot,
  scrapeError,
  onRetryScrape,
  onEnterUpload,
  onAuditBarcodes,
}) {
  const rows = useMemo(() => snapshot?.rows ?? [], [snapshot]);
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const [selectedBarcodes, setSelectedBarcodes] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [soldCheckOpen, setSoldCheckOpen] = useState(false);
  const [soldCheckQueue, setSoldCheckQueue] = useState([]);
  const [flaggedByBarserial, setFlaggedByBarserial] = useState({});
  const [closedBarserials, setClosedBarserials] = useState(() => new Set());
  const { showNotification } = useNotification();

  const handleAudit = () => {
    if (selectedBarcodes.length === 0 || !onAuditBarcodes) return;
    onAuditBarcodes(selectedBarcodes, selectedRows);
  };

  /**
   * Build the close-listings queue: prefer the current selection, else every scraped row.
   * Each entry is normalised to the `-timestamp`-stripped barserial the modal expects.
   */
  const handleOpenSoldCheck = useCallback(() => {
    const source = selectedRows.length > 0 ? selectedRows : rows;
    const queue = source
      .map((r) => ({
        barcode: extractWebEposBarserial(r.barcode || r.rawBarcode || ''),
        rawBarcode: r.rawBarcode || r.barcode || '',
        productName: r.productName || '',
        productHref: r.productHref || null,
      }))
      .filter((r) => r.barcode);
    if (queue.length === 0) {
      showNotification('No Web EPOS barcodes to check.', 'warning');
      return;
    }
    setFlaggedByBarserial({});
    setSoldCheckQueue(queue);
    setSoldCheckOpen(true);
  }, [rows, selectedRows, showNotification]);

  /** Merge each successful close into the running set so re-runs additively flag more rows as Closed. */
  const handleClosedChange = useCallback((set) => {
    if (!set) return;
    setClosedBarserials((prev) => {
      const next = new Set(prev);
      set.forEach((b) => next.add(b));
      return next;
    });
  }, []);

  const dangerByBarcode = useMemo(() => {
    // CloseListingsSoldCheckModal reports flagged rows keyed by barserial; the table panel
    // expects the same key shape, so we can forward the map as-is.
    return Object.keys(flaggedByBarserial).length > 0 ? flaggedByBarserial : null;
  }, [flaggedByBarserial]);

  return (
    <div className="flex min-h-screen flex-col overflow-hidden text-sm" style={{ background: '#f8f9fa', color: '#1a1a1a' }}>
      <NegotiationDocumentHead />
      <AppHeader
        buyerControls={{
          enabled: false,
          repricingWorkspace: true,
          reserveWorkspaceRightForRepriceRail: false,
          selectedCategory: null,
          onCategorySelect: () => {},
          onAddFromCeX: () => {},
          isCeXLoading: false,
          enableNegotiationItemBuilder: false,
          useVoucherOffers: false,
          onAddNegotiationItem: () => {},
          onEbayResearchComplete: () => {},
          cexProductData: null,
          setCexProductData: () => {},
          clearCexProduct: () => {},
          existingItems: [],
          showNotification: () => {},
        }}
      />
      <main className="w-full max-w-none flex-1 overflow-y-auto py-6 pl-2 pr-2 sm:pl-3 sm:pr-3 md:pl-4 md:pr-4">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="cg-section-title text-xl sm:text-2xl">{copy.uploadHubTitle}</h1>
              <button
                type="button"
                onClick={handleOpenSoldCheck}
                title={
                  selectedBarcodes.length > 0
                    ? `Check ${selectedBarcodes.length} selected row${selectedBarcodes.length === 1 ? '' : 's'} on NosPos for free-stock < 1`
                    : 'Check every row on NosPos for free-stock < 1'
                }
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1 text-xl font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 sm:text-2xl dark:border-slate-600 dark:bg-slate-800/40"
              >
                <span className="material-symbols-outlined text-[22px] sm:text-[26px]">remove_shopping_cart</span>
                Close listings for sold items
                {selectedBarcodes.length > 0 ? (
                  <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-bold tracking-normal text-brand-blue">
                    {selectedBarcodes.length}
                  </span>
                ) : null}
              </button>
            </div>
            <p className="cg-section-subtitle text-sm text-slate-600">{copy.uploadHubSubtitle}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:self-start">
            {selectedBarcodes.length > 0 && (
              <button
                type="button"
                onClick={handleAudit}
                className="flex min-h-[3.75rem] w-full items-center justify-center gap-2 rounded-2xl border-2 border-brand-blue px-7 py-4 text-lg font-black uppercase tracking-wide transition-all hover:bg-brand-blue/5 active:scale-[0.99] sm:min-h-[4rem] sm:w-auto sm:px-8"
                style={{ color: 'var(--brand-blue)' }}
              >
                <span className="material-symbols-outlined text-[28px]">fact_check</span>
                Audit ({selectedBarcodes.length})
              </button>
            )}
            <button
              type="button"
              onClick={onEnterUpload}
              className="flex w-full min-h-[3.75rem] shrink-0 items-center justify-center gap-3 self-stretch rounded-2xl px-7 py-4 text-lg font-black uppercase tracking-wide shadow-lg transition-all active:scale-[0.99] sm:min-h-[4rem] sm:w-auto sm:self-start sm:px-10 sm:py-4 sm:text-xl"
              style={{
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)',
                boxShadow: '0 12px 24px -6px rgba(247,185,24,0.45)',
              }}
            >
              <span className="material-symbols-outlined text-[32px] sm:text-[36px]">upload</span>
              {copy.uploadHubEnterButton}
            </button>
          </div>
        </div>

        {scrapeError ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{copy.uploadHubScrapeFailed}</p>
            <p className="mt-1 text-amber-800/90">{scrapeError}</p>
            {onRetryScrape ? (
              <button
                type="button"
                onClick={onRetryScrape}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900 transition-colors hover:bg-amber-100"
              >
                {copy.uploadHubRetrySync}
              </button>
            ) : null}
          </div>
        ) : null}

        <WebEposProductsTablePanel
          rows={rows}
          pagingText={snapshot?.pagingText ?? null}
          pageUrl={snapshot?.pageUrl ?? null}
          scrapedAt={snapshot?.scrapedAt ?? null}
          showSourceBlurb
          onSelectedBarcodes={setSelectedBarcodes}
          onSelectedRows={setSelectedRows}
          dangerByBarcode={dangerByBarcode}
          closedByBarcode={closedBarserials.size > 0 ? closedBarserials : null}
          emptyDetail={
            scrapeError && !hasRows ? (
              <p>{copy.uploadHubEmptyAfterError}</p>
            ) : !hasRows && !scrapeError ? (
              <p>{copy.uploadHubEmptyNoRows}</p>
            ) : null
          }
        />
      </main>

      {soldCheckOpen ? (
        <CloseListingsSoldCheckModal
          rows={soldCheckQueue}
          onClose={() => setSoldCheckOpen(false)}
          onFlaggedChange={setFlaggedByBarserial}
          onClosedChange={handleClosedChange}
          showNotification={showNotification}
        />
      ) : null}
    </div>
  );
}
