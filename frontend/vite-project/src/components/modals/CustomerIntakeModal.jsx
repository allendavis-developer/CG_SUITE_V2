import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCustomer, getOrCreateCustomer } from "@/services/api";
import { openNosposForCustomerIntake } from "@/services/extensionClient";

function getDaysSinceLastTransaction(customer) {
  if (!customer?.lastTransacted) return null;
  const d = new Date(customer.lastTransacted.replace(",", ""));
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function CustomerIntakeModal({ open = true, onClose }) {
  const navigate = useNavigate();
  const [customerType, setCustomerType] = useState("existing"); // "existing" | "new"
  const [transactionType, setTransactionType] = useState("buyback");
  const [error, setError] = useState(null);
  const [nosposOpenLoading, setNosposOpenLoading] = useState(false);
  const [nosposCustomer, setNosposCustomer] = useState(null);
  const [nosposChanges, setNosposChanges] = useState([]);
  const [confirming, setConfirming] = useState(false);

  // Bypass: skip customer data update
  const [bypassReason, setBypassReason] = useState(null);
  const [showBypassPrompt, setShowBypassPrompt] = useState(false);
  const [bypassReasonInput, setBypassReasonInput] = useState("");

  if (!open) return null;

  const handleGetDataFromNospos = async () => {
    setNosposOpenLoading(true);
    setNosposChanges([]);
    setNosposCustomer(null);
    setBypassReason(null);
    setShowBypassPrompt(false);
    setBypassReasonInput("");
    setError(null);
    try {
      const result = await openNosposForCustomerIntake();
      if (result?.customer) {
        setNosposCustomer(result.customer);
        // Extension may already have collected bypass (e.g. prompt when last tx >14 days ago).
        const br = result.customer.bypassReason;
        if (br) {
          const days = getDaysSinceLastTransaction(result.customer);
          // Extension uses literal '14 days ago' when ≤14 days (no prompt); normalize for UI copy.
          if (br === "14 days ago" && days !== null && days <= 14) {
            setBypassReason("Within 14 days of last transaction");
          } else {
            setBypassReason(br);
          }
          setShowBypassPrompt(false);
          setBypassReasonInput("");
        }
      }
      if (result?.changes?.length > 0) setNosposChanges(result.changes);
    } catch (err) {
      setError(err?.message || "Failed to open NoSpos");
    } finally {
      setNosposOpenLoading(false);
    }
  };

  const handleNewCustomerStart = async () => {
    setError(null);
    try {
      const timestamp = Date.now();
      const placeholder = await createCustomer({
        name: `New Customer ${new Date(timestamp).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`,
        phone_number: `NEW-${timestamp}`,
        email: null,
        address: "",
        is_temp_staging: true,
      });
      onClose({
        isNewCustomer: true,
        isExisting: false,
        transactionType,
        id: placeholder.id,
        customerName: placeholder.name,
        cancelRate: 0,
      });
    } catch (err) {
      setError(err.message || "Failed to create new customer");
    }
  };

  const handleBypass = () => {
    if (!nosposCustomer) {
      setError("Please get customer data from NoSpos first.");
      return;
    }
    const days = getDaysSinceLastTransaction(nosposCustomer);
    if (days !== null && days <= 14) {
      setBypassReason("Within 14 days of last transaction");
      setShowBypassPrompt(false);
    } else {
      setShowBypassPrompt(true);
      setBypassReasonInput("");
    }
  };

  const handleBypassConfirmReason = () => {
    const reason = bypassReasonInput.trim();
    if (!reason) {
      setError("Please enter a reason for bypassing customer data update.");
      return;
    }
    setBypassReason(reason);
    setShowBypassPrompt(false);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!nosposCustomer) {
      setError("Please get customer data from NoSpos first.");
      return;
    }
    const c = nosposCustomer;
    const cancelRateNum = c.cancelRate ? parseFloat(c.cancelRate) || 0 : 0;
    const rawNosposId = c.nosposCustomerId ?? c.nospos_customer_id;
    const nosposCustomerIdParsed =
      rawNosposId != null && rawNosposId !== ''
        ? parseInt(String(rawNosposId), 10)
        : null;
    const nospos_customer_id =
      Number.isFinite(nosposCustomerIdParsed) && nosposCustomerIdParsed > 0
        ? nosposCustomerIdParsed
        : undefined;

    setConfirming(true);
    setError(null);
    try {
      const created = await getOrCreateCustomer({
        name:         c.name        || "NoSpos Customer",
        phone_number: c.phone       || c.mobile || "",
        email:        c.email       || null,
        address:      c.address     || "",
        is_temp_staging: false,
        ...(nospos_customer_id != null ? { nospos_customer_id } : {}),
      });

      onClose({
        isExisting: true,
        isNewCustomer: false,
        transactionType,
        customer: c,
        id: created.id,
        customerName: created.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        cancelRate: cancelRateNum,
        nospos_customer_id: created.nospos_customer_id ?? nospos_customer_id ?? null,
        nosposChanges,
        bypassReason: bypassReason || null,
      });
    } catch (err) {
      setError(err?.message || "Failed to create customer record");
    } finally {
      setConfirming(false);
    }
  };

  // ── Read-only detail row helper ──────────────────────────────────────────────
  const Detail = ({ label, value }) => {
    if (!value) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
        <span className="text-sm font-semibold text-gray-800 leading-snug">{value}</span>
      </div>
    );
  };

  const StatPill = ({ label, value, raw, goodHigh }) => {
    if (!value) return null;
    const pct = parseFloat(value);
    const isGood = goodHigh ? pct >= 50 : pct < 5;
    return (
      <div className={`flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 ${
        isGood ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
      }`}>
        <span className={`text-lg font-black leading-none ${isGood ? "text-emerald-700" : "text-red-700"}`}>
          {value}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
        {raw && <span className="text-[10px] text-gray-400 text-center leading-tight">{raw}</span>}
      </div>
    );
  };

  const c = nosposCustomer;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-brand-blue px-8 py-6 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-brand-orange text-2xl">person_add</span>
            <div>
              <h3 className="text-xl font-bold leading-none">Customer Intake</h3>
              <p className="text-white/70 text-sm mt-1">
                {customerType === "new"
                  ? "Browse first, add customer details when you book"
                  : "Pull customer details from NoSpos to proceed"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            Launchpad
          </button>
        </header>

        {/* New vs Existing Toggle */}
        <div className="px-8 pt-6">
          <div className="bg-gray-100 p-1 rounded-xl grid grid-cols-2 gap-1 border border-gray-200 mb-6">
            <label className="cursor-pointer">
              <input
                type="radio"
                name="customer-type"
                className="hidden peer"
                checked={customerType === "existing"}
                onChange={() => { setCustomerType("existing"); setError(null); }}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-brand-blue">
                <span className="material-symbols-outlined text-lg">person</span>
                Existing Customer
              </div>
            </label>
            <label className="cursor-pointer">
              <input
                type="radio"
                name="customer-type"
                className="hidden peer"
                checked={customerType === "new"}
                onChange={() => { setCustomerType("new"); setError(null); }}
              />
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-emerald-600">
                <span className="material-symbols-outlined text-lg">person_add</span>
                New Customer
              </div>
            </label>
          </div>
        </div>

        {/* Transaction Type Toggle */}
        <div className="px-8 pb-6">
          <div className="bg-gray-100 p-1 rounded-xl grid grid-cols-3 gap-1 border border-gray-200">
            {[
              { value: "sale", icon: "point_of_sale", label: "Direct Sale" },
              { value: "buyback", icon: "autorenew", label: "Buy Back" },
              { value: "store_credit", icon: "account_balance_wallet", label: "Store Credit" },
            ].map(({ value, icon, label }) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="transaction-toggle"
                  className="hidden peer"
                  checked={transactionType === value}
                  onChange={() => setTransactionType(value)}
                />
                <div className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all peer-checked:bg-white peer-checked:shadow-sm text-gray-500 peer-checked:text-brand-orange">
                  <span className="material-symbols-outlined text-lg">{icon}</span>
                  {label}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 flex-1 overflow-y-auto">
          {/* Error */}
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-red-600 mt-0.5">error</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-600 leading-tight">Error</p>
                <p className="text-sm text-gray-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* NoSpos changes notification */}
          {nosposChanges.length > 0 && (
            <div className="mb-5 bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-600 mt-0.5 text-lg">check_circle</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-emerald-800 leading-tight mb-2">
                  NoSpos updated with your details
                </p>
                <ul className="space-y-1">
                  {nosposChanges.map((ch, i) => (
                    <li key={i} className="text-xs text-emerald-900 flex items-center gap-1.5">
                      <span className="font-bold">{ch.field}:</span>
                      <span className="line-through text-emerald-500">{ch.from || "—"}</span>
                      <span className="material-symbols-outlined text-xs text-emerald-400">arrow_forward</span>
                      <span className="font-semibold">{ch.to}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button onClick={() => setNosposChanges([])} className="text-emerald-400 hover:text-emerald-700 transition-colors">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          )}

          {/* ── NEW CUSTOMER FLOW ── */}
          {customerType === "new" && (
            <div className="mb-6 p-6 bg-emerald-50 border border-emerald-200 rounded-xl">
              <p className="text-sm text-emerald-800 mb-4">
                Start browsing and add items to cart. You&apos;ll enter customer details when you book for testing.
              </p>
              <button
                onClick={handleNewCustomerStart}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                Start Browsing
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          )}

          {/* ── EXISTING CUSTOMER FLOW ── */}
          {customerType === "existing" && (
            <>
              {/* Get from NoSpos — shown when no customer loaded yet, or as a "change" button */}
              {!c ? (
                <button
                  type="button"
                  onClick={handleGetDataFromNospos}
                  disabled={nosposOpenLoading}
                  className="w-full h-14 rounded-xl border-2 border-dashed border-brand-orange bg-brand-orange/10 hover:bg-brand-orange/15 text-brand-blue font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed mb-6"
                >
                  {nosposOpenLoading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                      Opening NoSpos…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">open_in_new</span>
                      Get Customer from NoSpos
                    </>
                  )}
                </button>
              ) : (
                /* Customer loaded — read-only card */
                <div className="mb-5 border border-brand-blue/15 rounded-2xl overflow-hidden shadow-sm">
                  {/* Card header with name + change button */}
                  <div className="bg-brand-blue px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {c.profilePicture ? (
                        <img
                          src={c.profilePicture}
                          alt="profile"
                          className="w-10 h-10 rounded-full object-cover border-2 border-brand-orange"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-brand-blue-hover flex items-center justify-center">
                          <span className="material-symbols-outlined text-white text-xl">person</span>
                        </div>
                      )}
                      <div>
                        <p className="text-white font-bold text-base leading-tight">{c.name}</p>
                        {c.email && <p className="text-white/70 text-xs mt-0.5">{c.email}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div className="bg-white px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-4">
                    <Detail label="Forename" value={c.forename} />
                    <Detail label="Surname" value={c.surname} />
                    <Detail label="Date of Birth" value={c.dob} />
                    <Detail label="Gender" value={c.gender} />
                    <Detail label="Mobile" value={c.mobile} />
                    <Detail label="Home Phone" value={c.homePhone} />
                    <Detail label="Email" value={c.email} />
                    <Detail label="Postcode" value={c.postcode} />
                    <div className="col-span-2">
                      <Detail
                        label="Address"
                        value={[c.address1, c.address2, c.town, c.county, c.postcode].filter(Boolean).join(", ")}
                      />
                    </div>
                  </div>

                  {/* Bypass status / reason display */}
                  {bypassReason ? (
                    <div className="border-t border-amber-200 px-5 py-3 bg-amber-50 flex items-start gap-2">
                      <span className="material-symbols-outlined text-amber-600 text-base mt-0.5">info</span>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-amber-800 leading-snug">
                          {getDaysSinceLastTransaction(c) !== null && getDaysSinceLastTransaction(c) <= 14
                            ? `Customer data not updated — ${bypassReason}`
                            : `Customer data was not updated because: ${bypassReason}`}
                        </p>
                        {c.lastTransacted && (
                          <p className="text-[10px] text-amber-600 mt-0.5">Last transaction: {c.lastTransacted}</p>
                        )}
                      </div>
                      <button
                        onClick={() => { setBypassReason(null); }}
                        className="text-amber-400 hover:text-amber-700 transition-colors shrink-0"
                        title="Remove bypass"
                      >
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    </div>
                  ) : !showBypassPrompt && (
                    <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                        {c.lastTransacted ? `Last transacted: ${c.lastTransacted}` : 'No transaction history'}
                      </p>
                      <button
                        type="button"
                        onClick={handleBypass}
                        className="text-xs font-bold text-amber-600 hover:text-amber-800 transition-colors flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">skip_next</span>
                        Bypass Data Update
                      </button>
                    </div>
                  )}

                  {/* Bypass reason prompt (shown when > 14 days) */}
                  {showBypassPrompt && (
                    <div className="border-t border-amber-200 px-5 py-4 bg-amber-50">
                      <p className="text-xs font-bold text-amber-800 mb-2">
                        Last transaction was more than 14 days ago. Enter a reason for bypassing the data update:
                      </p>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          className="flex-1 px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          placeholder="Enter reason…"
                          value={bypassReasonInput}
                          onChange={(e) => setBypassReasonInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleBypassConfirmReason(); }}
                        />
                        <button
                          type="button"
                          onClick={handleBypassConfirmReason}
                          className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowBypassPrompt(false); setError(null); }}
                          className="px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

              {/* Transaction stats */}
              {(c.buyBackRate || c.renewRate || c.cancelRate || c.faultyRate) && (
                <div className="border-t border-gray-100 px-5 py-3 bg-white">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Transaction History</p>
                  <div className="grid grid-cols-4 gap-2">
                    <StatPill label="Buy Back" value={c.buyBackRate} raw={c.buyBackRateRaw} goodHigh />
                    <StatPill label="Renew"    value={c.renewRate}   raw={c.renewRateRaw}   goodHigh />
                    <StatPill label="Cancel"   value={c.cancelRate}  raw={c.cancelRateRaw}  goodHigh />
                    <StatPill label="Faulty"   value={c.faultyRate}  raw={c.faultyRateRaw}  goodHigh={false} />
                  </div>
                </div>
              )}
                </div>
              )}

            </>
          )}
        </div>

        {/* Footer */}
        {customerType === "existing" && (
          <footer className="p-8 border-t border-gray-100 flex items-center justify-end bg-white/50">
            <button
              onClick={handleConfirm}
              disabled={!c || confirming}
              className="bg-brand-orange hover:brightness-105 active:scale-[0.98] text-brand-blue font-black py-4 px-10 rounded-xl shadow-lg shadow-brand-orange/20 flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {confirming ? (
                <>
                  <span className="material-symbols-outlined animate-spin font-bold">progress_activity</span>
                  Finding or creating customer…
                </>
              ) : (
                <>
                  Confirm &amp; Proceed
                  <span className="material-symbols-outlined font-bold">arrow_forward</span>
                </>
              )}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
