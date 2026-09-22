/* Sales page aggregation check.
   The Sales view is pure read, so the only thing that can be wrong is the maths:
   a cut that drops rows, double-counts a reversal, or stops summing to the summary.
   Runs the real bo-sales.js in a vm with stubbed shell helpers and calls its aggregator.

   node scripts/sales-check.mjs
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../bo-sales.js', import.meta.url), 'utf8');

const PRODUCTS = [
  { id: 'p1', name: 'PVC Elbow', sku: 'PVC-1', folder: 'plumbing', cost: 100 },
  { id: 'p2', name: 'Hammer', sku: 'HM-1', folder: '', cost: 50 },
];
const byId = new Map(PRODUCTS.map(p => [p.id, p]));

// saleSign is the shell's, not a copy: read the literal out of backoffice.js so the two
// files cannot disagree about what a void or a return is worth.
const shell = readFileSync(new URL('../backoffice.js', import.meta.url), 'utf8');
const SALE_SIGN = JSON.parse(shell.match(/const SALE_SIGN = ([^;]+);/)[1].replace(/([a-z]+):/g, '"$1":'));
assert.equal(SALE_SIGN.return, -1, 'a return is the negative event');
assert.equal(SALE_SIGN.refunded, 0, 'the refunded original must not reverse the sale twice');

// The -1 only nets out because the till leaves the ORIGINAL completed and appends a separate
// `return` row. If recordReturn ever starts flipping the original too, every return would
// subtract the sale twice and the day would go negative -- so pin the shape here.
const till = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const recordReturn = till.match(/function recordReturn\([\s\S]*?\n\}/)[0];
assert.match(recordReturn, /status: 'return'/, 'recordReturn must write the return row');
assert.ok(!/saveOrderMutation/.test(recordReturn),
  'recordReturn must not mutate the original order -- SALE_SIGN.return = -1 assumes it stays completed');

const ctx = {
  window: {},
  document: { addEventListener() {} },
  // The shell helpers agg() leans on, stubbed to their real behaviour.
  productFor: (i) => byId.get(i.id) || null,
  costOf: (i) => (byId.get(i.id)?.cost || 0),
  itemNet: (i) => (i.lineTotal != null ? i.lineTotal : i.price * i.qty),
  folderName: (id) => ({ plumbing: 'Plumbing' })[id] || 'Uncategorized',
  orderPaymentLabel: (o) => o.paymentMethodLabel || 'Cash',
  // bo-model's real one: a custom type is stored as its own name (see FULFIL_BUILTINS).
  orderFulfilLabel: (o) => (o.fulfilment === 'delivery' ? 'Delivery' : !o.fulfilment || o.fulfilment === 'pickup' ? 'Walk-in' : o.fulfilment),
  saleSign: (o) => SALE_SIGN[o.status || 'completed'] ?? 0,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const agg = ctx.window.renderSales.agg;
assert.equal(typeof agg, 'function', 'bo-sales.js must expose renderSales.agg');

const line = (id, qty, price) => ({ id, name: byId.get(id).name, sku: byId.get(id).sku, qty, price, lineTotal: qty * price });
const order = (o) => ({
  status: 'completed', cashier: 'Ana', vatAmount: 0, paymentKind: 'cash',
  paymentMethodLabel: 'Cash', items: [], ...o,
});

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

// ---- 1. Every cut sums back to the summary ----------------------------------
const rows = [
  order({ number: '1', total: 1120, vatAmount: 120, items: [line('p1', 2, 400), line('p2', 1, 320)] }),
  order({ number: '2', total: 300, vatAmount: 32.14, cashier: 'Ben', paymentKind: 'credit', paymentMethodLabel: 'Account', items: [line('p2', 1, 300)] }),
  order({ number: '3', total: 500, vatAmount: 53.57, status: 'voided', items: [line('p1', 1, 500)] }),
  order({ number: '4', total: 200, vatAmount: 21.43, status: 'return', cashier: 'Ben', items: [line('p2', 1, 200)] }),
  // Order-level discount: the lines total 1000 but only 900 was taken.
  order({ number: '5', total: 900, vatAmount: 96.43, items: [line('p1', 1, 600), line('p2', 1, 400)] }),
];
const a = agg(rows);

near(a.totals.revenue, 1120 + 300 - 200 + 900, 'summary revenue');
near(sum(a.items, 'revenue'), a.totals.revenue, 'by-item revenue');
near(sum(a.cats, 'revenue'), a.totals.revenue, 'by-category revenue');
near(sum(a.staff, 'revenue'), a.totals.revenue, 'by-employee revenue');
near(sum(a.pays, 'revenue'), a.totals.revenue, 'by-payment revenue');
near(sum(a.items, 'profit'), a.totals.profit, 'by-item profit');
near(sum(a.cats, 'profit'), a.totals.profit, 'by-category profit');

// The discounted order must not leak: allocation is by share of the line totals.
assert.equal(a.totals.txns, 5, 'every row in the window is a transaction');

// ---- 2. A product with no category groups under Uncategorized, never dropped -
const cats = new Map(a.cats.map(c => [c.name, c]));
assert.ok(cats.has('Uncategorized'), 'uncategorised products keep a row');
near(sum(a.cats, 'qty'), a.totals.qty, 'category quantities');

// ---- 3. A void adds a transaction and no revenue ----------------------------
const voided = agg([rows[2]]);
assert.equal(voided.totals.txns, 1, 'void is still a transaction');
assert.equal(voided.totals.voids, 1, 'void is counted as a void');
near(voided.totals.revenue, 0, 'void revenue');
near(voided.totals.profit, 0, 'void profit');
assert.equal(voided.items.length, 1, 'the voided sale still shows its item');
near(voided.items[0].qty, 0, 'a voided line moves no stock value');

// ---- 4. A refund lands negative rather than being dropped -------------------
// app.js writes a return row for money going back out; the original it reverses is
// flipped to 'refunded' in place, so that one contributes 0 (subtracting both would
// reverse the sale twice).
const returned = agg([rows[3]]);
assert.ok(returned.totals.revenue < 0, 'a return is negative revenue');
near(returned.totals.revenue, -200, 'return revenue');
assert.equal(returned.totals.refunds, 1, 'return counted as a refund');
assert.ok(returned.items[0].qty < 0, 'returned quantity is negative');
assert.ok(returned.staff[0].revenue < 0, 'the employee cut carries the negative too');

const refunded = agg([order({ number: '6', total: 750, status: 'refunded', items: [line('p1', 1, 750)] })]);
near(refunded.totals.revenue, 0, 'a reversed original books no revenue');
assert.equal(refunded.totals.txns, 1, 'a reversed original is still a transaction');
assert.equal(refunded.totals.refunds, 1, 'reversed original counted as a refund');

// ---- 5. Employee cut carries the voids/refunds columns ----------------------
const ben = a.staff.find(s => s.name === 'Ben');
assert.equal(ben.refunds, 1, 'Ben owns the return');
assert.equal(a.staff.find(s => s.name === 'Ana').voids, 1, 'Ana owns the void');

// ---- 6. Empty window is safe -----------------------------------------------
const none = agg([]);
assert.equal(none.totals.revenue, 0);
assert.equal(none.totals.margin, 0);
assert.equal(none.items.length, 0);

// ---- 7. A return prints the money it handed back, negative ------------------
// The aggregates were right and the row still printed "₱200.00" beside a Return pill, which
// reads as a second sale -- it only showed up by hand-adding the column against the summary.
const pick = (name) => shell.match(new RegExp('^const ' + name + ' = .*$', 'm'))[0];
const fmt = vm.runInNewContext(
  [pick('signed'), pick('peso'), pick('SALE_SIGN'), pick('saleSign'), pick('txTotal'),
   '({ peso, txTotal })'].join('\n'));
assert.equal(fmt.peso(-200), '−₱200.00', 'the minus goes in front of the peso sign');
assert.equal(fmt.peso(200), '₱200.00');
assert.equal(fmt.txTotal(rows[3]), -200, 'a return row shows negative money');
assert.equal(fmt.txTotal(rows[2]), 500, 'a voided row keeps its face value; the pill says it counts zero');
assert.match(code.match(/key: 'total', label: 'Total',.*$/m)[0], /txTotal\(o\)/,
  'the tx table total column must be signed, in the cell and in the CSV');

// ---- 8. Walk-in vs delivery splits the same money, no third bucket ----------
near(sum(a.fuls, 'revenue'), a.totals.revenue, 'fulfilment revenue');
assert.equal(a.fuls.length, 1, 'orders with no fulfilment field are walk-ins, not a third row');
assert.equal(a.fuls[0].name, 'Walk-in');

const mixed = agg([
  order({ number: '7', total: 500, fulfilment: 'delivery', items: [line('p1', 3, 150)] }),
  order({ number: '8', total: 200, items: [line('p2', 1, 200)] }),
]);
const byName = new Map(mixed.fuls.map(f => [f.name, f]));
near(byName.get('Delivery').revenue, 500, 'delivery revenue');
near(byName.get('Walk-in').revenue, 200, 'walk-in revenue');
near(sum(mixed.fuls, 'revenue'), mixed.totals.revenue, 'mixed fulfilment sums back');
// Top seller is picked on quantity, and each side only sees its own lines.
assert.equal(byName.get('Delivery').top.size, 1, 'delivery keeps its own item list');
assert.equal(byName.get('Delivery').top.get('p1').qty, 3);
assert.ok(!byName.get('Walk-in').top.has('p1'), 'a delivered line must not land in the walk-in list');

console.log('sales-check: all assertions passed');
