import React from "react";

const NegotiationTableRow = ({ item, useVoucherOffers, setItems, handleReopenResearch }) => {
  const quantity = item.quantity || 1;
                  
  // Select the appropriate offers based on transaction type
  const displayOffers = useVoucherOffers 
    ? (item.voucherOffers || item.offers) 
    : (item.cashOffers || item.offers);
  
  const selectedOffer = displayOffers?.find(o => o.id === item.selectedOfferId);
  const ebayData = item.ebayResearchData;
  const offer1 = displayOffers?.[0];
  const offer2 = displayOffers?.[1];
  const offer3 = displayOffers?.[2];

  return (
    <tr key={item.id}>
      {/* Qty */}
      <td className="text-center font-bold">{quantity}</td>

      {/* Item Name & Attributes */}
      <td>
        <div className="font-bold text-[13px]" style={{ color: 'var(--brand-blue)' }}>
          {item.title || 'N/A'}
        </div>
        <div className="text-[9px] uppercase font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {item.subtitle || item.category || 'No details'} {item.model && `| ${item.model}`}
        </div>
      </td>
      
      {/* CeX Buy (Cash) Column */}
      <td className="font-medium text-emerald-700">
        {item.cexBuyPrice ? (
          <div>
            <div>£{(item.cexBuyPrice * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px] opacity-70">
                (£{item.cexBuyPrice.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '—'}
      </td>

      {/* CeX Buy (Voucher) Column */}
      <td className="font-medium text-amber-700">
        {item.cexVoucherPrice ? (
          <div>
            <div>£{(item.cexVoucherPrice * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px] opacity-70">
                (£{item.cexVoucherPrice.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '—'}
      </td>

      {/* CeX Sell Column */}
      <td className="font-medium text-blue-800">
        {item.cexSellPrice ? (
          <div>
            <div>£{(item.cexSellPrice * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px] opacity-70">
                (£{item.cexSellPrice.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '—'}
      </td>


      {/* 1st Offer */}
      <td 
        className="font-semibold cursor-pointer"
        style={item.selectedOfferId === offer1?.id ? { 
          background: 'rgba(247, 185, 24, 0.1)', 
          fontWeight: 'bold',
          color: 'var(--brand-blue)'
        } : {}}
        onClick={() => offer1 && setItems(prev =>
          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer1.id } : i)
        )}
      >
        {offer1 ? (
          <div>
            <div>£{(offer1.price * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                (£{offer1.price.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '-'}
      </td>

      {/* 2nd Offer */}
      <td 
        className="font-semibold cursor-pointer"
        style={item.selectedOfferId === offer2?.id ? { 
          background: 'rgba(247, 185, 24, 0.1)', 
          fontWeight: 'bold',
          color: 'var(--brand-blue)'
        } : {}}
        onClick={() => offer2 && setItems(prev =>
          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer2.id } : i)
        )}
      >
        {offer2 ? (
          <div>
            <div>£{(offer2.price * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                (£{offer2.price.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '-'}
      </td>

      {/* 3rd Offer */}
      <td 
        className="font-semibold cursor-pointer"
        style={item.selectedOfferId === offer3?.id ? { 
          background: 'rgba(247, 185, 24, 0.1)', 
          fontWeight: 'bold',
          color: 'var(--brand-blue)'
        } : {}}
        onClick={() => offer3 && setItems(prev =>
          prev.map(i => i.id === item.id ? { ...i, selectedOfferId: offer3.id } : i)
        )}
      >
        {offer3 ? (
          <div>
            <div>£{(offer3.price * quantity).toFixed(2)}</div>
            {quantity > 1 && (
              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                (£{offer3.price.toFixed(2)} × {quantity})
              </div>
            )}
          </div>
        ) : '-'}
      </td>

      {/* Manual Offer */}
      <td className="p-0">
        <input 
          className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
          style={{ 
            background: item.manualOffer && item.selectedOfferId === 'manual' 
              ? 'rgba(247, 185, 24, 0.1)' 
              : 'transparent',
            color: item.manualOffer && item.selectedOfferId === 'manual'
              ? 'var(--brand-blue)'
              : 'inherit',
            fontWeight: item.manualOffer && item.selectedOfferId === 'manual' 
              ? 'bold' 
              : 'semibold'
          }}
          placeholder="£0.00" 
          type="text"
          value={item.manualOffer || ''}
          onChange={(e) => {
            const value = e.target.value;
            setItems(prev =>
              prev.map(i =>
                i.id === item.id
                  ? { 
                      ...i, 
                      manualOffer: value,
                      selectedOfferId: value ? 'manual' : i.selectedOfferId
                    }
                  : i
              )
            );
          }}
          onClick={() => {
            if (item.manualOffer) {
              setItems(prev =>
                prev.map(i =>
                  i.id === item.id
                    ? { ...i, selectedOfferId: 'manual' }
                    : i
                )
              );
            }
          }}
        />
      </td>

      {/* Customer Expectation */}
      <td className="p-0">
        <input 
          className="w-full h-full border-0 text-xs font-semibold text-center px-3 py-2 focus:outline-none focus:ring-0"
          style={{ 
            borderColor: 'var(--ui-border)',
            background: '#f8fafc',
            outline: 'none'
          }}
          placeholder="£0.00" 
          type="text"
          value={item.customerExpectation || ''}
          onChange={(e) => {
            const value = e.target.value;
            setItems(prev =>
              prev.map(i =>
                i.id === item.id
                  ? { ...i, customerExpectation: value }
                  : i
              )
            );
          }}
        />
      </td>

      {/* eBay Research */}
      <td>
        {ebayData?.stats?.median ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold" style={{ color: 'var(--brand-blue)' }}>
                £{(Number(ebayData.stats.median) * quantity).toFixed(2)}
              </div>
              {quantity > 1 && (
                <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  (£{Number(ebayData.stats.median).toFixed(2)} × {quantity})
                </div>
              )}
            </div>
            <button 
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ 
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)'
              }}
              onClick={() => handleReopenResearch(item)}
              title="Refine Research"
            >
              <span className="material-symbols-outlined text-[16px]">edit_note</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
            <button 
              className="flex items-center justify-center size-7 rounded transition-colors shrink-0"
              style={{ 
                background: 'var(--brand-orange)',
                color: 'var(--brand-blue)'
              }}
              onClick={() => handleReopenResearch(item)}
              title="Research"
            >
              <span className="material-symbols-outlined text-[16px]">search_insights</span>
            </button>
          </div>
        )}
      </td>

      {/* Cash Converters - Work in Progress */}
      <td>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>—</span>
          <button 
            className="flex items-center justify-center size-7 rounded transition-colors shrink-0 opacity-50 cursor-not-allowed"
            style={{ 
              background: 'var(--brand-orange)',
              color: 'var(--brand-blue)'
            }}
            disabled
            title="Coming Soon"
          >
            <span className="material-symbols-outlined text-[16px]">search_insights</span>
          </button>
        </div>
      </td>
    </tr>
  );
};

export default NegotiationTableRow;
