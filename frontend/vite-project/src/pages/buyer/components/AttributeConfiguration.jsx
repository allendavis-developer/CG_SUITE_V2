import React from 'react';
import { CustomDropdown } from '@/components/ui/components';

/**
 * Product attribute configuration component
 */
const AttributeConfiguration = ({ 
  attributes, 
  attributeValues, 
  variants, 
  handleAttributeChange 
}) => {
  return (
    <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
        Configuration & Condition
      </h3>
      <div className="space-y-8">
        {attributes.map((attr, index) => {
          const previousSelections = Object.entries(attributeValues)
            .filter(([code]) => {
              const attrIndex = attributes.findIndex(a => a.code === code);
              return attrIndex < index && attributeValues[code];
            });

          const matchingVariants = variants.filter(variant => {
            return previousSelections.every(([code, value]) => {
              return variant.attribute_values[code] === value;
            });
          });

          const availableValues = new Set(
            matchingVariants.map(v => v.attribute_values[attr.code])
          );
          
          const options = attr.values.filter(opt => 
            index === 0 || availableValues.has(opt)
          );

          if (options.length === 0) {
            return null;
          }

          const visiblePreviousAttrs = attributes.slice(0, index).filter((prevAttr, prevIndex) => {
            const prevPreviousSelections = Object.entries(attributeValues)
              .filter(([code]) => {
                const attrIndex = attributes.findIndex(a => a.code === code);
                return attrIndex < prevIndex && attributeValues[code];
              });
            
            const prevMatchingVariants = variants.filter(variant => {
              return prevPreviousSelections.every(([code, value]) => {
                return variant.attribute_values[code] === value;
              });
            });
            
            const prevAvailableValues = new Set(
              prevMatchingVariants.map(v => v.attribute_values[prevAttr.code])
            );
            
            const prevOptions = prevAttr.values.filter(opt => 
              prevIndex === 0 || prevAvailableValues.has(opt)
            );
            
            return prevOptions.length > 0;
          });

          const allPreviousSelected = visiblePreviousAttrs.every(
            prevAttr => attributeValues[prevAttr.code]
          );
          
          if (!allPreviousSelected && index > 0) {
            return null;
          }

          return (
            <CustomDropdown
              key={attr.code}
              label={attr.name}
              value={attributeValues[attr.code] || ''}
              options={options}
              onChange={(val) => handleAttributeChange(attr.code, val)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default AttributeConfiguration;