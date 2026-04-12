/**
 * Tracks the marketplace search string the user confirmed for a negotiation line this session
 * (before research is saved to the item). Shared across eBay ↔ Cash Converters for the same row.
 */

const termByItemId = new Map();

export function markMarketplaceSearchConfirmedForItem(itemId, term) {
  if (itemId == null || itemId === '') return;
  const t = String(term ?? '').trim();
  if (!t) return;
  termByItemId.set(String(itemId), t);
}

export function getMarketplaceSearchSessionTerm(itemId) {
  if (itemId == null || itemId === '') return '';
  return termByItemId.get(String(itemId)) ?? '';
}

export function clearMarketplaceSearchSessionTerm(itemId) {
  if (itemId == null || itemId === '') return;
  termByItemId.delete(String(itemId));
}
