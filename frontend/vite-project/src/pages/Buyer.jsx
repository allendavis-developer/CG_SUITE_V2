// Buyer.jsx
import React, { useState, useEffect } from 'react';
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


// API call for product models
const fetchProductModels = async (category) => {
  if (!category?.id) return [];

  try {
    const res = await fetch(`/api/products/?category_id=${category.id}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();

    // data = [{product_id, name}, ...]
    return data.map((p) => ({ model_id: p.product_id, name: p.name }));
  } catch (err) {
    console.error('Error fetching product models:', err);
    return [];
  }
};

// Mock API call for product attributes
const fetchAttributes = async (model) => {
  // Simulate network delay
  await new Promise(res => setTimeout(res, 300));

  // Mock data
  return {
    attributes: [
      { name: 'Storage', values: ['256GB', '512GB', '1TB'] },
      { name: 'Condition', values: ['Excellent', 'Standard', 'Damaged'] },
      { name: 'Carrier', values: ['Factory Unlocked', 'Network Locked'] },
      { name: 'Edition', values: ['Standard', 'Special Edition'] }
    ],
    dependencies: [
      {
        attribute: 'Condition',
        dependsOn: 'Storage',
        rules: {
          '256GB': ['Excellent', 'Standard'],
          '512GB': ['Excellent'],
          '1TB': ['Excellent', 'Standard', 'Damaged']
        }
      },
      {
        attribute: 'Carrier',
        dependsOn: 'Edition',
        rules: {
          'Special Edition': ['Factory Unlocked'],
          'Standard': ['Factory Unlocked', 'Network Locked']
        }
      }
    ]
  };
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

// Main Content Component
const MainContent = ({ selectedCategory, availableModels }) => {
  const [activeTab, setActiveTab] = useState('info');
  const [selectedModel, setSelectedModel] = useState('');
  const [variant, setVariant] = useState(''); // For variant buttons

  // Dynamic attributes
  const [attributes, setAttributes] = useState([]); // Fetched from API
  const [attributeValues, setAttributeValues] = useState({}); // Currently selected values
  const [dependencies, setDependencies] = useState([]); // Dependency rules

  // Load attributes when a model is selected
  useEffect(() => {
    if (!selectedModel) return;

    const loadAttributes = async () => {
      const data = await fetchAttributes(selectedModel);

      setAttributes(data.attributes);
      setDependencies(data.dependencies);

      // Initialize selected values with the first option of each attribute
      const initialValues = {};
      data.attributes.forEach(attr => {
        initialValues[attr.name] = attr.values[0] || '';
      });
      setAttributeValues(initialValues);
    };

    loadAttributes();
  }, [selectedModel]);

  useEffect(() => {
    if (!selectedModel && availableModels.length > 0 && availableModels[0] !== 'No models available') {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);


  // Handle intelligent attribute changes
  const handleAttributeChange = (name, value) => {
    const newValues = { ...attributeValues, [name]: value };

    // Apply dependencies: auto-select or remove invalid options
    dependencies.forEach(dep => {
      if (dep.dependsOn in newValues && dep.attribute in newValues) {
        const allowed = dep.rules[newValues[dep.dependsOn]] || [];
        if (!allowed.includes(newValues[dep.attribute])) {
          newValues[dep.attribute] = allowed[0] || '';
        }
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
        <Tab icon="analytics" label="Market Research" isActive={activeTab === 'research'} onClick={() => setActiveTab('research')} />
      </div>

      <div className="px-8 py-6 border-b border-gray-200 bg-gray-50/50">
        <Breadcrumb items={selectedCategory.path} />

        {/* Product Model Dropdown */}
        <div className="mb-4">
          <SearchableDropdown
            value={selectedModel || 'Select a model'}
            options={availableModelsForDropdown}
            onChange={setSelectedModel}
          />
        </div>

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {selectedModel || selectedCategory.name} - {attributeValues.Storage || ''}
            </h1>
            <div className="mt-1 flex items-center gap-3">
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Icon name="barcode_scanner" className="text-xs" />
                UPC: 195949048456
              </p>
              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
              <span className="text-blue-900 font-semibold text-xs uppercase tracking-wider">Active Eligibility</span>
            </div>
          </div>
          <Button variant="primary" icon="add_shopping_cart">
            Add to Cart
          </Button>
        </div>
      </div>

      {/* Configuration & Condition */}
      <div className="p-8 space-y-8">
        <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Configuration & Condition</h3>
          <div className="grid grid-cols-3 gap-6">
            {attributes.map(attr => {
              // Compute allowed options based on dependencies
              const dep = dependencies.find(d => d.attribute === attr.name);
              let options = attr.values;

              if (dep && attributeValues[dep.dependsOn]) {
                options = dep.rules[attributeValues[dep.dependsOn]] || [];
              }

              return (
                <CustomDropdown
                  key={attr.name}
                  label={attr.name}
                  value={attributeValues[attr.name] || ''}
                  options={options}
                  onChange={(val) => handleAttributeChange(attr.name, val)}
                />
              );
            })}
          </div>
        </div>

        {/* Variant Section */}
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">Refine Variant</h3>
              <Badge variant="warning">
                <Icon name="info" className="text-sm inline" /> Multiple matches found
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['A3102 (Global)', 'A2848 (USA)', 'A3101 (Canada/Japan)'].map((v) => (
              <button
                key={v}
                onClick={() => setVariant(v)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  variant === v
                    ? 'border-2 border-yellow-500 bg-yellow-500 text-blue-900 shadow-sm'
                    : 'border border-gray-200 bg-white text-gray-900 hover:border-yellow-500'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

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
                <th className="p-4">Sale Price</th>
                <th className="p-4">Buy-in Price</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <MarketRow platform="Platform Alpha" salePrice="$849.00" buyPrice="$645.00" verified />
              <MarketRow platform="Secondary Marketplace" onResearch={() => console.log('Research clicked')} />
            </tbody>
          </table>
        </Card>

        {/* Suggested Trade-In Offers */}
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Suggested Trade-In Offers</h3>
          <div className="grid grid-cols-3 gap-6">
            <OfferCard title="First Offer" price="380" margin="40" />
            <OfferCard title="Second Offer" price="615" margin="45" />
            <OfferCard title="Third Offer" price="695" margin="50" isHighlighted />
          </div>
        </div>
      </div>
    </section>
  );
};


// Cart Sidebar Component
const CartSidebar = () => {
  const [items, setItems] = useState([
    { id: 1, title: 'MacBook Pro 14" M3', subtitle: '1TB / 32GB RAM', price: '$1,420.00', highlighted: true },
    { id: 2, title: 'AirPods Pro Gen 2', subtitle: 'A-Grade / Boxed', price: '$145.00', highlighted: false }
  ]);

  const removeItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  const total = items.reduce((sum, item) => sum + parseFloat(item.price.replace('$', '').replace(',', '')), 0);

  return (
    <aside className="w-1/5 border-l border-blue-900 flex flex-col bg-white">
      <div className="p-4 border-b border-blue-900 flex justify-between items-center bg-white">
        <h3 className="font-bold flex items-center gap-2 text-blue-900">
          <Icon name="receipt_long" className="text-yellow-500 text-sm" />
          Processing Batch
        </h3>
        <Badge variant="default">{items.length} Items</Badge>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {items.map(item => (
          <CartItem 
            key={item.id}
            title={item.title}
            subtitle={item.subtitle}
            price={item.price}
            isHighlighted={item.highlighted}
            onRemove={() => removeItem(item.id)}
          />
        ))}
      </div>
      <div className="p-6 bg-slate-50 border-t border-blue-900/10 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">Offer Total</span>
            <span className="font-bold text-slate-900">${total.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-blue-900/60 font-semibold uppercase tracking-wider">Adjustments</span>
            <span className="font-bold text-slate-400">$0.00</span>
          </div>
        </div>
        <div className="pt-4 border-t border-blue-900/20 flex justify-between items-end">
          <span className="text-xs font-bold text-blue-900 uppercase tracking-widest">Grand Total</span>
          <span className="text-2xl font-black text-slate-900 tracking-tighter">${total.toFixed(2)}</span>
        </div>
        <Button variant="primary" size="lg" className="w-full group">
          Finalize Transaction
          <Icon name="arrow_forward" className="text-sm group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </aside>
  );
};




// Main Buyer Component
export default function Buyer() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);

  const handleCategorySelect = async (category) => {
    setSelectedCategory(category);

    // Fetch product models for this category
    const models = await fetchProductModels(category);

    // Update available models state
    setAvailableModels(models.map((m) => m.name));
  };


  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col text-sm">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined { font-size: 20px; }
      `}</style>
      
      <Header onSearch={(val) => console.log('Search:', val)} />
      <main className="flex flex-1 overflow-hidden h-[calc(100vh-61px)]">
        <Sidebar onCategorySelect={handleCategorySelect} />
        <MainContent selectedCategory={selectedCategory} availableModels={availableModels}  />
        <CartSidebar />
      </main>
    </div>
  );
}