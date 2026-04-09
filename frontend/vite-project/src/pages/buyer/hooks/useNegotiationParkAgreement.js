import { useCallback, useRef, useState } from "react";

import { fetchNosposCategories, saveParkAgreementState } from "@/services/api";
import {
  checkNosposCustomerBuyingSession,
  openNosposNewAgreementCreateBackground,
  resolveNosposParkAgreementLine,
  deleteExcludedNosposAgreementLines,
  clickNosposSidebarParkAgreement,
  fillNosposParkAgreementCategory,
  fillNosposParkAgreementRest,
  patchNosposAgreementField,
  withExtensionCallTimeout,
  getNosposTabUrl,
  closeNosposParkAgreementTab,
  getParkAgreementLog,
  OPEN_NOSPOS_NEW_AGREEMENT_ITEMS_TAB_TIMEOUT_MS,
} from "@/services/extensionClient";
import { resolveNosposLeafCategoryIdForAgreementItem } from "@/utils/nosposCategoryMappings";
import {
  buildParkAgreementSystemSteps,
  buildParkItemTablesFromFill,
} from "../utils/parkAgreementProgressTables";
import {
  agreementParkLineTitle,
  buildNosposAgreementItemsUrl,
  buildNosposNewAgreementCreateUrl,
  buildParkExtensionItemPayload,
  extractNosposAgreementId,
  parkIncludedSequentialStepIndex,
  parkNegotiationLines,
  parseParkAgreementStateFromApi,
} from "../utils/negotiationParkHelpers";

/** NosPos Park Agreement automation for booked-for-testing (view) mode. */
export function useNegotiationParkAgreement({
  items,
  actualRequestId,
  showNotification,
  researchSandboxBookedView,
  customerData,
  transactionType,
  useVoucherOffers,
}) {
  /** @type {[null | { systemSteps: object[], itemTables: object[]|null, footerError: string|null, allowClose: boolean }, function]} */
  const [parkProgressModal, setParkProgressModal] = useState(null);
  const parkNosposTabRef = useRef(null);
  const parkFlowCategoriesRef = useRef([]);
  const parkFieldRowsByIndexRef = useRef({});
  /** NosPos DOM row index per negotiation line (may differ from item index after reloads). */
  const parkNosposDomLineByItemRef = useRef({});
  const parkRetryInFlightRef = useRef(false);
  const [parkRetryBusyUi, setParkRetryBusyUi] = useState(false);
  /** Indices of negotiation lines excluded from the NosPos park run (persists across runs). */
  const [parkExcludedItems, setParkExcludedItems] = useState(new Set());
  /** Persisted NosPos agreement id for the current request (null = never parked). */
  const [persistedNosposAgreementId, setPersistedNosposAgreementId] = useState(null);
  const parkStateSaveTimerRef = useRef(null);
  /** Accumulated log entries from the last park run (fetched from extension after run ends). */
  const parkLogRef = useRef([]);
  /** Fetch the log from the extension and save it to parkLogRef, then trigger a .txt download. */
  const handleDownloadParkLog = useCallback(async () => {
    let entries = parkLogRef.current || [];
    try {
      const res = await getParkAgreementLog();
      if (res?.ok && Array.isArray(res.entries) && res.entries.length > 0) {
        entries = res.entries;
        parkLogRef.current = entries;
      }
    } catch (_) {}

    if (!entries.length) {
      showNotification('No park agreement log available yet — run Park Agreement first.', 'warning');
      return;
    }

    // Format as human-readable text log
    const pad2 = (n) => String(n).padStart(2, '0');
    const formatRel = (ms) => {
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const millis = ms % 1000;
      return `${pad2(m)}:${pad2(s)}.${String(millis).padStart(3, '0')}`;
    };
    const startIso = entries[0]?.ts ? new Date(entries[0].ts).toISOString() : new Date().toISOString();
    const lines = [
      '=== CG Suite Park Agreement Diagnostic Log ===',
      `Run started:  ${startIso}`,
      `Total entries: ${entries.length}`,
      `Generated:    ${new Date().toISOString()}`,
      '',
    ];
    for (const e of entries) {
      lines.push(`[+${formatRel(e.rel ?? 0)}] ${e.fn ?? '?'} | ${(e.phase ?? '?').toUpperCase()}${e.msg ? '  —  ' + e.msg : ''}`);
      const data = e.data ?? {};
      const keys = Object.keys(data);
      if (keys.length > 0) {
        for (const k of keys) {
          let v = data[k];
          try { v = JSON.stringify(v); } catch (_) { v = String(v); }
          lines.push(`  ${k}: ${v}`);
        }
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cg-park-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [showNotification]);

  const handleParkFieldPatch = useCallback(
    async ({ lineIndex, rowId, patchKind, fieldLabel, value }) => {
      const tabId = parkNosposTabRef.current;
      if (tabId == null) return;
      const domLine =
        parkNosposDomLineByItemRef.current[lineIndex] != null
          ? parkNosposDomLineByItemRef.current[lineIndex]
          : lineIndex;
      try {
        const r = await patchNosposAgreementField({
          tabId,
          lineIndex: domLine,
          patchKind,
          fieldLabel: fieldLabel || '',
          value,
        });
        if (!r?.ok) {
          showNotification(r?.error || 'Could not update NoSpos', 'warning');
          return;
        }
        setParkProgressModal((prev) => {
          if (!prev?.itemTables) return prev;
          const itemTables = prev.itemTables.map((tbl) => {
            if (tbl.itemIndex !== lineIndex) return tbl;
            const rows = tbl.rows.map((row) => {
              if (row.id !== rowId) return row;
              let display = value;
              if (row.inputKind === 'select' && Array.isArray(row.options)) {
                const hit = row.options.find((o) => String(o.value) === String(value));
                if (hit) display = hit.label;
              }
              const nextNote = r.note != null && String(r.note).trim() !== '' ? r.note : row.note;
              return {
                ...row,
                nosposValue: value,
                nosposDisplay: display,
                note: nextNote,
              };
            });
            return { ...tbl, rows };
          });
          return { ...prev, itemTables };
        });
      } catch (e) {
        showNotification(e?.message || 'Extension error', 'warning');
      }
    },
    [showNotification]
  );

  const handleRetryParkLine = useCallback(
    async (lineIndex) => {
      if (parkRetryInFlightRef.current) return;
      const tabId = parkNosposTabRef.current;
      if (tabId == null) {
        showNotification('Run Park Agreement first so a NoSpos tab is available.', 'warning');
        return;
      }
      const lines = parkNegotiationLines(items);
      const line = lines[lineIndex];
      if (!line) {
        showNotification('That line is not in the cart anymore.', 'warning');
        return;
      }
      if (line.id && parkExcludedItems.has(line.id)) {
        showNotification('This line is set to skip NosPos — uncheck Skip NosPos on the row first.', 'warning');
        return;
      }
      parkRetryInFlightRef.current = true;
      setParkRetryBusyUi(true);

      try {
        let categoriesResults = parkFlowCategoriesRef.current;
        if (!Array.isArray(categoriesResults) || categoriesResults.length === 0) {
          const catRes = await fetchNosposCategories().catch(() => ({ results: [] }));
          categoriesResults = catRes?.results || [];
          parkFlowCategoriesRef.current = categoriesResults;
        }

        const lineLabels = lines.map(
          (l, i) => `Item ${i + 1} — ${agreementParkLineTitle(l, i)}`
        );
        const catIdFirst = resolveNosposLeafCategoryIdForAgreementItem(lines[0]);
        const phaseDetails = {};

        const retryExcluded = new Set(parkExcludedItems);
        const applyDetail = (text) => {
          phaseDetails[lineIndex] = text;
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: null,
            itemStepDetails: { ...phaseDetails },
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
              excludedItemIds: retryExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: { currentLineIndex: lineIndex },
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: retryExcluded,
            }),
            allowClose: true,
          }));
        };

        const parkStepIndex = parkIncludedSequentialStepIndex(lines, retryExcluded, lineIndex);
        const itemPayload = buildParkExtensionItemPayload(line, lineIndex, {
          useVoucherOffers,
          categoriesResults,
          requestId: actualRequestId,
          parkSequentialIndex: parkStepIndex,
        });

        applyDetail(
          'Checking NoSpos item descriptions for this line (marker: request + item id)…'
        );
        const r1 = await withExtensionCallTimeout(
          resolveNosposParkAgreementLine({
            tabId,
            stepIndex: parkStepIndex,
            negotiationLineIndex: lineIndex,
            parkNegotiationLineCount: lines.length,
            item: itemPayload,
            // Retry must never click Add — find the existing row (by marker or
            // expected position) and always ensure we are on the items page.
            noAdd: true,
            ensureTab: true,
          }),
          55000,
          'Finding or adding the line on NoSpos timed out — check the NoSpos tab and retry.'
        );
        if (!r1?.ok) {
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: r1?.error || 'Could not resolve this line on NoSpos.',
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              errorIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
            }),
            allowClose: true,
          }));
          showNotification(r1?.error || 'Retry failed.', 'warning');
          return;
        }

        const targetIdx = r1.targetLineIndex;
        parkNosposDomLineByItemRef.current[lineIndex] = targetIdx;

        if (r1.reusedExistingRow) {
          applyDetail(
            'Found this line on NoSpos by marker — checking and filling missing fields only (no Add / no category reset)…'
          );
        } else if (r1.didClickAdd) {
          applyDetail(
            'Pressed Add item — waited for NosPos to reload (up to 20s). Setting category…'
          );
        } else {
          applyDetail('Using the target row — setting category…');
        }

        let rCat = { ok: true, categoryLabel: null, restLineIndex: targetIdx };
        if (!r1.reusedExistingRow) {
          rCat = await withExtensionCallTimeout(
            fillNosposParkAgreementCategory({
              tabId,
              lineIndex: targetIdx,
              item: itemPayload,
            }),
            90000,
            'Setting category on NoSpos timed out.'
          );
          if (!rCat?.ok) {
            setParkProgressModal((prev) => ({
              ...prev,
              footerError: rCat?.error || 'Could not set category on NoSpos.',
              systemSteps: buildParkAgreementSystemSteps(lineLabels, {
                errorIndex: lineIndex,
                loginStatus: 'done',
                openStatus: 'done',
                itemStepDetails: { ...phaseDetails },
              }),
              itemTables: buildParkItemTablesFromFill({
                lines,
                fieldRows: [],
                fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
                progressive: undefined,
                categoryId: catIdFirst,
                categoriesResults,
                agreementParkLineTitle,
              }),
              allowClose: true,
            }));
            showNotification(rCat?.error || 'Category step failed.', 'warning');
            return;
          }
        }

        applyDetail(
          'Category set — NosPos may have reloaded (up to 20s). Filling name, description, prices, quantity, and stock fields…'
        );

        const lineForRestRetry =
          rCat.restLineIndex != null && rCat.restLineIndex >= 0
            ? rCat.restLineIndex
            : targetIdx;
        parkNosposDomLineByItemRef.current[lineIndex] = lineForRestRetry;

        const rRest = await withExtensionCallTimeout(
          fillNosposParkAgreementRest({
            tabId,
            lineIndex: lineForRestRetry,
            item: itemPayload,
            categoryLabel: rCat.categoryLabel ?? null,
          }),
          120000,
          'Filling fields on NoSpos timed out.'
        );
        if (!rRest?.ok) {
          setParkProgressModal((prev) => ({
            ...prev,
            footerError: rRest?.error || 'Could not fill fields on NoSpos.',
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              errorIndex: lineIndex,
              loginStatus: 'done',
              openStatus: 'done',
              itemStepDetails: { ...phaseDetails },
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
            }),
            allowClose: true,
          }));
          showNotification(rRest?.error || 'Fill step failed.', 'warning');
          return;
        }

        if (Array.isArray(rRest.fieldRows) && rRest.fieldRows.length > 0) {
          parkFieldRowsByIndexRef.current = {
            ...parkFieldRowsByIndexRef.current,
            [lineIndex]: rRest.fieldRows,
          };
        }
        phaseDetails[lineIndex] = 'Filled all fields on NoSpos for this line.';
        setParkProgressModal((prev) => ({
          ...prev,
          footerError: null,
          itemStepDetails: { ...phaseDetails },
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            allDone: true,
            loginStatus: 'done',
            openStatus: 'done',
            itemStepDetails: { ...phaseDetails },
            excludedItemIds: retryExcluded,
            lines,
          }),
          itemTables: buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
            progressive: undefined,
            categoryId: catIdFirst,
            categoriesResults,
            agreementParkLineTitle,
            excludedItemIds: retryExcluded,
          }),
          allowClose: true,
        }));
        showNotification(`Item ${lineIndex + 1} re-synced on NoSpos.`, 'success');
      } catch (e) {
        showNotification(e?.message || 'Retry failed.', 'error');
      } finally {
        parkRetryInFlightRef.current = false;
        setParkRetryBusyUi(false);
      }
    },
    [items, useVoucherOffers, actualRequestId, showNotification, parkExcludedItems]
  );

  /** Debounced persist of park state (excluded items + NosPos agreement id) to the DB. */
  const scheduleParkStateSave = useCallback((agreementId, excludedSet) => {
    if (!actualRequestId || !researchSandboxBookedView) return;
    if (parkStateSaveTimerRef.current) clearTimeout(parkStateSaveTimerRef.current);
    parkStateSaveTimerRef.current = setTimeout(() => {
      const excludedItemIds = items
        .filter((item) => excludedSet.has(item.id))
        .map((item) => String(item.request_item_id ?? item.id))
        .filter((s) => s && s !== 'undefined' && s !== 'null');
      saveParkAgreementState(actualRequestId, {
        nosposAgreementId: agreementId ?? null,
        excludedItemIds,
      }).catch(() => {});
    }, 800);
  }, [actualRequestId, researchSandboxBookedView, items]);

  /** Opens the saved NosPos agreement items URL in a new browser tab only (no extension). */
  const handleViewParkedAgreement = useCallback(() => {
    const urlToOpen = buildNosposAgreementItemsUrl(persistedNosposAgreementId);
    if (!urlToOpen) {
      showNotification(
        'No parked agreement id saved yet. Finish a park run so the NoSpos id is stored, then try again.',
        'warning'
      );
      return;
    }
    window.open(urlToOpen, '_blank', 'noopener,noreferrer');
  }, [persistedNosposAgreementId, showNotification]);

  const handleToggleParkExcludeItem = useCallback((itemIndex) => {
    setParkExcludedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemIndex)) {
        next.delete(itemIndex);
      } else {
        next.add(itemIndex);
      }
      scheduleParkStateSave(persistedNosposAgreementId, next);
      return next;
    });
  }, [scheduleParkStateSave, persistedNosposAgreementId]);

  const handleParkAgreementOpenNospos = useCallback(() => {
    if (!researchSandboxBookedView) return;
    const nid = customerData?.nospos_customer_id;
    if (!buildNosposNewAgreementCreateUrl(nid, transactionType)) {
      showNotification('No NoSpos customer id on file for this request.', 'warning');
      return;
    }
    const agreementType = transactionType === 'buyback' ? 'PA' : 'DP';
    const lines = parkNegotiationLines(items);
    const firstLine = lines[0];
    const lineLabels = lines.map(
      (l, i) => `Item ${i + 1} — ${agreementParkLineTitle(l, i)}`
    );

    parkNosposTabRef.current = null;
    // Keep field rows from previous run so the modal shows existing data immediately.
    // Only reset the DOM-line map since it is tab-specific.
    parkNosposDomLineByItemRef.current = {};
    const prevFieldRowsByIndex = { ...parkFieldRowsByIndexRef.current };
    const catIdForSeed = lines[0] ? resolveNosposLeafCategoryIdForAgreementItem(lines[0]) : null;
    const catResultsForSeed = parkFlowCategoriesRef.current || [];
    const currentExcluded = new Set(parkExcludedItems);
    setParkProgressModal({
      systemSteps: buildParkAgreementSystemSteps(lineLabels, {
        activeIndex: null,
        loginStatus: 'running',
        openStatus: 'pending',
        excludedItemIds: currentExcluded,
        lines,
      }),
      itemTables: Object.keys(prevFieldRowsByIndex).length > 0
        ? buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: prevFieldRowsByIndex,
            progressive: undefined,
            categoryId: catIdForSeed,
            categoriesResults: catResultsForSeed,
            agreementParkLineTitle,
            excludedItemIds: currentExcluded,
          })
        : null,
      footerError: null,
      allowClose: false,
      itemStepDetails: {},
    });

    void (async () => {
      try {
        const check = await withExtensionCallTimeout(
          checkNosposCustomerBuyingSession(nid),
          undefined,
          'NoSpos did not respond in time — make sure the Chrome extension is active and try again.'
        );
        if (check?.loginRequired) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'error',
              openStatus: 'pending',
            }),
            itemTables: null,
            footerError: 'Sign in at nospos.com in this browser, then try Park Agreement again.',
            allowClose: true,
          });
          showNotification(
            'NosPos needs you to be logged in first. Sign in at nospos.com in Chrome, then try Park Agreement again.',
            'error'
          );
          return;
        }
        if (!check?.ok) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'error',
              openStatus: 'pending',
            }),
            itemTables: null,
            footerError: check?.error || 'Session check failed.',
            allowClose: true,
          });
          showNotification(check?.error || 'Could not verify NoSpos.', 'warning');
          return;
        }

        setParkProgressModal({
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            activeIndex: null,
            loginStatus: 'done',
            openStatus: 'running',
          }),
          itemTables: null,
          footerError: null,
          allowClose: false,
        });

        const opened = await withExtensionCallTimeout(
          openNosposNewAgreementCreateBackground(nid, { agreementType }),
          OPEN_NOSPOS_NEW_AGREEMENT_ITEMS_TAB_TIMEOUT_MS,
          'NoSpos did not open the agreement items page in time — check the NoSpos tab and try again.'
        );
        if (!opened?.ok || opened.tabId == null) {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'error',
            }),
            itemTables: null,
            footerError: opened?.error || 'Could not open NoSpos.',
            allowClose: true,
          });
          showNotification(opened?.error || 'Could not open NoSpos.', 'warning');
          return;
        }
        const {
          tabId,
          agreementItemsUrl: openedAgreementItemsUrl,
          agreementItemsUrlWarning,
        } = opened;
        const openedAgreementId = extractNosposAgreementId(openedAgreementItemsUrl);
        const parkOpenDetail = openedAgreementId
          ? `Agreement ID: ${openedAgreementId}`
          : null;
        if (agreementItemsUrlWarning && !openedAgreementId) {
          showNotification(String(agreementItemsUrlWarning), 'warning');
        }
        if (openedAgreementId) {
          setPersistedNosposAgreementId(openedAgreementId);
          scheduleParkStateSave(openedAgreementId, currentExcluded);
        }

        const catRes = await fetchNosposCategories().catch(() => ({ results: [] }));
        const categoriesResults = catRes?.results || [];
        parkFlowCategoriesRef.current = categoriesResults;
        const itemPayloads = lines.map((line, idx) =>
          buildParkExtensionItemPayload(line, idx, {
            useVoucherOffers,
            categoriesResults,
            requestId: actualRequestId,
            parkSequentialIndex: parkIncludedSequentialStepIndex(lines, currentExcluded, idx),
          })
        );

        if (!firstLine) {
          parkNosposTabRef.current = tabId;
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps([], { allDone: true, parkOpenDetail }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              categoryId: null,
              categoriesResults,
              agreementParkLineTitle,
            }),
            footerError: null,
            allowClose: true,
          });
          return;
        }

        const catIdFirst = resolveNosposLeafCategoryIdForAgreementItem(firstLine);
        const itemStepDetails = {};
        /** Shown as its own Progress step (spinner while running). */
        let nosposCleanupStep = null;

        const excludedRequestItemIds = [
          ...new Set(
            lines
              .filter((line) => line?.id && currentExcluded.has(line.id))
              .map((line) => {
                const rid = line.request_item_id;
                if (rid == null || String(rid).trim() === '') return null;
                const s = String(rid).trim();
                return /^\d+$/.test(s) ? s : null;
              })
              .filter(Boolean)
          ),
        ];
        if (excludedRequestItemIds.length > 0) {
          const nDel = excludedRequestItemIds.length;
          nosposCleanupStep = {
            status: 'running',
            detail: `Deleting ${nDel} skipped line(s) on NoSpos (match \`-RI-{id}-\` in item description, then Actions → Delete). Waiting for reloads after each removal (~20s each). Keep the NoSpos tab open.`,
          };
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'done',
              parkOpenDetail,
              nosposCleanup: nosposCleanupStep,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: null,
            allowClose: false,
          });
          const cleanupBudgetMs = 90000 + excludedRequestItemIds.length * 28000;
          try {
            const delRes = await withExtensionCallTimeout(
              deleteExcludedNosposAgreementLines({
                tabId,
                requestItemIds: excludedRequestItemIds,
              }),
              cleanupBudgetMs,
              'Removing skipped items on NoSpos took too long — finish deletes in the NoSpos tab if needed.'
            );
            nosposCleanupStep = {
              status: 'done',
              detail:
                delRes?.deleted?.length > 0
                  ? `Done — removed ${delRes.deleted.length} row(s) on NoSpos. Continuing with included lines…`
                  : 'Done — no matching rows on NoSpos (already deleted or never parked). Continuing…',
            };
            if (delRes?.deleted?.length) {
              showNotification(
                `Removed ${delRes.deleted.length} skipped item(s) from the NoSpos agreement.`,
                'success'
              );
            }
          } catch (e) {
            nosposCleanupStep = {
              status: 'error',
              detail: String(
                e?.message ||
                  'Cleanup timed out or failed — remove skipped rows manually on NoSpos if needed. Continuing with included lines…'
              ),
            };
            showNotification(
              e?.message ||
                'Could not remove all skipped rows from NoSpos — delete them manually if they still appear.',
              'warning'
            );
          }
          parkNosposDomLineByItemRef.current = {};
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: null,
              loginStatus: 'done',
              openStatus: 'done',
              parkOpenDetail,
              nosposCleanup: nosposCleanupStep,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: undefined,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: null,
            allowClose: false,
          });
        }

        let itemsFillAllDone = false;
        let parkingAgreementStep = null;

        const refreshModal = (i, patch = {}) => {
          setParkProgressModal({
            systemSteps: buildParkAgreementSystemSteps(lineLabels, {
              activeIndex: patch.errorIndex != null ? null : i,
              loginStatus: 'done',
              openStatus: 'done',
              parkOpenDetail,
              errorIndex: patch.errorIndex,
              allDone: patch.allDone,
              itemStepDetails: { ...itemStepDetails },
              excludedItemIds: currentExcluded,
              lines,
              nosposCleanup: nosposCleanupStep,
              itemsFillAllDone,
              parkingAgreementStep,
            }),
            itemTables: buildParkItemTablesFromFill({
              lines,
              fieldRows: [],
              fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
              progressive: patch.progressive,
              categoryId: catIdFirst,
              categoriesResults,
              agreementParkLineTitle,
              excludedItemIds: currentExcluded,
            }),
            footerError: patch.footerError ?? null,
            allowClose: patch.allowClose ?? false,
            itemStepDetails: { ...itemStepDetails },
          });
        };

        for (let i = 0; i < itemPayloads.length; i++) {
          // Skip items the user has chosen to exclude from this run (matched by item ID).
          if (lines[i]?.id && currentExcluded.has(lines[i].id)) {
            itemStepDetails[i] = 'Excluded from this run — skipped on NoSpos.';
            refreshModal(i + 1, { progressive: { currentLineIndex: i + 1 } });
            continue;
          }

          const setLineDetail = (text) => {
            itemStepDetails[i] = text;
            refreshModal(i, { progressive: { currentLineIndex: i } });
          };

          setLineDetail(
            'Checking NoSpos item descriptions for this line (marker: request + item id)…'
          );

          const parkStepIndex = parkIncludedSequentialStepIndex(lines, currentExcluded, i);
          const resolveTimeoutMs = 55000;
          const r1 = await withExtensionCallTimeout(
            resolveNosposParkAgreementLine({
              tabId,
              stepIndex: parkStepIndex,
              negotiationLineIndex: i,
              parkNegotiationLineCount: lines.length,
              item: itemPayloads[i],
            }),
            resolveTimeoutMs,
            `Item ${i + 1}: finding or adding the line on NoSpos timed out.`
          );

          if (!r1?.ok) {
            parkNosposTabRef.current = tabId;
            refreshModal(i, {
              progressive: undefined,
              footerError: r1?.error || `Could not complete item ${i + 1} on NoSpos.`,
              allowClose: true,
              errorIndex: i,
            });
            showNotification(
              r1?.error || `Could not complete item ${i + 1} on NoSpos.`,
              'warning'
            );
            return;
          }

          const targetIdx = r1.targetLineIndex;
          parkNosposDomLineByItemRef.current[i] = targetIdx;

          if (r1.reusedExistingRow) {
            setLineDetail(
              'Found this line on NoSpos by marker — checking and filling missing fields only (no Add / no category reset)…'
            );
          } else if (r1.didClickAdd) {
            setLineDetail(
              'Pressed Add item — waited for NosPos to reload (up to 20s). Setting category…'
            );
          } else {
            setLineDetail('Using the target row — setting category…');
          }

          let rCat = { ok: true, categoryLabel: null, restLineIndex: targetIdx };
          if (!r1.reusedExistingRow) {
            rCat = await withExtensionCallTimeout(
              fillNosposParkAgreementCategory({
                tabId,
                lineIndex: targetIdx,
                item: itemPayloads[i],
              }),
              90000,
              `Item ${i + 1}: category step timed out on NoSpos.`
            );

            if (!rCat?.ok) {
              parkNosposTabRef.current = tabId;
              refreshModal(i, {
                progressive: undefined,
                footerError: rCat?.error || `Could not set category for item ${i + 1} on NoSpos.`,
                allowClose: true,
                errorIndex: i,
              });
              showNotification(
                rCat?.error || `Could not set category for item ${i + 1} on NoSpos.`,
                'warning'
              );
              return;
            }
          }

          setLineDetail(
            'Category set — NosPos may reload (up to 20s). Filling name, description, prices, quantity, and stock fields…'
          );

          const lineForRest =
            rCat.restLineIndex != null && rCat.restLineIndex >= 0
              ? rCat.restLineIndex
              : targetIdx;
          parkNosposDomLineByItemRef.current[i] = lineForRest;

          const stepTimeoutMs = Math.min(180000, 75000 + (itemPayloads[i].stockFields?.length || 0) * 8000);
          const rRest = await withExtensionCallTimeout(
            fillNosposParkAgreementRest({
              tabId,
              lineIndex: lineForRest,
              item: itemPayloads[i],
              categoryLabel: rCat.categoryLabel ?? null,
            }),
            stepTimeoutMs,
            `Item ${i + 1} took too long filling fields on NoSpos. Check the NoSpos tab or use Retry on that line.`
          );

          if (!rRest?.ok) {
            parkNosposTabRef.current = tabId;
            refreshModal(i, {
              progressive: undefined,
              footerError: rRest?.error || `Could not complete item ${i + 1} on NoSpos.`,
              allowClose: true,
              errorIndex: i,
            });
            showNotification(
              rRest?.error || `Could not complete item ${i + 1} on NoSpos.`,
              'warning'
            );
            return;
          }

          if (Array.isArray(rRest.fieldRows) && rRest.fieldRows.length > 0) {
            parkFieldRowsByIndexRef.current[i] = rRest.fieldRows;
          }
          itemStepDetails[i] = 'Filled all fields on NoSpos for this line.';
          refreshModal(i, { progressive: { currentLineIndex: i } });
        }

        itemsFillAllDone = true;
        parkingAgreementStep = {
          status: 'running',
          detail:
            'NoSpos: Next → Agreement → Actions → Park Agreement → confirm. Waiting until the tab shows nospos.com/buying…',
        };
        setParkProgressModal({
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            activeIndex: null,
            loginStatus: 'done',
            openStatus: 'done',
            parkOpenDetail,
            itemStepDetails: { ...itemStepDetails },
            excludedItemIds: currentExcluded,
            lines,
            nosposCleanup: nosposCleanupStep,
            itemsFillAllDone,
            parkingAgreementStep,
          }),
          itemTables: buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
            progressive: undefined,
            categoryId: catIdFirst,
            categoriesResults,
            agreementParkLineTitle,
            excludedItemIds: currentExcluded,
          }),
          footerError: null,
          allowClose: false,
          itemStepDetails: { ...itemStepDetails },
        });

        let parkOk = false;
        let parkErr = null;
        try {
          const parkSidebarRes = await withExtensionCallTimeout(
            clickNosposSidebarParkAgreement({ tabId }),
            130000,
            'Parking the agreement on NoSpos timed out — the tab should end on nospos.com/buying when Park succeeds.'
          );
          parkOk = !!parkSidebarRes?.ok;
          parkErr = parkSidebarRes?.error || null;
          if (!parkSidebarRes?.ok) {
            showNotification(
              parkSidebarRes?.error ||
                'Could not finish Park Agreement in the NoSpos sidebar — use Actions → Park Agreement there.',
              'warning'
            );
          }
        } catch (e) {
          parkErr = e?.message || null;
          showNotification(
            e?.message ||
              'Could not finish Park Agreement on NoSpos — use Actions → Park Agreement there.',
            'warning'
          );
        }

        parkingAgreementStep = parkOk
          ? {
              status: 'done',
              detail: 'NoSpos reached https://nospos.com/buying — parking finished.',
            }
          : {
              status: 'error',
              detail:
                parkErr ||
                'Parking did not complete — use Actions → Park Agreement on NoSpos or check the tab.',
            };

        parkNosposTabRef.current = tabId;
        setParkProgressModal({
          systemSteps: buildParkAgreementSystemSteps(lineLabels, {
            allDone: true,
            loginStatus: 'done',
            openStatus: 'done',
            parkOpenDetail,
            itemStepDetails: { ...itemStepDetails },
            excludedItemIds: currentExcluded,
            lines,
            nosposCleanup: nosposCleanupStep,
            itemsFillAllDone,
            parkingAgreementStep,
          }),
          itemTables: buildParkItemTablesFromFill({
            lines,
            fieldRows: [],
            fieldRowsByItemIndex: { ...parkFieldRowsByIndexRef.current },
            progressive: undefined,
            categoryId: catIdFirst,
            categoriesResults,
            agreementParkLineTitle,
            excludedItemIds: currentExcluded,
          }),
          footerError: null,
          allowClose: true,
          itemStepDetails: { ...itemStepDetails },
        });

        // If the tab is still on an agreement workflow URL, persist its agreement id.
        try {
          const tabUrlResult = await getNosposTabUrl(tabId);
          const capturedUrl = tabUrlResult?.ok && tabUrlResult.url ? tabUrlResult.url : null;
          const capturedAgreementId = extractNosposAgreementId(capturedUrl);
          if (capturedAgreementId) {
            setPersistedNosposAgreementId(capturedAgreementId);
            scheduleParkStateSave(capturedAgreementId, currentExcluded);
          }
        } catch (_) {}

        if (parkOk) {
          void closeNosposParkAgreementTab(tabId).catch(() => {});
          parkNosposTabRef.current = null;
        }

        // Fetch the diagnostic log from the extension after the run settles.
        try {
          const logRes = await getParkAgreementLog();
          if (logRes?.ok && Array.isArray(logRes.entries)) {
            parkLogRef.current = logRes.entries;
          }
        } catch (_) {}

        showNotification(
          lines.length === 1
            ? 'Line updated in NoSpos. Review the table below or edit values.'
            : `${lines.length} lines updated in NoSpos. Review the tables below or edit values.`,
          'success'
        );
      } catch (err) {
        // Fetch the diagnostic log even on error so it can be downloaded for debugging.
        try {
          const logRes = await getParkAgreementLog();
          if (logRes?.ok && Array.isArray(logRes.entries)) {
            parkLogRef.current = logRes.entries;
          }
        } catch (_) {}

        setParkProgressModal((prev) =>
          prev
            ? { ...prev, footerError: err?.message || 'Extension error', allowClose: true }
            : {
                systemSteps: buildParkAgreementSystemSteps(lineLabels, {
                  activeIndex: null,
                  loginStatus: 'error',
                  openStatus: 'pending',
                }),
                itemTables: null,
                footerError: err?.message || 'Extension error',
                allowClose: true,
              }
        );
        showNotification(
          err?.message ||
            'Chrome extension is required for Park Agreement, or the request timed out — try again.',
          'error'
        );
      }
    })();
  }, [
    items,
    researchSandboxBookedView,
    customerData?.nospos_customer_id,
    transactionType,
    showNotification,
    useVoucherOffers,
    actualRequestId,
    parkExcludedItems,
  ]);

  const hydrateFromSavedState = useCallback((parkState, mappedItems) => {
    const { agreementId, excludedIds } = parseParkAgreementStateFromApi(parkState, mappedItems);
    if (agreementId) setPersistedNosposAgreementId(agreementId);
    if (excludedIds) setParkExcludedItems(excludedIds);
  }, []);

  return {
    parkProgressModal,
    setParkProgressModal,
    parkRetryBusyUi,
    parkExcludedItems,
    persistedNosposAgreementId,
    handleParkFieldPatch,
    handleRetryParkLine,
    handleViewParkedAgreement,
    handleToggleParkExcludeItem,
    handleParkAgreementOpenNospos,
    handleDownloadParkLog,
    hydrateFromSavedState,
    parkNosposTabRef,
  };
}
