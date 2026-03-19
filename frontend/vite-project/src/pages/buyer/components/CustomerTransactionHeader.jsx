import React from 'react';
import { CustomDropdown } from '@/components/ui/components';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';

const CustomerTransactionHeader = ({
  customer,
  transactionType,
  onTransactionChange,
  containerClassName = '',
  readOnly = false, // Add readOnly prop with default false
}) => {
  const transaction = TRANSACTION_META[transactionType] || {
    label: 'Unknown',
    className: 'text-gray-400'
  };

  return (
    <div className={`bg-white p-6 ${containerClassName}`}>
      <h1 className="text-xl font-extrabold tracking-tight text-blue-900">
        {customer.name}
      </h1>

      <div className="flex items-center gap-2 mt-2">
        <p className="text-sm font-medium text-blue-900/80">
          Cancel Rate: {customer.cancelRate}%
        </p>

        <span className="text-blue-900/40">•</span>

        <div className={transaction.className}>
          {readOnly ? (
            <span className="text-sm font-semibold">{transaction.label}</span>
          ) : (
            <CustomDropdown
              value={transaction.label}
              options={TRANSACTION_OPTIONS.map(o => o.label)}
              onChange={(label) => {
                const selected = TRANSACTION_OPTIONS.find(o => o.label === label);
                if (selected) onTransactionChange(selected.value);
              }}
            />
          )}
        </div>
      </div>

      {customer.bypassReason && (
        <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 w-fit">
          <span className="material-symbols-outlined text-amber-500 text-sm">info</span>
          <p className="text-xs font-semibold text-amber-700">
            {customer.bypassReason === "Within 14 days of last transaction"
              ? `Customer data not updated — ${customer.bypassReason}`
              : `Customer data was not updated because: ${customer.bypassReason}`}
          </p>
        </div>
      )}
    </div>
  );
};

export default CustomerTransactionHeader;
