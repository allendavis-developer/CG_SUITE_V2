import React, { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Negotiation from "./pages/buyer/Negotiation";
import RepricingNegotiation from "./pages/buyer/RepricingNegotiation";
import RepricingOverview from "./pages/buyer/RepricingOverview";
import RepricingSessionView from "./pages/buyer/RepricingSessionView";
import UploadOverview from "./pages/buyer/UploadOverview";
import UploadSessionView from "./pages/buyer/UploadSessionView";
import TransactionComplete from "./pages/buyer/TransactionComplete";
import RequestsOverview from "./pages/buyer/RequestsOverview";
import LaunchpadPage from "./pages/launchpad/LaunchpadPage";
import ReportsPage from "./pages/reports/ReportsPage";
import PricingRulesPage from "./pages/pricing/PricingRulesPage";
import useAppStore from "./store/useAppStore";
import {
  bootstrapBuyerWorkspaceFromRoute,
  bootstrapRepricingWorkspaceFromRoute,
  REPRICING_WORKSPACE_PATHS,
  UPLOAD_WORKSPACE_PATHS,
} from "./store/workspaceRouteBootstrap";

function Home() {
  return <LaunchpadPage />;
}

/** Align Zustand with the route on each visit so Negotiation never shows a stale cart. */
function BuyerNegotiationRoute() {
  const location = useLocation();
  const resetKey = useAppStore((s) => s.resetKey);

  useLayoutEffect(() => {
    bootstrapBuyerWorkspaceFromRoute(location.state, useAppStore.setState);
  }, [location.key]);

  return <Negotiation key={resetKey} mode="negotiate" />;
}

function RepricingWorkspaceRoute() {
  const location = useLocation();
  const repricingWorkspaceNonce = useAppStore((s) => s.repricingWorkspaceNonce);
  const isUpload =
    location.pathname === '/upload' || location.pathname === '/upload-negotiation';

  useLayoutEffect(() => {
    bootstrapRepricingWorkspaceFromRoute(
      location.state,
      useAppStore.setState,
      isUpload ? UPLOAD_WORKSPACE_PATHS : REPRICING_WORKSPACE_PATHS
    );
  }, [location.key, isUpload]);

  return (
    <RepricingNegotiation
      key={`${location.pathname}-${repricingWorkspaceNonce}-${location.key}`}
      moduleKey={isUpload ? 'upload' : 'repricing'}
    />
  );
}

export default function App() {
  useEffect(() => {
    useAppStore.getState().loadEbayOfferMargins();
    useAppStore.getState().loadCustomerOfferRulesData();
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer" element={<BuyerNegotiationRoute />} />
        <Route path="/repricing" element={<RepricingWorkspaceRoute />} />
        <Route path="/upload" element={<RepricingWorkspaceRoute />} />
        <Route path="/upload-negotiation" element={<RepricingWorkspaceRoute />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/data" element={<Navigate to="/" replace />} />
        <Route path="/data/nospos-categories" element={<Navigate to="/" replace />} />
        <Route path="/data/nospos-fields" element={<Navigate to="/" replace />} />
        <Route path="/data/nospos-attributes" element={<Navigate to="/" replace />} />
        <Route path="/scrape" element={<Navigate to="/" replace />} />
        {/* Route for new negotiations. When navigating from /buyer, state will be passed. */}
        <Route path="/negotiation" element={<BuyerNegotiationRoute />} />
        <Route path="/repricing-negotiation" element={<RepricingWorkspaceRoute />} />
        <Route path="/repricing-overview" element={<RepricingOverview />} />
        <Route path="/repricing-sessions/:repricingSessionId/view" element={<RepricingSessionView />} />
        <Route path="/upload-overview" element={<UploadOverview />} />
        <Route path="/upload-sessions/:uploadSessionId/view" element={<UploadSessionView />} />
        {/* Route for viewing existing requests in a read-only negotiation interface */}
        <Route path="/requests/:requestId/view" element={<Negotiation mode="view" />} />
        <Route path="/transaction-complete" element={<TransactionComplete />} />
        <Route path="/requests-overview" element={<RequestsOverview />} />
        <Route path="/pricing-rules" element={<PricingRulesPage />} />
      </Routes>
    </BrowserRouter>
  );
}

