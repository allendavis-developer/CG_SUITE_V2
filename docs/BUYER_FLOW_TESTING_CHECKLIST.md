# Buyer Flow Testing Checklist

Use this checklist after refactoring to ensure nothing is broken. Test in order where dependencies matter.

---

## 1. Buyer Page (`/buyer`)

### 1.1 Customer Intake Modal
- [ ] Modal opens on page load
- [ ] Selecting a customer closes modal and shows customer name in header
- [ ] Cancel rate displays correctly
- [ ] Transaction type dropdown shows: Direct Sale, Buy Back, Store Credit
- [ ] Changing transaction type before adding items works
- [ ] **Edge:** Refresh while modal open — modal reopens on reload

### 1.2 Category & Product Selection
- [ ] Sidebar category list loads
- [ ] Selecting a category loads product models
- [ ] Selecting a model loads attribute configuration (condition, color, etc.)
- [ ] Breadcrumb displays correctly
- [ ] **Edge:** Switch categories rapidly — no stale data

### 1.3 CeX Add-from-CeX Flow (Chrome Extension)
- [ ] "Add from CeX" button in sidebar works
- [ ] Extension opens CeX in new tab
- [ ] On CeX product detail page, extension panel shows "Have you got the data yet?"
- [ ] Clicking "Yes" returns data to app and shows product details
- [ ] CeX product shows image, specs, offers
- [ ] "Add to Cart" adds CeX item to cart
- [ ] **Edge:** Extension not installed — shows error notification
- [ ] **Edge:** Close CeX tab before clicking Yes — app receives error or timeout
- [ ] **Edge:** Clear CeX product (X button) — returns to category view

### 1.4 eBay Research Flow
- [ ] Selecting eBay category shows eBay Research tab
- [ ] "Get data via Chrome extension" opens eBay in new tab
- [ ] On eBay listings page, extension confirms and returns data
- [ ] Histogram and offers display
- [ ] Add to cart creates custom eBay item
- [ ] **Edge:** No extension — error message shown

### 1.5 Cash Converters Research Flow
- [ ] Selecting Cash Converters category shows research form
- [ ] Extension flow works same as eBay
- [ ] Add to cart creates Cash Converters item

### 1.6 Standard CeX Products (non-Add-from-CeX)
- [ ] Select category → model → attributes
- [ ] Offers load (cash/voucher based on transaction type)
- [ ] Add to Cart adds item with request_item_id

### 1.7 Cart Sidebar
- [ ] Cart items display with title, subtitle, quantity
- [ ] Click item to select — highlights and shows details in main content
- [ ] Quantity increment/decrement works
- [ ] Remove item works
- [ ] Offer Min/Max displays correctly
- [ ] **Edge:** Empty cart — "No items in cart" and Negotiate disabled
- [ ] Transaction type change (Direct Sale ↔ Store Credit) updates offers in cart

### 1.8 Transaction Type Change with Cart
- [ ] Add items to cart
- [ ] Change transaction type (e.g. Direct Sale → Store Credit)
- [ ] Confirmation dialog appears
- [ ] Cancel keeps current type
- [ ] Confirm switches offers (cash ↔ voucher)
- [ ] Cart offer labels update

### 1.9 Cart State Restore on Navigation
- [ ] Add items, go to Negotiation
- [ ] Click "Back to Cart" — cart items and customer preserved
- [ ] Request ID preserved
- [ ] **Edge:** Direct URL to `/buyer` — no preserved state (fresh start)

---

## 2. Negotiation Page (`/negotiation`)

### 2.1 Entry & Validation
- [ ] Navigate from cart with items — loads correctly
- [ ] **Edge:** Direct URL `/negotiation` with no state — redirects to `/buyer`
- [ ] **Edge:** Cart empty — redirects to `/buyer`
- [ ] **Edge:** No customer — redirects to `/buyer`

### 2.2 Display
- [ ] All cart items appear in table
- [ ] Columns: Qty, Item Name, CeX Buy Cash/Voucher, CeX Sell, 1st/2nd/3rd Offer, Manual Offer, Customer Expectation, Our Sale Price, eBay, Cash Converters
- [ ] Grand Total in sidebar updates when offers change

### 2.3 Offer Selection
- [ ] Click 1st/2nd/3rd offer to select
- [ ] Manual offer input works — typing auto-selects manual
- [ ] Margin % displays for each offer when Our Sale Price exists
- [ ] Negative margin shows warning icon for manual offer

### 2.4 Transaction Type Toggle
- [ ] Change transaction type in sidebar (Direct Sale ↔ Store Credit)
- [ ] Offer columns update (Cash ↔ Voucher)
- [ ] Previously selected offer index preserved (e.g. 2nd offer stays 2nd)

### 2.5 Quantity
- [ ] Quantity editable in negotiate mode
- [ ] Totals recalculate with quantity

### 2.6 eBay & Cash Converters Research
- [ ] eBay button opens research modal (or shows — if no data)
- [ ] Refining eBay research updates offers
- [ ] Cash Converters button opens research modal
- [ ] **Edge:** View mode — research buttons read-only, no edits

### 2.7 Finalization
- [ ] "Book for Testing" enabled when all items have selected offer
- [ ] **Edge:** Missing offer — error: "Please select an offer for item: X"
- [ ] **Edge:** Manual offer with 0 or invalid — error
- [ ] **Edge:** Missing request ID — error and redirect to buyer
- [ ] New customer — modal for name/phone/email/address before finish
- [ ] Existing customer — finishes directly
- [ ] Success — navigates to transaction complete

### 2.8 Back to Cart
- [ ] "Back to Cart" navigates to `/buyer` with preserveCart state
- [ ] Items, customer, requestId preserved

---

## 3. View Mode (`/requests/:id/view`)

### 3.1 Load
- [ ] Navigate from Requests Overview to view request
- [ ] Loads request details from API
- [ ] **Edge:** Invalid ID — error and redirect to requests-overview

### 3.2 Read-Only
- [ ] Quantity not editable
- [ ] Offer selection not clickable
- [ ] Manual offer read-only
- [ ] Customer expectation read-only
- [ ] Our Sale Price read-only
- [ ] Total expectation read-only
- [ ] "Book for Testing" disabled
- [ ] "View Only" badge shown

### 3.3 eBay/Cash Converters in View Mode
- [ ] eBay research button opens modal read-only
- [ ] Cash Converters research button opens modal read-only
- [ ] **Edge:** No research data — button disabled or shows "No research available"

### 3.4 Back
- [ ] "Back to Requests" navigates to `/requests-overview`

---

## 4. Requests Overview (`/requests-overview`)

### 4.1 Load
- [ ] Page loads and fetches requests
- [ ] Table shows: ID, Customer, Intent, Item Count, Total Value, Status, Created At

### 4.2 Filter
- [ ] Filter dropdown: All, Quote, Booked For Testing, Complete
- [ ] Changing filter refetches with status param
- [ ] **Edge:** API error — error message and notification

### 4.3 Stats
- [ ] Quote Requests count correct
- [ ] Booked / Total correct
- [ ] Completed count correct

### 4.4 Navigation
- [ ] Row click → `/requests/:id/view`
- [ ] "New Request" → `/buyer`

### 4.5 Empty State
- [ ] No requests — "No requests found" message

---

## 5. Chrome Extension

### 5.1 eBay
- [ ] App sends `startWaitingForData` (eBay) → opens ebay.co.uk
- [ ] Optional search query in URL
- [ ] Content script on listings page sends LISTING_PAGE_READY
- [ ] Extension shows "Have you got the data yet?" panel
- [ ] User clicks Yes → SCRAPED_DATA sent to app
- [ ] App tab focused

### 5.2 Cash Converters
- [ ] Same flow for cashconverters.co.uk

### 5.3 CeX
- [ ] Same flow for uk.webuy.com (product detail or search)

### 5.4 Refine
- [ ] `startRefine` with listingPageUrl
- [ ] Finds existing tab or opens new
- [ ] "Are you done?" on listing page
- [ ] Returns scraped data to app

### 5.5 Edge Cases
- [ ] User closes listing tab before confirming — app receives error response
- [ ] Timeout (60s) — app receives timeout error

---

## 6. Shared Utilities

### 6.1 Transaction Constants
- [ ] `mapTransactionTypeToIntent`: sale→DIRECT_SALE, buyback→BUYBACK, store_credit→STORE_CREDIT
- [ ] **Edge:** Invalid type throws
- [ ] `formatIntent`: DIRECT_SALE→"Direct Sale", etc.
- [ ] `getFilterTitle`: ALL→"All Requests", etc.

### 6.2 Extension Client
- [ ] `getDataFromListingPage('eBay')` sends correct payload
- [ ] `getDataFromListingPage('CeX')` sends correct payload
- [ ] `getDataFromListingPage('CashConverters')` sends correct payload
- [ ] `getDataFromListingPage('unknown')` falls back to eBay
- [ ] `getDataFromRefine` works for eBay and CashConverters

---

## 7. Error Handling & Edge Cases

### 7.1 Network
- [ ] API timeout — user sees error notification
- [ ] 4xx/5xx — error message displayed

### 7.2 State
- [ ] Browser back from negotiation — preserves cart when using "Back to Cart"
- [ ] Hard refresh on negotiation — redirects to buyer (state lost)

### 7.3 Data
- [ ] Item with no offers — handled gracefully
- [ ] Item with missing eBay research — shows — or "Research" button
- [ ] Duplicate add (same variant/eBay/CC item) — quantity increments

---

## Quick Smoke Test (5 min)

1. Open `/buyer` → select customer → add one CeX item → Negotiate → select offer → Book for Testing
2. Open `/requests-overview` → click a request → verify view mode
3. Open `/buyer` → Add from CeX (if extension) → add product → Negotiate → Book

---

## Sign-Off

- [ ] All items above tested
- [ ] No console errors in normal flows
- [ ] No regressions in existing behavior
