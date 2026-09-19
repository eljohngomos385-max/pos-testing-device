-- Hardware POS — server schema (Cloudflare D1 / SQLite)
-- Two kinds of table, and the difference is the whole design:
--   STATE  tables are overwritten. Last write wins. Safe for things nobody counts.
--   EVENT  tables are append-only. Never UPDATE a row. Money lives here.
--
-- SQLite conventions used throughout, because it is not Postgres:
--   money    INTEGER centavos. SQLite has no decimal and REAL loses cents. The
--            store adapter divides by 100 on the way out, so app.js stays in pesos.
--   time     TEXT, ISO-8601 UTC ('2026-09-08T05:12:33.412Z'). Lexical sort == time
--            sort, so `order by ts desc` and `substr(ts,1,10)` for the day both work.
--   json     TEXT holding JSON. Read it with SQLite's json_extract() when needed.
--   ids      client-generated (crypto.randomUUID) so an offline tablet can create a
--            row and the insert is idempotent when it finally reaches us.
-- Apply with: wrangler d1 execute hwpos --file=schema.sql

pragma foreign_keys = on;

-- ---------- STATE: last write wins is fine ----------
create table products (
  id            text primary key not null,
  store_id      text not null,
  sku           text,
  barcode       text,
  name          text not null,
  unit          text default 'pc',
  cost          integer not null default 0,   -- centavos, what we pay
  price         integer not null default 0,   -- centavos, what they pay
  -- Margin is per item and configurable two ways, so both the mode and the number
  -- have to be stored -- 'flat' 5000 means +₱50.00, 'percent' 2500 means +25.00%.
  -- price stays authoritative; margin is what recomputes it when cost changes.
  margin_mode   text not null default 'percent' check (margin_mode in ('flat','percent')),
  margin_value  integer not null default 0,   -- centavos, or basis points when percent
  stock         integer not null default 0,   -- ponytail: cached count, not authoritative.
  danger_level  integer not null default 0,   --   stock_movements is the truth; this is
  -- Hardware stores sell things they haven't got yet (order it in, deliver Friday).
  sell_out_of_stock integer not null default 0,
  supplier_id   text references suppliers(id),
  folder_id     text,                         -- doubles as the category: "sales by category"
  group_id      text,                         -- variants are siblings in a group
  weight        text,                         -- ponytail: free text. "3/4 in", "2.5kg", "8 ft" --
  size          text,                         --   nothing computes on these yet. Split into
  length        text,                         --   number+unit when a filter or a courier needs it.
  image_url     text,                         -- one picture, shared by every variant
  archived      integer not null default 0,
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index products_store on products (store_id, archived);
create index products_barcode on products (store_id, barcode) where barcode is not null;
-- The danger-level list on the dashboard is this index, nothing more.
create index products_low on products (store_id) where stock <= danger_level;
create index products_sync on products (store_id, received_at, id);
create unique index products_sku on products (store_id, sku) where sku is not null;

create table customers (
  id            text primary key not null,
  store_id      text not null,
  name          text not null,
  phone         text,
  address       text,
  credit_limit  integer not null default 0,   -- centavos
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index customers_store on customers (store_id);
create index customers_sync on customers (store_id, received_at, id);

-- A variant group -- "Boysen Paint" -- holding the products that are its variants
-- ("Boysen Paint Red", "... Blue"). There is no variants table: a variant IS a product,
-- because it has to be sellable, countable and orderable on its own. The group carries
-- only what every variant shares -- the name and the one picture.
create table product_groups (
  id            text primary key not null,
  store_id      text not null,
  name          text not null,
  folder_id     text,
  image_url     text,
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index groups_store on product_groups (store_id);
create index product_groups_sync on product_groups (store_id, received_at, id);

create table suppliers (
  id            text primary key not null,
  store_id      text not null,
  name          text not null,
  contact       text,
  phone         text,
  email         text,
  address       text,
  note          text,
  order_days    text not null default '[]',   -- json weekdays they take orders, 0 = Sunday
  min_order     integer not null default 0,   -- centavos, smallest order they accept
  quoted_lead_days integer not null default 0, -- what they SAY; the real lead time is derived
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index suppliers_store on suppliers (store_id);
create index suppliers_sync on suppliers (store_id, received_at, id);

-- What we have ordered and not yet received. The dashboard's "Deliveries coming"
-- card is a query on this -- it is NOT the customer delivery on an order, which
-- lives in orders.delivery. Two different things that both say "delivery".
create table purchase_orders (
  id            text primary key not null,
  store_id      text not null,
  supplier_id   text not null references suppliers(id),
  number        text not null,
  status        text not null default 'draft'
                check (status in ('draft','ordered','partial','received','cancelled')),
  ordered_at    text,
  sent_at       text,                         -- when it actually left for the supplier
  promised_at   text,                         -- the supplier's date; expected_at is our guess
  expected_at   text,                         -- the date the card sorts by
  received_at   text,
  total         integer not null default 0,   -- centavos
  note          text,
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging. Named apart
  -- from `received_at` above, which is the PO's own received-shipment date, not a sync clock.
  synced_received_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index po_incoming on purchase_orders (store_id, expected_at) where status in ('ordered','partial');
create index purchase_orders_sync on purchase_orders (store_id, synced_received_at, id);

create table purchase_order_items (
  id            text primary key not null,
  store_id      text not null,
  po_id         text not null references purchase_orders(id) on delete cascade,
  product_id    text not null references products(id),
  qty           integer not null,             -- hundredths of a unit, like stock_movements
  cost          integer not null default 0,   -- centavos, at time of order
  received_qty  integer not null default 0,   -- hundredths of a unit
  invoice_cost  integer,                      -- centavos the supplier BILLED; null = no invoice yet
  short_reason  text,                         -- why received_qty < qty
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index po_items on purchase_order_items (po_id);
create index purchase_order_items_sync on purchase_order_items (store_id, received_at, id);

-- ---------- EVENT: append-only, never updated ----------
-- Items stay JSON to match buildOrderRecord() exactly, so sync is a straight
-- insert with no mapping layer. ~2KB/order measured.
create table orders (
  id            text primary key not null,
  store_id      text not null,
  number        text not null,
  ts            text not null,
  status        text not null,          -- completed | voided | refunded | return
  cashier       text,
  register      text,
  customer_id   text references customers(id),
  payment_method text,
  subtotal      integer not null default 0,   -- centavos
  discount      integer not null default 0,
  total         integer not null default 0,
  vat_amount    integer not null default 0,
  items         text not null default '[]',
  payments      text not null default '[]',
  fulfilment    text default 'pickup',
  delivery      text,                   -- JSON { address, lat, lng, zoom }
  -- ponytail: the ONLY mutable column. It's a workflow flag, not money, so
  -- last-write-wins is fine. This is what the queue display polls.
  fulfilment_status text not null default 'new',  -- new | preparing | ready | collected
  synced_at     text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index orders_ts on orders (store_id, ts desc);
create index orders_customer on orders (customer_id, ts desc);
create index orders_open on orders (store_id, fulfilment_status) where fulfilment_status <> 'collected';
create index orders_sync on orders (store_id, received_at, id);

-- The utang log. This is the git-commit table: two tablets both pushing
-- "+1000" both land, and the total is right. Never store a balance here.
create table customer_ledger (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  customer_id   text not null references customers(id),
  type          text not null check (type in ('charge','payment')),
  amount        integer not null check (amount >= 0),   -- centavos, always positive
  order_id      text,
  note          text,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index ledger_customer on customer_ledger (customer_id, ts desc);
create index customer_ledger_sync on customer_ledger (store_id, received_at, id);

-- Every reason stock moved. Same append-only rule as money: a sale, a delivery
-- and a shrinkage correction are three events, not three edits to one number.
create table stock_movements (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  product_id    text not null references products(id),
  -- Signed, and in HUNDREDTHS of a unit: -200 sold two, +5000 delivered fifty,
  -- -250 cut two and a half metres of wire. Integer for the same reason money is
  -- integer -- current stock is a SUM of this column, and a float sum of 0.01s
  -- drifts. 0.01 is the finest step the UI allows (stepFor), so nothing is lost.
  qty           integer not null,
  -- sale | return | delivery | adjustment | count | transfer | shrinkage | damage | writeoff
  reason        text not null,
  ref_id        text,                   -- order id / purchase order id, when there is one
  -- Cost AT THE TIME OF THE MOVEMENT, centavos. Cement and rebar re-price monthly;
  -- without this every historical margin silently rewrites itself when cost changes.
  unit_cost     integer not null default 0,
  staff         text,                   -- who moved it: "why does this say 12?" needs a who
  note          text,
  -- Counts only, hundredths like qty: what the system believed and what the shelf held.
  -- qty alone says -3; these say 40 -> 37, which is what a count-accuracy score needs.
  expected      integer,
  counted       integer,
  -- The product's stock right after this movement, hundredths like qty. Lets "how long did it
  -- sit at zero" be read off one row instead of replaying the log. Null = written by an older build.
  balance_after integer,
  -- Store-local date 'YYYY-MM-DD' the stock actually arrived / was counted / was lost, only when
  -- that differs from ts (the entry time). Null = same day, or never asked.
  happened_on   text,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index movements_product on stock_movements (product_id, ts desc);
create index stock_movements_sync on stock_movements (store_id, received_at, id);

-- ---------- EVENT logs: what happened and used to vanish ----------
-- Same rules as above: append-only, client id, ts ISO UTC, staff = who. No foreign keys on
-- the optional refs, because a tablet push that fails a FK sits in the queue forever.
-- Field meanings: docs/data-dictionary.md.

create table price_log (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  product_id    text not null,
  field         text not null check (field in ('price','cost')),
  old_value     integer,                -- centavos; null = the product's first price
  new_value     integer not null,       -- centavos
  reason        text,
  source        text,                   -- backoffice | csv | reprice ...
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index price_log_product on price_log (store_id, product_id, ts);
create index price_log_sync on price_log (store_id, received_at, id);

-- Asked for and not sold. Sales are demand minus this; without it a stockout looks like no demand.
create table lost_demand (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  product_id    text,                   -- null when we do not carry it (see text)
  text          text,                   -- what the customer asked for, in their words
  qty           integer,                -- hundredths of a unit, like stock_movements
  reason        text,                   -- out-of-stock | not-carried | too-expensive | other
  substitute_product_id text,           -- bought this instead
  terminal      text,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index lost_demand_ts on lost_demand (store_id, ts);
create index lost_demand_product on lost_demand (store_id, product_id);
create index lost_demand_sync on lost_demand (store_id, received_at, id);

create table delivery_events (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  order_id      text not null,
  event         text not null,          -- dispatched | arrived | returned | failed
  driver        text,
  lat           real,                   -- not money: REAL is fine
  lng           real,
  note          text,
  terminal      text,                   -- register number the event was tapped on
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index delivery_events_order on delivery_events (store_id, order_id, ts);
create index delivery_events_sync on delivery_events (store_id, received_at, id);

create table clock_events (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  staff_id      text not null,
  staff_name    text,
  event         text not null check (event in ('in','out')),
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index clock_staff on clock_events (store_id, staff_id, ts);
create index clock_events_sync on clock_events (store_id, received_at, id);

create table supplier_messages (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  supplier_id   text,
  po_id         text,
  direction     text not null check (direction in ('in','out')),
  channel       text,                   -- viber | sms | email | call | other
  text          text,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index supplier_messages_thread on supplier_messages (store_id, supplier_id, ts);
create index supplier_messages_sync on supplier_messages (store_id, received_at, id);

-- Every automated suggestion or action: what it saw, the rule, what it chose, and whether a
-- person took it. The only way to tell later whether the rule or the person was wrong.
create table decisions (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,
  staff         text,
  kind          text not null,          -- reorder | reprice | count | ...
  subject_id    text,                   -- product / supplier / po id the decision is about
  inputs        text,                   -- json
  rule          text,
  choice        text,                   -- json
  accepted      integer,                -- 1 / 0, null = not answered yet
  actor         text,                   -- 'system' or the person
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index decisions_ts on decisions (store_id, kind, ts);
create index decisions_sync on decisions (store_id, received_at, id);

-- Every tap the till already handles -- scans, searches, cart edits, checkout steps -- as a raw
-- fact (data-store.js HWPOS_STORE.events). Fixed columns for what every row has; the per-type
-- fields stay in `data` JSON so a new event type is not a migration. Uploaded in batches of
-- thousands, so nothing here is not null that an old build might not send.
create table till_events (
  id            text primary key not null,
  store_id      text not null,
  ts            text not null,          -- tablet clock, ISO UTC
  type          text not null,          -- item_add | scan | sale_complete ... (docs/data-dictionary.md)
  session_id    text,                   -- one per page load
  terminal      text,
  cashier       text,
  cart_id       text,
  online        integer,                -- 1 / 0: navigator.onLine at the tap
  app_version   text,
  data          text,                   -- json, fields per type
  -- Server clock, never sent by the client: ts minus this is how long the row sat offline.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index till_events_ts on till_events (store_id, ts);
create index till_events_type on till_events (store_id, type, ts);
create index till_events_sync on till_events (store_id, received_at, id);

-- ---------- STATE: the day spine ----------
-- One row per store per LOCAL date. Everything joins to it by date. Upserted and merged,
-- because the weather for a day arrives after the day and must not wipe a typed road closure.
create table days (
  id            text not null,          -- 'YYYY-MM-DD', the store's local date (= date)
  store_id      text not null,
  date          text,
  rain_mm       real,                   -- not money: REAL is fine
  rain_hours_open real,                 -- hours with rain during opening hours
  temp_max_c    real,
  weather_code  integer,                -- WMO code
  holiday_name  text,
  is_payday     integer,                -- 1 / 0
  events        text,                   -- local events, free text
  road_closure  text,
  note          text,
  source        text,                   -- who filled it: manual | open-meteo | ...
  updated_at    text not null,
  -- Server clock, never sent by the client: pull cursor for `?since=` paging.
  received_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (store_id, id)            -- a date is not unique across stores
);
create index days_sync on days (store_id, received_at, id);

-- Balance is DERIVED. Nothing writes it, so nothing can lose it.
-- Replaces the read-modify-write at app.js:2446 / app.js:2474.
create view customer_balances as
select c.id,
       c.store_id,
       c.name,
       c.credit_limit,
       coalesce(sum(case when l.type = 'charge' then l.amount else -l.amount end), 0) as balance
from customers c
left join customer_ledger l on l.customer_id = c.id
group by c.id, c.store_id, c.name, c.credit_limit;

-- ---------- Retention: keeps the hot DB flat forever ----------
-- 1,000 orders/day x 2KB = 60MB/month. Unchecked that's ~1GB/year. Rolled up,
-- hot storage never passes ~250MB. BIR wants 10 years, so archive the raw JSON
-- to R2 before pruning -- never just delete.
create table daily_sales (
  day           text not null,          -- 'YYYY-MM-DD'
  store_id      text not null,
  order_count   integer not null,
  gross         integer not null,       -- centavos
  discount      integer not null,
  vat           integer not null,
  net           integer not null,
  primary key (day, store_id)
);

-- SQLite has no stored functions, so the rollup lives in a cron-triggered Worker
-- running exactly this statement with ?1 = 'YYYY-MM-DD':
--
--   insert into daily_sales (day, store_id, order_count, gross, discount, vat, net)
--   select ?1, store_id, count(*), sum(subtotal), sum(discount), sum(vat_amount), sum(total)
--   from orders where substr(ts, 1, 10) = ?1 and status = 'completed'
--   group by store_id
--   on conflict (day, store_id) do update set
--     order_count = excluded.order_count, gross = excluded.gross,
--     discount = excluded.discount, vat = excluded.vat, net = excluded.net;
--
-- Re-runnable by design: a late order arriving from a tablet that was offline for
-- two days just makes the next run overwrite that day with the correct totals.
