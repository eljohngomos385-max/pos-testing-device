# Going online — target architecture

Read this before any structural change: it is what decides whether a change is cheap or a
migration. `ROADMAP.md` is the feature spec and carries the decisions settled per page.

---

Not a local app. **The shape of the whole system:**

```
  tablets running the POS  ──sales──►  Supabase Postgres  ◄──edits──  back office
  (one per till, several                the database                     (the dashboard,
   per store, offline-capable)                                            opened by staff at
                                                                          different access levels)
```

**Sync runs both ways, and each direction has a different owner. Get this wrong and data is lost.**

- **Down — the dashboard is the source of truth.** Products, prices, cost, margins, categories,
  variants, staff, permissions, store settings. Someone edits a price in the back office and every
  tablet picks it up. Tablets **read** this; they don't own it. A tablet must never be able to
  overwrite the catalog.
- **Up — the till is the source of truth.** Orders, payments, and the stock movements a sale causes.
  These are **created** on the tablet and only ever appended. The dashboard reads and reports on
  them; it does not author them. An order is never edited to "fix" it — a void or a refund is
  another event.

So "the dashboard is the source of truth" means **for the catalog and the configuration**. For what
was actually sold, the till is, because that's where it happened and the tablet may have been
offline when it did.

**Access is page-level, decided server-side.** Staff open the same back office and see different
pages. The front end hiding a link is not the control — the server refuses the request (today's D1
Worker; Supabase row-level security per store once Phase 5 lands) — but the grain is the page, not
the row (see the access rule below).

Every structural decision is made against this diagram, not against localStorage.

**The stack — Supabase Postgres + R2 (owner, 2026-09-25), no Worker (2026-10-02). Not connected
yet:** the Supabase project does not exist, and every till and the back office run on the device.
Connecting is Phase 5 of the vault's `plans/data-core-rebuild.md` and waits on the owner's go.
- **Cloudflare Pages** hosts the static site. SPA routing needs one `_redirects` line
  (`/admin/*  /backoffice.html  200`); `scripts/serve.py` is the local stand-in for that rule.
- **Supabase Postgres** is the database. The apps talk to it directly through its built-in API,
  with row-level security on `store_id`; there is no API of our own to deploy.
- **Supabase Auth** is the login. Chosen over Cloudflare Access because Access authenticates a
  *browser session* (usually an emailed one-time PIN), and a shop-floor tablet must not need
  someone's inbox to reopen the POS. A Supabase refresh token keeps the till signed in indefinitely.
- **Cloudflare R2** archives what nobody queries: rolled-up orders and old `till_events`. Cheap, no
  egress, and BIR wants 10 years.

**Today's `schema.sql` and `worker/index.js` are the earlier D1 design** (D1 picked first, dropped
for Postgres on 2026-09-25). They retire at Phase 5 and still pass `worker-check`; the rules below
describe them, and the ones that aren't D1-specific (append-only, idempotent ids, server-clock
cursor, store scoping) carry over.

**Money is never stored as REAL.** Target: Postgres `numeric(12,2)`, plain amounts in the store's
currency (`stores.currency`), no centavo conversion anywhere (decided 2026-10-02). Today: the
client keeps peso amounts and `sales-math.js` does its sums in centavos; `schema.sql` stores
INTEGER centavos and `worker/index.js` converts both ways (`TABLES[].money`). Both keep centavos
until the schema moves.

**`worker/index.js` is the D1 API** and its routes are not invented — they are the surface of the
commented-out `createRemoteStore()` skeleton in `data-store.js` (`GET/POST/PATCH/DELETE /products` etc.,
plus `?since=ISO` for a tablet pulling what changed while it was asleep). One generic table router
over the `TABLES` map, not a handler per collection; adding a table is one entry.
- **Event tables reject `PATCH` and `DELETE`** except the columns in `patchable` (orders:
  `fulfilment_status` only). A void or a refund is a new row.
- **Inserts use `on conflict(id) do nothing`, never `or ignore`.** A tablet that loses the response
  retries the same client-generated id and must not book the sale twice — but `or ignore` also
  swallows not-null and foreign-key violations and silently loses the sale.
- **`toRow` sends only the columns the caller actually set**, so the schema's `default 0` applies.
  Nulling an absent column pushes NULL into `not null` and the insert fails.
- **Every query is scoped `where store_id = ?`** from the JWT claim (the Supabase token, checked
  HS256 against `SUPABASE_JWT_SECRET`). Nothing reads across stores.
- **Every row is checked before it reaches SQL** (`rowError`): a plain object, a non-empty string
  `id`, a parseable `ts` on tables whose stamp is `'ts'`, the columns each table lists in
  `required` (its `not null`-no-default columns besides `id`/`ts`), no object or array in a
  column that isn't in `json` (D1 cannot bind it), and a `happened_on` that matches `YYYY-MM-DD`
  when present. A numeric `ts` / `*_at` (the till's epoch ms) is stored as ISO text. In a batch this is per-row — one bad row is rejected, not a
  500 that poisons the other 999 (D1 batch is one transaction). `POST req.json()` /
  `PATCH req.json()` / `PUT req.json()` are all wrapped: a body that isn't JSON is a 400, not a
  500 with the parser's message.
- **`?since=` pages by `received_at`, the SERVER clock — never the client's own stamp.** Every
  table (`purchase_orders` excepted, see below) carries `received_at text not null default
  (strftime(...))`, set fresh on every insert and bumped by hand on every UPDATE (PATCH). A tablet that uploads an old row late is still seen by anyone who already
  pulled past that row's own `ts`/`updated_at`, because `received_at` only moves forward.
  Ordered `received_at, id`, capped `limit 5000` per request; a caller that gets a full page pages
  with `&after=<lastRow.id>`, resending the *last row's own* `received_at` as `since` — the query
  is `received_at > ?1 or (received_at = ?1 and id > ?2)`, so rows tied on the same millisecond are
  neither skipped nor repeated. `purchase_orders` already has a real, client-settable
  `received_at` column (the PO's own received-shipment date), so its sync cursor is the separate
  column `synced_received_at` instead (`TABLES.purchaseOrders.cursor`).
- `wrangler.toml` carries the nightly cron. The rollup buckets by the STORE-LOCAL day
  (`date(ts, '+' || TZ_OFFSET_MIN || ' minutes')`, default 480 = UTC+8), not the UTC day, and
  rebuilds the last 7 local days each run (delete then insert-select) — re-runnable, and a tablet
  offline for several days is still corrected on the next run, not just "yesterday". It sums
  `status = 'completed'` rows only, so it does not yet take off the till's `void`/`refund` rows.

Run `node scripts/worker-check.mjs` after touching `worker/index.js` or `schema.sql` — it runs the
real Worker against a real SQLite behind a small D1 shim and covers the money round trip, the retry,
the append-only refusals, store isolation, the derived balance and the rollup.

**The seam already exists — use it.** `data-store.js` (`HWPOS_STORE`) is the one place that
touches `localStorage`. Both apps read and write through `HWPOS_STORE.kv`; it also holds the event
bus, `stamp()` (adds `storeId` and `updatedAt` to a row), `readSettings()` and the one
`DEFAULT_SETTINGS`. The remote adapter is still only a commented-out skeleton — building it is the
Phase 5 sync. **New code never touches `localStorage` directly; it goes through `HWPOS_STORE`.**

**The rules live in shared files, not per screen.** `sales-math.js` (`SalesMath`) is the one copy of
the sales ladder (Gross − Voids − Refunds − Discounts = Net …), tax, the store day (`storeZone`,
`dayKey`), the order reader (`readOrder`, `upgradeOrders`) and refund state; the till and the back
office both load it. `bo-model.js` holds stock, the customer ledger and purchase orders. The till
is split per screen: `pos-core.js` (storage, order format), `pos-sell.js`, `pos-checkout.js`,
`pos-orders.js`, `pos-items.js`, `pos-customers.js`, `pos-settings.js`, with `app.js` wiring events
and init. Check: `node scripts/sales-math-check.mjs`.

**Sales, stock changes and account rows live in IndexedDB, not localStorage** (2026-10-02).
localStorage gives a site ~5.2M characters (measured in Edge) and a 3-line sale plus its stock
rows is ~2,000, so a till stopped saving after ~2,600 sales. `HWPOS_STORE.kv` has the Storage
interface (`getItem/setItem/removeItem`); the three keys `hwpos.orders.v1`,
`hwpos.stockMovements.v1`, `hwpos.customerLedger.v1` go to the IndexedDB database `hwpos-sheets`
through a copy in memory, every other key to localStorage. Both apps open it with
`HWPOS_STORE.ready()` before `init()`; a second tab hears saves on a BroadcastChannel and gets the
same `storage` event as before. A lost connection (iPad sleep) reopens once; a second failure
in a row parks the rows IndexedDB has not committed in localStorage and emits `save:failed` (the
till shows a toast). Closing or hiding the page parks uncommitted rows the same way. The next boot
merges localStorage into IndexedDB by id (localStorage's row wins), then sorts by time, never by
position. `ready()` waits at most 5 s; a database that opens later is adopted then, with whatever
was rung meanwhile, and the screens get a `storage` event to re-read. `/demo` sets `HWPOS_MEMORY_ONLY` and never opens it. Each list is
still one record rewritten per save (O(history) per sale, as before); row-per-record and pruning
synced history wait for the sync (Phase 5). Check: `node scripts/sheets-check.mjs` (Edge).

**The schema runs ahead of the UI, deliberately.** The database has not been created yet, so
columns for pages that don't exist — margins, variants, suppliers, purchase orders — are already in
`schema.sql`. Free today, a migration after go-live. `ROADMAP.md` says what each is for. It also
lags the client in places — ledger types, order statuses, the dropped supplier columns, the PO
supplier per line — so `schema.pg.sql` (Phase 5.1) is written from the client's shapes
(`docs/data-dictionary.md`), not copied from `schema.sql`.

**`schema.sql` splits tables two ways and the split is the whole design:**
- **STATE** tables are overwritten, last-write-wins — products, customers. Fine for things nobody counts.
- **EVENT** tables are append-only, never `UPDATE`d — orders, the customer ledger. **Money lives here.**
  Balances are a `view`, derived, so nothing can lose them. Two tablets both pushing "+1000" both land.
- **Derived, never stored:** a customer's balance (`customer_balances`), current stock (the sum of
  `stock_movements`), the low-stock list (`stock <= danger_level`), and what deliveries are coming
  (`purchase_orders` still `ordered`/`partial`). None of these is a flag anyone sets. If you find
  yourself writing one, you are about to create the bug where two screens disagree.

**Product pictures are stored in the row, not in a bucket.** The back office shrinks the uploaded
file to 256px WebP on a canvas and writes the `data:` URL into `image_url`. Decided 2026-09-12, over
R2 plus a link: the picture then rides the catalog sync a tablet already does, works with the
internet down, and is deleted by deleting the product, so there are no orphaned objects to sweep.
The cost is roughly 8KB a product in the database. Move to R2 only when a catalog makes that hurt, and note
that the column does not change when you do — only what it holds.

**Rules that follow from being online — cheap now, a migration later:**
- **Every record carries a client-generated UUID and `updated_at`.** The id makes a retried push
  idempotent, so a flaky connection cannot double-count a sale. The timestamp makes concurrent edits
  mergeable instead of silently losing one.
- **Every row carries `store_id`.** Multi-store is a filter, not a rewrite.
- **The POS must keep selling with the internet down.** Writes queue locally and push when online.
  Offline-first is a requirement, not a nicety — a store cannot stop trading because Wi-Fi dropped.
- **Stock is a log of movements, not a number.** Sales, stock adjustments and receiving a PO are the
  same event: stock moved, and there was a reason. Current stock is their sum. A bare integer that
  three code paths overwrite cannot answer "why does this say 12?" and cannot sync. On the client
  this is `stockOnHand()` in `bo-model.js`; each product's first balance is an `opening` movement
  written once per device (`HWPOS_STORE` `seedOpening`, marked `hwpos.stockAnchored.v1`), and the
  saved `product.stock` is only a cache that `withStock()` overwrites on load.

**Access control is page-level, and that is a deliberate choice.** Employees are trusted staff in a
physical shop; the control that matters is real-world, not cryptographic. So: Supabase Auth decides
*who gets in at all*, and the route table decides *which pages they see*. There is no
per-row database enforcement, and the code must not pretend otherwise — if a future requirement
genuinely needs one employee unable to read another's data, that is a new decision, not a tweak.

---

## Back Office

The sidebar **Back Office** link opens in a new browser tab: `window.open('backoffice.html', '_blank', 'noopener')`. When wrapping in Capacitor later, switch to `window.open(url, '_system')` against a hosted URL so it launches the real system browser.
