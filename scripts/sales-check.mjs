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
  // the calendar's MEAS table names these at load; nothing here prints with them
  pesoShort: String, pesoK: String,
  // the calendar's date helpers, copied from backoffice.js
  isoDate: (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  shiftDays: (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); },
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
// the tx table moved to bo-transactions.js (2026-09-26)
const txCode = readFileSync(new URL('../bo-transactions.js', import.meta.url), 'utf8');
assert.match(txCode.match(/key: 'total', label: 'Total',.*$/m)[0], /txTotal\(o\)/,
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

// ---- 9. Sales calendar: the comparison is off unless asked, and never half against whole --
const { calCompare, calState } = ctx.window.renderSales;
const D = (y, m, d = 1) => new Date(y, m - 1, d).getTime();
const cmp = (p, today) => calCompare(calState(p, today), today);
const day = (t) => ctx.isoDate(t);
assert.equal(calState({}, D(2026, 9, 26)).vs, '', 'no ?vs= means no comparison');
assert.equal(calState({ vs: 'junk' }, D(2026, 9, 26)).vs, '');
assert.equal(calState({ view: 'year', vs: 'year' }, D(2026, 9, 26)).vs, 'prev', 'a year has no "same month last year"');
let c = cmp({ month: '2026-09' }, D(2026, 9, 26));
assert.equal(c.prevA, undefined, 'off: no previous window at all');
assert.equal(c.title + c.label, '', 'off: no chip title, no "vs" on the button');
assert.equal(day(c.a) + '/' + day(c.b), '2026-09-01/2026-10-01');
// the month you're in: the same days so far
c = cmp({ month: '2026-09', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2026-08-01/2026-08-27', 'Sep 1–26 against Aug 1–26');
assert.equal(c.title, 'vs Aug 1 – 26');
assert.equal(c.label, 'vs August');
c = cmp({ month: '2026-09', vs: 'year' }, D(2026, 9, 26));
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2025-09-01/2025-09-27', 'Sep 1–26 against Sep 1–26 last year');
assert.equal(c.title, 'vs Sep 1 – 26, 2025');
assert.equal(c.label, 'vs September 2025');
// a finished month: the whole month before, whatever its length
c = cmp({ month: '2026-02', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2026-01-01/2026-02-01', 'February against all of January, not Jan 1–28');
assert.equal(c.title, 'vs January');
c = cmp({ month: '2026-03', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.prevB), '2026-03-01', 'March against all of February');
c = cmp({ month: '2026-01', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2025-12-01/2026-01-01', 'January steps back into last year');
// so far past the shorter month's end: capped at that month
c = cmp({ month: '2026-03', vs: 'prev' }, D(2026, 3, 30));
assert.equal(day(c.prevB), '2026-03-01', 'Mar 1–30 against all of February, not into March');
assert.equal(c.title, 'vs February');
// years
c = cmp({ view: 'year', month: '2026-09', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.a) + '/' + day(c.b), '2026-01-01/2027-01-01');
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2025-01-01/2025-09-27', 'this year so far against the same days of last year');
assert.equal(c.title, 'vs the same days of 2025');
assert.equal(c.label, 'vs 2025');
c = cmp({ view: 'year', month: '2025-01', vs: 'prev' }, D(2026, 9, 26));
assert.equal(day(c.prevA) + '/' + day(c.prevB), '2024-01-01/2025-01-01', 'a finished year against all of the one before, Dec 31 of a leap year included');
assert.equal(c.title, 'vs 2024');

// ---- Items' Top 10 and By staff's last sale --------------------------------
const rankTop = ctx.window.renderSales.rankTop;
const many = agg(Array.from({ length: 12 }, (_, n) => order({ number: 'r' + n, ts: 1000 + n, cashier: n % 2 ? 'Ana' : 'Ben', total: 100 + n, items: [line(n % 2 ? 'p1' : 'p2', 1, 100 + n)] })));
const top = rankTop(many.staff, 'revenue');
assert.equal(top[0].r.name, 'Ana', 'highest revenue ranks first');
near(top.reduce((s, x) => s + x.share, 0), 1, 'staff shares add to 1');
assert.equal(top[0].bar, 1, 'the leader fills its bar');
assert.equal(many.staff.find(s => s.name === 'Ana').last, 1011, 'last sale is the latest completed sale');
assert.equal(rankTop(Array.from({ length: 15 }, (_, i) => ({ qty: i })), 'qty').length, 10, 'a Top 10 is ten rows');
assert.equal(rankTop([{ cost: 0 }], 'cost')[0].share, null, 'nothing to share out: no share, not NaN');
assert.equal(agg([order({ number: 'v', ts: 5, status: 'voided', items: [] })]).staff[0].last, 0, 'a void is not a last sale');

console.log('sales-check: all assertions passed');
