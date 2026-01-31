import React from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Button } from "./components/ui/components"; 
import Buyer from "./pages/buyer/Buyer";

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
        <Route path="/react" element={<Home />} />
        <Route path="/buyer" element={<Buyer />} />
      </Routes>
    </BrowserRouter>
  );
}
