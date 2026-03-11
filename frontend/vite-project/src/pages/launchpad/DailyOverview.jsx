import React from 'react';
import { formatGBP } from '@/utils/helpers';

/**
 * Daily overview stats: Total Bought Value, Total Sales (today's COMPLETE transactions).
 */
const StatCard = ({ label, value, isCurrency = false }) => (
  <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium uppercase tracking-wider">
        {label}
      </p>
    </div>
    <div className="flex items-baseline gap-2">
      <p className="text-slate-900 dark:text-slate-100 text-3xl font-extrabold">
        {isCurrency ? formatGBP(value) : value}
      </p>
    </div>
  </div>
);

const DailyOverview = ({ totalBoughtValue = 0, totalSales = 0 }) => (
    <section className="mb-10">
      <div className="mb-5">
        <h2 className="text-slate-900 dark:text-slate-100 text-2xl font-bold tracking-tight">
          Daily Overview
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <StatCard label="Total Bought Value" value={totalBoughtValue} isCurrency />
        <StatCard label="Total Sold" value={totalSales} isCurrency />
      </div>
    </section>
);

export default DailyOverview;
