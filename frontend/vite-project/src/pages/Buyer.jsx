// Buyer.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Icon,
  Button,
  Badge,
  Card,
  CardHeader,
  CustomDropdown,
  Tab,
  Breadcrumb,
  Header,
  Sidebar,
  MarketRow,
  OfferCard,
  CartItem,
  SearchableDropdown
} from '../components/ui/components';

import EbayResearchModal from "../components/modals/EbayResearchModal.jsx"
import CustomerIntakeModal from "../components/modals/CustomerIntakeModal.jsx";


const formatGBP = (value) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2
  }).format(value);

// API call for product models
const fetchProductModels = async (category) => {
  if (!category?.id) return [];

  try {
    const res = await fetch(`/api/products/?category_id=${category.id}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();

    // Return both product_id and name
    return data.map((p) => ({ 
      model_id: p.product_id, 
      name: p.name,
      product_id: p.product_id 
    }));
  } catch (err) {
    console.error('Error fetching product models:', err);
    return [];
  }
};

const fetchCompetitorStats = async (cexSku) => {
  if (!cexSku) return [];

  const res = await fetch(`/api/market-stats/?sku=${cexSku}`);
  if (!res.ok) throw new Error('Failed to fetch market stats');

  const data = await res.json();

  return [
    {
      platform: data.platform,
      salePrice: Number(data.sale_price_gbp),
      buyPrice: Number(data.tradein_cash_gbp),
      voucherPrice: Number(data.tradein_voucher_gbp),
      verified: true,
      outOfStock: data.cex_out_of_stock,
      lastUpdated: data.last_updated
    }
  ];
};


const fetchAttributes = async (productId) => {
  if (!productId) return null;

  try {
    const res = await fetch(`http://127.0.0.1:8000/api/product-variants/?product_id=${productId}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();

    return {
      attributes: data.attributes.map(attr => ({
        name: attr.label,
        code: attr.code,
        values: attr.values
      })),
      dependencies: data.dependencies,
      variants: data.variants
    };
  } catch (err) {
    console.error('Error fetching attributes:', err);
    return null;
  }
};



// Empty State Component
const EmptyState = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center px-8 py-12">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
        <Icon name="devices" className="text-gray-400 text-2xl" />
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">Select a Product Category</h3>
      <p className="text-sm text-gray-500 max-w-sm">
        Choose a category from the sidebar to begin processing trade-ins
      </p>
    </div>
  </div>
);

// Manual Offer Card Component
const ManualOfferCard = ({ isHighlighted, onClick, manualPrice, setManualPrice }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        p-6 rounded-xl bg-white cursor-pointer text-center relative overflow-hidden
        border-2 border-dashed
        transition-all duration-200 ease-out
        ${
          isHighlighted
            ? `
              border-blue-900
              ring-2 ring-blue-900 ring-offset-2 ring-offset-white
              shadow-xl shadow-blue-900/10
              scale-[1.03]
            `
            : `
              border-yellow-500
              hover:border-blue-900
              hover:shadow-lg
            `
        }
      `}
    >
      {/* Top accent bar */}
      <div
        className={`absolute top-0 left-0 w-full ${
          isHighlighted
            ? 'h-1.5 bg-yellow-500'
            : 'h-1 bg-yellow-500/60'
        }`}
      />

      <h4 className="text-[10px] font-black uppercase text-blue-900 mb-4 tracking-wider flex items-center justify-center gap-1">
        <Icon name="edit_note" className="text-[12px]" />
        Manual Offer
      </h4>

      <div className="relative mb-2">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-sm">£</span>
        <input 
          className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-lg font-extrabold text-blue-900 focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 bg-white" 
          placeholder="0.00" 
          type="number"
          step="0.01"
          value={manualPrice}
          onChange={(e) => {
            setManualPrice(e.target.value);
            // Auto-select manual offer when user types
            if (e.target.value && !isHighlighted) {
              onClick();
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-4">
        <span className="text-[10px] font-bold text-gray-500 uppercase">
          Custom Price
        </span>
      </div>
    </div>
  );
};

// Main Content Component
const MainContent = ({ selectedCategory, availableModels, selectedModel, setSelectedModel, addToCart }) => {
  const [activeTab, setActiveTab] = useState('info');
  const [variant, setVariant] = useState('');

  // Dynamic attributes
  const [attributes, setAttributes] = useState([]);
  const [attributeValues, setAttributeValues] = useState({});
  const [dependencies, setDependencies] = useState([]);
  const [variants, setVariants] = useState([]);
  const [competitorStats, setCompetitorStats] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isEbayModalOpen, setEbayModalOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [manualOfferPrice, setManualOfferPrice] = useState('');
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');

  useEffect(() => {
    // Reset all attribute-related state when category changes
    setAttributes([]);
    setAttributeValues({});
    setDependencies([]);
    setVariants([]);
    setVariant('');
  }, [selectedCategory]);

  useEffect(() => {
    if (!selectedModel?.product_id) {
      // Clear attributes when no model is selected
      setAttributes([]);
      setAttributeValues({});
      setDependencies([]);
      setVariants([]);
      setVariant('');
      return;
    }

    const loadAttributes = async () => {
      setAttributes([]);
      setAttributeValues({});
      setDependencies([]);
      setVariants([]);
      setVariant('');

      const data = await fetchAttributes(selectedModel.product_id);
      
      if (!data) return;

      setAttributes(data.attributes);
      setDependencies(data.dependencies);
      setVariants(data.variants);

      // Auto-select attributes with only one option
      const initialValues = {};
      data.attributes.forEach(attr => {
        if (attr.values.length === 1) {
          initialValues[attr.code] = attr.values[0];  // Auto-select if only one option
        } else {
          initialValues[attr.code] = '';  // Empty for multiple options
        }
      });
      setAttributeValues(initialValues);
    };



    loadAttributes();
  }, [selectedModel]);

  useEffect(() => {
    if (variants.length === 0 || Object.keys(attributeValues).length === 0) return;

    // Find matching variants based on current attribute selections
    const matchingVariants = variants.filter(variant => {
      return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
          if (!attrValue) return true; //  ignore unselected attributes
        return variant.attribute_values[attrCode] === attrValue;
      });
    });

    // Auto-select if only one match
    if (matchingVariants.length === 1) {
      setVariant(matchingVariants[0].cex_sku);
    } else if (matchingVariants.length > 1) {
      // If multiple matches and current variant is not in the list, clear it
      const isCurrentVariantValid = matchingVariants.some(v => v.cex_sku === variant);
      if (!isCurrentVariantValid) {
        setVariant('');
      }
    }
  }, [attributeValues, variants]);

  useEffect(() => {
    if (!variant) {
      setCompetitorStats([]);
      return;
    }

    const selectedVariant = variants.find(v => v.cex_sku === variant);
    if (!selectedVariant) return;

    const loadStats = async () => {
      setIsLoadingStats(true);
      const data = await fetchCompetitorStats(
        selectedVariant.cex_sku,
        selectedVariant.title
      );
      setCompetitorStats(data);
      setIsLoadingStats(false);
    };

    loadStats();
  }, [variant, variants]);

  useEffect(() => {
    if (!variant) {
      setOffers([]);
      setReferenceData(null);
      setOurSalePrice('');
      return;
    }


    const loadOffers = async () => {
      setIsLoadingOffers(true);
      
      try {
        const res = await fetch(`/api/variant-prices/?sku=${variant}`);
        if (!res.ok) throw new Error('Failed to fetch offers');
        
        const data = await res.json();
        setOffers(data.offers);
        setReferenceData(data.reference_data);
        
        // Set our sale price from reference data
        if (data.reference_data && data.reference_data.cex_based_sale_price) {
          setOurSalePrice(data.reference_data.cex_based_sale_price.toString());
        }
        
        // Auto-select the first offer
        if (data.offers && data.offers.length > 0) {
          setSelectedOfferId(data.offers[0].id);
        }
      } catch (err) {
        console.error('Error fetching offers:', err);
        setOffers([]);
        setReferenceData(null);
        setOurSalePrice('');
      } finally {
        setIsLoadingOffers(false);
      }
    };

    loadOffers();
  }, [variant]);


  useEffect(() => {
    setSelectedOfferId(null);
  }, [variant]);



  // Handle intelligent attribute changes
  const handleAttributeChange = (code, value) => {
    const changedAttrIndex = attributes.findIndex(a => a.code === code);
    
    const newValues = { ...attributeValues, [code]: value };

    // Clear all selections after this attribute
    attributes.forEach((attr, index) => {
      if (index > changedAttrIndex) {
        newValues[attr.code] = '';
      }
    });

    setAttributeValues(newValues);
  };

  // If no category selected, show empty state
  if (!selectedCategory) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <EmptyState />
      </section>
    );
  }


  const availableModelsForDropdown = availableModels.length > 0 ? availableModels : ['No models available'];

  return (
    <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <Tab icon="info" label="Product Info" isActive={activeTab === 'info'} onClick={() => setActiveTab('info')} />
        <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
      </div>

      <div className="px-8 py-6 border-b border-gray-200 bg-gray-50/50">
        <Breadcrumb items={selectedCategory.path} />

        {/* Product Model Dropdown */}
        <div className="mb-4">
          <SearchableDropdown
            value={selectedModel?.name || 'Select a model'}
            options={availableModels.length > 0 ? availableModels.map(m => m.name) : ['No models available']}
            onChange={(name) => {
              const model = availableModels.find(m => m.name === name);
              if (model) setSelectedModel(model);
            }}
          />
        </div>

        <div className="flex justify-between items-start">
          <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {selectedModel?.name || selectedCategory.name}
              {Object.keys(attributeValues).length > 0 && (
                  <span> - {Object.values(attributeValues).filter(v => v).join(' / ')}</span>
              )}
          </h1>
   
          </div>
          <Button
            variant="primary"
            icon="add_shopping_cart"
            className="px-8 py-4 text-base font-bold"
            onClick={() => {
              if (!selectedModel || !selectedOfferId) return;

              // Get the selected variant for the title
              const selectedVariant = variants.find(v => v.cex_sku === variant);

              let cartItem;

              // Handle manual offer
              if (selectedOfferId === 'manual') {
                if (!manualOfferPrice || parseFloat(manualOfferPrice) <= 0) return;

                cartItem = {
                  id: Date.now(),
                  title: selectedModel.name,
                  subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
                  price: formatGBP(parseFloat(manualOfferPrice)),
                  highlighted: false,
                  offerId: 'manual',
                  offerTitle: 'Manual Offer'
                };
              } else {
                // Handle regular offer
                const selectedOffer = offers.find(offer => offer.id === selectedOfferId);
                if (!selectedOffer) return;

                cartItem = {
                  id: Date.now(),
                  title: selectedModel.name,
                  subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
                  price: formatGBP(parseFloat(selectedOffer.price)),
                  highlighted: false,
                  offerId: selectedOffer.id,
                  offerTitle: selectedOffer.title
                };
              }

              addToCart(cartItem);
            }}
          >
            Add to Cart
          </Button>
        </div>
      </div>

      {/* Configuration & Condition */}
      <div className="p-8 space-y-8">
        <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
            Configuration & Condition
          </h3>
          <div className="space-y-8">
            {attributes.map((attr, index) => {
              // Get current selections for attributes before this one
              const previousSelections = Object.entries(attributeValues)
                .filter(([code]) => {
                  const attrIndex = attributes.findIndex(a => a.code === code);
                  return attrIndex < index && attributeValues[code]; // Only count filled selections
                });

              // Filter variants based on previous selections
              const matchingVariants = variants.filter(variant => {
                return previousSelections.every(([code, value]) => {
                  return variant.attribute_values[code] === value;
                });
              });

              // Get available options from matching variants
              const availableValues = new Set(
                matchingVariants.map(v => v.attribute_values[attr.code])
              );
              
              const options = attr.values.filter(opt => 
                index === 0 || availableValues.has(opt)
              );

              // Skip this attribute if it has no options
              if (options.length === 0) {
                return null;
              }

              // Only show this attribute if all previous VISIBLE attributes have been selected
              const visiblePreviousAttrs = attributes.slice(0, index).filter((prevAttr, prevIndex) => {
                // Check if this previous attribute would have options
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

       {/* Variant Section - Show after first selection is made */}
        {(() => {
        // Determine which attributes are actually visible (same logic you use when rendering)
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

        // 🔒 only show variants when ALL visible attributes are selected
        const allAttributesSelected = visibleAttributes.every(
          attr => attributeValues[attr.code]
        );

        if (!allAttributesSelected) return null;

      // Find matching variants based on current attribute selections
      const matchingVariants = variants.filter(variant => {
        return Object.entries(attributeValues).every(([attrCode, attrValue]) => {
          // Only check attributes that have been selected (not empty)
          if (!attrValue) return true;
          return variant.attribute_values[attrCode] === attrValue;
        });
      });

      // Only show if there are matches
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
    })()}

        {/* Market Comparisons */}
        <Card noPadding>
          <CardHeader
            title="Market Comparisons"
            actions={
              <span className="text-[10px] font-bold text-gray-500 flex items-center gap-1.5">
                <Icon name="schedule" className="text-xs" />
                Last Synced: 2 mins ago
              </span>
            }
          />
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-bold text-gray-500 uppercase bg-gray-50/50">
              <tr>
                <th className="p-4">Platform</th>
                <th className="p-4">Market Sale Price</th>
                <th className="p-4 bg-yellow-500/10 border-x border-yellow-500/20">OUR SALE PRICE</th>
                <th className="p-4">Buy-in Price</th>
                <th className="p-4">Method</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {/* CEX ROW */}
              {variant && competitorStats.length > 0 ? (
                competitorStats.map((row, idx) => (
                  <tr key={`cex-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 font-medium text-gray-900">CEX</td>
                    <td className="p-4 font-bold text-gray-600">{formatGBP(row.salePrice)}</td>
                    <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10">
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-xs">£</span>
                        <input 
                          className="w-full pl-6 pr-3 py-1.5 border border-blue-900/20 rounded-md text-xs font-bold text-blue-900 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500" 
                          step="0.01" 
                          type="number" 
                          value={ourSalePrice}
                          onChange={(e) => setOurSalePrice(e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="p-4 font-bold text-blue-900">{formatGBP(row.buyPrice)}</td>
                    <td className="p-4 text-xs font-semibold text-gray-700">
                      {referenceData?.percentage_used ? `${referenceData.percentage_used}%` : '—'}
                    </td>
                    <td className="p-4 text-right">
                      <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold">
                        <Icon name="check_circle" className="text-xs" /> Verified
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="bg-gray-50/20">
                  <td className="p-4 font-medium text-gray-600">CEX</td>
                  <td className="p-4 italic text-gray-600/60">
                    Select a variant to view prices
                  </td>
                  <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10">
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-xs">£</span>
                      <input 
                        className="w-full pl-6 pr-3 py-1.5 border border-blue-900/20 rounded-md text-xs font-bold text-blue-900 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 bg-gray-50" 
                        step="0.01" 
                        type="number" 
                        value=""
                        disabled
                      />
                    </div>
                  </td>
                  <td className="p-4 italic text-gray-600/60">—</td>
                  <td className="p-4 italic text-gray-600/60">—</td>
                  <td className="p-4 text-right text-xs text-gray-600/60">—</td>
                </tr>
              )}

              {/* EBAY ROW (ALWAYS PRESENT) */}
              <tr className="bg-gray-50/20 hover:bg-gray-50 transition-colors">
                <td className="p-4 font-medium text-gray-600">
                  eBay
                </td>
                <td className="p-4 italic text-gray-600/60">
                  No data – Run research
                </td>
                <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10">
                  <div className="relative w-32">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-xs">£</span>
                    <input 
                      className="w-full pl-6 pr-3 py-1.5 border border-blue-900/20 rounded-md text-xs font-bold text-blue-900 focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 bg-gray-50" 
                      step="0.01" 
                      type="number" 
                      value=""
                      disabled
                    />
                  </div>
                </td>
                <td className="p-4 italic text-gray-600/60">
                  —
                </td>
                <td className="p-4 italic text-gray-600/60">
                  —
                </td>
                <td className="p-4">
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      size="lg"
                      className="group"
                      icon="search_insights"
                      onClick={() => setEbayModalOpen(true)}
                    >
                      Research on eBay
                    </Button>
                  </div>
                </td>
              </tr>

            </tbody>


          </table>
        </Card>

    {/* Suggested Trade-In Offers - Only show when variant is selected */}
    {variant && offers.length > 0 && (() => {
      // Calculate margin for each offer based on current sale price
      const calculateMargin = (offerPrice, salePrice) => {
        const salePriceNum = parseFloat(salePrice);
        const offerPriceNum = parseFloat(offerPrice);
        
        if (!salePriceNum || salePriceNum <= 0) return 0;
        
        const margin = ((salePriceNum - offerPriceNum) / salePriceNum) * 100;
        return Math.round(margin);
      };

      return (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
            Suggested Trade-In Offers
          </h3>

          <div className="grid grid-cols-4 gap-4">
            {offers.map((offer) => {
              const recalculatedMargin = calculateMargin(offer.price, ourSalePrice);
              
              return (
                <OfferCard
                  key={offer.id}
                  title={offer.title}
                  price={formatGBP(parseFloat(offer.price))}
                  margin={recalculatedMargin}

                  /* 🔑 controlled highlight */
                  isHighlighted={selectedOfferId === offer.id}

                  /* 🖱 mouse selection */
                  onClick={() => setSelectedOfferId(offer.id)}
                />
              );
            })}
            
            {/* Manual Offer Card */}
            <ManualOfferCard
              isHighlighted={selectedOfferId === 'manual'}
              onClick={() => setSelectedOfferId('manual')}
              manualPrice={manualOfferPrice}
              setManualPrice={setManualOfferPrice}
            />
          </div>
        </div>
      );
    })()}

      </div>  {/* <-- ADD THIS CLOSING DIV TAG */}

      <EbayResearchModal
        open={isEbayModalOpen}
        onClose={() => setEbayModalOpen(false)}
        onResearchComplete={(data) => {
          console.log('eBay research done', data);
          // optionally do something with the data
        }}
      />

    </section>
  );
};


// Update the CartSidebar component to accept and display transaction type
const CartSidebar = ({ cartItems = [], setCartItems = () => {}, customerData }) => {
  const removeItem = (id) => {
    setCartItems(cartItems.filter(item => item.id !== id));
  };

  const total = cartItems.reduce((sum, item) => {
    const numericPrice = Number(item.price.replace(/[^0-9.]/g, ''));
    return sum + numericPrice;
  }, 0);

  return (
    <aside className="w-1/5 border-l border-blue-900/20 flex flex-col bg-white">
      {/* Customer Header Section - white background with blue text */}
      <div className="bg-white p-6 shadow-md shadow-blue-900/10">
        <h1 className="text-blue-900 text-xl font-extrabold tracking-tight">
          {customerData.name}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <p className="text-blue-900/80 text-sm font-medium">
            Cancel Rate: {customerData.cancelRate}%
          </p>
          <span className="text-blue-900/40">•</span>
          <p className={`text-sm font-bold ${
            customerData.transactionType === 'sale' 
              ? 'text-emerald-600' 
              : 'text-purple-600'
          }`}>
            {customerData.transactionType === 'sale' ? 'Direct Sale' : 'Buy Back'}
          </p>
        </div>
        <p className="text-blue-900/60 text-[11px] font-bold uppercase tracking-widest mt-3">
          {cartItems.length} Items
        </p>
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {cartItems.map((item, index) => (
          <CartItem
            key={item.id}
            title={item.title}
            subtitle={item.subtitle}
            price={item.price}
            isHighlighted={false}
            onRemove={() => removeItem(item.id)}
          />
        ))}
      </div>

      {/* Footer Section */}
      <div className="p-6 bg-white border-t border-blue-900/20 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">
              Offer Total
            </span>
            <span className="font-bold text-blue-900">
              £{total.toFixed(2)}
            </span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">
              Adjustments
            </span>
            <span className="font-bold text-blue-900/40">
              £0.00
            </span>
          </div>
        </div>

        <div className="pt-4 border-t border-blue-900/20 flex justify-between items-end">
          <span className="text-xs font-bold text-blue-900 uppercase tracking-widest">
            Grand Total
          </span>
          <span className="text-2xl font-black text-blue-900 tracking-tighter">
            £{total.toFixed(2)}
          </span>
        </div>

        <Button variant="primary" size="lg" className="w-full group">
          Finalize Transaction
          <Icon
            name="arrow_forward"
            className="text-sm group-hover:translate-x-1 transition-transform"
          />
        </Button>
      </div>
    </aside>
  );
};

// Update the Buyer component to include transaction type in customerData
export default function Buyer() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const hasAutoSelected = useRef(false);
  
  const [cartItems, setCartItems] = useState([]);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(true);
  
  // Initialize with empty customer data
  const [customerData, setCustomerData] = useState({
    name: 'No Customer Selected',
    cancelRate: 0,
    transactionType: 'sale'
  });

  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);
    setSelectedModel(null);
    hasAutoSelected.current = false;
    const models = await fetchProductModels(category);
    setAvailableModels(models);
  };

  useEffect(() => {
    if (availableModels.length > 0 && !hasAutoSelected.current) {
      setSelectedModel(availableModels[0]);
      hasAutoSelected.current = true;
    }
  }, [availableModels]);

  const addToCart = (item) => {
    setCartItems((prev) => [...prev, item]);
  };

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>

      {/* Customer Intake Modal */}
      <CustomerIntakeModal
        open={isCustomerModalOpen}
        onClose={(customerInfo) => {
          setCustomerModalOpen(false);
          if (customerInfo) {
            setCustomerData({
              name: customerInfo.customerName || customerInfo.name,
              cancelRate: customerInfo.cancelRate || 0,
              transactionType: customerInfo.transactionType || 'sale'
            });
            console.log("Selected customer:", customerInfo);
          }
        }}
      />

      <Header onSearch={(val) => console.log('Search:', val)} />
      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        <Sidebar onCategorySelect={handleCategorySelect} />
        <MainContent 
          selectedCategory={selectedCategory} 
          availableModels={availableModels}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          addToCart={addToCart}   
        />
        <CartSidebar 
          cartItems={cartItems} 
          setCartItems={setCartItems}
          customerData={customerData}
        />
      </main>
    </div>
  );
}