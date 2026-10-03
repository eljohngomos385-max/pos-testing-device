import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { POS_SCRIPTS } from './lib/till.mjs';

const storage = new Map();
const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Set,
  Map,
  parseInt,
  parseFloat,
  window: {},
  navigator: { onLine: true },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)); },
  },
  document: {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    documentElement: { style: { setProperty() {} } },
  },
  setTimeout() { return 0; },
  clearTimeout() {},
  requestAnimationFrame(fn) { return fn(); },
};

sandbox.window = { ...sandbox.window, navigator: sandbox.navigator };
const context = createContext(sandbox);
// Same order as index.html: sales-math.js first (SalesMath), then bo-model's globals (roundQty, makeEvent, appendEvents).
new Script(readFileSync(new URL('../sales-math.js', import.meta.url), 'utf8'), { filename: 'sales-math.js' }).runInContext(context);
context.SalesMath = context.window.SalesMath;   // in a browser window IS the global
new Script(readFileSync(new URL('../bo-model.js', import.meta.url), 'utf8'), { filename: 'bo-model.js' }).runInContext(context);
for (const f of POS_SCRIPTS) new Script(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), { filename: f }).runInContext(context);

const format = context.window.HWPOS_ORDER_FORMAT;
assert.equal(typeof format?.normalizeOrder, 'function', 'order format API is exposed');
assert.equal(typeof format?.toReceiptViewModel, 'function', 'receipt view model mapper is exposed');

const cash = format.normalizeOrder({
  id: 'ord-cash',
  number: '1-101',
  ts: 1710000000000,
  paymentMethod: 'cash',
  items: [{ id: 'p1', sku: 'N-1', name: 'Wire nail', unit: 'kg', qty: 2, price: 25 }],
  tendered: 100,
  change: 50,
});
assert.equal(cash.schemaVersion, 2);
assert.equal(cash.formatKey, 'hwpos.order.v1');
assert.equal(cash.total, 50);
assert.equal(cash.items[0].lineTotal, 50);
assert.equal(cash.payments[0].method, 'cash');
assert.equal(cash.payments[0].tendered, 100);

const credit = format.normalizeOrder({
  id: 'ord-credit',
  number: '1-102',
  paymentMethod: 'credit',
  customer: { id: 'cust1', name: 'Mang Ricardo' },
  items: [{ id: 'p2', name: 'PVC elbow', qty: 1, price: 185 }],
  total: 185,
});
assert.equal(credit.payments[0].method, 'credit');
assert.equal(credit.payments[0].amount, 185);
assert.equal(credit.customer.name, 'Mang Ricardo');

const split = format.normalizeOrder({
  id: 'ord-split',
  number: '1-103',
  paymentMethod: 'split',
  customer: { id: 'cust2', name: 'Test Customer' },
  items: [{ id: 'p3', name: 'Breaker', qty: 1, price: 320 }],
  total: 320,
  tendered: 100,
});
assert.deepEqual(JSON.parse(JSON.stringify(split.payments.map(p => [p.method, p.amount]))), [['cash', 100], ['credit', 220]]);

const saved = format.normalizeOrder({
  id: 'ord-saved',
  number: '1-104',
  status: 'saved',
  paymentMethod: 'unpaid',
  items: [{ name: 'Draft item', qty: 1, price: 10 }],
});
assert.equal(saved.status, 'saved');
assert.equal(saved.payments[0].method, 'unpaid');

const receipt = format.toReceiptViewModel({
  id: 'ord-delivery',
  number: '1-105',
  fulfilment: 'delivery',
  deliveryAddress: 'Pila, Laguna',
  items: [{ name: 'Tape', qty: 1, price: 32 }],
  total: 32,
});
assert.equal(receipt.fulfilmentLabel, 'DELIVERY · Pila, Laguna');
assert.equal(receipt.totals.total, 32);

// ---- Sale types (owner 2026-10-03): Walk-in is the counter sale. A v1 row's 'pickup' WAS the counter
// sale, so it reads 'walkin'; a v2 'pickup' (bought ahead, collected later) stays a pickup. ----
assert.equal(cash.fulfilment, 'walkin', 'no fulfilment = walk-in');
assert.equal(format.normalizeOrder({ id: 'o1', number: '1-1', fulfilment: 'pickup', items: [] }).fulfilment, 'walkin');
assert.equal(format.normalizeOrder({ id: 'o2', number: '1-2', schemaVersion: 1, fulfilment: 'pickup', items: [] }).fulfilment, 'walkin');
const pickupV2 = format.normalizeOrder({ id: 'o3', number: '1-3', schemaVersion: 2, fulfilment: 'pickup', items: [] });
assert.equal(pickupV2.fulfilment, 'pickup');
assert.equal(format.normalizeOrder(pickupV2).fulfilment, 'pickup', 're-reading a v2 pickup keeps it');
assert.equal(format.toReceiptViewModel(pickupV2).fulfilmentLabel, 'PICKUP');
assert.equal(format.toReceiptViewModel(cash).fulfilmentLabel, 'WALK-IN');
const up = context.SalesMath.upgradeOrders([{ id: 'a', fulfilment: 'pickup' }, { id: 'b', schemaVersion: 2, fulfilment: 'pickup' }, { id: 'c', fulfilment: 'Tricycle' }]);
assert.equal(up.map(o => o.fulfilment).join(), 'walkin,pickup,Tricycle');
assert.equal(context.SalesMath.upgradeOrders(up)[0], up[0], 'upgraded rows are left alone the second time');

// ---- Money reconciles: a receipt whose lines don't add up is a BIR problem. ----
// `state` is a lexical const inside the till's scripts, so it is reached by running another script in
// the same realm rather than through the context object.
const run = (code) => new Script(code, { filename: 'totals.mjs' }).runInContext(context);

function totalsFor(cart, cartDiscount = null) {
  run(`state.cart = ${JSON.stringify(cart)}; state.cartDiscount = ${JSON.stringify(cartDiscount)};`);
  return run('cartTotals()');
}

// The exact regression: a 5% contractor tier on 1219.30 rounded the discount to 60.97 and
// the total to 1158.34 independently, and 1219.30 - 60.97 = 1158.33.
for (const [label, cart, disc] of [
  ['contractor tier', [{ price: 272.97, qty: 4 }, { price: 63.71, qty: 2 }], { type: 'percent', value: 5 }],
  ['half-centavo percent', [{ price: 33.33, qty: 3 }], { type: 'percent', value: 7.5 }],
  ['flat off', [{ price: 285, qty: 3 }], { type: 'amount', value: 100.005 }],
  ['no discount', [{ price: 43.7, qty: 2.5 }], null],
]) {
  const t = totalsFor(cart, disc);
  assert.equal(t.subtotal - t.discount, t.total, `${label}: subtotal - discount must equal total`);
  assert.equal(t.vatableSales + t.vatAmount, t.total, `${label}: vatable + VAT must equal total`);
  for (const [k, v] of Object.entries(t)) {
    if (typeof v !== 'number' || k === 'vatRate' || k === 'taxRate') continue;
    assert.equal(Math.round(v * 100) / 100, v, `${label}: ${k} is not a whole centavo (${v})`);
  }
}

// Tax on top (US sales tax): the shelf price is before tax, the customer pays net + tax.
run('state.settings.taxOnTop = true; state.settings.vatRate = 0.08;');
{
  const t = totalsFor([{ price: 10, qty: 3 }]);
  assert.equal(t.netSales, 30);
  assert.equal(t.tax, 2.4);
  assert.equal(t.total, 32.4, 'tax on top is added to what the customer pays');
  assert.equal(run('buildOrderRecord().taxIncluded'), false, 'and the order says so');
}
// A store that is not VAT registered charges the shelf price, no tax (the back office's box).
run('state.settings.taxOnTop = false; state.settings.vatInclusive = false; state.settings.vatRate = 0.12;');
{
  const t = totalsFor([{ price: 145, qty: 1 }]);
  assert.deepEqual([t.total, t.tax], [145, 0], 'not VAT registered: no tax added or taken out');
}
run('state.settings.vatInclusive = true;');
assert.equal(run('buildOrderRecord().taxIncluded'), true, 'every new order stamps taxIncluded');

// ---- Legacy rows load as a sale plus its own void/refund row, written back once. ----
storage.set('hwpos.orders.v1', JSON.stringify([
  { id: 'old-v', number: '1-050', ts: 1710000000000, status: 'voided', voidedAt: 1710000100000, total: 50, items: [{ name: 'A', qty: 1, price: 50 }] },
  { id: 'old-r', number: '1-051', ts: 1710000000000, status: 'refunded', refundedAt: 1710090000000, total: 80, items: [{ name: 'B', qty: 1, price: 80 }] },
  { id: 'old-x', number: '1-052', ts: 1710000200000, status: 'return', originalOrderId: 'old-k', total: 20, items: [{ name: 'C', qty: 1, price: 20 }] },
]));
{
  const loaded = run('loadOrders()');
  const byId = Object.fromEntries(loaded.map(o => [o.id, o]));
  assert.equal(byId['old-v'].status, 'completed', 'the voided sale is a sale again');
  assert.equal(byId['old-v:void'].status, 'void');
  assert.equal(byId['old-v:void'].originalOrderId, 'old-v');
  assert.equal(byId['old-v:void'].ts, 1710000100000, 'the void counts on the day it happened');
  assert.equal(byId['old-r:refund'].status, 'refund');
  assert.equal(byId['old-x'].status, 'refund', "a 'return' row is a refund row");
  const stored = storage.get('hwpos.orders.v1');
  assert.ok(JSON.parse(stored).every(o => ['completed', 'void', 'refund'].includes(o.status)), 'the upgrade is written back');
  run('loadOrders()');
  assert.equal(storage.get('hwpos.orders.v1'), stored, 'and a second load writes nothing');
  run('state.orders = loadOrders()');
  assert.equal(run("orderStatusLabel(state.orders.find(o => o.id === 'old-v'))"), 'Voided');
  assert.equal(run("orderStatusLabel(state.orders.find(o => o.id === 'old-r:refund'))"), 'Refund');
}
storage.delete('hwpos.orders.v1');
run('state.orders = []');

// ---- The credit limit is enforced, not just displayed. ----
run("postToAccount({ id: 'c-x', name: 'Marie' }, 'opening', 4800)");   // the balance is the ledger
run("saveCustomer({ id: 'c-x', name: 'Marie', creditOn: true, creditLimit: 5000 }); state.customer = { id: 'c-x', name: 'Marie' };");   // the limit is read from the saved record
run("state.cart = [{ price: 100, qty: 3 }]; state.cartDiscount = null; state.paymentMethod = 'credit';");
assert.equal(run('creditOverLimit(0)'), 100, 'a 300 charge on 4800 of a 5000 limit is 100 over');
run("state.paymentMethod = 'split';");
assert.equal(run('creditOverLimit(50)'), 50, 'a split only charges the untendered 250');
assert.equal(run('creditOverLimit(250)'), 0, 'the same sale, mostly paid in cash, fits');
assert.equal(run('creditOverLimit(300)'), 0, 'nothing on account, nothing over');
run("state.paymentMethod = 'cash';");
assert.equal(run('creditOverLimit(300)'), 0, 'cash never touches the account');
run("saveCustomer({ id: 'c-y', name: 'No limit', creditOn: true, creditLimit: null }); state.customer = { id: 'c-y', name: 'No limit' };");
run("state.paymentMethod = 'credit';");
assert.equal(run('creditOverLimit(0)'), 0, 'no limit set means no limit to exceed');

// ---- Lost sales and delivery trips are rows in append-only logs, never edits to the order. ----
const lost = run(`lostDemandFields({ product: { id: 'p9', name: 'Portland Cement', soldBy: 'unit' }, qty: '2.6', reason: 'out-of-stock', substituteProductId: 'p10' })`);
assert.equal(lost.productId, 'p9');
assert.equal(lost.text, 'Portland Cement', 'a catalog pick records the product name too');
assert.equal(lost.qty, 3, 'a piece product rounds to whole pieces');
assert.equal(lost.substituteProductId, 'p10');
assert.equal(lost.terminal, '1', 'the register number stamps the terminal');
const typed = run(`lostDemandFields({ text: '  gate hinge 4in ', qty: '1.255', reason: 'bogus' })`);
assert.equal(typed.productId, '');
assert.equal(typed.text, 'gate hinge 4in');
assert.equal(typed.reason, 'other', 'an unknown reason is not invented into the log');
assert.equal(run(`lostDemandFields({ text: '   ', qty: 1 })`), null, 'nothing asked for, nothing logged');
assert.equal(run(`lostDemandFields({ text: 'hinge', qty: 0 })`), null, 'zero qty is not a request');
run(`appendEvents('lostDemand', [makeEvent(lostDemandFields({ text: 'hinge', qty: 1 }), 'El John')])`);
run(`appendEvents('lostDemand', [makeEvent(lostDemandFields({ text: 'bolt', qty: 2 }), 'El John')])`);
const lostLog = JSON.parse(storage.get('hwpos.lostDemand.v1'));
assert.deepEqual(lostLog.map(r => r.text), ['hinge', 'bolt'], 'appends, never replaces');
assert.equal(lostLog[0].staff, 'El John');

const trips = run(`latestEvents([
  { orderId: 'o1', event: 'dispatched', ts: '2026-09-14T01:00:00.000Z' },
  { orderId: 'o2', event: 'dispatched', ts: '2026-09-14T01:05:00.000Z' },
  { orderId: 'o1', event: 'arrived',    ts: '2026-09-14T01:40:00.000Z' },
  { orderId: 'o2', event: 'returned',   ts: Date.parse('2026-09-14T02:00:00.000Z') },
])`);
assert.equal(trips.size, 2);
assert.equal(trips.get('o1').event, 'arrived', 'the newest event is the trip state');
assert.equal(trips.get('o2').event, 'returned', 'a new number time beats an old text one');

// An old order with a text date keeps its day; it used to be re-dated to "now" on every save.
assert.equal(run(`normalizeOrderRecord({ id: 'old', number: '1-001', ts: '2026-01-05T10:00:00+08:00', items: [] }).ts`), Date.parse('2026-01-05T10:00:00+08:00'));

// A line whose item is gone and that carried no cost stays unknown (null), not ₱0: the back office
// fills it from the catalogue or leaves it out, instead of reading a 100% margin.
assert.equal(run(`normalizeOrderItem({ productId: 'gone', name: 'X', qty: 1, price: 50 }).cost`), null);
assert.equal(run(`normalizeOrderItem({ productId: 'gone', name: 'X', qty: 1, price: 50, cost: 30 }).cost`), 30);
// New records get v4 UUIDs.
assert.match(run('newId()'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

// ---- Step 2.2: each line keeps its cost at the moment of sale; one row per payment; the line
// shares (cart discount, VAT) are derived by SalesMath.orderLines and add back to the receipt. ----
{
  run(`state.settings.taxOnTop = false; state.settings.vatInclusive = true; state.settings.vatRate = 0.12;
    state.customer = { id: 'c-s', name: 'Split Co', creditLimit: 0, currentBalance: 0 };
    state.products.push({ id: 'pc1', name: 'Hinge', price: 85, cost: 51.5, stock: 9 }, { id: 'pc2', name: 'Bolt', price: 12.4, cost: 7, stock: 90 });
    state.cart = [{ id: 'pc1', name: 'Hinge', price: 85, qty: 3 }, { id: 'pc2', name: 'Bolt', price: 12.4, qty: 7 }];
    state.cartDiscount = { type: 'percent', value: 7.5 };`);
  const o = run(`buildOrderRecord({ paymentMethod: 'split', tendered: 200 })`);
  run(`state.products.find(p => p.id === 'pc1').cost = 99;`);   // the price list moves after the sale
  const stored = JSON.parse(JSON.stringify(run(`normalizeOrderRecord(${JSON.stringify(o)})`)));   // out of the vm realm
  assert.deepEqual(stored.items.map(i => i.cost), [51.5, 7], 'cost is the cost when it was sold');
  assert.deepEqual(stored.payments.map(p => [p.method, p.amount]), [['cash', 200], ['credit', Math.round((o.total - 200) * 100) / 100]], 'a split is one row per payment');
  const lines = context.SalesMath.orderLines(context.SalesMath.readOrder(stored));
  const sum = (k) => lines.reduce((t, l) => t + l[k], 0) / 100;
  assert.equal(sum('net'), stored.total, 'line shares add up to the total');
  assert.equal(sum('discount'), stored.discount, 'and the cart discount is shared out to the lines');
  assert.equal(sum('tax'), stored.vatAmount);
  assert.equal(sum('cost'), 51.5 * 3 + 7 * 7);
  run('state.customer = null; state.cartDiscount = null;');
}
// ---- Step 2.4: an SC/PWD row keeps its VAT-exempt amount (so its refund nets it back out). ----
{
  const sc = run(`normalizeOrderRecord({ id: 'sc', number: '1-200', items: [{ name: 'Drill', qty: 1, price: 112 }],
    subtotal: 112, discount: 32, total: 80, vatAmount: 0, vatExempt: 80, scPwdOff: 20 })`);
  assert.deepEqual([sc.vatExempt, sc.scPwdOff, sc.vatableSales, sc.vatAmount], [80, 20, 0, 0]);
  assert.deepEqual([run(`normalizeOrderRecord({ items: [], total: 112, vatAmount: 12 })`).vatExempt], [0]);
}
console.log('Order format verification passed.');

// ---- Till events: raw facts, never on the order, never able to break a sale. ----
const tillRows = [];
context.window.HWPOS_STORE = { events: {
  setContext(patch) { this.ctx = { ...this.ctx, ...patch }; },
  append(type, data) { tillRows.push({ type, cartId: this.ctx.cartId, data }); },
} };
run(`state.cart = []; state.query = 'cem'; searchIntent = { query: 'cem', results: 3, picked: false };`);
run(`beginCart(); state.cart.push({ id: 'p1', price: 5, qty: 1 }); trackItemAdd({ id: 'p1', price: 5, stock: 0 }, 1, 'tile'); beginCart(); endSearch();`);
assert.deepEqual(tillRows.map(r => r.type), ['cart_start', 'oos_tap', 'item_add', 'search'], 'one cart_start, OOS flagged, search logged once on pick');
assert.ok(tillRows[0].cartId.length === 36 && tillRows.every(r => r.cartId === tillRows[0].cartId), 'every row carries the cart id');
assert.equal(tillRows[3].data.chosenProductId, 'p1');
assert.equal(run('buildOrderRecord().cartId'), undefined, 'cartId never reaches the saved order');
context.window.HWPOS_STORE = { events: { append() { throw new Error('IDB exploded'); } } };
run(`track('sale_complete', {})`);   // must not throw
console.log('till events: ok');
