import React from 'react';
import { Modal } from '../ui/components';
import EbayResearchForm from '../forms/EbayResearchForm';

export default function EbayResearchModal({ open, onClose, onResearchComplete }) {
  return (
    <Modal open={open} onClose={onClose} title="eBay Research">
      <EbayResearchForm
        mode="modal"
        onComplete={(data) => {
          onResearchComplete?.(data);
          onClose();
        }}
      />
    </Modal>
  );
}
