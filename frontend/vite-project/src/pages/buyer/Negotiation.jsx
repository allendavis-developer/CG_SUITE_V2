import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button, Icon, Header } from "@/components/ui/components";

const Negotiation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartItems, customerData } = location.state || {};

  // Redirect if no cart data
  useEffect(() => {
    if (!cartItems || cartItems.length === 0 || !customerData?.id) {
      navigate("/buyer", { replace: true });
    }
  }, [cartItems, customerData, navigate]);

  if (!cartItems || cartItems.length === 0 || !customerData?.id) {
    // optional: render nothing while redirecting
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {/* Include the same Header as the Buyer page */}
      <Header onSearch={(val) => console.log("Search:", val)} />

      <main className="flex flex-col items-center justify-center flex-1 p-6">
        <h1 className="text-3xl font-extrabold text-blue-900 mb-4">
          Negotiation Screen
        </h1>
        <p className="text-gray-700 text-center mb-6">
          Here you handle negotiation for the selected offers and customer.
        </p>

        <Button variant="secondary" onClick={() => navigate(-1)}>
          <Icon name="arrow_back" /> Back to Cart
        </Button>
      </main>
    </div>
  );
};

export default Negotiation;
