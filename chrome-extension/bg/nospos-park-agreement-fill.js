/* NosPos park — agreement line DOM fill (phases, row resolution, sequential add/fill). */

/**
 * Fill name, description, qty, prices, stock fields on an agreement line (retries when DOM not ready).
 */
async function applyNosposAgreementRestPhaseImpl(tabId, payload, categoryLabel) {
  const lineIndex = Math.max(0, parseInt(String(payload.lineIndex ?? '0'), 10) || 0);
  logPark('applyNosposAgreementRestPhaseImpl', 'enter', {
    tabId, lineIndex, categoryLabel,
    name: payload.name, quantity: payload.quantity,
    retailPrice: payload.retailPrice, boughtFor: payload.boughtFor,
    stockFieldCount: Array.isArray(payload.stockFields) ? payload.stockFields.length : 0,
    itemDescription: payload.itemDescription,
  }, 'Filling rest of agreement line fields');
  const restPayload = {
    type: 'NOSPOS_AGREEMENT_FILL_PHASE',
    phase: 'rest',
    lineIndex,
    name: payload.name ?? '',
    itemDescription: payload.itemDescription ?? '',
    quantity: payload.quantity ?? '',
    retailPrice: payload.retailPrice ?? '',
    boughtFor: payload.boughtFor ?? '',
    stockFields: Array.isArray(payload.stockFields) ? payload.stockFields : [],
    categoryOurDisplay: String(payload.categoryOurDisplay ?? '').trim(),
  };

  let last = null;
  try {
    for (let i = 0; i < 28; i += 1) {
      last = await sendParkMessageToTabWithAbort(tabId, restPayload, 6, 350);
      if (last?.ok) {
        logPark('applyNosposAgreementRestPhaseImpl', 'exit', { lineIndex, attempt: i, applied: last?.applied, warnings: last?.warnings, missingRequired: last?.missingRequired }, 'Rest phase succeeded');
        return { ok: true, categoryLabel, lineIndex, ...last };
      }
      if (!last?.notReady) {
        logPark('applyNosposAgreementRestPhaseImpl', 'error', { lineIndex, attempt: i, last }, 'Rest phase failed (not a notReady error)');
        return { ok: false, categoryLabel, lineIndex, error: last?.error || 'Could not fill agreement line', ...last };
      }
      logPark('applyNosposAgreementRestPhaseImpl', 'step', { lineIndex, attempt: i, notReady: true }, `Form not ready yet — retry ${i + 1}/28`);
      await sleep(500);
    }
    logPark('applyNosposAgreementRestPhaseImpl', 'error', { lineIndex, attempts: 28 }, 'Rest phase exhausted all retries — form never became ready');
    return { ok: false, categoryLabel, lineIndex, error: last?.error || 'Agreement line form did not become ready in time', ...last };
  } catch (e) {
    logPark('applyNosposAgreementRestPhaseImpl', 'error', { error: e?.message, lineIndex }, 'Exception in rest phase');
    return { ok: false, categoryLabel, lineIndex, error: e?.message || 'Could not fill agreement line on NoSpos' };
  }
}

/**
 * Fill one agreement line by index (0-based). Caller must ensure tab is already on the items page.
 */
async function fillNosposAgreementOneLineImpl(tabId, payload) {
  const cat = await applyNosposAgreementCategoryPhaseImpl(tabId, payload);
  if (!cat.ok) {
    return {
      ok: false,
      error: cat.error,
      lineIndex: cat.lineIndex ?? payload.lineIndex,
    };
  }
  let restPayload = { ...payload };
  const marker = String(payload.cgParkLineMarker || '').trim();
  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      restPayload = { ...restPayload, lineIndex: found };
      console.log('[CG Suite] NosPos park: re-resolved line index after category', {
        marker,
        lineIndex: found,
      });
    }
  }
  return applyNosposAgreementRestPhaseImpl(tabId, restPayload, cat.categoryLabel);
}

async function fillNosposParkAgreementCategoryImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const lineIndex = Math.max(
    0,
    parseInt(String(payload.lineIndex ?? item.lineIndex ?? '0'), 10) || 0
  );
  const merged = { ...item, lineIndex };
  const result = await applyNosposAgreementCategoryPhaseImpl(tabId, merged);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      lineIndex: result.lineIndex ?? lineIndex,
    };
  }
  let restLineIndex = lineIndex;
  const marker = String(item.cgParkLineMarker || '').trim();
  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      restLineIndex = found;
      console.log('[CG Suite] NosPos park: rest line index after category (split step)', {
        marker,
        restLineIndex,
      });
    } else {
      // Brand-new row: description/marker not written yet, so the marker scan
      // comes up empty. After the category-triggered reload the row order may
      // have shifted, so use the current last-row count rather than the
      // pre-reload lineIndex.
      const count = await countNosposAgreementItemLines(tabId);
      if (count > 0) {
        const lastIdx = count - 1;
        if (lastIdx !== lineIndex) {
          console.log('[CG Suite] NosPos park: marker not found after category reload — using last row index', {
            lineIndex,
            lastIdx,
          });
        }
        restLineIndex = lastIdx;
      }
    }
  }
  return {
    ok: true,
    categoryLabel: result.categoryLabel,
    waitForm: result.waitForm,
    lineIndex: result.lineIndex ?? lineIndex,
    restLineIndex,
  };
}

async function fillNosposParkAgreementRestImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const lineIndex = Math.max(
    0,
    parseInt(String(payload.lineIndex ?? item.lineIndex ?? '0'), 10) || 0
  );
  const categoryLabel =
    payload.categoryLabel !== undefined && payload.categoryLabel !== ''
      ? payload.categoryLabel
      : null;
  return applyNosposAgreementRestPhaseImpl(
    tabId,
    { ...item, lineIndex },
    categoryLabel
  );
}

/**
 * Wait for agreement items URL, optionally set category, then fill name/qty/prices/stock (with retries after category DOM refresh).
 */
async function fillNosposAgreementFirstItemImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const firstDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (firstDead) return firstDead;
  const tabCheck = await ensureNosposAgreementItemsTab(tabId, 90000);
  if (!tabCheck.ok) return tabCheck;
  return fillNosposAgreementOneLineImpl(tabId, {
    ...payload,
    lineIndex: payload.lineIndex ?? 0,
  });
}

/**
 * stepIndex = index among *included* lines only. negotiationLineIndex = index in parkNegotiationLines.
 * After a full park, NosPos row i ↔ line i even if some lines are later "excluded" in CG (rows remain).
 * When row count matches negotiation count, prefer negotiationLineIndex; else stepIndex (compressed layout).
 */
function pickParkFallbackLineIndex(stepIndex, negotiationLineIndex, countBefore, parkNegotiationLineCount) {
  const n = Math.max(0, parseInt(String(countBefore ?? '0'), 10) || 0);
  const step = Math.max(0, parseInt(String(stepIndex ?? '0'), 10) || 0);
  const plc = Math.max(0, parseInt(String(parkNegotiationLineCount ?? '0'), 10) || 0);
  let nl = null;
  if (negotiationLineIndex != null && negotiationLineIndex !== '') {
    const parsed = parseInt(String(negotiationLineIndex), 10);
    if (Number.isFinite(parsed) && parsed >= 0) nl = parsed;
  }
  if (plc > 0 && nl != null && n >= plc && n > nl) {
    return nl;
  }
  return step;
}

/**
 * Find row by description marker, or use row 0, or click Add and wait for new row.
 */
async function resolveNosposParkAgreementLineImpl(tabId, stepIndex, item, opts = {}) {
  const noAdd = opts.noAdd === true;
  const alwaysEnsureTab = opts.ensureTab === true;
  const marker = String(item.cgParkLineMarker || '').trim();
  const parkNegotiationLineCount = opts.parkNegotiationLineCount;
  const negotiationLineIndex = opts.negotiationLineIndex;
  logPark('resolveNosposParkAgreementLineImpl', 'enter', {
    tabId, stepIndex, noAdd, alwaysEnsureTab, marker,
    parkNegotiationLineCount, negotiationLineIndex,
    itemName: item.name, itemCategoryId: item.categoryId,
  }, `Resolving NoSpos line for step ${stepIndex}`);

  if (stepIndex === 0 || alwaysEnsureTab) {
    logPark('resolveNosposParkAgreementLineImpl', 'step', { stepIndex, alwaysEnsureTab }, 'Ensuring items tab is loaded');
    const tabCheck = await ensureNosposAgreementItemsTab(tabId, 120000);
    logPark('resolveNosposParkAgreementLineImpl', 'result', { tabCheck }, 'ensureNosposAgreementItemsTab result');
    if (!tabCheck.ok) return { ...tabCheck, targetLineIndex: undefined };
  }

  let targetLineIndex = null;
  let reusedExistingRow = false;
  let didClickAdd = false;

  if (marker) {
    const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
    if (found != null && found >= 0) {
      targetLineIndex = found;
      reusedExistingRow = true;
      const expCat = String(item.categoryId || '').trim();
      const snap = await readNosposAgreementLineSnapshot(tabId, targetLineIndex);
      if (snap?.ok) {
        logPark('resolveNosposParkAgreementLineImpl', 'decision', {
          marker, targetLineIndex, stepIndex,
          nosposName: snap.name, nosposDescription: snap.description, nosposCategoryId: snap.categoryId,
          expectedCategoryId: expCat, categoryMismatch: expCat && snap.categoryId && expCat !== snap.categoryId,
          markerMissing: !String(snap.description || '').includes(marker),
        }, 'Reusing existing NoSpos row matched by marker (skipping Add)');
        console.log('[CG Suite] NosPos park: reusing row with CG marker (skip Add)', {
          marker, targetLineIndex, stepIndex,
          nosposName: snap.name, nosposItemDescription: snap.description, nosposCategoryId: snap.categoryId,
        });
        if (expCat && snap.categoryId && expCat !== snap.categoryId) {
          console.warn('[CG Suite] NosPos park: category differs on reused row (fill will overwrite)', { expectedCategoryId: expCat, nosposCategoryId: snap.categoryId });
        }
        if (!String(snap.description || '').includes(marker)) {
          console.warn('[CG Suite] NosPos park: marker missing in Nospos item description before fill', { marker, description: snap.description });
        }
      }
    } else {
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { marker }, 'Marker not found in any NoSpos row');
    }
  }

  if (targetLineIndex == null) {
    const countBefore = await countNosposAgreementItemLines(tabId);
    const fallbackIdx = pickParkFallbackLineIndex(
      stepIndex,
      negotiationLineIndex,
      countBefore,
      parkNegotiationLineCount
    );
    logPark('resolveNosposParkAgreementLineImpl', 'step', { countBefore, fallbackIdx, stepIndex, noAdd, negotiationLineIndex, parkNegotiationLineCount }, 'Marker not found — deciding between fallback index or Add');

    if (stepIndex === 0 || noAdd) {
      targetLineIndex = fallbackIdx;
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { targetLineIndex, reason: stepIndex === 0 ? 'first-step' : 'noAdd' }, 'Using fallback line index (no Add click)');
      if (noAdd && stepIndex > 0) {
        console.log('[CG Suite] NosPos park: noAdd — marker not found, using fallback line index', {
          stepIndex, negotiationLineIndex, fallbackIdx, lineCount: countBefore, parkNegotiationLineCount, reusedExistingRow,
        });
      }
    } else if (countBefore > fallbackIdx) {
      targetLineIndex = fallbackIdx;
      logPark('resolveNosposParkAgreementLineImpl', 'decision', { targetLineIndex, countBefore, fallbackIdx }, 'Existing row available at fallback index — skipping Add');
      console.log('[CG Suite] NosPos park: marker not found; using existing row at fallback index (skip Add)', {
        stepIndex, negotiationLineIndex, fallbackIdx, lineCount: countBefore, parkNegotiationLineCount, marker,
      });
    } else {
      logPark('resolveNosposParkAgreementLineImpl', 'step', { countBefore, fallbackIdx }, 'No existing row at fallback index — clicking Add');
      const clickR = await clickNosposAgreementAddItem(tabId);
      logPark('resolveNosposParkAgreementLineImpl', 'result', { clickR }, 'clickNosposAgreementAddItem result');
      if (!clickR?.ok) {
        logPark('resolveNosposParkAgreementLineImpl', 'error', { clickR }, 'Failed to click Add');
        return { ok: false, error: clickR?.error || 'Could not click Add on NoSpos' };
      }
      didClickAdd = true;
      const waitNew = await waitForNewAgreementLineAfterAdd(tabId, countBefore);
      logPark('resolveNosposParkAgreementLineImpl', 'result', { waitNew }, 'waitForNewAgreementLineAfterAdd result');
      if (!waitNew.ok) {
        return { ok: false, error: waitNew.error };
      }
      const countAfter = await countNosposAgreementItemLines(tabId);
      targetLineIndex = Math.max(0, countAfter - 1);
      logPark('resolveNosposParkAgreementLineImpl', 'step', { countAfter, targetLineIndex }, 'Add succeeded — targeting last row');
    }
  }

  logPark('resolveNosposParkAgreementLineImpl', 'exit', { targetLineIndex, reusedExistingRow, didClickAdd }, 'Line resolved');
  return { ok: true, targetLineIndex, reusedExistingRow, didClickAdd };
}

/**
 * One step of the park flow: optional Add+wait (stepIndex &gt; 0), then fill that line.
 * Lets the app refresh UI between lines.
 */
async function fillNosposAgreementItemStepImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  const stepIndex = Math.max(0, parseInt(String(payload.stepIndex ?? '0'), 10) || 0);
  logPark('fillNosposAgreementItemStepImpl', 'enter', { tabId, stepIndex, negotiationLineIndex: payload.negotiationLineIndex, itemName: payload.item?.name }, `Step ${stepIndex} — resolving then filling`);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    logPark('fillNosposAgreementItemStepImpl', 'error', { tabId }, 'Invalid tabId');
    return { ok: false, error: 'Invalid tab' };
  }
  const stepDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (stepDead) return stepDead;

  const item = payload.item && typeof payload.item === 'object' ? payload.item : {};
  const resolved = await resolveNosposParkAgreementLineImpl(tabId, stepIndex, item, {
    negotiationLineIndex: payload.negotiationLineIndex,
    parkNegotiationLineCount: payload.parkNegotiationLineCount,
  });
  logPark('fillNosposAgreementItemStepImpl', 'result', { resolved }, 'Line resolution result');
  if (!resolved.ok) return resolved;

  const fillRes = await fillNosposAgreementOneLineImpl(tabId, {
    ...item,
    lineIndex: resolved.targetLineIndex,
  });
  logPark('fillNosposAgreementItemStepImpl', 'result', { fillOk: fillRes?.ok, lineIndex: resolved.targetLineIndex, warnings: fillRes?.warnings }, 'fillNosposAgreementOneLineImpl result');
  if (!fillRes?.ok) return fillRes;
  const out = {
    ...fillRes,
    reusedExistingRow: resolved.reusedExistingRow,
    targetLineIndex: resolved.targetLineIndex,
    didClickAdd: resolved.didClickAdd,
  };
  logPark('fillNosposAgreementItemStepImpl', 'exit', { targetLineIndex: out.targetLineIndex, reusedExistingRow: out.reusedExistingRow, didClickAdd: out.didClickAdd }, `Step ${stepIndex} complete`);
  return out;
}

async function fillNosposAgreementItemsSequentialImpl(payload) {
  const tabId = parseInt(String(payload.tabId ?? '').trim(), 10);
  if (!Number.isFinite(tabId) || tabId <= 0) {
    return { ok: false, error: 'Invalid tab' };
  }
  const seqDead = await failIfNosposParkTabClosedOrMissing(tabId);
  if (seqDead) return seqDead;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, error: 'No items to add' };
  }

  const tabCheck = await ensureNosposAgreementItemsTab(tabId, 120000);
  if (!tabCheck.ok) return tabCheck;

  const perItem = [];
  for (let i = 0; i < items.length; i += 1) {
    const marker = String(items[i].cgParkLineMarker || '').trim();
    let targetLineIndex = null;
    if (marker) {
      const found = await findNosposLineIndexForMarkerWithFallback(tabId, marker);
      if (found != null && found >= 0) {
        targetLineIndex = found;
        const snap = await readNosposAgreementLineSnapshot(tabId, targetLineIndex);
        if (snap?.ok) {
          console.log('[CG Suite] NosPos sequential: reusing row with CG marker (skip Add)', {
            itemIndex: i,
            marker,
            targetLineIndex,
            nosposName: snap.name,
            nosposItemDescription: snap.description,
            nosposCategoryId: snap.categoryId,
          });
        }
      }
    }
    if (targetLineIndex == null) {
      if (i > 0) {
        const countBefore = await countNosposAgreementItemLines(tabId);
        const clickR = await clickNosposAgreementAddItem(tabId);
        if (!clickR?.ok) {
          return {
            ok: false,
            error: clickR?.error || 'Could not click Add on NoSpos',
            perItem,
            filledUpToIndex: i - 1,
          };
        }
        const waitNew = await waitForNewAgreementLineAfterAdd(tabId, countBefore);
        if (!waitNew.ok) {
          return {
            ok: false,
            error: waitNew.error,
            perItem,
            filledUpToIndex: i - 1,
          };
        }
        const countAfter = await countNosposAgreementItemLines(tabId);
        targetLineIndex = Math.max(0, countAfter - 1);
      } else {
        targetLineIndex = 0;
      }
    }
    const one = await fillNosposAgreementOneLineImpl(tabId, {
      ...items[i],
      lineIndex: targetLineIndex,
    });
    if (!one?.ok) {
      return {
        ok: false,
        error: one?.error || `Could not fill agreement line ${i + 1}`,
        perItem,
        filledUpToIndex: i - 1,
        ...one,
      };
    }
    perItem.push(one);
  }

  const last = perItem[perItem.length - 1];
  return {
    ok: true,
    perItem,
    categoryLabel: last?.categoryLabel,
    fieldRows: last?.fieldRows,
    applied: last?.applied,
    missingRequired: last?.missingRequired,
    warnings: last?.warnings,
  };
}

async function scrapeNosposStockCategoryModifyTab(tabId) {
  try {
    const response = await sendMessageToTabWithRetries(
      tabId,
      { type: 'SCRAPE_NOSPOS_STOCK_CATEGORY_MODIFY' },
      12,
      400
    );
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    let buybackRatePercent = null;
    if (response?.buybackRatePercent != null && response.buybackRatePercent !== '') {
      const n = Number(response.buybackRatePercent);
      buybackRatePercent = Number.isFinite(n) ? n : null;
    }
    let offerRatePercent = null;
    if (response?.offerRatePercent != null && response.offerRatePercent !== '') {
      const n = Number(response.offerRatePercent);
      offerRatePercent = Number.isFinite(n) ? n : null;
    }
    const hasData = rows.length > 0 || buybackRatePercent != null || offerRatePercent != null;
    if (response?.ok === false && !hasData) {
      return {
        ok: false,
        rows: [],
        buybackRatePercent: null,
        offerRatePercent: null,
        error: response?.error || 'Scrape returned no data',
      };
    }
    return {
      ok: true,
      rows,
      buybackRatePercent,
      offerRatePercent,
      error: response?.error || null,
    };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      buybackRatePercent: null,
      offerRatePercent: null,
      error: e?.message || 'Scrape failed',
    };
  }
}
