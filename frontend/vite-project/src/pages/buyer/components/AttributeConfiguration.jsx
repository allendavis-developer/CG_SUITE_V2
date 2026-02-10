import React, { useMemo, useEffect, useState, startTransition } from 'react';
import { CustomDropdown, SearchableDropdown, Icon } from '@/components/ui/components';

/**
 * Product attribute configuration component with integrated variant search
 */
const AttributeConfiguration = ({ 
  attributes, 
  attributeValues, 
  variants, 
  handleAttributeChange,
  setAllAttributeValues, // NEW: batch update function
  variant,
  setVariant
}) => {
  // Track if user selected via dropdown (to show all attributes)
  const [selectedViaDropdown, setSelectedViaDropdown] = useState(false);

  const handleReset = () => {
    // 1. Tell the UI to hide the extra attribute rows again
    setSelectedViaDropdown(false);
    
    // 2. Clear the specific selected variant
    setVariant(null);
    
    // 3. Create a "blank slate" for all attributes
    const clearedValues = attributes.reduce((acc, attr) => {
      acc[attr.code] = ''; 
      return acc;
    }, {});

    // 4. Send that blank slate back to your main state
    if (setAllAttributeValues) {
      setAllAttributeValues(clearedValues);
    } else {
      // If you don't have the batch function, clear them one by one
      attributes.forEach(attr => handleAttributeChange(attr.code, ''));
    }
  };

  // Filter variants based on currently selected attributes
  const filteredVariants = useMemo(() => {
    return variants.filter(v => {
      return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
        // If no value selected for this attribute, don't filter by it
        if (!attrValue) return true;
        // Check if variant matches this attribute value
        return v.attribute_values[attrCode] === attrValue;
      });
    });
  }, [variants, attributeValues]);

  // When attribute values change, update the selected variant if it matches exactly one filtered variant
  useEffect(() => {
    // If we have exactly one matching variant, select it automatically
    if (filteredVariants.length === 1) {
      const matchingVariant = filteredVariants[0];
      if (matchingVariant.cex_sku !== variant) {
        setVariant(matchingVariant.cex_sku);
      }
    }
    // If current variant is not in filtered list, clear it
    else if (variant && !filteredVariants.find(v => v.cex_sku === variant)) {
      setVariant(null);
    }
  }, [filteredVariants, variant, setVariant]);

  // Reset selectedViaDropdown when variant is cleared
  useEffect(() => {
    if (!variant) {
      setSelectedViaDropdown(false);
    }
  }, [variant]);

  const selectedVariant = variants.find(v => v.cex_sku === variant);
  const variantOptions = filteredVariants.map(v => v.title);
  
  // Handle when variant is cleared or not in filtered list
  const selectedVariantTitle = useMemo(() => {
    if (!variant) return '';
    const foundVariant = filteredVariants.find(v => v.cex_sku === variant);
    return foundVariant ? foundVariant.title : '';
  }, [variant, filteredVariants]);

  const handleVariantChange = (title) => {
    const v = filteredVariants.find(variant => variant.title === title);
    if (v) {
      // Mark that user selected via dropdown
      setSelectedViaDropdown(true);
      
      // Set the variant
      setVariant(v.cex_sku);
      
      // Use the batch update function to set ALL attributes at once
      // This avoids the "clear subsequent attributes" behavior
      if (setAllAttributeValues) {
        setAllAttributeValues(v.attribute_values);
      } else {
        // Fallback to individual updates in reverse order
        requestAnimationFrame(() => {
          const attrCodes = attributes.map(a => a.code);
          for (let i = attrCodes.length - 1; i >= 0; i--) {
            const attrCode = attrCodes[i];
            const attrValue = v.attribute_values[attrCode];
            handleAttributeChange(attrCode, attrValue);
          }
        });
      }
    }
  };

  const handleAttributeChangeWrapper = (code, value) => {
    // When user manually changes attributes, clear the dropdown flag
    setSelectedViaDropdown(false);
    
    // Call the regular handler (this will clear subsequent attributes)
    handleAttributeChange(code, value);
    
    // After the change, check if there's exactly one matching variant
    requestAnimationFrame(() => {
      const changedAttrIndex = attributes.findIndex(a => a.code === code);
      
      // Calculate what the new attribute values will be after this change
      const newValues = { ...attributeValues, [code]: value };
      
      // Clear subsequent attributes (matching the hook's behavior)
      attributes.forEach((attr, index) => {
        if (index > changedAttrIndex) {
          newValues[attr.code] = '';
        }
      });
      
      // Find matching variants with these new values
      const matchingVariants = variants.filter(v => {
        return Object.entries(newValues).every(([attrCode, attrValue]) => {
          if (!attrValue) return true;
          return v.attribute_values[attrCode] === attrValue;
        });
      });
      
      if (matchingVariants.length === 1) {
        // Exactly one match - auto-populate remaining attributes and select variant
        const matchedVariant = matchingVariants[0];
        
        setSelectedViaDropdown(true);
        setVariant(matchedVariant.cex_sku);
        
        // Populate all remaining attributes from this variant
        if (setAllAttributeValues) {
          setAllAttributeValues(matchedVariant.attribute_values);
        }
      } else {
        // Multiple matches or no matches - clear variant selection
        setVariant(null);
      }
    });
  };

  return (
    <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-6">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            Configuration & Condition
          </h3>

          {(variant || Object.values(attributeValues).some(v => v)) && (
            <button 
              onClick={handleReset}
              className="px-2 py-0.5 text-xs font-bold bg-gray-200 hover:bg-red-100 hover:text-red-600 text-gray-600 rounded-full transition-all duration-200 uppercase tracking-widest"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Attribute Dropdowns - Horizontal Layout */}
      <div className="flex flex-wrap gap-4">
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

          if (!selectedViaDropdown && index > 0) {
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
            
            if (!allPreviousSelected) {
              return null;
            }
          }

          return (
            <div key={attr.code} className="flex-1 min-w-[200px]">
              <CustomDropdown
                label={attr.name}
                value={attributeValues[attr.code] || ''}
                options={options}
                onChange={(val) => handleAttributeChangeWrapper(attr.code, val)}
                labelPosition="top"
              />
            </div>
          );
        })}
      </div>

    {/* Move Variant Search Dropdown here — always visible if variants exist */}
    {variants.length > 0 && (
      <div className="mt-6 max-w-md">
        <SearchableDropdown
          label=""
          value={selectedVariantTitle}
          options={variantOptions}
          onChange={handleVariantChange}
          placeholder={`Search ${filteredVariants.length} variant${filteredVariants.length !== 1 ? 's' : ''}...`}
        />
      </div>
    )}

    </div>
  );

};

export default AttributeConfiguration;