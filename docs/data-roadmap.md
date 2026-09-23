# Data roadmap — what to capture before anything can predict

Readable version: https://claude.ai/code/artifact/abfbfe75-949e-48ed-af42-7ebae1bf3c04

The goal is a store that orders for itself. That is not a modelling problem, it is a capture
problem. This file lists what to record, in the order worth recording it. **Tier 0 is already on
disk** and needs no new habit, no new hardware and no waiting.

## The one that poisons everything else

**Sales history is not demand history.** It is demand minus everything the shop could not serve.
Every hour a product sat at zero, real demand walked out and left no record.

A model trained on that sees a low number for a product that was out of stock half the month and
orders less next time, which causes more stockouts. A product can die on the shelf purely as an
artifact of never recording what was never sold. Stockout intervals are derivable from the movement
log today, so this is free to fix and it is the first item below.

## The four rules

1. **Never overwrite.** A change appends a row. The old value survives with who changed it and why.
2. **One clock, one key.** Every event carries a timestamp and rolls up to a date. Anything that
   cannot join by date correlates with nothing.
3. **Events, not summaries.** Totals can always be recomputed. Detail cannot be recovered.
4. **Who, not just what.** Every row names the person or the machine that caused it.

## Tier 0 — free today

Reads, not captures. The data is in `hwpos.orders.v1`, `hwpos.stockMovements.v1` and
`hwpos.purchaseOrders.v1` already.

- **Stockout intervals** — when each product hit zero and came back. Movement log.
- **Supplier lead time and reliability** — `orderedAt` to `receivedAt`, with its spread. Purchase orders.
- **Demand rate and variability per product** — the swing, not just the average. Movement log.
- **A real reorder point** — replaces `suggestQty`, which tops up to twice a hand-typed
  `reorderPoint` and ignores sales rate and lead time entirely. This is the overordering.
- **Cash asleep, ranked** — qty × cost × days sat, worst first.
- **Sell-through per delivery** — bought this many on this date, cleared in this long.
- **Dead stock register** — nothing sold in ninety days, with the peso value in it.
- **Customer reorder cycles** — orders carry `customerId`; customers carry a phone number.
- **Basket affinity** — what sells with what, and which line drove the trip.
- **Delivery heat map** — `deliveryLocation` lat/lng is already stored on every delivery order.
- **Sales per person** — done: the Staff page reads it off `orders.cashier`.
- **Backtest harness** — replay the real year against any ordering rule, report cash tied up
  against stockouts.

## Tier 1 — cheap to capture

Small additions to what already gets written. Each is an event that happens today and vanishes.

- **Price and cost change log** — product, old, new, who, when, reason. Prices overwrite in place now.
- **Delivery lifecycle** — driver, dispatched at, arrived at, returned at.
- **Unfilled requests** — product, qty asked, time, staff.
- **Substitution flag** — bought B because A was out.
- **Stock count variance, retained** — expected against counted, over time, as a per-product
  confidence score. `countDelta` computes it; nothing keeps it.
- **Shrinkage, breakage, write-offs** — distinct reason codes, never a generic adjustment.
- **Short ships on receiving** — ordered against received per line, with a reason. Supplier fill rate.
- **Sent date and promised date** — distinct from drafted and from `expectedAt`.
- **Supplier invoice price** — billed against quoted.
- **Supplier order cycle and minimums** — an order draft cannot be finished without them.
- **Supplier conversation thread** — every message both ways, attached to the PO. Suppliers are on
  Viber, not an API; an AI can read a thread.
- **Decision log** — every automated action records inputs, rule, choice and time.

### Still open from Tiers 0 and 1 (2026-09-14)

- **Calculations are parked** (owner, 2026-09-14): capture first, maths later. `reorderPlan` is off
  Needs buying (back on `suggestQty`) until the capture layer has data; it needed tuning anyway (the
  backtest cuts cash tied up by a quarter but loses more units on lumpy products, and orders any day,
  not on the supplier's order days). Insights stays as it is, not extended. Cash tied up stays.
- **Till event upload** is not built: `HWPOS_STORE.events.list({synced: 0})` → `POST /tillEvents` in
  batches of 1,000 → `markSynced` after a 201.
- **Count confidence stays empty on a matching count.** A count with no difference writes no
  movement, so it leaves no expected-against-counted row. Changing that adds a zero-qty movement
  per count and wants the owner's OK.
- **Delivery heat map** has nothing to draw until orders carry `deliveryLocation`; the seed has none.
- **Who, not just what** is half done: back-office rows name the store's cashier setting, not a login.
- **Sync**: no camelCase → snake_case push adapter yet; voids and refunds edit orders in place; staff,
  adjustments and closeouts have no D1 table.
- **Back-dating is stock only.** Delivery events, lost sales and closeouts still take
  the moment they are typed; the closeout day is the UTC date, not the store's (app.js closeout).
  A voided sale's demand is not kept. Two tablets editing the same product's stock: last write wins.
  Till events sharing a millisecond have no sequence number to order them.

## Tier 2 — needs hardware or integration

None of it blocks the tiers above.

- **Footfall counter** — a door beam, not a camera. Gives conversion rate.
- **Scan-based receiving** — item by item against the PO. Where the data foundation is won or lost.
- **GPS on the delivery run** — true drive time per drop.
- **Quote capture** — prices given that did not convert. The only real price-sensitivity data.

## Tier 3 — the layer that runs itself

Built on everything above. Straightforward once the data exists.

- **The order draft** — one finished PO per supplier on their order day, each line with its reason.
- **Exception-only escalation** — routine passes silently; six things a day, not a dashboard.
- **Autonomy levels per decision** — suggest, do-unless-I-object, or just do.
- **Self-scheduled stock counts** — targets products where confidence is lowest.
- **Pricing rules** — hold this margin, round to five, never twice in a month.
- **Automatic supplier choice** — cheapest who actually delivers on time. `altSupplierIds` exists.
- **Delivery chase** — the promised date passes and the system notices.
- **Customer reorder outreach** — contacted before they think to come in.

## Already shipped

- **Tier 0, all of it** (2026-09-14) — `bo-insights.js` `buildInsights()`, shown on `/admin/insights`
  and in `HWPOS_AI.snapshot().insights` and Export for AI: stockout intervals, supplier lead time and
  fill rate, demand rate and spread over in-stock days, `reorderPlan` (Insights only; parked, not
  on Needs buying), cash asleep, sell-through per delivery, dead stock, customer cycles, basket
  affinity, delivery points (sales per staff day removed 2026-09-24). `scripts/backtest.mjs` replays a year against
  the old rule and `reorderPlan`.
- **Tier 1 captures** (2026-09-14) — event logs in `bo-model.js` `EVENT_LOGS`, D1 tables in
  `schema.sql`, fields in `docs/data-dictionary.md`:
  price and cost log (`priceLog`); the day spine (`days`, removed 2026-09-24); delivery dispatched/arrived/returned/failed (`deliveryEvents`); lost sales with a
  substitute (`lostDemand`); expected and counted kept on count movements; `shrinkage` · `damage` ·
  `writeoff` reason codes; short ships with a reason, sent date, promised date and invoice cost on
  PO lines (clock in/out removed 2026-09-24); supplier order days, minimum order and quoted lead;
  supplier conversation per PO (`supplierMessages`); decision log for reorder and reprice (`decisions`).
- **Till event stream** (2026-09-14) — every till action as a raw row, no calculations:
  `HWPOS_STORE.events` (data-store.js) buffers taps and writes them to IndexedDB `hwpos-events` in
  one transaction per flush, never blocking a sale; `till_events` in D1 with a 1,000-row batch POST.
  Carts, scans, searches once per intent, out-of-stock taps, discounts, customers, checkout, sale,
  void, refund, print, online/offline, app visible/hidden. Stock movements carry `balanceAfter`.
  Fields and blind spots in `docs/data-dictionary.md`; `scripts/events-check.mjs`.
- **Cash tied up** (2026-09-14) — the first tab on `/admin/insights`. Stock at cost by age
  (0–15, 16–30, 31–60, 61–90, 90+ days). For the last 15 and 30 days: bought, sold at cost, lost,
  and how much has sat longer than the window. Read from the movement log; no new capture.
- **When stock was really there** (2026-09-14) — movements carry `happenedOn` (store-local date)
  next to `ts` (when it was typed). Set from Inventory → Adjust ("In store since" / "Happened on"),
  inventory documents, opening stock on a new product and the CSV `in_store_since` column, PO
  "Sent on", and receiving "Arrived on". Cash tied up, stockouts, demand, sell-through and count
  accuracy read it; a return never starts a new age layer. The till's product editor now writes a
  count movement instead of overwriting stock. CSV import refuses a new product with stock and no cost.
- **Sync hardening** (2026-09-14) — `GET ?since=` pages on the server's `received_at`, not the
  tablet clock; a batch POST judges each row alone and answers `{received, inserted, rejected}`;
  epoch-ms `ts` (orders, customer ledger) is stored as ISO text; the nightly rollup rebuilds the last
  7 store-local days. The till event store has a pagehide stash, a fallback size cap and a
  transaction timeout, so a hung IndexedDB never blocks a sale. `scripts/worker-check.mjs`,
  `scripts/stress/events-fuzz.mjs`.
- **Sales → Patterns** (2026-09-12) — by hour, by weekday, walk-in against delivery.
- **Inventory → Cost changes** (2026-09-12) — last paid against cost on file, with the price that
  holds the margin. See `docs/backoffice.md`.
