// Smallest check that fails if the Insights maths breaks silently.
// Run: node scripts/insights-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// bo-insights.js calls cent/normalizeProduct as globals, the way the browser hands
// them over from bo-model.js. Same wiring as inventory-check.mjs.
const model = require('../bo-model.js');
Object.assign(globalThis, model);
const SalesMath = require('../sales-math.js');   // sets globalThis.SalesMath, as the page's <script> does
const I = require('../bo-insights.js');
const { normalizeProduct } = model;

const at = (date, hh = '10:00') => `${date}T${hh}:00+08:00`;   // store-local clock
const mv = (productId, ts, qty, reason, extra = {}) => ({ id: `${productId}-${ts}-${qty}`, productId, ts, qty, reason, ...extra });

/* ---- Stockout replay: walked back from today's stock ---- */
// +10, sells 2/day for five days to zero, empty two nights, +10, sells 2/day for three days.
const cement = normalizeProduct({ id: 'c', name: 'Cement', cost: 100, stock: 4 });
const log = [mv('c', at('2026-08-31', '08:00'), 10, 'delivery')];
['01', '02', '03', '04', '05'].forEach((d) => log.push(mv('c', at(`2026-09-${d}`), -2, 'sale')));
log.push(mv('c', at('2026-09-08', '09:00'), 10, 'delivery'));
['08', '09', '10'].forEach((d) => log.push(mv('c', at(`2026-09-${d}`), -2, 'sale')));
const now = at('2026-09-11', '00:00');

const so = I.stockoutIntervals([cement], log, now);
assert.equal(so.rows.length, 1);
assert.equal(so.rows[0].intervals.length, 1);
assert.equal(so.rows[0].intervals[0].start, '2026-09-05T02:00:00.000Z');
assert.equal(so.rows[0].intervals[0].end, '2026-09-08T01:00:00.000Z');
assert.equal(so.rows[0].daysOut, 2.96);                     // 71 hours
assert.equal(so.rows[0].outNow, false);
// Still out today: open interval, end null, measured to now.
const empty = I.stockoutIntervals([{ id: 'e', stock: 0 }], [mv('e', at('2026-09-01'), 3, 'count'), mv('e', at('2026-09-09'), -3, 'sale')], now);
assert.equal(empty.rows[0].intervals[0].end, null);
assert.equal(empty.rows[0].daysOut, 1.58);

/* ---- Lead time spread, fill, invoice gap ---- */
const leads = I.supplierLeadTimes([
  { supplierId: 's1', status: 'received', orderedAt: '2026-09-01', promisedAt: '2026-09-04', receivedAt: '2026-09-05',
    items: [{ productId: 'c', qty: 10, receivedQty: 10, cost: 100, invoiceCost: 110 }] },
  { supplierId: 's1', status: 'received', orderedAt: '2026-09-01', sentAt: '2026-09-02', expectedAt: '2026-09-10',
    receivedAt: '2026-09-08T03:00:00.000Z', items: [] },    // sentAt wins over orderedAt
  { supplierId: 's1', status: 'partial', orderedAt: '2026-09-01', receivedAt: '2026-09-09',
    items: [{ productId: 'c', qty: 10, receivedQty: 6, cost: 100, shortReason: 'backorder' }] },
], [{ id: 's1', name: 'Ace' }, { id: 's2', name: 'Never used' }]);
const s1 = leads.find((r) => r.supplierId === 's1');
assert.deepEqual([s1.n, s1.leadDaysMean, s1.leadDaysSd, s1.leadDaysMin, s1.leadDaysMax], [3, 6, 2, 4, 8]);
assert.equal(s1.fillRate, 0.8);
assert.equal(s1.invoiceGapPct, 10);
assert.deepEqual(s1.shortReasons, { backorder: 1 });
assert.equal(leads.find((r) => r.supplierId === 's2').leadDaysMean, null);

/* ---- Basket lift: voided and returned baskets do not count (old rows, upgraded) ---- */
const item = (id) => ({ id, productId: id, name: id.toUpperCase(), qty: 1, price: 1 });
const orders = SalesMath.upgradeOrders([
  { id: 'o1', status: 'completed', items: [item('a'), item('b')] },
  { id: 'o2', status: 'completed', items: [item('a'), item('b')] },
  { id: 'o3', status: 'completed', items: [item('a')] },
  { id: 'o4', status: 'completed', items: [item('c')] },
  { id: 'o5', status: 'voided', items: [item('a'), item('b')] },
  { id: 'o6', status: 'completed', items: [item('a'), item('b')] },
  { id: 'o7', status: 'return', originalOrderId: 'o6', items: [item('a'), item('b')] },
]);
const aff = I.basketAffinity(orders, { minCount: 1, products: [
  { id: 'a', name: 'Hammer', folder: 'Tools' }, { id: 'b', name: 'Nails', folder: 'Paint' }, { id: 'c', folder: 'Paint' }] });
assert.equal(aff.baskets, 4);
assert.equal(aff.products.length, 1);
assert.deepEqual(aff.products[0], { a: 'a', b: 'b', aName: 'Hammer', bName: 'Nails', count: 2, countA: 3, countB: 2,
  support: 0.5, confidenceAtoB: 0.667, confidenceBtoA: 1, lift: 1.33 });   // 2*4 / (3*2)
assert.equal(aff.categories[0].lift, 0.89);                                 // 2*4 / (3*3)
const spaced = I.basketAffinity([{ id: 'x1', status: 'completed', items: [{ productId: 'a' }, { productId: 'b' }] }],
  { minCount: 1, products: [{ id: 'a', folder: 'Hand Tools' }, { id: 'b', folder: 'Paint' }] });
assert.deepEqual([spaced.categories[0].a, spaced.categories[0].b, spaced.categories[0].lift], ['Hand Tools', 'Paint', 1]);

/* ---- Customer totals: the ladder's Orders and Net sales; a voided sale is no order day ---- */
const cust = (id, ts, total, extra = {}) => ({ id, ts: Date.parse(ts), total, subtotal: total, customer: { id: 'k1', name: 'Kim' }, ...extra });
const ct = I.customerTotals([
  cust('k-a', at('2026-09-01'), 100),
  cust('k-b', at('2026-09-05'), 40),
  cust('k-v', at('2026-09-09'), 900),
  cust('k-v:void', at('2026-09-09', '11:00'), 900, { status: 'void', originalOrderId: 'k-v' }),
  cust('k-r', at('2026-09-03', '09:00'), 30, { status: 'refund', originalOrderId: 'k-a' }),
  cust('k-s', at('2026-09-10'), 70, { status: 'saved' }),
], [], now);
assert.deepEqual(ct, [{ customerId: 'k1', name: 'Kim', phone: '', orders: 2, orderDays: 2, netSales: 110,
  firstOrderDate: '2026-09-01', lastOrderDate: '2026-09-05', daysSinceLast: 6 }]);

/* ---- FIFO sell-through: the opening count sells first ---- */
const st = I.sellThrough([
  mv('n', at('2026-09-01'), 5, 'count'),
  mv('n', at('2026-09-02'), 10, 'delivery', { refId: 'po1' }),
  mv('n', at('2026-09-03'), -8, 'sale'),                    // 5 opening + 3 of the delivery
  mv('n', at('2026-09-04'), -2, 'damage'),
  mv('n', at('2026-09-05'), -5, 'sale'),                    // clears the delivery
  mv('n', at('2026-09-06'), 4, 'delivery', { refId: 'po2' }),
], [{ id: 'po1', number: 'PO-1', supplierId: 's1' }]);
assert.equal(st.length, 2);
assert.deepEqual([st[0].soldQty, st[0].otherOutQty, st[0].remainingQty, st[0].daysToClear, st[0].poNumber], [8, 2, 0, 3, 'PO-1']);
assert.equal(st[1].daysToClear, null);
assert.equal(st[1].remainingQty, 4);
// No opening count in the log: shelf stock that predates it (12 - (10 - 6) = 8) still sells first.
const st2 = I.sellThrough([
  mv('o', at('2026-09-02'), 10, 'delivery', { refId: 'po1' }),
  mv('o', at('2026-09-03'), -6, 'sale'),
], [], [{ id: 'o', stock: 12 }]);
assert.deepEqual([st2[0].soldQty, st2[0].remainingQty], [0, 10]);

/* ---- Count accuracy (facts only, biggest average miss first) and dead stock ---- */
const acc = I.countAccuracy([mv('c', at('2026-09-01'), -3, 'count', { expected: 40, counted: 37 }),
  mv('d', at('2026-09-01'), -1, 'count', { expected: 5, counted: 4 }), mv('d', at('2026-09-02'), -9, 'count', { expected: 20, counted: 11 })]);
assert.deepEqual(acc.map((r) => [r.productId, r.counts, r.meanAbsVariance]), [['d', 2, 5], ['c', 1, 3]]);
assert.deepEqual(acc[1].history[0], { ts: '2026-09-01T02:00:00.000Z', expected: 40, counted: 37, variance: -3, variancePct: -7.5, staff: '' });
assert.ok(acc.every((r) => !('confidence' in r)));
const dead = I.deadStock([{ ...cement, stock: 3 }], [mv('c', at('2026-05-01'), -1, 'sale')], now);
assert.equal(dead.totalPesos, 300);
// Dead is bo-model stockLevel's word: the same idle item at or under its reorder point is Low there, so not listed here.
assert.equal(I.deadStock([{ ...cement, stock: 3, reorderPoint: 3 }], [mv('c', at('2026-05-01'), -1, 'sale')], now).rows.length, 0);

/* ---- Cash tied up: aged newest-in first, windows of money in and out ---- */
// Cement: the 4 left came in on 09-08 (3 days ago). Old: 10 in on 07-01, 2 more than the log explains.
const old = { id: 'o2', name: 'Old', cost: 100, stock: 12 };
const tied = I.cashTiedUp([cement, old], [...log, mv('o2', at('2026-07-01'), 10, 'delivery', { unitCost: 90 }),
  mv('c', at('2026-09-09'), -1, 'damage'), mv('c', at('2026-09-09'), 1, 'return')], now, { windows: [15, 30] });
assert.equal(tied.totalPesos, 1600);
assert.equal(tied.totalPesos, model.stockValueOf([cement, old]));   // "Stock value now" = the Items page's Stock value
assert.deepEqual(tied.ageBuckets.map((b) => b.pesos), [400, 0, 0, 1000, 200]);
assert.equal(tied.rows[0].productId, 'o2');                   // stock older than the log sorts first
assert.deepEqual([tied.rows[0].beforeLogQty, tied.rows[0].oldestDays], [2, null]);
const [t15, t30] = tied.windows;
assert.deepEqual([t15.boughtPesos, t15.soldAtCostPesos, t15.lostPesos, t15.sittingOverPesos], [2000, 1500, 100, 1200]);
assert.equal(t30.boughtPesos, 2000);                          // 07-01 is outside 30 days
assert.equal(t30.sittingOverPesos, 1200);

// happenedOn: a delivery TYPED today for stock that arrived 40 days ago ages from the arrival,
// not the typing -- lands in 31-60, and never counts as "bought" in the 15/30-day windows.
const backdated = { id: 'bd', name: 'Backdated', cost: 50, stock: 6 };
const backdatedLog = [mv('bd', at('2026-09-11', '09:00'), 6, 'delivery', { happenedOn: '2026-08-02' })];
const tiedBackdated = I.cashTiedUp([backdated], backdatedLog, now, { windows: [15, 30] });
assert.deepEqual(tiedBackdated.ageBuckets.map((b) => b.pesos), [0, 0, 300, 0, 0]);
assert.deepEqual(tiedBackdated.windows.map((w) => w.boughtPesos), [0, 0]);

// A return typed today does not make stock fresh: it must not start its own age layer, only
// older stock (or beforeLogQty) may absorb it.
const returned = { id: 'rt', name: 'Returned', cost: 20, stock: 3 };
const returnedLog = [mv('rt', at('2026-06-01'), 3, 'delivery'), mv('rt', at('2026-09-11', '09:00'), 3, 'return')];
const tiedReturned = I.cashTiedUp([returned], returnedLog, now, { windows: [15, 30] });
assert.equal(tiedReturned.rows[0].pesosByAge['0-15'], 0);      // the return did NOT open a fresh layer
assert.equal(tiedReturned.rows[0].pesosByAge['90+'], 60);      // it's still the June delivery's age

// movesByProduct (and everything built on it) orders by happenedOn, not by when the row was
// typed: a stockout closed by a delivery entered today but happenedOn a week ago reads as
// closed a week ago.
const so2 = I.stockoutIntervals([{ id: 'so', stock: 5 }], [
  mv('so', at('2026-09-01'), -5, 'sale'),
  mv('so', at('2026-09-11', '09:00'), 5, 'delivery', { happenedOn: '2026-09-04' }),
], now);
assert.equal(so2.rows[0].intervals[0].end, '2026-09-04T04:00:00.000Z');   // 2026-09-04 store noon (bo-model movedAt, the one reading)

/* ---- Everything together is plain JSON ---- */
const all = I.buildInsights({ products: [cement], movements: log, orders, suppliers: [{ id: 's1' }] }, { now });
assert.deepEqual(JSON.parse(JSON.stringify(all)), all);
assert.equal(all.apiVersion, 1);
// The reorder forecast was removed 2026-09-27; nothing guessed goes to an AI reader.
assert.ok(!['demand', 'reorder', 'reorderBySupplier'].some((k) => k in all.sections || k in all.fieldNotes));
assert.ok(Object.keys(all.sections).every((k) => k in all.fieldNotes), 'every section is documented for an AI reader');

// HWPOS_AI.snapshot() names the movement log stockMovements; a raw dump uses the storage key.
const mvRow = { id: 'mv_x', productId: 'p', qty: 1, reason: 'delivery', ts: '2026-09-01T00:00:00Z' };
assert.equal(I.dataFromDump({ stockMovements: [mvRow] }).movements.length, 1);
assert.equal(I.dataFromDump({ 'hwpos.stockMovements.v1': JSON.stringify([mvRow]) }).movements.length, 1);

/* ---- Per product (owner 2026-10-03): a family of variants is ONE item, as the Items tiles count ---- */
// Hard Hat Yellow and White, one family; Cement on its own. Both hats idle since May: one dead item.
const hats = [{ id: 'hy', name: 'Hard Hat Yellow', groupId: 'hh', cost: 10, stock: 2 }, { id: 'hw', name: 'Hard Hat White', groupId: 'hh', cost: 12, stock: 1 }]
  .map(normalizeProduct);
const shelf = [...hats, { ...cement, stock: 3 }], groups = [{ id: 'hh', name: 'Hard Hat' }];
const idle = [mv('hy', at('2026-05-01'), -1, 'sale'), mv('hw', at('2026-05-02'), -1, 'sale'), mv('c', at('2026-05-01'), -1, 'sale')];
const deadFams = I.deadItems(I.deadStock(shelf, idle, now).rows, shelf, groups, ['qty', 'stockPesos']);
assert.deepEqual(deadFams.map((f) => [f.productId, f.name, f.family, f.members.length, f.qty, f.stockPesos]).sort(),
  [['c', 'Cement', false, 1, 3, 300], ['hh', 'Hard Hat', true, 2, 3, 32]]);
assert.equal(deadFams.length, model.stockCounts(shelf, model.saleClock(idle, 'Asia/Manila'), Date.parse(now)).dead);   // = the Items Dead tile
// White sold last week: the family is not dead (familyLevel), though Yellow still is on its own.
const busy = [...idle, mv('hw', at('2026-09-04'), -1, 'sale')];
assert.equal(I.deadStock(shelf, busy, now).rows.length, 2);
assert.deepEqual(I.deadItems(I.deadStock(shelf, busy, now).rows, shelf, groups).map((f) => f.productId), ['c']);
assert.equal(model.stockCounts(shelf, model.saleClock(busy, 'Asia/Manila'), Date.parse(now)).dead, 1);
// Stock value by item: one row per family, its variants summed and kept for the item page.
const byItem = I.perProduct(I.cashTiedUp(shelf, idle, now).rows, shelf, groups, ['stockPesos']);
assert.deepEqual(byItem.map((f) => [f.productId, f.stockPesos, f.variants.length]).sort(), [['c', 300, 1], ['hh', 32, 2]]);
// Stockouts' Now is familyLevel over perProduct's members: one hat at its reorder point, none out, reads Low, as stockCounts.
const lowShelf = [{ ...hats[0], reorderPoint: 2 }, hats[1]];
const lowFam = I.perProduct([{ productId: 'hy' }], lowShelf, groups)[0];
assert.deepEqual([model.familyLevel(lowFam.members, null), model.stockCounts(lowShelf, null).low], ['low', 1]);

console.log('insights: ok');
