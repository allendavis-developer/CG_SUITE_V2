import { useState, useEffect } from 'react';
import { fetchAttributes } from '@/services/api';

const getRenderableOptionsForAttribute = (attributes, attributeValues, variants, attr, index) => {
  const previousSelections = Object.entries(attributeValues).filter(([code]) => {
    const attrIndex = attributes.findIndex(a => a.code === code);
    return attrIndex < index && attributeValues[code];
  });

  const matchingVariants = variants.filter((variant) =>
    previousSelections.every(([code, value]) => variant.attribute_values[code] === value)
  );

  const availableValues = new Set(
    matchingVariants.map((variant) => variant.attribute_values[attr.code]).filter(Boolean)
  );

  let options = attr.values.filter((opt) => index === 0 || availableValues.has(opt));
  if (options.length === 0 && availableValues.size > 0) {
    options = Array.from(availableValues).sort();
  }

  return options;
};

const areAllRenderableAttributesSelected = (attributes, attributeValues, variants) => {
  return attributes.every((attr, index) => {
    if (attributeValues[attr.code]) {
      return true;
    }

    const options = getRenderableOptionsForAttribute(attributes, attributeValues, variants, attr, index);
    return options.length === 0;
  });
};

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

      const options = getRenderableOptionsForAttribute(attributes, attributeValues, variants, attr, index);

      const visiblePreviousAttrs = attributes.slice(0, index).filter((prevAttr, prevIndex) => {
        const prevOptions = getRenderableOptionsForAttribute(
          attributes,
          attributeValues,
          variants,
          prevAttr,
          prevIndex
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

  // When variant is set (e.g. from persistence when returning from another page) but attributeValues
  // don't match, sync attributeValues from the variant — same flow as when user selects a variant.
  useEffect(() => {
    if (!variant || variants.length === 0 || attributes.length === 0) return;
    const matchedVariant = variants.find(v => v.cex_sku === variant);
    if (!matchedVariant?.attribute_values) return;

    const needsSync = Object.entries(matchedVariant.attribute_values).some(
      ([code, value]) => attributeValues[code] !== value
    );
    if (!needsSync) return;

    setAttributeValues({ ...matchedVariant.attribute_values });
  }, [variant, variants, attributes.length, attributeValues]);

  // Auto-select variant when all attributes are selected
  useEffect(() => {
    if (variants.length === 1 && attributes.length === 0) {
      setVariant(variants[0].cex_sku);
      return;
    }

    if (variants.length === 0 || Object.keys(attributeValues).length === 0) return;

    const allSelected = areAllRenderableAttributesSelected(attributes, attributeValues, variants);
    const matchingVariants = variants.filter(v => {
      return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
        if (!attrValue) return true;
        return v.attribute_values[attrCode] === attrValue;
      });
    });

    if (matchingVariants.length === 1 && allSelected) {
      setVariant(matchingVariants[0].cex_sku);
    } else if (variant) {
      const isCurrentVariantValid = matchingVariants.some(v => v.cex_sku === variant);
      if (!allSelected || !isCurrentVariantValid) {
        setVariant('');
      }
    }
  }, [attributeValues, variants, attributes, variant]);

  const handleAttributeChange = (code, value) => {
    const changedAttrIndex = attributes.findIndex(a => a.code === code);
    if (changedAttrIndex === -1) return;

    const newValues = { ...attributeValues, [code]: value };
    let shouldClearRemaining = false;

    attributes.forEach((attr, index) => {
      if (index <= changedAttrIndex) {
        return;
      }

      if (shouldClearRemaining) {
        newValues[attr.code] = '';
        return;
      }

      const options = getRenderableOptionsForAttribute(
        attributes,
        newValues,
        variants,
        attr,
        index
      );
      const currentValue = newValues[attr.code];

      // Preserve downstream selections only while they are still valid in order.
      if (options.length === 0) {
        return;
      }

      if (currentValue && options.includes(currentValue)) {
        return;
      }

      newValues[attr.code] = '';
      shouldClearRemaining = true;
    });

    setAttributeValues(newValues);
  };

  // NEW: Batch set all attributes at once without clearing
  const setAllAttributeValues = (values) => {
    setAttributeValues(values);
  };

  return {
    attributes,
    attributeValues,
    dependencies,
    variant,
    setVariant,
    handleAttributeChange,
    setAllAttributeValues // Export the new batch function
  };
};