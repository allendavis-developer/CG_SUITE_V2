// components.js
import React, { useState, useEffect, useRef } from 'react';
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.default.css';

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
    primary: "bg-yellow-500 hover:bg-yellow-400 text-blue-900 shadow-md shadow-yellow-500/10 active:scale-95",
    secondary: "bg-blue-900 hover:bg-blue-800 text-white",
    outline: "border border-gray-200 bg-white text-gray-900 hover:border-yellow-500",
    ghost: "text-blue-900/30 hover:text-red-500"
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
    default: "bg-blue-900/5 text-blue-900 border-blue-900/20",
    warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    success: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20"
  };
  
  return (
    <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

// Card Component
export const Card = ({ children, className = '', noPadding = false }) => (
  <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${className}`}>
    <div className={noPadding ? '' : 'p-6'}>
      {children}
    </div>
  </div>
);

// Card Header Component
export const CardHeader = ({ title, subtitle, actions }) => (
  <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
    <div>
      <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const CustomDropdown = ({ label, value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(option => option !== value);

  return (
    <div className="space-y-1.5" ref={dropdownRef}>
      {label && (
        <label className="text-xs font-bold text-gray-500 uppercase">
          {label}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 text-left flex items-center justify-between hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 transition-all"
        >
          <span className="font-medium">{value}</span>
          <Icon
            name="expand_more"
            className={`text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && filteredOptions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
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
          </div>
        )}
      </div>
    </div>
  );
};

export const SearchableDropdown = ({ label, value, options, onChange, placeholder = "Select..." }) => {
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
    <div className="space-y-1.5">
      {label && <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>}
      <select ref={selectRef} className="w-full">
        <option value="">{placeholder}</option>
      </select>
    </div>
  );
};

// Input Component
export const Input = ({ placeholder, icon, value, onChange, className = '' }) => (
  <label className={`flex flex-col min-w-64 h-9 ${className}`}>
    <div className="flex w-full flex-1 items-stretch rounded-lg h-full overflow-hidden border border-white/20">
      {icon && (
        <div className="text-white/60 flex bg-white/10 items-center justify-center pl-3">
          <Icon name={icon} className="text-sm" />
        </div>
      )}
      <input 
        className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden text-white focus:outline-0 focus:ring-0 border-none bg-white/10 h-full placeholder:text-white/40 text-sm font-normal px-2" 
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    </div>
  </label>
);

// Tab Component
export const Tab = ({ icon, label, isActive, onClick }) => (
  <button 
    onClick={onClick}
    className={`px-6 py-4 text-sm font-bold flex items-center gap-2 transition-all border-b-2 ${
      isActive 
        ? 'border-yellow-500 text-yellow-500 bg-white' 
        : 'border-transparent text-gray-500 hover:text-blue-900 hover:bg-white/50'
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
          <span className="text-xs font-medium text-blue-900">{item}</span>
        ) : (
          <a className="text-xs font-medium text-gray-500 hover:text-blue-900" href="#">{item}</a>
        )}
      </React.Fragment>
    ))}
  </nav>
);

// ==================== LAYOUT COMPONENTS ====================

// Header Component
export const Header = ({ onSearch, userName = "JD" }) => (
  <header className="flex items-center justify-between whitespace-nowrap border-b border-gray-200 bg-blue-900 px-6 py-3 sticky top-0 z-50">
    <div className="flex items-center gap-8">
      <div className="flex items-center gap-4 text-yellow-500">
        <div className="size-6 flex items-center justify-center bg-yellow-500 text-blue-900 rounded">
          <Icon name="currency_exchange" className="text-sm font-bold" />
        </div>
        <h2 className="text-white text-lg font-bold leading-tight tracking-tight">CashGenerator</h2>
      </div>
    </div>
    <div className="flex flex-1 justify-end gap-6 items-center">
      <nav className="flex items-center gap-6">
        <a href="/requests-overview" className="text-white/70 hover:text-white text-sm font-medium transition-colors">
          All Requests
        </a>
      </nav>
    </div>
  </header>
);

// ==================== SIDEBAR COMPONENTS ====================

// Sidebar Category Item
export const CategoryItem = ({ icon, label, isActive, hasChildren, children, onToggle, isBottomLevel, onSelect }) => {
  const handleClick = () => {
    if (isBottomLevel && onSelect) {
      onSelect();
    } else if (hasChildren && onToggle) {
      onToggle();
    }
  };

  return (
    <div className="space-y-1">
      <div 
        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm ${
          isActive 
            ? 'bg-yellow-500/10 text-yellow-500 font-semibold border-l-2 border-yellow-500' 
            : 'text-white/70 hover:bg-white/10'
        }`}
        onClick={handleClick}
      >
        {hasChildren && <Icon name="chevron_right" className={`transition-transform text-sm ${isActive ? 'rotate-90' : ''}`} />}
        <Icon name={icon} className="text-sm" />
        <span>{label}</span>
      </div>
      {isActive && children && (
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
      <p className="text-xs font-bold text-white/90 group-hover:text-yellow-500">{title}</p>
      <p className="text-[10px] text-white/40 uppercase">SKU: {sku}</p>
    </div>
  </div>
);



// Sidebar Component
export const Sidebar = ({ onCategorySelect }) => {
  const [categories, setCategories] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    // Use mock data for now - replace with actual API call
  
    fetch('/api/product-categories/')
      .then((res) => res.json())
      .then((data) => setCategories(data))
      .catch((err) => console.error('Error fetching categories:', err));
  }, []);

  // Get breadcrumb path for a category
  const getCategoryPath = (categoryId, categories, path = []) => {
    for (const cat of categories) {
      if (cat.category_id === categoryId) {
        return [...path, cat.name];
      }
      if (cat.children && cat.children.length > 0) {
        const found = getCategoryPath(categoryId, cat.children, [...path, cat.name]);
        if (found) return found;
      }
    }
    return null;
  };

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
    const isBottomLevel = !hasChildren;
    const isSelected = selectedCategory === category.category_id;
    const isExpanded = expandedCategories.includes(category.category_id);

    return (
      <CategoryItem
        key={category.category_id}
        icon={hasChildren ? "folder" : "smartphone"}
        label={category.name}
        isActive={isSelected || isExpanded}
        hasChildren={hasChildren}
        isBottomLevel={isBottomLevel}
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

  return (
    <aside className="w-1/5 border-r border-blue-900/10 flex flex-col bg-blue-900 overflow-y-auto">
      <div className="p-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3 px-2">
            Device Categories
          </h3>

          <div className="relative mb-3">
            <Icon name="filter_list" className="absolute left-3 top-2.5 text-white/40 text-sm" />
            <input
              className="w-full bg-white/10 border-white/10 border rounded-lg pl-9 py-2 text-sm text-white focus:ring-1 focus:ring-yellow-500 placeholder:text-white/30"
              placeholder="Filter categories..."
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            {categories
              .filter((cat) =>
                cat.name.toLowerCase().includes(filterText.toLowerCase())
              )
              .map((cat) => renderCategory(cat))}
          </div>
        </div>
      </div>
    </aside>
  );
};

// ==================== PRODUCT COMPONENTS ====================

// Market Comparison Row
export const MarketRow = ({ platform, salePrice, buyPrice, verified, onResearch }) => (
  <tr className="hover:bg-gray-50 transition-colors">
    <td className="p-4 font-medium text-gray-900">{platform}</td>
    {salePrice && buyPrice ? (
      <>
        <td className="p-4 font-bold text-gray-500">{salePrice}</td>
        <td className="p-4 font-bold text-blue-900">{buyPrice}</td>
        <td className="p-4 text-right">
          {verified && (
            <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold">
              <Icon name="check_circle" className="text-xs" /> Verified
            </span>
          )}
        </td>
      </>
    ) : (
      <>
        <td className="p-4 italic text-gray-400" colSpan="2">No data - Run research</td>
        <td className="p-4 text-right">
          <Button 
            variant="primary"
            size="sm"
            icon="search_insights"
            onClick={onResearch}
          >
            Research
          </Button>
        </td>
      </>
    )}
  </tr>
);

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
            border-blue-900
            ring-2 ring-blue-900 ring-offset-2 ring-offset-white
            shadow-xl shadow-blue-900/10
            scale-[1.03]
          `
          : `
            border-blue-900/40
            hover:border-blue-900
            hover:shadow-lg
          `
      }
    `}
  >
    {/* Top accent bar */}
    <div
      className={`absolute top-0 left-0 w-full ${
        isHighlighted
          ? 'h-1.5 bg-yellow-500'
          : 'h-1 bg-yellow-500/60'
      }`}
    />

    <h4 className="text-[10px] font-black uppercase text-blue-900 mb-4 tracking-wider">
      {title}
    </h4>

    <p className="text-4xl font-extrabold text-blue-900 mb-2">
      {price}
    </p>

    <div className="flex items-center justify-center gap-1.5">
      <span className="text-[10px] font-bold text-gray-500 uppercase">
        Margin
      </span>
      <span className="text-xs font-extrabold text-yellow-500">
        {margin}%
      </span>
    </div>
  </div>
);


// Horizontal Offer Card 
export const HorizontalOfferCard = ({
  title,
  price,
  margin,
  isHighlighted,
  onClick
}) => (
  <div
    onClick={onClick}
    className={`
      flex items-center justify-between px-3 py-2 rounded-lg bg-white cursor-pointer relative
      border transition-all duration-150 ease-out
      ${
        isHighlighted
          ? `
            border-blue-900
            ring-1 ring-blue-900
            shadow-md
            scale-[1.02]
          `
          : `
            border-blue-900/30
            hover:border-blue-900
            hover:shadow-sm
          `
      }
    `}
  >
    {/* Left accent bar */}
    <div
      className={`absolute top-0 left-0 h-full w-1 rounded-l ${
        isHighlighted ? 'bg-yellow-500' : 'bg-yellow-500/60'
      }`}
    />

    {/* Content Row */}
    <div className="flex items-center gap-2 flex-1 ml-2 text-blue-900 font-extrabold text-sm uppercase">
      <span className="truncate">{title}</span>
      <span className="text-gray-400">/</span>
      <span>{price}</span>
      <span className="text-gray-400">/</span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500 font-bold">MARGIN</span>
        <span className="text-yellow-500 font-bold">{margin}%</span>
      </span>
    </div>
  </div>
);


// ==================== CART COMPONENTS ====================

// Cart Item Component
export const CartItem = ({ title, subtitle, price, isHighlighted, onRemove }) => (
  <div className={`group relative p-4 rounded-lg border transition-all ${
    isHighlighted 
      ? 'bg-slate-50 border-blue-900/10 hover:border-yellow-500 border-l-4 border-l-yellow-500' 
      : 'bg-white border-blue-900/10 hover:border-yellow-500'
  }`}>
    <div className="flex justify-between mb-2">
      <Badge variant={isHighlighted ? 'default' : 'default'}>
        <span className={isHighlighted ? 'text-white bg-blue-900 -mx-2 px-2 -my-1 py-1 rounded' : ''}>
          Trade-In
        </span>
      </Badge>
      <button onClick={onRemove} className="text-blue-900/30 hover:text-red-500 transition-colors">
        <Icon name="delete" className="text-sm" />
      </button>
    </div>
    <p className="text-sm font-bold text-blue-900 line-clamp-1">{title}</p>
    <div className="flex justify-between items-end mt-2">
      <p className="text-[11px] text-slate-500 font-medium">{subtitle}</p>
      <p className="text-sm font-extrabold text-slate-900">{price}</p>
    </div>
  </div>
);

export const Modal = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-[600px] relative">
        {children}
        <button className="absolute top-2 right-2" onClick={onClose}>×</button>
      </div>
    </div>
  );
};

