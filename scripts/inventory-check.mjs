// Smallest check that fails if the Inventory maths breaks.
// Run: node scripts/inventory-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// bo-inventory.js calls stepFor/isLow/makeMovement as globals, the way the browser
// hands them over from bo-model.js. Same wiring here, no shims.
const model = require('../bo-model.js');
Object.assign(globalThis, model);
const inv = require('../bo-inventory.js');

const { countDelta, suggestQty, runningBalances, urgency, ceilStep, documentMovements, stockMovement,
  lastPaid, heldPrice, costDrift, reorderGroups } = inv;
const { normalizeProduct, makeMovement, applyMovement, isLow, poLine, PO_DEFAULTS } = model;

/* ---- "Set to count" records the count, not the answer ---- */
assert.equal(countDelta(40, 37), -3);          // the example from the spec
assert.equal(countDelta(40, 44), 4);
assert.equal(countDelta(0, 0), 0);             // counted nothing, had nothing: no movement
assert.equal(countDelta(2.5, 1.25), -1.25);    // measure products count in decimals
assert.equal(countDelta(0.3, 0.1), -0.2);      // and floats don't leak through

/* ---- Running balance: read down the column, every row explains the next ---- */
const p = normalizeProduct({ id: 'p1', name: 'Cement', cost: 100, price: 125, stock: 0, reorderPoint: 5 });
const log = [];
[10, -3, -5].forEach((q) => {
  const m = makeMovement({ productId: 'p1', qty: q, reason: 'adjustment' });
  log.push(m);
  applyMovement(p, m);
});
// A second product's movements must not land in the first one's ladder.
const wire = normalizeProduct({ id: 'w', name: 'Wire', soldBy: 'measure', stock: 0, reorderPoint: 4.2 });
[2.5, 1.4].forEach((q) => {
  const m = makeMovement({ productId: 'w', qty: q, reason: 'delivery' });
  log.push(m);
  applyMovement(wire, m);
});
const stock = new Map([['p1', p.stock], ['w', wire.stock]]);
const { byProduct, balance } = runningBalances(log, (id) => stock.get(id));

assert.equal(p.stock, 2);
assert.deepEqual(byProduct.get('p1').map((m) => balance.get(m.id)), [10, 7, 2]);
assert.equal(byProduct.get('w').length, 2);
assert.deepEqual(byProduct.get('w').map((m) => balance.get(m.id)), [2.5, 3.9]);  // no float dust

/* ---- isLow drives the reorder list; nothing stores "is low" ---- */
assert.ok(isLow(p));                              // 2 <= 5
assert.ok(isLow(wire));                           // 3.9 <= 4.2
const stocked = normalizeProduct({ id: 'p2', name: 'Nail', stock: 90, reorderPoint: 10 });
assert.ok(!isLow(stocked));
assert.deepEqual([p, wire, stocked].filter(isLow).map((x) => x.id), ['p1', 'w']);
// Out of stock sorts above merely low, which sorts above everything else.
const outOf = normalizeProduct({ id: 'p3', name: 'Paint', stock: 0, reorderPoint: 3 });
assert.deepEqual([stocked, p, outOf].sort((a, b) => urgency(a) - urgency(b)).map((x) => x.id),
  ['p3', 'p1', 'p2']);

/* ---- Suggested qty rounds up to the product's step: each vs measure ---- */
assert.equal(suggestQty(p), 8);                   // 5*2 - 2, a whole number of bags
assert.equal(suggestQty(normalizeProduct({ id: 'a', stock: 3, reorderPoint: 10 })), 17);
assert.equal(suggestQty(wire), 4.5);              // 4.2*2 - 3.9 = 4.5, kept at 2dp
assert.equal(suggestQty(normalizeProduct({ id: 'b', soldBy: 'measure', stock: 2.5, reorderPoint: 4.2 })), 5.9);
// An each-product can never be told to order 0.5 of anything.
assert.equal(suggestQty(normalizeProduct({ id: 'c', stock: 0.5, reorderPoint: 1 })), 2);
// Nothing wanted still suggests one step, never zero — the row is on the list to be bought.
assert.equal(suggestQty(normalizeProduct({ id: 'd', stock: 0, reorderPoint: 0 })), 1);
assert.equal(suggestQty(normalizeProduct({ id: 'e', soldBy: 'measure', stock: 0, reorderPoint: 0 })), 0.01);
assert.equal(ceilStep(5.8999999999999995, 0.01), 5.9);

/* ---- The adjustment document: one reason, one person, many lines ---- */
const a1 = normalizeProduct({ id: 'a1', name: 'Bolt', cost: 12, stock: 142, reorderPoint: 20 });
const a2 = normalizeProduct({ id: 'a2', name: 'Nut', cost: 3, stock: 50, reorderPoint: 10 });
const a3 = normalizeProduct({ id: 'a3', name: 'Washer', cost: 1, stock: 8, reorderPoint: 2 });
const shelf = new Map([a1, a2, a3].map((x) => [x.id, x]));
const doc = {
  id: 'adj_1', reason: 'count', staff: 'Maricel R.', note: 'Sept count', date: '2026-08-15',
  lines: [
    { productId: 'a1', counted: 139 },   // -3
    { productId: 'a2', counted: 50 },    // counted and correct: NOT a stock movement
    { productId: 'a3', counted: 12 },    // +4
    { productId: '', counted: 5 },       // no product picked yet
    { productId: 'a1', counted: '' },    // not counted yet
  ],
};
const mvs = documentMovements(doc, (id) => shelf.get(id));
assert.equal(mvs.length, 2);
assert.deepEqual(mvs.map((m) => m.productId), ['a1', 'a3']);
assert.deepEqual(mvs.map((m) => m.qty), [-3, 4]);
// One document, one refId — that is what lets the history group them back.
assert.ok(mvs.every((m) => m.refId === 'adj_1' && m.reason === 'count'
  && m.staff === 'Maricel R.' && m.note === 'Sept count'));
// Cost at the time of the movement rides along, or every past margin silently rewrites.
assert.deepEqual(mvs.map((m) => m.unitCost), [12, 1]);
// The variance survives the qty: what the system believed, and what the shelf held.
assert.deepEqual(mvs.map((m) => [m.expected, m.counted]), [[142, 139], [8, 12]]);
// The draft's own Date carries through as happenedOn — stock counted today can still
// say it was really there since the day the count says.
assert.deepEqual(mvs.map((m) => m.happenedOn), ['2026-08-15', '2026-08-15']);

const net = mvs.reduce((n, m) => n + m.qty, 0);
assert.equal(net, 1);
const shelfBefore = a1.stock + a3.stock;
mvs.forEach((m) => applyMovement(shelf.get(m.productId), m));
assert.equal(a1.stock + a3.stock - shelfBefore, net);   // net delta IS what the shelf moved
assert.equal(a2.stock, 50);                             // untouched by a zero-delta line

// Inline quick-edit and document rows are the same shape, built by the same function.
const inline = stockMovement({ product: a1, delta: -3, reason: 'count', note: 'Sept count',
  staff: 'Maricel R.', refId: 'adj_1', expected: 142, counted: 139, happenedOn: '2026-08-15' });
// (mvs[0] was applied above, which stamps balanceAfter; the built shape is otherwise identical.)
assert.deepEqual(Object.keys(inline).sort(), Object.keys(mvs[0]).filter((k) => k !== 'balanceAfter').sort());
assert.equal(mvs[0].balanceAfter, a1.stock);            // applied rows carry the shelf they left
assert.equal(inline.unitCost, 12);                      // blank cost falls back to the product's
// Nothing was counted on a delivery, so it carries no count fields.
assert.ok(!('expected' in stockMovement({ product: a1, delta: 2, reason: 'delivery', expected: null, counted: null })));

/* ---- Cost drift: the delivery log knows the real price, product.cost does not ---- */
// The whole point: receivePo stamps what was actually paid, nothing writes it back, and
// the margin quietly changes. If this stops catching it, Sales overstates gross profit.
const cement = normalizeProduct({ id: 'c', name: 'Cement', cost: 250, price: 300, marginMode: 'percent', stock: 40 });
const nail = normalizeProduct({ id: 'n', name: 'Nails', cost: 20, price: 25, marginMode: 'flat', stock: 10 });
const steady = normalizeProduct({ id: 's', name: 'Steady', cost: 100, price: 130, stock: 5 });
const fresh = normalizeProduct({ id: 'f', name: 'Never delivered', cost: 10, price: 15, stock: 1 });

const mv = (productId, ts, reason, unitCost) =>
  ({ ...makeMovement({ productId, qty: 1, reason, unitCost }), ts });

const deliveries = [
  mv('c', '2026-01-01T00:00:00.000Z', 'delivery', 250),   // older, must lose
  mv('c', '2026-06-01T00:00:00.000Z', 'delivery', 300),   // last paid
  mv('n', '2026-06-02T00:00:00.000Z', 'delivery', 26),   // +30%, so the sort has something to say
  mv('s', '2026-06-02T00:00:00.000Z', 'delivery', 100),   // unchanged: not a drift row
  // A sale carries a cost too, but it is the cost we charged ourselves, not a price
  // anybody quoted us. Only a delivery may set "last paid".
  mv('c', '2026-09-01T00:00:00.000Z', 'sale', 999),
];

const paid = lastPaid(deliveries);
assert.equal(paid.get('c').cost, 300, 'newest delivery wins');
assert.equal(paid.get('s').cost, 100);
assert.ok(!paid.has('f'), 'a product with no delivery has no last paid');

const drift = costDrift([cement, nail, steady, fresh], deliveries);
assert.deepEqual(drift.map((r) => r.p.id), ['n', 'c'], 'steady and never-delivered are not rows; biggest % first');

const c = drift.find((r) => r.p.id === 'c');
assert.equal(c.book, 250);
assert.equal(c.paid, 300);
assert.equal(c.gapPct, 20);
// 20% markup held against the new cost: 300 * 1.2. NOT 300, and not the old 300 price.
assert.equal(c.suggested, 360);
assert.equal(c.bookMarkup, 20, 'what the reports still claim');
assert.equal(c.nowMarkup, 0, 'what the shelf price actually earns now');

// Flat mode holds pesos, not percent: 5 over cost stays 5 over cost.
assert.equal(drift.find((r) => r.p.id === 'n').suggested, 31);

// No margin to hold means no suggestion to make, rather than a price of cost.
assert.equal(heldPrice(normalizeProduct({ id: 'z', cost: 0, price: 50 }), 60), null);
assert.equal(heldPrice(normalizeProduct({ id: 'z', cost: 10, price: 0 }), 60), null);

// Under 1% is noise and stays off the list; a product with no cost on file is the
// opposite -- every sale of it booked the whole price as profit, so it sorts first.
const noise = normalizeProduct({ id: 'q', name: 'Rounding', cost: 45.05, price: 60, stock: 1 });
const uncosted = normalizeProduct({ id: 'u', name: 'Uncosted', cost: 0, price: 80, stock: 1 });
const edge = costDrift([noise, uncosted, cement], [
  mv('q', '2026-06-03T00:00:00.000Z', 'delivery', 45),
  mv('u', '2026-06-03T00:00:00.000Z', 'delivery', 50),
  mv('c', '2026-06-01T00:00:00.000Z', 'delivery', 300),
]);
assert.deepEqual(edge.map((r) => r.p.id), ['u', 'c'], 'sub-1% drops out, no-cost sorts first');
assert.equal(edge[0].gapPct, null, 'no cost on file is not a 0% change');
assert.equal(edge[0].suggested, null, 'no old margin means no price to suggest');

// Two suppliers at two prices is not drift: compare against the preferred supplier's last price.
const pipe = normalizeProduct({ id: 'pp', name: 'PVC pipe', cost: 100, price: 130, supplierId: 'sA', stock: 10 });
const altPos = [{ id: 'poA', supplierId: 'sA' }, { id: 'poB', supplierId: 'sB' }];
const alternating = [
  { ...mv('pp', '2026-06-01T00:00:00.000Z', 'delivery', 100), refId: 'poA' },
  { ...mv('pp', '2026-07-01T00:00:00.000Z', 'delivery', 80), refId: 'poB' },   // backup, newer, cheaper
];
assert.equal(lastPaid(alternating, altPos).get('pp|sA').cost, 100);
assert.equal(lastPaid(alternating, altPos).get('pp').cost, 80, 'the plain key is still the newest from anyone');
assert.deepEqual(costDrift([pipe], alternating, altPos), [], 'the preferred supplier still charges what is on file');
assert.equal(costDrift([{ ...pipe, supplierId: 'sC' }], alternating, altPos)[0].paid, 80,
  'preferred supplier never delivered: the last delivery decides');

/* ---- Low stock by supplier, for "Add low stock items" on a PO ---- */
const low1 = normalizeProduct({ id: 'low1', name: 'Cement', cost: 50, stock: 2, reorderPoint: 5, supplierId: 's1' });
const out1 = normalizeProduct({ id: 'out1', name: 'Hinge', cost: 30, stock: 0, reorderPoint: 10, supplierId: 's1' });
const fine = normalizeProduct({ id: 'fine', name: 'Paint', cost: 200, stock: 20, reorderPoint: 5, supplierId: 's1' });
const low2 = normalizeProduct({ id: 'low2', name: 'Wire', cost: 10, stock: 1, reorderPoint: 3, supplierId: 's2' });
const needs = reorderGroups([low1, out1, fine, low2]);
assert.deepEqual([...needs.keys()], ['s1', 's2']);
assert.deepEqual(needs.get('s1').map((x) => x.id), ['out1', 'low1'], 'most urgent first, only at or below the danger level');

assert.equal(suggestQty(low1), 8, 'tops the shelf up to twice the reorder point');

console.log('inventory: ok');
