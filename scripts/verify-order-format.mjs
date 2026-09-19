import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

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
// Same order as index.html: app.js uses bo-model's globals (roundQty, makeEvent, appendEvents).
new Script(readFileSync(new URL('../bo-model.js', import.meta.url), 'utf8'), { filename: 'bo-model.js' }).runInContext(context);
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
new Script(source, { filename: 'app.js' }).runInContext(context);

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
assert.equal(cash.schemaVersion, 1);
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

// ---- Money reconciles: a receipt whose lines don't add up is a BIR problem. ----
// `state` is a lexical const inside app.js, so it is reached by running another script in
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
    if (k === 'vatRate') continue;
    assert.equal(Math.round(v * 100) / 100, v, `${label}: ${k} is not a whole centavo (${v})`);
  }
}

// ---- The credit limit is enforced, not just displayed. ----
run("state.customer = { id: 'c-x', name: 'Marie', creditLimit: 5000, currentBalance: 4800 };");
run("state.cart = [{ price: 100, qty: 3 }]; state.cartDiscount = null; state.paymentMethod = 'credit';");
assert.equal(run('creditOverLimit(0)'), 100, 'a 300 charge on 4800 of a 5000 limit is 100 over');
run("state.paymentMethod = 'split';");
assert.equal(run('creditOverLimit(50)'), 50, 'a split only charges the untendered 250');
assert.equal(run('creditOverLimit(250)'), 0, 'the same sale, mostly paid in cash, fits');
assert.equal(run('creditOverLimit(300)'), 0, 'nothing on account, nothing over');
run("state.paymentMethod = 'cash';");
assert.equal(run('creditOverLimit(300)'), 0, 'cash never touches the account');
run("state.customer = { id: 'c-y', name: 'No limit', creditLimit: 0, currentBalance: 99999 };");
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

const trips = run(`latestDeliveryEvents([
  { orderId: 'o1', event: 'dispatched', ts: '2026-09-14T01:00:00.000Z' },
  { orderId: 'o2', event: 'dispatched', ts: '2026-09-14T01:05:00.000Z' },
  { orderId: 'o1', event: 'arrived',    ts: '2026-09-14T01:40:00.000Z' },
])`);
assert.equal(trips.size, 2);
assert.equal(trips.get('o1').event, 'arrived', 'the newest event is the trip state');
assert.equal(trips.get('o2').event, 'dispatched');

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
assert.ok(tillRows[0].cartId.startsWith('cart_') && tillRows.every(r => r.cartId === tillRows[0].cartId), 'every row carries the cart id');
assert.equal(tillRows[3].data.chosenProductId, 'p1');
assert.equal(run('buildOrderRecord().cartId'), undefined, 'cartId never reaches the saved order');
context.window.HWPOS_STORE = { events: { append() { throw new Error('IDB exploded'); } } };
run(`track('sale_complete', {})`);   // must not throw
console.log('till events: ok');
