# Buyer Flow Testing Checklist (Post-Refactor)

Use this checklist after the architectural refactor to verify all flows. Test in order where dependencies matter.

**Architecture changes to verify:**
- Zustand store (`useAppStore`) is the single source of truth for cart, customer, request state
- `buyerPageStore.js` (sessionStorage) is no longer used — Zustand persists to sessionStorage via its own middleware
- Negotiation page reads initial data from the store (falls back to `location.state`)
- Extracted components: `NegotiationItemRow`, `NegotiationModals`, `CexProductView`, `EbayCartItemView`, `CashConvertersCartItemView`, `TransactionTypeConfirmDialog`
- Helper functions centralized in `negotiationHelpers.js`
- API layer centralized through `apiFetch` helper (no more hardcoded URLs)
- Backend: duplicate `requests_overview_list` view removed, print statements → logging

---

## 1. Buyer Page (`/buyer`)

### 1.1 Customer Intake Modal
- [ ] Modal opens on page load (fresh state)
- [ ] Selecting a customer closes modal and shows customer name in header
- [ ] Cancel rate displays correctly
- [ ] Customer stats (joined date, transaction counts, rates) display if available
- [ ] Transaction type dropdown shows: Direct Sale, Buy Back, Store Credit
- [ ] Changing transaction type before adding items works
- [ ] **State:** Refresh page — modal state restored from store (if customer already selected, modal stays closed)

### 1.2 Category & Product Selection
- [ ] Sidebar category list loads
- [ ] Selecting a category loads product models
- [ ] Selecting a model loads attribute configuration (condition, color, etc.)
- [ ] Breadcrumb displays correctly
- [ ] **State:** Switch categories rapidly — no stale data (requests are cancelled/superseded)

### 1.3 CeX Add-from-CeX Flow (Chrome Extension)
- [ ] "Add from CeX" button works
- [ ] Extension opens CeX in new tab and scrapes product detail page
- [ ] On return: CeX product shows image, specs, offers (now in `CexProductView` component)
- [ ] "Add to Cart" creates cart item with request_item_id (API call)
- [ ] **State:** CeX product data persists in store across re-renders
- [ ] **Edge:** Extension not installed — shows error notification
- [ ] **Edge:** Close CeX tab before confirming — app shows error
- [ ] **Edge:** Clear CeX product (X button) — returns to category view

### 1.4 eBay Research Flow
- [ ] eBay item in cart selected — `EbayCartItemView` component renders correctly
- [ ] "Get data via Chrome extension" opens eBay in new tab
- [ ] On eBay listings page, extension confirms and returns data
- [ ] Histogram and offers display
- [ ] Add to cart creates custom eBay item
- [ ] **Edge:** No extension — error message shown

### 1.5 Cash Converters Research Flow
- [ ] Cash Converters item selected — `CashConvertersCartItemView` component renders
- [ ] Extension flow works same as eBay
- [ ] Add to cart creates Cash Converters item

### 1.6 Standard CeX Products (non-Add-from-CeX)
- [ ] Select category → model → attributes
- [ ] Offers load (cash/voucher based on transaction type)
- [ ] Add to Cart creates request + request_item via API
- [ ] Request ID stored in Zustand store

### 1.7 Cart Sidebar
- [ ] Cart items display with title, subtitle, quantity
- [ ] Click item to select — highlights and shows details in main content
- [ ] Clicking selected item deselects it
- [ ] Remove item works (calls API to delete request_item, updates store)
- [ ] Offer Min/Max/Total displays correctly (from `useOfferTotals` selector)
- [ ] "New Buy" button resets cart, customer, request (calls `resetBuyer` action)
- [ ] **State:** Cart items persist in store across page refresh (sessionStorage)
- [ ] **Edge:** Empty cart — "No items in cart" and Negotiate disabled

### 1.8 Transaction Type Change with Cart
- [ ] Add items to cart
- [ ] Change transaction type (e.g. Direct Sale → Store Credit)
- [ ] `TransactionTypeConfirmDialog` appears (extracted component)
- [ ] Cancel keeps current type
- [ ] Confirm switches offers (cash ↔ voucher) — store's `setTransactionType` runs `recalcOffersForTransactionType`
- [ ] Cart offer labels update
- [ ] All items' offers recalculated in a single store update (no stale intermediate state)

### 1.9 State Persistence & Navigation
- [ ] Add items, navigate away, come back — cart and customer preserved (Zustand sessionStorage)
- [ ] Add items, go to Negotiation, click "Back to Cart" — everything preserved
- [ ] "New Buy" clears all state cleanly
- [ ] **Edge:** Open `/buyer` in new tab — state shared via sessionStorage
- [ ] **Edge:** Close tab, reopen — state restored

### 1.10 Continue Editing from Requests Overview
- [ ] Click "Continue Editing" on a QUOTE request in Requests Overview
- [ ] Navigates to `/buyer` with `openQuoteRequest` in location.state
- [ ] Store's `restoreFromQuoteRequest` hydrates cart, customer, request from API data
- [ ] Cart items have correct offers, selected offers, research data
- [ ] Request ID is set so subsequent adds go to same request

---

## 2. Negotiation Page (`/negotiation`)

### 2.1 Entry & Initialization
- [ ] Navigate from cart — loads items from Zustand store (primary) or location.state (fallback)
- [ ] Customer data, request ID, transaction type all transferred correctly
- [ ] Items normalized via `normalizeCartItemForNegotiation`
- [ ] **Edge:** Direct URL `/negotiation` with no state and empty store — redirects to `/buyer`
- [ ] **Edge:** Cart empty — redirects to `/buyer`
- [ ] **Edge:** No customer — redirects to `/buyer`
- [ ] **Edge:** No request ID — error notification and redirect to `/buyer`

### 2.2 Display (NegotiationItemRow component)
- [ ] All cart items appear in table
- [ ] Columns render: Qty, Item Name, CeX Buy Cash/Voucher, CeX Sell, 1st/2nd/3rd Offer, Manual Offer, Customer Expectation, Our Sale Price, eBay, Cash Converters
- [ ] Grand Total in sidebar updates dynamically
- [ ] CeX Sell column shows clickable link to webuy.com where available
- [ ] "CeX out of stock" badge displays when applicable
- [ ] eBay median price displays with quantity multiplier

### 2.3 Offer Selection
- [ ] Click 1st/2nd/3rd offer to select (green highlight)
- [ ] Margin % displays for each offer when Our Sale Price exists
- [ ] Click manual offer cell — `ItemOfferModal` opens
- [ ] Right-click item row — `ItemContextMenu` with "Set manual offer" and "Remove"
- [ ] Manual offer: "Meet target" shortcut works when target is set
- [ ] Manual offer: per-unit calculation correct for qty > 1
- [ ] Offer exceeding sale price → `SeniorMgmtModal` requires name
- [ ] After applying manual offer with sale price → `MarginResultModal` shows margin info
- [ ] Negative margin shows warning icon and red text

### 2.4 Transaction Type Toggle
- [ ] Change transaction type in sidebar
- [ ] Offer columns update (Cash ↔ Voucher)
- [ ] Previously selected offer index preserved (e.g. 2nd offer stays 2nd)
- [ ] Manual offers unaffected by type switch

### 2.5 Target Offer
- [ ] Click grand total area → `TargetOfferModal` opens
- [ ] Set target → target badge appears in sidebar
- [ ] Target match: green badge + check icon when grand total == target
- [ ] Target mismatch: red badge + shortfall/excess amount shown
- [ ] "Book for Testing" blocked when target set but not matched
- [ ] Clear target (X button) removes it
- [ ] "Meet target" in item offer modal calculates correct per-item contribution

### 2.6 Quantity
- [ ] Quantity editable in negotiate mode
- [ ] All totals recalculate: offer totals, CeX prices, eBay/CC medians
- [ ] Per-unit breakdown shows when qty > 1

### 2.7 Customer Expectation & Our Sale Price
- [ ] Customer expectation input editable per item
- [ ] Total expectation auto-calculates from per-item expectations
- [ ] Our Sale Price editable (input as row total, stored as per-unit)
- [ ] Our Sale Price sourced from: manual input > eBay suggested price

### 2.8 eBay & Cash Converters Research
- [ ] eBay button opens `EbayResearchForm` modal
- [ ] Refining research → `applyEbayResearchToItem` updates offers correctly
- [ ] New suggested price → `SalePriceConfirmModal` asks whether to update
- [ ] Cash Converters button opens `CashConvertersResearchForm` modal
- [ ] CC research → `applyCashConvertersResearchToItem` updates correctly
- [ ] **Edge:** View mode — research buttons read-only

### 2.9 Draft Auto-Save
- [ ] Changes auto-save to backend after 800ms debounce
- [ ] Draft saved on tab close (`beforeunload`) and SPA navigation away
- [ ] Completed transaction prevents further draft saves

### 2.10 Finalization
- [ ] "Book for Testing" enabled when all items have selected offer
- [ ] **Edge:** Missing offer → error: "Please select an offer for item: X"
- [ ] **Edge:** Manual offer with 0 → error
- [ ] **Edge:** Target set but not met → error with specific amount
- [ ] New customer → `NewCustomerDetailsModal` for name/phone/email/address
- [ ] Existing customer → finishes directly
- [ ] Success → store reset via `resetBuyer()`, navigate to `/transaction-complete`
- [ ] **Edge:** Already finalized request → error and redirect to buyer

### 2.11 Back to Cart
- [ ] "Back to Cart" navigates to `/buyer` with preserveCart state
- [ ] Items, customer, requestId all preserved

---

## 3. View Mode (`/requests/:id/view`)

### 3.1 Load
- [ ] Navigate from Requests Overview → loads via `fetchRequestDetail` API
- [ ] Data mapped via `mapApiItemToNegotiationItem` helper
- [ ] Removed items (no negotiated price) shown with "Removed from cart" badge
- [ ] **Edge:** Invalid ID → error and redirect to requests-overview

### 3.2 Read-Only
- [ ] Quantity not editable
- [ ] Offer cells not clickable
- [ ] Manual offer shows "Manual offer" label with value
- [ ] Customer expectation read-only
- [ ] Our Sale Price shows value but not editable
- [ ] Total expectation read-only
- [ ] "Book for Testing" disabled
- [ ] "View Only" badge shown
- [ ] Right-click does nothing

### 3.3 eBay/Cash Converters in View Mode
- [ ] eBay research button opens modal in read-only mode
- [ ] Cash Converters research button opens modal in read-only mode
- [ ] **Edge:** No research data → button disabled with "No research available" tooltip

### 3.4 Back
- [ ] "Back to Requests" navigates to `/requests-overview`

---

## 4. Repricing Flow

### 4.1 Repricing Buyer (`/repricing`)
- [ ] Same `Buyer` component with `mode="repricing"`
- [ ] No customer intake required (modal hidden)
- [ ] Quick Reprice modal works — adds items via `addQuickRepriceItems`
- [ ] Cart items display in repricing mode
- [ ] "Start Repricing" navigates to repricing negotiation

### 4.2 Repricing Negotiation (`/repricing-negotiation`)
- [ ] Loads cart items from store (falls back to location.state)
- [ ] Barcode entry works per item
- [ ] NosPos integration (open, search, get status, get result)
- [ ] eBay & Cash Converters research works
- [ ] Save session to backend
- [ ] **Edge:** Navigate back → cart preserved

### 4.3 Repricing Overview (`/repricing-overview`)
- [ ] Lists repricing sessions
- [ ] Click session → view details

### 4.4 Repricing Session View (`/repricing-sessions/:id/view`)
- [ ] Loads session details from API
- [ ] Read-only display

---

## 5. Requests Overview (`/requests-overview`)

### 5.1 Load
- [ ] Page loads and fetches requests
- [ ] Table shows: ID, Customer, Intent, Item Count, Total Value, Status, Created At

### 5.2 Filter
- [ ] Filter: All, Quote, Booked For Testing, Complete
- [ ] Changing filter refetches with status param
- [ ] **Backend:** Uses the corrected `requests_overview_list` (annotated latest status, no duplicate view)

### 5.3 Stats
- [ ] Quote Requests count correct
- [ ] Booked / Total correct
- [ ] Completed count correct

### 5.4 Navigation
- [ ] Row click → `/requests/:id/view`
- [ ] "New Request" → `/buyer`
- [ ] "Continue Editing" (QUOTE only) → `/buyer` with `openQuoteRequest`

### 5.5 Empty State
- [ ] No requests → "No requests found" message

---

## 6. API Layer

### 6.1 Centralized `apiFetch`
- [ ] CSRF token sent on POST/PUT/DELETE (not GET)
- [ ] Content-Type: application/json sent when body present
- [ ] Relative paths used (no hardcoded API_BASE_URL)
- [ ] Error responses parsed and thrown with meaningful messages
- [ ] 204 responses handled (return null)

### 6.2 Key Endpoints
- [ ] `createRequest` — creates request + first item
- [ ] `addRequestItem` — adds item to existing request
- [ ] `deleteRequestItem` — removes item
- [ ] `updateRequestItemOffer` — persists offer selection, manual offer, sale price
- [ ] `updateRequestItemRawData` — persists research data
- [ ] `fetchRequestDetail` — loads full request with items
- [ ] `finishRequest` — finalizes to BOOKED_FOR_TESTING
- [ ] `saveQuoteDraft` — persists draft state
- [ ] `fetchCeXProductPrices` — gets CeX product offers
- [ ] `fetchVariantPrices` — gets variant offers by CeX SKU

---

## 7. Chrome Extension

### 7.1 eBay
- [ ] Opens ebay.co.uk with optional search query
- [ ] Content script on listings page sends LISTING_PAGE_READY
- [ ] Extension shows "Have you got the data yet?" panel
- [ ] User clicks Yes → scraped data sent to app

### 7.2 Cash Converters
- [ ] Same flow for cashconverters.co.uk

### 7.3 CeX
- [ ] Same flow for uk.webuy.com (product detail or search)

### 7.4 Refine
- [ ] `startRefine` with listingPageUrl finds existing tab or opens new
- [ ] Returns updated scraped data to app

### 7.5 Edge Cases
- [ ] User closes listing tab before confirming → error response
- [ ] Timeout (60s) → timeout error

---

## 8. Backend

### 8.1 Fixed Issues
- [ ] No duplicate `requests_overview_list` view (removed the less-reliable one at old line 386)
- [ ] URL name typo fixed: `add_request_item` (was `add_request_\`item`)
- [ ] All `print()` statements replaced with `logger.debug()` / `logger.warning()`
- [ ] Module-level `logger = logging.getLogger(__name__)` at top of views_v2.py

### 8.2 Verify
- [ ] `GET /api/requests-overview/` returns requests with correct latest status
- [ ] `GET /api/requests-overview/?status=QUOTE` filters correctly
- [ ] `POST /api/requests/<id>/items/` adds items (URL name now correct)
- [ ] eBay proxy endpoint logs at DEBUG level, not print
- [ ] Cash Converters filter/results endpoints log at DEBUG level, not print

---

## 9. Zustand Store (`useAppStore`)

### 9.1 State Management
- [ ] `cartItems` — single source of truth for cart
- [ ] `customerData` — single source of truth for customer
- [ ] `request` — tracks current API request
- [ ] `selectedCartItemId` — which cart item is selected in main content
- [ ] `cexProductData` — current CeX product being added

### 9.2 Persistence
- [ ] Store persists to `sessionStorage` with key `cg-suite-store`
- [ ] Refresh page → state restored
- [ ] `requestId` persisted → on rehydrate, `hydrateFromRequest` re-fetches to validate
- [ ] Non-QUOTE requests trigger `resetBuyer` on rehydration

### 9.3 Selectors
- [ ] `useCartItems()` — returns cart items
- [ ] `useCustomerData()` — returns customer data
- [ ] `useSelectedCartItem()` — returns selected item or null
- [ ] `useOfferTotals()` — returns { offerMin, offerMax, totalOffer }
- [ ] `useIsRepricing()` — returns true when mode === 'repricing'
- [ ] `useUseVoucherOffers()` — returns true when transaction type is store_credit

### 9.4 Actions
- [ ] `addToCart` — handles duplicates (qty increment or offer update)
- [ ] `removeFromCart` — API delete + state cleanup
- [ ] `updateCartItemOffers` — persists to API + updates state
- [ ] `setTransactionType` — recalculates all item offers
- [ ] `selectCategory` — loads models, cancels stale requests
- [ ] `handleAddFromCeX` — extension → API → state
- [ ] `resetBuyer` — saves outstanding offers to API, then clears all state
- [ ] `restoreFromQuoteRequest` — hydrates store from API request data

---

## 10. Error Handling & Edge Cases

### 10.1 Network
- [ ] API timeout → user sees error notification
- [ ] 4xx/5xx → error message displayed (parsed from response body)

### 10.2 State Consistency
- [ ] Cart and negotiation never show different data for the same items
- [ ] Transaction type change propagates to all items atomically
- [ ] Manual offer exceeding sale price always requires senior mgmt confirmation
- [ ] No stale data when switching between categories rapidly

### 10.3 Navigation
- [ ] Browser back from negotiation → preserves state
- [ ] Hard refresh on negotiation → redirects to buyer (negotiation state is local)
- [ ] Tab close → draft saved via `beforeunload`

### 10.4 Data
- [ ] Item with no offers → handled gracefully (dashes shown)
- [ ] Item with missing eBay research → shows "Research" button
- [ ] Duplicate add (same variant) → quantity increments
- [ ] Repricing: duplicate add → offer updated (qty stays 1)

---

## Quick Smoke Test (5 min)

1. Open `/buyer` → select customer → add one CeX item → Negotiate → select offer → Book for Testing
2. Open `/requests-overview` → click a request → verify view mode
3. Open `/buyer` → Add from CeX (if extension) → add product → Negotiate → Book
4. Open `/buyer` → add item → refresh page → verify cart persisted
5. Open `/buyer` → add items → change transaction type → verify confirmation dialog → verify offers switch

---

## Sign-Off

- [ ] All items above tested
- [ ] No console errors in normal flows
- [ ] No regressions in existing behavior
- [ ] State consistency verified across navigation
