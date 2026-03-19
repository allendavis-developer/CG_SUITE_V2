import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Buyer from "./pages/buyer/Buyer";
import Negotiation from "./pages/buyer/Negotiation";
import RepricingNegotiation from "./pages/buyer/RepricingNegotiation";
import RepricingOverview from "./pages/buyer/RepricingOverview";
import RepricingSessionView from "./pages/buyer/RepricingSessionView";
import TransactionComplete from "./pages/buyer/TransactionComplete";
import RequestsOverview from "./pages/buyer/RequestsOverview";
import LaunchpadPage from "./pages/launchpad/LaunchpadPage";
import ReportsPage from "./pages/reports/ReportsPage";
import PricingRulesPage from "./pages/pricing/PricingRulesPage";
function Home() {
  return <LaunchpadPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer" element={<Buyer key="buyer" />} />
        <Route path="/repricing" element={<Buyer key="repricing" mode="repricing" />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* Route for new negotiations. When navigating from /buyer, state will be passed. */}
        <Route path="/negotiation" element={<Negotiation mode="negotiate" />} />
        <Route path="/repricing-negotiation" element={<RepricingNegotiation />} />
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

