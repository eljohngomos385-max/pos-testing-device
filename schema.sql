-- Hardware POS — server schema (Postgres / Supabase)
-- Two kinds of table, and the difference is the whole design:
--   STATE  tables are overwritten. Last write wins. Safe for things nobody counts.
--   EVENT  tables are append-only. Never UPDATE a row. Money lives here.

-- ---------- STATE: last write wins is fine ----------
create table products (
  id            text primary key,
  sku           text,
  name          text not null,
  unit          text default 'pc',
  price         numeric(12,2) not null default 0,
  stock         numeric(12,2) not null default 0,  -- ponytail: cached count, not authoritative.
  folder_id     text,
  updated_at    timestamptz not null default now()
);

create table customers (
  id            text primary key,
  name          text not null,
  phone         text,
  address       text,
  credit_limit  numeric(12,2) not null default 0,
  updated_at    timestamptz not null default now()
);

-- ---------- EVENT: append-only, never updated ----------
-- Items stay jsonb to match buildOrderRecord() exactly, so sync is a straight
-- insert with no mapping layer. ~2KB/order measured.
create table orders (
  id            text primary key,
  number        text not null,
  ts            timestamptz not null,
  status        text not null,          -- completed | voided | refunded | return
  cashier       text,
  register      text,
  customer_id   text references customers(id),
  payment_method text,
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  vat_amount    numeric(12,2) not null default 0,
  items         jsonb not null default '[]',
  payments      jsonb not null default '[]',
  fulfilment    text default 'pickup',
  delivery      jsonb,                  -- { address, lat, lng, zoom }
  -- ponytail: the ONLY mutable column. It's a workflow flag, not money, so
  -- last-write-wins is fine. This is what the queue display subscribes to.
  fulfilment_status text not null default 'new',  -- new | preparing | ready | collected
  synced_at     timestamptz not null default now()
);
create index on orders (ts desc);
create index on orders (customer_id);
create index on orders (fulfilment_status) where fulfilment_status <> 'collected';

-- The utang log. This is the git-commit table: two tablets both pushing
-- "+1000" both land, and the total is right. Never store a balance here.
create table customer_ledger (
  id            text primary key,
  ts            timestamptz not null,
  customer_id   text not null references customers(id),
  type          text not null check (type in ('charge','payment')),
  amount        numeric(12,2) not null check (amount >= 0),
  order_id      text,
  note          text
);
create index on customer_ledger (customer_id, ts desc);

-- Balance is DERIVED. Nothing writes it, so nothing can lose it.
-- Replaces the read-modify-write at app.js:2446 / app.js:2474.
create view customer_balances as
select c.id,
       c.name,
       c.credit_limit,
       coalesce(sum(case when l.type = 'charge' then l.amount else -l.amount end), 0) as balance
from customers c
left join customer_ledger l on l.customer_id = c.id
group by c.id, c.name, c.credit_limit;

-- ---------- Retention: keeps the hot DB flat forever ----------
-- 1,000 orders/day x 2KB = 60MB/month. Unchecked that's ~1GB/year and the
-- free tier dies in six months. Rolled up, hot storage never passes ~250MB.
-- BIR wants 10 years, so archive the raw JSON to object storage before pruning
-- -- never just delete.
create table daily_sales (
  day           date primary key,
  order_count   int not null,
  gross         numeric(14,2) not null,
  discount      numeric(14,2) not null,
  vat           numeric(14,2) not null,
  net           numeric(14,2) not null
);

create function rollup_day(d date) returns void language sql as $$
  insert into daily_sales (day, order_count, gross, discount, vat, net)
  select d, count(*), sum(subtotal), sum(discount), sum(vat_amount), sum(total)
  from orders where ts::date = d and status = 'completed'
  on conflict (day) do update set
    order_count = excluded.order_count, gross = excluded.gross,
    discount = excluded.discount, vat = excluded.vat, net = excluded.net;
$$;

-- ---------- Queue display ----------
alter publication supabase_realtime add table orders;
