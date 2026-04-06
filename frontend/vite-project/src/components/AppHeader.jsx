import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useAppStore from '@/store/useAppStore';
import ProductSelection from '@/pages/buyer/components/ProductSelection';
import AttributeConfiguration from '@/pages/buyer/components/AttributeConfiguration';
import OfferSelection from '@/pages/buyer/components/OfferSelection';
import CexMarketPricingStrip from '@/pages/buyer/components/CexMarketPricingStrip';
import EbayResearchForm from '@/components/forms/EbayResearchForm';
import CexProductView from '@/pages/buyer/components/CexProductView';
import { useProductAttributes } from '@/pages/buyer/hooks/useProductAttributes';
import {
  fetchProductCategories,
  fetchProductModels,
  fetchProductVariants,
  fetchVariantPrices,
} from '@/services/api';
import { formatOfferPrice, roundSalePrice } from '@/utils/helpers';
import { filterCategoryTree, getCategoryPath } from '@/utils/categoryTree';
import {
  referenceDataWithNormalizedCexOffers,
  ourSalePriceFieldFromVariantResponse,
  slimCexNegotiationOfferRows,
} from '@/utils/cexOfferMapping';
import WorkspaceCloseButton from '@/components/ui/WorkspaceCloseButton';
import JewelleryReferencePricesTable from '@/components/jewellery/JewelleryReferencePricesTable';
import { useJewelleryScrapWorkspace } from '@/hooks/useJewelleryScrapWorkspace';

/** Jewellery is only added via the header Jewellery button, not the category tree. */
function isJewelleryCategoryName(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === 'jewellery' || n === 'jewelry';
}

const AppHeader = ({
  buyerControls = null,
}) => {
  const location = useLocation();
  const [categories, setCategories] = useState([]);
  const [activeTopLevelId, setActiveTopLevelId] = useState(null);
  const [expandedIds, setExpandedIds] = useState([]);
  const [headerSearch, setHeaderSearch] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [variants, setVariants] = useState([]);
  const [offers, setOffers] = useState([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [referenceData, setReferenceData] = useState(null);
  const [ourSalePrice, setOurSalePrice] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState('builder'); // builder | ebay | cex | jewellery
  const popupRef = useRef(null);
  const headerRef = useRef(null);
  const secondRowRef = useRef(null);
  const categoryFilterInputRef = useRef(null);
  const [mountedTop, setMountedTop] = useState(64);
  const {
    scrape: jewelleryScrape,
    loading: jewelleryScrapeLoading,
    startScrapeSession: startJewelleryScrapeSession,
    reset: resetJewelleryScrape,
  } = useJewelleryScrapWorkspace();
  /** Pending header-search term when user pressed Enter — choose eBay vs CeX. */
  const [marketplaceSearchDialog, setMarketplaceSearchDialog] = useState(null);
  /** True once CeX fetch has started (loading) for this panel — avoids closing before load begins or resetting ref incorrectly */
  const cexFetchStartedRef = useRef(false);

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

  const path = location.pathname;
  const showBuyerControls = Boolean(buyerControls?.enabled);
  const showNegotiationItemBuilder = Boolean(buyerControls?.enableNegotiationItemBuilder);
  const useVoucherOffers = Boolean(buyerControls?.useVoucherOffers);
  const isRepricingWorkspace = Boolean(buyerControls?.onQuickReprice);

  const buyerControlsRef = useRef(buyerControls);
  buyerControlsRef.current = buyerControls;

  /** Clears store category / CeX product and local builder state (models, variants, tree filter). */
  const clearHeaderBuilderState = useCallback(() => {
    const bc = buyerControlsRef.current;
    bc?.onCategorySelect?.(null);
    bc?.clearCexProduct?.();
    setSelectedModel(null);
    setVariants([]);
    setOffers([]);
    setReferenceData(null);
    setOurSalePrice('');
    setCategorySearch('');
    setExpandedIds([]);
  }, []);

  /** Full reset: builder UI, top-level picker, workspace mode, marketplace dialog. */
  const resetHeaderWorkspaceChrome = useCallback(() => {
    resetJewelleryScrape();
    clearHeaderBuilderState();
    setActiveTopLevelId(null);
    setWorkspaceMode('builder');
    setMarketplaceSearchDialog(null);
  }, [clearHeaderBuilderState, resetJewelleryScrape]);

  const setHeaderWorkspaceModeGlobal = useAppStore((s) => s.setHeaderWorkspaceMode);
  const closeHeaderWorkspaceTick = useAppStore((s) => s.closeHeaderWorkspaceTick);
  const prevCloseHeaderTickRef = useRef(0);

  useEffect(() => {
    setHeaderWorkspaceModeGlobal(showNegotiationItemBuilder ? workspaceMode : 'builder');
  }, [workspaceMode, showNegotiationItemBuilder, setHeaderWorkspaceModeGlobal]);

  useEffect(() => {
    if (
      closeHeaderWorkspaceTick > prevCloseHeaderTickRef.current &&
      showNegotiationItemBuilder
    ) {
      resetHeaderWorkspaceChrome();
    }
    prevCloseHeaderTickRef.current = closeHeaderWorkspaceTick;
  }, [
    closeHeaderWorkspaceTick,
    showNegotiationItemBuilder,
    resetHeaderWorkspaceChrome,
  ]);

  /** Push each successful extension scrape to Negotiation (remaps lines + items; also saved on quote draft). */
  useEffect(() => {
    if (!showNegotiationItemBuilder) return;
    const scrape = jewelleryScrape;
    const persist = buyerControlsRef.current?.onJewelleryReferenceScrapeResult;
    if (!scrape?.sections?.length || typeof persist !== 'function') return;
    persist(scrape);
  }, [jewelleryScrape, showNegotiationItemBuilder]);

  const jewellerySectionsForPanel = useMemo(() => {
    const cached = buyerControls?.jewelleryReferenceScrape?.sections;
    if (Array.isArray(cached) && cached.length > 0) return cached;
    const live = jewelleryScrape?.sections;
    return Array.isArray(live) && live.length > 0 ? live : [];
  }, [buyerControls?.jewelleryReferenceScrape, jewelleryScrape]);

  const jewelleryPanelFromCache = Boolean(
    buyerControls?.jewelleryReferenceScrape?.sections?.length
  );
  const jewelleryPanelLoading = !jewelleryPanelFromCache && jewelleryScrapeLoading;

  const { attributes, attributeValues, variant, setVariant, handleAttributeChange, setAllAttributeValues } =
    useProductAttributes(selectedModel?.product_id, variants);

  useEffect(() => {
    if (!showBuyerControls) return;
    let isMounted = true;
    fetchProductCategories()
      .then((data) => {
        if (isMounted) setCategories(data);
      });
    return () => {
      isMounted = false;
    };
  }, [showBuyerControls]);

  const selectedCategoryId = buyerControls?.selectedCategory?.id != null
    ? String(buyerControls.selectedCategory.id)
    : '';
  const selectedTopLevelName = buyerControls?.selectedCategory?.path?.[0] || null;
  const selectedTopLevel = useMemo(
    () => categories.find((cat) => cat.name === selectedTopLevelName) || null,
    [categories, selectedTopLevelName]
  );

  const collectParentIdsToNode = (categoryId, nodes, parents = []) => {
    for (const cat of nodes || []) {
      if (String(cat.category_id) === String(categoryId)) return parents;
      if (cat.children?.length) {
        const found = collectParentIdsToNode(
          categoryId,
          cat.children,
          [...parents, cat.category_id]
        );
        if (found) return found;
      }
    }
    return null;
  };

  useEffect(() => {
    if (!showBuyerControls || !selectedCategoryId || categories.length === 0) return;
    const parentIds = collectParentIdsToNode(selectedCategoryId, categories, []);
    if (parentIds?.length) {
      setExpandedIds((prev) => Array.from(new Set([...prev, ...parentIds])));
    }
  }, [showBuyerControls, selectedCategoryId, categories]);

  useEffect(() => {
    if (!showBuyerControls || !selectedTopLevel) return;
    if (String(selectedTopLevel.name || '').toLowerCase() === 'ebay') {
      setActiveTopLevelId(null);
      return;
    }
    if (isJewelleryCategoryName(selectedTopLevel.name)) {
      setActiveTopLevelId(null);
      return;
    }
    setActiveTopLevelId(selectedTopLevel.category_id);
  }, [showBuyerControls, selectedTopLevel]);

  /** Drop catalogue selection if it sits under Jewellery (not reachable from header pills). */
  useEffect(() => {
    if (!showBuyerControls || !showNegotiationItemBuilder) return;
    const p0 = buyerControls?.selectedCategory?.path?.[0];
    if (!p0 || !isJewelleryCategoryName(p0)) return;
    clearHeaderBuilderState();
    setActiveTopLevelId(null);
  }, [
    showBuyerControls,
    showNegotiationItemBuilder,
    buyerControls?.selectedCategory?.path,
    clearHeaderBuilderState,
  ]);

  useEffect(() => {
    if (!showBuyerControls || !activeTopLevelId) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (
        target?.closest?.('.ts-dropdown') ||
        target?.closest?.('.ts-control') ||
        target?.closest?.('.searchable-dropdown-match') ||
        target?.closest?.('.cg-portal-dropdown-menu')
      ) {
        return;
      }
      if (!popupRef.current?.contains(event.target)) {
        setActiveTopLevelId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showBuyerControls, activeTopLevelId]);

  useEffect(() => {
    if (!showBuyerControls || !showNegotiationItemBuilder || !buyerControls?.selectedCategory?.id) {
      setAvailableModels([]);
      setSelectedModel(null);
      setVariants([]);
      setOffers([]);
      setReferenceData(null);
      setOurSalePrice('');
      return;
    }
    let cancelled = false;
    setIsLoadingModels(true);
    fetchProductModels(buyerControls.selectedCategory)
      .then((models) => {
        if (cancelled) return;
        setAvailableModels(models || []);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showBuyerControls, showNegotiationItemBuilder, buyerControls?.selectedCategory?.id]);

  useEffect(() => {
    if (!showNegotiationItemBuilder || !selectedModel?.product_id) {
      setVariants([]);
      return;
    }
    let cancelled = false;
    fetchProductVariants(selectedModel.product_id)
      .then((variantsData) => {
        if (cancelled) return;
        setVariants(variantsData);
      });
    return () => {
      cancelled = true;
    };
  }, [showNegotiationItemBuilder, selectedModel?.product_id]);

  useEffect(() => {
    if (!showNegotiationItemBuilder || !variant) {
      setOffers([]);
      setReferenceData(null);
      setOurSalePrice('');
      return;
    }
    let cancelled = false;
    setIsLoadingOffers(true);
    fetchVariantPrices(variant)
      .then((data) => {
        if (cancelled) return;
        const referenceData = referenceDataWithNormalizedCexOffers(data);
        setOffers(useVoucherOffers ? referenceData.voucher_offers : referenceData.cash_offers);
        setReferenceData(referenceData);
        setOurSalePrice(ourSalePriceFieldFromVariantResponse(data));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOffers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showNegotiationItemBuilder, variant, useVoucherOffers]);

  const activeTopLevelCategory = useMemo(
    () => categories.find((cat) => String(cat.category_id) === String(activeTopLevelId)) || null,
    [categories, activeTopLevelId]
  );
  const ebayTopLevelCategory = useMemo(
    () => categories.find((cat) => String(cat.name || '').toLowerCase() === 'ebay') || null,
    [categories]
  );
  const builderTopLevelCategories = useMemo(
    () =>
      categories.filter((cat) => {
        const n = String(cat.name || '').toLowerCase();
        return n !== 'ebay' && !isJewelleryCategoryName(cat.name);
      }),
    [categories]
  );

  const visibleActiveTopLevelCategory = useMemo(() => {
    if (!activeTopLevelCategory) return null;
    if (!categorySearch.trim()) return activeTopLevelCategory;
    const filtered = filterCategoryTree([activeTopLevelCategory], categorySearch);
    return filtered[0] || null;
  }, [activeTopLevelCategory, categorySearch]);
  const isFilteringCategories = Boolean(categorySearch.trim());
  const filteredLeafMatches = useMemo(() => {
    const collectLeaves = (nodes, acc = []) => {
      for (const node of nodes || []) {
        if (node.children?.length) collectLeaves(node.children, acc);
        else acc.push(node);
      }
      return acc;
    };
    if (!isFilteringCategories || !visibleActiveTopLevelCategory) return [];
    return collectLeaves([visibleActiveTopLevelCategory], []);
  }, [isFilteringCategories, visibleActiveTopLevelCategory]);
  const showMountedWorkspace = showNegotiationItemBuilder && (Boolean(activeTopLevelCategory) || workspaceMode !== 'builder');

  // Expose workspace-open state to the rest of the app (e.g. disable finalize buttons)
  useEffect(() => {
    useAppStore.getState().setHeaderWorkspaceOpen(showMountedWorkspace);
  }, [showMountedWorkspace]);

  // Collapse CeX workspace when the listing tab is closed / flow cancelled (no product, not loading).
  useLayoutEffect(() => {
    if (workspaceMode !== 'cex') {
      cexFetchStartedRef.current = false;
      return;
    }
    if (!showNegotiationItemBuilder) return;
    if (buyerControls?.isCeXLoading) {
      cexFetchStartedRef.current = true;
      return;
    }
    if (buyerControls?.cexProductData) return;
    if (!cexFetchStartedRef.current) return;
    resetHeaderWorkspaceChrome();
  }, [
    showNegotiationItemBuilder,
    workspaceMode,
    buyerControls?.isCeXLoading,
    buyerControls?.cexProductData,
    resetHeaderWorkspaceChrome,
  ]);

  // Keep --workspace-overlay-top in sync with the top edge of the buyer-controls
  // row so fixed research-form overlays in child pages know where to start.
  useEffect(() => {
    const update = () => {
      const rect = secondRowRef.current?.getBoundingClientRect();
      if (rect?.top != null) {
        document.documentElement.style.setProperty(
          '--workspace-overlay-top',
          `${Math.max(0, Math.round(rect.top))}px`
        );
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--workspace-overlay-top');
    };
  }, [showBuyerControls]);

  useEffect(() => {
    if (!showMountedWorkspace) return;
    const updateTop = () => {
      const rect = secondRowRef.current?.getBoundingClientRect();
      if (rect?.top != null) setMountedTop(Math.max(0, Math.round(rect.top)));
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    return () => window.removeEventListener('resize', updateTop);
  }, [showMountedWorkspace, showBuyerControls, activeTopLevelId, workspaceMode]);

  // After choosing a top-level category, focus the in-panel category filter (buyer + repricing header flows).
  useEffect(() => {
    if (!activeTopLevelId || workspaceMode !== 'builder' || !showNegotiationItemBuilder) return;
    const t = window.setTimeout(() => {
      categoryFilterInputRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [activeTopLevelId, workspaceMode, showNegotiationItemBuilder]);

  useEffect(() => {
    if (!marketplaceSearchDialog || !showBuyerControls) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMarketplaceSearchDialog(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [marketplaceSearchDialog, showBuyerControls]);

  // When buyer workspace is not shown (e.g. view mode, other routes), drop all panel state.
  useEffect(() => {
    if (showBuyerControls && showNegotiationItemBuilder) return;
    resetHeaderWorkspaceChrome();
  }, [showBuyerControls, showNegotiationItemBuilder, resetHeaderWorkspaceChrome]);

  const handleCategorySelect = (category) => {
    const path = getCategoryPath(category.category_id, categories);
    if (!path || !buyerControls?.onCategorySelect) return;
    if (path[0] && isJewelleryCategoryName(path[0])) return;
    buyerControls.onCategorySelect({
      id: category.category_id,
      name: category.name,
      path,
    });
    setSelectedModel(null);
    setVariants([]);
    setOffers([]);
    setReferenceData(null);
    setOurSalePrice('');
  };

  /** Back to model list without changing leaf category (fixes wrong model pick). */
  const handleBackToModelList = useCallback(() => {
    setSelectedModel(null);
    setVariants([]);
    setOffers([]);
    setReferenceData(null);
    setOurSalePrice('');
  }, []);

  useEffect(() => {
    if (!isFilteringCategories || filteredLeafMatches.length !== 1) return;
    const only = filteredLeafMatches[0];
    if (String(only.category_id) === selectedCategoryId) return;
    const t = setTimeout(() => {
      handleCategorySelect(only);
    }, 300);
    return () => clearTimeout(t);
  }, [isFilteringCategories, filteredLeafMatches, selectedCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildWorkspaceNegotiationItem = useCallback((offerArg) => {
    if (!showNegotiationItemBuilder || !selectedModel || !variant) return null;
    const selectedVariant = variants.find((v) => v.cex_sku === variant);
    const cashOffers = slimCexNegotiationOfferRows(referenceData?.cash_offers);
    const voucherOffers = slimCexNegotiationOfferRows(referenceData?.voucher_offers);
    let selectedOfferId = null;
    let manualOffer = null;
    if (offerArg && typeof offerArg === 'object' && offerArg.type === 'manual') {
      selectedOfferId = 'manual';
      manualOffer = formatOfferPrice(Number(offerArg.amount));
    } else {
      selectedOfferId = offerArg === undefined ? (offers[0]?.id ?? null) : offerArg;
    }
    const variantLine =
      selectedVariant?.title
      || Object.values(attributeValues).filter((v) => v).join(' / ')
      || null;
    return {
      id: crypto.randomUUID?.() ?? `neg-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: selectedModel.name,
      subtitle: variantLine || 'Standard',
      variantName: variantLine || undefined,
      quantity: 1,
      category: buyerControls?.selectedCategory?.name,
      categoryObject: buyerControls?.selectedCategory,
      model: selectedModel?.name,
      condition: attributeValues.condition || selectedVariant?.condition,
      attributeValues: { ...attributeValues },
      attributeLabels: Object.fromEntries((attributes || []).map((a) => [a.code, a.name])),
      variantId: selectedVariant?.variant_id ?? null,
      cexSku: selectedVariant?.cex_sku ?? null,
      cexUrl: selectedVariant?.cex_sku ? `https://uk.webuy.com/product-detail?id=${selectedVariant.cex_sku}` : null,
      cexSellPrice: referenceData?.cex_sale_price ? Number(referenceData.cex_sale_price) : null,
      cexBuyPrice: referenceData?.cex_tradein_cash ? Number(referenceData.cex_tradein_cash) : null,
      cexVoucherPrice: referenceData?.cex_tradein_voucher ? Number(referenceData.cex_tradein_voucher) : null,
      cexOutOfStock: referenceData?.cex_out_of_stock ?? false,
      ourSalePrice: ourSalePrice ? roundSalePrice(Number(ourSalePrice)) : null,
      offers: useVoucherOffers ? voucherOffers : cashOffers,
      cashOffers,
      voucherOffers,
      selectedOfferId,
      manualOffer,
      request_item_id: null,
      referenceData,
    };
  }, [showNegotiationItemBuilder, selectedModel, variant, variants, referenceData, useVoucherOffers, offers, buyerControls?.selectedCategory, attributeValues, attributes, ourSalePrice]);

  const handleAddNegotiationItem = async (offerArg) => {
    if (!buyerControls?.onAddNegotiationItem) return;
    const payload = buildWorkspaceNegotiationItem(offerArg);
    if (!payload) return;
    await buyerControls.onAddNegotiationItem(payload);
    resetHeaderWorkspaceChrome();
  };

  const renderCategoryNode = (category) => {
    const hasChildren = Boolean(category.children?.length);
    const isExpanded = isFilteringCategories ? hasChildren : expandedIds.includes(category.category_id);
    const suppressSelectedState = isFilteringCategories && filteredLeafMatches.length > 1;
    const isSelected = !suppressSelectedState && selectedCategoryId === String(category.category_id);

    return (
      <div key={category.category_id} className="space-y-1">
        <button
          type="button"
          className={`w-full flex items-center p-2 rounded-lg text-left cursor-pointer text-sm ${
            isSelected
              ? 'bg-brand-orange/10 text-brand-orange font-semibold border-l-2 border-brand-orange'
              : 'text-white/70 hover:bg-white/10'
          } ${!isSelected && isExpanded ? 'bg-white/5' : ''}`}
          onClick={() => {
            handleCategorySelect(category);
            if (hasChildren) {
              setExpandedIds((prev) =>
                prev.includes(category.category_id)
                  ? prev.filter((id) => id !== category.category_id)
                  : [...prev, category.category_id]
              );
            } else if (!showNegotiationItemBuilder) {
              setActiveTopLevelId(null);
            }
          }}
        >
          <div className="w-5 flex-shrink-0 flex items-center justify-start">
            {hasChildren && (
              <span className={`material-symbols-outlined transition-transform text-sm ${isExpanded ? 'rotate-90' : ''}`}>
                chevron_right
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-sm flex-shrink-0">
              {hasChildren ? 'folder' : 'smartphone'}
            </span>
            <span className="truncate">{category.name}</span>
          </div>
        </button>
        {hasChildren && isExpanded && (
          <div className="ml-4 space-y-1 border-l border-white/10">
            {category.children.map((child) => renderCategoryNode(child))}
          </div>
        )}
      </div>
    );
  };

  const NavIcon = ({ to, icon, label, tooltip, hardNav }) => {
    const cls = `flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors ${
      isActive(to) ? 'bg-white/30 text-white' : 'bg-white/20 text-white hover:bg-white/30'
    }`;

    if (hardNav) {
      return (
        <a href={to} title={tooltip} className={cls} aria-label={label}>
          <span className="material-symbols-outlined">{icon}</span>
        </a>
      );
    }

    return (
      <Link to={to} title={tooltip} className={cls} aria-label={label}>
        <span className="material-symbols-outlined">{icon}</span>
      </Link>
    );
  };

  return (
    <header ref={headerRef} className="border-b border-solid border-brand-blue bg-brand-blue px-6 md:px-10 py-3 sticky top-0 z-50 text-white">
      <div className="flex items-center whitespace-nowrap">
      <div className="flex items-center gap-6">
        <Link
          to="/"
          className="flex items-center gap-3 text-brand-blue hover:opacity-90 transition-opacity"
        >
          <div className="size-8 flex items-center justify-center bg-white text-brand-blue rounded-lg">
            <span className="material-symbols-outlined">rocket_launch</span>
          </div>
          <h2 className="text-white text-xl font-bold leading-tight tracking-tight">
            Internal Tool
          </h2>
        </Link>

        <div className="flex items-center gap-2">
          <NavIcon
            to="/buyer"
            icon="shopping_cart_checkout"
            label="Buying Module"
            tooltip="Buying Module"
          />
          <NavIcon
            to="/repricing"
            icon="analytics"
            label="Repricing Module"
            tooltip="Repricing Module"
          />
          <NavIcon
            to="/reports"
            icon="summarize"
            label="Reports"
            tooltip="Reports"
          />
          <NavIcon
            to="/data"
            icon="dataset_linked"
            label="Data"
            tooltip="Data"
          />
          <NavIcon
            to="/pricing-rules"
            icon="tune"
            label="Pricing Rules"
            tooltip="Pricing Rules"
          />
        </div>
      </div>
      </div>
      {showBuyerControls && (
        <div ref={secondRowRef} className="mt-3 flex items-center justify-center border-t border-white/20 pt-3">
          <div className="relative" ref={popupRef}>
            <div className="flex flex-wrap items-center gap-2">
              {builderTopLevelCategories.map((category) => {
                const isActive = String(activeTopLevelId) === String(category.category_id);
                const isSelectedTop = selectedTopLevelName === category.name;
                const isHighlighted = activeTopLevelId
                  ? isActive
                  : isSelectedTop;
                return (
                  <button
                    key={category.category_id}
                    type="button"
                    onClick={() => {
                      clearHeaderBuilderState();
                      setWorkspaceMode('builder');
                      setActiveTopLevelId((prev) =>
                        String(prev) === String(category.category_id) ? null : category.category_id
                      );
                      setExpandedIds((prev) =>
                        prev.includes(category.category_id) ? prev : [...prev, category.category_id]
                      );
                    }}
                    className={`min-h-11 inline-flex items-center gap-2 px-2.5 py-2 text-left text-sm font-bold transition-colors ${
                      isHighlighted
                        ? 'text-brand-orange/90 underline decoration-brand-orange/80 decoration-2 underline-offset-4'
                        : 'text-white/90 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] opacity-85">folder</span>
                    <span className="truncate">{category.name}</span>
                  </button>
                );
              })}
              <div className="flex h-11 min-w-[380px] md:min-w-[480px] lg:min-w-[580px] xl:min-w-[680px] max-w-4xl flex-1 items-stretch overflow-hidden rounded-lg border-2 border-slate-200/95 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.18)] ring-2 ring-white/70">
                <input
                  type="text"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const q = headerSearch.trim();
                    if (!q) return;
                    e.preventDefault();
                    e.currentTarget.blur();
                    setMarketplaceSearchDialog(q);
                  }}
                  placeholder="Type in a search term"
                  className="h-full min-w-0 flex-1 bg-white px-4 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-blue/25"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!ebayTopLevelCategory) return;
                    handleCategorySelect(ebayTopLevelCategory);
                    setWorkspaceMode('ebay');
                    setActiveTopLevelId(null);
                  }}
                  className={`h-full min-w-[3rem] shrink-0 border-l-2 border-slate-200 px-3.5 text-sm font-extrabold uppercase tracking-wide transition-colors ${
                    workspaceMode === 'ebay'
                      ? 'bg-emerald-700 text-white shadow-inner ring-2 ring-inset ring-emerald-400/90'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                  title="eBay"
                >
                  e
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setWorkspaceMode('cex');
                    const q = headerSearch.trim();
                    const loaded = await buyerControls?.onAddFromCeX?.(q ? { searchQuery: q } : undefined);
                    if (loaded) setHeaderSearch('');
                    setActiveTopLevelId(null);
                  }}
                  disabled={buyerControls?.isCeXLoading}
                  className={`h-full min-w-[3rem] shrink-0 border-l-2 border-slate-200 px-3.5 text-sm font-extrabold uppercase tracking-wide transition-colors ${
                    workspaceMode === 'cex'
                      ? 'bg-red-700 text-white shadow-inner ring-2 ring-inset ring-red-300/90'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                  title="Add from CeX"
                >
                  c
                </button>
              </div>
              {showNegotiationItemBuilder && !isRepricingWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    clearHeaderBuilderState();
                    setActiveTopLevelId(null);
                    setWorkspaceMode('jewellery');
                    resetJewelleryScrape();
                    const bc = buyerControlsRef.current;
                    if (!bc?.jewelleryReferenceScrape?.sections?.length) {
                      startJewelleryScrapeSession();
                    }
                  }}
                  className={`min-h-11 inline-flex items-center gap-2 px-2.5 py-2 text-left text-sm font-bold transition-colors ${
                    workspaceMode === 'jewellery'
                      ? 'text-brand-orange/90 underline decoration-brand-orange/80 decoration-2 underline-offset-4'
                      : 'text-white/90 hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] opacity-85">diamond</span>
                  <span className="truncate">Jewellery</span>
                </button>
              )}
              {buyerControls?.onQuickReprice && (
                <button
                  type="button"
                  onClick={buyerControls.onQuickReprice}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-white/50 bg-white px-3 text-xs font-bold uppercase tracking-wide text-brand-blue shadow-sm transition-colors hover:bg-white/95"
                >
                  <span className="material-symbols-outlined text-[18px]">bolt</span>
                  Quick Reprice
                </button>
              )}
            </div>
            {showMountedWorkspace && (
              <div
                className={
                  showNegotiationItemBuilder
                    ? 'fixed left-0 right-80 bottom-0 z-[200] flex gap-0 bg-white'
                    : 'absolute left-0 top-12 z-50 flex gap-0'
                }
                style={showNegotiationItemBuilder ? { top: `${mountedTop}px` } : undefined}
              >
                {workspaceMode === 'builder' && (
                <div
                  className={
                    showNegotiationItemBuilder
                      ? 'w-[420px] h-full overflow-y-auto border-r border-white/10 bg-brand-blue p-2'
                      : 'w-[420px] max-h-[440px] overflow-y-auto rounded-l-xl border border-white/10 bg-brand-blue p-2 shadow-2xl'
                  }
                >
                <div className="mb-3 border-b border-white/20 px-2 pb-3">
                  <p className="text-lg sm:text-xl font-black uppercase tracking-wide text-white leading-snug">
                    <span className="text-white">{activeTopLevelCategory.name}</span>
                    <span className="ml-2 text-brand-orange drop-shadow-sm">Categories</span>
                  </p>
                </div>
                <div className="px-2 pb-3">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-white/40 text-sm">
                      filter_list
                    </span>
                    <input
                      ref={categoryFilterInputRef}
                      className="w-full bg-white/10 border-white/10 border rounded-lg pl-9 py-2 text-sm text-white focus:ring-1 focus:ring-brand-orange placeholder:text-white/30"
                      placeholder="Filter categories..."
                      type="text"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  {visibleActiveTopLevelCategory
                    ? renderCategoryNode(visibleActiveTopLevelCategory)
                    : <p className="px-2 py-1 text-xs text-white/60">No matching categories.</p>}
                </div>
                {!showNegotiationItemBuilder && (
                  <div className="mt-2 border-t border-white/10 px-2 pt-2">
                    <button
                      type="button"
                      onClick={resetHeaderWorkspaceChrome}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                      Close category picker
                    </button>
                  </div>
                )}
              </div>
                )}
                {showNegotiationItemBuilder && (
                  <div className="flex h-full min-h-0 flex-1 flex-col border-l-0 border-gray-200 bg-white">
                    {(workspaceMode === 'builder' || workspaceMode === 'jewellery') && (
                      <div className="flex shrink-0 items-center justify-end border-b border-gray-200 bg-gray-50 px-3 py-2">
                        <WorkspaceCloseButton
                          title="Close workspace"
                          onClick={resetHeaderWorkspaceChrome}
                        />
                      </div>
                    )}
                    <div
                      className={`min-h-0 flex-1 flex flex-col ${
                        workspaceMode === 'ebay' ? 'overflow-hidden p-0' : 'overflow-y-auto'
                      }`}
                    >
                    {workspaceMode === 'jewellery' ? (
                      <div className="min-h-0 flex-1 overflow-y-auto p-4 [contain:paint]">
                        {jewelleryPanelLoading ? (
                          <div
                            className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-brand-blue"
                            role="status"
                            aria-live="polite"
                          >
                            <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
                            <p className="text-sm font-semibold text-gray-600">Fetching reference prices…</p>
                          </div>
                        ) : (
                          <JewelleryReferencePricesTable
                            sections={jewellerySectionsForPanel}
                            useVoucherOffers={useVoucherOffers}
                            onAddJewelleryToNegotiation={buyerControls?.onAddJewelleryToNegotiation}
                            showNotification={buyerControls?.showNotification}
                            workspaceLines={buyerControls?.jewelleryWorkspaceLines}
                            onWorkspaceLinesChange={buyerControls?.setJewelleryWorkspaceLines}
                            onRemoveJewelleryWorkspaceRow={buyerControls?.onRemoveJewelleryWorkspaceRow}
                            onUpdateReferenceRequest={() => startJewelleryScrapeSession()}
                            updateReferenceLoading={jewelleryScrapeLoading}
                          />
                        )}
                      </div>
                    ) : workspaceMode === 'ebay' ? (
                      <div className="relative h-full min-h-0">
                        <EbayResearchForm
                          key={`ebay-header-${headerSearch.trim()}`}
                          mode="modal"
                          containModalInParent={true}
                          category={ebayTopLevelCategory || { name: 'eBay', path: ['eBay'] }}
                          initialSearchQuery={headerSearch.trim() || undefined}
                          onComplete={(data) => {
                            if (data?.cancel) {
                              resetHeaderWorkspaceChrome();
                              return;
                            }
                            buyerControls?.onEbayResearchComplete?.(data);
                            setHeaderSearch('');
                            resetHeaderWorkspaceChrome();
                          }}
                          initialHistogramState={true}
                          showManualOffer={false}
                          addActionLabel={isRepricingWorkspace ? 'Add to reprice list' : 'Add to Cart'}
                          hideOfferCards={isRepricingWorkspace}
                          useVoucherOffers={useVoucherOffers}
                        />
                      </div>
                    ) : workspaceMode === 'cex' ? (
                      <div className="pt-2 [&_.buyer-main-content]:w-full [&_.buyer-main-content]:max-w-none [&_.buyer-main-content]:flex-1 [&_.buyer-main-content]:min-w-0 [&_.buyer-main-content]:px-0 [&_.buyer-main-content]:mx-0">
                        {buyerControls?.cexProductData ? (
                          <CexProductView
                            cexProduct={buyerControls.cexProductData}
                            isRepricing={isRepricingWorkspace}
                            useVoucherOffers={useVoucherOffers}
                            customerData={buyerControls?.customerData}
                            onAddToCart={(item) => buyerControls?.onAddNegotiationItem?.(item)}
                            createOrAppendRequestItem={buyerControls?.createOrAppendRequestItem}
                            onClearCeXProduct={resetHeaderWorkspaceChrome}
                            cartItems={buyerControls?.existingItems || []}
                            setCexProductData={buyerControls?.setCexProductData}
                            onItemAddedToCart={() => {}}
                            showNotification={buyerControls?.showNotification}
                            blockedOfferSlots={buyerControls?.blockedOfferSlots}
                            onBlockedOfferClick={(slot, offer, blockedSelectionArg) => {
                              const selectedArg = blockedSelectionArg === undefined ? offer?.id : blockedSelectionArg;
                              const selectedVariant = null;
                              const payload = {
                                id: crypto.randomUUID?.() ?? `neg-cex-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                                title: buyerControls.cexProductData?.title || 'CeX Product',
                                subtitle: buyerControls.cexProductData?.category || '',
                                quantity: 1,
                                category: buyerControls.cexProductData?.category || 'CeX',
                                categoryObject:
                                  buyerControls.cexProductData?.categoryObject
                                  || (buyerControls.cexProductData?.category
                                    ? { name: buyerControls.cexProductData.category, path: [buyerControls.cexProductData.category] }
                                    : { name: 'CeX', path: ['CeX'] }),
                                isCustomCeXItem: true,
                                variantId: null,
                                cexSku: buyerControls.cexProductData?.id ?? null,
                                cexUrl: buyerControls.cexProductData?.id ? `https://uk.webuy.com/product-detail?id=${buyerControls.cexProductData.id}` : null,
                                referenceData: buyerControls.cexProductData?.referenceData || null,
                                offers: useVoucherOffers
                                  ? slimCexNegotiationOfferRows(buyerControls.cexProductData?.voucher_offers || [])
                                  : slimCexNegotiationOfferRows(buyerControls.cexProductData?.cash_offers || []),
                                cashOffers: slimCexNegotiationOfferRows(buyerControls.cexProductData?.cash_offers || []),
                                voucherOffers: slimCexNegotiationOfferRows(buyerControls.cexProductData?.voucher_offers || []),
                                selectedOfferId: typeof selectedArg === 'string' ? selectedArg : (selectedArg?.type === 'manual' ? 'manual' : null),
                                manualOffer: selectedArg?.type === 'manual' ? formatOfferPrice(Number(selectedArg.amount || 0)) : null,
                                ourSalePrice:
                                  buyerControls.cexProductData?.referenceData?.cex_based_sale_price != null
                                    ? roundSalePrice(Number(buyerControls.cexProductData.referenceData.cex_based_sale_price))
                                    : null,
                                request_item_id: null,
                                cexOutOfStock: buyerControls.cexProductData?.isOutOfStock ?? false,
                                cexSellPrice: buyerControls.cexProductData?.referenceData?.cex_sale_price ? Number(buyerControls.cexProductData.referenceData.cex_sale_price) : null,
                                cexBuyPrice: buyerControls.cexProductData?.referenceData?.cex_tradein_cash ? Number(buyerControls.cexProductData.referenceData.cex_tradein_cash) : null,
                                cexVoucherPrice: buyerControls.cexProductData?.referenceData?.cex_tradein_voucher ? Number(buyerControls.cexProductData.referenceData.cex_tradein_voucher) : null,
                                cexProductData: buyerControls.cexProductData,
                                _selectedVariant: selectedVariant,
                              };
                              buyerControls?.onWorkspaceBlockedOfferAttempt?.({ slot, offer, item: payload });
                            }}
                          />
                        ) : buyerControls?.isCeXLoading ? (
                          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                            Loading CeX product...
                          </div>
                        ) : null}
                      </div>
                    ) : !buyerControls?.selectedCategory ? (
                      <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                          <span className="material-symbols-outlined text-3xl text-brand-blue">folder_special</span>
                        </div>
                        <h3 className="text-lg font-extrabold tracking-tight text-gray-900">
                          Choose a category before you pick a model
                        </h3>
                        <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">
                          Use the <span className="font-semibold text-gray-900">category buttons</span> and tree on the left to
                          select a <span className="font-semibold text-gray-900">leaf category</span> (the most specific
                          folder). After that, the model list and search will appear here so you can choose a product.
                        </p>
                      </div>
                    ) : !selectedModel ? (
                      <ProductSelection
                        availableModels={availableModels}
                        setSelectedModel={setSelectedModel}
                        isLoading={isLoadingModels}
                      />
                    ) : (
                      <div className="space-y-4 p-4">
                        <button
                          type="button"
                          onClick={handleBackToModelList}
                          title="Return to the model list for this category"
                          className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-brand-blue shadow-sm transition-colors hover:bg-gray-50"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                          Change model
                        </button>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Selected model</p>
                          <p className="text-sm font-semibold text-gray-900">{selectedModel.name}</p>
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Category</p>
                          <p className="text-xs font-medium text-gray-700">
                            {(buyerControls.selectedCategory.path || []).join(' / ')}
                          </p>
                        </div>
                        <AttributeConfiguration
                          attributes={attributes}
                          attributeValues={attributeValues}
                          variants={variants}
                          handleAttributeChange={handleAttributeChange}
                          setAllAttributeValues={setAllAttributeValues}
                          variant={variant}
                          setVariant={setVariant}
                          variantImageUrl={
                            referenceData?.cex_image_urls?.large
                            || referenceData?.cex_image_urls?.medium
                            || referenceData?.cex_image_urls?.small
                          }
                        />
                        {variant && (
                          <CexMarketPricingStrip
                            variant={variant}
                            competitorStats={[]}
                            ourSalePrice={ourSalePrice}
                            referenceData={referenceData}
                            cexSku={variant}
                            showEbayCcResearchActions={false}
                          />
                        )}
                        {variant && (
                          isRepricingWorkspace ? (
                            <button
                              type="button"
                              disabled={isLoadingOffers}
                              onClick={() => handleAddNegotiationItem(null)}
                              className="w-full py-4 rounded-xl font-bold text-sm uppercase tracking-wide transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
                            >
                              <span className="material-symbols-outlined text-[20px]">sell</span>
                              Add to reprice list
                            </button>
                          ) : isLoadingOffers ? (
                            <p className="text-sm text-gray-500">Loading offers...</p>
                          ) : (
                            <OfferSelection
                              variant={variant}
                              offers={offers}
                              referenceData={referenceData}
                              offerType={useVoucherOffers ? 'voucher' : 'cash'}
                              onAddToCart={handleAddNegotiationItem}
                              blockedOfferSlots={buyerControls?.blockedOfferSlots}
                              onBlockedOfferClick={(slot, offer, blockedSelectionArg) => {
                                const blockedItem = buildWorkspaceNegotiationItem(
                                  blockedSelectionArg === undefined ? offer?.id : blockedSelectionArg
                                );
                                if (!blockedItem) return;
                                buyerControls?.onWorkspaceBlockedOfferAttempt?.({
                                  slot,
                                  offer,
                                  item: blockedItem,
                                });
                              }}
                            />
                          )
                        )}
                      </div>
                    )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {showBuyerControls && marketplaceSearchDialog && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="marketplace-search-dialog-title"
        >
          <div
            className="cg-animate-modal-backdrop absolute inset-0 bg-black/45"
            aria-hidden
            onClick={() => setMarketplaceSearchDialog(null)}
          />
          <div
            className="cg-animate-modal-panel relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="marketplace-search-dialog-title" className="text-lg font-extrabold text-gray-900 tracking-tight">
              Where should we look this up?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Search term:{' '}
              <span className="font-semibold text-gray-900">“{marketplaceSearchDialog}”</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">Choose eBay to research a search term, or CeX to add a product from CeX to cart.</p>
            {!ebayTopLevelCategory && (
              <p className="mt-3 text-xs font-medium text-amber-800">
                eBay lookup is unavailable until categories load.
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                onClick={() => setMarketplaceSearchDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!ebayTopLevelCategory}
                className="rounded-lg border-2 border-emerald-700 bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (!ebayTopLevelCategory) return;
                  handleCategorySelect(ebayTopLevelCategory);
                  setWorkspaceMode('ebay');
                  setActiveTopLevelId(null);
                  setMarketplaceSearchDialog(null);
                }}
              >
                eBay research
              </button>
              <button
                type="button"
                disabled={buyerControls?.isCeXLoading}
                className="rounded-lg border-2 border-red-800 bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={async () => {
                  setWorkspaceMode('cex');
                  const loaded = await buyerControls?.onAddFromCeX?.({ searchQuery: marketplaceSearchDialog });
                  if (loaded) setHeaderSearch('');
                  setActiveTopLevelId(null);
                  setMarketplaceSearchDialog(null);
                }}
              >
                CeX
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default AppHeader;
