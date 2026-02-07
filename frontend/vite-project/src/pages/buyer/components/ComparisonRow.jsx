import React from 'react';
import { Icon, Button } from '@/components/ui/components';
import { formatGBP } from '@/utils/helpers';

const ComparisonRow = ({
  platform,
  variant, // To check if variant is selected for CEX
  competitorStat, // For CEX
  ourSalePrice,
  referenceData, // For CEX percentage_used
  ebayData, // For eBay stats and listings
  setEbayModalOpen, // For eBay action button
  type // 'cex' or 'ebay' or 'empty'
}) => {
  if (type === 'empty') {
    return (
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
    );
  }

  if (type === 'cex') {
    return (
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="p-4 font-medium text-gray-900">CEX</td>
        <td className="p-4 font-bold text-gray-600">{formatGBP(competitorStat.salePrice)}</td>
        <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
          {formatGBP(parseFloat(ourSalePrice))}
        </td>
        <td className="p-4 text-gray-700 font-semibold text-sm">
          {referenceData?.percentage_used ? `${referenceData.percentage_used}%` : '—'}
        </td>
        <td className="p-4 font-bold text-blue-900">{formatGBP(competitorStat.buyPrice)}</td>
        <td className="p-4 text-right">
          <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold">
            <Icon name="check_circle" className="text-xs" /> Verified
          </span>
        </td>
      </tr>
    );
  }

  if (type === 'ebay' && ebayData?.lastSearchedTerm) {
    return (
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="p-4 font-medium text-gray-900">eBay</td>
        <td className="p-4 font-bold text-gray-600">{formatGBP(parseFloat(ebayData.stats.median))}</td>
        <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
          {formatGBP(parseFloat(ebayData.stats.suggestedPrice))}
        </td>
        <td className="p-4 text-gray-700 font-semibold text-sm">
          Based on {ebayData.listings.length} sold listings
        </td>
        <td className="p-4 italic text-gray-600/60">—</td>
        <td className="p-4 text-right">
          <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold">
            <Icon name="check_circle" className="text-xs" /> Verified
          </span>
        </td>
      </tr>
    );
  }
  
  // Empty eBay row
  if (type === 'ebay' && !ebayData?.lastSearchedTerm) {
    return (
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
    );
  }

  return null; // Should not reach here
};

export default ComparisonRow;
