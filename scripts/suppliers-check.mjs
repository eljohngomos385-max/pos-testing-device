// Smallest check that fails if receiving a purchase order breaks.
// Receiving is the only thing on the Suppliers page that moves stock, and it is
// the one path that must never write a movement by hand.
// Run: node scripts/suppliers-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../bo-model.js');
const { PO_DEFAULTS, PO_INCOMING, poLine, poTotal, poOutstanding, receivePo, cent, unc } = M;

// The money still to arrive — what the Suppliers tables print next to a PO.
const poOutValue = (po) => unc((po.items || []).reduce(
  (s, l) => s + cent(l.cost) * Math.max(0, (Number(l.qty) || 0) - (Number(l.receivedQty) || 0)), 0));

const makePo = () => ({
  ...PO_DEFAULTS, id: 'po_test', number: 'PO-0001', supplierId: 'sup_1', status: 'ordered',
  items: [poLine('p001', 10, 7.5), poLine('p004', 4, 105)],
});

// ---- a two-line PO, partly received ----
const po = makePo();
assert.equal(poTotal(po), 495);                 // 10 x 7.50 + 4 x 105
assert.equal(poOutstanding(po), 14);
assert.equal(poOutValue(po), 495);
assert.ok(PO_INCOMING.includes(po.status));

const first = receivePo(po, { [po.items[0].id]: 4 });
assert.equal(po.status, 'partial', 'still outstanding => partial');
assert.equal(first.length, 1, 'one movement per line actually received');
assert.equal(first[0].productId, 'p001');
assert.equal(first[0].qty, 4);
assert.equal(first[0].reason, 'delivery');      // what the movement log answers "why" with
assert.equal(first[0].unitCost, 7.5);           // the PO's cost, not the product's
assert.equal(first[0].refId, po.id);
assert.equal(po.items[0].receivedQty, 4);
assert.equal(poOutstanding(po), 10);            // 6 + 4
assert.equal(poOutValue(po), 465);              // 6 x 7.50 + 4 x 105

// ---- receive the rest ----
const rest = receivePo(po, { [po.items[0].id]: 6, [po.items[1].id]: 4 });
assert.equal(rest.length, 2);
assert.equal(po.status, 'received');
assert.ok(po.receivedAt, 'a completed PO is stamped');
assert.equal(poOutstanding(po), 0);
assert.equal(poOutValue(po), 0);

// Every unit ordered is accounted for by exactly the movements written.
const moved = first.concat(rest).reduce((m, mv) => m.set(mv.productId, (m.get(mv.productId) || 0) + mv.qty), new Map());
po.items.forEach((l) => assert.equal(moved.get(l.productId), l.qty, `movements sum to ordered qty for ${l.productId}`));

// ---- a zero line writes nothing ----
const zero = makePo();
assert.equal(receivePo(zero, { [zero.items[0].id]: 0 }).length, 0);
assert.equal(zero.items[0].receivedQty, 0);

// ---- receiving carries an "Arrived on" date to every delivery movement, and stamps
//      receivedAt at local noon of that day, so a late-entered delivery doesn't claim
//      it arrived at whatever moment someone typed it in ----
const backdated = makePo();
const arrived = receivePo(backdated, { [backdated.items[0].id]: 10, [backdated.items[1].id]: 4 }, '2026-08-01');
assert.ok(arrived.every((m) => m.happenedOn === '2026-08-01'));
assert.equal(backdated.receivedAt.slice(0, 10), '2026-08-01');

// ---- suppliers over-ship; outstanding floors at zero and never goes negative ----
const over = makePo();
receivePo(over, { [over.items[0].id]: 12, [over.items[1].id]: 4 });
assert.equal(over.items[0].receivedQty, 12, 'the over-shipment is recorded as it happened');
assert.equal(over.status, 'received');
assert.equal(poOutstanding(over), 0);
assert.equal(poOutValue(over), 0);

// ---- Tier 1 captures (bo-suppliers.js SUP_RULES): due date, overdue, short ships, real lead ----
Object.assign(globalThis, M);                    // the page reads bo-model globals at call time
const S = require('../bo-suppliers.js');
const today = '2026-09-14';
const late = { ...PO_DEFAULTS, status: 'ordered', expectedAt: '2026-09-10' };
assert.ok(S.isOverdue(late, today));
late.promisedAt = '2026-09-20';
assert.equal(S.dueDate(late), '2026-09-20', "the supplier's promise beats our own guess");
assert.ok(!S.isOverdue(late, today));
assert.ok(S.isOverdue({ ...late, promisedAt: '2026-09-12', expectedAt: '2026-09-30' }, today), 'a broken promise is overdue');
assert.ok(!S.isOverdue({ ...late, promisedAt: '2026-09-01', status: 'received' }, today), 'received is never overdue');
assert.ok(!S.isOverdue({ ...PO_DEFAULTS, status: 'ordered' }, today), 'no date, not overdue');

const half = { ...poLine('p001', 10, 7.5), receivedQty: 4 };   // 6 still to come
assert.ok(S.isShort(half, 5));
assert.ok(S.isShort(half, ''), 'nothing typed is nothing received');
assert.ok(!S.isShort(half, 6));
assert.ok(!S.isShort(half, 9), 'an over-ship is not short');

assert.deepEqual(S.realLead([
  { supplierId: 'a', status: 'received', orderedAt: '2026-09-01', receivedAt: '2026-09-05T10:00:00' },   // 4 days
  { supplierId: 'a', status: 'received', orderedAt: '2026-08-01', sentAt: '2026-09-02T09:00:00',
    receivedAt: '2026-09-09T18:00:00' },                                                                  // sent wins: 7
  { supplierId: 'a', status: 'partial', orderedAt: '2026-09-01' },                                        // not arrived
  { supplierId: 'b', status: 'received', orderedAt: '2026-09-01', receivedAt: '2026-09-30T08:00:00' },   // other supplier
], 'a'), { n: 2, avgDays: 5.5 });
assert.deepEqual(S.realLead([], 'a'), { n: 0, avgDays: 0 });

console.log('suppliers: ok');
