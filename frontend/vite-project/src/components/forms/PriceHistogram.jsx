import React, { useState, useMemo } from 'react';

const PriceHistogram = React.memo(function PriceHistogram({ listings, onBucketSelect, priceRange, onGoBack, drillLevel, readOnly }) {
  const [bucketCount, setBucketCount] = useState(10);

  const prices = useMemo(() => {
    if (!listings || listings.length === 0) return [];
    return listings
      .map(l => (typeof l.price === 'string' ? parseFloat(l.price.replace(/[^0-9.]/g, '')) : l.price))
      .filter(p => !isNaN(p) && p > 0);
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
    const newBuckets = Array(bucketCount).fill(0).map((_, i) => ({
      count: 0,
      rangeStart: min + (i * rawStep),
      rangeEnd: min + ((i + 1) * rawStep)
    }));
    prices.forEach(price => {
      if (priceRange && (price < priceRange.min || price > priceRange.max)) return;
      let index = Math.floor((price - min) / rawStep);
      if (index >= bucketCount) index = bucketCount - 1;
      if (index < 0) index = 0;
      newBuckets[index].count++;
    });
    return { buckets: newBuckets, maxFreq: Math.max(...newBuckets.map(b => b.count)) };
  }, [prices, min, max, bucketCount, priceRange]);

  const filteredPricesCount = useMemo(() => {
    if (!priceRange) return prices.length;
    return prices.filter(p => p >= priceRange.min && p <= priceRange.max).length;
  }, [prices, priceRange]);

  if (!listings || listings.length === 0) return null;
  if (prices.length === 0) return null;

  if (min === max) {
    return (
      <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Market Price Density</h3>
        <p className="text-[10px] text-gray-500">Not enough price variation to build a distribution.</p>
      </div>
    );
  }

  return (
    <div className="bg-white h-full rounded-xl border border-gray-200 shadow-sm transition-all duration-500 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="mb-4">
          <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
            Market Price Density {drillLevel > 0 && `(Level ${drillLevel})`}
          </h3>
          <p className="text-[10px] text-gray-500 mt-1">
            {priceRange ? (
              <>Drilling into <span className="font-bold text-blue-900">£{priceRange.min.toFixed(2)} - £{priceRange.max.toFixed(2)}</span> range {' '}(<span className="font-bold text-blue-900">{filteredPricesCount}</span> listings)</>
            ) : (
              <>Showing distribution across <span className="font-bold text-blue-900">{prices.length}</span> listings</>
            )}
          </p>
        </div>
        {drillLevel > 0 && (
          <button
            onClick={onGoBack}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-bold hover:bg-blue-800 transition-all transform hover:scale-105 shadow-md w-full justify-center mb-4"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Zoom Out
          </button>
        )}
        <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
          <label className="text-[10px] font-bold text-blue-900 uppercase">Buckets: {bucketCount}</label>
          <input
            type="range" min="5" max="20" value={bucketCount}
            onChange={(e) => setBucketCount(parseInt(e.target.value))}
            className="w-full h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-900"
          />
        </div>
      </div>
      <div className="flex-1 flex flex-col p-4 overflow-hidden" style={{ gap: bucketCount <= 10 ? '6px' : bucketCount <= 15 ? '4px' : '2px' }}>
        {buckets.slice().reverse().map((bucket, i) => {
          const reverseIndex = buckets.length - 1 - i;
          const widthPct = maxFreq > 0 ? (bucket.count / maxFreq) * 100 : 0;
          return (
            <div
              key={reverseIndex}
              className={`flex flex-1 items-center gap-2 relative group transition-all duration-500 ${bucket.count > 0 ? 'cursor-pointer' : ''}`}
              onClick={() => bucket.count > 0 && onBucketSelect(bucket.rangeStart, bucket.rangeEnd)}
              style={{ transform: `scale(${bucket.count > 0 ? 1 : 0.95})`, opacity: bucket.count > 0 ? 1 : 0.3, minHeight: '8px' }}
            >
              <div className="flex-1 flex items-center justify-end h-full">
                {bucket.count > 0 && (
                  <span className="text-[10px] font-black text-blue-900 mr-2 transition-all duration-300 group-hover:scale-125">{bucket.count}</span>
                )}
                <div
                  className={`h-full transition-all duration-500 ${bucket.count > 0 ? 'bg-yellow-400 group-hover:bg-blue-900 group-hover:shadow-lg shadow-sm' : 'bg-gray-50'}`}
                  style={{ width: bucket.count > 0 ? `${Math.max(widthPct, 4)}%` : '2px', transformOrigin: 'right' }}
                />
              </div>
              <div className="text-blue-900 font-bold text-[10px] whitespace-nowrap w-28 text-left pl-2">
                £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
              </div>
              {bucket.count > 0 && (
                <div className="absolute right-full mr-4 hidden group-hover:flex items-center z-10">
                  <div className="bg-blue-900 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                    £{bucket.rangeStart.toFixed(2)} - £{bucket.rangeEnd.toFixed(2)}
                    <div className="text-[9px] text-yellow-400 font-bold mt-0.5">🔍 Click to drill down</div>
                  </div>
                  <div className="w-2 h-2 bg-blue-900 rotate-45 -mr-1"></div>
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
