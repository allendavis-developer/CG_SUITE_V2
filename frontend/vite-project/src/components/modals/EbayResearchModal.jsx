import React from 'react';
import { Modal } from '../ui/components';
import EbayResearchForm from '../forms/EbayResearchForm';

export default function EbayResearchModal({ open, onClose, onResearchComplete, category }) {
  return (
    <Modal open={open} onClose={onClose} title="eBay Research">
      <EbayResearchForm
        mode="modal"
        category={category} 
        onComplete={(data) => {
          onResearchComplete?.(data);
          onClose();
        }}
      />
    </Modal>
  );
}
