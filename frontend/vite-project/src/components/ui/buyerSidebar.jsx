import React, { useState, useEffect } from 'react';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';
import { fetchProductCategories } from '@/services/api';
import {
  collectLeafCategories,
  filterCategoryTree,
  getCategoryPath,
} from '@/utils/categoryTree';
import { Icon } from '@/components/ui/uiPrimitives';
import { CustomDropdown } from '@/components/ui/uiDropdowns';

function RatePill({ label, value, raw, goodHigh }) {
  if (!value) return null;
  const pct = parseFloat(value);
  const isGood = goodHigh ? pct >= 50 : pct < 5;
  return (
    <div
      className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 ${
        isGood ? 'bg-emerald-900/40 border-emerald-500/40' : 'bg-red-900/40 border-red-400/40'
      }`}
      title={raw || value}
    >
      <span className={`text-sm font-black leading-none ${isGood ? 'text-emerald-300' : 'text-red-300'}`}>
        {value}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-wide text-white/50">{label}</span>
    </div>
  );
}

// Sidebar Category Item
// Clicking ANY category loads its products (including descendants). Parent categories also toggle expand.
// `isSelected` controls the highlight; `isExpanded` controls arrow/children.
export const CategoryItem = ({
  icon,
  label,
  isSelected,
  isExpanded,
  hasChildren,
  children,
  onToggle,
  onSelect,
}) => {
  const handleClick = () => {
    if (onSelect) onSelect();
    if (hasChildren && onToggle) onToggle();
  };

  return (
    <div className="space-y-1">
      <div
        className={`flex items-center p-2 rounded-lg cursor-pointer text-sm ${
          isSelected
            ? 'bg-brand-orange/10 text-brand-orange font-semibold border-l-2 border-brand-orange'
            : 'text-white/70 hover:bg-white/10'
        } ${!isSelected && isExpanded ? 'bg-white/5' : ''}`}
        onClick={handleClick}
      >
        <div className="w-5 flex-shrink-0 flex items-center justify-start">
          {hasChildren && (
            <Icon
              name="chevron_right"
              className={`transition-transform text-sm ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={icon} className="text-sm flex-shrink-0" />
          <span>{label}</span>
        </div>
      </div>
      {isExpanded && children && (
        <div className="ml-4 space-y-1 border-l border-white/10">{children}</div>
      )}
    </div>
  );
};

export const RecentItem = ({ image, title, sku, onClick }) => (
  <div
    className="flex items-center gap-3 p-2 group cursor-pointer hover:bg-white/10 rounded-lg transition-colors"
    onClick={onClick}
  >
    <div className="size-10 bg-white/10 border border-white/10 rounded flex items-center justify-center overflow-hidden">
      <img alt={title} className="object-cover w-full h-full opacity-80 group-hover:opacity-100" src={image} />
    </div>
    <div>
      <p className="text-xs font-bold text-white/90 group-hover:text-brand-orange">{title}</p>
      <p className="text-[10px] text-white/40 uppercase">SKU: {sku}</p>
    </div>
  </div>
);

export const Sidebar = ({
  onCategorySelect,
  onAddFromCeX,
  isCeXLoading,
  onQuickReprice,
  customerData,
  onTransactionTypeChange,
  selectedCategoryId = null,
}) => {
  const [categories, setCategories] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven sync of local category highlight
    setSelectedCategory(selectedCategoryId);
  }, [selectedCategoryId]);

  useEffect(() => {
    fetchProductCategories().then((data) => setCategories(data));
  }, []);

  const filteredCategories = filterCategoryTree(categories, filterText.trim());
  const isFiltering = !!filterText.trim();
  const leafMatches = isFiltering ? collectLeafCategories(filteredCategories) : [];

  // Auto-select when exactly one leaf matches (debounced)
  useEffect(() => {
    if (!filterText.trim() || leafMatches.length !== 1) return;
    const t = setTimeout(() => {
      const { category } = leafMatches[0];
      setSelectedCategory(category.category_id);
      const path = getCategoryPath(category.category_id, categories);
      onCategorySelect({ id: category.category_id, name: category.name, path: path || [category.name] });
    }, 400);
    return () => clearTimeout(t);
  }, [filterText.trim(), leafMatches.length]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run when match count changes

  const handleCategorySelect = async (category) => {
    setSelectedCategory(category.category_id);

    const path = getCategoryPath(category.category_id, categories);
    onCategorySelect({
      id: category.category_id,
      name: category.name,
      path: path || [category.name],
    });
  };

  const renderCategory = (category) => {
    const hasChildren = category.children && category.children.length > 0;
    const isSelected = selectedCategory === category.category_id;
    const isExpanded = isFiltering ? hasChildren : expandedCategories.includes(category.category_id);

    return (
      <CategoryItem
        key={category.category_id}
        icon={hasChildren ? 'folder' : 'smartphone'}
        label={category.name}
        isSelected={isSelected}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        onToggle={() => {
          setExpandedCategories((prev) =>
            prev.includes(category.category_id)
              ? prev.filter((id) => id !== category.category_id)
              : [...prev, category.category_id]
          );
        }}
        onSelect={() => handleCategorySelect(category)}
      >
        {hasChildren &&
          isExpanded &&
          category.children.map((child) => (
            <div key={child.category_id}>{renderCategory(child)}</div>
          ))}
      </CategoryItem>
    );
  };

  const hasCustomer = customerData && customerData.name && customerData.name !== 'No Customer Selected';
  const transaction = customerData
    ? TRANSACTION_META[customerData.transactionType] || { label: 'Unknown', className: '' }
    : null;

  return (
    <aside className="buyer-sidebar w-1/5 min-w-0 min-h-0 shrink-0 border-r border-brand-blue/10 flex flex-col bg-brand-blue overflow-hidden">
      {customerData && (
        <div className="shrink-0 border-b border-white/10">
          {hasCustomer ? (
            <div className="p-3 space-y-2">
              <div>
                <p className="text-2xl font-black text-white leading-tight break-words min-w-0">{customerData.name}</p>
                {onTransactionTypeChange ? (
                  <div className={`mt-1 ${transaction.className}`}>
                    <CustomDropdown
                      value={transaction.label}
                      options={TRANSACTION_OPTIONS.map((o) => o.label)}
                      onChange={(label) => {
                        const selected = TRANSACTION_OPTIONS.find((o) => o.label === label);
                        if (selected) onTransactionTypeChange(selected.value);
                      }}
                    />
                  </div>
                ) : (
                  <span className={`text-xs font-semibold ${transaction.className}`}>{transaction.label}</span>
                )}
              </div>
              {(() => {
                const parseDate = (s) => {
                  if (!s) return null;
                  const d = new Date(s.replace(',', ''));
                  return isNaN(d.getTime()) ? null : d;
                };
                const daysAgo = (d) => (d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null);
                const ltDate = parseDate(customerData.lastTransacted);
                const jDate = parseDate(customerData.joined);
                const ltDays = daysAgo(ltDate);
                const jDays = daysAgo(jDate);
                return (
                  <div className="grid grid-cols-2 gap-1.5">
                    {customerData.lastTransacted && (
                      <div className="bg-white/5 rounded-lg px-2 py-1.5">
                        <p className="text-[15px] font-bold uppercase tracking-wider text-white mb-0.5">
                          Last Transacted
                        </p>
                        <p className="text-xs font-bold text-white leading-tight">
                          {customerData.lastTransacted.split(',')[0]}
                        </p>
                        {ltDays !== null && (
                          <p className="text-sm font-black leading-tight mt-0.5 text-white">{ltDays}d ago</p>
                        )}
                      </div>
                    )}
                    {customerData.joined && (
                      <div className="bg-white/5 rounded-lg px-2 py-1.5">
                        <p className="text-[15px] font-bold uppercase tracking-wider text-white mb-0.5">Joined</p>
                        <p className="text-xs font-bold text-white leading-tight">
                          {customerData.joined.split(',')[0]}
                        </p>
                        {jDays !== null && (
                          <p className="text-sm font-black text-white leading-tight mt-0.5">
                            {jDays >= 365 ? `${Math.floor(jDays / 365)}y` : `${jDays}d`} ago
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {(customerData.buyingCount || customerData.salesCount) && (
                <div className="grid grid-cols-2 gap-1.5">
                  {customerData.buyingCount && (
                    <div className="bg-white/5 rounded-lg px-2 py-1.5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-brand-orange text-base">file_present</span>
                      <div>
                        <p className="text-lg font-black text-white leading-none">{customerData.buyingCount}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Buys</p>
                      </div>
                    </div>
                  )}
                  {customerData.salesCount && (
                    <div className="bg-white/5 rounded-lg px-2 py-1.5 flex items-center gap-2">
                      <span className="material-symbols-outlined text-white/50 text-base">shopping_cart</span>
                      <div>
                        <p className="text-lg font-black text-white leading-none">{customerData.salesCount}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Sales</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(customerData.buyBackRate ||
                customerData.renewRate ||
                customerData.cancelRateStr ||
                customerData.faultyRate) && (
                <div className="grid grid-cols-2 gap-1">
                  <RatePill
                    label="Buy Back"
                    value={customerData.buyBackRate}
                    raw={customerData.buyBackRateRaw}
                    goodHigh
                  />
                  <RatePill label="Renew" value={customerData.renewRate} raw={customerData.renewRateRaw} goodHigh />
                  <RatePill
                    label="Cancel"
                    value={customerData.cancelRateStr}
                    raw={customerData.cancelRateRaw}
                    goodHigh
                  />
                  <RatePill
                    label="Faulty"
                    value={customerData.faultyRate}
                    raw={customerData.faultyRateRaw}
                    goodHigh={false}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2.5 flex items-center gap-2">
              <span className="material-symbols-outlined text-white/30 text-base">person_off</span>
              <p className="text-xs text-white/40 font-semibold">No customer selected</p>
            </div>
          )}
        </div>
      )}

      <div className="p-4 shrink-0">
        <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3 px-2">Device Categories</h3>
        <div className="relative">
          <Icon name="filter_list" className="absolute left-3 top-2.5 text-white/40 text-sm" />
          <input
            className="w-full bg-white/10 border-white/10 border rounded-lg pl-9 py-2 text-sm text-white focus:ring-1 focus:ring-brand-orange placeholder:text-white/30"
            placeholder="Filter categories..."
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto buyer-panel-scroll p-4 pt-0">
        {leafMatches.length > 1 && (
          <div className="mb-3 p-3 bg-white/5 rounded-lg border border-white/10">
            <p className="text-xs text-white/70 mb-2">Multiple matches — pick one:</p>
            <div className="space-y-1">
              {leafMatches.map(({ category, path }) => (
                <button
                  key={category.category_id}
                  type="button"
                  onClick={() => handleCategorySelect(category)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-white hover:bg-brand-orange/20 hover:text-brand-orange transition-colors flex items-center gap-2"
                >
                  <Icon name="smartphone" className="text-sm flex-shrink-0" />
                  <span>{path.join(' › ')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1">{filteredCategories.map((cat) => renderCategory(cat))}</div>
        {(onAddFromCeX || onQuickReprice) && (
          <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
            {onAddFromCeX && (
              <button
                type="button"
                onClick={onAddFromCeX}
                disabled={isCeXLoading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-brand-orange/20 hover:bg-brand-orange/30 text-brand-orange font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-brand-orange/30"
              >
                <Icon name="add_link" className="text-sm" />
                {isCeXLoading ? 'Waiting for CeX listing…' : 'Add from CeX'}
              </button>
            )}
            {onQuickReprice && (
              <button
                type="button"
                onClick={onQuickReprice}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orange-hover text-brand-blue font-bold text-sm transition-colors border border-brand-orange shadow-md shadow-brand-orange/20"
                title="Quick Reprice is for games only"
              >
                <Icon name="bolt" className="text-sm" />
                Quick Reprice (Games)
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
