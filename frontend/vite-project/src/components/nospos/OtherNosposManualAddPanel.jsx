import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildRequiredNosposFieldEditorModel } from '@/pages/buyer/utils/nosposAgreementFirstItemFill';
import { buildMergedNosposStockFieldValuesBlob } from '@/pages/buyer/utils/negotiationMissingNosposRequired';
import { buildNosposStockFieldAiPayload } from '@/pages/buyer/utils/nosposFieldAiAtAdd';
import { ENABLE_NOSPOS_STOCK_FIELD_AI } from '@/config/cgSuiteFeatureFlags';
import NosposRequiredFieldsInlineTable from '@/components/nospos/NosposRequiredFieldsInlineTable';
import {
  formatOfferPrice,
  normalizeExplicitSalePrice,
  roundOfferPrice,
  roundSalePrice,
  toVoucherOfferPrice,
} from '@/utils/helpers';
import { NEGOTIATION_ROW_CONTEXT } from '@/pages/buyer/rowContextZones';

const DRAFT_LINE_ID = 'other-workspace-draft';

function parseMoneyInput(raw) {
  const n = parseFloat(String(raw ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Manual NosPos line builder for the header “Other” workspace: item name → inline stock fields → add to cart.
 */
export default function OtherNosposManualAddPanel({
  leafNosposId,
  selectedNode,
  pathNames,
  categoriesResults,
  categoryMappings = [],
  useVoucherOffers = false,
  actualRequestId = null,
  showNotification,
  onAddNegotiationItem,
  onOfferPreviewChange,
  onAdded,
  addButtonLabel = 'Add to negotiation',
}) {
  const [itemTitle, setItemTitle] = useState('');
  const [rrpInput, setRrpInput] = useState('');
  const [offerInput, setOfferInput] = useState('');
  const [draft, setDraft] = useState({});
  const [fieldBlob, setFieldBlob] = useState(null);
  const [addBusy, setAddBusy] = useState(false);

  const suggestInFlightRef = useRef(false);
  const lastStockSuggestKeyRef = useRef('');

  const fullName =
    selectedNode?._sourceRow?.fullName?.trim() ||
    (Array.isArray(pathNames) && pathNames.length ? pathNames.join(' > ') : '') ||
    '';

  const syntheticItem = useMemo(() => {
    if (leafNosposId == null || !Number(leafNosposId)) return null;
    const leaf = Number(leafNosposId);
    const title = String(itemTitle || '').trim();
    if (!title) return null;

    const base = {
      id: DRAFT_LINE_ID,
      title,
      subtitle: '',
      quantity: 1,
      category: selectedNode?.name || '',
      categoryName: fullName || undefined,
      categoryObject: null,
      aiSuggestedNosposStockCategory: {
        nosposId: leaf,
        fullName: fullName || String(selectedNode?.name || ''),
      },
    };

    if (fieldBlob && typeof fieldBlob === 'object') {
      return {
        ...base,
        aiSuggestedNosposStockFieldValues: fieldBlob,
        rawData: { aiSuggestedNosposStockFieldValues: fieldBlob },
      };
    }
    return base;
  }, [leafNosposId, itemTitle, selectedNode?.name, fullName, fieldBlob]);

  const model = useMemo(() => {
    if (!syntheticItem) {
      return { leafNosposId: null, requiredRows: [], stockAssessment: 'unavailable' };
    }
    return buildRequiredNosposFieldEditorModel(syntheticItem, 0, {
      useVoucherOffers,
      categoriesResults: Array.isArray(categoriesResults) ? categoriesResults : [],
      categoryMappings: Array.isArray(categoryMappings) ? categoryMappings : [],
      requestId: actualRequestId,
    });
  }, [syntheticItem, useVoucherOffers, categoriesResults, categoryMappings, actualRequestId]);

  const persistedEditableStockKey = useMemo(
    () =>
      model.requiredRows
        .filter((r) => !r.satisfiedByPreset)
        .map((r) => `${r.nosposFieldId}\u0001${String(r.value ?? '').trim()}`)
        .join('\u0002'),
    [model.requiredRows]
  );

  useEffect(() => {
    const m = {};
    for (const r of model.requiredRows) {
      if (!r.satisfiedByPreset) m[r.nosposFieldId] = r.value || '';
    }
    setDraft(m);
  }, [model.leafNosposId, model.stockAssessment, persistedEditableStockKey]);

  useEffect(() => {
    setFieldBlob(null);
    lastStockSuggestKeyRef.current = '';
  }, [leafNosposId]);

  const handleDraftChange = useCallback((fieldId, value) => {
    setDraft((d) => ({ ...d, [fieldId]: value }));
  }, []);

  const hasEditableRequired = model.requiredRows.some((r) => !r.satisfiedByPreset);

  const maybeRunStockFieldSuggestions = useCallback(async () => {
    if (!ENABLE_NOSPOS_STOCK_FIELD_AI) return;
    const title = String(itemTitle || '').trim();
    if (!title || !syntheticItem || !model.leafNosposId || model.stockAssessment !== 'ready') return;
    if (!hasEditableRequired) return;
    if (suggestInFlightRef.current) return;

    const key = `${model.leafNosposId}\u0001${title}`;
    if (lastStockSuggestKeyRef.current === key) return;

    suggestInFlightRef.current = true;
    try {
      const payload = await buildNosposStockFieldAiPayload({
        nosposCategoryId: model.leafNosposId,
        negotiationItem: syntheticItem,
        source: 'other_workspace_manual',
        categoriesResults: Array.isArray(categoriesResults) ? categoriesResults : null,
      });
      lastStockSuggestKeyRef.current = key;
      if (!payload?.byNosposFieldId || typeof payload.byNosposFieldId !== 'object') {
        return;
      }
      setFieldBlob(payload);
      setDraft((prev) => {
        const next = { ...prev };
        for (const [fid, val] of Object.entries(payload.byNosposFieldId)) {
          const s =
            typeof val === 'object' && val !== null && 'value' in val
              ? String(val.value ?? '').trim()
              : String(val ?? '').trim();
          if (s) next[String(fid)] = s;
        }
        return next;
      });
    } catch (e) {
      lastStockSuggestKeyRef.current = '';
      showNotification?.(e?.message || 'Could not suggest stock fields. Fill them manually.', 'error');
    } finally {
      suggestInFlightRef.current = false;
    }
  }, [
    itemTitle,
    syntheticItem,
    model.leafNosposId,
    model.stockAssessment,
    hasEditableRequired,
    categoriesResults,
    showNotification,
  ]);

  const fieldsIncomplete =
    hasEditableRequired &&
    model.requiredRows.some((r) => !r.satisfiedByPreset && !String(draft[r.nosposFieldId] ?? '').trim());

  const rrpNum = parseMoneyInput(rrpInput);
  const offerNum = parseMoneyInput(offerInput);
  const pricesOk = Number.isFinite(rrpNum) && rrpNum > 0 && Number.isFinite(offerNum) && offerNum > 0;

  useEffect(() => {
    const parsed = parseMoneyInput(offerInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      onOfferPreviewChange?.(null);
      return;
    }
    onOfferPreviewChange?.(roundOfferPrice(parsed));
  }, [offerInput, onOfferPreviewChange]);

  useEffect(() => () => {
    onOfferPreviewChange?.(null);
  }, [onOfferPreviewChange]);

  const canAdd =
    Boolean(syntheticItem) &&
    model.stockAssessment === 'ready' &&
    model.leafNosposId &&
    !fieldsIncomplete &&
    pricesOk &&
    !addBusy;

  const handleAdd = useCallback(async () => {
    if (!canAdd || !onAddNegotiationItem) return;
    const rrp = parseMoneyInput(rrpInput);
    const offer = parseMoneyInput(offerInput);
    if (!Number.isFinite(rrp) || rrp <= 0 || !Number.isFinite(offer) || offer <= 0) {
      showNotification?.('Enter a valid RRP and offer (both greater than zero).', 'error');
      return;
    }

    setAddBusy(true);
    try {
      const merged = buildMergedNosposStockFieldValuesBlob(syntheticItem, model.leafNosposId, draft);
      const offerRounded = roundOfferPrice(offer);
      const cash = [
        {
          id: 'other-manual-cash-1',
          title: 'Buy-in offer',
          price: offerRounded,
        },
      ];
      const voucher = cash.map((o) => ({
        id: `other-manual-v-${o.id}`,
        title: o.title,
        price: toVoucherOfferPrice(o.price),
      }));
      const display = useVoucherOffers ? voucher : cash;
      const lineId = crypto.randomUUID?.() ?? `other-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const manualOfferStr = formatOfferPrice(normalizeExplicitSalePrice(offer));
      const displayName = String(syntheticItem.title || '').trim();
      const cartItem = {
        id: lineId,
        title: displayName,
        subtitle: displayName,
        variantName: displayName,
        quantity: 1,
        category: syntheticItem.category || '',
        categoryObject: null,
        categoryName: fullName || undefined,
        aiSuggestedNosposStockCategory: syntheticItem.aiSuggestedNosposStockCategory,
        aiSuggestedNosposStockFieldValues: merged,
        rawData: {
          aiSuggestedNosposStockCategory: syntheticItem.aiSuggestedNosposStockCategory,
          aiSuggestedNosposStockFieldValues: merged,
          rrpOffersSource: NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER,
          offersSource: NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER,
          other_workspace_manual_item: true,
          otherWorkspaceManualItem: true,
        },
        isOtherNosposManualItem: true,
        variantId: null,
        cexSku: null,
        cashOffers: cash,
        voucherOffers: voucher,
        offers: display,
        selectedOfferId: 'manual',
        manualOffer: manualOfferStr,
        ourSalePrice: roundSalePrice(rrp),
        rrpOffersSource: NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER,
        offersSource: NEGOTIATION_ROW_CONTEXT.MANUAL_OFFER,
        referenceData: null,
        ebayResearchData: null,
        request_item_id: null,
      };

      const ok = await onAddNegotiationItem(cartItem, {
        addedFromBuilder: false,
        runNosposCategoryAiForInternalLeaf: false,
        skipNosposStockFieldAi: true,
      });
      if (ok !== false) {
        setItemTitle('');
        setRrpInput('');
        setOfferInput('');
        setDraft({});
        setFieldBlob(null);
        lastStockSuggestKeyRef.current = '';
        onAdded?.();
      }
    } catch (e) {
      showNotification?.(e?.message || 'Could not add line', 'error');
    } finally {
      setAddBusy(false);
    }
  }, [
    canAdd,
    syntheticItem,
    model.leafNosposId,
    draft,
    useVoucherOffers,
    fullName,
    rrpInput,
    offerInput,
    onAddNegotiationItem,
    onAdded,
    showNotification,
  ]);

  const schemaPending = !Array.isArray(categoriesResults) || categoriesResults.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 text-left">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">Item name</label>
        <input
          type="text"
          value={itemTitle}
          onChange={(e) => setItemTitle(e.target.value)}
          onBlur={() => void maybeRunStockFieldSuggestions()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void maybeRunStockFieldSuggestions();
            }
          }}
          className="mt-1 w-full max-w-xl rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
        <p className="mt-1 text-[11px] text-gray-500">
          Category: <span className="font-semibold text-gray-700">{fullName || '—'}</span>
        </p>
      </div>

      <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">RRP (£)</label>
          <input
            type="text"
            inputMode="decimal"
            value={rrpInput}
            onChange={(e) => setRrpInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">Offer (£)</label>
          <input
            type="text"
            inputMode="decimal"
            value={offerInput}
            onChange={(e) => setOfferInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
          />
        </div>
      </div>

      {schemaPending ? (
        <p className="text-sm text-amber-800">Loading NosPos field definitions…</p>
      ) : !itemTitle.trim() ? (
        <p className="text-sm text-gray-600">Enter an item name to load required NosPos stock fields.</p>
      ) : model.stockAssessment !== 'ready' || !model.leafNosposId ? (
        <p className="text-sm text-amber-900">
          Could not resolve this NosPos row for stock fields. Pick a category from the tree on the left and try again.
        </p>
      ) : (
        <>
          {model.requiredRows.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-700">
              No required stock fields for this NosPos category. You can still add the line with the button below.
            </p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-gray-700">Required NosPos stock fields</p>
              <NosposRequiredFieldsInlineTable
                requiredRows={model.requiredRows}
                draft={draft}
                onChange={handleDraftChange}
                tableClassName="max-h-[min(40vh,320px)]"
              />
            </>
          )}

          {fieldsIncomplete ? (
            <p className="text-[11px] font-semibold text-amber-800">Fill every required field before adding to the list.</p>
          ) : null}

          {!pricesOk && itemTitle.trim() ? (
            <p className="text-[11px] font-semibold text-amber-800">Enter RRP and offer (both greater than zero).</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => void handleAdd()}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-md transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
            >
              <span className="material-symbols-outlined text-[22px]">add_shopping_cart</span>
              {addBusy ? 'Adding…' : addButtonLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
