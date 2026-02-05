import React from 'react';
import { CustomDropdown } from '@/components/ui/components';

const TRANSACTION_OPTIONS = [
  { value: 'sale', label: 'Direct Sale', className: 'text-emerald-600' },
  { value: 'buyback', label: 'Buy Back', className: 'text-purple-600' },
  { value: 'store_credit', label: 'Store Credit', className: 'text-blue-600' }
];

const TRANSACTION_META = TRANSACTION_OPTIONS.reduce((acc, t) => {
  acc[t.value] = t;
  return acc;
}, {});

const CustomerTransactionHeader = ({
  customer,
  transactionType,
  onTransactionChange,
  containerClassName = '',
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
          <CustomDropdown
            value={transaction.label}
            options={TRANSACTION_OPTIONS.map(o => o.label)}
            onChange={(label) => {
              const selected = TRANSACTION_OPTIONS.find(o => o.label === label);
              if (selected) onTransactionChange(selected.value);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CustomerTransactionHeader;
