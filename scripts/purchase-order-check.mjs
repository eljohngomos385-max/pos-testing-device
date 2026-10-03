// Smallest check that fails if the buying list or per-line receiving breaks.
// One list for the whole run, each line with its own supplier (owner, 2026-10-02).
// Run: node scripts/purchase-order-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The browser hands bo-model.js over as globals; same wiring as inventory-check.mjs.
const M = require('../bo-model.js');
Object.assign(globalThis, M);
require('../sales-math.js');
const inv = require('../bo-inventory.js');
const I = require('../bo-insights.js');
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, querySelector: () => null };
const { planImport } = require('../bo-products.js');

const { PO_DEFAULTS, poLine, poStatus, poOpenValue, onOrderQty, receivePo, lineSupplier,
  normalizeProduct, applyMovement } = M;
const { buyingList, lastPaid } = inv;

const prod = (id, stock, reorderPoint, sup = '', alt = []) =>
  normalizeProduct({ id, name: id, cost: 100, price: 130, stock, reorderPoint, supplierId: sup, altSupplierIds: alt });
const po = (items, extra = {}) => ({ ...PO_DEFAULTS, id: extra.id || 'po', number: 'PO-T-0001', items, ...extra });

/* ---- 4.2 The list fills itself: low items, minus what is already on order (bugs 3, 4) ---- */
const cement = prod('cement', 2, 10, 'holcim');          // short 8 + headroom
const paint = prod('paint', 1, 4, 'boysen', ['holcim']); // holcim is a backup supplier
const loose = prod('loose', 0, 3);                       // no supplier at all: still suggested
const fine = prod('fine', 50, 5, 'holcim');
const products = [cement, paint, loose, fine];
const want = new Map(buyingList(products).map((x) => [x.p.id, x]));
assert.deepEqual([...want.keys()].sort(), ['cement', 'loose', 'paint']);
assert.equal(want.get('paint').supplierId, 'boysen', 'each line goes to the main supplier');
assert.equal(want.get('loose').supplierId, '', 'no supplier is a market run, not dropped');

// What is on a SENT list is not ordered again; a draft is not on order (owner 2026-10-02) and a cancelled one gives it back.
const need = want.get('cement').qty;
const draft = po([poLine('cement', 5, 100, 'holcim')]);
const gone = po([poLine('cement', 99, 100, 'holcim')], { cancelledAt: '2026-10-01T00:00:00Z' });
assert.equal(buyingList(products, [draft, gone]).find((x) => x.p.id === 'cement').qty, need);
assert.equal(buyingList(products, [po([poLine('cement', need, 100, 'holcim')], { sentAt: '2026-10-01T00:00:00Z' })]).some((x) => x.p.id === 'cement'), false,
  'fully on order: not on the list');
// From a supplier's page: everything they sell, main or backup, booked to them.
const holcim = buyingList(products, [], 'holcim');
assert.deepEqual(holcim.map((x) => x.p.id).sort(), ['cement', 'paint']);
assert.ok(holcim.every((x) => x.supplierId === 'holcim'));

/* ---- Status is derived from the lines, never set by hand ---- */
const lines = () => [poLine('cement', 10, 100, 'holcim'), poLine('paint', 4, 250, 'boysen')];
const p1 = po(lines());
assert.equal(poStatus(p1), 'draft');
assert.equal(poOpenValue(p1), 0, 'a draft owes nothing (bug 9)');
p1.sentAt = '2026-09-20T09:00:00+08:00';
assert.equal(poStatus(p1), 'ordered');
assert.equal(poOpenValue(p1), 2000);
assert.equal(poStatus({ ...PO_DEFAULTS, status: 'ordered', items: [] }), 'ordered', 'a record from before keeps its status');

/* ---- An all-zero receive changes nothing (bug 12) ---- */
p1.status = poStatus(p1);
assert.deepEqual(receivePo(p1, {}), []);
assert.deepEqual(receivePo(p1, { [p1.items[0].id]: 0 }), []);
assert.equal(p1.status, 'ordered');

/* ---- 4.3 Receive one line: stock up by movements, incoming down ---- */
const shelf = new Map([['cement', prod('cement', 2, 10)], ['paint', prod('paint', 1, 4)]]);
const take = (o, map, day) => receivePo(o, map, day).map((m) => (applyMovement(shelf.get(m.productId), m), m));
const log = take(p1, { [p1.items[0].id]: 10 }, '2026-09-24');   // Holcim came; Boysen not yet
assert.equal(log.length, 1);
assert.deepEqual([log[0].reason, log[0].refId, log[0].qty, log[0].unitCost], ['delivery', 'po', 10, 100]);
assert.equal(shelf.get('cement').stock, 12);
assert.equal(p1.status, 'partial');
assert.equal(p1.items[0].receivedOn, '2026-09-24');
assert.equal(onOrderQty([p1]).get('cement'), undefined, 'received line is off the incoming list');
assert.equal(onOrderQty([p1]).get('paint'), 4);
assert.equal(poOpenValue(p1), 1000);
log.push(...take(p1, { [p1.items[1].id]: 4 }, '2026-09-27'));
assert.equal(p1.status, 'received');
assert.equal(poOpenValue(p1), 0);
assert.equal(shelf.get('paint').stock, 5);
// Stock is the sum of its movements.
assert.equal(log.filter((m) => m.productId === 'cement').reduce((s, m) => s + m.qty, 2), shelf.get('cement').stock);

/* ---- Each line counts for its own supplier (bugs 1, 10) ---- */
// Cancelled after half of Boysen's line came: the short ship still counts against Boysen.
const p2 = po([poLine('paint', 10, 250, 'boysen')], { id: 'po2', sentAt: '2026-09-20T09:00:00+08:00' });
receivePo(p2, { [p2.items[0].id]: 5 }, '2026-09-22');
p2.cancelledAt = '2026-09-25T09:00:00Z';
assert.equal(poStatus(p2), 'cancelled');
assert.equal(poOpenValue(p2), 0, 'a cancelled list owes nothing (bug 9)');
const lead = new Map(I.supplierLeadTimes([p1, p2], [{ id: 'holcim' }, { id: 'boysen' }]).map((r) => [r.supplierId, r]));
assert.equal(lead.get('holcim').leadDaysMean, 4, 'Holcim measured off its own line, not the last one in');
assert.equal(lead.get('holcim').fillRate, 1);
assert.equal(lead.get('boysen').fillRate, 0.643);   // (4 + 5) / (4 + 10): the cancelled half counts
// A record from before keeps po.supplierId; its lines read it.
const legacy = { ...PO_DEFAULTS, supplierId: 'old', items: [{ id: 'l', productId: 'x', qty: 1, cost: 1 }] };
assert.equal(lineSupplier(legacy, legacy.items[0]), 'old');
assert.equal(lineSupplier(legacy, { supplierId: '' }), '', 'a line set to none stays none');

// What was paid, per line supplier: Cost changes compares like with like.
const paid = lastPaid(log, [p1]);
assert.equal(paid.get('paint|boysen').cost, 250);
assert.equal(paid.has('paint|holcim'), false);

/* ---- Adjust no longer receives (bug 5): a delivery comes only off a purchase order ---- */
const adj = /ADJ_EVENTS = \[([\s\S]*?)\];/.exec(readFileSync(new URL('../bo-inventory.js', import.meta.url), 'utf8'))[1];
assert.ok(!/'delivery:/.test(adj), 'Adjust offers no "Received new stock"');

/* ---- CSV import: a supplier name becomes that supplier's id (bug 6) ---- */
const plan = planImport([
  ['name', 'cost', 'price', 'supplier_id', 'alt_supplier_ids'],
  ['Nails', '1', '2', 'Holcim', 'sup_b|New Co'],
], [], [], [{ id: 'sup_h', name: 'holcim' }, { id: 'sup_b', name: 'Boysen' }]);
const nails = plan.create[0].product;
assert.equal(nails.supplierId, 'sup_h', 'matched by name, any case');
assert.equal(nails.altSupplierIds[0], 'sup_b', 'an id stays an id');
assert.deepEqual(plan.suppliers.map((s) => s.name), ['New Co']);
assert.equal(nails.altSupplierIds[1], plan.suppliers[0].id);

/* ---- The line and the shelf round the same way (review 2026-10-02: till-year got 127, line said 126.5) ---- */
const roundTrip = (p, lineQty, ...takes) => {
  const o = po([poLine(p.id, lineQty, 10, 's')], { sentAt: '2026-09-20T01:00:00Z' });
  const mv = takes.flatMap((n) => receivePo(o, { [o.items[0].id]: n }, '', () => p).map((m) => (applyMovement(p, m), m)));
  return { o, l: o.items[0], mv };
};
let r = roundTrip(prod('bolt', 10, 5), 10, 0.4);           // 0.4 of a piece is no piece
assert.deepEqual([r.mv.length, r.l.receivedQty, poStatus(r.o)], [0, 0, 'ordered']);
const sand = normalizeProduct({ id: 'sand', name: 'sand', cost: 1, price: 2, stock: 0, soldBy: 'measure' });
r = roundTrip(sand, 0.8, 0.7, 0.1);                         // 0.7 + 0.1 m is 0.8, not 0.7999999
assert.deepEqual([r.l.receivedQty, M.lineOut(r.l), poStatus(r.o)], [0.8, 0, 'received']);
const sand2 = normalizeProduct({ id: 'sand2', name: 'sand2', cost: 1, price: 2, stock: 0, soldBy: 'measure' });
r = roundTrip(sand2, 5, 2.555);
assert.equal(r.l.receivedQty, sand2.stock, 'the line says what the shelf got');
const tape = prod('tape', 10, 5);
r = roundTrip(tape, 253, 126.5);
assert.equal(r.l.receivedQty, tape.stock - 10);

/* ---- One item from two suppliers on one list: each delivery is its own line's (review 6) ---- */
const split = po([poLine('cem', 5, 230, 'holcim'), poLine('cem', 5, 245, 'republic')], { sentAt: '2026-09-20' });
const rep = receivePo(split, { [split.items[1].id]: { qty: 5, unitCost: 250 } }, '2026-09-22');
assert.deepEqual([rep[0].supplierId, rep[0].lineId, rep[0].unitCost], ['republic', split.items[1].id, 250]);
assert.equal(M.deliverySupplier(split, rep[0]), 'republic');
assert.equal(split.items[1].invoiceCost, 250, 'the bill goes on the line it was billed for');
assert.equal(lastPaid(rep, [split]).has('cem|holcim'), false);
// An over-ship is not a better fill (review 7).
const over = po([poLine('bolt', 10, 5, 's')], { sentAt: '2026-09-20T01:00:00Z' });
receivePo(over, { [over.items[0].id]: 15 }, '2026-09-22');
assert.equal(I.supplierLeadTimes([over], [{ id: 's' }]).find((x) => x.supplierId === 's').fillRate, 1);

/* ---- A second window's stale save keeps the first one's receipt and new PO (review 1) ---- */
const disk = new Map();
globalThis.readJsonStorage = (k, d) => (disk.has(k) ? JSON.parse(disk.get(k)) : d);
globalThis.storageSet = (k, v) => disk.set(k, v);
const a = po([poLine('cement', 10, 100, 'holcim')], { id: 'shared', sentAt: '2026-09-20', updatedAt: '2026-09-20T00:00:00Z' });
M.savePurchaseOrders([a]);
const winB = M.loadPurchaseOrders();                         // window B loads, then sits
const winA = M.loadPurchaseOrders();
receivePo(winA[0], { [winA[0].items[0].id]: 10 });            // window A receives everything
winA.push(po([], { id: 'fresh', updatedAt: new Date().toISOString() }));
M.savePurchaseOrders(winA);
M.savePurchaseOrders(winB);                                  // B saves its old list
const after = M.loadPurchaseOrders();
assert.equal(after.find((o) => o.id === 'shared').items[0].receivedQty, 10, 'the receipt survives');
assert.ok(after.some((o) => o.id === 'fresh'), 'and so does the new PO');

console.log('purchase-order: ok');
