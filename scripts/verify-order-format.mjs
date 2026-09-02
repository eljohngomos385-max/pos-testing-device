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

console.log('Order format verification passed.');
