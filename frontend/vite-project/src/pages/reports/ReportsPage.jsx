import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';

/**
 * Reports page - request overview, repricing report, and upload report.
 */
const ReportCard = ({ icon, title, description, route }) => {
  const navigate = useNavigate();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(route)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(route);
        }
      }}
      className="group bg-white dark:bg-slate-900 rounded-xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer flex flex-col items-start gap-4 hover:border-brand-blue/30"
    >
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
      <div className="mt-auto flex items-center justify-center gap-2 text-brand-blue font-bold">
        <span>Open Report</span>
        <span className="material-symbols-outlined text-lg">arrow_forward</span>
      </div>
    </div>
  );
};

const ReportsPage = () => (
  <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-ui-bg dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <div className="layout-container flex h-full grow flex-col">
      <AppHeader />

      <main className="flex-1 px-6 md:px-20 lg:px-40 py-8">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-8">
            <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-extrabold tracking-tight mb-2">
              Reports
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-lg">
              Choose a report to view detailed transaction, repricing, and upload data.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <ReportCard
              icon="receipt_long"
              title="Request Overview"
              description="View all requests, filter by status (Quote, Booked, Complete), and manage transaction history."
              route="/requests-overview"
            />
            <ReportCard
              icon="sell"
              title="Repricing Report"
              description="View repricing sessions, history, and completed repricing runs across your inventory."
              route="/repricing-overview"
            />
            <ReportCard
              icon="upload"
              title="Upload Report"
              description="View upload sessions, history, and completed upload runs (same flow as upload module)."
              route="/upload-overview"
            />
          </div>
        </div>
      </main>
    </div>
  </div>
);

export default ReportsPage;
