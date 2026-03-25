import React from 'react';
import TinyModal from '@/components/ui/TinyModal';
import { resolveOurSalePrice, getDisplayOffers, calculateItemTargetContribution } from '../utils/negotiationHelpers';

// ─── Context menu (right-click on item row) ────────────────────────────────

export function ItemContextMenu({ x, y, onClose, onRemove, onSetManualOffer }) {
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[210px] py-1 border shadow-xl bg-white rounded-lg"
      style={{ left: x, top: y, borderColor: 'var(--ui-border)' }}
    >
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-blue-50 transition-colors flex items-center gap-2"
        style={{ color: 'var(--brand-blue)' }}
        onClick={() => { onSetManualOffer(); onClose(); }}
      >
        <span className="material-symbols-outlined text-[16px]">edit</span>
        Set manual offer
      </button>
      <div className="border-t my-1" style={{ borderColor: 'var(--ui-border)' }} />
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-2 text-red-600"
        onClick={() => { onRemove(); onClose(); }}
      >
        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
        Remove from negotiation
      </button>
    </div>
  );
}

// ─── Target Offer Modal ────────────────────────────────────────────────────

export function TargetOfferModal({ targetOffer, onSetTarget, onClose }) {
  const [input, setInput] = React.useState(targetOffer || '');

  const handleApply = () => {
    const val = parseFloat(input);
    if (!isNaN(val) && val > 0) {
      onSetTarget(val.toFixed(2));
      onClose();
    }
  };

  return (
    <TinyModal title="Set Target Total Offer" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4">
        What is the target total offer you want to achieve across all items?
      </p>
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
        <input
          autoFocus
          className="w-full pl-8 pr-3 py-2.5 border rounded-lg text-lg font-bold focus:outline-none focus:ring-2"
          style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors"
          style={{ background: 'var(--brand-blue)', color: 'white' }}
          onClick={handleApply}
        >
          Set Target
        </button>
      </div>
    </TinyModal>
  );
}

// ─── Item Manual Offer Modal ───────────────────────────────────────────────

export function ItemOfferModal({ item, items, targetOffer, useVoucherOffers, onApply, onClose, showNotification }) {
  const [input, setInput] = React.useState('');
  const qty = item.quantity || 1;
  const ourSalePrice = resolveOurSalePrice(item);
  const targetContribution = calculateItemTargetContribution(item.id, items, targetOffer, useVoucherOffers);
  const parsedTarget = parseFloat(targetOffer) || 0;

  const modalDisplayOffers = getDisplayOffers(item, useVoucherOffers);
  const currentSelectedOffer = item.selectedOfferId === 'manual' && item.manualOffer
    ? parseFloat(item.manualOffer.replace(/[£,]/g, ''))
    : modalDisplayOffers?.find(o => o.id === item.selectedOfferId)?.price;
  const hasCurrentOffer = currentSelectedOffer != null && !isNaN(currentSelectedOffer);

  const handleApply = (perUnitValue) => {
    if (!perUnitValue || perUnitValue <= 0) {
      showNotification("Please enter a valid positive amount.", "error");
      return;
    }
    onApply(item, perUnitValue);
    onClose();
  };

  return (
    <TinyModal title="Set Manual Offer" onClose={onClose}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--brand-blue)' }}>{item.title}</p>
      {ourSalePrice && (
        <p className={`text-[11px] text-slate-500 ${hasCurrentOffer ? 'mb-1' : 'mb-4'}`}>
          Our sale price: <span className="font-bold text-purple-700">£{ourSalePrice.toFixed(2)}</span>
        </p>
      )}
      {hasCurrentOffer && (
        <p className="text-[11px] text-slate-500 mb-4">
          Current selected offer: <span className="font-semibold" style={{ color: 'var(--brand-blue)' }}>
            £{currentSelectedOffer.toFixed(2)}
            {qty > 1 && ` per unit (£${(currentSelectedOffer * qty).toFixed(2)} total)`}
          </span>
        </p>
      )}

      {targetContribution !== null && (
        <div className="mb-4 p-3 rounded-lg border" style={{ borderColor: 'rgba(20,69,132,0.2)', background: 'rgba(20,69,132,0.03)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--brand-blue)' }}>
            Meet overall target (£{parsedTarget.toFixed(2)})
          </p>
          {targetContribution > 0 ? (
            <>
              <p className="text-xs text-slate-600 mb-2">
                Set this item to <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>
                  £{targetContribution.toFixed(2)}
                </span> total
                {qty > 1 && ` (£${(targetContribution / qty).toFixed(2)} × ${qty})`}
              </p>
              <button
                className="w-full py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                style={{ background: 'var(--brand-blue)', color: 'white' }}
                onClick={() => handleApply(targetContribution / qty)}
              >
                Apply — £{targetContribution.toFixed(2)} total
              </button>
            </>
          ) : (
            <p className="text-xs text-red-600">
              Other items already exceed the target. Cannot meet target with this item alone.
            </p>
          )}
        </div>
      )}

      <div className="relative mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
          {targetContribution !== null ? 'Or enter a specific amount (row total):' : 'Enter a specific amount (row total):'}
        </p>
        <span className="absolute left-3 bottom-[9px] font-bold text-lg" style={{ color: 'var(--brand-blue)' }}>£</span>
        <input
          autoFocus={targetContribution === null}
          className="w-full pl-8 pr-3 py-2.5 border rounded-lg text-base font-bold focus:outline-none focus:ring-2"
          style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
          type="number"
          step="0.01"
          min="0"
          placeholder={qty > 1 ? `Row total for ${qty} items` : "0.00"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const rowTotal = parseFloat(input);
              if (!isNaN(rowTotal) && rowTotal > 0) handleApply(rowTotal / qty);
            }
          }}
        />
      </div>
      {qty > 1 && input && !isNaN(parseFloat(input)) && parseFloat(input) > 0 && (
        <p className="text-[11px] text-slate-500 mb-3">
          Per unit: <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>£{(parseFloat(input) / qty).toFixed(2)}</span>
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
          style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
          onClick={() => {
            const rowTotal = parseFloat(input);
            if (!isNaN(rowTotal) && rowTotal > 0) handleApply(rowTotal / qty);
          }}
        >
          Apply
        </button>
      </div>
    </TinyModal>
  );
}

// ─── Senior Management Bypass Modal ────────────────────────────────────────

export function SeniorMgmtModal({ item, proposedPerUnit, onConfirm, onClose }) {
  const [name, setName] = React.useState('');
  const salePrice = resolveOurSalePrice(item);
  const qty = item.quantity || 1;

  return (
    <TinyModal title="Override Confirmation Required" onClose={onClose}>
      <div className="rounded-lg p-3 mb-4 bg-red-50 border border-red-200">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-red-500 shrink-0">warning</span>
          <div>
            <p className="text-xs font-bold text-red-700 mb-1">Offer exceeds sale price</p>
            <p className="text-[11px] text-red-600">
              Proposed offer: <strong>£{(proposedPerUnit * qty).toFixed(2)}</strong>
              {qty > 1 && ` (£${proposedPerUnit.toFixed(2)} × ${qty})`}
            </p>
            {salePrice && (
              <p className="text-[11px] text-red-600">
                Our sale price: <strong>£{(salePrice * qty).toFixed(2)}</strong>
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-600 mb-4">
        This offer exceeds our sale price. To proceed, please confirm it has been approved by a senior manager and enter their name below.
      </p>
      <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--brand-blue)' }}>
        Approved by (name)*
      </label>
      <input
        autoFocus
        className="w-full px-3 py-2.5 border rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 mb-4"
        style={{ borderColor: 'rgba(20,69,132,0.3)', color: 'var(--brand-blue)' }}
        type="text"
        placeholder="Senior manager's name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onConfirm(name.trim());
            onClose();
          }
        }}
      />
      <div className="flex gap-2">
        <button
          className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--ui-border)', color: 'var(--text-muted)' }}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${!name.trim() ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
          style={{ background: '#dc2626', color: 'white' }}
          disabled={!name.trim()}
          onClick={() => {
            if (!name.trim()) return;
            onConfirm(name.trim());
            onClose();
          }}
        >
          Confirm Override
        </button>
      </div>
    </TinyModal>
  );
}

// ─── Margin Result Confirmation Modal ──────────────────────────────────────

export function MarginResultModal({ item, offerPerUnit, ourSalePrice, marginPct, marginGbp, confirmedBy, onClose }) {
  const qty = item.quantity || 1;
  const isPositiveMargin = marginPct >= 0;

  return (
    <TinyModal title="Manual Offer Applied" onClose={onClose}>
      <div className="mb-4">
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--brand-blue)' }}>{item.title}</p>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Manual offer</span>
            <span className="font-bold" style={{ color: 'var(--brand-blue)' }}>
              £{(offerPerUnit * qty).toFixed(2)}
              {qty > 1 && ` (£${offerPerUnit.toFixed(2)} × ${qty})`}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Our sale price</span>
            <span className="font-bold text-purple-700">£{(ourSalePrice * qty).toFixed(2)}</span>
          </div>
          <div className="border-t pt-2" style={{ borderColor: 'var(--ui-border)' }}>
            <div className="flex justify-between text-sm font-bold">
              <span style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>Margin</span>
              <div className="text-right">
                <div style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>
                  {isPositiveMargin ? '+' : ''}{marginPct.toFixed(1)}%
                </div>
                <div className="text-xs font-semibold" style={{ color: isPositiveMargin ? 'var(--brand-blue)' : '#dc2626' }}>
                  {isPositiveMargin ? '+' : '-'}£{Math.abs(marginGbp * qty).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>
        {confirmedBy && (
          <div className="mt-3 p-2 rounded bg-amber-50 border border-amber-200">
            <p className="text-[11px] text-amber-700">
              <span className="font-bold">Senior management override</span> confirmed by: {confirmedBy}
            </p>
          </div>
        )}
      </div>
      <button
        className="w-full py-2.5 rounded-lg text-sm font-bold transition-all hover:opacity-90"
        style={{ background: 'var(--brand-blue)', color: 'white' }}
        onClick={onClose}
      >
        OK
      </button>
    </TinyModal>
  );
}
