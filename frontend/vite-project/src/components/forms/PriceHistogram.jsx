import React, { useState, useMemo, useEffect, useCallback } from 'react';

function histogramBucketKey(b) {
  return `${b.rangeStart.toFixed(12)}|${b.rangeEnd.toFixed(12)}`;
}

const PriceHistogram = React.memo(function PriceHistogram({
  listings,
  onBucketSelect,
  priceRange,
  onGoBack,
  drillLevel,
  readOnly,
  onMultiZoom = null,
}) {
  const [bucketCount, setBucketCount] = useState(10);
  const [bucketSortOrder, setBucketSortOrder] = useState('low_to_high');
  const [selectedBarKeys, setSelectedBarKeys] = useState(() => new Set());

  const clearBarSelection = useCallback(() => {
    setSelectedBarKeys(new Set());
  }, []);

  useEffect(() => {
    clearBarSelection();
  }, [drillLevel, bucketCount, clearBarSelection]);

  const prices = useMemo(() => {
    if (!listings || listings.length === 0) return [];
    return listings
      .map((l) => (typeof l.price === 'string' ? parseFloat(l.price.replace(/[^0-9.]/g, '')) : l.price))
      .filter((p) => !isNaN(p) && p > 0);
  }, [listings]);

  const { min, max } = useMemo(() => {
    if (prices.length === 0) return { min: 0, max: 0 };
    const calculatedMin = priceRange ? priceRange.min : Math.min(...prices);
    const calculatedMax = priceRange ? priceRange.max : Math.max(...prices);
    return { min: calculatedMin, max: calculatedMax };
  }, [prices, priceRange]);

  const { buckets, maxFreq } = useMemo(() => {
    if (prices.length === 0 || min === max) return { buckets: [], maxFreq: 0 };
    const totalRange = max - min;
    const rawStep = totalRange / bucketCount;
    const newBuckets = Array(bucketCount)
      .fill(0)
      .map((_, i) => ({
        count: 0,
        rangeStart: min + i * rawStep,
        rangeEnd: min + (i + 1) * rawStep,
      }));
    prices.forEach((price) => {
      if (priceRange && (price < priceRange.min || price > priceRange.max)) return;
      let index = Math.floor((price - min) / rawStep);
      if (index >= bucketCount) index = bucketCount - 1;
      if (index < 0) index = 0;
      newBuckets[index].count++;
    });
    return { buckets: newBuckets, maxFreq: Math.max(...newBuckets.map((b) => b.count)) };
  }, [prices, min, max, bucketCount, priceRange]);

  const filteredPricesCount = useMemo(() => {
    if (!priceRange) return prices.length;
    return prices.filter((p) => p >= priceRange.min && p <= priceRange.max).length;
  }, [prices, priceRange]);

  const renderedBuckets = useMemo(() => {
    if (!buckets?.length) return [];
    if (bucketSortOrder === 'high_to_low') {
      return buckets.slice().reverse();
    }
    return buckets;
  }, [buckets, bucketSortOrder]);

  const handleBarContextMenu = useCallback(
    (e, bucket) => {
      if (readOnly || bucket.count <= 0 || typeof onMultiZoom !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      const k = histogramBucketKey(bucket);
      setSelectedBarKeys((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    },
    [readOnly, onMultiZoom]
  );

  const handleZoomSelected = useCallback(() => {
    if (typeof onMultiZoom !== 'function' || selectedBarKeys.size === 0) return;
    const segs = [];
    for (const b of renderedBuckets) {
      if (b.count <= 0) continue;
      if (selectedBarKeys.has(histogramBucketKey(b))) {
        segs.push({ min: b.rangeStart, max: b.rangeEnd });
      }
    }
    if (segs.length === 0) return;
    onMultiZoom(segs);
    clearBarSelection();
  }, [onMultiZoom, renderedBuckets, selectedBarKeys, clearBarSelection]);

  if (!listings || listings.length === 0) return null;
  if (prices.length === 0) return null;

  if (min === max) {
    return (
      <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-xs font-bold text-brand-blue uppercase tracking-wider mb-2">Market Price Density</h3>
        <p className="text-[10px] text-gray-500">Not enough price variation to build a distribution.</p>
      </div>
    );
  }

  const multiZoomEnabled = typeof onMultiZoom === 'function' && !readOnly;

  return (
    <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm transition-all duration-500 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="mb-4">
          <h3 className="text-xs font-bold text-brand-blue uppercase tracking-wider">
            Market Price Density {drillLevel > 0 && `(Level ${drillLevel})`}
          </h3>
          <p className="text-[10px] text-gray-500 mt-1">
            {priceRange ? (
              <>
                Drilling into <span className="font-bold text-brand-blue">£{priceRange.min.toFixed(2)} - £{priceRange.max.toFixed(2)}</span> range{' '}
                (<span className="font-bold text-brand-blue">{filteredPricesCount}</span> listings)
              </>
            ) : (
              <>
                Showing distribution across <span className="font-bold text-brand-blue">{prices.length}</span> listings
              </>
            )}
          </p>
        </div>
        {drillLevel > 0 && (
          <button
            type="button"
            onClick={onGoBack}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-blue text-white rounded-lg text-xs font-bold hover:bg-brand-blue-hover transition-all transform hover:scale-105 shadow-md w-full justify-center mb-4"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Zoom Out
          </button>
        )}
        <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
          <label className="text-[10px] font-bold text-brand-blue uppercase">Buckets: {bucketCount}</label>
          <input
            type="range"
            min="5"
            max="20"
            value={bucketCount}
            onChange={(e) => setBucketCount(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-brand-blue/20 rounded-lg appearance-none cursor-pointer accent-brand-blue"
          />
          <label className="text-[10px] font-bold text-brand-blue uppercase mt-1">Sort buckets</label>
          <select
            value={bucketSortOrder}
            onChange={(e) => setBucketSortOrder(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-brand-blue focus:border-brand-blue focus:outline-none"
            disabled={readOnly && !listings?.length}
            aria-label="Histogram bucket sort order"
          >
            <option value="low_to_high">Lowest to highest</option>
            <option value="high_to_low">Highest to lowest</option>
          </select>
          {multiZoomEnabled && (
            <button
              type="button"
              onClick={handleZoomSelected}
              disabled={selectedBarKeys.size === 0}
              className="mt-1 w-full rounded-md border border-brand-blue bg-white px-2 py-1.5 text-[11px] font-bold text-brand-blue hover:bg-brand-blue/5 disabled:opacity-40 disabled:cursor-not-allowed focus:border-brand-blue focus:outline-none"
            >
              Zoom into selected bars{selectedBarKeys.size > 0 ? ` (${selectedBarKeys.size})` : ''}
            </button>
          )}
        </div>
      </div>
      <div
        className="flex-1 flex flex-col p-4 overflow-hidden"
        style={{ gap: bucketCount <= 10 ? '6px' : bucketCount <= 15 ? '4px' : '2px' }}
      >
        {renderedBuckets.map((bucket) => {
          const bKey = histogramBucketKey(bucket);
          const widthPct = maxFreq > 0 ? (bucket.count / maxFreq) * 100 : 0;
          const isPeakBucket = bucket.count > 0 && bucket.count === maxFreq;
          const isBarSelected = multiZoomEnabled && selectedBarKeys.has(bKey);
          let barClass = 'bg-gray-50';
          if (bucket.count > 0) {
            if (isBarSelected) {
              barClass =
                'bg-blue-600 group-hover:bg-blue-700 group-hover:shadow-lg shadow-sm ring-2 ring-blue-400 ring-offset-1';
            } else if (isPeakBucket) {
              barClass = 'bg-emerald-600 group-hover:bg-emerald-700 group-hover:shadow-lg shadow-sm';
            } else {
              barClass = 'bg-brand-orange group-hover:bg-brand-blue group-hover:shadow-lg shadow-sm';
            }
          }
          return (
            <div
              key={bKey}
              className={`flex flex-1 items-center gap-2 relative group transition-all duration-500 ${
                bucket.count > 0 ? 'cursor-pointer' : ''
              }`}
              onClick={() => bucket.count > 0 && onBucketSelect(bucket.rangeStart, bucket.rangeEnd)}
              onContextMenu={(e) => handleBarContextMenu(e, bucket)}
              style={{
                transform: `scale(${bucket.count > 0 ? 1 : 0.95})`,
                opacity: bucket.count > 0 ? 1 : 0.3,
                minHeight: '8px',
              }}
            >
              <div className="text-brand-blue font-bold text-[10px] whitespace-nowrap w-28 text-right pr-2">
                £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
              </div>
              <div className="flex-1 h-full flex items-center border-l border-gray-300 pl-2">
                <div className="flex items-center justify-start h-full w-full">
                  <div
                    className={`h-full transition-all duration-500 ${barClass}`}
                    style={{ width: bucket.count > 0 ? `${Math.max(widthPct, 4)}%` : '2px', transformOrigin: 'left' }}
                  />
                  {bucket.count > 0 && (
                    <span className="text-[10px] font-black text-brand-blue ml-2 transition-all duration-300 group-hover:scale-125">
                      {bucket.count}
                    </span>
                  )}
                </div>
              </div>
              {bucket.count > 0 && (
                <div className="absolute right-full mr-4 hidden group-hover:flex items-center z-10">
                  <div className="bg-brand-blue text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                    £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
                    <div className="text-[9px] text-brand-orange font-bold mt-0.5">Click to drill down</div>
                    {multiZoomEnabled && (
                      <div className="text-[9px] text-white/90 font-semibold mt-0.5">Right-click to select for multi-zoom</div>
                    )}
                  </div>
                  <div className="w-2 h-2 bg-brand-blue rotate-45 -mr-1" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default PriceHistogram;
