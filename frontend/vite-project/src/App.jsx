import React, { useEffect } from "react";
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
import { REPRICING_PROGRESS_KEY } from "./utils/repricingProgress";

function RepricingProgressListener() {
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "REPRICING_PROGRESS" && e.data.payload) {
        try {
          const stored = JSON.parse(localStorage.getItem(REPRICING_PROGRESS_KEY) || "{}");
          const { cartKey, completedBarcodes, completedItems } = e.data.payload;
          if (cartKey) {
            const next = { ...stored, [cartKey]: { ...(stored[cartKey] || {}), completedBarcodes, completedItems } };
            localStorage.setItem(REPRICING_PROGRESS_KEY, JSON.stringify(next));
          }
        } catch (err) {
          console.warn("[CG Suite] Failed to save repricing progress:", err);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  return null;
}

function Home() {
  return <LaunchpadPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <RepricingProgressListener />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer" element={<Buyer />} />
        <Route path="/repricing" element={<Buyer mode="repricing" />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* Route for new negotiations. When navigating from /buyer, state will be passed. */}
        <Route path="/negotiation" element={<Negotiation mode="negotiate" />} />
        <Route path="/repricing-negotiation" element={<RepricingNegotiation />} />
        <Route path="/repricing-overview" element={<RepricingOverview />} />
        <Route path="/repricing-sessions/:repricingSessionId/view" element={<RepricingSessionView />} />
        {/* Route for viewing existing requests in a read-only negotiation interface */}
        <Route path="/requests/:requestId/view" element={<Negotiation mode="view" />} />
        <Route path="/transaction-complete" element={<TransactionComplete />} />
        <Route path="/requests-overview" element={<RequestsOverview />} /> {/* Route for the requests overview page */}
      </Routes>
    </BrowserRouter>
  );
}

