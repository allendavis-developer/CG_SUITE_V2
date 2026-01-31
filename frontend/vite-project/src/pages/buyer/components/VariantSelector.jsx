import React from 'react';
import { Icon, Badge } from '@/components/ui/components';

/**
 * Variant selection component
 */
const VariantSelector = ({ 
  attributes, 
  attributeValues, 
  variants, 
  variant, 
  setVariant 
}) => {
  const visibleAttributes = attributes.filter((attr, index) => {
    const previousSelections = Object.entries(attributeValues)
      .filter(([code]) => {
        const attrIndex = attributes.findIndex(a => a.code === code);
        return attrIndex < index && attributeValues[code];
      });

    const matchingVariants = variants.filter(variant =>
      previousSelections.every(([code, value]) =>
        variant.attribute_values[code] === value
      )
    );

    const availableValues = new Set(
      matchingVariants.map(v => v.attribute_values[attr.code])
    );

    const options = attr.values.filter(opt =>
      index === 0 || availableValues.has(opt)
    );

    return options.length > 0;
  });

  const allAttributesSelected = visibleAttributes.every(
    attr => attributeValues[attr.code]
  );

  if (!allAttributesSelected) return null;

  const matchingVariants = variants.filter(variant => {
    return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
      if (!attrValue) return true;
      return variant.attribute_values[attrCode] === attrValue;
    });
  });

  if (matchingVariants.length <= 0) return null;

  return (
    <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">Select Variant</h3>
          <Badge variant="warning">
            <Icon name="info" className="text-sm inline" /> {matchingVariants.length} matches found
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {matchingVariants.map((v) => (
          <div key={v.variant_id} className="relative inline-block group">
            <button
              onClick={() => setVariant(v.cex_sku)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all text-left ${
                variant === v.cex_sku
                  ? 'border-2 border-yellow-500 bg-yellow-500 text-blue-900 shadow-sm'
                  : 'border border-gray-200 bg-white text-gray-900 hover:border-yellow-500'
              }`}
            >
              {v.title}
            </button>
            <a
              href={`https://uk.webuy.com/product-detail?id=${v.cex_sku}`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -top-1 -right-1 bg-blue-900 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-blue-800"
              title="View on CEX"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="open_in_new" className="text-xs" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VariantSelector;