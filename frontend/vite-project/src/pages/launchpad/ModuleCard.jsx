import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Card for a launchpad module (Buying or Repricing).
 * Uses brand-orange accent button, primary icon background.
 */
const ModuleCard = ({ icon, title, description, route, buttonLabel }) => {
  const navigate = useNavigate();

  return (
    <div className="group bg-white dark:bg-slate-900 rounded-xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md transition-shadow flex flex-col items-start gap-4">
      <div className="size-14 bg-brand-blue/10 text-brand-blue rounded-xl flex items-center justify-center mb-2">
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>
      <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          {title}
        </h3>
        <p className="text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate(route)}
        className="mt-auto flex items-center justify-center gap-2 bg-brand-orange hover:bg-brand-orange-hover text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors w-full sm:w-auto"
      >
        <span>{buttonLabel}</span>
        <span className="material-symbols-outlined text-lg">arrow_forward</span>
      </button>
    </div>
  );
};

export default ModuleCard;
