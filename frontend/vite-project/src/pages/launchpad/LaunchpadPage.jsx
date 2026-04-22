import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import LaunchpadWelcome from './LaunchpadWelcome';
import ModuleCard from './ModuleCard';
import DailyOverview from './DailyOverview';
import RecentActivityTable from './RecentActivityTable';
import { API_BASE_URL } from '@/services/api';
import useAppStore from '@/store/useAppStore';

/**
 * Computes launchpad stats and recent transactions from requests overview data.
 * Only COMPLETE transactions created today. Includes BUYBACK, STORE_CREDIT, and DIRECT_SALE.
 */
const computeLaunchpadData = (requests) => {
  const today = new Date().toDateString();

  const todayComplete = (requests || []).filter(
    (r) =>
      r.current_status === 'COMPLETE' &&
      r.created_at &&
      new Date(r.created_at).toDateString() === today
  );

  let totalBoughtValue = 0;
  let totalSales = 0;

  const transactions = todayComplete.map((r) => {
    const amount = Number(r.negotiated_grand_total_gbp) || 0;
    const isBuy = r.intent === 'BUYBACK' || r.intent === 'STORE_CREDIT';
    const isSale = r.intent === 'DIRECT_SALE';

    if (isBuy) totalBoughtValue += amount;
    if (isSale) totalSales += amount;

    return {
      request_id: r.request_id,
      customer_name: r.customer_details?.name || 'Unknown',
      intent: r.intent,
      amount,
    };
  });

  return {
    totalBoughtValue,
    totalSales,
    transactions,
    totalCount: transactions.length,
  };
};

/**
 * System Launchpad - main entry page with module cards, daily overview, and recent activity.
 * Matches MainContent styling (primary, accent, cards, tables).
 */
const LaunchpadPage = () => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleOpenBuyer = () => {
    useAppStore.getState().resetBuyerWorkspace({ openCustomerModal: true });
    navigate('/buyer');
  };

  const handleOpenRepricing = () => {
    useAppStore.getState().resetRepricingWorkspace();
    navigate('/repricing');
  };

  const handleOpenUpload = () => {
    useAppStore.getState().resetRepricingWorkspace({
      homePath: '/upload',
      negotiationPath: '/upload-negotiation',
    });
    navigate('/upload');
  };

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/requests/overview/`);
        if (!res.ok) throw new Error('Failed to fetch requests');
        const data = await res.json();
        setRequests(data);
      } catch (err) {
        console.error('[Launchpad] Failed to fetch requests:', err);
        setError(err.message);
        setRequests([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, []);

  const { totalBoughtValue, totalSales, transactions, totalCount } =
    useMemo(() => computeLaunchpadData(requests), [requests]);

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-ui-bg dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <div className="layout-container flex h-full grow flex-col">
        <AppHeader />

        <main className="flex-1 px-4 sm:px-8 lg:px-12 py-8">
          <div className="max-w-[1120px] mx-auto">
            <LaunchpadWelcome />

            {/* Module Cards */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="cg-section-title">Modules</h2>
                <p className="cg-section-subtitle">Select a module to get started</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <ModuleCard
                  icon="shopping_cart_checkout"
                  title="Buying Module"
                  description="Manage customer buy-backs, store credits, and direct sales."
                  route="/buyer"
                  buttonLabel="Open Buying Module"
                  onNavigate={handleOpenBuyer}
                />
                <ModuleCard
                  icon="analytics"
                  title="Repricing Module"
                  description="Analyse real-time competitor data and update product pricing."
                  route="/repricing"
                  buttonLabel="Open Repricing Module"
                  onNavigate={handleOpenRepricing}
                />
                <ModuleCard
                  icon="upload"
                  title="Upload Module"
                  description="Same repricing flow with one barcode per line item and a compact layout."
                  route="/upload"
                  buttonLabel="Open Upload Module"
                  onNavigate={handleOpenUpload}
                />
                <ModuleCard
                  icon="database"
                  title="Data"
                  description="Reference-data tools: refresh the Web EPOS category mirror and similar imports."
                  route="/data"
                  buttonLabel="Open Data"
                />
                <ModuleCard
                  icon="summarize"
                  title="Reports"
                  description="View transaction history, performance summaries, and analytics."
                  route="/reports"
                  buttonLabel="Open Reports"
                />
                <ModuleCard
                  icon="tune"
                  title="Pricing rules"
                  description="Configure category-based CeX, margin, and offer tiers used in buying and repricing."
                  route="/pricing-rules"
                  buttonLabel="Open pricing rules"
                />
              </div>
            </div>

            {/* Daily Overview */}
            {loading ? (
              <section className="mb-8">
                <div className="cg-card flex items-center justify-center py-12 text-slate-400 gap-2">
                  <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                  <span className="text-sm font-medium">Loading overview…</span>
                </div>
              </section>
            ) : error ? (
              <section className="mb-8">
                <div className="cg-card p-6 flex items-start gap-3 border-amber-200 bg-amber-50/60">
                  <span className="material-symbols-outlined text-amber-500 text-xl shrink-0 mt-0.5">warning</span>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Could not load overview data</p>
                    <p className="text-xs text-amber-700 mt-0.5">{error}</p>
                  </div>
                </div>
              </section>
            ) : (
              <DailyOverview
                totalBoughtValue={totalBoughtValue}
                totalSales={totalSales}
              />
            )}

            {/* Recent Activity */}
            {loading ? (
              <section>
                <div className="cg-card flex items-center justify-center py-12 text-slate-400 gap-2">
                  <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                  <span className="text-sm font-medium">Loading recent activity…</span>
                </div>
              </section>
            ) : (
              <RecentActivityTable
                transactions={transactions}
                totalCount={totalCount}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default LaunchpadPage;
