import { buildNosposAgreementFirstItemFillPayload } from './nosposAgreementFirstItemFill';
import { getNosposCategoryHierarchyLabelFromItem } from '@/utils/nosposCategoryMappings';

/** Shown when Chrome reports a dead frame / missing receiver after the NosPos tab is closed. */
export const NOSPOS_TAB_CLOSED_PARK_USER_MSG =
  'The NosPos tab was closed. Please close this modal and retry.';

function rawParkErrorText(source) {
  if (source == null) return '';
  if (typeof source === 'string') return source;
  if (source instanceof Error) return String(source.message || '');
  if (typeof source === 'object') {
    if (source.message != null) return String(source.message);
    if (source.error != null) return String(source.error);
  }
  return String(source);
}

/**
 * Maps low-level extension/Chrome errors (e.g. “frame … was removed”) to a clear park message.
 * @param {unknown} source - Error, string, or bridge payload fragment
 * @param {string} [fallback] - used when source is empty and not a tab-close pattern
 */
export function formatParkFlowUserMessage(source, fallback = '') {
  const raw = rawParkErrorText(source).trim();
  const low = raw.toLowerCase();
  if (
    /frame\s+with\s+id\s+\d+\s+was\s+removed/.test(low) ||
    /receiving end does not exist/.test(low) ||
    /could not establish connection/.test(low) ||
    /message port closed/i.test(raw) ||
    /nospos\s+tab\s+was\s+closed/i.test(low)
  ) {
    return NOSPOS_TAB_CLOSED_PARK_USER_MSG;
  }
  return raw || fallback;
}

/** NosPos “create agreement” — PA = buyback, DP = direct sale / store credit. */
export function buildNosposNewAgreementCreateUrl(nosposCustomerId, transactionType) {
  const id = parseInt(String(nosposCustomerId ?? '').trim(), 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const agreementType = transactionType === 'buyback' ? 'PA' : 'DP';
  return `https://nospos.com/newagreement/agreement/create?type=${agreementType}&customer_id=${id}`;
}

export function extractNosposAgreementId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const m = /^\/newagreement\/(\d+)\/items\/?$/i.exec(u.pathname || '');
    return m?.[1] || null;
  } catch (_) {
    return null;
  }
}

export function buildNosposAgreementItemsUrl(agreementId) {
  const id = extractNosposAgreementId(agreementId);
  if (!id) return null;
  return `https://nospos.com/newagreement/${id}/items`;
}

export function parkNegotiationLines(items) {
  if (!Array.isArray(items)) return [];
  return [
    ...items.filter((i) => i.isJewelleryItem && !i.isRemoved),
    ...items.filter((i) => !i.isJewelleryItem && !i.isRemoved),
  ];
}

/**
 * NosPos park “sequence index” for a line: count of non-excluded lines strictly before this
 * negotiation index. First included line → 0 (use row 0, no Add). Second included → 1 (one Add), etc.
 */
export function parkIncludedSequentialStepIndex(lines, excludedIds, negotiationIndex) {
  const ex = excludedIds && excludedIds.size ? excludedIds : null;
  let n = 0;
  for (let j = 0; j < negotiationIndex; j++) {
    const id = lines[j]?.id;
    if (ex && id && ex.has(id)) continue;
    n += 1;
  }
  return n;
}

export function buildParkExtensionItemPayload(line, negotiationIdx, opts) {
  const { useVoucherOffers, categoriesResults, requestId, parkSequentialIndex } = opts || {};
  const fp = buildNosposAgreementFirstItemFillPayload(line, negotiationIdx, {
    useVoucherOffers,
    categoriesResults,
    requestId,
    parkSequentialIndex:
      parkSequentialIndex != null ? parkSequentialIndex : negotiationIdx,
  });
  const hint =
    getNosposCategoryHierarchyLabelFromItem(line) || (fp?.categoryId ? String(fp.categoryId) : '');
  return {
    categoryId: fp?.categoryId ?? '',
    categoryOurDisplay: hint,
    name: fp?.name ?? '',
    itemDescription: fp?.itemDescription ?? '',
    cgParkLineMarker: fp?.cgParkLineMarker ?? '',
    quantity: fp?.quantity ?? '1',
    retailPrice: fp?.retailPrice ?? null,
    boughtFor: fp?.boughtFor ?? null,
    stockFields: fp?.stockFields ?? [],
  };
}

export function agreementParkLineTitle(item, index) {
  if (!item) return `Item ${index + 1}`;
  const ref = item.referenceData || {};
  if (item.isJewelleryItem) {
    return (
      String(
        ref.item_name ||
          ref.line_title ||
          ref.reference_display_name ||
          ref.product_name ||
          item.variantName ||
          item.title ||
          'Jewellery'
      ).trim() || 'Jewellery'
    );
  }
  return (
    String(item.variantName || item.title || ref.product_name || `Item ${index + 1}`).trim() ||
    `Item ${index + 1}`
  );
}

/** Parse `park_agreement_state_json` from request detail into UI state. */
export function parseParkAgreementStateFromApi(parkState, mappedItems) {
  if (!parkState || typeof parkState !== 'object') {
    return { agreementId: null, excludedIds: null };
  }
  const savedAgreementId = extractNosposAgreementId(
    parkState.nosposAgreementId ?? parkState.nosposAgreementUrl ?? null
  );
  let excludedIds = null;
  if (Array.isArray(parkState.excludedItemIds) && parkState.excludedItemIds.length > 0) {
    const excluded = new Set(parkState.excludedItemIds.map(String));
    const resolvedExcluded = new Set();
    mappedItems.forEach((item) => {
      const rid = String(item.request_item_id ?? '');
      const cid = String(item.id ?? '');
      if (excluded.has(rid) || excluded.has(cid)) resolvedExcluded.add(item.id);
    });
    if (resolvedExcluded.size > 0) excludedIds = resolvedExcluded;
  }
  return { agreementId: savedAgreementId, excludedIds };
}
