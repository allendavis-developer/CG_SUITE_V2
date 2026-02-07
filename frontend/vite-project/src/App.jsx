import React from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Button } from "./components/ui/components"; 
import Buyer from "./pages/buyer/Buyer";
import Negotiation from "./pages/buyer/Negotiation";
import TransactionComplete from "./pages/buyer/TransactionComplete";
import RequestsOverview from "./pages/buyer/RequestsOverview"; // Import RequestsOverview


function Home() {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center h-screen">
      <Button onClick={() => navigate("/buyer")}>
        Go to Buyer Page
      </Button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buyer" element={<Buyer />} />
        {/* Route for new negotiations. When navigating from /buyer, state will be passed. */}
        <Route path="/negotiation" element={<Negotiation mode="negotiate" />} /> 
        {/* Route for viewing existing requests in a read-only negotiation interface */}
        <Route path="/requests/:requestId/view" element={<Negotiation mode="view" />} />
        <Route path="/transaction-complete" element={<TransactionComplete />} />
        <Route path="/requests-overview" element={<RequestsOverview />} /> {/* Route for the requests overview page */}
      </Routes>
    </BrowserRouter>
  );
}

