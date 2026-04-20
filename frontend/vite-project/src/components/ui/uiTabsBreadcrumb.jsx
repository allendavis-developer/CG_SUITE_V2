import React from 'react';
import { Icon } from '@/components/ui/uiPrimitives';

export const Tab = ({ icon, label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative px-5 py-3.5 text-sm font-semibold flex items-center gap-2 transition-all duration-150 border-b-2 select-none focus-visible:outline-none ${
      isActive
        ? 'border-brand-orange text-brand-blue bg-white'
        : 'border-transparent text-slate-500 hover:text-brand-blue hover:bg-slate-50/70'
    }`}
  >
    <Icon name={icon} className="text-[18px] leading-none" />
    {label}
  </button>
);

export const Breadcrumb = ({ items }) => (
  <nav className="flex items-center gap-1.5 mb-3 flex-wrap">
    {items.map((item, index) => (
      <React.Fragment key={index}>
        {index > 0 && (
          <span className="material-symbols-outlined text-[14px] text-slate-300 leading-none select-none">
            chevron_right
          </span>
        )}
        {index === items.length - 1 ? (
          <span className="text-xs font-semibold text-brand-blue">{item}</span>
        ) : (
          <a className="text-xs font-medium text-slate-400 hover:text-brand-blue transition-colors" href="#">
            {item}
          </a>
        )}
      </React.Fragment>
    ))}
  </nav>
);
