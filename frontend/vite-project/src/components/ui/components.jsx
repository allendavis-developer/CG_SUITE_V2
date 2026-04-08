// components.js
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.default.css';
import { TRANSACTION_OPTIONS, TRANSACTION_META } from '@/utils/transactionConstants';
import { fetchProductCategories } from '@/services/api';
import {
  collectLeafCategories,
  filterCategoryTree,
  getCategoryPath,
} from '@/utils/categoryTree';

// ==================== CORE UI COMPONENTS ====================

// Icon Component
export const Icon = ({ name, className = "" }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

// Button Component
export const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  icon, 
  onClick, 
  className = '',
  disabled = false 
}) => {
  const baseStyles = "font-bold rounded-lg flex items-center justify-center gap-2 transition-all";
  
  const variants = {
    primary:
      "bg-brand-orange hover:bg-brand-orange-hover text-brand-blue shadow-md shadow-brand-orange/20 active:scale-95",
    secondary: "bg-brand-blue hover:bg-brand-blue-hover text-white",
    outline:
      "border border-ui-border bg-white text-text-main hover:border-brand-orange",
    ghost: "text-brand-blue/35 hover:text-brand-blue",
  };
  
  const sizes = {
    sm: "px-4 py-1.5 text-xs",
    md: "px-6 py-2.5 text-sm",
    lg: "px-6 py-3.5 text-sm"
  };
  
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {icon && <Icon name={icon} className="text-sm" />}
      {children}
    </button>
  );
};

// Badge Component
export const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: "bg-brand-blue/[0.06] text-brand-blue border-brand-blue/20",
    warning: "bg-brand-orange/10 text-brand-orange border-brand-orange/20",
    success: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20"
  };
  
  return (
    <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

export const CustomDropdown = ({
  label,
  value,
  options,
  onChange,
  labelPosition = 'left',
  includeSelected = false,
  buttonClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const dropdownRef = React.useRef(null);
  const buttonRef = React.useRef(null);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      const inButton = dropdownRef.current?.contains(event.target);
      const inMenu = menuRef.current?.contains(event.target);
      if (!inButton && !inMenu) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    } else {
      setMenuRect(null);
    }
  }, [isOpen]);

  const filteredOptions = includeSelected ? options : options.filter(option => option !== value);

  const dropdownMenu = isOpen && filteredOptions.length > 0 && menuRect && createPortal(
    <div
      ref={menuRef}
      className="cg-portal-dropdown-menu cg-animate-modal-panel fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto max-h-60 overflow-x-hidden"
      style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width, minWidth: 120 }}
    >
      {filteredOptions.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onChange(option);
            setIsOpen(false);
          }}
          className="w-full px-3 py-2.5 text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {option}
        </button>
      ))}
    </div>,
    document.body
  );

  const dropdownButton = (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 text-left flex items-center justify-between hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-brand-orange transition-all ${buttonClassName}`.trim()}
      >
        <span className="font-medium">{value}</span>
        <Icon
          name="expand_more"
          className={`text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {dropdownMenu}
    </div>
  );

  if (labelPosition === 'top') {
    return (
      <div className="flex flex-col gap-1.5" ref={dropdownRef}>
        {label && (
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {label}
          </label>
        )}
        {dropdownButton}
      </div>
    );
  }

  // Default: left position
  return (
    <div className="flex items-center gap-2" ref={dropdownRef}>
      {label && (
        <label className="text-xs font-bold text-gray-500 uppercase">
          {label}
        </label>
      )}
      <div className="w-48">
        {dropdownButton}
      </div>
    </div>
  );
};

/**
 * Searchable single-select: trigger + portaled menu (fixed position) with filter input.
 * Opening focuses the filter field immediately; arrow keys move highlight; Enter selects.
 * Typing with the menu closed (focus on trigger) opens and seeds the filter.
 *
 * @param {{ value: string, label: string }}[] options
 */
export const SearchablePortalSelect = ({
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  searchPlaceholder = '',
  buttonClassName = '',
  zClass = 'z-[10050]',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [menuRect, setMenuRect] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const itemRefs = useRef({});

  const normalized = useMemo(() => {
    if (!Array.isArray(options)) return [];
    return options.map((o) => ({
      value: String(o?.value ?? '').trim(),
      label: String(o?.label ?? o?.value ?? '').trim(),
    }));
  }, [options]);

  const selected = useMemo(
    () => normalized.find((o) => o.value === String(value ?? '').trim()),
    [normalized, value]
  );

  const displayText =
    selected?.label || (String(value ?? '').trim() ? String(value) : placeholder);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => {
      const lb = (o.label || o.value).toLowerCase();
      return lb.includes(q);
    });
  }, [normalized, query]);

  const maxHighlight = filtered.length;

  useEffect(() => {
    setHighlightIdx((h) => Math.min(Math.max(0, h), maxHighlight));
  }, [maxHighlight]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const id = window.setTimeout(() => {
      searchRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(id);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = itemRefs.current[highlightIdx];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightIdx, isOpen, filtered]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  const pickHighlight = useCallback(() => {
    if (highlightIdx === 0) {
      onChange('');
    } else if (filtered[highlightIdx - 1]) {
      onChange(filtered[highlightIdx - 1].value);
    }
    setIsOpen(false);
    setQuery('');
    buttonRef.current?.focus({ preventScroll: true });
  }, [highlightIdx, filtered, onChange]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeMenu]);

  useEffect(() => {
    const onDown = (event) => {
      const inRoot = rootRef.current?.contains(event.target);
      const inMenu = menuRef.current?.contains(event.target);
      if (!inRoot && !inMenu) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    } else {
      setMenuRect(null);
    }
  }, [isOpen]);

  const showPlaceholderStyle = !selected && !String(value ?? '').trim();

  const onFilterKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((h) => Math.min(h + 1, maxHighlight));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pickHighlight();
    }
  };

  const onTriggerKeyDown = (e) => {
    if (isOpen) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setQuery('');
      setHighlightIdx(normalized.length > 0 ? 1 : 0);
      setIsOpen(true);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setQuery('');
      setHighlightIdx(normalized.length > 0 ? normalized.length : 0);
      setIsOpen(true);
      return;
    }
    const ch = e.key;
    if (
      ch &&
      ch.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      e.preventDefault();
      const nextFiltered = normalized.filter((o) => {
        const lb = (o.label || o.value).toLowerCase();
        return lb.includes(ch.toLowerCase());
      });
      setQuery(ch);
      setHighlightIdx(nextFiltered.length > 0 ? 1 : 0);
      setIsOpen(true);
    }
  };

  const setClearRef = (el) => {
    itemRefs.current[0] = el;
  };
  const setOptionRef = (idx) => (el) => {
    itemRefs.current[idx + 1] = el;
  };

  const hiRow = (active) =>
    active
      ? 'bg-brand-blue/10 ring-1 ring-inset ring-brand-blue/20'
      : 'hover:bg-gray-50';

  const portalMenu =
    isOpen &&
    menuRect &&
    createPortal(
      <div
        ref={menuRef}
        role="listbox"
        aria-label="Options"
        className={`fixed ${zClass} flex flex-col rounded-lg border border-gray-200 bg-white shadow-xl`}
        style={{
          top: menuRect.top,
          left: menuRect.left,
          width: menuRect.width,
          minWidth: 160,
          maxHeight: 'min(50vh, 280px)',
        }}
      >
        <div className="shrink-0 border-b border-gray-100 p-1.5">
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls="searchable-portal-select-list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFilterKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder ? undefined : 'Filter options'}
            className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/25"
          />
        </div>
        <div
          id="searchable-portal-select-list"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <button
            ref={setClearRef}
            type="button"
            role="option"
            aria-selected={highlightIdx === 0}
            className={`w-full border-b border-gray-50 px-3 py-1.5 text-left text-[11px] text-gray-500 ${hiRow(highlightIdx === 0)}`}
            onMouseEnter={() => setHighlightIdx(0)}
            onClick={() => {
              onChange('');
              closeMenu();
            }}
          >
            {placeholder}
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
          ) : (
            filtered.map((o, idx) => {
              const listIdx = idx + 1;
              const isHi = highlightIdx === listIdx;
              const isValue = String(value ?? '').trim() === o.value;
              return (
                <button
                  ref={setOptionRef(idx)}
                  key={`${o.value}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isHi}
                  onMouseEnter={() => setHighlightIdx(listIdx)}
                  onClick={() => {
                    onChange(o.value);
                    closeMenu();
                  }}
                  className={`w-full px-3 py-2 text-left text-xs text-gray-800 ${hiRow(isHi)} ${
                    isValue ? 'font-semibold text-brand-blue' : ''
                  }`}
                >
                  {o.label || o.value}
                </button>
              );
            })
          )}
        </div>
      </div>,
      document.body
    );

  return (
    <div className="relative w-full" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((prev) => {
            if (prev) {
              setQuery('');
              return false;
            }
            setQuery('');
            setHighlightIdx(normalized.length > 0 ? 1 : 0);
            return true;
          });
        }}
        onKeyDown={onTriggerKeyDown}
        className={`flex w-full max-w-full items-center justify-between gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-left text-xs font-medium focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue/30 ${
          showPlaceholderStyle ? 'text-gray-500' : 'text-gray-900'
        } ${buttonClassName}`.trim()}
      >
        <span className="min-w-0 flex-1 truncate">{displayText}</span>
        <Icon name="expand_more" className="shrink-0 text-[18px] leading-none text-gray-400" />
      </button>
      {portalMenu}
    </div>
  );
};

export const SearchableDropdown = ({
  label,
  value,
  options,
  onChange,
  placeholder = "Select...",
  clearable,
  onClear,
  className = '',
}) => {
  const selectRef = useRef(null);
  const tomSelectInstance = useRef(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Initialize TomSelect only once
  useEffect(() => {
    if (selectRef.current && !tomSelectInstance.current) {
      tomSelectInstance.current = new TomSelect(selectRef.current, {
        create: false,
        onChange: (val) => {
          onChangeRef.current(val); // Use the ref instead
        },
        placeholder,
      });
    }

    // Cleanup on unmount
    return () => {
      if (tomSelectInstance.current) {
        tomSelectInstance.current.destroy();
        tomSelectInstance.current = null;
      }
    };
  }, []); // Empty dependency array - run only once

  // Update options when they change
  useEffect(() => {
    if (tomSelectInstance.current) {
      tomSelectInstance.current.clearOptions();
      tomSelectInstance.current.addOptions(
        options.map(opt => ({ value: opt, text: opt }))
      );
    }
  }, [options]);

  // Update placeholder when it changes
  useEffect(() => {
    if (tomSelectInstance.current) {
      // Update the internal settings for any future resets
      tomSelectInstance.current.settings.placeholder = placeholder;
      
      // Update the actual DOM element placeholder
      const input = tomSelectInstance.current.control_input;
      if (input) {
        input.setAttribute('placeholder', placeholder);
      }
      
      // Refresh the placeholder visibility
      tomSelectInstance.current.refreshState();
    }
  }, [placeholder]);

  // Update selected value (INCLUDING when it's cleared)
  useEffect(() => {
    if (tomSelectInstance.current) {
      if (value) {
        tomSelectInstance.current.setValue(value, true); // true = silent (no onChange trigger)
      } else {
        tomSelectInstance.current.clear(true); // Clear when value is empty/null
      }
    }
  }, [value]);


  return (
    <div className={`searchable-dropdown-match flex flex-col gap-1.5 ${className}`.trim()}>
      {label && (
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          {label}
        </label>
      )}
      <div className={`relative ${clearable && value && onClear ? 'pr-9' : ''}`}>
        <select ref={selectRef} className="w-full">
          <option value="">{placeholder}</option>
        </select>
        {clearable && value && onClear && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onClear(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
            title="Clear and show all variants"
            aria-label="Clear"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        )}
      </div>
    </div>
  );
};

// Tab Component
export const Tab = ({ icon, label, isActive, onClick }) => (
  <button 
    onClick={onClick}
    className={`px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2 ${
      isActive 
        ? 'border-brand-orange text-brand-orange bg-white' 
        : 'border-transparent text-gray-500 hover:text-brand-blue hover:bg-white/50'
    }`}
  >
    <Icon name={icon} className="text-sm" />
    {label}
  </button>
);

// Breadcrumb Component
export const Breadcrumb = ({ items }) => (
  <nav className="flex items-center gap-2 mb-3">
    {items.map((item, index) => (
      <React.Fragment key={index}>
        {index > 0 && <span className="text-xs text-gray-400/30">/</span>}
        {index === items.length - 1 ? (
          <span className="text-xs font-medium text-brand-blue">{item}</span>
        ) : (
          <a className="text-xs font-medium text-gray-500 hover:text-brand-blue" href="#">{item}</a>
        )}
      </React.Fragment>
    ))}
  </nav>
);

// ==================== SIDEBAR COMPONENTS ====================

// Sidebar Category Item
// Clicking ANY category loads its products (including descendants). Parent categories also toggle expand.
// `isSelected` controls the highlight; `isExpanded` controls arrow/children.
export const CategoryItem = ({ icon, label, isSelected, isExpanded, hasChildren, children, onToggle, onSelect }) => {
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
        <div className="ml-4 space-y-1 border-l border-white/10">
          {children}
        </div>
      )}
    </div>
  );
};

// Recent Item Component
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



// Sidebar Component
export const Sidebar = ({ onCategorySelect, onAddFromCeX, isCeXLoading, onQuickReprice, customerData, onTransactionTypeChange, selectedCategoryId = null }) => {
  const [categories, setCategories] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    if (selectedCategoryId == null) return;
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
      path: path || [category.name]
    });
  };

  const renderCategory = (category) => {
    const hasChildren = category.children && category.children.length > 0;
    const isSelected = selectedCategory === category.category_id;
    const isExpanded = isFiltering ? hasChildren : expandedCategories.includes(category.category_id);

    return (
      <CategoryItem
        key={category.category_id}
        icon={hasChildren ? "folder" : "smartphone"}
        label={category.name}
        isSelected={isSelected}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        onToggle={() => {
          setExpandedCategories((prev) =>
            prev.includes(category.category_id)
              ? prev.filter((id) => id !== category.category_id) // collapse
              : [...prev, category.category_id]                // expand
          );
        }}
        onSelect={() => handleCategorySelect(category)}
      >
        {hasChildren && isExpanded &&
          category.children.map((child) => (
            <div key={child.category_id}>{renderCategory(child)}</div>
          ))}
      </CategoryItem>
    );
  };

  // Helper: rate pill
  const RatePill = ({ label, value, raw, goodHigh }) => {
    if (!value) return null;
    const pct = parseFloat(value);
    const isGood = goodHigh ? pct >= 50 : pct < 5;
    return (
      <div className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 ${
        isGood ? 'bg-emerald-900/40 border-emerald-500/40' : 'bg-red-900/40 border-red-400/40'
      }`} title={raw || value}>
        <span className={`text-sm font-black leading-none ${isGood ? 'text-emerald-300' : 'text-red-300'}`}>{value}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-white/50">{label}</span>
      </div>
    );
  };

  const hasCustomer = customerData && customerData.name && customerData.name !== 'No Customer Selected';
  const transaction = customerData ? (TRANSACTION_META[customerData.transactionType] || { label: 'Unknown', className: '' }) : null;

  return (
    <aside className="buyer-sidebar w-1/5 min-w-0 min-h-0 shrink-0 border-r border-brand-blue/10 flex flex-col bg-brand-blue overflow-hidden">

      {/* ── Customer panel ── */}
      {customerData && (
        <div className="shrink-0 border-b border-white/10">
          {hasCustomer ? (
            <div className="p-3 space-y-2">
              {/* Name + transaction type */}
              <div>
                <p className="text-2xl font-black text-white leading-tight break-words min-w-0">{customerData.name}</p>
                {onTransactionTypeChange ? (
                  <div className={`mt-1 ${transaction.className}`}>
                    <CustomDropdown
                      value={transaction.label}
                      options={TRANSACTION_OPTIONS.map(o => o.label)}
                      onChange={(label) => {
                        const selected = TRANSACTION_OPTIONS.find(o => o.label === label);
                        if (selected) onTransactionTypeChange(selected.value);
                      }}
                    />
                  </div>
                ) : (
                  <span className={`text-xs font-semibold ${transaction.className}`}>{transaction.label}</span>
                )}
              </div>
              {/* Dates with day counts */}
              {(() => {
                const parseDate = (s) => {
                  if (!s) return null;
                  const d = new Date(s.replace(',', ''));
                  return isNaN(d.getTime()) ? null : d;
                };
                const daysAgo = (d) => d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
                const ltDate  = parseDate(customerData.lastTransacted);
                const jDate   = parseDate(customerData.joined);
                const ltDays  = daysAgo(ltDate);
                const jDays   = daysAgo(jDate);
                return (
                  <div className="grid grid-cols-2 gap-1.5">
                    {customerData.lastTransacted && (
                      <div className="bg-white/5 rounded-lg px-2 py-1.5">
                        <p className="text-[15px] font-bold uppercase tracking-wider text-white mb-0.5">Last Transacted</p>
                        <p className="text-xs font-bold text-white leading-tight">{customerData.lastTransacted.split(',')[0]}</p>
                        {ltDays !== null && (
                          <p className="text-sm font-black leading-tight mt-0.5 text-white">
                            {ltDays}d ago
                          </p>
                        )}
                      </div>
                    )}
                    {customerData.joined && (
                      <div className="bg-white/5 rounded-lg px-2 py-1.5">
                        <p className="text-[15px] font-bold uppercase tracking-wider text-white mb-0.5">Joined</p>
                        <p className="text-xs font-bold text-white leading-tight">{customerData.joined.split(',')[0]}</p>
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

              {/* Buying & Sales counts */}
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

              {/* Rate pills */}
              {(customerData.buyBackRate || customerData.renewRate || customerData.cancelRateStr || customerData.faultyRate) && (
                <div className="grid grid-cols-2 gap-1">
                  <RatePill label="Buy Back" value={customerData.buyBackRate}    raw={customerData.buyBackRateRaw}  goodHigh />
                  <RatePill label="Renew"    value={customerData.renewRate}      raw={customerData.renewRateRaw}    goodHigh />
                  <RatePill label="Cancel"   value={customerData.cancelRateStr}  raw={customerData.cancelRateRaw}   goodHigh />
                  <RatePill label="Faulty"   value={customerData.faultyRate}     raw={customerData.faultyRateRaw}   goodHigh={false} />
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
        <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3 px-2">
          Device Categories
        </h3>
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
        <div className="space-y-1">
          {filteredCategories.map((cat) => renderCategory(cat))}
        </div>
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

// ==================== PRODUCT COMPONENTS ====================

// Offer Card Component
export const OfferCard = ({ title, price, margin, isHighlighted, onClick }) => (
  <div
    onClick={onClick}
    className={`
      p-6 rounded-xl bg-white cursor-pointer text-center relative overflow-hidden
      border-2
      transition-all duration-200 ease-out
      ${
        isHighlighted
          ? `
            border-brand-blue
            ring-2 ring-brand-blue ring-offset-2 ring-offset-white
            shadow-xl shadow-brand-blue/10
            scale-[1.03]
          `
          : `
            border-brand-blue/40
            hover:border-brand-blue
            hover:shadow-lg
          `
      }
    `}
  >
    {/* Top accent bar */}
    <div
      className={`absolute top-0 left-0 w-full ${
        isHighlighted
          ? 'h-1.5 bg-brand-orange'
          : 'h-1 bg-brand-orange/60'
      }`}
    />

    <h4 className="text-[10px] font-black uppercase text-brand-blue mb-4 tracking-wider">
      {title}
    </h4>

    <p className="text-4xl font-extrabold text-brand-blue mb-2">
      {price}
    </p>

    <div className="flex items-center justify-center gap-1.5">
      <span className="text-[10px] font-bold text-gray-500 uppercase">
        Margin
      </span>
      <span className="text-xs font-extrabold text-brand-orange">
        {margin}%
      </span>
    </div>
  </div>
);


// ==================== TABLE CHECKBOX ====================

/**
 * Styled checkbox for use inside table rows and headers.
 * Matches the brand-blue / yellow system palette (same control as repricing session tables).
 *
 * Props: checked, onChange, indeterminate (header "select-all"), disabled (view-only / saving), aria-label
 */
export const TableCheckbox = ({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  'aria-label': ariaLabel,
}) => {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const showChecked = checked || indeterminate;

  return (
    <label
      className={`inline-flex items-center justify-center group ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={disabled ? undefined : onChange}
        aria-label={ariaLabel}
        className="sr-only"
      />
      <span
        className={`
          flex items-center justify-center w-4 h-4 transition-all
          ${showChecked
            ? 'bg-brand-blue border-2 border-brand-blue'
            : `bg-white border-2 border-black ${disabled ? '' : 'group-hover:border-brand-blue'}`}
          ${disabled ? 'opacity-80' : ''}
        `}
      >
        {checked && !indeterminate && (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-white fill-none stroke-current stroke-[1.5]">
            <polyline points="1 4 3.5 6.5 9 1" />
          </svg>
        )}
        {indeterminate && (
          <span className="block w-2 h-0.5 bg-white rounded" />
        )}
      </span>
    </label>
  );
};


