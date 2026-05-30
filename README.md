# EJ Hardware POS

A vanilla HTML/CSS/JS point-of-sale web app for a Philippine family-owned hardware store, designed to replace Loyverse. No build step — open `index.html` in a browser (or serve the folder with any static server).

## Files

- `index.html` — main POS app (Sell, Orders, Inventory, Customers, Reports views)
- `app.js` — app logic, state, cart, payment, receipt, sidebar, modals
- `styles.css` — all styling
- `data.js` — seed products + folders
- `backoffice.html` / `backoffice.js` — back-office page (settings, inventory bulk ops)
- `catalog.csv` — source catalog for seeding

## Run locally

Any static server works. With Node:

```bash
npx serve .
```

Or with Python:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500/`.

## Verify

Syntax-check the browser scripts:

```bash
node --check app.js
node --check backoffice.js
node --check data-store.js
```

Check the replaceable order/receipt mapper:

```bash
node scripts/verify-order-format.mjs
```

Run a bulk same-day POS stress simulation:

```bash
node scripts/stress-day.mjs --transactions=1000
```

Run targeted hardening checks for scanner fallback, delivery map, offline loaded sales, saved receipts, stock persistence, Back Office dashboard visibility, and full backup/restore:

```bash
node scripts/hardening-check.mjs
```

Run an independent math audit for basket totals, discounts, VAT, cash/change, split/credit payments, stock deltas, refunds/voids/exchanges, customer balances, drawer totals, and AI/report totals:

```bash
node scripts/math-audit.mjs --iterations=1000
```

## State

All persistence is in `localStorage`. Keys:
- `hwpos.folders.v2` — product folders
- `hwpos.products.v2` — products
- `hwpos.groups.v1` — variant groups
- `hwpos.orders.v1` — saved receipts and completed sales
- `hwpos.orderSeq.v1` — order # counter
- `hwpos.customers.v1` — saved customers and local credit balances
- `hwpos.customerLedger.v1` — credit charges and customer payments
- `hwpos.drawerCloseouts.v1` — daily cash drawer closeouts
- `hwpos.settings.v1` — store, sync, tax, and printing settings
- `hwpos.tileSize`, `hwpos.showPrice` — UI prefs

Back Office → Settings → Backup exports/restores a full local JSON backup for products, folders, groups, orders, customers, customer ledger, drawer closeouts, settings, order sequence, role, and POS display preferences.

## Order format

Orders are normalized before they are saved or rendered. The current canonical format is exposed in `app.js` as `window.HWPOS_ORDER_FORMAT`:

- `normalizeOrder(raw)` — accepts old/imported/future order shapes and returns the current `hwpos.order.v1` shape
- `toReceiptViewModel(order)` — maps an order into the receipt preview/print model
- `buildPayments(...)` — maps cash, credit, split, and saved receipt payment rows

When the final receipt/export/backend format is decided later, add a mapper at this layer instead of rewriting the POS screens.

The Back Office dashboard and Sales view read `hwpos.orders.v1`, so completed POS sales appear there without mock sales data. Inventory CSV import/export also uses the same product storage key as the POS.

## AI / data access

Both the POS and Back Office pages expose a read-only browser API for future AI analysis:

```js
window.HWPOS_AI.snapshot({ range: '30d' })
window.HWPOS_AI.metrics({ range: 'today' })
window.HWPOS_AI.collections()
window.HWPOS_AI.schema()
window.HWPOS_AI.health()
```

The snapshot includes normalized `products`, `folders`, `groups`, `orders`, `customers`, `settings`, and high-level metrics for sales, inventory, and customer balances. This is intentionally read-only so an AI connector can analyze the POS without scraping screen text or mutating business data.

## Barcode scanning

The Sell screen scan button opens a camera barcode scanner when the browser supports `BarcodeDetector` and camera access is available. Camera scanning requires a secure browser context, such as HTTPS. On unsupported browsers or non-HTTPS local network URLs, the scanner modal still allows manual barcode/SKU entry.

For the offline iPad/Android Capacitor wrapper, install a native scanner plugin and sync the app:

```bash
npm install @capacitor/barcode-scanner
npx cap sync
```

On iOS, add `NSCameraUsageDescription` to `Info.plist`. On Android, the official plugin requires `minSdkVersion = 26`. In Capacitor, the app tries the native barcode scanner first, then falls back to the web/manual scanner.

## Printing

Receipts open in a pop-up window sized for 80mm thermal paper and trigger `window.print()` automatically. Print to a paired AirPrint / Wi-Fi printer for best results.
