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

## State

All persistence is in `localStorage`. Keys:
- `hwpos.folders.v2` — product folders
- `hwpos.products.v2` — products
- `hwpos.groups.v1` — variant groups
- `hwpos.orders.v1` — completed sales
- `hwpos.orderSeq.v1` — order # counter
- `hwpos.tileSize`, `hwpos.showPrice` — UI prefs

## Printing

Receipts open in a pop-up window sized for 80mm thermal paper and trigger `window.print()` automatically. Print to a paired AirPrint / Wi-Fi printer for best results.
