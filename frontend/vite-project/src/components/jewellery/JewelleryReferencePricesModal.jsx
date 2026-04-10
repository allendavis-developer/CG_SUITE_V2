import React from 'react';
import TinyModal from '@/components/ui/TinyModal';
import JewelleryReferencePricesTable from './JewelleryReferencePricesTable';

function jewelleryScrapeTimestampUi(rawValue) {
  if (!rawValue) return null;
  const dt = new Date(rawValue);
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date();
  const stale =
    dt.getFullYear() !== now.getFullYear() ||
    dt.getMonth() !== now.getMonth() ||
    dt.getDate() !== now.getDate();
  return {
    stale,
    title: `Reference scraped: ${dt.toLocaleString()}`,
    label: dt.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

/**
 * Shared modal for Mastermelt reference prices (view-only snapshot — same as request overview).
 */
export default function JewelleryReferencePricesModal({ open, onClose, sections, scrapedAt = null }) {
  if (!open) return null;
  const stampUi = jewelleryScrapeTimestampUi(scrapedAt);
  return (
    <TinyModal
      title="Jewellery reference table"
      zClass="z-[220]"
      panelClassName="!max-w-5xl !h-[min(92vh,860px)]"
      onClose={onClose}
    >
      {stampUi ? (
        <div className="mb-2 flex items-center justify-end">
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-bold tracking-wide ${
              stampUi.stale
                ? 'animate-[pulse_0.32s_ease-in-out_infinite] border-red-300 bg-red-50 text-red-700'
                : 'border-emerald-300 bg-emerald-50 text-emerald-700'
            }`}
            title={stampUi.title}
          >
            Scraped {stampUi.label}
          </span>
        </div>
      ) : null}
      <JewelleryReferencePricesTable
        sections={sections || []}
        showLineItems={false}
        defaultOpen={true}
        hideToggle={true}
        title="Reference prices (saved snapshot)"
      />
    </TinyModal>
  );
}
