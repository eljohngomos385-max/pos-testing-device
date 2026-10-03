# EJ Hardware POS

A vanilla HTML/CSS/JS point-of-sale web app for a Philippine family-owned hardware store, designed to replace Loyverse. No build step — open `index.html` in a browser, or serve it (below).

## Files

- `index.html` — the till (Sell, Orders, Items, Customers, Checkout, Settings; Reports exists but no role shows it)
- Shared scripts, loaded first by both pages: `sales-math.js` (`SalesMath`, the one money/quantity module — totals, VAT, tenders, `qtyText`, receipt footer) → `data-store.js` (`HWPOS_STORE`, storage keys, `HWPOS_AI`) → `data.js` (seed products, folders, groups, customers) → `bo-model.js` (shared model: stock from the movement log, fulfilment labels)
- `index.html` then loads `vendor/zxing-browser.min.js` (scanner fallback) and `printer.js`, then the till's logic, one classic script per screen, in this order (one global scope, no modules):
  - `pos-core.js` — state, storage, helpers, persistence, the order format, roles, view switching, `peso()`
  - `pos-sell.js` — Sell: item grid, variant picker, cart, barcode, cart sidebar (discounts, fulfilment, delivery map, customer), lost sale
  - `pos-checkout.js` — Checkout: payment, the order record, stock moves, printing, saved receipts, account credit, PIN, `completeSale`
  - `pos-orders.js` — Orders: rail, receipt preview, order details, delivery trip, 80mm receipt, void / refund / exchange
  - `pos-items.js` — Items: catalog list and item editor (Save not wired yet)
  - `pos-customers.js` — Customers (and the hidden Reports page)
  - `pos-settings.js` — Settings and the cash drawer count
  - `app.js` — boot, loads last: every click handler (`attachEvents`) and `init()`
- `printer.js` — direct receipt printing (Wi-Fi / Bluetooth), see Printing below
- `styles.css` — all till styling (the back office loads it too)
- `backoffice.html` — the back office, served at `/admin` (`_redirects`). Loads the shared scripts, then `router.js` → `backoffice.js` (shell, `peso()`, dashboard, settings, backup) → `bo-products.js` → `bo-catalog.js` → `bo-item.js` → `bo-insights.js` → `bo-inventory.js` → `bo-sales.js` → `bo-transactions.js` → `bo-suppliers.js` → `bo-staff.js`; styles in `bo-*.css`. See `docs/backoffice.md`.
- `worker/` + `schema.sql` — the existing Cloudflare Worker sync API and its D1 schema (integer centavos). Supabase Postgres replaces them, no Worker; see `docs/architecture.md`
- `docs/` — conventions per area (see `CLAUDE.md` for which to read first)
- `catalog.csv` — source catalog for seeding
- `scripts/` — checks, simulations and dev data (below)

## Run locally

```bash
py scripts/serve.py 8080
```

Then open `http://localhost:8080/` (till) and `http://localhost:8080/admin` (back office). The back office uses absolute paths and `/admin/...` routes, so a plain static server (`npx serve`, `http.server`) won't route it. `serve.py` also serves `/demo` (six months of generated data, in memory only; `/demo/off` ends it) and `/seed` (runs `scripts/seed-year.js`, for devices without a console). Default port is 8765.

## Verify

Syntax-check the browser scripts:

```bash
for f in pos-*.js app.js sales-math.js data-store.js bo-model.js printer.js; do node --check "$f"; done
node --check backoffice.js
```

Check the replaceable order/receipt mapper:

```bash
node scripts/verify-order-format.mjs
```

Ring a trading day headless and reconcile it. `scripts/lib/till.mjs` boots the real till scripts
(`sales-math.js`, `data-store.js`, `data.js`, `bo-model.js`, then `pos-*.js` + `app.js`, the list read off `index.html`) in a `node:vm` behind a `localStorage` shim and a fake DOM, so sales, credit, splits, voids,
refunds, returns and exchanges can be driven from Node without a browser; `till-run.mjs` rings
a day, then adds the books up a second time from what it knows it rang and compares. Stock
(cached field vs the movement log vs what was sold), revenue by status, the customer ledger
against the stored balance, and the cash drawer all have to agree:

```bash
node scripts/till-run.mjs --verbose
```

Then a whole trading year through the same till -- 365 days on a moving clock, closed Sundays,
busier on payday and Saturdays, restocking when the shelf runs low, with reversals scattered
through. The year's receipts are then fed to the real Back Office aggregator (`bo-sales.js`)
and every cut -- by item, by category, by employee, by payment type -- has to sum back to the
summary. Two products are priced to the same shelf price by different margin modes (25% over
cost, and a flat markup) so only the profit maths can tell them apart:

```bash
node scripts/till-year.mjs --verbose          # ~5 min; --days=40 for a quick pass
```

The year ends on the buying half of the loop: whatever the twelve months left below its danger
level becomes a real purchase order, the delivery arrives short on one line, and the shelf, the
movement log and the PO status all have to still agree afterwards -- the PO stays `partial` and
outstanding by exactly the units that never came.

It also prints how long a month takes to ring as the history behind it grows: every sale
re-serialises the whole order list, so the cost per receipt climbs with the year. The harness
runs on its `localStorage` shim (no IndexedDB). On the till, orders live in IndexedDB
(`hwpos-sheets`), which lifts the 5 MB cap but still rewrites the whole list per save, so the
curve still holds; `sheets-check` covers that path.

Run a bulk same-day POS stress simulation:

```bash
node scripts/stress-day.mjs --transactions=1000
```

Run targeted hardening checks (Edge) for scanner fallback, delivery pin/map, offline sales, saved receipts, reload persistence, cashier void denial, void/refund/exchange stock, the credit ledger, receipt search, Back Office dashboard visibility, and full backup/restore. OpenStreetMap tile 400s are ignored on purpose:

```bash
node scripts/hardening-check.mjs
```

Run an independent math audit (Edge) for basket totals, discounts, VAT, cash/change, split/credit payments, stock deltas, refunds/voids/exchanges, customer balances, and AI/report totals. It is flaky under load; see `CLAUDE.md`:

```bash
node scripts/math-audit.mjs --iterations=1000
```

The other checks, each `node scripts/<name>`:

- `sales-math-check.mjs` — the SalesMath ladder on hand-worked orders
- `reversal-check.mjs` — voids and refunds
- `customer-ledger-check.mjs` — customer balance = the ledger, through the till harness
- `qty-check.mjs` — no `parseInt` quantities in the till scripts
- `words-check.mjs` — retired sales words stay retired
- `sheets-check.mjs` — the IndexedDB sheets in Edge: migration, reload, >5 MB, a second tab, failures
- `events-check.mjs` — the till event stream (fake IndexedDB)
- `printer-check.mjs` — receipt layout and both encoders
- `sales-check.mjs` — Back Office Sales against `SalesMath.summarize`
- `insights-check.mjs`, `inventory-check.mjs` — Insights and Inventory maths
- `products-check.mjs` — product CSV round trip, cost / margin / price
- `purchase-order-check.mjs` — the buying list and per-line receiving
- `suppliers-check.mjs` — PO receiving
- `staff-check.mjs` — PIN clashes
- `sim-year.mjs` — a year through `bo-model` against an independent centavo count
- `worker-check.mjs` — `worker/index.js` on `node:sqlite`
- `design-check.mjs` — Back Office calm pages against their Sep-26 labs. **Stale**: fails on redesigned screens.
- `stress/till-safety.mjs` (Edge on :8772 + the Worker; **5 known pre-existing failures**), `stress/events-fuzz.mjs`, `stress/events-million.mjs`

Dev data: `scripts/demo-fill.js` (in-memory demo, `/demo`) and `scripts/seed-year.js` (`/seed`).

## State

Persistence goes through `HWPOS_STORE.kv` (data-store.js; the full list is `HWPOS_STORAGE_KEYS`, field meanings in `docs/data-dictionary.md`). Orders, stock movements and the customer ledger live in IndexedDB (`hwpos-sheets`, no 5 MB cap); the till event stream is in IndexedDB `hwpos-events`; everything else is `localStorage`. Keys:
- `hwpos.folders.v2` — product folders (the till shows no folders now; only `all`)
- `hwpos.products.v2` — products
- `hwpos.groups.v1` — variant groups
- `hwpos.orders.v1` — saved receipts, sales, and voids/refunds (each a new row)
- `hwpos.orderSeq.v1` — order # counter
- `hwpos.customers.v1` — saved customers and local credit balances
- `hwpos.customerLedger.v1` — credit charges and customer payments
- `hwpos.stockMovements.v1` — stock changes (stock = their sum); `hwpos.stockAnchored.v1` — when saved counts became opening rows
- `hwpos.settings.v1` — store, sync, tax, and printing settings
- `hwpos.role.v1` — the signed-in role on this device
- Back office: `hwpos.purchaseOrders.v1`, `hwpos.suppliers.v1`, `hwpos.modifiers.v1`, `hwpos.staff.v1`, `hwpos.tillPerms.v1`, `hwpos.adjustments.v1`, `hwpos.access.v1`
- Append-only logs: `hwpos.priceLog.v1`, `hwpos.lostDemand.v1`, `hwpos.deliveryEvents.v1`, `hwpos.supplierMessages.v1`, `hwpos.decisions.v1`
- `hwpos.tillEvents.fallback.v1`, `hwpos.tillEvents.dropped.v1` — catch the event stream when IndexedDB can't
- `hwpos.tileSize`, `hwpos.showPrice`, `hwpos.theme` — UI prefs; `hwpos.tileText` — per-till tile text size (pos-core.js only)

Back Office → Settings → Backup exports/restores a full local JSON backup: every key above except `role` and the two till-event fallbacks (the event stream itself isn't in it), plus the customers-migrated flag. There is no drawer closeout; it was removed on purpose.

## Order format

Orders are normalized before they are saved or rendered. The current canonical format is exposed in `pos-core.js` as `window.HWPOS_ORDER_FORMAT`:

- `schemaVersion` (`SalesMath.ORDER_VERSION`, now 2) and `formatKey` (`hwpos.order.v1`)
- `normalizeOrder(raw)` — accepts old/imported/future order shapes and returns the current shape
- `toReceiptViewModel(order)` — maps an order into the receipt preview/print model
- `buildPayments(...)` — maps cash, credit, split, and saved receipt payment rows

When the final receipt/export/backend format is decided later, add a mapper at this layer instead of rewriting the POS screens.

The Back Office dashboard and Sales view read `hwpos.orders.v1`, so completed POS sales appear there without mock sales data. Product CSV import/export (Back Office → Products) uses the same product storage key as the POS.

## AI / data access

`data-store.js` defines a read-only browser API, so both the POS and Back Office pages have it:

```js
window.HWPOS_AI.snapshot({ range: '30d' })
window.HWPOS_AI.metrics({ range: 'today' })
window.HWPOS_AI.collections()
window.HWPOS_AI.schema()
window.HWPOS_AI.health()
await window.HWPOS_AI.tillEvents({ since, type, limit })   // the IndexedDB event stream
window.HWPOS_AI.dictionaryUrl                              // docs/data-dictionary.md
```

The snapshot includes normalized `products`, `folders`, `groups`, `orders`, `customers`, `customerLedger`, `settings`, every back-office list (staff without PINs), high-level metrics for sales, inventory and customer balances, and, on the back office, Insights. This is intentionally read-only so an AI connector can analyze the POS without scraping screen text or mutating business data.

## Barcode scanning

The Sell screen scan button opens a camera barcode scanner: `BarcodeDetector` where the browser has it, else the bundled ZXing (`vendor/zxing-browser.min.js`). Camera scanning requires a secure browser context, such as HTTPS; without one the modal says so. Manual barcode/SKU entry always works.

For the offline iPad/Android Capacitor wrapper, install a native scanner plugin and sync the app:

```bash
npm install @capacitor/barcode-scanner
npx cap sync
```

On iOS, add `NSCameraUsageDescription` to `Info.plist`. On Android, the official plugin requires `minSdkVersion = 26`. In Capacitor, the app tries the native barcode scanner first, then falls back to the web/manual scanner.

## Printing

Three drivers (`hwpos.settings.v1` > `printing.driver`). The till's Settings > Printing panel (driver, IP, Scan, Pair, cut, map) is **not in `index.html` right now**: it went in 81f4e8a, and its handlers in `app.js` / `pos-settings.js` are null-safe leftovers. So the driver stays `browser` unless set in storage. Back Office > Settings > Receipt & printing sets width, print on sale and logo.

- **Browser** (default) — receipt opens in a pop-up sized for 80mm paper and calls `window.print()`.
- **Wi-Fi** — Epson ePOS-Print. `printer.js` POSTs ePOS-Print XML to `http://<ip>/cgi-bin/epos/service.cgi`. Works with TM-m30III, TM-m30II, TM-T88VI/VII and any Epson with the ePOS-Print service. **Scan** sweeps the /24 for printers; no SDK needed.
- **Bluetooth** — Web Bluetooth + raw ESC/POS bytes. **Pair** opens the browser's device chooser. BLE only, Chrome/Edge on Windows/Android; iOS Safari has no Web Bluetooth, and Bluetooth Classic (SPP) printers are unreachable from any browser.

Delivery receipts also print the **pinned map** (`printing.mapOnReceipt`, on by default): the same OpenStreetMap tiles the on-screen receipt shows, composited and dithered to 1-bit for the thermal head. If the tiles can't be fetched the receipt still prints, just without the map.

`printer.js` is transport-only and standalone: `layout()` turns a receipt view model into one op list, `escpos()` and `eposXml()` encode it. `printOrder()` in `pos-checkout.js` is the single entry point. A hardware failure shows the real error and does **not** fall back to the pop-up (see `docs/printing.md`). `printing.printOnSale` auto-prints only on the Wi-Fi/Bluetooth drivers.

The page must be served over `http://` for the Wi-Fi driver — an HTTPS page blocks plain-HTTP requests to the printer. But Web Bluetooth (and the camera scanner) require a *secure context*, which `http://<lan-ip>` is not, so a phone browser gets **either** Wi-Fi printing **or** Bluetooth, not both. Wrapping the app in Capacitor resolves this: set `androidScheme: 'http'` in `capacitor.config` and install `@capacitor-community/bluetooth-le`, then reimplement `pairBluetooth`/`btReady`/`btWriteChar` in `printer.js` against the plugin. The layout and encoders are transport-agnostic and stay as-is.

```bash
node scripts/printer-check.mjs   # layout wrapping, column math, both encoders, URL building
```
