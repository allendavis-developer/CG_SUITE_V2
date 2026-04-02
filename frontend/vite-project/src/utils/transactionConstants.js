export const TRANSACTION_OPTIONS = [
  { value: 'sale', label: 'Direct Sale', className: 'text-emerald-600' },
  { value: 'buyback', label: 'Buy Back', className: 'text-purple-600' },
  { value: 'store_credit', label: 'Store Credit', className: 'text-blue-600' }
];

export const TRANSACTION_META = TRANSACTION_OPTIONS.reduce((acc, t) => {
  acc[t.value] = t;
  return acc;
}, {});

const INTENT_SALE = 'DIRECT_SALE';
const INTENT_BUYBACK = 'BUYBACK';
const INTENT_STORE_CREDIT = 'STORE_CREDIT';

const TRANSACTION_TO_INTENT = {
  sale: INTENT_SALE,
  buyback: INTENT_BUYBACK,
  store_credit: INTENT_STORE_CREDIT,
};

/** Map frontend transaction type to Django RequestIntent */
export function mapTransactionTypeToIntent(transactionType) {
  const mapped = TRANSACTION_TO_INTENT[transactionType];
  if (!mapped) {
    throw new Error(`Invalid transaction type: ${transactionType}. Must be one of: sale, buyback, store_credit`);
  }
  return mapped;
}

/** Format Django intent for display */
export function formatIntent(intent) {
  switch (intent) {
    case INTENT_SALE:
      return 'Direct Sale';
    case INTENT_BUYBACK:
      return 'Buy Back';
    case INTENT_STORE_CREDIT:
      return 'Store Credit';
    default:
      return intent?.replace(/_/g, ' ') ?? '';
  }
}

/** Single source of truth for Requests Overview status filter (value → API, label → UI). */
export const REQUEST_OVERVIEW_STATUS_FILTERS = [
  { value: 'ALL', label: 'All Requests' },
  { value: 'QUOTE', label: 'Quote Requests' },
  { value: 'BOOKED_FOR_TESTING', label: 'Booked For Testing' },
  { value: 'COMPLETE', label: 'Complete Requests' },
];

/** Display title for the current request overview filter value */
export function getFilterTitle(status) {
  const row = REQUEST_OVERVIEW_STATUS_FILTERS.find((f) => f.value === status);
  return row?.label ?? 'Requests';
}
