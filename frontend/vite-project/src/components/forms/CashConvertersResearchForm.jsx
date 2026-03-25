import React from 'react';
import ExtensionResearchForm from './ExtensionResearchForm';

/**
 * Cash Converters Research Form — thin wrapper around ExtensionResearchForm with source="CashConverters".
 * Exists so existing imports (`import CashConvertersResearchForm`) continue to work unchanged.
 */
export default function CashConvertersResearchForm(props) {
  return <ExtensionResearchForm source="CashConverters" {...props} />;
}
