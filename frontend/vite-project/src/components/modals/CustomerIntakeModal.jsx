import React, { useState, useRef, useEffect } from "react";
import { SearchableDropdown } from "../ui/components"; // import your component




export default function CustomerIntakeModal({ open = true, onClose }) {
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [transactionType, setTransactionType] = useState("sale"); // "sale", "buyback", or "store_credit"
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tempCR, setTempCR] = useState(""); // new temporary cancel rate
  const [nosposQuery, setNosposQuery] = useState("");
  const [nosposResults, setNosposResults] = useState([]);
  const [nosposLoading, setNosposLoading] = useState(false);

  const mockNosposData = [
    { id: 101, name: "Alice Johnson", phone: "555-1234", email: "alice@example.com", address: "123 Main St" },
    { id: 102, name: "Bob Smith", phone: "555-5678", email: "bob@example.com", address: "456 Oak Ave" },
    { id: 103, name: "Charlie Brown", phone: "555-8765", email: "charlie@example.com", address: "789 Pine Rd" },
  ];

  const fetchNosposCustomers = async (query) => {
    setNosposLoading(true);
    try {
      if (!query.trim()) {
        setNosposResults([]);
        return;
      }

      // Filter mock data based on query
      const results = mockNosposData.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      );

      setNosposResults(results);
    } catch (err) {
      console.error("Error fetching NoSpos customers:", err);
    } finally {
      setNosposLoading(false);
    }
  };


  // Refs for form inputs
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const emailRef = useRef(null);
  const addressRef = useRef(null);

  const handleNosposSearch = () => {
    if (!nosposQuery.trim()) {
      setNosposResults([]);
      return;
    }

    setNosposLoading(true);

    // Simulate fetch delay
    setTimeout(() => {
      const results = mockNosposData.filter((c) =>
        c.name.toLowerCase().includes(nosposQuery.toLowerCase())
      );
      setNosposResults(results);
      setNosposLoading(false);
    }, 300);
  };



  // Fetch customers from API
  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/customers/");
        if (!response.ok) {
          throw new Error("Failed to fetch customers");
        }
        const data = await response.json();
        setCustomers(data);
      } catch (err) {
        setError(err.message);
        console.error("Error fetching customers:", err);
      } finally {
        setLoading(false);
      }
    };

    if (open) {
      fetchCustomers();
    }
  }, [open]);

    // Populate form when existing customer is selected
    useEffect(() => {
    if (selectedCustomer) {
        const customer = customers.find(c => c.name === selectedCustomer);
        if (customer) {
        if (nameRef.current) nameRef.current.value = customer.name || "";
        if (phoneRef.current) phoneRef.current.value = customer.phone || "";
        if (emailRef.current) emailRef.current.value = customer.email || "";
        if (addressRef.current) addressRef.current.value = customer.address || "";
        }
    }
    }, [selectedCustomer, customers]);

  if (!open) return null;

const handleConfirm = async () => {
  const customerData = {
    name: nameRef.current?.value || "",
    phone_number: phoneRef.current?.value || "",
    email: emailRef.current?.value || "",
    address: addressRef.current?.value || "",
  };

  // Validate required fields
  if (!customerData.name.trim()) {
    setError("Customer name is required");
    return;
  }

  // Existing customer - just return the data
  const selectedCustomerData = customers.find(c => c.name === selectedCustomer);
  onClose({
      isExisting: true,
      transactionType,
      customer: selectedCustomerData,
      id: selectedCustomerData?.id,
      customerName: nameRef.current?.value || "",
      phone: phoneRef.current?.value || "",
      email: emailRef.current?.value || "",
      address: addressRef.current?.value || "",
      cancelRate: tempCR || selectedCustomerData?.cancel_rate || 0, // use tempCR if set
  });
};

  const handleCancel = () => {
    onClose(null);
  };

  // Get customer names for dropdown
  const customerNames = customers.map(c => c.name);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleCancel}
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
                Find and select an existing customer to proceed
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="size-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Toggle - Transaction Type */}
        <div className="px-8 pt-8 pb-6">
          <div className="bg-gray-100 p-1 rounded-xl grid grid-cols-3 gap-1 border border-gray-200">
            <label className="cursor-pointer">
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
            <label className="cursor-pointer">
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
            <label className="cursor-pointer">
              <input
                type="radio"
                name="transaction-toggle"
                className="hidden peer"
                checked={transactionType === "store_credit"}
                onChange={() => setTransactionType("store_credit")}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-yellow-500">
                <span className="material-symbols-outlined text-lg">
                  account_balance_wallet
                </span>
                Store Credit
              </div>
            </label>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 flex-1 overflow-y-auto">
          {/* Loading State */}
          {loading && (
            <div className="mb-6 bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <span className="material-symbols-outlined animate-spin text-gray-400">
                progress_activity
              </span>
              <p className="text-sm text-gray-600">Loading customers...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-red-600 mt-0.5">
                error
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-600 leading-tight">
                  Error
                </p>
                <p className="text-sm text-gray-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* SearchableDropdown for Existing Customer */}
          {!loading && (
          <div className="mb-6 space-y-4">
            {/* Local Customer Dropdown */}
            <SearchableDropdown
              label="Find Customer"
              value={selectedCustomer}
              options={customerNames}
              onChange={setSelectedCustomer}
              placeholder="Select customer from local list..."
            />

            {/* Plain NoSpos Search */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Search Customer from NoSpos
              </label>
              <input
                type="text"
                value={nosposQuery}
                onChange={(e) => setNosposQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleNosposSearch();
                  }
                }}
                placeholder="Type full name and press Enter..."
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
              />

              {nosposLoading && (
                <p className="text-sm text-gray-500 mt-1">Searching NoSpos...</p>
              )}

              {nosposResults.length > 0 && (
                <ul className="mt-2 border border-gray-200 rounded-xl max-h-40 overflow-y-auto">
                  {nosposResults.map((c) => (
                    <li
                      key={c.id}
                      className="p-2 hover:bg-gray-100 cursor-pointer"
                      onClick={() => {
                        if (nameRef.current) nameRef.current.value = c.name || "";
                        if (phoneRef.current) phoneRef.current.value = c.phone || "";
                        if (emailRef.current) emailRef.current.value = c.email || "";
                        if (addressRef.current) addressRef.current.value = c.address || "";
                      }}
                    >
                    {c.name} {c.phone && `(${c.phone})`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

          {/* Info Banner */}
          {selectedCustomer && (
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
                Full Name <span className="text-red-500">*</span>
            </label>
            <input
                type="text"
                ref={nameRef}
                placeholder="Enter customer's full name"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
            />
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Phone Number
                </label>
                <input
                type="tel"
                ref={phoneRef}
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
                ref={emailRef}
                placeholder="customer@example.com"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
                />
            </div>
            </div>

            {/* Address */}
            <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Physical Address
            </label>
            <input
                type="text"
                ref={addressRef}
                placeholder="123 Street Name, City, State, ZIP"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
            />
            </div>

            {/* Temp Cancel Rate Field */}
            {selectedCustomer && (
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Cancel Rate (%)
                </label>
                <input
                type="number"
                min="0"
                max="100"
                value={tempCR}
                onChange={(e) => setTempCR(e.target.value)}
                placeholder="Enter cancel rate"
                className="w-full h-12 rounded-xl border border-gray-200 focus:ring-yellow-500 focus:border-yellow-500 px-4"
                />
            </div>
            )}
        </div>
        
        </div>

        {/* Footer */}
        <footer className="p-8 border-t border-gray-100 flex items-center justify-between bg-white/50">
          <button
            onClick={handleCancel}
            className="px-6 py-3 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
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