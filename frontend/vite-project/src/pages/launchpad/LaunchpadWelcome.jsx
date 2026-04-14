import React from 'react';

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const formatDate = () =>
  new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const LaunchpadWelcome = ({ userName = 'A' }) => (
  <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-brand-orange mb-1.5">
        CG Suite
      </p>
      <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-extrabold tracking-tight mb-1.5">
        System Launchpad
      </h1>
      <p className="text-slate-500 dark:text-slate-400 text-base">
        {getGreeting()}, {userName}.{' '}
        <span className="text-slate-400">Here&apos;s what&apos;s happening today.</span>
      </p>
    </div>
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 shadow-sm shrink-0">
      <span className="material-symbols-outlined text-[17px] text-slate-400">calendar_today</span>
      <span className="text-sm font-semibold text-slate-600">{formatDate()}</span>
    </div>
  </div>
);

export default LaunchpadWelcome;
