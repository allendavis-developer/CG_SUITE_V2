import React from 'react';

/**
 * Welcome header for the launchpad with greeting.
 */
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const LaunchpadWelcome = ({ userName = 'A' }) => (
  <div className="mb-8">
    <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-extrabold tracking-tight mb-2">
      System Launchpad
    </h1>
    <p className="text-slate-500 dark:text-slate-400 text-lg">
      {getGreeting()}, {userName}. Here&apos;s what&apos;s happening today.
    </p>
  </div>
);

export default LaunchpadWelcome;
