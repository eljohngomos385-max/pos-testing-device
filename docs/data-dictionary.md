# Data dictionary — what every stored row means

Read this before reading the data. It is written for a model as much as a person. Source of truth
for field names is the code named in each section; if the two disagree, the code wins and this file
is the bug. `HWPOS_AI.snapshot()` (data-store.js) returns every collection below in one read-only
object; `HWPOS_AI.dictionaryUrl` points here.

## Conventions (apply everywhere unless a row says otherwise)

| Thing | Rule |
|---|---|
| Money | **Pesos** (number, 2dp) in the browser and on the wire; `sales-math.js` does its sums in centavos. **Integer centavos** in today's D1 schema (`worker/index.js` `TABLES[].money` converts). Target (Supabase, not connected): `numeric(12,2)` in the store's currency, no conversion. Never REAL. |
| Quantity | Units of the product's `unit`, signed where it is a movement. Whole for `soldBy:'each'`, 0.01 step for `soldBy:'measure'`. Today's D1 stores **hundredths** (`TABLES[].scaled`). |
| Timestamps | **Epoch milliseconds** (number) on `orders.ts`, `customerLedger.ts`, and since 2026-10-03 on `stockMovements.ts` and event-log `ts` (older rows there hold ISO text; opening movements have `ts` 0). **ISO-8601 UTC string** (`2026-09-14T02:15:00.000Z`) on POs, `updatedAt`, `createdAt` and till events. Read any `ts` through `SalesMath.tsOf`, which takes both. |
| The date key | **The store's local calendar date, `YYYY-MM-DD`**, in the store's zone: `SalesMath.dayKey(ts, zone)` with `zone = SalesMath.storeZone(settings)` (`settings.store.timeZone`, default Asia/Manila; Settings has no field for it yet). Both apps and `bo-insights.js` use it, so a number does not depend on the device's zone. **Do not use `ts.slice(0,10)` on an ISO string** — that is the UTC date, and anything 00:00–07:59 Manila lands on the previous day. Fields that are already a local date: `adjustments.date`, `happenedOn`, PO line `receivedOn`, `PO.promisedAt/expectedAt` when entered as a date. |
| Weekdays | `0 = Sunday … 6 = Saturday` (`SalesMath.dateParts(ts, zone).weekday`), in the store's date. |
| ids | Client-generated **v4 UUIDs** (bo-model `newId`, which ignores its old prefix argument). Rows from before keep prefixed ids (`mv_…`, `ord_…`, `led_…`); seed rows use short ids (`p001`, `c-001`, `u1`). Fixed ids: `opening:<productId>` movements, `opening:<customerId>` ledger rows, `legacy:<number>:<ts>` for an old order with no id. |
| store_id | Client rows carry `storeId` from `HWPOS_STORE.stamp` (`settings.store.id`, `''` until a store is hosted), with `updatedAt`. Today's Worker stamps `store_id` from the JWT (`app_metadata.store_id`) on every write and scopes every query by it. |
| Names | Client is camelCase, D1 is snake_case of the same word (`productId` → `product_id`). Exceptions are noted per table. |
| STATE vs EVENT | **STATE** = overwritten in place, last write wins. **EVENT** = append-only; a correction is a new row (a void or refund is a new order, an undone payment a `reversal` row); today's Worker refuses PATCH/DELETE/PUT (except `orders.fulfilment_status`). |
| Staff on a row | A **display name** (`'Maricel R.'`) unless the field is `staffId` / `approvedBy` (orders, movements, till `sign_in`/`approval` events). Names are not unique keys; join to `staff` by `name` only when no id exists. |

## Storage keys

| Collection (`HWPOS_AI` / Worker route) | localStorage key | Kind | One row is | Owner (writes) | D1 table |
|---|---|---|---|---|---|
| products | `hwpos.products.v2` | STATE | a sellable, countable, orderable item (a variant is a product) | back office | products |
| folders | `hwpos.folders.v2` | STATE | a category | back office | categories |
| groups | `hwpos.groups.v1` | STATE | a variant family | back office | product_groups |
| orders | `hwpos.orders.v1` | EVENT | one receipt: a sale, a void, a refund, or a parked cart | POS | orders |
| orderSeq | `hwpos.orderSeq.v1` | STATE | the till's last receipt sequence number | POS | — |
| customers | `hwpos.customers.v1` | STATE | a named buyer, on credit or not | POS / back office | customers |
| customerLedger | `hwpos.customerLedger.v1` | EVENT | one change to an account (charge, opening, adjustment, payment, reversal) | POS + back office (bo-model `postToAccount`) | customer_ledger |
| stockMovements | `hwpos.stockMovements.v1` | EVENT | stock moved once, with a reason; on hand = their sum (bo-model `stockOnHand` / `withStock`); a count stores its difference | POS + back office | stock_movements |
| stockAnchored | `hwpos.stockAnchored.v1` | STATE | timestamp: this device wrote its opening rows from the saved counts, once | data-store `seedOpening` | — |
| purchaseOrders | `hwpos.purchaseOrders.v1` | STATE | an order to a supplier, lines embedded | back office | purchase_orders + purchase_order_items (`poItems`) |
| suppliers | `hwpos.suppliers.v1` | STATE | a supplier | back office | suppliers |
| modifiers | `hwpos.modifiers.v1` | STATE | a modifier set `{id,name,options:[{id,name,price}],archived,updatedAt}` (products.modifierIds) | back office | modifier_lists |
| staff | `hwpos.staff.v1` | STATE | an employee (`pin` removed from the AI snapshot) | back office | — |
| tillPerms | `hwpos.tillPerms.v1` | STATE (object) | role → till actions it may do without a manager PIN (`TILL_ACTIONS`: void, refund, overLimit, credit) | back office | — |
| access | `hwpos.access.v1` | STATE (object) | role → back-office pages it may open | back office | — |
| adjustments | `hwpos.adjustments.v1` | EVENT | a saved stock count / adjustment document | back office | — (its movements sync) |
| priceLog | `hwpos.priceLog.v1` | EVENT | a price or cost changed | bo-model `saveCatalog` (the till's and back office's `saveProducts` both call it; it diffs with `priceChanges`) | price_log |
| lostDemand | `hwpos.lostDemand.v1` | EVENT | a customer asked and did not get it | POS | lost_demand |
| deliveryEvents | `hwpos.deliveryEvents.v1` | EVENT | a customer delivery changed stage | POS / back office | delivery_events |
| supplierMessages | `hwpos.supplierMessages.v1` | EVENT | one message to or from a supplier | back office | supplier_messages |
| decisions | `hwpos.decisions.v1` | EVENT | one automated suggestion/action and its outcome | back office | decisions |
| settings | `hwpos.settings.v1` | STATE (object) | store config (tax, store info, `defaultFulfilment`, `fulfilment {hidden, custom}`; `schemaVersion` 2), read through `HWPOS_STORE.readSettings` over `DEFAULT_SETTINGS` | POS settings / back office | — |
| tillEvents | IndexedDB `hwpos-events` / `tillEvents` (fallback `hwpos.tillEvents.fallback.v1`) | EVENT | one thing the till did or was tapped for | POS (`HWPOS_STORE.events.append`) | till_events |

`orders`, `stockMovements` and `customerLedger` live in IndexedDB `hwpos-sheets` behind `HWPOS_STORE.kv` (docs/architecture.md); every other key is localStorage, and only `data-store.js` touches it.

## Join keys

| Key | Appears on | Points at |
|---|---|---|
| productId | order `items[].productId`, stockMovements, PO lines, priceLog, lostDemand (+ `substituteProductId`), decisions `subjectId` | products.id |
| orderId | customerLedger.orderId and payment `allocations[].orderId`, stockMovements.refId (reason sale/return), deliveryEvents.orderId, orders.originalOrderId (on a void, a refund, or an exchange's new sale: the original sale) | orders.id |
| poId | stockMovements.refId (reason delivery), supplierMessages.poId | purchaseOrders.id |
| lineId | stockMovements.lineId (reason delivery) | the PO line `items[].id` |
| adjustment id | stockMovements.refId (reason count/adjustment/shrinkage/damage/writeoff from Inventory) | adjustments.id |
| supplierId | products.supplierId / altSupplierIds, PO line `supplierId` (older POs: purchaseOrders.supplierId), delivery movements `supplierId`, supplierMessages.supplierId | suppliers.id |
| folder | products.folder / folders[], groups.folder | folders.id |
| modifierId | products.modifierIds[] | modifiers.id |
| customerId | orders.customer.id, customerLedger.customerId | customers.id |
| staffId | orders.staffId / approvedBy, stockMovements.staffId, till events `sign_in` / `approval` | staff.id |
| staff name | orders.cashier, stockMovements.staff, adjustments.staff, event `staff` | staff.name (not unique) |
| date | local date of any timestamp (see Conventions) | days.id |

## products — `hwpos.products.v2` (bo-model.js `PRODUCT_DEFAULTS`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id | string | | product key | `p001` |
| sku / barcode | string | | store code / EAN | `PVC-ELB-12` / `4801234500011` |
| name, brand | string | | | `PVC Elbow 1/2"`, `Atlanta` |
| folder | string | | first category id (D1 `folder_id`); `folders[0]` | `plumbing` |
| folders | string[] | | every category it is in (`foldersOf`) | `["plumbing"]` |
| description | string | | | |
| unit | string | | selling unit | `pc`, `m`, `kg` |
| soldBy | `each`\|`measure` | | measure = 0.01 qty step | `each` |
| cost | number | pesos/unit | what we pay **now** (history: priceLog, movement `unitCost`) | 7.5 |
| price | number | pesos/unit | shelf price now | 12 |
| marginMode | `percent`\|`flat` | | how margin is expressed | `percent` |
| marginValue | number | % markup on cost, or pesos | | 60 |
| stock | number | units | **cache**: `withStock` sets it from the movement sum on every load; the saved value is read once, by `openingRows` | 240 |
| reorderPoint | number | units | hand-typed danger level (D1 `danger_level`) | 50 |
| sellOutOfStock | bool | | may sell below zero | false |
| supplierId | string | | primary supplier | `s1` |
| altSupplierIds | string[] | | other suppliers that stock it | `["s3"]` |
| groupId | string | | variant family | `g1` |
| imageUrl | string | | data: URL (256px WebP) | |
| weight, size, length | string | free text | | `3/4 in` |
| aliases | string[] | | search words | `["half elbow"]` |
| hidden | bool | | kept and listed, but off the till's tiles and search | false |
| trackStock | bool | | false = no counts, never an out-of-stock prompt (a service, a cut) | true |
| modifierIds | string[] | | modifier sets offered at sale | |
| archived | bool | | hidden, not deleted | false |
| updatedAt | ISO | | last write | |

## orders — `hwpos.orders.v1` (pos-core.js `normalizeOrderRecord`, `formatKey 'hwpos.order.v1'`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| schemaVersion | number | | 2 since 2026-10-03 (`SalesMath.ORDER_VERSION`); a v1 `pickup` reads as `walkin` | 2 |
| id / number | string | | UUID key / printed receipt number `<register>-<seq>` | / `1-042` |
| ts | number | epoch ms | when rung up (a void/refund row: when it was done) | 1757815200000 |
| status | string | | `completed` sale · `void` · `refund` (each a new row pointing at the sale) · `saved` parked, not a sale. Old `voided`/`refunded`/`return` rows are rewritten on load by `SalesMath.upgradeOrders` | `completed` |
| cashier, register | string | | staff name (on a void/refund: who pressed it), till number | `Aldrin S.`, `1` |
| staffId, approvedBy | string | | who rang it (till PIN sign-in); the manager whose PIN let it through, if one had to | |
| storeId, updatedAt | string | | the sync stamp (`HWPOS_STORE.stamp`) | |
| customer | object\|null | | `{id,name,phone,address}` snapshot | |
| paymentMethod | string | | drawer coercion: cash\|credit\|split\|unpaid | `cash` |
| paymentKind / paymentMethodLabel | string | | the real tender: cash\|gcash\|qr\|credit\|split\|other / label | `gcash` / `GCash` |
| payments[] | object[] | pesos | `{method,label,amount,tendered,change,ref}` | |
| subtotal, discount, total | number | pesos | gross, discount, paid. Unsigned on every row: `status` carries the sign | |
| cartDiscount | object\|null | | `{type:'percent'\|'amount', value}` | |
| tendered, change | number | pesos | cash leg | |
| vatRate | number | fraction | | 0.12 |
| vatAmount, vatableSales, vatExempt | number | pesos | | |
| scPwdOff | number | pesos | senior / PWD discount taken | |
| taxIncluded | bool | | tax sat inside the prices (false = added on top); stamped at sale | true |
| fulfilment | `walkin` (default)\|`pickup`\|`delivery`\|own type name | | label: bo-model `orderFulfilLabel` | |
| deliveryAddress | string | | | |
| deliveryLocation | object\|null | degrees | `{lat,lng,zoom,provider,attribution}` | |
| originalOrderId | string | | on a `void`/`refund` row: the sale it reverses; on an exchange's new sale: the original sale | |
| reason | string | | void/refund reason; `Exchange` on an exchange | |
| meta | object | | `{source:'pos-app', replaceableFormat:true}` | |

**items[]** (`normalizeOrderItem`)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| productId (= id) | string | | products.id |
| sku, name, unit | string | | snapshot at sale |
| qty | number | units | ≥ 0, decimals for measure |
| price | number | pesos/unit | price charged |
| discount | object\|null | | `{type:'percent'\|'amount', value}` |
| lineGross, lineDiscount, lineTotal | number | pesos | qty×price, off, net |
| cost | number\|null | pesos/unit | **our cost stamped at the moment of sale** — margin uses this, never today's cost; null = unknown |
| lineNo | number | | **refund rows only**: which line of the original sale came back. A refund with no `lineNo` (or a void) took the whole sale |

Sign when summing sales (`SalesMath.sign`): `completed` +1, `void`/`refund` −1, `saved` 0. Each row counts on its own day: a void only cancels a sale on the same store day, a refund counts on the day it was done. Sale state (`SalesMath.rowState` / `statusOf`): Completed, Part refunded, Voided, Refunded.

## customers — `hwpos.customers.v1` (bo-model.js `normalizeCustomer`, + seed `CUSTOMERS` in data.js)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id, name, phone, address | string | | phone is the outreach key (a duplicate warns, never blocks) |
| creditOn | bool | | may buy on account |
| creditLimit | number\|null | pesos | null = no limit; always null when credit is off |

No stored balance: it is the ledger's sum (`balancesOf`; `allCustomerRecords` adds it as `currentBalance` on read). Old records' `type`, `isCreditCustomer` and stored `currentBalance` are dropped on read; a stored balance became an `opening` ledger row once per device (`migrateCustomers`, marked `hwpos.customersMigrated.v1`).

## customerLedger — `hwpos.customerLedger.v1` (bo-model.js `postToAccount`, the one writer, shared by both apps) · EVENT

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id | string | | UUID; `opening:<customerId>` for the migrated balance |
| ts | number | epoch ms | |
| customerId, customerName | string | | |
| type | `charge`\|`opening`\|`adjustment`\|`payment`\|`reversal` | | `LEDGER_SIGN`: charge/opening/adjustment raise the balance, payment/reversal lower it |
| amount | number | pesos | positive; only `opening` and `adjustment` carry their own sign |
| orderId | string | | receipt that caused it, if any. A `reversal` with an orderId takes back a voided/refunded sale's charge (an old `payment` with an orderId reads as one) |
| reverses | string | | on a `reversal`: the payment row it undoes; both then count for nothing |
| allocations | `[{orderId, amount}]` | pesos | on a payment: which orders it paid (`recordPayment`) |
| method, methodLabel | string | | on a payment: how it was paid |
| note | string | | required on an `adjustment` |
| storeId, updatedAt | string | | the sync stamp |

## stockMovements — `hwpos.stockMovements.v1` (bo-model.js `makeMovement`) · EVENT

Current stock of a product = sum of `qty` over its movements (`stockOnHand`), starting from its `opening` row.

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id | string | | UUID (older rows `mv_…`); `opening:<productId>` for the opening row | |
| ts | number | epoch ms | when this row was actually typed in — stays the entry time even when `happenedOn` is set. ISO text on rows before 2026-10-03; 0 on opening rows | |
| productId | string | | | `p002` |
| qty | number | units, signed | + into the shelf, − out | `-2.5` |
| reason | string | | see below | `sale` |
| refId | string | | order / PO / adjustment id | |
| unitCost | number\|null | pesos/unit | cost at the time of the movement | 180 |
| staff | string | | name at the time | `Maricel R.` |
| staffId | string | | who did it (staff.id) | |
| note | string | | | |
| supplierId, lineId | string | | **delivery movements only**: the PO line's supplier, and which line | |
| expected | number | units | **count movements only**: what the system held before | 40 |
| counted | number | units | **count movements only**: what the shelf held | 37 |
| happenedOn | date\|absent | | store-local `YYYY-MM-DD` the stock actually moved, when that's not the day it was typed — set from Adjust's "In store since", opening stock, receiving's "Arrived on", or an adjustment's document date. Absent on till rows and older rows; the back-office dialogs send it every time, so it can equal `ts`'s own day. A reader uses `happenedOn` when it's a valid date and differs from `ts`'s store-local day, else `ts` (bo-insights.js `when()`). | `2026-08-02` |
| balanceAfter → balance_after | number\|null | units (D1 hundredths) | the product's `stock` right after this movement (`applyMovement`), stamped in ENTRY order (the shelf as it stood when the row was applied, not on `happenedOn`) — wrong to read as the shelf's history on a back-dated row; null = written by an older build. The screens use `runningBalances` (the running sum) instead | 37.5 |
| storeId, updatedAt | string | | the sync stamp | |

| reason | Sign | Written by | Means |
|---|---|---|---|
| opening | ± | data-store `seedOpening` (`openingRows`), once per device | the stock it had before its first logged move (saved count − Σ log), `ts` 0 |
| sale | − | POS | sold (refId = order) |
| return | + | POS `restoreOrderStock` | back from a void, refund or exchange (refId = the original sale) |
| delivery | + | back office `receivePo` | received from a supplier (refId = PO, lineId, supplierId; unitCost = what was billed, else the PO line cost) |
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
| supplierId | string | | **old POs only**: the supplier now lives on each line (`lineSupplier` falls back to this) |
| status | string | | draft → ordered → partial → received, or cancelled. Derived by `poStatus` from the lines, `sentAt` and `cancelledAt`; only cached here |
| cancelledAt | ISO\|'' | | cancelled |
| orderedAt | ISO\|'' | | status flipped to ordered |
| sentAt | ISO\|'' | | actually sent to the supplier (lead time starts here; falls back to orderedAt) |
| promisedAt | date\|ISO\|'' | | the date **the supplier** gave |
| expectedAt | date\|ISO\|'' | | **our** guess; edited freely |
| receivedAt | ISO\|'' | | fully received |
| note | string | | |
| items[] | object[] | | lines, below (D1 `purchase_order_items`, route `poItems`) |
| updatedAt | ISO | | |
| total (D1 only) | integer centavos | | `poTotal`, derived on the client: per line, what arrived at its billed cost plus what is still to come at the quote |

**Lines**

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id | string | | UUID (older rows `pol_…`) |
| productId | string | | |
| supplierId | string | | where to buy it; `''` = anywhere (a market run) |
| qty | number | units | ordered |
| cost | number | pesos/unit | quoted / expected cost |
| receivedQty | number | units | received so far (`receivePo` adds) |
| receivedOn | date\|'' | | store-local day it last arrived |
| receivedCost | number | pesos | Σ each delivery's qty × its unit cost; absent on lines received before 2026-10-03 |
| invoiceCost | number\|null | pesos/unit | what the supplier **billed** on the latest bill; null = no invoice yet |
| shortReason | string | | why receivedQty < qty |
| updatedAt | ISO | | |

## suppliers — `hwpos.suppliers.v1` (bo-model.js `SUPPLIER_DEFAULTS`)

| Field | Type | Unit | Meaning | Example |
|---|---|---|---|---|
| id, name, contact, phone, email, address, note | string | | | `Holcim` |
| archived | bool | | hidden, not deleted | false |

`orderDays`, `minOrder` and `quotedLeadDays` were dropped 2026-09-26: an old record may still carry them and nothing reads them. Lead time is derived (`sentAt`/`orderedAt` → received). `schema.sql` still has the columns.

## staff — `hwpos.staff.v1` (bo-model.js `STAFF_DEFAULTS`, seed `SEED_STAFF`)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| id, name, email | string | | |
| role | string | | owner\|manager\|cashier\|stock |
| pin | string | | the till sign-in and manager approval (`staffByPin`, `approverFor`), checked on the till with no internet. **Credential — stripped from `HWPOS_AI.snapshot()`** |
| active | bool | | |

## Event logs — every row `{ id, ts: epoch ms, staff, …fields, storeId, updatedAt }` (bo-model.js `makeEvent`, `appendEvents`; rows before 2026-10-03 have `ev_…` ids and ISO `ts`)

### priceLog — `hwpos.priceLog.v1` → `price_log`
Written by `priceChanges(before, after)` inside bo-model.js `saveCatalog`, the one catalog write both apps' `saveProducts` call: the back office (editor, CSV import, reprice, PO receive; `source: 'backoffice'`) and the till (`source: 'pos'`, 2026-10-03). A change made anywhere logs the same row.

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

Written by the POS order-details modal (pos-orders.js `recordDeliveryEvent`). The trip's state is the row with
the newest `ts` for that orderId. Drive time = `arrived.ts − dispatched.ts` for the same orderId. Taps
are not ordered or de-duplicated: read them as facts, not a state machine.

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
| `reorder` | **No longer written** (Needs buying removed 2026-09-23); old rows came from its Create purchase order, one row per line | `onHand, reorderPoint` | `suggestQty v0` (rows written before the park say `reorderPlan v1`, with `dailyRate, sdDaily, leadDays, reviewDays, onOrder, serviceLevel, basis`) | `suggestQty, orderedQty, poId` | `orderedQty === suggestQty` |
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
| id → id | string | client UUID (`crypto.randomUUID`, else `ev_<time><random>`) |
| ts → ts | ISO | the tablet's clock at the tap. Tablet clocks drift, see gaps. |
| type → type | string | one of the types below |
| sessionId → session_id | string | one per page load. A reload starts a new session. |
| terminal → terminal | string | the till's terminal / register id |
| cashier → cashier | string | the till's cashier setting (`settings.store.cashier`), not the PIN-signed-in person; `sign_in` rows say who that is |
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
| cashier_switch | from, to | the till reloads settings and the cashier setting changed (another tab, or the app coming back to the front) |
| sign_in | staffId | someone signs in at the till with their PIN (only once any active staff has a PIN; a reload asks again) |
| approval | action (`void`\|`refund`\|`overLimit`\|`credit`), staffId, + the action's own fields | a manager's PIN let an action through for someone whose role can't do it |
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
| void | orderId, reason | a sale is voided (a `void` order row is written) |
| refund | orderId, amount, reason | a sale is refunded, whole or in part, or exchanged (a `refund` order row is written). Only `reason` tells an exchange apart. |
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
- **Fallback cap.** Anything past 2,000 unsynced rows, or past ~600,000 chars of JSON (whichever
  comes first, oldest first), drops. The dropped count says how many; a malformed row (not an
  object, or missing a string `id`) is also dropped and counted rather than corrupting later reads.
- **A type exists only where its action exists.** A build without holds writes no `cart_hold`. Old
  builds write no events at all. Missing rows before a store's first `app_open` mean no data, not
  no activity.
- **`cashier` is the till's setting**, not the PIN sign-in. Orders and movements carry the signed-in
  person (`cashier`, `staffId`); events only carry it on `sign_in` / `approval`.
- **`search` intent is a heuristic** (pick / clear / blur / timeout). A retyped query can show up
  as two searches.
- **`stockOnHand` is this tablet's `stock`** (Σ the movements it holds), which misses other tills'
  sales until they sync.

## Derived (never stored)

Computed on read by `bo-insights.js` (`HWPOS_INSIGHTS.buildInsights(collections, {now})`, surfaced as
`HWPOS_AI.snapshot().insights`). Recompute rather than store; a stored copy is a second truth.

| Insight | From | How |
|---|---|---|
| Stockout intervals | stockMovements | running sum per product; spans where it sat ≤ 0, start/end ts |
| Supplier lead time | purchaseOrders, by each line's supplier | `(sentAt‖orderedAt) →` latest line `receivedOn` (else `receivedAt`) in days, mean + spread |
| Supplier fill rate | PO lines | Σ receivedQty ÷ Σ qty, with shortReason; billed vs quoted cost (`invoiceCost`) |
| ~~Demand rate, Reorder plan~~ | — | **Removed 2026-09-27** by the owner ("build it from the ground up again"): no `demand`, `reorder` or `reorderBySupplier` section, not in Export for AI either. POs use `suggestQty` via Add low stock items, an editable pre-fill |
| Cash asleep | products, movements | stock × cost × days since last sale, ranked |
| Sell-through per delivery | delivery movements vs later sales | received qty on a date → days to clear |
| Dead stock | movements, products | no sale in 90 days, peso value at cost |
| Customer totals | orders.customer.id | orders, spent, first / last order date (no next-order guess, 2026-09-27) |
| Basket affinity | order items | products co-occurring on receipts (support / lift) |
| Delivery points | orders.deliveryLocation | lat/lng of delivery orders, count and value |
| Sales per person | orders, by seller (`SalesMath.sellerOf`: `staffId`, else a name only one person has; a void or refund counts against the original sale's seller) | Sales › By staff (`summarize`), not in `buildInsights` |
| Count accuracy | count movements | per product: counts, last counted, average `|counted − expected|` (`meanAbsVariance`, biggest first) and each count's expected / counted / variance. The confidence score was removed 2026-09-27 by the owner (a made-up score) |
| Current stock, customer balance, low-stock, deliveries coming | movements / ledger / POs | see docs/architecture.md "Derived, never stored" |

## Known gaps — read before trusting a number

- **Sales are not demand.** Units sold = demand − what could not be served. A product at zero sells
  zero and looks unwanted. Exclude stockout intervals when estimating demand. `lostDemand` is the
  partial fix: it only holds what staff remembered to log, so treat it as a floor, not a count.
- **Two timestamp formats.** Orders, ledger, and movements / event logs since 2026-10-03 are epoch
  ms; older movements and event logs, POs, `updatedAt` and till events are ISO. Read through `SalesMath.tsOf`.
- **The D1 rollup** buckets by the store-local day (`TZ_OFFSET_MIN`) but sums `completed` rows only,
  so it does not take off `void`/`refund` rows; the `schema.sql` comment still shows `substr(ts,1,10)`.
- **`schema.sql` and the Worker lag the client**: `orders` has no `original_order_id` or `reason`
  (a void/refund row loses its link to the sale) and its status comment is the old one; ledger `type`
  allows only charge/payment with `amount >= 0`, and `customer_balances` counts charge vs everything
  else; customers have no `credit_on`; suppliers keep `order_days`/`min_order`/`quoted_lead_days`;
  `purchase_orders.supplier_id` is `not null` and PO items have no `supplier_id`; nothing has
  `staff_id`. Phase 5 replaces both.
- **Old orders from before 2026-10-02** were flipped in place to `voided`/`refunded`; `upgradeOrders`
  turns each into a sale plus a `void`/`refund` row (id `<id>:void` / `<id>:refund`, number
  `<number>-V` / `-R`) on load, and an old `return` row into a `refund`.
- **Sales by name on old rows**: a row with no `staffId` files under the one staff member with that
  name, else under the name itself; rename a person and such rows split.
- **Back-office event `staff` is the store's cashier setting**, not whoever is at the screen, until the
  back office has a login. POS rows (`lostDemand`, `deliveryEvents`) use the till's cashier, the
  signed-in person when PINs are on.
- **Price history before the log** exists only as order-line `price`/`cost` and movement `unitCost`.
- **Movement `expected`/`counted`** exist only on counts written after 2026-09-14; older counts
  have `qty` only (variance, not accuracy). **`balanceAfter`** is likewise null on movements from
  builds before it; replay the running sum for those.
- **Nothing syncs yet** (Supabase is not connected). Today's D1 schema has no table for staff,
  adjustments, settings, tillPerms or access. (drawerCloseouts was removed
  2026-10-02: the closeout screen is gone on purpose.)
- **Old ids are `prefix_time+random`**, not UUIDs; new rows are v4 UUIDs.
