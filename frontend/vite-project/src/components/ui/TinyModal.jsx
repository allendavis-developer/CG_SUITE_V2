import React from "react";

/** Shared tiny modal shell for negotiation/repricing flows */
const TinyModal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[120] flex items-center justify-center">
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
    <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--brand-blue)' }}>{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default TinyModal;
