import React from 'react';
import { Button } from '../ui/components';

export default function EbayResearchForm({ mode, onComplete }) {
  const handleComplete = () => {
    // You can return empty data or whatever structure you want
    onComplete?.({}); 
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-blue-900">eBay Research</h1>
      <p className="text-gray-500">This tool allows you to manually research eBay listings.</p>

      <div className="flex justify-end mt-4">
        <Button variant="primary" onClick={handleComplete}>
          OK
        </Button>
      </div>
    </div>
  );
}
