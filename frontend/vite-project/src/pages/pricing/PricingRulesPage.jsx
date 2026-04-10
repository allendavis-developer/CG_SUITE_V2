import React, { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/AppHeader';
import {
  fetchPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  fetchAllCategoriesFlat,
  fetchCustomerOfferRules,
  updateCustomerOfferRule,
  updateCustomerRuleSettings,
  fetchNosposCategoryMappings,
  createNosposCategoryMapping,
  updateNosposCategoryMapping,
  deleteNosposCategoryMapping,
} from '@/services/api';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';
import { CUSTOMER_TYPE_LABELS } from '@/utils/customerOfferRules';
import { SPREADSHEET_TABLE_STYLES } from '@/styles/spreadsheetTableStyles';
import { parseNosposPath } from '@/utils/nosposCategoryMappings';

const inputFocus =
  'focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)] focus:border-[var(--brand-blue)]';
const btnPrimary =
  'px-4 py-2 text-xs font-bold uppercase tracking-wide bg-[var(--brand-blue)] text-white border border-[var(--brand-blue)] hover:bg-[var(--brand-blue-hover)] disabled:opacity-50';
const btnSecondary =
  'px-4 py-2 text-xs font-bold uppercase tracking-wide border border-[var(--ui-border)] text-[var(--text-muted)] hover:bg-[var(--brand-blue-alpha-05)]';

function fmtMultiplier(v) {
  return v != null ? `${(v * 100).toFixed(1)}%` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(1)}%` : <span className="italic text-[var(--text-muted)]">default</span>;
}

function scopeLabel(rule) {
  if (rule.is_global_default) return 'Global Default';
  if (rule.category) return rule.category.name;
  return '—';
}

function scopeType(rule) {
  if (rule.is_global_default) return 'global';
  return 'category';
}

// ─── Add / Edit Modal ────────────────────────────────────────────────────────

function RuleModal({ rule, categories, onClose, onSaved }) {
  const { showNotification } = useNotification();
  const isEditing = Boolean(rule);

  const [scopeKind, setScopeKind] = useState(
    isEditing ? scopeType(rule) : 'global'
  );
  const [categoryId, setCategoryId] = useState(
    isEditing && rule.category ? String(rule.category.id) : ''
  );
  const [sellPct, setSellPct] = useState(
    isEditing ? String((rule.sell_price_multiplier * 100).toFixed(2)) : '85'
  );
  const [firstOfferPct, setFirstOfferPct] = useState(
    isEditing && rule.first_offer_pct_of_cex != null
      ? String(rule.first_offer_pct_of_cex)
      : ''
  );
  const [secondOfferPct, setSecondOfferPct] = useState(
    isEditing && rule.second_offer_pct_of_cex != null
      ? String(rule.second_offer_pct_of_cex)
      : ''
  );
  const [thirdOfferPct, setThirdOfferPct] = useState(
    isEditing && rule.third_offer_pct_of_cex != null
      ? String(rule.third_offer_pct_of_cex)
      : ''
  );
  const [ebayMargin1, setEbayMargin1] = useState(
    isEditing && rule.ebay_offer_margin_1_pct != null
      ? String(rule.ebay_offer_margin_1_pct)
      : ''
  );
  const [ebayMargin2, setEbayMargin2] = useState(
    isEditing && rule.ebay_offer_margin_2_pct != null
      ? String(rule.ebay_offer_margin_2_pct)
      : ''
  );
  const [ebayMargin3, setEbayMargin3] = useState(
    isEditing && rule.ebay_offer_margin_3_pct != null
      ? String(rule.ebay_offer_margin_3_pct)
      : ''
  );
  const [ebayMargin4, setEbayMargin4] = useState(
    isEditing && rule.ebay_offer_margin_4_pct != null
      ? String(rule.ebay_offer_margin_4_pct)
      : ''
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const multiplierVal = parseFloat(sellPct);
    if (isNaN(multiplierVal) || multiplierVal <= 0 || multiplierVal > 200) {
      showNotification('Sale price % must be a number between 1 and 200', 'error');
      return;
    }
    if (scopeKind === 'category' && !categoryId) {
      showNotification('Please select a category', 'error');
      return;
    }

    const cexFields = [
      { label: '1st offer %', val: firstOfferPct },
      { label: '2nd offer %', val: secondOfferPct },
      { label: '3rd offer %', val: thirdOfferPct },
    ];
    for (const f of cexFields) {
      if (f.val === '' || isNaN(parseFloat(f.val))) {
        showNotification(`${f.label} is required`, 'error');
        return;
      }
    }

    const ebayFields = [
      { label: 'eBay/CC 1st %', val: ebayMargin1 },
      { label: 'eBay/CC 2nd %', val: ebayMargin2 },
      { label: 'eBay/CC 3rd %', val: ebayMargin3 },
      { label: 'eBay/CC 4th %', val: ebayMargin4 },
    ];
    for (const f of ebayFields) {
      if (f.val === '' || isNaN(parseFloat(f.val))) {
        showNotification(`${f.label} is required`, 'error');
        return;
      }
    }

    const payload = {
      sell_price_multiplier: (multiplierVal / 100).toFixed(4),
      first_offer_pct_of_cex: parseFloat(firstOfferPct),
      second_offer_pct_of_cex: parseFloat(secondOfferPct),
      third_offer_pct_of_cex: parseFloat(thirdOfferPct),
      ebay_offer_margin_1_pct: parseFloat(ebayMargin1),
      ebay_offer_margin_2_pct: parseFloat(ebayMargin2),
      ebay_offer_margin_3_pct: parseFloat(ebayMargin3),
      ebay_offer_margin_4_pct: parseFloat(ebayMargin4),
      is_global_default: scopeKind === 'global',
    };
    if (scopeKind === 'category') payload.category_id = Number(categoryId);

    setSaving(true);
    try {
      let saved;
      if (isEditing) {
        saved = await updatePricingRule(rule.id, {
          sell_price_multiplier: payload.sell_price_multiplier,
          first_offer_pct_of_cex: payload.first_offer_pct_of_cex,
          second_offer_pct_of_cex: payload.second_offer_pct_of_cex,
          third_offer_pct_of_cex: payload.third_offer_pct_of_cex,
          ebay_offer_margin_1_pct: payload.ebay_offer_margin_1_pct,
          ebay_offer_margin_2_pct: payload.ebay_offer_margin_2_pct,
          ebay_offer_margin_3_pct: payload.ebay_offer_margin_3_pct,
          ebay_offer_margin_4_pct: payload.ebay_offer_margin_4_pct,
        });
      } else {
        saved = await createPricingRule(payload);
      }
      showNotification(isEditing ? 'Rule updated' : 'Rule created', 'success');
      onSaved(saved);
    } catch (err) {
      showNotification(err.message || 'Failed to save rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="cg-animate-modal-backdrop absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="cg-animate-modal-panel relative z-10 flex w-full max-w-lg flex-col overflow-hidden border border-[var(--ui-border)] bg-white shadow-lg">
        <header
          className="flex items-center justify-between px-6 py-3 text-white"
          style={{ background: 'var(--brand-blue)' }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wider">
            {isEditing ? 'Edit pricing rule' : 'Add pricing rule'}
            </h2>
          <button type="button" onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>

        <div className="flex max-h-[min(85vh,640px)] flex-col gap-4 overflow-y-auto px-6 py-5">

          {/* Scope — only shown when creating */}
          {!isEditing && (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'global', label: 'Global default' },
                  { v: 'category', label: 'Category' },
                ].map(({ v, label }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setScopeKind(v)}
                    className={`border py-2.5 text-xs font-semibold transition-colors ${
                      scopeKind === v
                        ? 'border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] text-[var(--brand-blue)]'
                        : 'border-[var(--ui-border)] text-[var(--text-muted)] hover:border-[var(--brand-blue-alpha-30)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category picker — shown when creating a category rule */}
          {!isEditing && scopeKind === 'category' && (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={`w-full border border-[var(--ui-border)] bg-white px-3 py-2 text-sm ${inputFocus}`}
              >
                <option value="">— Select category —</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={String(c.category_id)}>
                    {'—'.repeat(c.depth)}{c.depth > 0 ? ' ' : ''}{c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sale price % */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Sale price (% of CeX sell)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="200"
                step="0.1"
                value={sellPct}
                onChange={(e) => setSellPct(e.target.value)}
                className={`w-full border border-[var(--ui-border)] px-3 py-2 pr-10 text-sm ${inputFocus}`}
                placeholder="e.g. 85"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">
                %
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { label: '1st offer % of CeX cash', value: firstOfferPct, setter: setFirstOfferPct, placeholder: 'e.g. 80' },
              { label: '2nd offer % of CeX cash', value: secondOfferPct, setter: setSecondOfferPct, placeholder: 'e.g. 85' },
              { label: '3rd offer % of CeX cash', value: thirdOfferPct, setter: setThirdOfferPct, placeholder: 'e.g. 90' },
            ].map(({ label, value, setter, placeholder }) => (
              <div key={label}>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {label}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="200"
                    step="0.1"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    className={`w-full border border-[var(--ui-border)] px-3 py-2 pr-8 text-sm ${inputFocus}`}
                    placeholder={placeholder}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--ui-border)] pt-4">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              eBay / Cash Converters — % of suggested sale
            </label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: '1st', value: ebayMargin1, setter: setEbayMargin1, placeholder: 'e.g. 40' },
                { label: '2nd', value: ebayMargin2, setter: setEbayMargin2, placeholder: 'e.g. 50' },
                { label: '3rd', value: ebayMargin3, setter: setEbayMargin3, placeholder: 'e.g. 60' },
                { label: '4th', value: ebayMargin4, setter: setEbayMargin4, placeholder: 'e.g. 70' },
              ].map(({ label, value, setter, placeholder }) => (
                <div key={label}>
                  <label className="mb-1 block text-[10px] font-semibold text-[var(--text-muted)]">{label}</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className={`w-full border border-[var(--ui-border)] px-3 py-2 pr-10 text-sm ${inputFocus}`}
                      placeholder={placeholder}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--ui-border)] bg-[var(--ui-bg)] px-6 py-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : isEditing ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

function fmtEbayOfferPctQuad(m1, m2, m3, m4) {
  if (m1 == null && m2 == null && m3 == null && m4 == null) {
    return <span className="italic text-[var(--text-muted)]">40 / 50 / 60 / 70</span>;
  }
  const f = (v, d) => (v != null ? `${Number(v).toFixed(0)}` : d);
  return `${f(m1, '40')} / ${f(m2, '50')} / ${f(m3, '60')} / ${f(m4, '70')}`;
}

function RuleRow({ rule, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const { showNotification } = useNotification();

  const handleDelete = async () => {
    try {
      await onDelete(rule.id);
      showNotification('Rule deleted', 'success');
    } catch (err) {
      showNotification(err.message || 'Failed to delete', 'error');
    }
    setConfirming(false);
  };

  return (
    <tr>
      <td className="text-sm font-medium text-[var(--text-main)]">{scopeLabel(rule)}</td>
      <td className="font-mono text-sm font-semibold tabular-nums" style={{ color: 'var(--brand-blue)' }}>
        {fmtMultiplier(rule.sell_price_multiplier)}
      </td>
      <td className="font-mono text-sm tabular-nums text-[var(--text-main)]">{fmtPct(rule.first_offer_pct_of_cex)}</td>
      <td className="font-mono text-sm tabular-nums text-[var(--text-main)]">{fmtPct(rule.second_offer_pct_of_cex)}</td>
      <td className="font-mono text-sm tabular-nums text-[var(--text-main)]">{fmtPct(rule.third_offer_pct_of_cex)}</td>
      <td className="font-mono text-sm tabular-nums text-[var(--text-main)]">
        {fmtEbayOfferPctQuad(
          rule.ebay_offer_margin_1_pct,
          rule.ebay_offer_margin_2_pct,
          rule.ebay_offer_margin_3_pct,
          rule.ebay_offer_margin_4_pct
        )}
      </td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-1">
          {confirming ? (
            <>
              <span className="mr-1 text-xs font-semibold text-[var(--text-muted)]">Delete?</span>
              <button
                type="button"
                onClick={handleDelete}
                className="border border-[var(--ui-border)] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-main)] hover:bg-[var(--brand-blue-alpha-05)]"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="border border-[var(--ui-border)] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--ui-bg)]"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onEdit(rule)}
                title="Edit"
                className="flex size-8 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--brand-blue-alpha-08)] hover:text-[var(--brand-blue)]"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                title="Delete"
                className="flex size-8 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--brand-blue-alpha-08)] hover:text-[var(--brand-blue)]"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Rules Section ────────────────────────────────────────────────────────────

function RulesSection({ title, rules, onEdit, onDelete, emptyText }) {
  if (rules.length === 0) {
    return (
      <div className="mb-8">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-blue">{title}</h3>
        <div className="border border-dashed border-[var(--ui-border)] bg-white py-8 text-center text-sm text-[var(--text-muted)]">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-blue">
        {title}{' '}
        <span className="font-mono font-semibold normal-case text-[var(--text-muted)]">({rules.length})</span>
      </h3>
      <div className="overflow-x-auto border border-[var(--ui-border)] bg-white">
        <table className="spreadsheet-table spreadsheet-table--static-header w-full border-collapse text-left">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Sale %</th>
              <th>1st %</th>
              <th>2nd %</th>
              <th>3rd %</th>
              <th className="whitespace-nowrap">eBay / CC %</th>
              <th className="w-24 text-right" />
            </tr>
          </thead>
          <tbody className="text-xs">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── NoSpos Category Mappings ─────────────────────────────────────────────────

function NosposCategoryMappingsSection({ categories, mappings, onMappingsChange }) {
  const { showNotification } = useNotification();
  const [addCatId, setAddCatId] = useState('');
  const [addNosposPath, setAddNosposPath] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNosposPath, setEditNosposPath] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const handleAdd = async () => {
    if (!addCatId) { setAddError('Select a category.'); return; }
    const trimmedPath = addNosposPath.trim();
    if (!trimmedPath) { setAddError('Enter a NoSpos path.'); return; }
    if (!parseNosposPath(trimmedPath).length) { setAddError('Path must contain at least one level.'); return; }
    if (mappings.some((m) => Number(m.internalCategoryId) === Number(addCatId))) {
      setAddError('A mapping for this category already exists. Delete it first.');
      return;
    }
    setAddSaving(true);
    setAddError('');
    try {
      const created = await createNosposCategoryMapping({ internalCategoryId: Number(addCatId), nosposPath: trimmedPath });
      onMappingsChange([...mappings, created]);
      setAddCatId('');
      setAddNosposPath('');
      showNotification('Mapping saved', 'success');
    } catch (err) {
      setAddError(err?.message || 'Failed to save mapping.');
    } finally {
      setAddSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteNosposCategoryMapping(id);
      onMappingsChange(mappings.filter((m) => m.id !== id));
      setConfirmDeleteId(null);
      showNotification('Mapping removed', 'success');
    } catch (err) {
      showNotification(err?.message || 'Failed to delete mapping.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEditStart = (m) => {
    setEditingId(m.id);
    setEditNosposPath(m.nosposPath);
  };

  const handleEditSave = async (id) => {
    const trimmed = editNosposPath.trim();
    if (!trimmed || !parseNosposPath(trimmed).length) return;
    setEditSaving(true);
    try {
      const updated = await updateNosposCategoryMapping(id, { nosposPath: trimmed });
      onMappingsChange(mappings.map((m) => m.id === id ? updated : m));
      setEditingId(null);
      showNotification('Mapping updated', 'success');
    } catch (err) {
      showNotification(err?.message || 'Failed to update mapping.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const previewSegments = addNosposPath.trim() ? parseNosposPath(addNosposPath) : null;

  return (
    <div className="mt-8 border-t border-[var(--ui-border)] pt-8">
      <h2 className="text-xs font-bold uppercase tracking-wider text-brand-blue">NoSpos category mappings</h2>
      <p className="mt-1.5 max-w-2xl text-xs text-[var(--text-muted)]">
        Map your internal categories to NoSpos category paths. When opening an item for testing, the mapped
        path is applied directly instead of AI — or used as a starting prefix if the path is partial.
        Use <code className="rounded bg-[var(--ui-bg)] px-1 font-mono text-[11px]">&gt;</code> to separate hierarchy levels,
        e.g. <span className="font-mono text-[11px] text-[var(--text-main)]">Gaming &gt; Consoles &gt; Sony &gt; PlayStation5</span>.
      </p>

      {/* Existing mappings */}
      {mappings.length > 0 && (
        <div className="mt-4 overflow-x-auto border border-[var(--ui-border)] bg-white">
          <table className="spreadsheet-table spreadsheet-table--static-header w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="min-w-[180px]">Our category</th>
                <th>NoSpos path</th>
                <th className="w-28 text-right" />
              </tr>
            </thead>
            <tbody className="text-xs">
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium text-[var(--text-main)]">{m.internalCategoryName}</td>
                  <td>
                    {editingId === m.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editNosposPath}
                          onChange={(e) => setEditNosposPath(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(m.id); if (e.key === 'Escape') setEditingId(null); }}
                          className={`w-full border border-[var(--brand-blue)] px-2 py-1 font-mono text-xs ${inputFocus}`}
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={editSaving}
                          onClick={() => handleEditSave(m.id)}
                          className="shrink-0 border border-[var(--brand-blue)] bg-[var(--brand-blue-alpha-05)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--brand-blue)] hover:bg-[var(--brand-blue)] hover:text-white disabled:opacity-50"
                        >
                          {editSaving ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          disabled={editSaving}
                          onClick={() => setEditingId(null)}
                          className="shrink-0 border border-[var(--ui-border)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--text-muted)] hover:bg-[var(--ui-bg)] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-[var(--text-main)]">
                        {parseNosposPath(m.nosposPath).map((seg, i, arr) => (
                          <span key={i}>
                            <span>{seg}</span>
                            {i < arr.length - 1 && (
                              <span className="mx-1 font-normal text-[var(--text-muted)]">&rsaquo;</span>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {confirmDeleteId === m.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="mr-1 text-[11px] font-semibold text-[var(--text-muted)]">Delete?</span>
                        <button
                          type="button"
                          disabled={deletingId === m.id}
                          onClick={() => handleDelete(m.id)}
                          className="border border-[var(--ui-border)] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-main)] hover:bg-[var(--brand-blue-alpha-05)] disabled:opacity-50"
                        >
                          {deletingId === m.id ? '…' : 'Yes'}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === m.id}
                          onClick={() => setConfirmDeleteId(null)}
                          className="border border-[var(--ui-border)] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--ui-bg)] disabled:opacity-50"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {editingId !== m.id && (
                          <button
                            type="button"
                            onClick={() => handleEditStart(m)}
                            title="Edit path"
                            className="flex size-7 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--brand-blue-alpha-08)] hover:text-[var(--brand-blue)]"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(m.id)}
                          title="Delete"
                          className="flex size-7 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--brand-blue-alpha-08)] hover:text-[var(--brand-blue)]"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mappings.length === 0 && (
        <div className="mt-4 border border-dashed border-[var(--ui-border)] bg-white py-6 text-center text-xs text-[var(--text-muted)]">
          No mappings yet. Add one below.
        </div>
      )}

      {/* Add form */}
      <div className="mt-4 border border-[var(--ui-border)] bg-white p-4">
        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Add mapping
        </h3>
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Our category
            </label>
            <select
              value={addCatId}
              onChange={(e) => { setAddCatId(e.target.value); setAddError(''); }}
              className={`w-full border border-[var(--ui-border)] bg-white px-3 py-2 text-sm ${inputFocus}`}
            >
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c.category_id} value={String(c.category_id)}>
                  {'—'.repeat(c.depth)}{c.depth > 0 ? ' ' : ''}{c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              NoSpos path
            </label>
            <input
              type="text"
              value={addNosposPath}
              onChange={(e) => { setAddNosposPath(e.target.value); setAddError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Gaming > Consoles > Sony > PlayStation5"
              className={`w-full border border-[var(--ui-border)] px-3 py-2 font-mono text-sm ${inputFocus}`}
            />
            {previewSegments && previewSegments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {previewSegments.map((seg, i) => (
                  <React.Fragment key={i}>
                    <span className="rounded bg-[var(--brand-blue-alpha-05)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-blue)]">
                      {seg}
                    </span>
                    {i < previewSegments.length - 1 && (
                      <span className="text-[10px] text-[var(--text-muted)]">&rsaquo;</span>
                    )}
                  </React.Fragment>
                ))}
                <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                  ({previewSegments.length} level{previewSegments.length !== 1 ? 's' : ''})
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={addSaving}
            className={`${btnPrimary} flex items-center gap-1.5`}
          >
            {addSaving
              ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
              : <span className="material-symbols-outlined text-[16px]">add</span>}
            {addSaving ? 'Saving…' : 'Add'}
          </button>
        </div>
        {addError && (
          <p className="mt-2 text-xs font-medium text-red-600">{addError}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PricingRulesPage() {
  const { showNotification } = useNotification();
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [nosposMappings, setNosposMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalRule, setModalRule] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Customer offer rules state
  const [customerRules, setCustomerRules] = useState(null);
  const [customerSettings, setCustomerSettings] = useState(null);
  const [savingCustomerRule, setSavingCustomerRule] = useState(null);
  const [savingCustomerThresholds, setSavingCustomerThresholds] = useState(false);
  const [savingJewelleryRules, setSavingJewelleryRules] = useState(false);
  const [lowCrInput, setLowCrInput] = useState('');
  const [midCrInput, setMidCrInput] = useState('');
  const [jewelleryMargin1Input, setJewelleryMargin1Input] = useState('');
  const [jewelleryMargin2Input, setJewelleryMargin2Input] = useState('');
  const [jewelleryMargin3Input, setJewelleryMargin3Input] = useState('');
  const [jewelleryMargin4Input, setJewelleryMargin4Input] = useState('');

  const loadRules = useCallback(async () => {
    try {
      const data = await fetchPricingRules();
      setRules(data);
    } catch (err) {
      showNotification('Failed to load pricing rules', 'error');
    }
  }, [showNotification]);

  const loadCustomerRules = useCallback(async () => {
    try {
      const data = await fetchCustomerOfferRules();
      setCustomerRules(data.rules);
      setCustomerSettings(data.settings);
      setLowCrInput(String(data.settings.low_cr_max_pct));
      setMidCrInput(String(data.settings.mid_cr_max_pct));
      setJewelleryMargin1Input(String(data.settings.jewellery_offer_margin_1_pct ?? 30));
      setJewelleryMargin2Input(String(data.settings.jewellery_offer_margin_2_pct ?? 20));
      setJewelleryMargin3Input(String(data.settings.jewellery_offer_margin_3_pct ?? 10));
      setJewelleryMargin4Input(String(data.settings.jewellery_offer_margin_4_pct ?? 5));
    } catch (err) {
      showNotification('Failed to load customer offer rules', 'error');
    }
  }, [showNotification]);

  useEffect(() => {
    Promise.all([
      loadRules(),
      loadCustomerRules(),
      fetchAllCategoriesFlat().then(setCategories).catch(() => []),
      fetchNosposCategoryMappings().then(setNosposMappings).catch(() => []),
    ]).finally(() => setLoading(false));
  }, [loadRules, loadCustomerRules]);

  const handleEdit = (rule) => {
    setModalRule(rule);
    setShowModal(true);
  };

  const handleAdd = () => {
    setModalRule(null);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setModalRule(null);
  };

  const handleSaved = (saved) => {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    handleModalClose();
    useAppStore.getState().invalidateEbayMarginCache();
    useAppStore.getState().loadEbayOfferMargins();
  };

  const handleDelete = async (id) => {
    await deletePricingRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    useAppStore.getState().invalidateEbayMarginCache();
    useAppStore.getState().loadEbayOfferMargins();
  };

  const handleToggleCustomerOfferRule = async (customerType, field, currentValue) => {
    const key = `${customerType}-${field}`;
    setSavingCustomerRule(key);
    try {
      const updated = await updateCustomerOfferRule(customerType, { [field]: !currentValue });
      setCustomerRules((prev) => ({ ...prev, [customerType]: updated }));
    } catch (err) {
      showNotification(err.message || 'Failed to update rule', 'error');
    } finally {
      setSavingCustomerRule(null);
    }
  };

  const handleSaveCustomerThresholds = async () => {
    const low = parseFloat(lowCrInput);
    const mid = parseFloat(midCrInput);
    if (isNaN(low) || isNaN(mid) || low <= 0 || mid <= 0) {
      showNotification('Cancel rate thresholds must be positive numbers', 'error');
      return;
    }
    if (low >= mid) {
      showNotification('Low CR max must be less than Mid CR max', 'error');
      return;
    }
    setSavingCustomerThresholds(true);
    try {
      const updated = await updateCustomerRuleSettings({
        low_cr_max_pct: low,
        mid_cr_max_pct: mid,
      });
      setCustomerSettings(updated);
      showNotification('Customer thresholds saved', 'success');
    } catch (err) {
      showNotification(err.message || 'Failed to save customer thresholds', 'error');
    } finally {
      setSavingCustomerThresholds(false);
    }
  };

  const handleSaveJewelleryRules = async () => {
    const m1 = parseFloat(jewelleryMargin1Input);
    const m2 = parseFloat(jewelleryMargin2Input);
    const m3 = parseFloat(jewelleryMargin3Input);
    const m4 = parseFloat(jewelleryMargin4Input);
    if ([m1, m2, m3, m4].some((m) => Number.isNaN(m) || m < 0 || m > 100)) {
      showNotification('Jewellery margins must be numbers between 0 and 100', 'error');
      return;
    }
    if (!(m1 > m2 && m2 > m3 && m3 > m4)) {
      showNotification('Jewellery margins must be descending: 1st > 2nd > 3rd > 4th', 'error');
      return;
    }
    setSavingJewelleryRules(true);
    try {
      const updated = await updateCustomerRuleSettings({
        jewellery_offer_margin_1_pct: m1,
        jewellery_offer_margin_2_pct: m2,
        jewellery_offer_margin_3_pct: m3,
        jewellery_offer_margin_4_pct: m4,
      });
      setCustomerSettings(updated);
      showNotification('Jewellery rules saved', 'success');
    } catch (err) {
      showNotification(err.message || 'Failed to save jewellery rules', 'error');
    } finally {
      setSavingJewelleryRules(false);
    }
  };

  const globalRules = rules.filter((r) => r.is_global_default);
  const categoryRules = rules.filter((r) => !r.is_global_default && r.category);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--ui-bg)] text-sm text-[var(--text-main)]">
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        rel="stylesheet"
      />
      <style>{SPREADSHEET_TABLE_STYLES}</style>

      <AppHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--ui-border)] pb-5">
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider text-brand-blue">Pricing rules</h1>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex shrink-0 items-center gap-1.5 border border-[var(--brand-blue)] bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--brand-blue)] hover:bg-[var(--brand-blue-alpha-05)]"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add rule
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            <span className="material-symbols-outlined mr-2 animate-spin">progress_activity</span>
            Loading…
          </div>
        ) : (
          <>
            <RulesSection
              title="Global default"
              rules={globalRules}
              onEdit={handleEdit}
              onDelete={handleDelete}
              emptyText="No global default. Add one as the baseline for all categories."
            />
            <RulesSection
              title="Category rules"
              rules={categoryRules}
              onEdit={handleEdit}
              onDelete={handleDelete}
              emptyText="No category rules. Add one to override global for a category."
            />

            <div className="mt-10 border-t border-[var(--ui-border)] pt-8">
              <h2 className="text-xs font-bold uppercase tracking-wider text-brand-blue">Jewellery rules</h2>
              <div className="mt-5 border border-[var(--ui-border)] bg-white p-4">
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Jewellery margin settings
                </h3>
                <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Jewellery margins %
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={jewelleryMargin1Input}
                        onChange={(e) => setJewelleryMargin1Input(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-2 py-2 text-xs ${inputFocus}`}
                        placeholder="30"
                        title="1st offer margin %"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={jewelleryMargin2Input}
                        onChange={(e) => setJewelleryMargin2Input(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-2 py-2 text-xs ${inputFocus}`}
                        placeholder="20"
                        title="2nd offer margin %"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={jewelleryMargin3Input}
                        onChange={(e) => setJewelleryMargin3Input(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-2 py-2 text-xs ${inputFocus}`}
                        placeholder="10"
                        title="3rd offer margin %"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={jewelleryMargin4Input}
                        onChange={(e) => setJewelleryMargin4Input(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-2 py-2 text-xs ${inputFocus}`}
                        placeholder="5"
                        title="4th offer margin %"
                      />
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={handleSaveJewelleryRules}
                      disabled={savingJewelleryRules}
                      className={`${btnPrimary} flex items-center justify-center gap-2`}
                    >
                      {savingJewelleryRules ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      ) : null}
                      Save jewellery rules
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-[var(--ui-border)] pt-8">
              <h2 className="text-xs font-bold uppercase tracking-wider text-brand-blue">Customer offer rules</h2>
              <div className="mt-5 border border-[var(--ui-border)] bg-white p-4">
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Customer threshold settings
                </h3>
                <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Low — max %
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        step="1"
                        value={lowCrInput}
                        onChange={(e) => setLowCrInput(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-3 py-2 pr-8 text-sm ${inputFocus}`}
                        placeholder="20"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">
                        %
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Mid — max %
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={midCrInput}
                        onChange={(e) => setMidCrInput(e.target.value)}
                        className={`w-full border border-[var(--ui-border)] px-3 py-2 pr-8 text-sm ${inputFocus}`}
                        placeholder="40"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">
                        %
                      </span>
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={handleSaveCustomerThresholds}
                      disabled={savingCustomerThresholds}
                      className={`w-full ${btnPrimary} flex items-center justify-center gap-2`}
                    >
                      {savingCustomerThresholds ? (
                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      ) : null}
                      Save customer thresholds
                    </button>
                  </div>
                </div>
              </div>

              {customerRules ? (
                <div className="mt-6 overflow-x-auto border border-[var(--ui-border)] bg-white">
                  <table className="spreadsheet-table spreadsheet-table--static-header w-full min-w-[720px] border-collapse text-left">
                    <thead>
                      <tr>
                        <th className="min-w-[140px]">Customer tier</th>
                        <th className="min-w-[200px]">Definition</th>
                        <th>1st</th>
                        <th>2nd</th>
                        <th>3rd</th>
                        <th>4th</th>
                        <th>Manual</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {[
                        {
                          type: 'new_customer',
                          desc: 'No history (scraping N/A)',
                        },
                        {
                          type: 'low_cr',
                          desc: `Cancel rate ≤ ${customerSettings?.low_cr_max_pct ?? 20}%`,
                        },
                        {
                          type: 'mid_cr',
                          desc: `${customerSettings?.low_cr_max_pct ?? 20}% < rate ≤ ${customerSettings?.mid_cr_max_pct ?? 40}%`,
                        },
                        {
                          type: 'high_cr',
                          desc: `Cancel rate > ${customerSettings?.mid_cr_max_pct ?? 40}%`,
                        },
                      ].map(({ type, desc }) => {
                        const rule = customerRules[type];
                        if (!rule) return null;
                        const slotKeys = [
                          'allow_offer_1',
                          'allow_offer_2',
                          'allow_offer_3',
                          'allow_offer_4',
                          'allow_manual',
                        ];
                        return (
                          <tr key={type}>
                            <td className="font-semibold text-[var(--text-main)]">{CUSTOMER_TYPE_LABELS[type]}</td>
                            <td className="text-[var(--text-muted)]">{desc}</td>
                            {slotKeys.map((key) => {
                              const isAllowed = rule[key];
                              const saving = savingCustomerRule === `${type}-${key}`;
                              return (
                                <td key={key} className="text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCustomerOfferRule(type, key, isAllowed)}
                                    disabled={saving}
                                    title={
                                      isAllowed ? 'Allowed without auth — click to require auth' : 'Requires auth — click to allow'
                                    }
                                    className={`inline-flex min-w-[5.5rem] items-center justify-center gap-1 border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                                      isAllowed
                                        ? 'border-[var(--brand-blue)] bg-[var(--brand-blue)] text-white'
                                        : 'border-[var(--ui-border)] bg-[var(--ui-bg)] text-[var(--text-muted)] hover:border-[var(--brand-blue-alpha-30)]'
                                    }`}
                                  >
                                    {saving ? (
                                      <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span>
                                    ) : (
                                      <span className="material-symbols-outlined text-[12px]">
                                        {isAllowed ? 'lock_open' : 'lock'}
                                      </span>
                                    )}
                                    {isAllowed ? 'On' : 'Auth'}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  Loading customer rules…
                </div>
              )}
            </div>

            <NosposCategoryMappingsSection
              categories={categories}
              mappings={nosposMappings}
              onMappingsChange={setNosposMappings}
            />
          </>
        )}
      </main>

      {showModal && (
        <RuleModal
          rule={modalRule}
          categories={categories}
          onClose={handleModalClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
