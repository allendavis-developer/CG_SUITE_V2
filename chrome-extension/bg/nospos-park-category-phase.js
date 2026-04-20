/**
 * NosPos agreement line: category selection + post-reload form wait (uses sendParkMessageToTabWithAbort from tab-flow).
 */

async function applyNosposAgreementCategoryPhaseImpl(tabId, payload) {
  const lineIndex = Math.max(0, parseInt(String(payload.lineIndex ?? '0'), 10) || 0);
  const categoryId = String(payload.categoryId ?? '').trim();
  logPark('applyNosposAgreementCategoryPhaseImpl', 'enter', { tabId, lineIndex, categoryId, name: payload.name, marker: payload.cgParkLineMarker }, 'Setting category on NoSpos agreement line');
  let categoryLabel = null;
  const stockLabelsForWait = Array.isArray(payload.stockFields)
    ? payload.stockFields.map((r) => r && r.label).filter(Boolean)
    : [];
  if (!categoryId) {
    logPark('applyNosposAgreementCategoryPhaseImpl', 'decision', { lineIndex }, 'No categoryId — skipping category phase');
    return { ok: true, categoryLabel: null, waitForm: { ok: true }, lineIndex };
  }
  try {
    if (NOSPOS_SET_CATEGORY_DELAY_MS > 0) {
      logPark(
        'applyNosposAgreementCategoryPhaseImpl',
        'step',
        { tabId, lineIndex, delayMs: NOSPOS_SET_CATEGORY_DELAY_MS },
        'Rate-limit guard: delaying before category set'
      );
      await sleep(NOSPOS_SET_CATEGORY_DELAY_MS);
    }
    logPark('applyNosposAgreementCategoryPhaseImpl', 'call', { tabId, lineIndex, categoryId }, 'Sending category phase to content script');
    const r1 = await sendParkMessageToTabWithAbort(
      tabId,
      { type: 'NOSPOS_AGREEMENT_FILL_PHASE', phase: 'category', categoryId, lineIndex },
      8,
      500
    );
    logPark('applyNosposAgreementCategoryPhaseImpl', 'result', { r1 }, 'Category phase response from content script');
    if (!r1?.ok) {
      logPark('applyNosposAgreementCategoryPhaseImpl', 'error', { r1, lineIndex, categoryId }, 'Content script could not set category');
      return { ok: false, error: r1?.error || 'Could not set category', lineIndex, ...r1 };
    }
    categoryLabel = r1.label || null;
    logPark('applyNosposAgreementCategoryPhaseImpl', 'step', { lineIndex, categoryLabel, stockLabelsForWait }, 'Category set — waiting for page/form reload');
    console.log('[CG Suite] NosPos agreement fill: category set, waiting for page/form…', {
      lineIndex,
      categoryLabel,
      expectStockLabels: stockLabelsForWait,
    });
    const waitForm = await waitForAgreementItemsReadyAfterCategory(
      tabId,
      stockLabelsForWait,
      lineIndex
    );
    logPark('applyNosposAgreementCategoryPhaseImpl', 'result', { waitForm, lineIndex, categoryLabel }, 'Post-category form-ready wait result');
    if (!waitForm.ok) {
      console.warn('[CG Suite] NosPos agreement fill: post-category wait failed', waitForm);
    }
    return { ok: true, categoryLabel, waitForm, lineIndex };
  } catch (e) {
    logPark('applyNosposAgreementCategoryPhaseImpl', 'error', { error: e?.message, lineIndex, categoryId }, 'Exception in category phase');
    return { ok: false, error: e?.message || 'Could not set category on NoSpos', lineIndex };
  }
}
