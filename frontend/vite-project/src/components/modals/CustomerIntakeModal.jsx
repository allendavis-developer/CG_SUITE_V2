import React, { useState, useRef } from "react";
import { SearchableDropdown } from "../ui/components"; // import your component

export default function CustomerIntakeModal({ open = true, onClose }) {
  const [isExisting, setIsExisting] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [transactionType, setTransactionType] = useState("sale"); // "sale" or "buyback"

  // Ref for new customer input
  const newCustomerRef = useRef(null);

  // Mock customer data
  const mockCustomers = [
    "John Doe",
    "Jane Smith",
    "Alice Johnson",
    "Bob Williams",
    "Charlie Brown"
  ];

  if (!open) return null;

  const handleClose = () => {
    const customerName = isExisting
      ? selectedCustomer
      : newCustomerRef.current?.value || "";

    // Pass structured info to parent
    onClose({
      isExisting,
      customerName,
      transactionType,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-blue-900 px-8 py-6 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-yellow-500 text-2xl">
              person_add
            </span>
            <div>
              <h3 className="text-xl font-bold leading-none">Customer Intake</h3>
              <p className="text-white/70 text-sm mt-1">
                Identify or register the customer to proceed
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="size-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Toggle - Customer Type */}
        <div className="px-8 pt-8 pb-4">
          <div className="bg-gray-100 p-1 rounded-xl flex border border-gray-200">
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="cust-toggle"
                className="hidden peer"
                checked={!isExisting}
                onChange={() => setIsExisting(false)}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-yellow-500">
                <span className="material-symbols-outlined text-lg">
                  person_add
                </span>
                New Customer
              </div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="cust-toggle"
                className="hidden peer"
                checked={isExisting}
                onChange={() => setIsExisting(true)}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-yellow-500">
                <span className="material-symbols-outlined text-lg">
                  manage_search
                </span>
                Existing Customer
              </div>
            </label>
          </div>
        </div>

        {/* Toggle - Transaction Type */}
        <div className="px-8 pb-6">
          <div className="bg-gray-100 p-1 rounded-xl flex border border-gray-200">
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="transaction-toggle"
                className="hidden peer"
                checked={transactionType === "sale"}
                onChange={() => setTransactionType("sale")}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-yellow-500">
                <span className="material-symbols-outlined text-lg">
                  point_of_sale
                </span>
                Direct Sale
              </div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="transaction-toggle"
                className="hidden peer"
                checked={transactionType === "buyback"}
                onChange={() => setTransactionType("buyback")}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-yellow-500">
                <span className="material-symbols-outlined text-lg">
                  autorenew
                </span>
                Buy Back
              </div>
            </label>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 flex-1 overflow-y-auto">
          {/* SearchableDropdown for Existing Customer only */}
          {isExisting && (
            <div className="mb-6">
              <SearchableDropdown
                label="Find Customer"
                value={selectedCustomer}
                options={mockCustomers}
                onChange={setSelectedCustomer}
                placeholder="Search by name..."
              />
            </div>
          )}

          {/* Info Banner (Existing Customer only) */}
          {isExisting && (
            <div className="mb-6 bg-blue-900/5 border border-blue-900/20 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-blue-900 mt-0.5">
                info
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold text-blue-900 leading-tight">
                  Customer Match Found
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Is the following information still correct? You can edit any field below if needed.
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <div className="grid grid-cols-1 gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Full Name
              </label>
              <input
                type="text"
                ref={newCustomerRef}
                placeholder="Enter customer's full name"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="(555) 000-0000"
                  className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="customer@example.com"
                  className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Physical Address
              </label>
              <input
                type="text"
                placeholder="123 Street Name, City, State, ZIP"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="p-8 border-t border-gray-100 flex items-center justify-between bg-white/50">
          <button
            onClick={handleClose}
            className="px-6 py-3 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            className="bg-yellow-500 hover:brightness-105 active:scale-[0.98] text-blue-900 font-black py-4 px-10 rounded-xl shadow-lg shadow-yellow-500/20 flex items-center gap-2 transition-all"
          >
            Confirm &amp; Proceed
            <span className="material-symbols-outlined font-bold">
              arrow_forward
            </span>
          </button>
        </footer>
      </div>
    </div>
  );
}