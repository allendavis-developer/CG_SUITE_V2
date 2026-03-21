import React, { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/AppHeader';
import {
  fetchPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  fetchAllCategoriesFlat,
} from '@/services/api';
import { useNotification } from '@/contexts/NotificationContext';
import useAppStore from '@/store/useAppStore';

function fmtMultiplier(v) {
  return v != null ? `${(v * 100).toFixed(1)}%` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(1)}%` : <span className="text-gray-400 italic">default</span>;
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

    const payload = {
      sell_price_multiplier: (multiplierVal / 100).toFixed(4),
      first_offer_pct_of_cex: firstOfferPct !== '' ? parseFloat(firstOfferPct) : null,
      second_offer_pct_of_cex: secondOfferPct !== '' ? parseFloat(secondOfferPct) : null,
      ebay_offer_margin_1_pct: ebayMargin1 !== '' ? parseFloat(ebayMargin1) : null,
      ebay_offer_margin_2_pct: ebayMargin2 !== '' ? parseFloat(ebayMargin2) : null,
      ebay_offer_margin_3_pct: ebayMargin3 !== '' ? parseFloat(ebayMargin3) : null,
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
          ebay_offer_margin_1_pct: payload.ebay_offer_margin_1_pct,
          ebay_offer_margin_2_pct: payload.ebay_offer_margin_2_pct,
          ebay_offer_margin_3_pct: payload.ebay_offer_margin_3_pct,
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-blue-900 px-8 py-5 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-yellow-400">tune</span>
            <h2 className="text-lg font-black">
              {isEditing ? 'Edit Pricing Rule' : 'Add Pricing Rule'}
            </h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Body */}
        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto">

          {/* Scope — only shown when creating */}
          {!isEditing && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-2">
                Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'global', label: 'Global Default', icon: 'public' },
                  { v: 'category', label: 'Category', icon: 'folder' },
                ].map(({ v, label, icon }) => (
                  <button
                    key={v}
                    onClick={() => setScopeKind(v)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all text-xs font-bold ${
                      scopeKind === v
                        ? 'border-blue-900 bg-blue-50 text-blue-900'
                        : 'border-gray-200 text-gray-500 hover:border-blue-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg">{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category picker — shown when creating a category rule */}
          {!isEditing && scopeKind === 'category' && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
              Sale Price (% of CeX sell price)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="200"
                step="0.1"
                value={sellPct}
                onChange={(e) => setSellPct(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 85"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">%</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Our sale price = CeX sell price × this %. E.g. 85 → sell at 85% of CeX price.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* First offer % */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                First Offer (% of CeX trade-in price){' '}
                <span className="normal-case font-normal text-gray-400">— optional</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="200"
                  step="0.1"
                  value={firstOfferPct}
                  onChange={(e) => setFirstOfferPct(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 90 (leave blank for default)"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">%</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                First offer = CeX trade-in price × this %. Leave blank to use the same absolute margin as CeX.
              </p>
            </div>

            {/* Second offer % */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                Second Offer (% of CeX trade-in price){' '}
                <span className="normal-case font-normal text-gray-400">— optional</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="200"
                  step="0.1"
                  value={secondOfferPct}
                  onChange={(e) => setSecondOfferPct(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 95 (leave blank for midpoint)"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">%</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Second offer = CeX trade-in price × this %. Leave blank to keep using the midpoint between First and Third.
              </p>
            </div>
          </div>

          {/* eBay / Research offer margins */}
          <div className="border-t border-gray-200 pt-5">
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3">
              eBay / Research Offer Margins
              <span className="normal-case font-normal text-gray-400 ml-1">— optional, defaults: 60 / 50 / 40</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '1st Offer', value: ebayMargin1, setter: setEbayMargin1, placeholder: '60', color: 'emerald' },
                { label: '2nd Offer', value: ebayMargin2, setter: setEbayMargin2, placeholder: '50', color: 'amber' },
                { label: '3rd Offer', value: ebayMargin3, setter: setEbayMargin3, placeholder: '40', color: 'orange' },
              ].map(({ label, value, setter, placeholder, color }) => (
                <div key={label}>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">{label}</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      step="1"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-${color}-500`}
                      placeholder={placeholder}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Margin % applied to the eBay/Cash Converters suggested sell price to generate buy offers.
              E.g. 60% margin → offer = sell price × 0.40. Leave blank to use defaults (60 / 50 / 40).
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="px-8 py-5 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 text-sm font-black bg-yellow-400 text-blue-900 rounded-xl hover:bg-yellow-300 transition-colors shadow-md shadow-yellow-400/30 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Rule'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

function fmtMarginTriplet(m1, m2, m3) {
  if (m1 == null && m2 == null && m3 == null) {
    return <span className="text-gray-400 italic">60 / 50 / 40</span>;
  }
  const f = (v, d) => v != null ? `${Number(v).toFixed(0)}` : d;
  return `${f(m1, '60')} / ${f(m2, '50')} / ${f(m3, '40')}`;
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
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 text-sm font-semibold text-gray-900">{scopeLabel(rule)}</td>
      <td className="py-3 px-4 text-sm font-mono font-semibold text-blue-900">
        {fmtMultiplier(rule.sell_price_multiplier)}
      </td>
      <td className="py-3 px-4 text-sm font-mono font-semibold text-purple-700">
        {fmtPct(rule.first_offer_pct_of_cex)}
      </td>
      <td className="py-3 px-4 text-sm font-mono font-semibold text-indigo-700">
        {fmtPct(rule.second_offer_pct_of_cex)}
      </td>
      <td className="py-3 px-4 text-sm font-mono font-semibold text-emerald-700">
        {fmtMarginTriplet(rule.ebay_offer_margin_1_pct, rule.ebay_offer_margin_2_pct, rule.ebay_offer_margin_3_pct)}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2 justify-end">
          {confirming ? (
            <>
              <span className="text-xs text-red-600 font-semibold mr-1">Delete?</span>
              <button
                onClick={handleDelete}
                className="px-3 py-1 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(rule)}
                title="Edit rule"
                className="flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-900 transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit</span>
              </button>
              <button
                onClick={() => setConfirming(true)}
                title="Delete rule"
                className="flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Rules Section ────────────────────────────────────────────────────────────

function RulesSection({ title, icon, rules, onEdit, onDelete, emptyText }) {
  if (rules.length === 0) {
    return (
      <div className="mb-8">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-500 mb-3">
          <span className="material-symbols-outlined text-base">{icon}</span>
          {title}
        </h3>
        <div className="border border-dashed border-gray-300 rounded-xl py-6 text-center text-sm text-gray-400">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-500 mb-3">
        <span className="material-symbols-outlined text-base">{icon}</span>
        {title}
        <span className="ml-1 bg-gray-200 text-gray-600 text-[10px] font-black px-1.5 py-0.5 rounded-full">
          {rules.length}
        </span>
      </h3>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-4 text-[10px] font-black uppercase tracking-wider text-gray-500">Scope</th>
              <th className="text-left py-2.5 px-4 text-[10px] font-black uppercase tracking-wider text-gray-500">Sale Price %</th>
              <th className="text-left py-2.5 px-4 text-[10px] font-black uppercase tracking-wider text-gray-500">First Offer %</th>
              <th className="text-left py-2.5 px-4 text-[10px] font-black uppercase tracking-wider text-gray-500">Second Offer %</th>
              <th className="text-left py-2.5 px-4 text-[10px] font-black uppercase tracking-wider text-gray-500">eBay Margins</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PricingRulesPage() {
  const { showNotification } = useNotification();
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalRule, setModalRule] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const data = await fetchPricingRules();
      setRules(data);
    } catch (err) {
      showNotification('Failed to load pricing rules', 'error');
    }
  }, [showNotification]);

  useEffect(() => {
    Promise.all([
      loadRules(),
      fetchAllCategoriesFlat().then(setCategories).catch(() => []),
    ]).finally(() => setLoading(false));
  }, [loadRules]);

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

  const globalRules = rules.filter((r) => r.is_global_default);
  const categoryRules = rules.filter((r) => !r.is_global_default && r.category);

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col text-sm">
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        rel="stylesheet"
      />

      <AppHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        {/* Page heading */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-blue-900 mb-1">Pricing Rules</h1>
            <p className="text-sm text-gray-500 max-w-lg">
              Control how our sale price and early offers are calculated relative to CeX prices.
              Rules are matched by scope (category → global). Changes take effect immediately — just refresh the buying page.
            </p>
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-400 text-blue-900 text-sm font-black rounded-xl hover:bg-yellow-300 transition-colors shadow-md shadow-yellow-400/30 shrink-0 ml-4"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
            Add Rule
          </button>
        </div>

        {/* How it works */}
        <div className="bg-blue-900 rounded-xl p-5 mb-8 text-white">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-yellow-400">info</span>
            <span className="text-sm font-black">How pricing rules work</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-blue-100">
            <div>
              <p className="font-bold text-white mb-1">Sale Price %</p>
              <p>Our sale price = CeX sell price × this percentage. A category rule overrides the global default.</p>
            </div>
            <div>
              <p className="font-bold text-white mb-1">CeX Offer %</p>
              <p>First/Second Offer = CeX trade-in price × this %. If blank, First uses same absolute margin as CeX; Second is midpoint; Third matches CeX trade-in.</p>
            </div>
            <div>
              <p className="font-bold text-white mb-1">eBay / Research Margins</p>
              <p>Margin % applied to the eBay/Cash Converters suggested price. E.g. 60% margin → offer = price × 0.40. Defaults: 60 / 50 / 40. Changes take effect immediately.</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
            Loading rules…
          </div>
        ) : (
          <>
            <RulesSection
              title="Global Default"
              icon="public"
              rules={globalRules}
              onEdit={handleEdit}
              onDelete={handleDelete}
              emptyText="No global default rule. Add one to set a baseline for all categories."
            />
            <RulesSection
              title="Category Rules"
              icon="folder"
              rules={categoryRules}
              onEdit={handleEdit}
              onDelete={handleDelete}
              emptyText="No category rules. Add one to override the global default for a specific category."
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
