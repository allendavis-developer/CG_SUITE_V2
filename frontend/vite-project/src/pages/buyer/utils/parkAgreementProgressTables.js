import { linkedFieldsForCategory } from '@/pages/buyer/utils/nosposFieldAiAtAdd';
import { resolveNosposLeafCategoryIdForAgreementItem } from '@/utils/nosposCategoryMappings';

function normField(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/**
 * Add rows for NosPos-linked fields from the category API that are not already in `fieldRows`
 * (optional / empty CG data — user can still type on NosPos via the modal).
 */
export function mergeLinkedStockRows(fieldRows, categoryId, categoriesResults) {
  const rows = Array.isArray(fieldRows) ? fieldRows.map((r) => ({ ...r })) : [];
  const nid = Number(categoryId);
  if (!Number.isFinite(nid) || nid <= 0) return rows;
  const linked = linkedFieldsForCategory(nid, categoriesResults || []);
  const seen = new Set(rows.map((r) => normField(r.field)));

  for (const lf of linked) {
    const name = String(lf.name || '').trim();
    if (!name) continue;
    const nk = normField(name);
    if (seen.has(nk)) continue;
    seen.add(nk);
    rows.push({
      id: `linked:${lf.nosposFieldId ?? nk}`,
      field: name,
      ourValue: '',
      nosposValue: '',
      nosposDisplay: '',
      note: '',
      required: lf.required === true,
      inputKind: 'text',
      options: [],
      step: null,
      min: null,
      patchKind: 'by_label',
      fieldLabel: name,
      displayOnly: false,
    });
  }
  return rows;
}

export function buildOtherLineTable(line, idx, agreementParkLineTitle) {
  const title = agreementParkLineTitle(line, idx);
  const qty = String(line.quantity ?? 1);
  const offer = line.selectedOfferId === 'manual' && line.manualOffer ? String(line.manualOffer) : '';
  return {
    itemIndex: idx,
    title: `Item ${idx + 1} — ${title}`,
    patchEnabled: false,
    footNote:
      'Live editing from this modal only targets line 1 on NoSpos. Complete this line in the NoSpos tab.',
    rows: [
      {
        id: 'other-summary',
        field: 'CG Suite line',
        ourValue: title,
        nosposValue: '',
        nosposDisplay: '—',
        note: '',
        required: false,
        inputKind: 'text',
        options: [],
        patchKind: 'none',
        fieldLabel: '',
        displayOnly: true,
      },
      {
        id: 'other-qty',
        field: 'Quantity (CG Suite)',
        ourValue: qty,
        nosposValue: '',
        nosposDisplay: '—',
        note: '',
        required: false,
        inputKind: 'text',
        options: [],
        patchKind: 'none',
        fieldLabel: '',
        displayOnly: true,
      },
      ...(offer
        ? [
            {
              id: 'other-offer',
              field: 'Manual offer (CG Suite)',
              ourValue: offer,
              nosposValue: '',
              nosposDisplay: '—',
              note: '',
              required: false,
              inputKind: 'text',
              options: [],
              patchKind: 'none',
              fieldLabel: '',
              displayOnly: true,
            },
          ]
        : []),
    ],
  };
}

const DISPLAY_WAIT = {
  id: 'park-wait',
  field: 'Status',
  ourValue: '',
  nosposValue: '',
  nosposDisplay: 'Applying on NoSpos…',
  note: '',
  required: false,
  inputKind: 'text',
  options: [],
  patchKind: 'none',
  fieldLabel: '',
  displayOnly: true,
};

const DISPLAY_QUEUED = {
  id: 'park-queued',
  field: 'Status',
  ourValue: '',
  nosposValue: '',
  nosposDisplay: 'Queued',
  note: '',
  required: false,
  inputKind: 'text',
  options: [],
  patchKind: 'none',
  fieldLabel: '',
  displayOnly: true,
};

const DISPLAY_EXCLUDED = {
  id: 'park-excluded',
  field: 'Status',
  ourValue: '',
  nosposValue: '',
  nosposDisplay: 'Excluded from this run',
  note: '',
  required: false,
  inputKind: 'text',
  options: [],
  patchKind: 'none',
  fieldLabel: '',
  displayOnly: true,
};

/**
 * Tick-mark steps for the park modal: session, open tab, then one row per negotiation line.
 * @param {string[]} lineLabels - e.g. `Item 1 — Gold ring`
 * @param {{
 *   activeIndex?: number|null,
 *   allDone?: boolean,
 *   errorIndex?: number|null,
 *   loginStatus?: string,
 *   openStatus?: string,
 *   itemStepDetails?: Record<number, string>,
 *   excludedItemIds?: Set<string>,
 *   lines?: object[],
 *   parkOpenDetail?: string|null,
 *   nosposCleanup?: { status: string, detail?: string|null }|null,
 *   itemsFillAllDone?: boolean,
 *   parkingAgreementStep?: { status: string, detail?: string|null }|null,
 * }} state
 */
export function buildParkAgreementSystemSteps(lineLabels, state = {}) {
  const {
    activeIndex = null,
    allDone = false,
    errorIndex = null,
    loginStatus = 'done',
    openStatus = 'done',
    itemStepDetails = {},
    excludedItemIds = new Set(),
    lines = [],
    parkOpenDetail = null,
    nosposCleanup = null,
    itemsFillAllDone = false,
    parkingAgreementStep = null,
  } = state;
  const steps = [
    { key: 'login', label: 'Verified NoSpos session', status: loginStatus, detail: null },
    {
      key: 'open',
      label: 'Opened new agreement (new NoSpos tab)',
      status: openStatus,
      detail: parkOpenDetail != null && String(parkOpenDetail).trim() !== '' ? String(parkOpenDetail).trim() : null,
    },
  ];
  if (nosposCleanup && nosposCleanup.status) {
    const cd =
      nosposCleanup.detail != null && String(nosposCleanup.detail).trim() !== ''
        ? String(nosposCleanup.detail).trim()
        : null;
    steps.push({
      key: 'nospos-cleanup',
      label: 'Removing skipped lines on NoSpos',
      status: nosposCleanup.status,
      detail: cd,
    });
  }
  for (let i = 0; i < lineLabels.length; i++) {
    const lineId = lines[i]?.id;
    const isExcluded = lineId != null ? excludedItemIds.has(lineId) : false;
    let status = isExcluded ? 'skipped' : 'pending';
    if (!isExcluded) {
      if (errorIndex != null) {
        if (i < errorIndex) status = 'done';
        else if (i === errorIndex) status = 'error';
      } else if (itemsFillAllDone || parkingAgreementStep) {
        status = 'done';
      } else if (allDone) {
        status = 'done';
      } else if (activeIndex != null && i < activeIndex) {
        status = 'done';
      } else if (activeIndex != null && i === activeIndex) {
        status = 'running';
      }
    }
    const d = itemStepDetails[i];
    const detail =
      isExcluded
        ? 'Excluded from this run — will be skipped on NoSpos.'
        : (typeof d === 'string' && d.trim() !== '' ? d.trim() : null);
    steps.push({
      key: `park-item-${i}`,
      label: lineLabels[i],
      status,
      detail,
      itemIndex: i,
      excluded: isExcluded,
    });
  }
  if (parkingAgreementStep && parkingAgreementStep.status) {
    const pd =
      parkingAgreementStep.detail != null && String(parkingAgreementStep.detail).trim() !== ''
        ? String(parkingAgreementStep.detail).trim()
        : null;
    steps.push({
      key: 'parking-agreement',
      label: 'Parking agreement',
      status: parkingAgreementStep.status,
      detail: pd,
    });
  }
  return steps;
}

/**
 * @param {object} opts
 * @param {Record<number, object[]>} [opts.fieldRowsByItemIndex] - NosPos field rows returned per negotiation line index
 * @param {{ currentLineIndex: number }|null|undefined} [opts.progressive] - while filling: show wait/queued placeholders
 * @param {Set<string>} [opts.excludedItemIds] - item IDs excluded from the current run
 */
export function buildParkItemTablesFromFill({
  lines,
  fieldRows,
  fieldRowsByItemIndex,
  progressive,
  categoryId,
  categoriesResults,
  agreementParkLineTitle,
  excludedItemIds = new Set(),
}) {
  if (!lines?.length) {
    return [
      {
        itemIndex: 0,
        title: 'Items',
        patchEnabled: false,
        footNote: null,
        rows: [
          {
            id: 'empty',
            field: '—',
            ourValue: 'No negotiation lines on this request',
            nosposValue: '',
            nosposDisplay: '—',
            note: '',
            required: false,
            inputKind: 'text',
            options: [],
            patchKind: 'none',
            fieldLabel: '',
            displayOnly: true,
          },
        ],
      },
    ];
  }

  const tables = [];
  const progIdx =
    progressive && typeof progressive.currentLineIndex === 'number'
      ? progressive.currentLineIndex
      : null;

  for (let i = 0; i < lines.length; i++) {
    const title = `Item ${i + 1} — ${agreementParkLineTitle(lines[i], i)}`;
    const cid =
      resolveNosposLeafCategoryIdForAgreementItem(lines[i]) ??
      (i === 0 ? categoryId : null);

    const lineId = lines[i]?.id;
    if (lineId != null && excludedItemIds.has(lineId)) {
      tables.push({
        itemIndex: i,
        title,
        patchEnabled: false,
        footNote: 'This item is excluded from the current run and will not be added to NosPos.',
        excluded: true,
        rows: [{ ...DISPLAY_EXCLUDED }],
      });
      continue;
    }

    const hasFilled = fieldRowsByItemIndex && fieldRowsByItemIndex[i] != null;
    if (hasFilled) {
      const merged = mergeLinkedStockRows(fieldRowsByItemIndex[i], cid, categoriesResults);
      tables.push({
        itemIndex: i,
        title,
        patchEnabled: true,
        footNote: `Edits apply to line ${i + 1} on the NoSpos agreement items tab.`,
        rows: merged,
      });
      continue;
    }

    if (progIdx != null) {
      if (i === progIdx) {
        tables.push({
          itemIndex: i,
          title,
          patchEnabled: false,
          footNote: 'This line is being written on the NoSpos tab now.',
          rows: [{ ...DISPLAY_WAIT }],
        });
        continue;
      }
      if (i > progIdx) {
        tables.push({
          itemIndex: i,
          title,
          patchEnabled: false,
          footNote: 'Will apply after previous lines complete.',
          rows: [{ ...DISPLAY_QUEUED }],
        });
        continue;
      }
    }

    const rowsRaw = i === 0 ? fieldRows || [] : [];
    const merged = mergeLinkedStockRows(rowsRaw, cid, categoriesResults);
    tables.push({
      itemIndex: i,
      title,
      patchEnabled: true,
      footNote: `Edits apply to line ${i + 1} on the NoSpos agreement items tab.`,
      rows: merged,
    });
  }
  return tables;
}
