# Back office — what we're building

The architecture lives in `CLAUDE.md` ("Going online"). This file is the **feature spec**:
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
| Database schema | `schema.sql` | **Done.** SQLite/D1, applies clean |
| API | `worker/index.js` | **Done.** 10 checks pass, not yet deployed |
| Checks | `scripts/worker-check.mjs` | **Done.** Real Worker against real SQLite |
| Wiring the app to it | `data-store.js` | **Not started.** Still dead code; `app.js` reads `localStorage` |
| Offline queue on the tablet | — | **Not started** |

**Blocked on three things only you can do**, in order:
1. `cd worker && wrangler d1 create hwpos` → paste the id into `wrangler.toml`
2. `wrangler d1 execute hwpos --file=../schema.sql`
3. A Supabase project (auth only, empty database) → `wrangler secret put SUPABASE_JWT_SECRET`

Until then everything below can be built against `localStorage` through `HWPOS_STORE`, because
the store's surface is the same either way. **That is the point of the seam** — build the pages
now, flip the adapter later, don't touch the pages again.

### Decisions already made — don't reopen

- **Money is pesos in the UI, centavos in the database.** The Worker converts. Never do it twice.
- **Orders, the customer ledger and stock movements are append-only.** No page may offer an
  "edit this sale" button. A void, a refund and a correction are each a new row.
- **Stock is the sum of `stock_movements`.** `products.stock` is a cache the grid reads so the
  product list stays one query. Every screen that changes stock writes a movement with a `reason`.
- **Low stock is a query, not a flag.** `where stock <= danger_level`. Nothing sets "is low".
- **Category == `products.folder_id`.** The POS folders already group products; "sales by
  category" reads the same field. Do not add a second grouping concept.
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
- **A void, a refund and a return are three different signs.** `SALE_SIGN` in `backoffice.js` is
  the one definition: `completed` +1, `return` −1, `refunded`/`voided`/`saved` 0. `app.js` flips
  the original order to refunded in place *and* appends a new `return` row, so counting the
  refunded original as well would reverse the sale twice. Nothing is ever filtered out of a cut —
  the sign is what keeps voids visible while stopping them inflating revenue.
- **Every editor is a page at its own URL, never a modal.** Decided 2026-09-08.
  `/admin/products/p001`, `/admin/suppliers/po-0007`, `/admin/staff/u003`: you click a thing and
  that thing becomes the page, like Shopify and Loyverse. It is also the smaller code — a modal
  needs open/close state, a focus trap, a scroll lock, a z-index and an unsaved-changes trap; a
  page is `if (state.detailId) renderEditor(); else renderList();`. The single exception is a
  one-item stock fix, which stays inline on the Inventory row *in addition to* the full
  `/admin/inventory/adjust/new` document.
- **Two different things are called "delivery"** and they must never be merged:
  `orders.delivery` is a customer's order going out; `purchase_orders` is stock coming in from a
  supplier. The dashboard's "Deliveries coming" card is the second one.

---

## Sidebar after this work

```
Dashboard · Sales · Products · Inventory · Customers · Suppliers · Staff · Settings
```
`Products` is new; `Inventory` narrows to stock. Adding a view is one entry in `VIEW_LABELS`
plus the `.side-link[data-view]` and `.view[data-view]` markup — never a second list.

## Products

List at `/admin/products?q=&cat=&supplier=&low=1`, editor at `/admin/products/<id>`.
Every filter in the URL, like every other page.

**The editor is six cards down the page** (`.bo-card` → `.bo-card-head` → `.bo-card-inset`):

1. **Details** — name, title, category (`folder_id`), supplier, one image
2. **Sold as** — each vs by measure
3. **Pricing** — cost, margin mode toggle, price
4. **Inventory** — quantity, danger level, sell-when-out-of-stock, SKU, barcode
5. **Variants** — add variant → name + price (+ own SKU/barcode/stock)
6. **Specs** — weight, size, length

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

## Inventory — two pages, not one

The word covers two jobs that want different screens:

1. **Add / edit stock** — receiving, stock adjustment, counts. Every change writes a
   `stock_movements` row: `qty` signed, `reason` one of `sale | return | delivery | adjustment | count`,
   `ref_id` pointing at the order or PO when there is one, and a `note`. The reason is the
   point — "why does this say 12?" has to be answerable.
2. **Inventory monitoring** — the read-only view. On-hand, value at cost, movement history,
   and the **danger-level list** (`stock <= danger_level`), which is the same list the dashboard
   card shows.

## Sales

One page, several cuts of the same data. Tabs, not separate pages:

- **By item**, **by category** (`folder_id`), **by employee** (`orders.cashier`)
- **Recent transactions** — the full pageable ledger. The dashboard shows 12; this is where you
  page through everything.
- **Filters: payment type and employee**, and they belong in the URL like every other filter
  (`/admin/sales?by=item&pay=gcash&staff=...`) so a link reproduces the screen.
- Voids and refunds stay visible in every cut. Never quietly filter them out.

## Suppliers

- Supplier records — `suppliers`.
- **Purchase orders** — `purchase_orders` + `purchase_order_items`. Status runs
  `draft → ordered → partial → received`, or `cancelled`. Receiving a PO writes
  `stock_movements` with `reason: 'delivery'`; it does not set stock directly.
- **The lineup of what's coming** — `where status in ('ordered','partial') order by expected_at`.
  This is exactly what the dashboard's "Deliveries coming" card renders, which is why that card
  is currently an empty state: there are no purchase orders yet.

## Staff and page access

- Which pages a person can open. Configured, not derived — a short table of role → views,
  checked in the Worker as well as reflected in the sidebar.
- **The grain is the page, not the row.** Employees are trusted staff in a physical shop.
  The front end hiding a link is cosmetic; the Worker refusing the route is the control.
  If a requirement ever genuinely needs one employee unable to read another's rows, that is a
  new decision, not a tweak.

---

## Build order

Foundation first, because each step below is cheaper once the one above is real:

1. **Products** — list then editor. The biggest single piece, and every other page reads it.
2. **Inventory** — stock adjustment, then monitoring. Needs products to exist first.
3. **Sales** — four tabs. Pure read, no new writes, so it is the fastest of the four.
4. **Suppliers + purchase orders** — kills the last dashboard stub ("Deliveries coming").
5. **Staff / page access.**
6. `data-store.js` → the Worker, once you have run the three `wrangler` commands above. Can happen
   any time from here; the pages do not change when it does.
7. **POS offline queue and push.** Last, because it needs the API settled and the tablets are the
   part that must not break.

---

## Where it stands, and what is still missing

Written after a full trading year was rung through the real `app.js` headless
(`node scripts/till-year.mjs`) and reconciled three ways. **3,729 receipts across 313 trading
days, ₱9.06M revenue, 16.25% gross margin.** Stock agrees with the movement log agrees with what
was sold; the drawer agrees with the cash legs; the customer ledgers explain every peso of every
balance; and all four Sales cuts sum back to the summary. A product priced at 25% over cost and a
product priced at a flat +₱50 over the same cost land on the same shelf price and the same profit,
which is the point of having two margin modes at all.

### The ceiling we already hit — this is the case for D1

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

Nothing in the UI fixes this. Step 6 of the build order — `data-store.js` → the Worker → D1 —
is what fixes it, because an insert is an insert regardless of how many rows are already there.
Until then, one store gets roughly one year per terminal.

### Gaps worth naming

Ordered by what a real hardware store notices first:

1. **Cash drawer sessions.** There is no open/close, no declared float, no blind count, no
   over/short. The day's cash is derived from the receipts, which means it can only ever agree
   with itself — the number that catches theft is the one the cashier counts by hand and the
   system compares. This is the single biggest gap for a shop with staff.
2. **Returns are whole receipts.** A customer bringing back one of four bags gets the entire sale
   reversed. The return row already points at its original (`originalOrderId`), so the shape is
   right; the missing part is per-line quantities on the return.
3. **BIR sequential invoice numbering.** Receipt numbers are `<register>-<seq>` per device. A BIR
   registered POS needs an unbroken, gap-free sequence per machine with the gaps themselves
   auditable. Right now a wiped device restarts from whatever the stored counter says.
4. **Unit-of-measure conversion.** Cement is bought by the pallet and sold by the bag; wire is
   bought on a 100 m roll and sold by the metre. Purchasing and selling use the same unit today,
   so a PO in rolls has to be typed in metres.
5. **Locations on movements.** `stock_movements` has no location column, so multi-store stock is
   one pool. Multi-store is otherwise already a filter (`store_id` is on every row), so this is
   the one place the multi-store design is not finished.
6. **Min *and* max reorder levels.** `reorderPoint` says when to buy, nothing says how much.
   "Needs buying" can list what is low but cannot propose a quantity, which is what would let it
   generate a draft PO instead of a shopping list.
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
