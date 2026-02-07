export const TRANSACTION_OPTIONS = [
  { value: 'sale', label: 'Direct Sale', className: 'text-emerald-600' },
  { value: 'buyback', label: 'Buy Back', className: 'text-purple-600' },
  { value: 'store_credit', label: 'Store Credit', className: 'text-blue-600' }
];

export const TRANSACTION_META = TRANSACTION_OPTIONS.reduce((acc, t) => {
  acc[t.value] = t;
  return acc;
}, {});