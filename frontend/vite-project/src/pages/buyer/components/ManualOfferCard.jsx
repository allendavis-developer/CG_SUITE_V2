import React from 'react';
import { Icon } from '@/components/ui/components';

/**
 * Manual offer card component for custom pricing
 */
const ManualOfferCard = ({ isHighlighted, onClick, manualPrice, setManualPrice }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        p-6 rounded-xl bg-white cursor-pointer text-center relative overflow-hidden
        border-2 border-dashed
        transition-all duration-200 ease-out
        ${
          isHighlighted
            ? `
              border-blue-900
              ring-2 ring-blue-900 ring-offset-2 ring-offset-white
              shadow-xl shadow-blue-900/10
              scale-[1.03]
            `
            : `
              border-yellow-500
              hover:border-blue-900
              hover:shadow-lg
            `
        }
      `}
    >
      <div
        className={`absolute top-0 left-0 w-full ${
          isHighlighted
            ? 'h-1.5 bg-yellow-500'
            : 'h-1 bg-yellow-500/60'
        }`}
      />

      <h4 className="text-[10px] font-black uppercase text-blue-900 mb-4 tracking-wider flex items-center justify-center gap-1">
        <Icon name="edit_note" className="text-[12px]" />
        Manual Offer
      </h4>

      <div className="relative mb-2">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-sm">£</span>
        <input 
          className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-lg font-extrabold text-blue-900 focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 bg-white" 
          placeholder="0.00" 
          type="number"
          step="0.01"
          value={manualPrice}
          onChange={(e) => {
            setManualPrice(e.target.value);
            if (e.target.value && !isHighlighted) {
              onClick();
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-4">
        <span className="text-[10px] font-bold text-gray-500 uppercase">
          Custom Price
        </span>
      </div>
    </div>
  );
};

export default ManualOfferCard;