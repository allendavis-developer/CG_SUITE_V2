/** Header eBay workspace: pending customer expectation before the line exists in cart. */
export const HEADER_EBAY_CUSTOMER_EXPECTATION_KEY = '__header_ebay__';

/** Header Cash Converters / Cash Generator marketplace workspace (same pattern as eBay). */
export const HEADER_CC_CUSTOMER_EXPECTATION_KEY = '__header_cc__';
export const HEADER_CG_CUSTOMER_EXPECTATION_KEY = '__header_cg__';

/** Header Other (NosPos manual) workspace: pending expectation before the line is added. */
export const HEADER_OTHER_CUSTOMER_EXPECTATION_KEY = '__header_other__';

export function getNegotiationOtherNosposScopeLine(items) {
  const active = (Array.isArray(items) ? items : []).filter(
    (i) => i && !i.isRemoved && i.isOtherNosposManualItem === true
  );
  if (active.length === 0) return null;
  return active[active.length - 1];
}

export function resolveCustomerExpectationDraftForAdd(cartItem, pendingByTarget) {
  if (!cartItem || !pendingByTarget || typeof pendingByTarget !== 'object') {
    return { value: null, consumeKeys: [] };
  }
  const tryKeys = [];
  const pid = cartItem.cexSku ?? cartItem.cexProductData?.id;
  if (pid != null && pid !== '') tryKeys.push(`__cex__${pid}`);
  if (cartItem.id != null) tryKeys.push(cartItem.id);
  tryKeys.push(HEADER_OTHER_CUSTOMER_EXPECTATION_KEY);
  tryKeys.push(HEADER_EBAY_CUSTOMER_EXPECTATION_KEY);
  tryKeys.push(HEADER_CC_CUSTOMER_EXPECTATION_KEY);
  tryKeys.push(HEADER_CG_CUSTOMER_EXPECTATION_KEY);
  const seen = new Set();
  for (const k of tryKeys) {
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    const raw = pendingByTarget[k];
    if (raw != null && String(raw).trim() !== '') {
      return { value: String(raw).trim(), consumeKeys: [k] };
    }
  }
  return { value: null, consumeKeys: [] };
}

export function formatSumLineCustomerExpectations(items) {
  const active = (items || []).filter((i) => !i.isRemoved);
  if (active.length === 0) return '';
  const sum = active.reduce((acc, i) => {
    const v = parseFloat(String(i.customerExpectation ?? '').replace(/[£,]/g, '').trim());
    return acc + (Number.isFinite(v) && v >= 0 ? v : 0);
  }, 0);
  return sum.toFixed(2);
}
