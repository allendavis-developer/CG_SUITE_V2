import React from 'react';
import ExtensionResearchForm from './ExtensionResearchForm';

/**
 * Cash Generator research — same shell as eBay / Cash Converters; marketplace scrape is stubbed until selectors land.
 */
export default function CashGeneratorResearchForm(props) {
  return <ExtensionResearchForm source="CashGenerator" {...props} />;
}
