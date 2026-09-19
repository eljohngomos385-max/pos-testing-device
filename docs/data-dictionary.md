# Data dictionary — what every stored row means

Read this before reading the data. It is written for a model as much as a person. Source of truth
for field names is the code named in each section; if the two disagree, the code wins and this file
is the bug. `HWPOS_AI.snapshot()` (data-store.js) returns every collection below in one read-only
object; `HWPOS_AI.dictionaryUrl` points here.

## Conventions (apply everywhere unless a row says otherwise)

| Thing | Rule |
|---|---|
| Money | **Pesos** (number, 2dp) in the browser and on the wire. **Integer centavos** in D1. `worker/index.js` `TABLES[].money` converts. Never REAL. |
| Quantity | Units of the product's `unit`, signed where it is a movement. Whole for `soldBy:'each'`, 0.01 step for `soldBy:'measure'`. D1 stores **hundredths** (`TABLES[].scaled`). |
| Timestamps | Two formats exist, by age of the code: **epoch milliseconds** (number) on `orders.ts`, `customerLedger.ts`, `drawerCloseouts.ts`, `orders.voidedAt/refundedAt/returnedAt`; **ISO-8601 UTC string** (`2026-09-14T02:15:00.000Z`) on everything else (movements, event logs, POs, `updatedAt`, `createdAt`). `new Date(x)` reads both. |
| The date key | **Local calendar date of the store, `YYYY-MM-DD`, Asia/Manila (UTC+8, no DST).** The pages compute it with the device's local clock (`isoDate()` in backoffice.js: `getFullYear/getMonth/getDate`), and the tills are in the Philippines; `bo-insights.js` uses a fixed UTC+8 (`TZ_MIN = 480`) so its numbers do not depend on the device. **Do not use `ts.slice(0,10)` on an ISO string** — that is the UTC date, and anything 00:00–07:59 Manila lands on the previous day. Fields that are already a local date: `days.id`, `advances.date`, `adjustments.date`, `attendance` keys, `PO.promisedAt/expectedAt` when entered as a date. |
| Weekdays | `0 = Sunday … 6 = Saturday` (JS `getDay()`), in the local date. |
| ids | Client-generated. Prefix tells the kind: `mv_` movement, `ev_` event-log row, `pol_` PO line, `ca_` cash advance, `adj_` adjustment document, `ord_` order, `led_` ledger row, `drawer_` closeout, `cust_` customer. Seed rows use short ids (`p001`, `c-001`, `u1`). |
| store_id | Not on client rows. The Worker stamps it from the JWT (`app_metadata.store_id`) on every write; every D1 query is scoped by it. |
| Names | Client is camelCase, D1 is snake_case of the same word (`productId` → `product_id`). Exceptions are noted per table. |
| STATE vs EVENT | **STATE** = overwritten in place, last write wins. **EVENT** = append-only; a correction is a new row; the Worker refuses PATCH/DELETE/PUT (except `orders.fulfilment_status`). |
| Staff on a row | A **display name** (`'Maricel R.'`) unless the field is `staffId`. Names are not unique keys; join to `staff` by `name` only when no id exists. |

## Storage keys

| Collection (`HWPOS_AI` / Worker route) | localStorage key | Kind | One row is | Owner (writes) | D1 table |
|---|---|---|---|---|---|
| products | `hwpos.products.v2` | STATE | a sellable, countable, orderable item (a variant is a product) | back office | products |
| folders | `hwpos.folders.v2` | STATE | a category | back office | — (products.folder_id) |
| groups | `hwpos.groups.v1` | STATE | a variant family | back office | product_groups |
| orders | `hwpos.orders.v1` | EVENT* | one receipt | POS | orders |
| customers | `hwpos.customers.v1` | STATE | a named buyer, usually on credit | POS / back office | customers |
| customerLedger | `hwpos.customerLedger.v1` | EVENT | one charge to or payment on an account | POS | customer_ledger |
| drawerCloseouts | `hwpos.drawerCloseouts.v1` | STATE (one per date) | an end-of-day cash count | POS | — |
| stockMovements | `hwpos.stockMovements.v1` | EVENT | stock moved once, with a reason | POS + back office | stock_movements |
| purchaseOrders | `hwpos.purchaseOrders.v1` | STATE | an order to a supplier, lines embedded | back office | purchase_orders + purchase_order_items (`poItems`) |
| suppliers | `hwpos.suppliers.v1` | STATE | a supplier | back office | suppliers |
| staff | `hwpos.staff.v1` | STATE | an employee (`pin` removed from the AI snapshot) | back office | — |
| attendance | `hwpos.attendance.v1` | STATE (object) | `{ date: { staffName: mark } }` | back office | — |
| advances | `hwpos.advances.v1` | EVENT* | one cash advance handed to an employee | back office | — |
| adjustments | `hwpos.adjustments.v1` | EVENT | a saved stock count / adjustment document | back office | — (its movements sync) |
| days | `hwpos.days.v1` | STATE (upsert) | one local date: weather, holiday, payday, events | back office | days |
| priceLog | `hwpos.priceLog.v1` | EVENT | a price or cost changed | back office (`saveProducts`), POS product editor (`saveProduct`) | price_log |
| lostDemand | `hwpos.lostDemand.v1` | EVENT | a customer asked and did not get it | POS | lost_demand |
| deliveryEvents | `hwpos.deliveryEvents.v1` | EVENT | a customer delivery changed stage | POS / back office | delivery_events |
| clock | `hwpos.clock.v1` | EVENT | an employee clocked in or out | POS / back office | clock_events |
| supplierMessages | `hwpos.supplierMessages.v1` | EVENT | one message to or from a supplier | back office | supplier_messages |
| decisions | `hwpos.decisions.v1` | EVENT | one automated suggestion/action and its outcome | back office | decisions |
| settings | `hwpos.settings.v1` | STATE (object) | store config (VAT rate, store info) | POS settings | — |
| tillEvents | IndexedDB `hwpos-events` / `tillEvents` (fallback `hwpos.tillEvents.fallback.v1`) | EVENT | one thing the till did or was tapped for | POS (`HWPOS_STORE.events.append`) | till_events |

\* see Known gaps.

## Join keys

| Key | Appears on | Points at |
|---|---|---|
| productId | order `items[].productId`, stockMovements, PO lines, priceLog, lostDemand (+ `substituteProductId`), decisions `subjectId` | products.id |
| orderId | customerLedger.orderId, stockMovements.refId (reason sale/return), deliveryEvents.orderId, orders.originalOrderId | orders.id |
| poId | stockMovements.refId (reason delivery), supplierMessages.poId | purchaseOrders.id |
| adjustment id | stockMovements.refId (reason count/adjustment/shrinkage/damage/writeoff from Inventory) | adjustments.id |
| supplierId | products.supplierId / altSupplierIds, purchaseOrders.supplierId, supplierMessages.supplierId | suppliers.id |
| customerId | orders.customer.id, customerLedger.customerId | customers.id |
| staffId | advances.staffId, clock.staffId | staff.id |
| staff name | orders.cashier, stockMovements.staff, adjustments.staff, event `staff`, attendance keys | staff.name (not unique) |
| date | local date of any timestamp (see Conventions) | days.id |

## products — `hwpos.products.v2` (bo-model.js `PRODUCT_DEFAULTS`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id | string | | product key | `p001` |
| sku / barcode | string | | store code / EAN | `PVC-ELB-12` / `4801234500011` |
| name, brand | string | | | `PVC Elbow 1/2"`, `Atlanta` |
| folder | string | | category id (D1 `folder_id`) | `plumbing` |
| unit | string | | selling unit | `pc`, `m`, `kg` |
| soldBy | `each`\|`measure` | | measure = 0.01 qty step | `each` |
| cost | number | pesos/unit | what we pay **now** (history: priceLog, movement `unitCost`) | 7.5 |
| price | number | pesos/unit | shelf price now | 12 |
| marginMode | `percent`\|`flat` | | how margin is expressed | `percent` |
| marginValue | number | % markup on cost, or pesos | | 60 |
| stock | number | units | **cache** of the movement sum; not authoritative | 240 |
| reorderPoint | number | units | hand-typed danger level (D1 `danger_level`) | 50 |
| sellOutOfStock | bool | | may sell below zero | false |
| supplierId | string | | primary supplier | `s1` |
| altSupplierIds | string[] | | other suppliers that stock it | `["s3"]` |
| groupId | string | | variant family | `g1` |
| imageUrl | string | | data: URL (256px WebP) | |
| weight, size, length | string | free text | | `3/4 in` |
| aliases | string[] | | search words | `["half elbow"]` |
| archived | bool | | hidden, not deleted | false |
| updatedAt | ISO | | last write | |

## orders — `hwpos.orders.v1` (app.js `normalizeOrderRecord`, `formatKey 'hwpos.order.v1'`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id / number | string | | key / printed receipt number | `ord_k3j9x1abc` / `1042` |
| ts | number | epoch ms | when rung up | 1757815200000 |
| status | string | | `completed` sale · `saved` parked, not a sale · `voided` · `refunded` · `return` (a separate negative row) | `completed` |
| cashier, register | string | | staff name, till number | `Aldrin S.`, `1` |
| customer | object\|null | | `{id,name,phone,address}` snapshot | |
| paymentMethod | string | | drawer coercion: cash\|credit\|split\|unpaid | `cash` |
| paymentKind / paymentMethodLabel | string | | the real tender: cash\|gcash\|qr\|credit\|split\|other / label | `gcash` / `GCash` |
| payments[] | object[] | pesos | `{method,label,amount,tendered,change,ref}` | |
| subtotal, discount, total | number | pesos | gross, discount, paid (VAT inclusive) | |
| cartDiscount | object\|null | | `{type:'percent'\|'amount', value}` | |
| tendered, change | number | pesos | cash leg | |
| vatRate | number | fraction | | 0.12 |
| vatAmount, vatableSales | number | pesos | | |
| fulfilment | `pickup`\|`delivery` | | | |
| deliveryAddress | string | | | |
| deliveryLocation | object\|null | degrees | `{lat,lng,zoom,provider,attribution}` | |
| originalOrderId | string | | on a `return` row: the sale it reverses | |
| reason | string | | void/refund/return reason | |
| voidedAt, refundedAt, returnedAt | number | epoch ms, 0 = never | | |
| meta | object | | `{source:'pos-app'}` | |

**items[]** (`normalizeOrderItem`)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| productId (= id) | string | | products.id |
| sku, name, unit | string | | snapshot at sale |
| qty | number | units | ≥ 0, decimals for measure |
| price | number | pesos/unit | price charged |
| discount | object\|null | | `{type:'percent'\|'amount', value}` |
| lineGross, lineDiscount, lineTotal | number | pesos | qty×price, off, net |
| cost | number | pesos/unit | **our cost stamped at the moment of sale** — margin uses this, never today's cost |

Sign when summing sales: `completed` +1, `return` −1, `voided`/`refunded`/`saved` 0.

## customers — `hwpos.customers.v1` (+ seed `CUSTOMERS` in data.js)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id, name, phone, address | string | | phone is the outreach key |
| type | string | | contractor\|retail\|residential\|wholesale |
| isCreditCustomer | bool | | |
| creditLimit | number | pesos | |
| currentBalance | number | pesos | **cache**; the ledger is the truth (D1 view `customer_balances`) |

## customerLedger — `hwpos.customerLedger.v1` (app.js `addCustomerLedgerEntry`) · EVENT

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id | string | | `led_…` |
| ts | number | epoch ms | |
| customerId, customerName | string | | |
| type | `charge`\|`payment` | | charge raises the balance |
| amount | number | pesos, > 0 | always positive; `type` carries the sign |
| orderId | string | | receipt that caused it, if any |
| note | string | | |

## stockMovements — `hwpos.stockMovements.v1` (bo-model.js `makeMovement`) · EVENT

Current stock of a product = sum of `qty` over its movements.

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id | string | | `mv_…` | |
| ts | ISO | | when this row was actually typed in — stays the entry time even when `happenedOn` is set | |
| productId | string | | | `p002` |
| qty | number | units, signed | + into the shelf, − out | `-2.5` |
| reason | string | | see below | `sale` |
| refId | string | | order / PO / adjustment id | |
| unitCost | number\|null | pesos/unit | cost at the time of the movement | 180 |
| staff | string | | name | `Maricel R.` |
| note | string | | | |
| expected | number | units | **count movements only**: what the system held before | 40 |
| counted | number | units | **count movements only**: what the shelf held | 37 |
| happenedOn | date\|absent | | store-local `YYYY-MM-DD` the stock actually moved, when that's not the day it was typed — set from Adjust's "In store since", opening stock, receiving's "Arrived on", or an adjustment's document date. Absent on till rows and older rows; the back-office dialogs send it every time, so it can equal `ts`'s own day. A reader uses `happenedOn` when it's a valid date and differs from `ts`'s store-local day, else `ts` (bo-insights.js `when()`). | `2026-08-02` |
| balanceAfter → balance_after | number\|null | units (D1 hundredths) | the product's `stock` right after this movement (`applyMovement`), stamped in ENTRY order (the shelf as it stood when the row was applied, not on `happenedOn`) — wrong to read as the shelf's history on a back-dated row; null = written by an older build | 37.5 |

| reason | Sign | Written by | Means |
|---|---|---|---|
| sale | − | POS | sold (refId = order) |
| return | + | POS | back from a void, refund or return (refId = order) |
| delivery | + | back office `receivePo` | received from a supplier (refId = PO, unitCost = PO line cost) |
| adjustment | ± | Inventory | generic correction — prefer a specific reason below |
| count | ± | Inventory | stock count difference; `counted − expected = qty` |
| transfer | ± | | moved between stores |
| shrinkage | − | Inventory | missing, cause unknown (theft, miscount) |
| damage | − | Inventory | broken / spoiled (label "Breakage") |
| writeoff | − | Inventory | removed deliberately (expired, obsolete) |

## adjustments — `hwpos.adjustments.v1` (bo-inventory.js `saveDraft`) · EVENT

`{ id:'adj_…', reason, staff, date:'YYYY-MM-DD', note, createdAt:ISO, lines:[{ productId, name, before, counted, delta, unitCost }] }`
— units for before/counted/delta, pesos for unitCost. Only lines that moved are kept; each is also a movement with `refId = id`.

## purchaseOrders — `hwpos.purchaseOrders.v1` (bo-model.js `PO_DEFAULTS`, `poLine`)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id, number | string | | key / `PO-0082` |
| supplierId | string | | |
| status | string | | draft → ordered → partial → received, or cancelled |
| orderedAt | ISO\|'' | | status flipped to ordered |
| sentAt | ISO\|'' | | actually sent to the supplier (lead time starts here; falls back to orderedAt) |
| promisedAt | date\|ISO\|'' | | the date **the supplier** gave |
| expectedAt | date\|ISO\|'' | | **our** guess; edited freely |
| receivedAt | ISO\|'' | | fully received |
| note | string | | |
| items[] | object[] | | lines, below (D1 `purchase_order_items`, route `poItems`) |
| updatedAt | ISO | | |
| total (D1 only) | integer centavos | | `poTotal` = Σ cost×qty, derived on the client |

**Lines**

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id | string | | `pol_…` |
| productId | string | | |
| qty | number | units | ordered |
| cost | number | pesos/unit | quoted / expected cost |
| receivedQty | number | units | received so far (`receivePo` adds) |
| invoiceCost | number\|null | pesos/unit | what the supplier **billed**; null = no invoice yet |
| shortReason | string | | why receivedQty < qty |

## suppliers — `hwpos.suppliers.v1` (bo-model.js `SUPPLIER_DEFAULTS`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id, name, contact, phone, email, address, note | string | | | `Holcim` |
| orderDays | int[] | weekday 0=Sun | days they take orders (D1 json `order_days`) | `[1,4]` |
| minOrder | number | pesos | minimum order value (D1 centavos `min_order`) | 15000 |
| quotedLeadDays | number | days | what they **say**; real lead time is derived | 3 |

## staff — `hwpos.staff.v1` (bo-model.js `STAFF_DEFAULTS`, seed `SEED_STAFF`)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id, name, email, phone | string | | |
| role | string | | owner\|manager\|cashier\|stock |
| pin | string | | **credential — stripped from `HWPOS_AI.snapshot()`** |
| salary | number | pesos/month | |
| salaryPerDay | number | pesos/day | |
| workDays | number | days/month | |
| startedAt | date | | `2024-01-15` |
| active | bool | | |
| attendance | string | | legacy seed "today" mark; use the attendance blob |

## attendance — `hwpos.attendance.v1` (bo-staff.js) · object

`{ "2026-09-14": { "Aldrin S.": "late", "Joy P.": "dayoff" } }` — keys are local dates, then **staff name**.
Marks: `present` · `late` · `halfday` · `dayoff` · `absent`. A day mark, not hours (hours: `clock`).

## advances — `hwpos.advances.v1` (bo-staff.js) · EVENT*

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id | string | | `ca_…` |
| staffId | string | | staff.id |
| amount | number | pesos | handed over |
| date | date | local | day of the handover; payroll month = `date.slice(0,7)` |
| note | string | | reason |
| createdAt | ISO | | when recorded |
| voided | bool | | set in place when entered by mistake |

## drawerCloseouts — `hwpos.drawerCloseouts.v1` (app.js)

`{ id:'drawer_…', ts: epoch ms, date, expectedCash, …drawer summary, countedCash, difference, notes, cashier }` — pesos. One per `date` (a re-close replaces it).

## days — `hwpos.days.v1` (bo-model.js `upsertDays`) · STATE, upsert-merge

One row per local date. Merged: writing `rainMm` never clears `roadClosure`.

| Field (client → D1) | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id → id | date | local | the date, also the key (D1 key is store_id + id) | `2026-09-14` |
| date → date | date | | mirror of id | |
| rainMm → rain_mm | number | mm | rain over the day | 12.5 |
| rainHoursOpen → rain_hours_open | number | hours | hourly readings > 0.1 mm labelled after `openTime` up to `closeTime` (defaults 7 and 18) | 3 |
| tempMaxC → temp_max_c | number | °C | | 33 |
| weatherCode → weather_code | int | WMO code | | 63 |
| holidayName → holiday_name | string | | empty = not a holiday | `National Heroes Day` |
| isPayday → is_payday | bool / 1\|0 | | the 15th or the last day of the month (bo-insights `paydayFor`) | true |
| events → events | string | | local events (fiesta, market day) | |
| roadClosure → road_closure | string | | | `Rizal St` |
| note → note | string | | | |
| source → source | string | | who filled it; `open-meteo-forecast` rows are re-fetched until the day is past | `manual`, `open-meteo`, `open-meteo-forecast` |

Filled by Insights → Days → *Fill weather and holidays* (free Open-Meteo archive + forecast at
`settings.store.lat/lng`, falling back to the delivery-map default; holidays from Nager.Date). A year whose
holidays failed to load leaves `holidayName` untouched; a loaded year overwrites it, typed names included.
| updatedAt → updated_at | ISO | | | |

## Event logs — every row `{ id:'ev_…', ts: ISO, staff, …fields }` (bo-model.js `makeEvent`, `appendEvents`)

### priceLog — `hwpos.priceLog.v1` → `price_log`
Written by `priceChanges(before, after)` on every catalog save (editor, CSV import, reprice) and on the POS product editor's save.

| Field (client → D1) | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| productId → product_id | string | | | `p002` |
| field → field | `price`\|`cost` | | which number changed | `cost` |
| old → **old_value** | number\|null | pesos (D1 centavos) | before; null = first price of a new product | 180 |
| new → **new_value** | number | pesos (D1 centavos) | after | 195 |
| reason | string | | why, if given | `supplier increase` |
| source | string | | `backoffice`, `pos` | |
| staff | string | | `settings.store.cashier` (backoffice.js `actor()`), not a login (see gaps) | `El John` |

### lostDemand — `hwpos.lostDemand.v1` → `lost_demand`

| Field (client → D1) | Type | Unit | Meaning |
|---|---|---|---|
| productId → product_id | string\|'' | | '' / null when the store does not carry it |
| text | string | | what was asked for, in the customer's words |
| qty | number | units (D1 hundredths) | how many were wanted |
| reason | string | | `out-of-stock` · `not-carried` · `too-expensive` · `other` |
| substituteProductId → substitute_product_id | string | | bought this instead (substitution flag) |
| terminal | string | | till / register |

### deliveryEvents — `hwpos.deliveryEvents.v1` → `delivery_events`

| Field | Type | Unit | Meaning |
|---|---|---|---|
| orderId → order_id | string | | the delivery order |
| event | string | | `dispatched` · `arrived` · `returned` · `failed` |
| driver | string | | name |
| lat, lng | number\|null | degrees | where it happened; always null from the till (GPS is Tier 2) |
| note | string | | |
| terminal | string | | register number from settings (same value as `orders.register`) |

Written by the POS order-details modal (app.js `recordDeliveryEvent`). The trip's state is the row with
the newest `ts` for that orderId. Drive time = `arrived.ts − dispatched.ts` for the same orderId. Taps
are not ordered or de-duplicated: read them as facts, not a state machine.

### clock — `hwpos.clock.v1` → `clock_events`

| Field | Type | Meaning |
|---|---|---|
| staffId → staff_id | string | staff.id |
| staffName → staff_name | string | name at the time |
| event | `in`\|`out` | hours = pair in→out by staffId, same local date |

### supplierMessages — `hwpos.supplierMessages.v1` → `supplier_messages`

| Field | Type | Meaning |
|---|---|---|
| supplierId → supplier_id | string | |
| poId → po_id | string | PO the message is about, if any |
| direction | `in`\|`out` | from them / to them |
| channel | string | `viber` · `sms` · `email` · `call` · `other` |
| text | string | the message, verbatim (call = summary) |

### decisions — `hwpos.decisions.v1` → `decisions`

| Field | Type | Meaning |
|---|---|---|
| kind | string | what was decided (`reorder`, `reprice`, …) |
| subjectId → subject_id | string | product / supplier / PO id |
| inputs | object (D1 json) | the numbers the rule saw |
| rule | string | the rule name / version |
| choice | object (D1 json) | what it chose and what the person did |
| accepted | bool\|null (D1 1/0/null) | did a person take it; null = not answered |
| actor | string | `system` or the person who acted |

Written today:

| kind | Where | inputs | rule | choice | accepted |
|---|---|---|---|---|---|
| `reorder` | Inventory → Needs buying → Create purchase order, one row per line | `onHand, reorderPoint` | `suggestQty v0` (rows written before the park say `reorderPlan v1`, with `dailyRate, sdDaily, leadDays, reviewDays, onOrder, serviceLevel, basis`) | `suggestQty, orderedQty, poId` | `orderedQty === suggestQty` |
| `reprice` | Inventory → Cost changes → Apply | `bookCost, paidCost, gapPct, price, marginMode, deliveryRefId` | `costDrift heldPrice v1` | `cost, price` | always true |

`actor` and `staff` are `settings.store.cashier` (backoffice.js `actor()`, shared by every back-office event log).

## Till event stream — `tillEvents` (data-store.js `HWPOS_STORE.events`) → `till_events` · EVENT

Raw facts from actions the till already has. No calculations. `append()` never throws and never
waits, so a broken store cannot stop a sale. Rows buffer in memory and are written to IndexedDB
`hwpos-events` / store `tillEvents` every 2 s and on pagehide / tab hidden, one transaction per
flush. If IndexedDB fails they go to localStorage `hwpos.tillEvents.fallback.v1`, capped at 2,000
rows (oldest dropped, with a dropped count kept). Upload: `POST /tillEvents` with an array of up to
1,000 rows, sent as stored: the Worker reads camelCase (`sessionId`) as well as snake_case, ignores
`synced`, and stamps `store_id` from the JWT. A re-sent batch books nothing twice (`on conflict(id) do
nothing`). Each row is checked before insert (needs `id` and `type`, and a `ts` `Date.parse` can
read); a bad row is skipped, not a 500 that fails the whole batch. The response is
`{received, inserted, rejected: [{index, id, error}]}` — `inserted` counts only rows D1 actually
wrote (a duplicate id, in this batch or already stored, is `received` but not `inserted`); 201 if
at least one row was valid, 400 if none were. No PATCH, DELETE or PUT. Nothing uploads yet; mark
rows synced only after a 2xx.
Read them in the browser with `HWPOS_AI.tillEvents()`; Export for AI includes them as `tillEvents`.

**Common fields, on every row** (client → D1)

| Field | Type | Meaning |
|---|---|---|
| id → id | string | client UUID (`crypto.randomUUID`, else `newId`) |
| ts → ts | ISO | the tablet's clock at the tap. Tablet clocks drift, see gaps. |
| type → type | string | one of the types below |
| sessionId → session_id | string | one per page load. A reload starts a new session. |
| terminal → terminal | string | the till's terminal / register id |
| cashier → cashier | string | the current cashier's display name |
| cartId → cart_id | string | the cart in progress, `''` outside a cart. Joins every row of one basket. |
| online → online | bool (D1 1/0) | `navigator.onLine` at the tap |
| appVersion → app_version | string | the build that wrote it |
| synced | 0\|1 | client only: uploaded yet. Not sent to D1. |
| storeId → store_id | string | `''` on the client. The Worker stamps it from the JWT. |
| data → data | object (D1 json) | per-type fields, below. Read with `json_extract(data,'$.productId')`. |
| — → received_at | ISO | D1 only, server clock at upload. `received_at − ts` is how long it sat offline. |

**Types** (`data` fields). Money is pesos and qty is units, the same as the rest of the client.

| type | data | Fires when |
|---|---|---|
| app_open | — | the POS page loads |
| app_visible / app_hidden | — | the tab or app comes to the front or goes to the back |
| online / offline | — | the browser's connection flips |
| cashier_switch | from, to | the till reloads settings and the cashier setting changed (another tab, or the app coming back to the front). There is no till login. |
| clock | event `in`\|`out`, staffName | **not written by this build**: the till has no clock. Clock rows come from Staff → Attendance (`clock` log). |
| cart_start | — | the first item goes into an empty cart |
| item_add | productId, qty, unitPrice, stockOnHand, via `scan`\|`search`\|`tile`\|`variant`\|`other` | a line is added. `keypad` is reserved; the till has no PLU keypad. |
| item_qty | productId, from, to | a line's quantity is changed |
| item_remove | productId, qty, unitPrice | a line is removed |
| cart_clear | lines, subtotal | the whole cart is cleared without a sale |
| cart_hold | lines | Save receipt parks the cart. `cart_resume` is **not written**: saved receipts cannot be loaded back. |
| price_override | productId, from, to | **not written by this build**: the till cannot change a line's price. |
| discount | scope `line`\|`cart`, kind, value, productId?, tier? | a discount is applied |
| customer_attach / customer_detach | customerId (+ tier on attach) | a customer is put on or taken off the sale. A cart discount removed as a side effect is not logged. |
| customer_create | customerId | a customer is created from the till |
| search | query, results, chosenProductId | once per search: on pick, or on clear / blur / timeout with the final query. Never per keystroke. |
| scan | code, found, productId | a barcode is read. An unknown code typed by a keyboard-style scanner into the search box is a `search` with no pick, not `scan` found:false. |
| oos_tap | productId, stockOnHand | a product at or below zero stock is tapped or scanned |
| checkout_open | lines, subtotal | checkout opens |
| checkout_cancel | — | checkout is closed without paying |
| payment_method | method | a tender is picked |
| sale_complete | orderId, total, lines, fulfilment, customerId, msSinceCartStart | an order is saved as completed, after its stock movements. An exchange's new sale writes one too, with `msSinceCartStart` null. Cost per line is on the order (`items[].cost`) and on its movements (`unitCost`, `balanceAfter`); join `orderId` to `stockMovements.refId`. |
| void | orderId, reason | an order is voided |
| refund | orderId, amount, reason | an order is refunded, exchanged or returned. Only `reason` tells them apart. |
| receipt_print | orderId, ok | a print is attempted. On a network/Bluetooth printer `ok` = it reported success; on the browser driver `ok` only means the print pop-up opened. The Settings test print logs one too, with the sample order id. |
| drawer_open | reason | **not written by this build**: there is no no-sale drawer open. |

**Blind spots. Read before counting.**
- **Only what the till handles.** Nobody logs a customer who walks out without touching the
  screen. `oos_tap` and `search` with no pick are a floor for lost demand, not a count.
- **`ts` is the tablet clock.** Order rows within one `sessionId` by `ts`. Across tablets, allow for
  drift. `received_at` is the server clock, but it only tells you when a row was uploaded.
- **No sequence inside one millisecond.** One tap can write several rows with the same `ts`
  (`cart_start` + `item_add`, `customer_create` + `customer_attach`); `id` is random, so it doesn't
  order them. Read them in catalogue order.
- **A `scan` that starts a cart has `cartId` `''`**: it is written before the cart exists. The
  `item_add` right after it carries the new `cartId`. `void`, `refund` and `receipt_print` happen
  outside a cart, so they carry `''` too. Join them by `orderId`.
- **Loss window.** A real power cut or crash mid-write can still lose the in-flight row; a normal
  close (`pagehide` / tab hidden) is covered — the buffer is stashed to the localStorage fallback
  synchronously before the async IndexedDB flush is even started, so it survives the page going away.
- **Fallback cap.** Anything past 2,000 unsynced rows, or past ~250,000 chars of JSON (whichever
  comes first, oldest first), drops. The dropped count says how many; a malformed row (not an
  object, or missing a string `id`) is also dropped and counted rather than corrupting later reads.
- **A type exists only where its action exists.** A build without holds writes no `cart_hold`. Old
  builds write no events at all. Missing rows before a store's first `app_open` mean no data, not
  no activity.
- **`cashier` is the till's setting**, not an authenticated login (same as the other POS logs).
- **`search` intent is a heuristic** (pick / clear / blur / timeout). A retyped query can show up
  as two searches.
- **`stockOnHand` is the tablet's cached `stock`**, which can be stale until the catalog syncs.

## Derived (never stored)

Computed on read by `bo-insights.js` (`HWPOS_INSIGHTS.buildInsights(collections, {now})`, surfaced as
`HWPOS_AI.snapshot().insights`). Recompute rather than store; a stored copy is a second truth.

| Insight | From | How |
|---|---|---|
| Stockout intervals | stockMovements | running sum per product; spans where it sat ≤ 0, start/end ts |
| Supplier lead time & reliability | purchaseOrders | `(sentAt‖orderedAt) → receivedAt` in days, mean + spread; vs `quotedLeadDays` and `promisedAt` |
| Supplier fill rate | PO lines | Σ receivedQty ÷ Σ qty, with shortReason |
| Demand rate & variability | stockMovements (sale − return) | units per in-stock day, excluding stockout days; std-dev |
| Reorder plan | demand, lead time, stock, supplier orderDays/minOrder | reorder point = demand × lead + safety. **Parked**: Insights only; Needs buying stays on `suggestQty` until the capture layer has data |
| Cash asleep | products, movements | stock × cost × days since last sale, ranked |
| Sell-through per delivery | delivery movements vs later sales | received qty on a date → days to clear |
| Dead stock | movements, products | no sale in 90 days, peso value at cost |
| Customer reorder cycles | orders.customer.id | median days between orders; overdue list |
| Basket affinity | order items | products co-occurring on receipts (support / lift) |
| Delivery points | orders.deliveryLocation | lat/lng of delivery orders, count and value |
| Sales per staff day | orders.cashier × attendance (× clock) | revenue per person per local date |
| Count accuracy | count movements | per product `|counted − expected| ÷ expected` over time → confidence |
| Current stock, customer balance, low-stock, deliveries coming | movements / ledger / POs | see docs/architecture.md "Derived, never stored" |

## Known gaps — read before trusting a number

- **Sales are not demand.** Units sold = demand − what could not be served. A product at zero sells
  zero and looks unwanted. Exclude stockout intervals when estimating demand. `lostDemand` is the
  partial fix: it only holds what staff remembered to log, so treat it as a floor, not a count.
- **Two timestamp formats.** Orders, ledger and closeouts are epoch ms; everything newer is ISO.
- **The D1 rollup uses the UTC date** (`substr(ts,1,10)` in `daily_sales`), not the Manila date; sales
  before 08:00 local roll into the previous day there. Use local dates for joins to `days`.
- **Orders are mutated locally on void/refund** (`saveOrderMutation` flips `status`, sets
  `voidedAt`/`refundedAt`); only a `return` is a new row. The Worker is append-only, so a void made
  after the sale synced does not reach D1 as it stands. Advances set `voided` in place too.
- **Attendance is keyed by staff name**, a day mark with no hours; rename a person and history splits.
  Real hours come only from `clock`, which starts empty.
- **Back-office event `staff` is the store's cashier setting**, not whoever is at the screen, until the
  back office has a login. POS rows (`lostDemand`, `deliveryEvents`) use the till's cashier setting.
- **Price history before the log** exists only as order-line `price`/`cost` and movement `unitCost`.
- **Movement `expected`/`counted`** exist only on counts written after 2026-09-14; older counts
  have `qty` only (variance, not accuracy). **`balanceAfter`** is likewise null on movements from
  builds before it; replay the running sum for those.
- **Not yet synced to D1**: staff, attendance, advances, adjustments, drawerCloseouts, settings, folders.
- **ids are `prefix_time+random`**, not UUIDs; unique enough per store, not a global guarantee.
- **`days` starts empty.** Weather, holidays and paydays are only as complete as whoever fills them.
