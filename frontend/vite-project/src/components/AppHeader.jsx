import React from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Shared header used across all pages.
 * - Internal Tool logo → Launchpad
 * - Buy icon → Buying Module
 * - Repricing icon → Repricing Module
 * - Reports icon → Reports
 */
const AppHeader = () => {
  const location = useLocation();

  const NavIcon = ({ to, icon, label, tooltip }) => (
    <Link
      to={to}
      title={tooltip}
      className={`flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors ${
        location.pathname === to || location.pathname.startsWith(to + '/')
          ? 'bg-white/30 text-white'
          : 'bg-white/20 text-white hover:bg-white/30'
      }`}
      aria-label={label}
    >
      <span className="material-symbols-outlined">{icon}</span>
    </Link>
  );

  return (
    <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-brand-blue bg-brand-blue px-6 md:px-10 py-3 sticky top-0 z-50 text-white">
      <div className="flex items-center gap-6">
        <Link
          to="/"
          className="flex items-center gap-3 text-brand-blue hover:opacity-90 transition-opacity"
        >
          <div className="size-8 flex items-center justify-center bg-white text-brand-blue rounded-lg">
            <span className="material-symbols-outlined">rocket_launch</span>
          </div>
          <h2 className="text-white text-xl font-bold leading-tight tracking-tight">
            Internal Tool
          </h2>
        </Link>

        <div className="flex items-center gap-2">
          <NavIcon
            to="/buyer"
            icon="shopping_cart_checkout"
            label="Buying Module"
            tooltip="Buying Module"
          />
          <NavIcon
            to="/repricing"
            icon="analytics"
            label="Repricing Module"
            tooltip="Repricing Module"
          />
          <NavIcon
            to="/reports"
            icon="summarize"
            label="Reports"
            tooltip="Reports"
          />
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
