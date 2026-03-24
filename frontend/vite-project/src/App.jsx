import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Negotiation from "./pages/buyer/Negotiation";
import RepricingNegotiation from "./pages/buyer/RepricingNegotiation";
import RepricingOverview from "./pages/buyer/RepricingOverview";
import RepricingSessionView from "./pages/buyer/RepricingSessionView";
import TransactionComplete from "./pages/buyer/TransactionComplete";
import RequestsOverview from "./pages/buyer/RequestsOverview";
import LaunchpadPage from "./pages/launchpad/LaunchpadPage";
import ReportsPage from "./pages/reports/ReportsPage";
import PricingRulesPage from "./pages/pricing/PricingRulesPage";
import useAppStore from "./store/useAppStore";

function Home() {
  return <LaunchpadPage />;
}

/** Remount when resetBuyer() bumps store resetKey so "New buy" clears local negotiation state. */
function BuyerNegotiationRoute() {
  const resetKey = useAppStore((s) => s.resetKey);
  return <Negotiation key={resetKey} mode="negotiate" />;
}

/** Remount on each navigation (including same-path) so "New repricing" and session opens get a fresh workspace. */
function RepricingWorkspaceRoute() {
  const location = useLocation();
  const repricingWorkspaceNonce = useAppStore((s) => s.repricingWorkspaceNonce);
  return (
    <RepricingNegotiation key={`${location.pathname}-${repricingWorkspaceNonce}-${location.key}`} />
  );
}

export default function App() {
  useEffect(() => {
    useAppStore.getState().loadEbayOfferMargins();
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer" element={<BuyerNegotiationRoute />} />
        <Route path="/repricing" element={<RepricingWorkspaceRoute />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* Route for new negotiations. When navigating from /buyer, state will be passed. */}
        <Route path="/negotiation" element={<BuyerNegotiationRoute />} />
        <Route path="/repricing-negotiation" element={<RepricingWorkspaceRoute />} />
        <Route path="/repricing-overview" element={<RepricingOverview />} />
        <Route path="/repricing-sessions/:repricingSessionId/view" element={<RepricingSessionView />} />
        {/* Route for viewing existing requests in a read-only negotiation interface */}
        <Route path="/requests/:requestId/view" element={<Negotiation mode="view" />} />
        <Route path="/transaction-complete" element={<TransactionComplete />} />
        <Route path="/requests-overview" element={<RequestsOverview />} />
        <Route path="/pricing-rules" element={<PricingRulesPage />} />
      </Routes>
    </BrowserRouter>
  );
}

