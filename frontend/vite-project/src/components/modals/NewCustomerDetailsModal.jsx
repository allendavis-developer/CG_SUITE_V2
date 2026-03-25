import React, { useState, useRef, useEffect } from "react";

/**
 * Modal shown at finalisation when the customer was created as a placeholder.
 * User must populate full customer details before the request can be booked for testing.
 */
export default function NewCustomerDetailsModal({ open, onClose, onSubmit, initialName = "" }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone("");
      setEmail("");
      setAddress("");
      setError(null);
    }
  }, [open, initialName]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!name?.trim()) {
      setError("Full name is required");
      return;
    }
    if (!phone?.trim()) {
      setError("Phone number is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), phone: phone.trim(), email: email.trim() || null, address: address.trim() || "" });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to update customer");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isSubmitting && onClose()} />
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
        <header className="bg-brand-blue px-6 py-5 flex items-center gap-3 text-white">
          <span className="material-symbols-outlined text-brand-orange text-2xl">person_add</span>
          <div>
            <h3 className="text-lg font-bold leading-none">Customer Details Required</h3>
            <p className="text-white/70 text-sm mt-1">Enter customer details before booking for testing</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">error</span>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter customer's full name"
              className="w-full h-12 rounded-xl border border-gray-200 focus:ring-brand-orange focus:border-brand-orange px-4"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full h-12 rounded-xl border border-gray-200 focus:ring-brand-orange focus:border-brand-orange px-4"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full h-12 rounded-xl border border-gray-200 focus:ring-brand-orange focus:border-brand-orange px-4"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Street Name, City, State, ZIP"
              className="w-full h-12 rounded-xl border border-gray-200 focus:ring-brand-orange focus:border-brand-orange px-4"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-brand-orange hover:brightness-105 text-brand-blue font-black py-4 px-6 rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
              ) : (
                <>
                  Update &amp; Book for Testing
                  <span className="material-symbols-outlined font-bold">check</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
