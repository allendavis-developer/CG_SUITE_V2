# CG Suite V2 — Ideal System Architecture & Simplification Plan

> **Audience:** humans and LLMs who have to reason about this codebase and add features.
> **Date:** 2026-04-21
> **Premise:** the current code is *functional*, but understanding a feature end-to-end requires threading through ~8 layers (React page → monolithic Zustand store → api.js → DRF view → service → `_shared` helper → research_storage → models_v2). The goal of this document is to name that friction, explain *why* it exists, and describe the architecture the project should converge toward.

This is **not** a "rewrite from scratch" plan. Every item has a low-risk refactor path that preserves behaviour.

---

## 0. Where the real pain lives (tl;dr)

The previous `SYSTEM_MAP.md` declares victory ("all P0/P1 refactors done"). In reality, the ones that got split were the ones that *trip file-size alarms*. The code that actually resists change is different, and far bigger. The actual top offenders by size today:

| File | Lines | What it does |
|---|---:|---|
| `frontend/.../pages/buyer/utils/negotiationHelpers.js` | **2,387** | Dumping ground for every negotiation-related utility |
| `pricing/models_v2.py` | 2,134 | 41 model classes, 283 field defs |
| `frontend/.../components/forms/ResearchFormShell.jsx` | **1,981** | Single shell shared by all research forms |
| `frontend/.../pages/buyer/Negotiation.jsx` | **1,696** | God page component for the core workflow |
| `frontend/.../hooks/useNegotiationItemHandlers.js` | **1,546** | One file of per-action handlers |
| `chrome-extension/content-nospos.js` | 1,549 | NosPos page-state detection |
| `frontend/.../components/forms/ExtensionResearchForm.jsx` | **1,489** | Research form body |
| `chrome-extension/content-nospos-agreement-fill.js` | 1,207 | NosPos form-fill automation |
| `frontend/.../store/useAppStore.js` | **1,184** | Monolithic Zustand store (SYSTEM_MAP claimed ~300) |
| `frontend/.../hooks/useNegotiationParkAgreement.js` | **1,133** | Park-agreement flow for negotiation |
| `frontend/.../components/MainContent.jsx` | 1,036 | Negotiation body content |
| `frontend/.../components/NegotiationItemRow.jsx` | 942 | Per-row component |

So the honest health verdict is: **the chrome extension and Django backend are in reasonable shape; the React frontend's negotiation workspace is now the god-system.** The `SYSTEM_MAP` needs updating — four files on that list exceed 1,000 lines and are not acknowledged.

---

## 1. Root causes of the "threaded through everything" feeling

Seven patterns, from most to least painful.

### 1.1 The "triplicated marketplace" anti-pattern (🔴 critical)

Every feature that touches market research (eBay / Cash Converters / Cash Generator) is **copy-pasted three times** instead of expressed as data. This is the single biggest driver of bloat and change-friction.

Evidence, all exact:
- `negotiationHelpers.js` has parallel functions:
  - `applyEbayResearchToItem` / `applyCashConvertersResearchToItem` / `applyCashGeneratorResearchToItem` (~150 lines each)
  - `applyEbayResearchCommittedPricingToItem` / …CashConverters… / …CashGenerator…
  - `mergeEbayResearchDataIntoItem` / …CashConverters… / …CashGenerator…
  - `isNegotiationEbayWorkspaceLine` / …CashConvertersWorkspaceLine / …CashGeneratorWorkspaceLine
  - `offerMinMaxFromResearchBuyOffers` branches on platform
- `useAppStore.updateCartItemResearchData` has `if (type === 'ebay') / else if (type === 'cashConverters') / else if (type === 'cashGenerator') …` four times across the same function.
- `pricing/research_storage.py` exports **three different "compose"/"apply_partial_*" pairs** (raw_data / cash_converters / cg_data) — the same function conceptually, copied for each platform.
- `RequestItem` has **three separate backend fields** for the same data: `raw_data`, `cash_converters_data`, `cg_data` (grep shows 118 references across 14 files).
- Cart items carry four boolean tags: `isCustomEbayItem`, `isCustomCashConvertersItem`, `isCustomCashGeneratorItem`, `isCustomCeXItem` — **155 occurrences across 16 files**. Any time you add a marketplace, every one of those switch-cases breaks silently.
- Frontend forms: `EbayResearchForm.jsx` (12 lines), `CashConvertersResearchForm.jsx` (10), `CashGeneratorResearchForm.jsx` (9) — all shims around `ExtensionResearchForm.jsx` (1,489) and `ResearchFormShell.jsx` (1,981). The shell is a 2k-line god component because it internally branches on platform rather than taking a platform descriptor.

**Ideal:** a single `MarketplaceResearch` abstraction. One `MarketplaceDescriptor` per source (eBay/CC/CG/CeX) carrying: display name, URL builder, scrape strategy, normalisation rule, persistence key. Functions take `(item, descriptor, data)` instead of being triplicated. On the model side, `RequestItem` gets **one** `research_by_platform = JSONField` keyed by the descriptor id, replacing `raw_data`/`cash_converters_data`/`cg_data`. On the frontend, cart items get `item.source = 'ebay' | 'cex' | 'cg' | 'cc'` instead of four booleans.

This one change probably removes 2,000+ lines across the repo.

### 1.2 God components in the negotiation workspace (🔴 critical)

`Negotiation.jsx` (1,696 lines) orchestrates: routing, store subscription (**16 separate `useAppStore` calls**), research overlay, park agreement, jewellery sync, finalize, item handlers, lifecycle, marketplace search prefetch, and rendering. It imports **five separate hooks** (`useResearchOverlay`, `useNegotiationParkAgreement`, `useNegotiationJewelleryWorkspaceSync`, `useNegotiationFinalize`, `useNegotiationItemHandlers`, `useNegotiationLifecycle`, `useMarketplaceSearchPrefetch`) that each already run as 250–1,550-line files — yet the page itself is still 1.7k. The hooks are pseudo-modules: they share state through the store and through the `cartItem` shape, not through a clean interface.

**Ideal:** `Negotiation.jsx` is a ~150-line router-level shell. A `NegotiationController` object/context owns *all* item-mutation logic (backed by the store). Sub-components (`<NegotiationTables/>`, `<NegotiationModals/>`, `<NegotiationTotals/>`) subscribe to store slices and call controller methods — they do not each import the same 5 hooks. The 1,546-line `useNegotiationItemHandlers` becomes the controller.

### 1.3 Monolithic Zustand store (🟠 high)

`useAppStore.js` (1,184 lines, grew ~4x past SYSTEM_MAP estimate) mixes:

- Mode flags (`mode`, `repricingWorkspaceKind`, `repricingHomePath`, `repricingNegotiationPath`)
- Cart state (two parallel arrays: `cartItems`, `repricingCartItems`, dispatched through a private `_cartKey()`)
- Customer data
- Product catalogue state (`selectedCategory`, `availableModels`, `selectedModel`, `_modelsRequestId` — a manual race-condition guard)
- CeX product loading with a triple-scoped async flow (`handleAddFromCeX`)
- Offer-rule caches (`customerOfferRulesData`, `ebayOfferMargins`, `_ebayMarginsByCategory`)
- UI flags (`isCustomerModalOpen`, `isQuickRepriceOpen`, `headerWorkspaceOpen`, `headerWorkspaceMode`, `pendingBuilderTopCategoryId`, `jewelleryPickerOpenNonce`, `webEposWorkerClosedPrompt`, `closeHeaderWorkspaceTick`, `repricingWorkspaceNonce`, `pendingBuilderTopCategoryNonce`, `resetKey`)
- **Network calls** — the store directly imports 10+ `api.js` functions and also `extensionClient`, `aiCategoryPathCascade`, `researchPersistence`. That makes the store a *side-effect engine* rather than state.
- **Bespoke per-field persistence logic** — `updateCartItemOffers`, `setTransactionType`, and `resetBuyer` each reimplement "convert manualOffer/ourSalePrice from `£1,234.50` string to normalized decimal, build payload, call updateRequestItemOffer()". That code appears ~4 times inside this single file.

Several "nonce / tick" counters (`closeHeaderWorkspaceTick`, `repricingWorkspaceNonce`, `jewelleryPickerOpenNonce`, `pendingBuilderTopCategoryNonce`) are ad-hoc event channels — classic signs the state model is fighting React.

**Ideal:** three small stores with explicit boundaries:
- `useWorkspaceStore` — mode, route paths, workspace header state.
- `useCartStore` — the cart (single array, not two — see 1.4), customer, intent, request.
- `useUiStore` — modals, nonces.

Async lifecycles (`handleAddFromCeX`, `selectCategory`, `selectCartItem`) move to **plain async functions** in a `negotiationActions.js` module that receives the store instance. Tests can call them directly. The store stops importing network modules. Event channels (`*Nonce`, `*Tick`) become proper UI intents dispatched through context or replaced with imperative refs where one-shot.

### 1.4 "Repricing is buyer+1 with a mode switch" (🟠 high)

The store carries **two cart arrays** (`cartItems` + `repricingCartItems`). Every mutation is routed through `_cartKey()` which reads `mode` from the store. Every consumer selector has `s.mode === 'repricing' ? s.repricingCartItems : s.cartItems`. This pattern leaks into:
- Selectors (`useCartItems`, `useSelectedCartItem`, `useOfferTotals`).
- API layer (`saveRepricingSession` + `saveUploadSession` are duplicate endpoints because of this split — see 1.5).
- Persistence (`RepricingSession`, `RepricingSessionItem`, `UploadSession`, `UploadSessionItem` models inherit from `AbstractStockSessionLine` and duplicate each other).
- URL paths (`repricingHomePath` / `repricingNegotiationPath` stored *in the store* per mode).

**Ideal:** one `Workspace` concept with a `kind: 'buyer' | 'reprice' | 'upload'`. One cart. One session model (`Session(kind, …)`). A workspace descriptor drives routes, copy, backend endpoint. The mode/path/kind triangle collapses into a single lookup.

### 1.5 "Every feature needs a new api.js wrapper + a new extensionClient wrapper" (🟠 high)

`services/api.js` is 560 lines of ~35 near-identical one-liner wrappers plus ad-hoc session-scope caches for NosPos and CG categories implemented by hand (`_nosposCategoriesPayload`, `_nosposCategoriesInflight`, hoisted *below* their first use — `fetchNosposCategoryMappings` at line 482 reads `_nosposMappingsPayload` declared at line 511; it works only because `let` hoists but is a lurking footgun).

`services/extensionClient.js` is 543 lines of ~40 identical `sendMessage({ action: 'kebab-name', ...payload })` wrappers. Each one:
1. Matches a per-action file in `chrome-extension/flows/bridge/actions/` (43 of them).
2. Matches a row in `chrome-extension/flows/bridge/actions/registry.js`.
3. Matches an `importScripts` entry in `background.js`.

Adding one extension action = touching 4 files minimum. Many of those action files are themselves 10-line pass-throughs (e.g. `cancelRequest`, `clearLastRepricingResult`, `getNosposTabUrl`).

**Ideal on the frontend:**
- `api.js` becomes `api/{resource}.js` — one file per resource (`requests`, `repricing`, `catalogue`, `nospos`, etc.). The `apiFetch` helper stays shared.
- Use a library-level cache for the few session-scoped payloads (React Query, or a tiny 20-line `memoizeOncePerSession`) rather than four handwritten cache pairs.

**Ideal on the extension:** the registry *is* the public API. Delete the 40 `extensionClient.js` wrappers and expose a single `callExtension(action, payload, options)`. Frontend callers pass the action name as a string constant. Most of the current per-action files (the 10-line ones) should merge into their domain file — `flows/nospos-repricing.js` owns all repricing actions, `flows/webepos.js` owns all WebEPOS actions, etc. "One file per action" sounds modular but is fragmentation — adding or renaming an action requires editing 3 files.

### 1.6 The god utility file: `negotiationHelpers.js` (🔴 critical)

At **2,387 lines** it is now larger than most Django apps. Grep shows 26 exports from it and 26 imports in `Negotiation.jsx` alone. It contains platform-resolution logic, offer math, research persistence logic, marketplace-specific mergers, price rounding, total calculators, customer expectation header keys, and line-type predicates. This is where the triplication from §1.1 lives.

**Ideal:** split into ~6 focused modules:
- `negotiation/offerMath.js` (total calculators, offer min/max).
- `negotiation/lineTypes.js` (predicates: `isJewelleryLine`, `isCexLine`, `isMarketplaceLine(descriptor)`).
- `negotiation/research.js` (the apply/merge functions — but *one* implementation per operation, parameterised by marketplace descriptor — see 1.1).
- `negotiation/salePrice.js` (`resolveOurSalePrice`, `resolveSuggestedRetailFromResearchStats`, price rounding).
- `negotiation/customerExpectation.js` (header keys, aggregation).
- Everything jewellery → already has its own `components/jewellery/`; move jewellery helpers there.

### 1.7 Persistence-inside-UI (🟠 high)

Offer-field persistence is handwritten in at least four places: `updateCartItemOffers`, `setTransactionType`, `resetBuyer`, and again inside `useNegotiationItemHandlers`. Each copy does:
```
- parseFloat(String(value).replace(/[£,]/g, ''))
- if !isNaN && > 0: normalizeExplicitSalePrice(parsed)
- build { selected_offer_id, manual_offer_used, manual_offer_gbp, our_sale_price_at_negotiation, cash_offers_json, voucher_offers_json } payload
- updateRequestItemOffer(id, payload).catch(console.error)
```
This is both the main driver of bugs ("why didn't the offer persist?") and the main reason the store is so big.

**Ideal:** **one** function — `persistItemOffer(item, patch)` — that takes the UI-shape patch and returns the backend-shape payload. Call it from exactly one place in the store. Never format money in three places.

---

## 2. Backend pain points

The Django side is in the best shape of the three subsystems, but there are still specific issues:

### 2.1 `pricing/models_v2.py` — one file, 41 classes (🟠 high)

- Rename now — `_v2` has no `v1` counterpart and the suffix misleads readers. Do it in one PR with `git mv`, one import sweep, no model table rename.
- Split into 8 modules by domain:
  - `models/catalogue.py` — Category, CGCategory, Manufacturer, Product, Attribute, AttributeValue, ConditionGrade, Variant, VariantAttributeValue, VariantPriceHistory
  - `models/inventory.py` — Location, VariantInventory, InventoryUnit, VariantStatus, InventoryOwnershipEvent
  - `models/customer.py` — Customer, CustomerRuleSettings, CustomerOfferRule, Agreement, TradeIn
  - `models/pricing_rules.py` — PricingRule
  - `models/request.py` — Request, RequestItem, RequestItemOffer, RequestStatusHistory, RequestStatus, RequestIntent
  - `models/jewellery.py` — RequestItemJewellery, RequestItemJewelleryValuation, RequestJewelleryReferenceSnapshot, InventoryUnitJewellery
  - `models/sessions.py` — RepricingSession/Item, UploadSession/Item, AbstractStockSessionLine, MarketResearch* (or split research into its own file)
  - `models/nospos.py` — NosposCategoryMapping, NosposCategory, NosposField, NosposCategoryField
- `models/__init__.py` re-exports everything — zero call-site changes.

### 2.2 `PricingRule` is 9 columns that should be 2 tables (🟡 medium)

`PricingRule` has fields split into two conceptual clusters that are always edited together but have nothing to do with each other:
- Buy-pricing (`sell_price_multiplier`, `first_offer_pct_of_cex`, `second_offer_pct_of_cex`, `third_offer_pct_of_cex`)
- eBay/CC sell-margin (`ebay_offer_margin_1_pct` … `ebay_offer_margin_4_pct`)

The eBay margin set is the **4 offer tier margins** that belong in a `MarketplaceOfferMarginRule` table — matching the "descriptor per marketplace" idea in §1.1. It would also let CG and (future) other platforms have per-marketplace margins without four more columns per marketplace on `PricingRule`.

SYSTEM_MAP claims `PricingRule` has "30+ fields" and `CustomerRuleSettings` has "70" — both are wrong (9 and 6 respectively). Update or delete that section of the map.

### 2.3 Weird top-level files (🟡 medium)

`pricing/` has `ai_views.py` (226 lines) at the top level while every other view lives in `pricing/views/`. It should be `pricing/views/ai.py`. Same for `offer_rows.py` (156, belongs in `services/`), `research_storage.py` (771, belongs in `services/` or split into `services/research/{ebay,cc,cg,jewellery}.py`), `buying_decimal.py` (26, belongs in `utils/`).

### 2.4 `research_storage.py` at 771 lines (🟠 high)

One file covering: eBay listings + stats + drill levels + advanced filter state, Cash Converters listings + drill levels, Cash Generator variant. Per §1.1 the single biggest win is collapsing eBay/CC/CG into one parameterised persistence function — this file would go from 771 to ~300.

### 2.5 `views/_shared.py` is a smell (🟡 medium)

`_shared.py` (277 lines) contains utilities used by 5+ view modules. Leading underscores + shared mutable helpers signal "we split a god file but the seams aren't clean." `_sync_request_jewellery_reference_snapshot` belongs in `services/request_service.py` (it already calls it). `_create_stock_session_line_from_payload` + its two wrappers belong in a new `services/session_service.py`. `_resolve_cex_sku_to_variant` belongs in `services/request_service.py`.

Once drained, `_shared.py` probably shrinks to 50 lines of genuinely cross-domain helpers or goes away entirely.

### 2.6 80 migrations (🟡 medium, defer)

80 migrations for an app that hasn't hit prod yet is fine, but at prod it's worth a `makemigrations --squash` run to collapse the first 70 into one. Not urgent.

### 2.7 `views/__init__.py` re-export layer (🟡 low)

`views/__init__.py` re-exports every view function so `pricing/urls.py` can do `from pricing.views import requests_view`. This lets you move functions between modules without touching `urls.py` — but the trade-off is that a view can be renamed/removed and `urls.py` won't tell you. Prefer explicit imports in `urls.py` (`from pricing.views.requests import requests_view as v_requests`). Small change, big clarity win.

---

## 3. Chrome extension pain points

The extension is the *most* structurally sound subsystem. The recent refactor worked. Remaining issues:

### 3.1 Fragmentation as faux-modularity (🟠 high)

43 files in `flows/bridge/actions/` where many are 10–15-line pass-throughs. `close-nospos-park-agreement-tab.js`, `clear-last-repricing-result.js`, `get-nospos-tab-url.js` — these are one-line delegates. The fragmentation *costs* more than the god file did: adding an action now needs 3 file edits (action file + registry + importScripts) and the jump-to-definition path is three levels deep.

**Ideal:** merge action files into domain bundles:
- `flows/bridge/actions/nospos-repricing.js` — the 4 repricing actions.
- `flows/bridge/actions/nospos-park.js` — the ~10 park actions.
- `flows/bridge/actions/webepos.js` — the 7 WebEPOS actions.
- `flows/bridge/actions/listings.js` — start-waiting-for-data / start-refine / cancel / scrape-cex-super-categories.
- Keep one file per "genuinely large" action (e.g. `start-waiting-for-data.js` is fine at 45 lines but doesn't need its own file).

Target: 43 action files → 6 domain bundles. Registry shrinks to ~6 spread-imports. `background.js`'s importScripts list becomes 15 lines instead of 60.

### 3.2 `bg/` vs `sdk/` vs `bootstrap/` — three "primitives" layers (🟡 medium)

`background.js` loads `bg/park-log.js`, `bg/tab-utils.js`, `bg/nospos-url-utils.js`, `bg/nospos-html.js`, then `sdk/park-ui.js`, `sdk/nospos-tab-open.js`, `sdk/nospos-recovery.js`, then `bootstrap/constants.js`, `bootstrap/listeners.js`. The rules for "what goes in bg vs sdk" are invisible. SYSTEM_MAP even notes that `bg/` "kept here by history." Merge `bg/*` into `sdk/*` and drop the `bg/` directory. `bg.deprecated/` should be deleted entirely — 16 dead files.

### 3.3 Cohesive giants that *should* stay monoliths (🟢 fine)

`content-nospos.js` (1,549) and `content-nospos-agreement-fill.js` (1,207) are single-domain state machines. Splitting them into micro-files would scatter the closure state and make them harder to read. Leave them alone. The SYSTEM_MAP already says this correctly.

### 3.4 Handler router is clean but verbose (🟡 low)

`handlers/router.js` is 17 near-identical `if (message.type === 'X') { handle(...).then(sendResponse).catch(...); return true; }` blocks. Convert to a `MESSAGE_HANDLERS` map like the bridge registry — the code that follows is already structurally identical.

---

## 4. Frontend pain points (beyond the store & negotiation god-files)

### 4.1 Unnecessary module hops (🟠 high)

`EbayResearchForm.jsx`, `CashConvertersResearchForm.jsx`, `CashGeneratorResearchForm.jsx` are each 9–12-line shims that re-export `ExtensionResearchForm` with a platform prop. Inline them into callers — or delete the shims and import `ExtensionResearchForm` with `platform="ebay"` directly. Same for the three `*CartItemView.jsx` (41-72 lines each) — they're near-identical; one `<MarketplaceCartItemView source={…}/>` covers all three.

### 4.2 listWorkspace / "list workspace" duplication (🟠 high)

`pages/buyer/listWorkspace/*` is a second implementation of buyer workspace logic: `useListWorkspaceNegotiation.jsx`, `useListWorkspaceNegotiationBootstrap.js`, `useListWorkspaceNegotiationPersistence.js`, `useListWorkspaceRepricingCompletion.js`, `ListWorkspaceNegotiation.jsx`. These mirror the main negotiation stack with different names. This is exactly the situation §1.4 describes — "repricing is buyer + mode switch" — bolted on as a separate hierarchy because the original `Negotiation.jsx` couldn't absorb it cleanly.

**Ideal:** when the workspace descriptor model from §1.4 lands, delete `listWorkspace/` and fold its needs into the main negotiation stack as a workspace variant.

### 4.3 `aiCategoryPathCascade.js` is 707 lines (🟡 medium)

Does heuristic + AI category matching against backend category trees. Large but coherent. Lower priority than anything else. If you touch it, pull the "retry/fallback ladder" out as data.

### 4.4 Tests (🟠 high, meta)

Zero frontend tests (confirmed: no `*.test.*`, no `__tests__/` directories). Given the store is a side-effect engine and `useNegotiationItemHandlers` is 1,546 lines, there is *no* safe way to refactor without at minimum unit tests on `negotiationHelpers.js` pure functions. Before starting any of §1.1 / §1.2 / §1.3, add Vitest + RTL and cover the 10-15 functions that every refactor will touch first.

### 4.5 Scattered constants (🟡 low)

`OPEN_NOSPOS_SITE_CATEGORY_TIMEOUT_MS`, `OPEN_NOSPOS_SITE_FIELD_TIMEOUT_MS`, `OPEN_NOSPOS_BULK_CATEGORY_FIELDS_TIMEOUT_MS`, `WEB_EPOS_UPLOAD_CLIENT_TIMEOUT_MS`, `OPEN_NOSPOS_NEW_AGREEMENT_ITEMS_TAB_TIMEOUT_MS`, `OPEN_NOSPOS_PROFILE_CLIENT_TIMEOUT_MS` — all declared mid-file in `extensionClient.js`. Move to a single `services/extensionTimeouts.js` (or per-domain when the extensionClient is split).

---

## 5. The ideal architecture, end-to-end

A feature in the ideal architecture touches **at most 3 files** per domain layer.

### 5.1 Backend

```
pricing/
  models/
    catalogue.py
    inventory.py
    customer.py
    pricing_rules.py
    request.py
    jewellery.py
    sessions.py
    nospos.py
    market_research.py
    __init__.py            # re-exports
  views/
    requests.py            # thin controllers only
    repricing.py
    uploads.py
    pricing_rules.py
    catalogue.py
    customers.py
    market_research.py
    market_stats.py
    nospos.py
    integrations.py
    ai.py                  # moved from pricing/ai_views.py
  services/
    request_service.py
    session_service.py     # absorbs _shared session-line helpers
    offer_engine.py
    offer_rows.py          # moved from pricing/
    ai_category.py
    cex_client.py
    research/
      __init__.py          # public apply_partial / compose APIs
      marketplace.py       # ONE implementation parameterised by descriptor
      jewellery.py         # normalised jewellery persistence
      descriptors.py       # Ebay/CC/CG/CeX descriptor objects
  serializers/
    request.py
    catalogue.py
    …                      # split mirror of models/
  utils/
    parsing.py
    money.py               # moved from pricing/buying_decimal.py
    decorators.py
    marketplace.py
    ebay_filters.py
    cashconverters_filters.py
    category_tree.py
  urls.py                  # explicit imports from pricing.views.X
```

No `_shared.py`. No top-level stragglers. No `_v2` suffix. View → service → model is a straight line with no helper modules in between.

### 5.2 Frontend

```
src/
  api/
    http.js                # shared apiFetch + CSRF + session cache helper
    requests.js
    repricing.js
    uploads.js
    catalogue.js
    customers.js
    pricingRules.js
    nospos.js
    marketResearch.js
  extension/
    client.js              # ONE callExtension(action, payload, opts)
    timeouts.js
    constants.js           # action name string constants
  marketplace/
    descriptors.js         # { ebay, cashConverters, cashGenerator, cex } — URL builders, labels, keys, form config
    research.js            # single apply/merge logic parameterised by descriptor
  store/
    workspace.js           # mode, kind, routes, header state
    cart.js                # one cart, one customer, one request
    ui.js                  # modals, nonces
    selectors.js           # cross-slice selectors
  negotiation/
    controller.js          # from useNegotiationItemHandlers — all item mutations
    offerMath.js
    salePrice.js
    lineTypes.js
    customerExpectation.js
    persistItemOffer.js    # THE ONE place offer persistence lives
  pages/
    buyer/
      Negotiation.jsx      # ~150 lines, wires controller to subviews
      ...
    repricing/...          # thin variants that pass kind='reprice'
    upload/...             # thin variants that pass kind='upload'
  components/
    forms/
      ResearchFormShell.jsx   # receives a MarketplaceDescriptor — one form, four marketplaces
    ...
```

### 5.3 Extension

```
chrome-extension/
  background.js            # bootstrap + importScripts (~40 lines)
  bootstrap/
    constants.js
    listeners.js
  sdk/                     # (bg/ merged in; tab-utils, park-ui, nospos-*, jewellery-scrap primitives)
  flows/
    nospos-park/           # unchanged
    nospos-repricing/      # unchanged
    webepos/               # unchanged
    bridge/
      core.js
      forward.js
      actions/
        nospos-repricing.js     # all 4 repricing actions
        nospos-park.js          # all ~10 park actions
        nospos-admin.js         # site/field/category sync
        webepos.js              # all 7 WebEPOS actions
        listings.js             # start-waiting / start-refine / cancel / cex-super-categories
        misc.js                 # open-url, jewellery-scrap, customer-intake
        registry.js             # maps action name → handler
  handlers/
    router.js              # MESSAGE_HANDLERS table
    listing.js
  content-*.js             # content scripts unchanged (cohesive state machines)
  shared/
```

---

## 6. Per-file refactoring advice

File-specific, ordered by impact. Each row: what to do, why, how.

| # | File | Severity | Advice |
|---|---|:---:|---|
| 1 | `frontend/.../utils/negotiationHelpers.js` (2,387) | 🔴 | Split into `offerMath`, `salePrice`, `lineTypes`, `research`, `customerExpectation`. Collapse triplicated `applyEbay/CC/CG` functions into one marketplace-descriptor-driven pair. Target: 6 files, each ≤ 400 lines. |
| 2 | `frontend/.../pages/buyer/Negotiation.jsx` (1,696) | 🔴 | Extract a `NegotiationController` (absorb `useNegotiationItemHandlers`). Reduce direct store subscriptions from 16 to ≤ 5 by introducing a single `useNegotiation()` selector. Push JSX into already-existing sub-components. Target: ≤ 250 lines. |
| 3 | `frontend/.../components/forms/ResearchFormShell.jsx` (1,981) | 🔴 | Replace internal `platform ===` branches with a `MarketplaceDescriptor` prop. Delete `EbayResearchForm.jsx`, `CashConvertersResearchForm.jsx`, `CashGeneratorResearchForm.jsx` shims. Target: ≤ 800 lines. |
| 4 | `frontend/.../components/forms/ExtensionResearchForm.jsx` (1,489) | 🔴 | Same treatment as ResearchFormShell — strip per-platform branches. Target: ≤ 600 lines. |
| 5 | `frontend/.../hooks/useNegotiationItemHandlers.js` (1,546) | 🔴 | Becomes `negotiation/controller.js`. Each handler should be a pure function receiving `(ctx, args)` so it's testable without React. Break the 1.5k lines into grouped modules by concern (offer changes, research, category, finalize). |
| 6 | `frontend/.../store/useAppStore.js` (1,184) | 🔴 | Split into `workspace.js`, `cart.js`, `ui.js`. Move async flows (`handleAddFromCeX`, `selectCategory`, `selectCartItem`, `resetBuyer`) into `negotiation/actions.js`. Introduce `persistItemOffer.js` and call it from exactly one place. Remove all 5 "nonce/tick" counters in favour of explicit UI intent functions. |
| 7 | `frontend/.../hooks/useNegotiationParkAgreement.js` (1,133) | 🔴 | Coherent but huge. Split into `parkAgreement/bootstrap.js`, `parkAgreement/items.js`, `parkAgreement/progress.js`, `parkAgreement/duplicate.js`. |
| 8 | `frontend/.../components/MainContent.jsx` (1,036) | 🟠 | Large because it's directly subscribed to too many store slices (26 `isCustomEbay/CC/CG/CeXItem` checks). Once cart items carry `source`, this drops substantially. Split into per-workspace-kind renderers. |
| 9 | `frontend/.../components/NegotiationItemRow.jsx` (942) | 🟠 | Heavy conditional rendering by `source`. After §1.1, swap internal switches for a small `<ItemRow source={…}>` registry. |
| 10 | `pricing/models_v2.py` (2,134) | 🟠 | Rename to `models/__init__.py`, split into 8 domain files (see §5.1). Pure `git mv`, no schema change. |
| 11 | `pricing/research_storage.py` (771) | 🟠 | Move to `services/research/`. Collapse ebay/cc/cg persistence into one function taking a marketplace descriptor. Target: ~300 lines. |
| 12 | `pricing/admin.py` (889) | 🟡 | Split `admin/` by model domain (admin/request.py etc.). |
| 13 | `pricing/serializers.py` (537) | 🟡 | Split mirror of models split. |
| 14 | `pricing/views/_shared.py` (277) | 🟡 | Drain contents into `services/request_service.py` + `services/session_service.py`. Delete file. |
| 15 | `pricing/services/ai_category.py` (524) | 🟡 | Cohesive (Groq + Gemini fallback ladder). Keep, but extract the "retry ladder" as data so adding a third provider is a config change. |
| 16 | `pricing/ai_views.py` (226) | 🟡 | Move to `pricing/views/ai.py`. |
| 17 | `pricing/offer_rows.py` (156) | 🟡 | Move to `pricing/services/offer_rows.py`. |
| 18 | `pricing/buying_decimal.py` (26) | 🟡 | Move to `pricing/utils/money.py`. |
| 19 | `frontend/.../services/api.js` (560) | 🟠 | Split by resource into `api/{resource}.js`. Move the NosPos/CG session caches into a `memoizeForSession` util. |
| 20 | `frontend/.../services/extensionClient.js` (543) | 🟠 | Replace 40 wrappers with `callExtension(actionName, payload, opts)`. Export action name constants. Delete the 10-line bridge action files that have no logic. |
| 21 | `chrome-extension/flows/bridge/actions/*.js` (43 files) | 🟠 | Merge into 6 domain bundles. Delete `bg.deprecated/` (16 files). |
| 22 | `chrome-extension/bg/*` | 🟡 | Merge into `sdk/`. |
| 23 | `chrome-extension/handlers/router.js` (176) | 🟡 | Convert if-else chain into `MESSAGE_HANDLERS` table (same pattern the bridge already uses). |
| 24 | `frontend/.../pages/buyer/listWorkspace/*` | 🟠 | Delete after §1.4 lands — fold into main negotiation with `workspaceKind='reprice'|'upload'`. |
| 25 | SYSTEM_MAP.md | 🟡 | Remove the false "all P0/P1 done ✅" claims. Update line counts. The map is currently an obstacle — new contributors believe the health verdict. |

---

## 7. Recommended order of operations

Each step is independently shippable and each enables the next.

1. **Add tests** for the pure functions in `negotiationHelpers.js` and `offer_engine.py` (Vitest + pytest). Nothing below is safe without them.
2. **Introduce `MarketplaceDescriptor`** (one object per marketplace, shared by frontend + backend via a constants file). Migrate one consumer (e.g. `NegotiationItemRow`) to use it. Delete one of the three triplicate apply-research helpers. Ship.
3. **Introduce `persistItemOffer`** and refactor the store's four offer-payload-building sites to call it. Ship.
4. **Split the store** into `workspace`, `cart`, `ui`. Keep a shim re-export of `useAppStore` for a release so old imports still work.
5. **Extract `NegotiationController`** and shrink `Negotiation.jsx`.
6. **Split `negotiationHelpers.js`** into 6 modules.
7. **Unify `cartItems`/`repricingCartItems`** behind one `Workspace.cart` and retire `listWorkspace/`.
8. **Collapse per-marketplace backend fields** (`raw_data`/`cash_converters_data`/`cg_data` → `research_by_platform`) via data migration.
9. **Rename `models_v2.py` → `models/`** with domain split.
10. **Merge extension bridge-action files** into domain bundles.

---

## 8. What a new feature *should* look like (ideal state)

**"Add a 4th marketplace (e.g. Gumtree)":**

1. Add `{ id: 'gumtree', label: 'Gumtree', …url builder… }` to `marketplace/descriptors.js` (frontend) and `services/research/descriptors.py` (backend).
2. Add a Chrome extension content script for Gumtree scraping.
3. Done.

**Not done:** 200+ lines of `applyGumtreeResearchToItem` / `isNegotiationGumtreeWorkspaceLine` / `isCustomGumtreeItem` / a 4th model field / a 4th `ExtensionResearchForm` shim.

**"Add a new negotiation action (e.g. 'Flag for review')":**

1. Add a method to `NegotiationController`.
2. Add a button in `NegotiationItemRow` that calls it.
3. If it persists, add one row to `persistItemOffer` or a new `persistItemAction` helper.

**Not done:** touch 8 files across the store + 3 hooks + an api wrapper + an extensionClient wrapper + a bridge action file + a registry + a background importScripts list.

---

## 9. What *not* to refactor

To stay honest: these are large but fine as they are.

- `chrome-extension/content-nospos.js` (1,549) — cohesive state machine.
- `chrome-extension/content-nospos-agreement-fill.js` (1,207) — cohesive single flow.
- `pricing/services/request_service.py` (450) — actually well-structured; this is the reference example of "how a service should look."
- `pricing/services/ai_category.py` (524) — domain-cohesive.
- `pricing/migrations/` — leave the 80 migrations alone until prod.

The test of "is it healthy" is not line count — it's *how many unrelated files you touch to change behaviour*. Those five rank low on that test.

---

## 10. Summary of what's really broken

1. **Triplication across eBay / Cash Converters / Cash Generator** is the biggest single source of complexity. Killing it removes thousands of lines across frontend + backend + extension.
2. **The frontend is now the god system**, not the backend or extension. `Negotiation.jsx`, `negotiationHelpers.js`, `useNegotiationItemHandlers.js`, `ResearchFormShell.jsx`, `ExtensionResearchForm.jsx`, and `useAppStore.js` together are ~10,000 lines of tangled logic.
3. **"Repricing = buyer + flag"** has leaked into the store, api, models, and routes. Unifying under a `Workspace` descriptor unblocks the `listWorkspace` deletion.
4. **Persistence logic is handwritten in 4+ places.** One `persistItemOffer` function deletes most of the subtle bugs.
5. **The chrome extension's 43 bridge-action files are faux-modularity.** Six domain bundles replace them and halve the per-feature edit count.
6. **Backend is mostly fine** — the biggest backend win is renaming `models_v2.py` and splitting it by domain, plus moving top-level stragglers (`ai_views.py`, `offer_rows.py`, `research_storage.py`, `buying_decimal.py`) into their proper homes.
7. **SYSTEM_MAP.md is stale and misleadingly optimistic.** It should be updated to reflect this document, or deleted.
