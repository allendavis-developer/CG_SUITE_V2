import React from 'react';
import { useNavigate } from 'react-router-dom';

const MODULE_COLORS = {
  shopping_cart_checkout: {
    accent: 'from-brand-blue/10 to-brand-blue/5',
    icon: 'text-brand-blue',
    border: 'group-hover:border-brand-blue/30',
    bar: 'var(--brand-blue)',
  },
  analytics: {
    accent: 'from-amber-50 to-amber-50/30',
    icon: 'text-amber-600',
    border: 'group-hover:border-amber-300',
    bar: '#f59e0b',
  },
  summarize: {
    accent: 'from-emerald-50 to-emerald-50/30',
    icon: 'text-emerald-600',
    border: 'group-hover:border-emerald-300',
    bar: '#10b981',
  },
  tune: {
    accent: 'from-violet-50 to-violet-50/30',
    icon: 'text-violet-600',
    border: 'group-hover:border-violet-300',
    bar: '#7c3aed',
  },
};

const ModuleCard = ({ icon, title, description, route, buttonLabel, onNavigate }) => {
  const navigate = useNavigate();
  const colors = MODULE_COLORS[icon] ?? MODULE_COLORS.analytics;

  const handleClick = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      navigate(route);
    }
  };

  return (
    <div className={`group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden ${colors.border}`}>
      {/* Top accent */}
      <div className="h-[3px] w-full shrink-0 group-hover:opacity-100" style={{ background: colors.bar }} />
      <div className="p-6 flex flex-col flex-1 gap-4">
        <div className={`size-12 bg-gradient-to-br ${colors.accent} rounded-xl flex items-center justify-center border border-slate-100 shadow-sm`}>
          <span className={`material-symbols-outlined text-[26px] ${colors.icon}`}>{icon}</span>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1.5">
            {title}
          </h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          className="mt-auto flex items-center justify-center gap-2 bg-brand-blue hover:bg-brand-blue-hover text-white font-semibold py-2.5 px-5 rounded-lg transition-colors text-sm w-full group/btn"
        >
          <span>{buttonLabel}</span>
          <span className="material-symbols-outlined text-[17px] transition-transform duration-150 group-hover/btn:translate-x-0.5">arrow_forward</span>
        </button>
      </div>
    </div>
  );
};

export default ModuleCard;
