import { useState, useEffect } from 'react';
import { fetchAttributes } from '@/services/api';

/**
 * Custom hook for managing product attributes and variants
 */
export const useProductAttributes = (productId, variants) => {
  const [attributes, setAttributes] = useState([]);
  const [attributeValues, setAttributeValues] = useState({});
  const [dependencies, setDependencies] = useState([]);
  const [variant, setVariant] = useState('');

  // Load attributes when product changes
  useEffect(() => {
    if (!productId) {
      setAttributes([]);
      setAttributeValues({});
      setDependencies([]);
      setVariant('');
      return;
    }

    const loadAttributes = async () => {
      setAttributes([]);
      setAttributeValues({});
      setDependencies([]);
      setVariant('');

      const data = await fetchAttributes(productId);
      
      if (!data) return;

      setAttributes(data.attributes);
      setDependencies(data.dependencies);

      const initialValues = {};
      data.attributes.forEach(attr => {
        if (attr.values.length === 1) {
          initialValues[attr.code] = attr.values[0];
        } else {
          initialValues[attr.code] = '';
        }
      });
      setAttributeValues(initialValues);
    };

    loadAttributes();
  }, [productId]);

  // Auto-select single-option dropdowns
  useEffect(() => {
    if (attributes.length === 0 || variants.length === 0) return;

    const newValues = { ...attributeValues };
    let hasChanges = false;

    attributes.forEach((attr, index) => {
      if (attributeValues[attr.code]) return;

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

      if (options.length === 1 && allPreviousSelected && options.length > 0) {
        newValues[attr.code] = options[0];
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setAttributeValues(newValues);
    }
  }, [attributes, attributeValues, variants]);

  // Auto-select variant when all attributes are selected
  useEffect(() => {
    if (variants.length === 1 && attributes.length === 0) {
      setVariant(variants[0].cex_sku);
      return;
    }

    if (variants.length === 0 || Object.keys(attributeValues).length === 0) return;

    const matchingVariants = variants.filter(variant => {
      return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
        if (!attrValue) return true;
        return variant.attribute_values[attrCode] === attrValue;
      });
    });

    if (matchingVariants.length === 1) {
      setVariant(matchingVariants[0].cex_sku);
    } else if (matchingVariants.length > 1) {
      const isCurrentVariantValid = matchingVariants.some(v => v.cex_sku === variant);
      if (!isCurrentVariantValid) {
        setVariant('');
      }
    }
  }, [attributeValues, variants, attributes]);

  const handleAttributeChange = (code, value) => {
    const changedAttrIndex = attributes.findIndex(a => a.code === code);
    
    const newValues = { ...attributeValues, [code]: value };

    attributes.forEach((attr, index) => {
      if (index > changedAttrIndex) {
        newValues[attr.code] = '';
      }
    });

    setAttributeValues(newValues);
  };

  return {
    attributes,
    attributeValues,
    dependencies,
    variant,
    setVariant,
    handleAttributeChange
  };
};