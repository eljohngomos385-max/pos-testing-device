# Back office — what we're building

The architecture lives in `docs/architecture.md` ("Going online"). This file is the **feature spec**:
what each page has to do, and which decision has already been made so it doesn't get
re-litigated. Delete a section when it ships and the code becomes the spec.

Every table and column named below **already exists in `schema.sql` and `worker/index.js`**.
The database has not been created yet, so the schema was allowed to run ahead of the UI —
a column added today is free, and the same column added after go-live is a migration.

---

## Foundation — done, and what it decided

| Piece | File | State |
|---|---|---|
| Real URLs, URL-as-state | `router.js`, `backoffice.js` | **Done.** `/admin/sales?range=30d`, back/forward walk filters |
| SPA fallback | `scripts/serve.py`, `_redirects` | **Done.** Local server mirrors the Pages rule |
| Database schema | `schema.sql` | **Done** for SQLite/D1, applies clean. Moves to Supabase Postgres (owner 2026-09-25) |
| API | `worker/index.js` | **Done**, 10 checks pass, never deployed. **Retires**: no Worker, the apps talk to Supabase directly (owner 2026-10-02) |
| Checks | `scripts/worker-check.mjs` | **Done.** Real Worker against real SQLite |
| Wiring the app to it | `data-store.js` | **Local side done.** The till and back office persist through `HWPOS_STORE` (orders, stock movements and the ledger in IndexedDB, the rest `localStorage`). No network sync yet |
| Offline queue on the tablet | — | **Not started** |

**Blocked on the owner:** a free Supabase test project (its URL + anon key; never the service-role
key). The old D1 / `wrangler` steps are dead (Supabase Postgres + R2 over D1, 2026-09-25).

Until then everything below can be built against local storage through `HWPOS_STORE`, because
the store's surface is the same either way. **That is the point of the seam** — build the pages
now, flip the adapter later, don't touch the pages again.

### Decisions already made — don't reopen

- **Money is exact `numeric(12,2)` in Postgres** in the store's currency, no centavo conversion
  anywhere (owner 2026-10-02, replacing "centavos in the database, the Worker converts"). Never
  REAL/float. Until the schema moves, `schema.sql` and the Worker keep integer centavos.
- **Orders, the customer ledger and stock movements are append-only.** No page may offer an
  "edit this sale" button. A void, a refund and a correction are each a new row.
- **Stock is the sum of `stock_movements`.** `products.stock` is a cache the grid reads so the
  product list stays one query. Every screen that changes stock writes a movement with a `reason`.
- **Low stock is a query, not a flag.** `where stock <= danger_level`. Nothing sets "is low".
- **Category == `products.folder_id`.** The POS folders already group products; "sales by
  category" reads the same field. Do not add a second grouping concept. (An item sits in several
  since 2026-10-01: `category_ids`, `folder_id` the first — see Products.)
- **Every variant carries its own image.** `products.image_url` on the variant row wins; the
  group's image is the fallback for the variants that have none. Decided 2026-09-11 — a
  variant is a distinct thing on the shelf, and red paint does not look like white paint.
- **Products creates items; Inventory only moves stock.** Decided 2026-09-08. An item exists
  because someone added it in Products — that page owns name, pricing, margin, variants, barcode.
  Inventory never creates an item; it writes `stock_movements` and reads them back. This mirrors
  the data: one row in `products`, many rows in `stock_movements`.
- **A variant IS a product, and the grouping is a `product_groups` row.** Decided 2026-09-08.
  "Boysen Paint" is the group; "Boysen Paint Red" is a product carrying `group_id`, with its own
  price, SKU, barcode, cost and stock — because a variant has to be sellable, countable and
  orderable on its own. The group carries only the shared name and the one image. There is no
  `product_variants` table; don't add one.
- **Quantities are stored as INTEGER hundredths of a unit**, for the same reason money is stored
  as centavos: current stock is a SUM of `stock_movements.qty`, and a float sum of 0.01s drifts.
  0.01 is the finest step the UI offers (`stepFor`), so nothing is lost. The Worker converts
  (`TABLES[].scaled`), exactly like money — the client keeps working in whole units.
- **A movement records the cost at the time and who moved it.** `stock_movements.unit_cost` and
  `.staff`. Without the cost, every historical margin silently rewrites itself the next time a
  supplier re-prices; without the staff, "why does this say 12?" has no answer.
- **A void and a refund are new rows with their own sign.** `SalesMath.SIGN` (`sales-math.js`, read
  through `SalesMath.sign`) is the one definition: a sale (`completed`) +1, a `void` row −1, a
  `refund` row −1 (a return or exchange is a refund with a reason; a line refund carries only its
  lines), a parked cart 0. The sale itself is never edited; the new row points at it
  (`originalOrderId`), and old `voided`/`refunded`/`return` rows are rewritten on load (`upgradeOrders`). Nothing is
  ever filtered out of a cut — the sign is what keeps voids visible while stopping them inflating Net sales.
- **Every editor is a page at its own URL, never a modal.** Decided 2026-09-08.
  `/admin/products/p001`, `/admin/suppliers/po-0007`, `/admin/settings/staff?person=u003`: you click a thing and
  that thing becomes the page, like Shopify and Loyverse. It is also the smaller code — a modal
  needs open/close state, a focus trap, a scroll lock, a z-index and an unsaved-changes trap; a
  page is `if (state.detailId) renderEditor(); else renderList();`. The single exception is a
  one-item stock fix, which stays inline on the Inventory row *in addition to* the full
  `/admin/inventory/adjust/new` document.
- **Two different things are called "delivery"** and they must never be merged:
  `orders.delivery` is a customer's order going out; `purchase_orders` is stock coming in from a
  supplier. Suppliers › Incoming is the second one (the Dashboard's "Deliveries coming" card is gone).

---

## Sidebar — shipped

```
Dashboard · Sales · Orders · Items (Item list · Categories · Modifiers · Stock history) · Customers
Suppliers (Purchase orders · Incoming) · Settings (Staff & access inside)
```
Items is the `products` view, Orders `transactions`, Stock history `inventory`. Analytics
(`insights`) has no link today. Adding a view is one entry in `VIEWS` (`backoffice.js`)
plus the `.side-link[data-view]` and `.view[data-view]` markup — never a second list.

## Products — shipped

List at `/admin/products?q=&cat=&supplier=&level=out,low,dead` (`?view=stock` the Stock view; old
`low=1` still read), item page at `/admin/products/<id>`, editor at `/admin/products/<id>/edit`
(`new` for a new one). Every filter in the URL, like every other page.

**The editor is one 720px column of cards, Status alone on the right** (ported from
`product-edit-lab.html`, 2026-10-01; `pe-*` classes in `bo-products.css`):

1. **About** — photo (left), name, description
2. **Categories** — chips; an item sits in **several**. "Add “x”" in the picker makes a new one
3. **Price** (one product) or **Variants** (a family) — "Add variants" turns a product into a family
4. **Modifiers** — chips; the lists are made on the Modifiers page
5. **Stock** — on hand + Adjust, sold per (unit), low stock at, SKU, barcode, Track stock,
   Sell when out of stock
6. **Suppliers** — chips; tap one to make it the **main** (optional; the first one added is main)
7. **Specs** — weight, size, length

**Status** is Active / Hidden. Hidden keeps the item in the back office but takes it off the
till's tiles and search; a scan still finds it and asks "Sell anyway?". A family's status is all
of its variants'. **Locations** from the lab is dropped (one store per catalogue today).

**Settled 2026-10-01 (owner) — don't reopen:**
- **Several categories per item.** Sales counts an item in each of them, so category totals can
  add up past the store total. Deleting a category leaves its items alone; they only lose it.
  Stored as `category_ids` json on the product, not a link table: products sync as whole rows
  (last write wins), and a link table would need its own tombstones. Postgres reads it with jsonb
  and a GIN index. `folder_id` stays the first one for readers of one.
- **No variant photos.** One photo per product, on the family. Variants stay a flat list.
- **Modifiers** are lists of options (name + price), switched on per item, no stock. Back office
  only for now, but the rows are production shape: `modifier_lists`, ids on every option, prices
  in centavos inside the json.
- **Categories** and **Modifiers** are pages under Products, built like the Products list:
  table → row page. A category's page lists its items; "Add items" is a ticked table with Add
  top right.

- **Identity** — `name`, `title` (what the POS tile shows when it differs from the name),
  `sku`, `barcode`, `image_url`, `folder_id` (category), `supplier_id`.
- **How it is sold** — `unit`: **each** (pc, box, bag — whole numbers) or **by volume/measure**
  (m, kg, L — decimals allowed). This changes the qty keypad in the POS and whether a count of
  2.5 is legal, so it is a real switch, not a label.
- **Physical** — `weight`, `size`, `length`. Free text today ("3/4 in", "8 ft", "2.5kg");
  nothing computes on them. Split into number + unit only when a filter or a courier needs it.
- **Money** — `cost` (what we pay per unit) and `price`, plus **margin configured per item,
  two ways**:
  `margin_mode` is `'flat'` or `'percent'`, `margin_value` is centavos or basis points.
  `price` stays the authoritative number; margin is what recomputes it when `cost` changes.
  **Three fields, any two drive the third** — edit cost or margin and price follows; edit price
  and margin follows. Show the result both ways ("you make ₱45.00 · 25.0%") so it is never a
  mystery which one won.
- **Stock** — `stock`, `danger_level` (the reorder point that puts it on the low-stock list),
  and `sell_out_of_stock` — hardware stores sell what they haven't got yet and deliver Friday.
- **Variants** — **a variant IS a product row** carrying `group_id`; `product_groups` is the
  parent. There is no `product_variants` table and one must not be added (decided 2026-09-08).
  The group holds what the family shares (name, category, supplier, unit, image fallback); each
  variant holds its own `name`, `sku`, `barcode`, `cost`, `price`, `image_url` and stock.
  The list shows the family as ONE row — the variants appear when you open it.
- `archived` instead of delete. A product that has ever been sold must stay resolvable from
  an old receipt.

## Inventory — two pages, not one — shipped

Shipped as Items › Stock history (the log, `/admin/inventory`, adjust at `/admin/inventory/adjust/new`)
and the Stock view of the Item list (`/admin/products?view=stock`). The word covers two jobs that want different screens:

1. **Add / edit stock** — receiving, stock adjustment, counts. Every change writes a
   `stock_movements` row: `qty` signed, `reason` one of `sale | return | delivery | adjustment | count |
   transfer | shrinkage | damage | writeoff | opening` (`STOCK_REASONS`; a count is stored as its difference),
   `ref_id` pointing at the order or PO when there is one, and a `note`. The reason is the
   point — "why does this say 12?" has to be answerable.
2. **Inventory monitoring** — the read-only view. On-hand, value at cost, movement history,
   and the **danger-level list** (`stock <= danger_level`), which is the same list the dashboard
   card shows.

## Sales — shipped

Shipped as Sales › Summary | Items, with the ledger as its own Orders page. One page, several cuts of the same data. Tabs, not separate pages:

- **By item**, **by category** (`folder_id`), **by employee** — the Summary's Staff card
  (`sellerOf`: a reversal counts against the original seller)
- **Recent transactions** — the full pageable ledger, now the Orders page
  (`/admin/transactions?pay=&staff=&ful=`). The dashboard shows 20; this is where you
  page through everything.
- **Filters: payment type and employee**, and they belong in the URL like every other filter
  (`/admin/sales?by=item&pay=gcash&staff=...`) so a link reproduces the screen.
- Voids and refunds stay visible in every cut. Never quietly filter them out.

## Suppliers — shipped

- Supplier records — `suppliers`.
- **Purchase orders** — `purchase_orders` + `purchase_order_items`. Status runs
  `draft → ordered → partial → received`, or `cancelled`. Receiving a PO writes
  `stock_movements` with `reason: 'delivery'`; it does not set stock directly.
- **The lineup of what's coming** — `where status in ('ordered','partial') order by expected_at`.
  This is Suppliers › Incoming (Due from `SUP_RULES.dueDate`); the dashboard's "Deliveries
  coming" card is gone.

## Staff and page access — configured, not enforced

Settings › Staff & access stores it (`hwpos.access.v1`, `bo-staff.js`); nothing checks it yet —
there is no login. The server check is Supabase row-level security now that the Worker retires
(2026-10-02).

- Which pages a person can open. Configured, not derived — a short table of role → views,
  checked on the server as well as reflected in the sidebar.
- **The grain is the page, not the row.** Employees are trusted staff in a physical shop.
  The front end hiding a link is cosmetic; the server refusing the request is the control.
  If a requirement ever genuinely needs one employee unable to read another's rows, that is a
  new decision, not a tweak.

## BIR compliance (Philippines)

This is what sets the product apart in the PH. Loyverse is free and not BIR-compliant. UTAK,
Qashier and StoreHub charge monthly largely because they are compliant. Rules from RMO 9-2021 and
the EOPT Act; research done 2026-09-30.

- **Gap-free invoice numbers per terminal.** One unbroken sequence per machine. A void keeps its
  number and gets a new void row, so no number is ever skipped or reused. A wiped device must not
  restart the count: the sequence belongs to the server, not to `localStorage`. This replaces
  today's `<register>-<seq>`.
- **Grand total that can never be reset, per terminal.** A running lifetime total of sales,
  printed on every Z-reading. It only ever goes up.
- **X-reading and Z-reading.** An X-reading is a mid-day report that doesn't close anything. A
  Z-reading closes the day and bumps a reset counter. Both show:
  - the first and last invoice numbers;
  - gross sales, VAT-able, VAT-exempt and zero-rated sales, and the VAT amount;
  - voids, returns and discounts, with SC/PWD as its own line;
  - the grand total before and after.

  Pairs with cash drawer sessions (gap 1 below). The Z-reading is the drawer close.
- **SC/PWD discount.** Remove the 12% VAT first, then take 20% off the VAT-exclusive price.
  Record the customer's ID number and name on the order. Itemise the discount on the invoice.
  Add an SC/PWD sales report to the Sales page. This is not one of the existing price tiers:
  the VAT is computed differently.
- **Void and return reports.** A list of every void and return, with the cashier, the reason
  and the original invoice. The append-only order log already holds all of this.
- **"Invoice", not "Official Receipt".** The EOPT Act (April 2024) renamed it. The receipt
  footer in `app.js` and `printer.js` still says "official receipt".
  - **Header:** the Machine Identification Number (MIN), the serial number (or the software
    licence number) and the store's VAT REG TIN with its branch code.
  - **Footer:** the developer's name, TIN and accreditation number with its dates, and the
    PTU number.
  - **Invoice number:** a zero-padded series of at least 6 digits, separate from the order ID.
  - **Reprints** print "REPRINT" with the date and time.
- **EIS e-invoicing, due 31 Dec 2026** for taxpayers above micro size (the exact threshold is
  still to be confirmed). Each invoice is sent to BIR's EIS. When offline, the store issues
  manual invoices, then replaces each with an e-invoice that references it. This fits the POS
  offline queue (step 7), since every order already carries a UUID.
- **Also checked at the demo (RMO 24-2023):**
  - no training or "no sale" mode in production;
  - an activity log of who, what, value and time, including remote access by the developer;
  - a daily e-journal in a single .txt file;
  - no sales can be posted to a business date after its Z-reading;
  - the grand total has at least 12 digits;
  - a BIR Sales Summary report;
  - sales books for SC, PWD, NAAC and Solo Parent discounts.
- **Accreditation (RMO 24-2023).** Free, and done by the developer:
  1. Register the business: DTI or SEC, then BIR Form 2303.
  2. Enrol in eAccReg with a sworn declaration.
  3. Apply online and file the Annex B documents at the RDO (the BIR district office).
  4. Give a live demo to the BIR's Technical Working Group.
  5. The Certificate of Accreditation follows within about 20 working days.

  The developer's eAccReg account then files a free Permit to Use (PTU) for each store's
  terminal. A major version change needs reaccreditation. Still to be confirmed: the current
  Annex B document list, and whether a browser app on a tablet passes the storage and
  tamper-proofing checks.

---

## Build order

Foundation first, because each step below is cheaper once the one above is real:

1. **Products** — list then editor. The biggest single piece, and every other page reads it. *Shipped.*
2. **Inventory** — stock adjustment, then monitoring. Needs products to exist first. *Shipped.*
3. **Sales** — four tabs. Pure read, no new writes, so it is the fastest of the four. *Shipped.*
4. **Suppliers + purchase orders.** *Shipped.*
5. **Staff / page access.** *Shipped client-side; enforced once step 6 lands.*
6. `data-store.js` → Supabase directly (no Worker), once the owner has the test project above. Can
   happen any time from here; the pages do not change when it does.
7. **POS offline queue and push.** Last, because it needs the API settled and the tablets are the
   part that must not break.
8. **BIR compliance.** SC/PWD and the "Invoice" wording can ship any time. Gap-free numbers,
   the grand total and EIS need the server (step 6) to own the sequence. Must be done before
   the first PH store goes live.

---

## Where it stands, and what is still missing

Written after a full trading year was rung through the real `app.js` headless
(`node scripts/till-year.mjs`) and reconciled three ways. **3,729 receipts across 313 trading
days, ₱9.06M revenue, 16.25% gross margin.** Stock agrees with the movement log agrees with what
was sold; the drawer agrees with the cash legs; the customer ledgers explain every peso of every
balance; and all four Sales cuts sum back to the summary. A product priced at 25% over cost and a
product priced at a flat +₱50 over the same cost land on the same shelf price and the same profit,
which is the point of having two margin modes at all.

### The ceiling we already hit — this is the case for a real database

A month of trading takes **2.0 seconds to ring in September and 32 seconds in August**. Same work,
16× the time, purely because the order history in front of it got longer:

| trading day | receipts | orders on disk | time to ring that month |
|---|---|---|---|
| 30 | 338 | 411 KB | 2.0 s |
| 90 | 956 | 1.1 MB | 10.6 s |
| 180 | 1,830 | 2.1 MB | 16.2 s |
| 270 | 2,737 | 3.2 MB | 23.5 s |
| 360 | 3,682 | 4.4 MB | 32.1 s |

The cause is not the UI. Every sale reads the entire order list out of `localStorage`, appends one
row, and writes the entire list back — so the cost of ringing receipt *n* is proportional to *n*.
Four megabytes of orders after one year, against a `localStorage` quota of five. **A second year
does not fit**, and the last months of the first one already feel slow on a tablet.

Since 2026-10-02 orders, stock movements and the customer ledger live in IndexedDB
(`data-store.js`), so the 5 MB quota no longer stops a till — but each save still rewrites the
whole list, so ringing receipt *n* still costs *n*.

Nothing in the UI fixes this. Step 6 of the build order — `data-store.js` → Supabase —
is what fixes it, because an insert is an insert regardless of how many rows are already there.

### Gaps worth naming

Ordered by what a real hardware store notices first:

1. **Cash drawer sessions.** There is no open/close, no declared float, no blind count, no
   over/short. The day's cash is derived from the receipts, which means it can only ever agree
   with itself — the number that catches theft is the one the cashier counts by hand and the
   system compares. This is the single biggest gap for a shop with staff.
2. ~~**Returns are whole receipts.**~~ *Shipped:* line refunds (`SalesMath.refundPart`, `qtyLeft`);
   the sale reads "Part refunded" until every line is back. Each refund row points at its
   original (`originalOrderId`).
3. **BIR compliance.** No gap-free invoice numbers, no Z-reading, no SC/PWD discount. See
   "BIR compliance" above.
4. **Unit-of-measure conversion.** Cement is bought by the pallet and sold by the bag; wire is
   bought on a 100 m roll and sold by the metre. Purchasing and selling use the same unit today,
   so a PO in rolls has to be typed in metres.
5. **Locations on movements.** `stock_movements` has no location column, so multi-store stock is
   one pool. Multi-store is otherwise already a filter (`store_id` is on every row), so this is
   the one place the multi-store design is not finished.
6. **Min *and* max reorder levels.** `reorderPoint` says when to buy, nothing says how much.
   A new PO already fills itself with what is out or low (`buyingList`), but the quantity is a
   placeholder top-up (`suggestQty`, twice the reorder point) until a max level exists.
7. **Price tiers are invisible in reporting.** Contractor 5% / wholesale 10% work and are applied
   automatically at checkout, and the profit maths is right because the back office sees them as
   an ordinary receipt discount. But `cartDiscount.tierType` is stored on every order and nothing
   reports on it — nobody can ask what the trade discount cost this year. One more cut on the
   Sales page, not a data change.

### What "Palantir level" would actually mean here

Not more screens. The things that would separate this from every other POS in the province:

- **The numbers explain themselves.** Every figure on every screen should be clickable down to
  the receipts behind it, and the append-only design already makes that possible — nothing is
  overwritten, so every total has a list underneath it. That is the one architectural advantage
  this codebase already has over the competition, and it is currently unexploited.
- **Reorder proposals, not low-stock lists.** With movement history you can see the rate a SKU
  sells at and how long its supplier actually takes to deliver, and put a quantity and a date on
  the suggestion. That needs gap 6 and PO receipt dates, both cheap.
- **Anomaly flags on the day, not reports at month end.** Voids concentrated on one cashier,
  discounts above the tier they are entitled to give, counts that keep being corrected on the
  same SKU. All of it is already in `stock_movements` and the order log; none of it is looked at.
