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

Ring a trading day headless and reconcile it. `scripts/lib/till.mjs` boots the real `app.js`
in a `node:vm` behind a `localStorage` shim and a fake DOM, so sales, credit, splits, voids,
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

It also prints how long a month takes to ring as the history behind it grows. That curve is
the localStorage ceiling, measured rather than asserted: every sale re-serialises the whole
order list, so the cost per receipt climbs with the year. It is the argument for the D1
migration.

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

Settings > Printing picks one of three drivers (`hwpos.settings.v1` > `printing.driver`):

- **Browser** (default) — receipt opens in a pop-up sized for 80mm paper and calls `window.print()`.
- **Wi-Fi** — Epson ePOS-Print. `printer.js` POSTs ePOS-Print XML to `http://<ip>/cgi-bin/epos/service.cgi`. Works with TM-m30III, TM-m30II, TM-T88VI/VII and any Epson with the ePOS-Print service. **Scan** sweeps the /24 for printers; no SDK needed.
- **Bluetooth** — Web Bluetooth + raw ESC/POS bytes. **Pair** opens the browser's device chooser. BLE only, Chrome/Edge on Windows/Android; iOS Safari has no Web Bluetooth, and Bluetooth Classic (SPP) printers are unreachable from any browser.

Delivery receipts also print the **pinned map** (Settings > Printing > *Print delivery map*): the same OpenStreetMap tiles the on-screen receipt shows, composited and dithered to 1-bit for the thermal head. If the tiles can't be fetched the receipt still prints, just without the map.

`printer.js` is transport-only and standalone: `layout()` turns a receipt view model into one op list, `escpos()` and `eposXml()` encode it. `printOrder()` in `app.js` is the single entry point and falls back to the pop-up if the hardware fails. `printing.printOnSale` auto-prints only on the Wi-Fi/Bluetooth drivers.

The page must be served over `http://` for the Wi-Fi driver — an HTTPS page blocks plain-HTTP requests to the printer. But Web Bluetooth (and the camera scanner) require a *secure context*, which `http://<lan-ip>` is not, so a phone browser gets **either** Wi-Fi printing **or** Bluetooth, not both. Wrapping the app in Capacitor resolves this: set `androidScheme: 'http'` in `capacitor.config` and install `@capacitor-community/bluetooth-le`, then reimplement `pairBluetooth`/`btReady`/`btWriteChar` in `printer.js` against the plugin. The layout and encoders are transport-agnostic and stay as-is.

```bash
node scripts/printer-check.mjs   # layout wrapping, column math, both encoders, URL building
```
