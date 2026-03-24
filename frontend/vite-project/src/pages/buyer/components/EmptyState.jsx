import React from 'react';
import { Icon } from '@/components/ui/components';

/**
 * Empty state component shown when no category is selected
 */
const EmptyState = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center px-8 py-12">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
        <Icon name="folder_open" className="text-gray-400 text-2xl" />
      </div>
      <h3 className="text-lg font-extrabold text-gray-900 mb-2">Select a category first</h3>
      <p className="text-sm text-gray-600 max-w-md leading-relaxed">
        Pick a category in the sidebar — down to the <span className="font-semibold text-gray-900">leaf level</span> if
        there are subfolders. Once a category is selected, you can search and choose a product model in this panel.
      </p>
    </div>
  </div>
);

export default EmptyState;