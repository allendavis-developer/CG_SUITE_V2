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

// Get CSRF token from cookie
function getCSRFToken() {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrftoken='))
    ?.split('=')[1];
  return cookieValue;
}

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
  const [ebayData, setEbayData] = useState(null);

  useEffect(() => {
    setAttributes([]);
    setAttributeValues({});
    setDependencies([]);
    setVariants([]);
    setVariant('');
  }, [selectedCategory]);

  useEffect(() => {
    if (!selectedModel?.product_id) {
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
  }, [selectedModel]);

  // Auto-select single-option dropdowns as they become visible
  useEffect(() => {
    if (attributes.length === 0 || variants.length === 0) return;

    const newValues = { ...attributeValues };
    let hasChanges = false;

    attributes.forEach((attr, index) => {
      // Skip if already selected
      if (attributeValues[attr.code]) return;

      // Get previous selections
      const previousSelections = Object.entries(attributeValues)
        .filter(([code]) => {
          const attrIndex = attributes.findIndex(a => a.code === code);
          return attrIndex < index && attributeValues[code];
        });

      // Find matching variants based on previous selections
      const matchingVariants = variants.filter(variant => {
        return previousSelections.every(([code, value]) => {
          return variant.attribute_values[code] === value;
        });
      });

      // Get available values for this attribute
      const availableValues = new Set(
        matchingVariants.map(v => v.attribute_values[attr.code])
      );
      
      const options = attr.values.filter(opt => 
        index === 0 || availableValues.has(opt)
      );

      // Check if all previous visible attributes are selected
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

      // Auto-select if: has options, only one option, all previous selected, and this dropdown would be visible
      if (options.length === 1 && allPreviousSelected && options.length > 0) {
        newValues[attr.code] = options[0];
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setAttributeValues(newValues);
    }
  }, [attributes, attributeValues, variants]);

  useEffect(() => {
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
      setEbayData(null);
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
        
        if (data.reference_data && data.reference_data.cex_based_sale_price) {
          setOurSalePrice(data.reference_data.cex_based_sale_price.toString());
        }
        
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

  if (!selectedCategory) {
    return (
      <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
        <EmptyState />
      </section>
    );
  }

  return (
    <section className="w-3/5 bg-white flex flex-col overflow-y-auto">
      <div className="flex items-center px-8 bg-gray-50 border-b border-gray-200 sticky top-0 z-40">
        <Tab icon="info" label="Product Info" isActive={activeTab === 'info'} onClick={() => setActiveTab('info')} />
        <Tab icon="analytics" label="eBay Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
      </div>

      <div className="px-8 py-6 border-b border-gray-200 bg-gray-50/50">
        <Breadcrumb items={selectedCategory.path} />

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
              if (!selectedModel || !selectedOfferId) {
                alert('Please select an offer to give the customer');
                return;
              }

              const selectedVariant = variants.find(v => v.cex_sku === variant);

              let cartItem;

              if (selectedOfferId === 'manual') {
                if (!manualOfferPrice || parseFloat(manualOfferPrice) <= 0) return;

                cartItem = {
                  id: Date.now(),
                  title: selectedModel.name,
                  subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
                  price: formatGBP(parseFloat(manualOfferPrice)),
                  customerExpectation: 0,
                  highlighted: false,
                  offerId: 'manual',
                  offerTitle: 'Manual Offer',
                  variantId: selectedVariant?.variant_id
                };
              } else {
                const selectedOffer = offers.find(offer => offer.id === selectedOfferId);
                if (!selectedOffer) return;

                cartItem = {
                  id: Date.now(),
                  title: selectedModel.name,
                  subtitle: selectedVariant?.title || Object.values(attributeValues).filter(v => v).join(' / ') || 'Standard',
                  price: formatGBP(parseFloat(selectedOffer.price)),
                  customerExpectation: 0,
                  highlighted: false,
                  offerId: selectedOffer.id,
                  offerTitle: selectedOffer.title,
                  variantId: selectedVariant?.variant_id
                };
              }

              addToCart(cartItem);
            }}
          >
            Add to Cart
          </Button>
        </div>
      </div>

      <div className="p-8 space-y-8">
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

        {(() => {
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
            <>
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
            </>
          );
        })()}

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
            <th className="p-4 text-xs font-semibold text-gray-700">Method</th>
            <th className="p-4">Buy-in Price</th>
            <th className="p-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {variant && competitorStats.length > 0 ? (
            competitorStats.map((row, idx) => (
              <tr key={`cex-${idx}`} className="hover:bg-gray-50 transition-colors">
                <td className="p-4 font-medium text-gray-900">CEX</td>
                <td className="p-4 font-bold text-gray-600">{formatGBP(row.salePrice)}</td>

                {/* Our Sale Price - now read-only and same text size */}
                <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                  {formatGBP(parseFloat(ourSalePrice))}
                </td>

                {/* Method column moved next to Our Sale Price */}
                <td className="p-4 text-gray-700 font-semibold text-sm">
                  {referenceData?.percentage_used ? `${referenceData.percentage_used}%` : '—'}
                </td>

                <td className="p-4 font-bold text-blue-900">{formatGBP(row.buyPrice)}</td>
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

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                —
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">—</td>

              <td className="p-4 italic text-gray-600/60">—</td>
              <td className="p-4 text-right text-xs text-gray-600/60">—</td>
            </tr>
          )}

          {/* eBay Row */}
          {ebayData ? (
            <tr className="hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-900">eBay</td>
              <td className="p-4 font-bold text-gray-600">{formatGBP(parseFloat(ebayData.stats.median))}</td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                {formatGBP(parseFloat(ebayData.stats.suggestedPrice))}
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">
                Based on {ebayData.listings.length} sold listings
              </td>

              <td className="p-4 italic text-gray-600/60">—</td>
              <td className="p-4 text-right">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="search_insights"
                  onClick={() => setEbayModalOpen(true)}
                >
                  View Details
                </Button>
              </td>
            </tr>
          ) : (
            <tr className="bg-gray-50/20 hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium text-gray-600">eBay</td>
              <td className="p-4 italic text-gray-600/60">No data – Run research</td>

              <td className="p-4 bg-yellow-500/5 border-x border-yellow-500/10 font-bold text-gray-900">
                —
              </td>

              <td className="p-4 text-gray-700 font-semibold text-sm">—</td>

              <td className="p-4 italic text-gray-600/60">—</td>
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
          )}
        </tbody>
      </table>
        </Card>

        {variant && offers.length > 0 && (() => {
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
                      isHighlighted={selectedOfferId === offer.id}
                      onClick={() => setSelectedOfferId(offer.id)}
                    />
                  );
                })}
                
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
      </div>

      <EbayResearchModal
        open={isEbayModalOpen}
        onClose={() => setEbayModalOpen(false)}
        onResearchComplete={(data) => {
          console.log('eBay research done', data);
          setEbayData(data);
          setEbayModalOpen(false);
        }}
      />
    </section>
  );
};

const CartSidebar = ({ 
  cartItems = [], 
  setCartItems = () => {}, 
  customerData,
  currentRequestId,
  onFinalize
}) => {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [overallExpectation, setOverallExpectation] = useState('');

  const removeItem = (id) => {
    setCartItems(cartItems.filter(item => item.id !== id));
  };

  const total = cartItems.reduce((sum, item) => {
    const numericPrice = Number(item.price.replace(/[^0-9.]/g, ''));
    return sum + numericPrice;
  }, 0);

  const handleFinalize = async () => {
    if (!currentRequestId || cartItems.length === 0) {
      alert('No items in cart to finalize');
      return;
    }

    setIsFinalizing(true);
    try {
      await onFinalize();
    } catch (error) {
      console.error('Error finalizing transaction:', error);
      alert('Failed to finalize transaction. Please try again.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <aside className="w-1/5 border-l border-blue-900/20 flex flex-col bg-white">
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
        <div className="flex items-center gap-2 mt-3">
          <p className="text-blue-900/60 text-[11px] font-bold uppercase tracking-widest">
            {cartItems.length} Items
          </p>
          {currentRequestId && (
            <>
              <span className="text-blue-900/40">•</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Icon name="receipt_long" className="text-xs text-blue-900/60" />
                  <span className="text-blue-900/60 text-[11px] font-bold">
                    Request #{currentRequestId}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        {currentRequestId && (
          <div className="mt-3">
            <label className="text-blue-900/60 text-[10px] font-bold uppercase tracking-widest block mb-1">
              Overall Expectation
            </label>
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-blue-900 font-bold text-xs">£</span>
              <input 
                className="w-full pl-5 pr-2 py-1.5 border border-blue-900/30 rounded text-sm font-bold text-blue-900 focus:ring-1 focus:ring-blue-900 focus:border-blue-900 bg-white" 
                placeholder="0.00" 
                type="number"
                step="0.01"
                value={overallExpectation}
                onChange={(e) => setOverallExpectation(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="shopping_cart" className="text-4xl text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No items in cart</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <CartItem
              key={item.id}
              title={item.title}
              subtitle={item.subtitle}
              price={item.price}
              isHighlighted={false}
              onRemove={() => removeItem(item.id)}
            />
          ))
        )}
      </div>

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

        <Button 
          variant="primary" 
          size="lg" 
          className="w-full group"
          onClick={handleFinalize}
          disabled={isFinalizing || cartItems.length === 0}
        >
          {isFinalizing ? (
            <>
              <Icon name="sync" className="text-sm animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              Finalize Transaction
              <Icon
                name="arrow_forward"
                className="text-sm group-hover:translate-x-1 transition-transform"
              />
            </>
          )}
        </Button>
      </div>
    </aside>
  );
};

export default function Buyer() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const hasAutoSelected = useRef(false);
  
  const [cartItems, setCartItems] = useState([]);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(true);
  
  const [currentRequestId, setCurrentRequestId] = useState(null);
  const [requestStatus, setRequestStatus] = useState(null);
  
  const [customerData, setCustomerData] = useState({
    id: null,
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

  const createRequest = async (firstItem) => {
    if (!customerData.id) {
      alert('No customer selected');
      return null;
    }

    console.log('Creating request with:', {
      customer_id: customerData.id,
      intent: customerData.transactionType === 'sale' ? 'DIRECT_SALE' : 'BUYBACK',
      item: {
        variant_id: firstItem.variantId,
        initial_expectation_gbp: firstItem.customerExpectation,
        notes: `${firstItem.title} - ${firstItem.subtitle} | Our offer: ${firstItem.price} (${firstItem.offerTitle})`
      }
    });

    try {
      const response = await fetch('http://127.0.0.1:8000/api/requests/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-CSRFToken": getCSRFToken()
        },
        body: JSON.stringify({
          customer_id: customerData.id,
          intent: customerData.transactionType === 'sale' ? 'DIRECT_SALE' : 'BUYBACK',
          item: {
            variant_id: firstItem.variantId,
            initial_expectation_gbp: firstItem.customerExpectation,
            notes: `${firstItem.title} - ${firstItem.subtitle} | Our offer: ${firstItem.price} (${firstItem.offerTitle})`
          }
        })
      });

      const responseText = await response.text();
      console.log('Response status:', response.status);
      console.log('Response text:', responseText);

      if (!response.ok) {
        throw new Error(`Failed to create request: ${response.status} - ${responseText}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError);
        throw new Error('Server returned invalid JSON response');
      }

      setCurrentRequestId(data.request_id);
      setRequestStatus('OPEN');
      
      console.log('Request created:', data);
      return data.request_id;
    } catch (error) {
      console.error('Error creating request:', error);
      alert('Failed to create request. Please try again. Error: ' + error.message);
      return null;
    }
  };

  const addItemToRequest = async (item) => {
    if (!currentRequestId) {
      console.error('No active request');
      return false;
    }

    try {
      const response = await fetch(`http://127.0.0.1:8000/api/requests/${currentRequestId}/items/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-CSRFToken": getCSRFToken()
        },
        body: JSON.stringify({
          variant_id: item.variantId,
          initial_expectation_gbp: item.customerExpectation,
          notes: `${item.title} - ${item.subtitle} | Our offer: ${item.price} (${item.offerTitle})`
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add item to request');
      }

      const data = await response.json();
      console.log('Item added to request:', data);
      return true;
    } catch (error) {
      console.error('Error adding item to request:', error);
      alert('Failed to add item to request. Please try again.');
      return false;
    }
  };

  const finalizeTransaction = async () => {
    if (!currentRequestId) {
      alert('No active request to finalize');
      return;
    }

    try {
      const response = await fetch(`http://127.0.0.1:8000/api/requests/${currentRequestId}/finish/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-CSRFToken": getCSRFToken()
        }
      });

      if (!response.ok) {
        throw new Error('Failed to finalize transaction');
      }

      const data = await response.json();
      setRequestStatus('BOOKED_FOR_TESTING');
      
      console.log('Transaction finalized:', data);
      alert(`Request #${currentRequestId} has been booked for testing!`);
      
      setCartItems([]);
      setCurrentRequestId(null);
      setRequestStatus(null);
      
      setCustomerModalOpen(true);
    } catch (error) {
      console.error('Error finalizing transaction:', error);
      throw error;
    }
  };

  const addToCart = async (item) => {
    if (cartItems.length === 0) {
      const requestId = await createRequest(item);
      if (!requestId) {
        return;
      }
    } else {
      const success = await addItemToRequest(item);
      if (!success) {
        return;
      }
    }

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

      <CustomerIntakeModal
        open={isCustomerModalOpen}
        onClose={(customerInfo) => {
          setCustomerModalOpen(false);
          if (customerInfo) {
            setCustomerData({
              id: customerInfo.id,
              name: customerInfo.customerName,
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
          currentRequestId={currentRequestId}
          onFinalize={finalizeTransaction}
        />
      </main>
    </div>
  );
}