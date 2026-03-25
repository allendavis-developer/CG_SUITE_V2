import React from 'react';
import ExtensionResearchForm from './ExtensionResearchForm';

/**
 * eBay Research Form — thin wrapper around ExtensionResearchForm with source="eBay".
 * Exists so existing imports (`import EbayResearchForm`) continue to work unchanged.
 */
function EbayResearchForm(props) {
  return <ExtensionResearchForm source="eBay" {...props} />;
}

export default React.memo(EbayResearchForm);
