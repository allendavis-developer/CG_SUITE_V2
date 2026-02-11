import React from 'react';
import { Icon, Card, CardHeader, Button } from '@/components/ui/components';
import { formatGBP } from '@/utils/helpers';

/**
 * Market comparisons table component
 */
const MarketComparisonsTable = ({ 
  variant, 
  competitorStats, 
  ourSalePrice, 
  referenceData, 
  ebayData, 
  setEbayModalOpen,
  cashConvertersData,
  setCashConvertersModalOpen 
}) => {
  const hasEbayResearch = Boolean(ebayData?.lastSearchedTerm);
  const hasCashConvertersResearch = Boolean(cashConvertersData?.lastSearchedTerm);

  return (
    <Card noPadding>
      <CardHeader
        title="Market Comparisons"
        actions={
          <span className="text-[10px] font-bold text-gray-500 flex items-center gap-1.5">
            <Icon name="schedule" className="text-xs" />
            Last Synced: 2 mins ago
          </span>
        }
      />
      <table className="w-full text-left text-sm">
        <thead className="text-xs font-bold text-gray-500 uppercase bg-gray-50/50">
          <tr>
            <th className="p-4">Platform</th>
            <th className="p-4">Market Sale Price</th>
            <th className="p-4 bg-yellow-500/10 border-x border-yellow-500/20">OUR SALE PRICE</th>
            <th className="p-4 text-xs font-semibold text-gray-700">Method</th>
            <th className="p-4">Buy-in Price (Cash) </th>
            <th className="p-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {variant && competitorStats.length > 0 ? (
            competitorStats.map((row, idx) => (
              <tr key={`cex-${idx}`} className="hover:bg-gray-50 transition-colors">
                <td className="p-4 font-medium text-gray-900">CEX</td>
                <td className="p-4 font-bold text-gray-600">{formatGBP(row.salePrice)}</td>

                <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                  {formatGBP(parseFloat(ourSalePrice))}
                </td>

                <td className="p-4 text-gray-700 font-semibold text-sm">
                  {referenceData?.percentage_used ? `${referenceData.percentage_used}%` : '—'}
                </td>

                <td className="p-4 font-bold text-blue-900">{formatGBP(row.buyPrice)}</td>
                <td className="p-4 text-right">
                  <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold">
                    <Icon name="check_circle" className="text-xs" /> Verified
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr className="bg-gray-50/20">
              <td className="p-4 font-medium text-gray-600">CEX</td>
              <td className="p-4 italic text-gray-600/60">
                Select a variant to view prices
              </td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                —
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">—</td>

              <td className="p-4 italic text-gray-600/60">—</td>
              <td className="p-4 text-right text-xs text-gray-600/60">—</td>
            </tr>
          )}

          {hasEbayResearch ? (
            <tr className="hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-900">eBay</td>
              <td className="p-4 font-bold text-gray-600">{formatGBP(parseFloat(ebayData.stats.median))}</td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                {formatGBP(parseFloat(ebayData.stats.suggestedPrice))}
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">
                Based on {ebayData.listings.length} sold listings
              </td>

              <td className="p-4 font-bold text-blue-900">
                {(() => {
                  const buyOffers = ebayData.buyOffers || [];
                  if (buyOffers.length === 0) return '—';
                  const prices = buyOffers.map(o => o.price);
                  const min = Math.min(...prices);
                  const max = Math.max(...prices);
                  return min === max ? formatGBP(min) : `${formatGBP(min)} - ${formatGBP(max)}`;
                })()}
              </td>
              <td className="p-4">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="refresh"
                    onClick={() => setEbayModalOpen(true)}
                  >
                    Refine Research
                  </Button>
                </div>
              </td>
            </tr>
          ) : (
            <tr className="bg-gray-50/20 hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-600">eBay</td>
              <td className="p-4 italic text-gray-600/60">No data – Run research</td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                —
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">—</td>

              <td className="p-4 italic text-gray-600/60">—</td>
              <td className="p-4">
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="lg"
                    className="group"
                    icon="search_insights"
                    onClick={() => setEbayModalOpen(true)}
                  >
                    Research on eBay
                  </Button>
                </div>
              </td>
            </tr>
          )}

          {hasCashConvertersResearch ? (
            <tr className="hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-900">Cash Converters</td>
              <td className="p-4 font-bold text-gray-600">
                {cashConvertersData.stats?.median != null ? formatGBP(parseFloat(cashConvertersData.stats.median)) : '—'}
              </td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                {cashConvertersData.stats?.suggestedPrice != null ? formatGBP(parseFloat(cashConvertersData.stats.suggestedPrice)) : '—'}
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">
                Based on {cashConvertersData.listings?.length || 0} listings
              </td>

              <td className="p-4 font-bold text-blue-900">
                {(() => {
                  const buyOffers = cashConvertersData.buyOffers || [];
                  if (buyOffers.length === 0) return '—';
                  const prices = buyOffers.map(o => o.price).filter(p => p != null);
                  if (prices.length === 0) return '—';
                  const min = Math.min(...prices);
                  const max = Math.max(...prices);
                  return min === max ? formatGBP(min) : `${formatGBP(min)} - ${formatGBP(max)}`;
                })()}
              </td>
              <td className="p-4">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="refresh"
                    onClick={() => setCashConvertersModalOpen(true)}
                  >
                    Refine Research
                  </Button>
                </div>
              </td>
            </tr>
          ) : (
            <tr className="bg-gray-50/20 hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-600">Cash Converters</td>
              <td className="p-4 italic text-gray-600/60">No data – Run research</td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                —
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">—</td>

              <td className="p-4 italic text-gray-600/60">—</td>
              <td className="p-4">
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="lg"
                    className="group"
                    icon="store"
                    onClick={() => setCashConvertersModalOpen(true)}
                  >
                    Research on Cash Converters
                  </Button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
};

export default MarketComparisonsTable;