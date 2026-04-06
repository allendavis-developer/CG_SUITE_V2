import React, { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Negotiation from "./pages/buyer/Negotiation";
import RepricingNegotiation from "./pages/buyer/RepricingNegotiation";
import RepricingOverview from "./pages/buyer/RepricingOverview";
import RepricingSessionView from "./pages/buyer/RepricingSessionView";
import TransactionComplete from "./pages/buyer/TransactionComplete";
import RequestsOverview from "./pages/buyer/RequestsOverview";
import LaunchpadPage from "./pages/launchpad/LaunchpadPage";
import ReportsPage from "./pages/reports/ReportsPage";
import PricingRulesPage from "./pages/pricing/PricingRulesPage";
import DataPage from "./pages/data/DataPage";
import NosposCategoriesTablePage from "./pages/data/NosposCategoriesTablePage";
import NosposFieldsPage from "./pages/data/NosposFieldsPage";
import useAppStore from "./store/useAppStore";

const FRESH_CUSTOMER = {
  id: null,
  name: "No Customer Selected",
  cancelRate: 0,
  transactionType: "sale",
};

/**
 * True when navigating to /buyer or /negotiation with an intentional handoff
 * (cart, quote resume, back-from-negotiation). In those cases we only clear
 * repricing state; Negotiation reads cart/customer from location.state first.
 */
function isBuyerHandoffState(st) {
  if (!st || typeof st !== "object") return false;
  if (st.preserveCart === true) return true;
  if (st.openQuoteRequest?.current_status === "QUOTE") return true;
  if (Array.isArray(st.cartItems) && st.cartItems.length > 0) return true;
  if (st.currentRequestId != null && st.currentRequestId !== "") return true;
  return false;
}

/** Session restore / resume for repricing (overview, redo, cart sidebar handoff). */
function isRepricingHandoffState(st) {
  if (!st || typeof st !== "object") return false;
  if (st.sessionId != null && st.sessionId !== "") return true;
  if (Array.isArray(st.cartItems) && st.cartItems.length > 0) return true;
  if (st.sessionBarcodes && Object.keys(st.sessionBarcodes).length > 0) return true;
  if (st.sessionNosposLookups && Object.keys(st.sessionNosposLookups).length > 0) return true;
  return false;
}

function Home() {
  return <LaunchpadPage />;
}

/**
 * Sync global store on every entry so Negotiation never shows stale cartItems from
 * zustand when using header <Link> or switching modules. Remount via resetKey.
 */
function BuyerNegotiationRoute() {
  const location = useLocation();
  const resetKey = useAppStore((s) => s.resetKey);

  useLayoutEffect(() => {
    const st = location.state;
    if (isBuyerHandoffState(st)) {
      // Clear zustand cart so Negotiation cannot fall back to stale store when
      // state carries the handoff (e.g. openQuoteRequest has no cartItems in state).
      useAppStore.setState({
        mode: "buyer",
        cartItems: [],
        repricingSessionId: null,
        repricingCartItems: [],
      });
      useAppStore.setState((s) => ({ resetKey: s.resetKey + 1 }));
      return;
    }

    useAppStore.setState((s) => ({
      mode: "buyer",
      cartItems: [],
      repricingCartItems: [],
      repricingSessionId: null,
      customerData: { ...FRESH_CUSTOMER },
      intent: null,
      request: null,
      selectedCategory: null,
      availableModels: [],
      selectedModel: null,
      selectedCartItemId: null,
      cexProductData: null,
      cexLoading: false,
      isQuickRepriceOpen: false,
      isCustomerModalOpen: true,
      resetKey: s.resetKey + 1,
      repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
    }));
  }, [location.key]);

  return <Negotiation key={resetKey} mode="negotiate" />;
}

/** Same for repricing: clear buyer + stale repricingSessionId unless state restores a session. */
function RepricingWorkspaceRoute() {
  const location = useLocation();
  const repricingWorkspaceNonce = useAppStore((s) => s.repricingWorkspaceNonce);

  useLayoutEffect(() => {
    const st = location.state;
    if (isRepricingHandoffState(st)) {
      useAppStore.setState({
        mode: "repricing",
        repricingSessionId: st.sessionId ?? null,
        repricingCartItems: [],
        cartItems: [],
        customerData: { ...FRESH_CUSTOMER },
        intent: null,
        request: null,
        selectedCategory: null,
        availableModels: [],
        selectedModel: null,
        selectedCartItemId: null,
        cexProductData: null,
        cexLoading: false,
        isQuickRepriceOpen: false,
        isCustomerModalOpen: false,
      });
      useAppStore.setState((s) => ({ resetKey: s.resetKey + 1 }));
      return;
    }

    useAppStore.setState((s) => ({
      mode: "repricing",
      repricingSessionId: null,
      repricingCartItems: [],
      selectedCategory: null,
      selectedModel: null,
      selectedCartItemId: null,
      cexProductData: null,
      cexLoading: false,
      isQuickRepriceOpen: false,
      cartItems: [],
      customerData: { ...FRESH_CUSTOMER },
      intent: null,
      request: null,
      isCustomerModalOpen: false,
      repricingWorkspaceNonce: s.repricingWorkspaceNonce + 1,
      resetKey: s.resetKey + 1,
    }));
  }, [location.key]);

  return (
    <RepricingNegotiation key={`${location.pathname}-${repricingWorkspaceNonce}-${location.key}`} />
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
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/data/nospos-categories" element={<NosposCategoriesTablePage />} />
        <Route path="/data/nospos-fields" element={<NosposFieldsPage />} />
        <Route path="/data/nospos-attributes" element={<Navigate to="/data/nospos-fields" replace />} />
        <Route path="/scrape" element={<Navigate to="/data" replace />} />
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

