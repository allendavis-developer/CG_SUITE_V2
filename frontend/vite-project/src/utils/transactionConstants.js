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

/** Get display title for request filter status */
export function getFilterTitle(status) {
  switch (status) {
    case 'ALL':
      return 'All Requests';
    case 'QUOTE':
      return 'Quote Requests';
    case 'BOOKED_FOR_TESTING':
      return 'Booked For Testing';
    case 'COMPLETE':
      return 'Complete Requests';
    default:
      return 'Requests';
  }
}
