import React from 'react';

const TYPE_LABELS = {
  store_credit: 'Store Credit',
  buyback: 'Buy Back',
  sale: 'Direct Sale',
};

export default function TransactionTypeConfirmDialog({ pendingType, cartCount, onConfirm, onCancel }) {
  const label = TYPE_LABELS[pendingType] || pendingType;
  const isVoucher = pendingType === 'store_credit';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/50" aria-hidden />
      <div className="cg-animate-modal-panel relative z-10 bg-white rounded-xl p-6 w-[500px] shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-brand-orange/15 p-2 rounded-lg">
            <span className="material-symbols-outlined text-brand-orange-hover text-2xl">warning</span>
          </div>
          <h2 className="text-xl font-bold text-brand-blue">Change Transaction Type?</h2>
        </div>

        <p className="text-sm text-gray-700 mb-2">
          You are about to change the transaction type to{' '}
          <span className="font-bold text-brand-blue">{label}</span>.
        </p>

        <p className="text-sm text-gray-700 mb-4">
          {isVoucher ? (
            <>This will switch all offers to <span className="font-bold">voucher prices</span>.</>
          ) : (
            <>This will switch all offers to <span className="font-bold">cash prices</span>.</>
          )}
        </p>

        <div className="bg-brand-blue/5 border border-brand-blue/20 rounded-lg p-3 mb-6">
          <p className="text-xs text-brand-blue mb-2">
            <span className="material-symbols-outlined text-sm mr-1" style={{ fontSize: '14px', verticalAlign: 'middle' }}>info</span>
            All {cartCount} item{cartCount !== 1 ? 's' : ''} in your cart will be updated with new valuations.
          </p>
          {isVoucher && (
            <p className="text-xs text-brand-blue ml-5">
              • CeX items: Updated to CeX voucher prices<br />
              • eBay items: Cash offers +10%
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-6 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2.5 text-sm font-bold text-white bg-brand-blue rounded-lg hover:bg-brand-blue-hover transition-colors shadow-md"
          >
            Confirm Change
          </button>
        </div>
      </div>
    </div>
  );
}
