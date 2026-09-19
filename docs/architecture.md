# Going online — target architecture

Read this before any structural change: it is what decides whether a change is cheap or a
migration. `ROADMAP.md` is the feature spec and carries the decisions settled per page.

---

Not a local app. **The shape of the whole system:**

```
  tablets running the POS  ──sales──►  Worker API → D1  ◄──edits──  back office
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

**Access is page-level, decided in the Worker.** Staff open the same back office and see different
pages. The front end hiding a link is not the control — the Worker refuses the request — but the
grain is the page, not the row (see the access rule below).

Every structural decision is made against this diagram, not against localStorage.

**The stack — all Cloudflare.**
- **Cloudflare Pages** hosts the static site. SPA routing needs one `_redirects` line
  (`/admin/*  /backoffice.html  200`); `scripts/serve.py` is the local stand-in for that rule.
- **Cloudflare D1** (SQLite) is the database. 5GB free, ~$5/mo after. At 1,000 orders/day (2MB/day,
  ~1.7 writes/minute) this is nowhere near its limits.
- **Cloudflare Workers** is the API. **D1 cannot be reached from a browser** — every read and write
  from a tablet or the back office goes through the Worker. This is the trade for the cheaper
  database: we own an API, and a bad Worker deploy stops every store syncing.
- **Supabase Auth** is the login, and *only* the login — its Postgres stays empty. It issues a JWT;
  the Worker verifies it against Supabase's public JWKS and reads the email off it. Free to 50k users.
  Chosen over Cloudflare Access because Access authenticates a *browser session* (usually an emailed
  one-time PIN), and a shop-floor tablet must not need someone's inbox to reopen the POS. A Supabase
  refresh token keeps the till signed in indefinitely.
- **Cloudflare R2** archives rolled-up orders later. Cheap, no egress, and BIR wants 10 years
  nobody will query.

**Supabase as the *database* was evaluated and rejected.** Its wins were Postgres RLS and realtime;
this app needs neither (access is page-level and configured by hand, and the UI already polls). For
that it wanted 10× less free storage and 5× the paid tier. So the data lives in D1 and Supabase is
kept for auth alone. Don't reopen this without a new reason.

**Money is stored as INTEGER centavos.** SQLite has no decimal type and REAL loses cents. Money
crosses the wire in **pesos** and `worker/index.js` converts both ways (`TABLES[].money`). The
conversion lives in the Worker, not the client, because there is one Worker and there will one day
be tablets running a build nobody has updated in a year — the trust boundary owns it. `app.js` and
`backoffice.js` keep working in pesos and are not touched. Never store money as REAL.

**`worker/index.js` is the whole API** and its routes are not invented — they are exactly the surface
`createRemoteStore()` in `data-store.js` already documents (`GET/POST/PATCH/DELETE /products` etc.,
plus `?since=ISO` for a tablet pulling what changed while it was asleep). One generic table router
over the `TABLES` map, not a handler per collection; adding a table is one entry.
- **Event tables reject `PATCH` and `DELETE`** except the columns in `patchable` (orders:
  `fulfilment_status` only). A void or a refund is a new row.
- **Inserts use `on conflict(id) do nothing`, never `or ignore`.** A tablet that loses the response
  retries the same client-generated id and must not book the sale twice — but `or ignore` also
  swallows not-null and foreign-key violations and silently loses the sale.
- **`toRow` sends only the columns the caller actually set**, so the schema's `default 0` applies.
  Nulling an absent column pushes NULL into `not null` and the insert fails.
- **Every query is scoped `where store_id = ?`** from the JWT claim. Nothing reads across stores.
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
  (strftime(...))`, set fresh on every insert and bumped by hand on every UPDATE (PATCH, the
  `days` upsert). A tablet that uploads an old row late is still seen by anyone who already
  pulled past that row's own `ts`/`updated_at`, because `received_at` only moves forward.
  Ordered `received_at, id`, capped `limit 5000` per request; a caller that gets a full page pages
  with `&after=<lastRow.id>`, resending the *last row's own* `received_at` as `since` — the query
  is `received_at > ?1 or (received_at = ?1 and id > ?2)`, so rows tied on the same millisecond are
  neither skipped nor repeated. `purchase_orders` already has a real, client-settable
  `received_at` column (the PO's own received-shipment date), so its sync cursor is the separate
  column `synced_received_at` instead (`TABLES.purchaseOrders.cursor`).
- `wrangler.toml` carries the nightly cron. The rollup buckets by the STORE-LOCAL day
  (`date(ts, '+' || TZ_OFFSET_MIN || ' minutes')`, default 480 = UTC+8), not the UTC day, and
  rebuilds the last 7 local days each run (delete then insert-select, so a day whose orders were
  all voided doesn't keep a stale total) — re-runnable, and a tablet offline for several days is
  still corrected on the next run, not just "yesterday".

Run `node scripts/worker-check.mjs` after touching `worker/index.js` or `schema.sql` — it runs the
real Worker against a real SQLite behind a small D1 shim and covers the money round trip, the retry,
the append-only refusals, store isolation, the derived balance and the rollup.

**The seam already exists — use it.** `data-store.js` is the async abstraction over persistence
(`store.products.list()`, `store.orders.add()`, an event bus, and a documented remote adapter);
`schema.sql` is the SQLite/D1 schema it targets. **`data-store.js` is still dead code** — `app.js` and
`backoffice.js` still read `localStorage` directly. Wiring the app through the store is the backend
migration. **New code never touches `localStorage` directly; it goes through `HWPOS_STORE`.**

**The schema runs ahead of the UI, deliberately.** The database has not been created yet, so
columns for pages that don't exist — margins, variants, suppliers, purchase orders — are already in
`schema.sql`. Free today, a migration after go-live. `ROADMAP.md` says what each is for.

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
The cost is roughly 8KB a product in D1. Move to R2 only when a catalog makes that hurt, and note
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
  three code paths overwrite cannot answer "why does this say 12?" and cannot sync.

**Access control is page-level, and that is a deliberate choice.** Employees are trusted staff in a
physical shop; the control that matters is real-world, not cryptographic. So: Supabase Auth decides
*who gets in at all*, and the route table decides *which pages they see*. There is no
per-row database enforcement, and the code must not pretend otherwise — if a future requirement
genuinely needs one employee unable to read another's data, that is a new decision, not a tweak.

---

## Back Office

The sidebar **Back Office** link opens in a new browser tab: `window.open('backoffice.html', '_blank', 'noopener')`. When wrapping in Capacitor later, switch to `window.open(url, '_system')` against a hosted URL so it launches the real system browser.
