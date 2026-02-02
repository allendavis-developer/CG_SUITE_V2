import React from 'react';
import { Modal } from '../ui/components';
import EbayResearchForm from '../forms/EbayResearchForm';

export default function EbayResearchModal({ open, onClose, onResearchComplete, category, savedState }) {
  return (
    <Modal open={open} onClose={onClose} title="eBay Research">
      <EbayResearchForm
        mode="modal"
        category={category}
        savedState={savedState} // ✨ Pass saved state for restoration
        onComplete={(data) => {
          onResearchComplete?.(data);
          onClose();
        }}
      />
    </Modal>
  );
}