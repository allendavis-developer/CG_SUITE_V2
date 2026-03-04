import React, { useMemo, useEffect, useState } from 'react';
import { CustomDropdown, SearchableDropdown } from '@/components/ui/components';

/**
 * Product attribute configuration component:
 * - Top: Quick-find variant search (alternative to manual config)
 * - Middle: Configuration & Condition dropdowns (manual path)
 * - Bottom: Variant option buttons (only after config narrows results)
 */
const AttributeConfiguration = ({ 
  attributes, 
  attributeValues, 
  variants, 
  handleAttributeChange,
  setAllAttributeValues,
  variant,
  setVariant,
  variantImageUrl
}) => {
  const [selectedViaDropdown, setSelectedViaDropdown] = useState(false);

  const handleReset = () => {
    setSelectedViaDropdown(false);
    setVariant(null);
    const clearedValues = attributes.reduce((acc, attr) => {
      acc[attr.code] = ''; 
      return acc;
    }, {});

    // Send that blank slate back to your main state
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
        if (!attrValue) return true;
        return v.attribute_values[attrCode] === attrValue;
      });
    });
  }, [variants, attributeValues]);

  // True when every attribute that would actually render a dropdown has a value selected.
  // Attributes with no renderable options (e.g. color not in API but exists on variants)
  // do NOT block — they simply won't appear as dropdowns.
  const allRenderableAttributesSelected = useMemo(() => {
    return attributes.every((attr, index) => {
      if (attributeValues[attr.code]) return true;

      const previousSelections = Object.entries(attributeValues).filter(([code]) => {
        const attrIndex = attributes.findIndex(a => a.code === code);
        return attrIndex < index && attributeValues[code];
      });

      const matchingVars = variants.filter(v =>
        previousSelections.every(([code, value]) => v.attribute_values[code] === value)
      );

      const availableValues = new Set(
        matchingVars.map(v => v.attribute_values[attr.code]).filter(Boolean)
      );

      let options = attr.values.filter(opt => index === 0 || availableValues.has(opt));
      if (options.length === 0 && availableValues.size > 0) {
        options = Array.from(availableValues).sort();
      }

      // No renderable options → this attr won't show a dropdown, so it doesn't block
      if (options.length === 0) return true;

      // Has options but nothing selected → still blocking
      return false;
    });
  }, [attributes, attributeValues, variants]);

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
  const quickFindVariantTitle = selectedVariant?.title ?? '';

  const selectVariant = (v) => {
    if (!v) return;
    setSelectedViaDropdown(true);
    setVariant(v.cex_sku);
    if (setAllAttributeValues) {
      setAllAttributeValues(v.attribute_values);
    } else {
      requestAnimationFrame(() => {
        const attrCodes = attributes.map(a => a.code);
        for (let i = attrCodes.length - 1; i >= 0; i--) {
          const attrCode = attrCodes[i];
          const attrValue = v.attribute_values[attrCode];
          handleAttributeChange(attrCode, attrValue);
        }
      });
    }
  };

  const handleVariantChange = (title) => {
    const v = filteredVariants.find(variant => variant.title === title);
    if (v) selectVariant(v);
  };

  const handleQuickFindSelect = (title) => {
    if (!title) {
      handleReset();
      return;
    }
    const v = variants.find(vr => vr.title === title);
    if (v) selectVariant(v);
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
      {/* Quick find — separate section so it’s not confused with config dropdowns */}
      {variants.length > 0 && (
        <div className="mb-6 pb-5 border-b border-gray-200">
          <SearchableDropdown
            label="Quick find variant"
            value={quickFindVariantTitle}
            options={filteredVariants.map((v) => v.title)}
            onChange={handleQuickFindSelect}
            placeholder={`Search ${filteredVariants.length} variant${filteredVariants.length !== 1 ? 's' : ''}...`}
            clearable
            onClear={handleReset}
          />
          <p className="mt-1.5 text-xs text-gray-500">Search by name if you know your variant</p>
        </div>
      )}

      {/* Configuration & Condition + Image */}
      <div className="flex gap-6 items-start">
        <div className="flex-shrink-0 min-w-0"> 
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

          {/* Attribute dropdowns */}
          <div className="flex flex-col gap-4">
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
            matchingVariants.map(v => v.attribute_values[attr.code]).filter(Boolean)
          );
          
          let options = attr.values.filter(opt => 
            index === 0 || availableValues.has(opt)
          );
          // Edge case: API attr.values may not include all variant values (e.g. missing or mismatched). Use variant-derived values so the dropdown appears.
          if (options.length === 0 && availableValues.size > 0) {
            options = Array.from(availableValues).sort();
          }

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
            <div key={attr.code} className="w-full max-w-md">
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
        </div>

        {variant && variantImageUrl && (
          <div className="flex-shrink-0 w-80 h-80 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <img
              src={variantImageUrl}
              alt="Product"
              className="w-full h-full object-contain"
            />
          </div>
        )}
      </div>

      {/* Variant selection: show only once every renderable dropdown has been filled.
          If a dropdown has no options (e.g. color missing from API), it's skipped — the
          variant list still appears so the user can always progress. */}
      {variants.length > 0 &&
        filteredVariants.length > 0 &&
        allRenderableAttributesSelected && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <span className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            {filteredVariants.length === 1 ? 'Variant' : 'Select variant'}
          </span>
          <div className="flex flex-wrap gap-2">
            {filteredVariants.map((v) => {
              const isSelected = v.cex_sku === variant;
              return (
                <button
                  key={v.cex_sku}
                  type="button"
                  onClick={() => handleVariantChange(v.title)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-yellow-500 border-yellow-500 text-blue-900'
                      : 'bg-white border-gray-200 text-gray-800 hover:border-yellow-500 hover:bg-yellow-50'
                  }`}
                >
                  {v.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );

};

export default AttributeConfiguration;