/* Sales page check.
   The Sales view is pure read, so the only thing that can be wrong is the maths. bo-sales.js adds
   nothing up itself: every figure is a ladder() (SalesMath.summarize). This runs the real bo-sales.js
   in a vm and checks its items and categories against SalesMath.summarize on the same orders.

   node scripts/sales-check.mjs
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { foldersOf, categoryOf } = require('../bo-model.js');
const M = require('../sales-math.js');

const code = readFileSync(new URL('../bo-sales.js', import.meta.url), 'utf8');

const PRODUCTS = [
  { id: 'p1', name: 'PVC Elbow', sku: 'PVC-1', folder: 'plumbing', cost: 100 },
  { id: 'p2', name: 'Hammer', sku: 'HM-1', folder: '', cost: 50 },
  { id: 'p3', name: 'Pipe Wrench', sku: 'PW-1', folder: 'plumbing', folders: ['plumbing', 'tools'], cost: 80 },
  { id: 'p4', name: 'Hammer', brand: 'Generic', sku: 'HM-2', folder: '', cost: 40 },   // same name as p2
];
const byId = new Map(PRODUCTS.map(p => [p.id, p]));
const costOf = (i) => (byId.get(i.id)?.cost || 0);

const ctx = {
  window: {},
  document: { addEventListener() {} },
  // The shell helpers bo-sales.js leans on, as backoffice.js defines them.
  ladder: (orders, opts = {}) => M.summarize(orders, { costOf, ...opts }),
  saleSign: M.sign,
  productFor: (i) => byId.get(i.id) || null,
  costOf,
  state: { products: PRODUCTS, settings: {} },  escapeHtml: String, peso: (n) => M.formatMoney(n),
  folderName: (id) => ({ plumbing: 'Plumbing', tools: 'Tools' })[id] || 'Uncategorized',
  foldersOf, categoryOf, SalesMath: M,
  // the calendar's MEAS table names these at load; nothing here prints with them
  pesoShort: String, pesoK: String,
  hourLong: (h) => (h % 12 || 12) + (h % 24 < 12 ? ' AM' : ' PM'),   // Top 10 by hour names its rows with it
  // the calendar's date helpers, as backoffice.js defines them: the STORE'S clock (Manila), never the machine's
  boZone: () => M.storeZone(undefined),
  isoDate: (ts) => M.dayKey(+new Date(ts), 'Asia/Manila'),
  dashDate: (t, o) => new Date(t).toLocaleDateString('en-PH', { ...o, timeZone: 'Asia/Manila' }),
  dayStart: (ts) => M.dayStartMs(M.dayKey(+new Date(ts), 'Asia/Manila'), 'Asia/Manila'),
  shiftDays: (ts, n) => { ts = +new Date(ts); const k = M.dayKey(ts, 'Asia/Manila'); return M.dayStartMs(M.addDays(k, n), 'Asia/Manila') + (ts - M.dayStartMs(k, 'Asia/Manila')); },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const agg = ctx.window.renderSales.agg;
assert.equal(typeof agg, 'function', 'bo-sales.js must expose renderSales.agg');

// Orders as the till writes them: a PH sale, VAT inside the price; a void or refund is its own row.
const DAY = 864e5, d1 = new Date(2026, 9, 1, 10).getTime(), d2 = d1 + DAY;
const line = (id, qty, price) => ({ id, name: byId.get(id).name, sku: byId.get(id).sku, qty, price });
const sale = (id, ts, items, { cartOff = 0, ...extra } = {}) => {
  const t = M.orderTotals(items.map(i => ({ price: i.price, qty: i.qty })),
    cartOff ? { type: 'amount', value: cartOff } : null, { rate: 0.12, included: true });
  return { id, number: id, ts, status: 'completed', cashier: 'Ana', paymentMethodLabel: 'Cash', items,
    subtotal: t.subtotal, discount: t.discount, total: t.total, vatAmount: t.tax, ...extra };
};
const reverse = (o, status, ts) => ({ ...o, id: `${o.id}-${status}`, number: `${o.number}-${status}`, ts, status, originalOrderId: o.id });

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const FIELDS = ['grossSales', 'voids', 'refunds', 'discounts', 'netSales', 'tax', 'salesBeforeTax', 'collected',
  'costOfGoods', 'grossProfit', 'margin', 'orders', 'voidCount', 'refundCount', 'unitsSold', 'averageSale'];
const same = (got, want, msg) => { for (const f of FIELDS) near(got[f], want[f], `${msg} ${f}`); };

// ---- 1. The totals are SalesMath's, and the items add back to them ---------------
const s1 = sale('1', d1, [line('p1', 2, 400), line('p2', 1, 320)]);
const s2 = sale('2', d1, [line('p2', 1, 300)], { cashier: 'Ben', paymentMethodLabel: 'Account' });
const s3 = sale('3', d1, [line('p1', 1, 500)]);
const s4 = sale('4', d1, [line('p2', 1, 200)]);
const s5 = sale('5', d1, [line('p1', 1, 600), line('p2', 1, 400)], { cartOff: 100 });   // cart discount
const rows = [s1, s2, s3, reverse(s3, 'void', d1 + 60e3), s4, reverse(s4, 'refund', d2), s5];
const a = agg(rows), want = M.summarize(rows, { costOf });

same(a.totals, want, 'totals');
near(want.netSales, 1120 + 300 + 900, 'the void and the refund take their sales back out');
assert.equal(want.orders, 4, 'orders = 5 sales − 1 voided; the refund does not cut the count');
for (const f of ['netSales', 'grossProfit', 'costOfGoods', 'unitsSold', 'discounts', 'tax'])
  near(sum(a.items, f), a.totals[f], `items add up to the total ${f}`);
near(sum(a.items, 'share'), 1, 'item shares add to 1');
// no item here sits in two categories, so the category rows add up too
near(sum(a.cats, 'netSales'), a.totals.netSales, 'categories add up to net sales');
assert.ok(a.cats.some(c => c.name === 'Uncategorized'), 'an uncategorised item keeps a row, never dropped');
// each item row is the ladder group SalesMath gives for that item
const byItem = M.summarize(rows, { costOf, by: (o, i) => i.id }).groups;
for (const r of a.items) same(r, byItem.get(r.key), `item ${r.name}`);
const p1 = a.items.find(r => r.key === 'p1');
assert.equal(p1.name + '/' + p1.sku + '/' + p1.cat, 'PVC Elbow/PVC-1/Plumbing');

// ---- 2. A void row cancels its sale; a refund row lands negative on its own day --
const voided = agg([s3, reverse(s3, 'void', d1 + 60e3)]);
near(voided.totals.netSales, 0, 'void: no net sales');
near(voided.totals.grossProfit, 0, 'void: no gross profit');
assert.equal(voided.totals.orders, 0, 'void: no order');
assert.equal(voided.totals.voidCount, 1, 'void counted');
near(voided.items[0].unitsSold, 0, 'void: no units sold');
const refundDay = agg([reverse(s4, 'refund', d2)]);
near(refundDay.totals.netSales, -200, 'a refund on its own is negative net sales');
assert.equal(refundDay.totals.refundCount, 1, 'refund counted');
assert.ok(refundDay.items[0].unitsSold < 0, 'refunded units are negative');

// ---- 3. An item in two categories counts once, under its FIRST (owner 2026-10-02) --
const two = agg([sale('m', d1, [line('p3', 1, 150)])]);
const tc = new Map(two.cats.map(c => [c.name, c.netSales]));
near(tc.get('Plumbing'), 150, 'first category gets the sale');
assert.ok(!tc.get('Tools'), 'second category does not get it, so shares add to 100%');
near(sum(two.cats, 'share'), 1, 'category shares add to 1');
near(sum(two.items, 'netSales'), 150, 'the item itself counts once');

// ---- 4. A parked cart and an empty window are no money --------------------------
const parked = agg([{ ...sale('x', d1, [line('p1', 1, 100)]), status: 'saved' }]);
same(parked.totals, M.summarize([], { costOf }), 'parked');
assert.equal(parked.items.length, 0, 'a parked cart sells no item');
assert.equal(agg([]).totals.margin, 0, 'empty: margin 0, not NaN');

// ---- 4b. The calendar's Top 10 is agg's rows: same products, same money, same order ----------
// It used to group by name, so two products called "Hammer" merged there and not on Items.
const { tops } = ctx.window.renderSales;
const tr = [s1, s2, sale('h', d1, [line('p4', 3, 90)])];
const ti = tops(tr, 'item'), ai = agg(tr).items;
assert.equal(ti.size, ai.length, 'one Top row per product');
for (const r of ai) near(ti.get(r.key).netSales, r.netSales, `top item ${r.key}`);
assert.equal(new Set([...ti.values()].map(r => r.name)).size, ti.size, 'same-name products are told apart');
const tcat = tops(tr, 'cat'), ac = agg(tr).cats;
for (const r of ac) near(tcat.get(r.key).netSales, r.netSales, `top category ${r.key}`);
assert.equal(tcat.get('').items, 2, 'Uncategorized: both hammers');
// a window where only one Hammer sold still names it apart
assert.equal([...tops([sale('g', d1, [line('p4', 1, 90)])], 'item').values()][0].name, 'Hammer · Generic');
// a fully refunded item sold nothing: it is no top seller, and its category ranks nothing either
const back = [s4, reverse(s4, 'refund', d2)];
assert.equal(tops(back, 'item').size, 0, 'a refunded item is not in Top items');
assert.equal(tops(back, 'cat').size, 0, 'nor its category in Top categories');
// the busiest hour is the store's hour: a 7:30 AM Manila sale is 7 AM whatever the machine's zone
const seven = M.dayStartMs('2026-10-01', 'Asia/Manila') + 7.5 * 36e5;
assert.deepEqual([...tops([sale('e', seven, [line('p1', 1, 100)])], 'hour').keys()], ['7 – 8 AM']);
assert.deepEqual([...tops([sale('e', seven, [line('p1', 1, 100)])], 'day').keys()], ['Thursday'], 'Oct 1 2026 is a Thursday in Manila');

// ---- 5. A void or refund row prints the money it handed back, negative (backoffice.js txTotal)
const shell = readFileSync(new URL('../backoffice.js', import.meta.url), 'utf8');
const pick = (name) => shell.match(new RegExp('^const ' + name + ' = .*$', 'm'))[0];
const { txTotal } = vm.runInNewContext([pick('saleSign'), pick('txTotal'), '({ txTotal })'].join('\n'), { SalesMath: M });
assert.equal(txTotal(reverse(s4, 'refund', d2), Number), -s4.total, 'a refund row shows negative money');
assert.equal(txTotal(s4, Number), s4.total);
assert.match(txTotal({ ...s4, status: 'saved' }, Number), /—/, 'a parked cart shows — like Sales › Orders, not its cart total');

// ---- 6. Sales calendar: the comparison is off unless asked, and never half against whole --
const { calCompare, calState } = ctx.window.renderSales;
// a store day's midnight in Manila: the checks pass whatever TZ the machine runs in
const D = (y, m, d = 1) => M.dayStartMs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 'Asia/Manila');
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

// a month starts at the store's midnight, not the machine's
assert.equal(calState({ month: '2026-09' }, D(2026, 9, 26)).month, D(2026, 9, 1), '?month= opens at Manila midnight');
assert.equal(calState({}, D(2026, 9, 30) + 23.5 * 36e5).month, D(2026, 9, 1), '11:30 PM Sep 30 in Manila is still September');

// ---- 7. Owner 2026-10-03: the margin chip is a PERCENT change everywhere, one shared chip (backoffice.js marginChip)
const pickFn = (name) => shell.match(new RegExp('^const ' + name + ' = [\\s\\S]*?^\\};', 'm'))[0];
const { marginChip } = vm.runInNewContext([pickFn('calmChip'), pick('marginChip'), '({ marginChip })'].join('\n'), { SalesMath: M, escapeHtml: String });
const lad = (margin, salesBeforeTax = 100) => ({ margin, salesBeforeTax });
assert.match(marginChip(lad(0.30), lad(0.25), 'vs x'), />\+20\.0%</, '30% against 25% is +20.0%, not +5.0 pts');
assert.match(marginChip(lad(0.20), lad(0.25), 'vs x'), /chip down".*>−20\.0%</);
assert.match(marginChip(lad(0.25), lad(0.25), 'vs x'), /chip flat".*>0\.0%</);
assert.equal(marginChip(lad(0.30), lad(0, 0), 'vs x'), '', 'nothing sold before: no chip');
assert.equal(marginChip(lad(0, 0), lad(0.30), 'vs x'), '', 'nothing sold now: no chip');
// every margin chip goes through it: Dashboard, Summary, Items -- no points chip on a margin, no hand-rolled one
assert.match(shell, /stat\('mg', [^\n]*marginChip\(m, p, W\.vs\)\)/, 'Dashboard margin uses marginChip');
assert.match(code, /tab\('mg', [^\n]*marginChip\(cur, prev, prevTitle\)/, 'Summary margin uses marginChip');
assert.match(code, /cell\('Margin', [^\n]*marginChip\(D\.totals, D\.ptotals,/, 'Items margin uses marginChip');
assert.ok(!/ptsChip\(mg|calmChip\([^)\n]*(margin|mgOf)/i.test(code + shell.replace(pick('marginChip'), '')), 'no margin chip outside marginChip');

// ---- 8. Owner 2026-10-03: a window mixing VAT-included and VAT-on-top sales reads "included"
const { taxRows } = ctx.window.renderSales;
const ph = sale('V1', d1, [line('p1', 1, 112)]);
const us = { ...sale('V2', d1, [line('p2', 1, 100)]), taxIncluded: false, total: 112, vatAmount: 12 };
assert.match(taxRows(ctx.ladder([ph, us])), /VAT included/, 'mixed modes say included');
assert.doesNotMatch(taxRows(ctx.ladder([ph, us])), /on top/);
assert.match(taxRows(ctx.ladder([us])), /VAT on top/, 'all on top still says on top');
assert.match(taxRows(ctx.ladder([ph])), /VAT included/);
console.log('sales-check: all assertions passed');
