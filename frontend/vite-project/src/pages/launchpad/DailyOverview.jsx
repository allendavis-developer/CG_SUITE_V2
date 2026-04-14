import React from 'react';
import { formatGBP } from '@/utils/helpers';

const STAT_CONFIG = [
  {
    key: 'totalBoughtValue',
    label: 'Total Bought Value',
    icon: 'file_present',
    iconBg: 'bg-brand-blue/8',
    iconColor: 'text-brand-blue',
    accentBar: 'bg-brand-blue',
  },
  {
    key: 'totalSales',
    label: 'Total Sold',
    icon: 'sell',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    accentBar: 'bg-amber-400',
  },
];

const StatCard = ({ label, value, icon, iconBg, iconColor, accentBar }) => (
  <div className="cg-card cg-card-hover relative overflow-hidden">
    <div className={`absolute left-0 top-0 h-full w-[3px] ${accentBar}`} />
    <div className="flex items-start justify-between p-5 pl-6">
      <div className="flex flex-col gap-1">
        <p className="cg-stat-label">{label}</p>
        <p className="cg-stat-value">{formatGBP(value)}</p>
        <p className="text-xs text-slate-400 mt-0.5">Today's completed transactions</p>
      </div>
      <div className={`size-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0 ml-4`}>
        <span className={`material-symbols-outlined text-[20px] ${iconColor}`}>{icon}</span>
      </div>
    </div>
  </div>
);

const DailyOverview = ({ totalBoughtValue = 0, totalSales = 0 }) => {
  const values = { totalBoughtValue, totalSales };

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="cg-section-title">Daily Overview</h2>
          <p className="cg-section-subtitle">Completed transactions from today</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {STAT_CONFIG.map((cfg) => (
          <StatCard
            key={cfg.key}
            label={cfg.label}
            value={values[cfg.key]}
            icon={cfg.icon}
            iconBg={cfg.iconBg}
            iconColor={cfg.iconColor}
            accentBar={cfg.accentBar}
          />
        ))}
      </div>
    </section>
  );
};

export default DailyOverview;
