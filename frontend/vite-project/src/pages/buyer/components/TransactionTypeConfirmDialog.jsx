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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-[500px] shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-yellow-100 p-2 rounded-lg">
            <span className="material-symbols-outlined text-yellow-600 text-2xl">warning</span>
          </div>
          <h2 className="text-xl font-bold text-blue-900">Change Transaction Type?</h2>
        </div>

        <p className="text-sm text-gray-700 mb-2">
          You are about to change the transaction type to{' '}
          <span className="font-bold text-blue-900">{label}</span>.
        </p>

        <p className="text-sm text-gray-700 mb-4">
          {isVoucher ? (
            <>This will switch all offers to <span className="font-bold">voucher prices</span>.</>
          ) : (
            <>This will switch all offers to <span className="font-bold">cash prices</span>.</>
          )}
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
          <p className="text-xs text-blue-800 mb-2">
            <span className="material-symbols-outlined text-sm mr-1" style={{ fontSize: '14px', verticalAlign: 'middle' }}>info</span>
            All {cartCount} item{cartCount !== 1 ? 's' : ''} in your cart will be updated with new valuations.
          </p>
          {isVoucher && (
            <p className="text-xs text-blue-700 ml-5">
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
            className="px-6 py-2.5 text-sm font-bold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors shadow-md"
          >
            Confirm Change
          </button>
        </div>
      </div>
    </div>
  );
}
