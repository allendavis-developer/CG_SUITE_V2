import React from 'react';
import TinyModal from '@/components/ui/TinyModal';
import JewelleryReferencePricesTable from './JewelleryReferencePricesTable';

/**
 * Shared modal for Mastermelt reference prices (view-only snapshot — same as request overview).
 */
export default function JewelleryReferencePricesModal({ open, onClose, sections }) {
  if (!open) return null;
  return (
    <TinyModal
      title="Jewellery reference table"
      zClass="z-[220]"
      panelClassName="!max-w-5xl !h-[min(92vh,860px)]"
      onClose={onClose}
    >
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
