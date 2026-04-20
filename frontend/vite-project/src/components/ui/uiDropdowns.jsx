import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.default.css';
import { Icon } from '@/components/ui/uiPrimitives';

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

  const filteredOptions = includeSelected ? options : options.filter((option) => option !== value);

  const dropdownMenu =
    isOpen &&
    filteredOptions.length > 0 &&
    menuRect &&
    createPortal(
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
          className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {dropdownMenu}
    </div>
  );

  if (labelPosition === 'top') {
    return (
      <div className="flex flex-col gap-1.5" ref={dropdownRef}>
        {label && (
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>
        )}
        {dropdownButton}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" ref={dropdownRef}>
      {label && <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>}
      <div className="w-48">{dropdownButton}</div>
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

  const displayText = selected?.label || (String(value ?? '').trim() ? String(value) : placeholder);

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
    // Clamp keyboard highlight when filtered list length changes (matches legacy behaviour).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    if (ch && ch.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
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
    active ? 'bg-brand-blue/10 ring-1 ring-inset ring-brand-blue/20' : 'hover:bg-gray-50';

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
  placeholder = 'Select...',
  clearable,
  onClear,
  className = '',
}) => {
  const selectRef = useRef(null);
  const tomSelectInstance = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (selectRef.current && !tomSelectInstance.current) {
      tomSelectInstance.current = new TomSelect(selectRef.current, {
        create: false,
        onChange: (val) => {
          onChangeRef.current(val);
        },
        placeholder,
      });
    }

    return () => {
      if (tomSelectInstance.current) {
        tomSelectInstance.current.destroy();
        tomSelectInstance.current = null;
      }
    };
    // TomSelect is initialised once; placeholder updates handled in a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tomSelectInstance.current) {
      tomSelectInstance.current.clearOptions();
      tomSelectInstance.current.addOptions(options.map((opt) => ({ value: opt, text: opt })));
    }
  }, [options]);

  useEffect(() => {
    if (tomSelectInstance.current) {
      tomSelectInstance.current.settings.placeholder = placeholder;

      const input = tomSelectInstance.current.control_input;
      if (input) {
        input.setAttribute('placeholder', placeholder);
      }

      tomSelectInstance.current.refreshState();
    }
  }, [placeholder]);

  useEffect(() => {
    if (tomSelectInstance.current) {
      if (value) {
        tomSelectInstance.current.setValue(value, true);
      } else {
        tomSelectInstance.current.clear(true);
      }
    }
  }, [value]);

  return (
    <div className={`searchable-dropdown-match flex flex-col gap-1.5 ${className}`.trim()}>
      {label && (
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>
      )}
      <div className={`relative ${clearable && value && onClear ? 'pr-9' : ''}`}>
        <select ref={selectRef} className="w-full">
          <option value="">{placeholder}</option>
        </select>
        {clearable && value && onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onClear();
            }}
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
