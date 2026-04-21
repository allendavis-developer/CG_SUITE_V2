# CG Suite V2 — System Map

> **Purpose:** High-level documentation of how the entire codebase fits together, what is healthy, and a prioritized refactor backlog.
>
> **Last major refactor (2026-04-21):** every P0 and every P1 item from the earlier backlog has now been applied. The god files are gone, the Chrome extension is SDK-style modular, the views are thin controllers, and the repo no longer tracks binary bloat. See §10 for the change log.

---

## 1. Executive Summary

CG Suite V2 is a **B2B pricing / buying / repricing platform** for a second-hand retail chain. Three cooperating systems:

| System | Stack | Role |
|---|---|---|
| **Django backend** (`cashgen/`, `pricing/`) | Django 5.2.6, DRF, SQLite | REST API, models, admin, AI integrations (Groq / Gemini), external-API clients (CEX / eBay / CashConverters / Ideal Postcodes) |
| **Frontend** (`frontend/vite-project/`) | React 19 + Vite 7, Zustand, Tailwind 4, shadcn/ui, React Router 7 | Single-page app served inside Django. Negotiation / repricing / upload workflows, launchpad, reports, pricing-rule admin |
| **Chrome extension** (`chrome-extension/`) | MV3 service worker + content scripts | Scrapes competitor listings (eBay, CashConverters, CashGenerator, CeX), drives NosPos (POS partner) and WebEPOS (CashGenerator inventory), bridges data to the React app |

**Health at a glance (post-refactor):**

| Area | Size | Verdict |
|---|---|---|
| `chrome-extension/background.js` | **99 lines** (bootstrap only) | 🟢 Was 6,165 lines before refactor |
| `chrome-extension/flows/bridge/forward.js` | **28 lines** dispatcher | 🟢 Was 1,139 lines; 43 actions each in their own file |
| `chrome-extension/content-listings.js` | 881 lines (runtime + per-site configs) | 🟢 Was 1,726 lines; eBay-only helpers moved to `shared/listings/` |
| `pricing/views/requests.py` | 358 lines (thin controllers) | 🟢 Was 900 lines; business logic in `pricing/services/request_service.py` |
| `pricing/models_v2.py` | 2,134 lines, 41 classes | 🟠 Coherent but `PricingRule` + `CustomerRuleSettings` still bloated |
| React frontend | 173 JSX files | 🟢 Well-structured; monolithic Zustand store is the main smell |
| Committed binaries | — | 🟢 `db.sqlite3`, `python/`, `get-pip.py`, duplicate `static/assets/` untracked |

---

## 2. Repository Layout

```
CG_SUITE_V2/
├── cashgen/                            Django project (settings, urls, wsgi)
├── pricing/                            Main Django app
│   ├── models_v2.py                    41 model classes (unchanged)
│   ├── admin.py                        List_display / search_fields config
│   ├── serializers.py                  DRF serializers
│   ├── research_storage.py             Market-research payload normalization
│   ├── ai_views.py                     Groq / Gemini suggestion endpoints
│   ├── services/
│   │   ├── ai_category.py              Groq (primary) + Gemini (fallback) LLM
│   │   ├── cex_client.py               SKU → box-detail lookup
│   │   ├── offer_engine.py             Offer tier + rounding
│   │   └── request_service.py          ← NEW: Request lifecycle business logic
│   ├── views/
│   │   ├── __init__.py                 Re-exports for pricing.urls
│   │   ├── _shared.py                  Cross-domain helpers
│   │   ├── requests.py                 Request CRUD — thin controllers calling request_service
│   │   ├── repricing.py                RepricingSession + quick-reprice
│   │   ├── uploads.py                  UploadSession
│   │   ├── pricing_rules.py            Pricing / customer rules / eBay margins
│   │   ├── market_stats.py             variant_prices + cex_product_prices
│   │   ├── catalogue.py                Categories / products / variants
│   │   ├── customers.py                Customer CRUD
│   │   ├── market_research.py          eBay / CashConverters fetchers
│   │   ├── integrations.py             React shell, address lookup, CG scraper
│   │   └── nospos.py                   NosPos category / field / mapping sync
│   ├── utils/                          filters, parsers, decorators
│   ├── management/commands/            import_cex_data, import_nospos_*, etc.
│   └── migrations/                     79 migrations
├── frontend/vite-project/              React SPA
│   ├── src/pages/                      buyer/, launchpad/, pricing/, reports/
│   ├── src/components/                 ui (shadcn), forms, modals, negotiation, nospos, jewellery, pickers
│   ├── src/services/                   api.js, extensionBridge.js, extensionClient.js, aiCategoryService.js
│   └── src/store/                      useAppStore.js (monolithic Zustand store)
├── chrome-extension/                   MV3 extension — FULLY MODULAR
│   ├── manifest.json
│   ├── background.js                   99-line bootstrap (importScripts only)
│   │
│   ├── bootstrap/                      ── 1. Top-level state + event listeners ──
│   │   ├── constants.js                Shared constants + state Maps
│   │   └── listeners.js                chrome.tabs.* event listeners (loaded last)
│   │
│   ├── sdk/                            ── 2. Primitives — reusable, no domain deps ──
│   │   ├── park-ui.js                  Park-overlay / duplicate-prompt helpers
│   │   ├── nospos-tab-open.js          openBackgroundNosposTab, openNosposParkAgreementTab
│   │   └── nospos-recovery.js          429 recovery, tab-complete waits, retry messaging
│   │
│   ├── bg/                             ── 2a. SDK primitives (kept here by history) ──
│   │   ├── park-log.js
│   │   ├── tab-utils.js                waitForTabLoadComplete, focusAppTab, etc.
│   │   ├── nospos-url-utils.js         URL builders
│   │   ├── nospos-html.js              HTML parsers
│   │   ├── webepos-new-product-fill-page.js   INJECTED into WebEPOS page (MAIN world)
│   │   └── webepos-edit-product-fill-page.js  INJECTED into WebEPOS page (MAIN world)
│   │
│   ├── flows/                          ── 3. Composed workflows ──
│   │   ├── nospos-park/
│   │   │   ├── agreement-scrape.js     Line lookup, snapshot, delete excluded lines
│   │   │   ├── tab-state.js            Park-tab closed tracking + duplicate-choice
│   │   │   └── agreement-fill.js       Click / fill / orchestrate (701 lines)
│   │   ├── nospos-repricing/
│   │   │   ├── storage.js              Session state + status broadcast
│   │   │   ├── orchestration.js        findNextBarcode, finalize, ambiguous handling
│   │   │   └── page-handlers.js        Page-ready / stock-search / stock-edit / loaded
│   │   ├── webepos/
│   │   │   ├── upload-session.js       Session state + worker-tab lifecycle
│   │   │   ├── scrape.js               Products-table scrape (MAIN-world injection)
│   │   │   ├── product-forms.js        Inject new-/edit-product fill scripts
│   │   │   └── watch-upload.js         Watch worker tab + notify app
│   │   └── bridge/
│   │       ├── core.js                 clearPendingRequest, notifyApp, dataImport
│   │       ├── forward.js              ← 28-line dispatcher
│   │       └── actions/                ← 43 files, one per BRIDGE_FORWARD action
│   │           ├── registry.js             BRIDGE_ACTIONS map
│   │           ├── start-waiting-for-data.js   (45 lines)
│   │           ├── scrape-cex-super-categories.js
│   │           ├── cancel-nospos-repricing.js
│   │           ├── open-nospos-and-wait.js
│   │           ├── … 39 more
│   │           └── start-refine.js
│   │
│   ├── handlers/                       ── 4. chrome.runtime.onMessage surface ──
│   │   ├── listing.js                  LISTING_PAGE_READY + SCRAPED_DATA
│   │   └── router.js                   Single onMessage listener dispatching to flows
│   │
│   ├── content-bridge.js               localhost ↔ extension bridge (102 lines)
│   ├── content-listings.js             Listing-scraper runtime (881 lines)
│   ├── shared/listings/
│   │   ├── ebay-filters.js             ← NEW: eBay filter + sort enforcement (405 lines)
│   │   └── ebay-customize.js           ← NEW: Customise dialog + overlay (472 lines)
│   ├── content-nospos.js               NosPos page-state detector
│   ├── content-nospos-agreement-fill.js Form-fill automation
│   ├── content-jewellery-scrap-prices.js
│   ├── shared/                         dom-utils, constants, nospos-park-overlay
│   ├── cex-scrape/                     CeX nav scrape
│   ├── jewellery-scrap/                Jewellery scrape constants + worker session
│   ├── tasks/                          Lazy-imported small helpers
│   └── bg.deprecated/                  16 stale drifts — safe to delete
│
├── static/frontend/assets/             Authoritative build output (tracked)
├── templates/                          Django admin overrides
├── build.sh / build.bat                Vite build + copy + rewrite react.html hashes
├── run.bat
├── runtime.txt                         Python 3.13.5
└── requirements.txt                    Django, DRF, playwright, openai, groq, google-genai, whitenoise, gunicorn, aiohttp, bs4
```

Files **no longer tracked** (still present on disk, now `.gitignore`d): `db.sqlite3`, `get-pip.py`, `python/*` (bundled Windows runtime), `static/assets/` (duplicate build output).

---

## 3. Architecture & Data Flow

```
┌─────────────────────┐   window.postMessage   ┌────────────────────────┐
│   React SPA         │ ◀════════════════════▶│ content-bridge.js      │
│   (localhost:8000)  │                       │ (injected on app origin)│
└─────────┬───────────┘                       └──────────┬─────────────┘
          │ fetch /api/*                                 │ chrome.runtime.sendMessage
          │ (CSRF, session cookies)                      ▼
          ▼                                   ┌───────────────────────────┐
┌────────────────────────┐                    │ background.js (MV3 SW)    │
│ Django (pricing app)   │◀───── fetch ───────│  bootstrap → imports:      │
│  views/ (11 modules)   │                    │   constants                │
│  services/             │                    │   sdk/* primitives         │
│   • request_service    │                    │   flows/* workflows        │
│   • ai_category        │                    │   flows/bridge/actions/*   │
│   • cex_client         │                    │   handlers/* (router)      │
│   • offer_engine       │                    │   bootstrap/listeners      │
└──────┬─────────────────┘                    └──────────┬───────────────┘
       │                                                 │ chrome.tabs.sendMessage
       ▼                                                 ▼
   SQLite                                   ┌───────────────────────────────┐
                                            │ Content scripts:               │
                                            │  • content-listings.js         │
                                            │    + shared/listings/ebay-*    │
                                            │  • content-nospos.js           │
                                            │  • content-nospos-agreement-fill│
                                            │  • content-jewellery-scrap-prices│
                                            └───────────────────────────────┘
External APIs: Groq, Gemini, CEX, eBay, CashConverters, Ideal Postcodes, Playwright
```

**Typical "Add from CeX" flow:**

1. User clicks *Add from CeX* in React negotiation page.
2. `extensionClient.getDataFromListingPage('CeX')` → `extensionBridge.sendMessage()` posts `EXTENSION_MESSAGE` to the window.
3. `content-bridge.js` relays as `BRIDGE_FORWARD` → `chrome.runtime.sendMessage`.
4. `handlers/router.js` dispatches `BRIDGE_FORWARD` → `flows/bridge/forward.js` looks up the action in the `BRIDGE_ACTIONS` registry → `flows/bridge/actions/start-waiting-for-data.js` opens a CeX tab and stores pending state.
5. On the CeX product page, `content-listings.js` detects load → `LISTING_PAGE_READY`.
6. `handlers/listing.js#handleListingPageReady` → `sendWaitingForData` → content script shows the "Have you got the data yet?" overlay.
7. User confirms → content script scrapes → `SCRAPED_DATA` → `handlers/listing.js#handleScrapedData` → `flows/bridge/core.js#notifyAppExtensionResponse` → app tab receives data.

> Service worker can be killed at any point; pending state is persisted in `chrome.storage.session`.

---

## 4. Backend (Django)

### 4.1 Project wiring

- `cashgen/settings.py` — Django 5.2.6, SQLite (PostgreSQL block commented out), WhiteNoise for static, `CompressedManifestStaticFilesStorage`, `INSTALLED_APPS = ['pricing', 'dal', 'dal_select2', ...]`, session auth only.
- `cashgen/urls.py` — `/admin/`, `/api/` → `pricing.urls`, everything else → React shell (`pricing/templates/react.html`).
- `requirements.txt` — Django, DRF, playwright, aiohttp, beautifulsoup4, openai, groq, google-generativeai, google-genai, whitenoise, gunicorn, dj-database-url, pytest, pytest-django.

### 4.2 Models (`pricing/models_v2.py` — 2,134 lines, 41 classes)

Grouped by domain:

- **Catalogue:** `ProductCategory`, `CGCategory`, `Manufacturer`, `Product`, `Variant`, `Attribute`, `AttributeValue`, `ConditionGrade`.
- **Pricing rules:** `PricingRule`, `CustomerRuleSettings` (70-field singleton), `CustomerOfferRule`.
- **Inventory:** `VariantInventory`, `InventoryUnit`, `VariantStatus`, `VariantPriceHistory`, `InventoryOwnershipEvent`.
- **Requests:** `Request` → `RequestItem` → `RequestItemOffer`; jewellery extras + snapshots; status history.
- **Sessions:** `RepricingSession`, `UploadSession`.
- **Market research:** `MarketResearchSession`, `MarketResearchListing`, `MarketResearchDrillLevel`.
- **NosPos:** `NosposCategoryMapping`, `NosposCategory`, `NosposField`, `NosposCategoryField`.
- **Misc:** `TradeIn`, `Agreement`.

### 4.3 Views & services — the thin-controller split

**Views** (`pricing/views/*.py`) are thin HTTP controllers. Rules:
1. Parse `request.data`.
2. Call a service function.
3. Translate service errors → DRF `Response`.
4. Serialize results.

**Services** (`pricing/services/*.py`) hold the business logic. Rules:
1. Raise a typed error (e.g. `RequestServiceError`) carrying an HTTP hint.
2. Never import DRF / HTTP primitives — services are HTTP-framework-agnostic.

| File | Lines | Concern |
|---|---:|---|
| `services/request_service.py` | 450 | ← **NEW**: Request lifecycle (finalize / update_item / complete_after_testing) |
| `services/ai_category.py` | 524 | Groq + Gemini LLM suggestions |
| `services/offer_engine.py` | 105 | Offer tier generation + price rounding |
| `services/cex_client.py` | 31 | CEX SKU → box-detail lookup |
| `views/requests.py` | **358** (was 900) | Request / RequestItem controllers |
| `views/pricing_rules.py` | 464 | PricingRule + customer-rule admin |
| `views/nospos.py` | 443 | NosPos sync endpoints |
| `views/integrations.py` | 344 | React shell, address lookup, CG scraper |
| `views/market_stats.py` | 312 | variant_prices, cex_product_prices |
| `views/repricing.py` | 312 | RepricingSession + quick-reprice |
| `views/market_research.py` | 295 | eBay / CashConverters research |
| `views/uploads.py` | 243 | UploadSession |
| `views/_shared.py` | 277 | Cross-domain helpers |
| `views/catalogue.py` | 179 | Categories / products / variants |
| `views/customers.py` | 83 | Customer CRUD |
| `views/__init__.py` | 80 | Re-exports for `pricing.urls` |
| `ai_views.py` | 227 | AI suggestion endpoints |

**How to add a new Request endpoint** (worked example):
1. Add the business-logic function to `pricing/services/request_service.py`.
2. Add a thin controller to `pricing/views/requests.py` that calls the service.
3. Add a URL to `pricing/urls.py`.
4. Export the controller from `pricing/views/__init__.py`.

---

## 5. Chrome Extension — modular SDK

> **Design rule:** every file does one thing and is named after what it does. To build a new flow, compose existing sdk/ primitives. To add a new action from the app, drop one file in `flows/bridge/actions/` and register it.

### 5.1 `background.js` — 99-line bootstrap

All it does is call `importScripts` in dependency order:

```
1. bootstrap/constants.js
2. SDK primitives           (bg/*, sdk/*, jewellery-scrap/*)
3. Flows                    (flows/nospos-park/*, flows/nospos-repricing/*, flows/webepos/*, flows/bridge/core.js)
4. Bridge actions           (flows/bridge/actions/*.js — 43 files)
5. Bridge registry + forward.js
6. Message handlers         (handlers/listing.js, handlers/router.js)
7. Top-level listeners      (bootstrap/listeners.js)
```

### 5.2 Layer breakdown

| Layer | What belongs here | Typical file size |
|---|---|---:|
| **bootstrap/** | Shared constants, state Maps, event listeners | 44–116 lines |
| **sdk/** | Primitives with no flow dependencies (tab ops, URL parsers, overlay, DOM waits, 429 recovery) | 30–240 lines |
| **flows/** | Composed workflows (how primitives are combined to do something useful) | 120–700 lines |
| **flows/bridge/actions/** | One file per app-initiated BRIDGE_FORWARD action | 10–50 lines |
| **handlers/** | chrome.runtime.onMessage listener + dispatch table | 100–180 lines |

### 5.3 `flows/bridge/forward.js` — the dispatcher (28 lines)

```js
async function handleBridgeForward(message, sender) {
  const { requestId, payload } = message;
  const appTabId = sender.tab?.id;
  const handler = BRIDGE_ACTIONS[payload?.action];
  if (!handler) {
    return { ok: false, error: `Unknown bridge action: ${payload?.action ?? '(missing)'}` };
  }
  try {
    return await handler({ requestId, appTabId, payload });
  } catch (e) {
    return { ok: false, error: e?.message || 'Bridge action failed' };
  }
}
```

Each action is a file under `flows/bridge/actions/`. To add a new one:

1. Create `flows/bridge/actions/<kebab-case-name>.js` with `handleBridgeAction_<camelCaseName>(ctx)`.
2. Register in `flows/bridge/actions/registry.js`: `myNewAction: handleBridgeAction_myNewAction,`.
3. Add the path to the `importScripts` list in `background.js`.

### 5.4 Content-listings runtime split

- `content-listings.js` (881 lines) — IIFE runtime: site detection, panel UI, scrape dispatch, CeX URL-change listeners.
- `shared/listings/ebay-filters.js` (405 lines) — eBay required-filter / sort enforcement + replay trail.
- `shared/listings/ebay-customize.js` (472 lines) — eBay Customise dialog driver + loading overlay.

All three load together on eBay / CashConverters / CashGenerator / CeX tabs. eBay helpers self-guard (`if (getSiteConfig() !== SITE_CONFIGS.ebay) return false;`), so they're no-ops on other sites.

### 5.5 Large content scripts (not yet split)

| File | Lines | Why still one file |
|---|---:|---|
| `content-nospos.js` | 1,549 | One domain (NosPos page-state detection); cohesive state machine |
| `content-nospos-agreement-fill.js` | 1,207 | Single flow (NosPos `/newagreement/*` form-fill); splitting would scatter closure state |

---

## 6. Frontend — `frontend/vite-project/`

Unchanged from the pre-refactor snapshot:

- **Stack:** React 19, React Router 7, Zustand 5, Tailwind 4, shadcn/ui. No tests.
- **Routing (`App.jsx`):** `/`, `/buyer`, `/negotiation`, `/repricing`, `/upload`, workspace / overview / detail variants, `/reports`, `/pricing-rules`.
- **Pages:** `buyer/`, `launchpad/`, `pricing/`, `reports/`.
- **Services:**
  - `api.js` (561 lines) — `apiFetch` wrapper, CSRF, per-item mutation queue.
  - `extensionBridge.js` — window.postMessage RPC.
  - `extensionClient.js` (543 lines) — ~40 high-level extension actions.
  - `aiCategoryService.js`.
- **Store:** single 300+-line `useAppStore.js` — still the main frontend smell.
- **Build:** `build.sh` runs `npm run build`, copies `dist/` → `static/frontend/`, rewrites `react.html` asset hashes.

---

## 7. Dead Code, Bloat & Repo Hygiene

### 7.1 Cleaned up

- ✅ `chrome-extension/bg/*` (18 stale drifts) — 16 moved to `bg.deprecated/`, 2 kept as page-injection payloads.
- ✅ `pricing/views_v2.py` (3,286 lines) — deleted; split into 11 domain modules.
- ✅ `pricing/views/requests.py` (900 lines) — thinned to 358 lines; logic in `services/request_service.py`.
- ✅ `chrome-extension/background.js` (6,165 lines) — reduced to 99 lines.
- ✅ `chrome-extension/flows/bridge/forward.js` (1,139 lines) — reduced to 28 lines; 43 action files under `actions/`.
- ✅ `chrome-extension/content-listings.js` (1,726 lines) — reduced to 881 lines; eBay helpers in `shared/listings/`.
- ✅ Large binaries (`db.sqlite3`, `get-pip.py`, `python/`, `static/assets/`) untracked.

### 7.2 Remaining bloat (P2 candidates)

| File | Lines | Notes |
|---|---:|---|
| `pricing/models_v2.py` | 2,134 | `PricingRule` (30+ fields) and `CustomerRuleSettings` (70-field singleton) are the obvious targets. |
| `chrome-extension/content-nospos.js` | 1,549 | One domain, cohesive; splitting would scatter state. |
| `chrome-extension/content-nospos-agreement-fill.js` | 1,207 | Single flow; fuzzy-match logic could share a module with WebEPOS product-forms. |
| `chrome-extension/flows/nospos-park/agreement-fill.js` | 701 | Park-agreement orchestration; could split by phase (category / items / submit). |
| `chrome-extension/flows/nospos-repricing/page-handlers.js` | 810 | Four handlers (page-ready / stock-search / stock-edit / page-loaded); could split by message type. |
| `chrome-extension/flows/webepos/scrape.js` | 681 | In-page scrape injected via `executeScript`; single cohesive flow. |
| `frontend/vite-project/src/services/api.js` | 561 | 1 file, ~30 endpoints. Could group by resource. |
| `frontend/vite-project/src/services/extensionClient.js` | 543 | 40+ action wrappers; could split by domain. |
| `frontend/vite-project/src/store/useAppStore.js` | ~300 | Monolithic Zustand store — split into `useCartStore` / `useWorkspaceStore` / `useCustomerStore` / `useUIStore`. |

### 7.3 Terminology glossary

| Term | Meaning |
|---|---|
| **NosPos** | Third-party POS for buying/repricing. |
| **WebEPOS** | CashGenerator's inventory management system. |
| **"park" (agreement)** | Save a NosPos agreement as a draft without finalising. |
| **"bridge-forward"** | Pattern: app posts a message → content-bridge → `handlers/router.js` → `flows/bridge/forward.js` dispatches to a registered action. |
| **"repricing"** | Updating sell prices on existing stock (NosPos pricing + WebEPOS re-ingestion). |
| **CG** | CashGenerator (the retail chain). |
| **CeX** | Competitor retailer scraped for pricing reference. |

---

## 8. Refactor Backlog

### P0 — Critical (all done ✅)

1. ~~Decompose `chrome-extension/background.js`~~ — done.
2. ~~Split `pricing/views_v2.py` into domain modules~~ — done.
3. ~~Untrack large binaries from git~~ — done.

### P1 — High (all done ✅)

4. ~~Split `content-listings.js` by site / extract eBay helpers~~ — done.
5. ~~Split `flows/bridge/forward.js` into per-action files~~ — done.
6. ~~Extract Request business logic into a service layer~~ — done.

### P2 — Next up

7. **Decompose `PricingRule` and `CustomerRuleSettings`.** Multi-table inheritance (CashRule / VoucherRule / JewelleryRule) or typed JSONField + validators. Split `CustomerRuleSettings` by concern.
8. **Slice `useAppStore.js`.** `useCartStore`, `useWorkspaceStore`, `useCustomerStore`, `useUIStore`; thin combined selector for cross-slice callers.
9. **Split `extensionClient.js` by domain.** `extension/listings.js`, `extension/nospos.js`, `extension/webepos.js`, `extension/jewellery.js`.
10. **Centralise extension timeouts.** `bootstrap/timeouts.js` — currently 15+ constants scattered across `extensionClient.js`.
11. **Split `frontend/vite-project/src/services/api.js` by resource.** `api/requests.js`, `api/repricing.js`, `api/catalogue.js`, `api/nospos.js`, …
12. **Share fuzzy-match logic** between `content-nospos-agreement-fill.js` and `bg/webepos-*-fill-page.js` via a `shared/form-field-matcher.js`.
13. **Delete `chrome-extension/bg.deprecated/`** after one more review cycle.
14. **Add a React error boundary** at the route-layout level and a global unhandled-rejection toast.
15. **Add Zod schemas** for cart items, customer input, offer payloads — fail fast at form boundaries.
16. **Add frontend tests** (Vitest + RTL) — cart mutations, offer switching, request finalization.
17. **Drop the `_v2` suffix** on `models_v2.py` — no `v1` exists.
18. **Async / queue blocking market-research calls** — move from `requests` to `aiohttp` + `asgiref.sync`, or Celery.
19. **Add docstrings + OpenAPI** — DRF Spectacular for an auto-generated API reference.

---

## 9. Verification

**Backend**
- `python3 manage.py check` → "System check identified no issues".
- `reverse()` resolves every URL name moved between modules (sampled: `requests`, `add_request_item`, `request_detail`, `finish_request`, `update_request_item`, `complete_request_after_testing`, `cancel_request`, `repricing_sessions`, `upload_sessions`, `pricing_rules`).
- `wc -l pricing/views/*.py pricing/services/request_service.py` → 12 modules, 4,382 total lines.

**Chrome extension**
- `node --check` passes on every file under `bootstrap/`, `sdk/`, `flows/**`, `handlers/`, `shared/listings/`, plus `background.js`.
- `background.js` is 99 lines.
- `flows/bridge/forward.js` is 28 lines; `flows/bridge/actions/` contains 43 action files + `registry.js`.
- `content-listings.js` is 881 lines; `shared/listings/{ebay-filters,ebay-customize}.js` are 405 + 472.
- `grep -rn "bg/webepos-new-product-fill-page\|bg/webepos-edit-product-fill-page"` → only `flows/webepos/product-forms.js` references them, exactly where `chrome.scripting.executeScript` injects them into the WebEPOS page.

**Repo hygiene**
- `git ls-files | grep -E "^(db\.sqlite3|get-pip\.py|python/|static/assets/)"` → empty.
- `.gitignore` includes `*.sqlite3`, `python/`, `get-pip.py`, `static/assets/`, `frontend/vite-project/{dist,node_modules}/`.

---

## 10. Change Log

**2026-04-21 — initial system map.** Documented architecture, flagged three P0 refactors.

**2026-04-21 — all P0 refactors applied.**
- `background.js` 6,165 → 99 lines (bootstrap + importScripts).
- `bg/` 18-file drift replaced with 20 purpose-built files under `bootstrap/ sdk/ flows/ handlers/`.
- `pricing/views_v2.py` 3,286-line god file deleted; split into 11 view modules + `_shared.py`.
- `db.sqlite3`, `get-pip.py`, `python/`, `static/assets/` untracked; `.gitignore` rewritten.

**2026-04-21 — all P1 refactors applied.**
- **Bridge dispatcher split.** `flows/bridge/forward.js` 1,139 → 28 lines. The 43 `if (payload.action === 'X')` blocks become 43 files under `flows/bridge/actions/`, each `handleBridgeAction_<name>({ requestId, appTabId, payload })`, wired through a `BRIDGE_ACTIONS` registry.
- **Request service layer.** `pricing/views/requests.py` 900 → 358 lines (thin controllers). Business logic in `pricing/services/request_service.py` with `finalize()`, `update_item()`, `complete_after_testing()` as the public API; errors raised as `RequestServiceError` carrying an HTTP status hint.
- **Content-listings split.** `content-listings.js` 1,726 → 881 lines. eBay-only helpers extracted to `shared/listings/ebay-filters.js` (405) + `shared/listings/ebay-customize.js` (472). `manifest.json` updated so every site that loads `content-listings.js` also loads the helpers (self-guarded on non-eBay).

*Regenerate the size tables by re-running the commands in §9 whenever the next round of splits lands.*
