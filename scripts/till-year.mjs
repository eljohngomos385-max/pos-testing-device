/* A trading year, rung headless against the real till, then reconciled.

   `till-run.mjs` proves one day of every shape of transaction. This one proves the shapes
   survive volume and time: ~4,000 receipts across 365 days, restocking when the shelf gets
   low, with returns, voids, refunds and exchanges scattered through, and a moving clock so
   every date-bucketed report downstream sees a real year instead of 4,000 rows on one day.

   Then the books are added up three separate ways -- by the harness, by the till's own
   records, and by the Back Office aggregator that the Sales page actually renders -- and all
   three have to land on the same peso. The margin check is the point of the third: a product
   priced at a 25% margin and a product priced at a flat +₱50 have to produce the same profit
   in the report as they do on the shelf.

   node scripts/till-year.mjs [--verbose] [--days=365]
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { boot } from './lib/till.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const verbose = process.argv.includes('--verbose');
const DAYS = arg('days', 365);
const START = new Date(2025, 8, 1).getTime();   // 1 Sep 2025, so the year ends about now
const DAY = 86400000;

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => '₱' + round(n).toLocaleString('en-PH', { minimumFractionDigits: 2 });
const near = (a, b, msg, tol = 0.005) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: got ${a}, expected ${b} (off by ${round(a - b)})`);

// A fixed seed, so a failure is a bug and not a coincidence that will not reproduce.
let seed = 20250901;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;

const till = boot({ now: START });

// ---- Margin modes, set explicitly so the report has both to get wrong ---------
// One product priced as a percentage over cost, one priced at a flat peso markup. Everything
// downstream -- the shelf, the receipt, gross profit, the Sales cuts -- has to agree on both.
const MARGIN_CASES = [
  { id: 'pt001', cost: 200, mode: 'percent', value: 25 },   // -> 250.00
  { id: 'pt002', cost: 200, mode: 'flat', value: 50 },      // -> 250.00, the same price
  { id: 't001', cost: 180, mode: 'percent', value: 33.33 },
  { id: 'c001', cost: 240, mode: 'flat', value: 45 },
];
for (const m of MARGIN_CASES) {
  till.run(`(() => { const p = state.products.find(x => x.id === ${JSON.stringify(m.id)});
    p.cost = ${m.cost}; p.marginMode = ${JSON.stringify(m.mode)}; p.marginValue = ${m.value};
    p.price = priceFromMargin(p.cost, p.marginMode, p.marginValue); saveProducts(); })()`);
  const p = till.bySku(m.id);
  const expected = m.mode === 'percent' ? round(m.cost * (1 + m.value / 100)) : round(m.cost + m.value);
  near(p.price, expected, `${p.name}: ${m.mode} margin prices the shelf`);
}
const percentPaint = till.bySku('pt001'), flatPaint = till.bySku('pt002');
near(percentPaint.price, flatPaint.price,
  'the two margin modes were set up to land on the same price -- so only the profit maths can tell them apart');

// ---- The year ----------------------------------------------------------------
// Ids, not product objects: `till.products()` reads the till's storage fresh every call, and
// a captured object's `stock` goes stale the moment anything sells.
const sellable = till.products().filter(p => !p.archived).map(p => p.id);
const accounts = till.run('allCustomerRecords()').map(c => c.name);
const METHODS = ['cash', 'cash', 'cash', 'cash', 'gcash', 'gcash', 'qr', 'credit', 'split', 'other'];

// The harness's own books, kept as the year is rung.
const sold = new Map();
let cashIn = 0, credited = 0, liveRevenue = 0, liveCost = 0;
let rung = 0, voided = 0, refunded = 0, returned = 0, exchanged = 0, refused = 0, restocks = 0;

const shelf = new Map();   // productId -> everything the harness put on or took off the shelf
const move = (id, qty) => shelf.set(id, round((shelf.get(id) || 0) + qty));
const take = (items, sign) => items.forEach(([id, qty]) => {
  sold.set(id, round((sold.get(id) || 0) + sign * qty));
  move(id, sign * qty);
});
const costOf = (id) => till.bySku(id).cost;

/** Book a sale into the harness's ledger. `sign` flips it back out on a reversal. */
function book(o, sign) {
  liveRevenue = round(liveRevenue + sign * o.total);
  liveCost = round(liveCost + sign * o.items.reduce((n, i) => n + costOf(i.id) * i.qty, 0));
  cashIn = round(cashIn + sign * o.payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0));
  credited = round(credited + sign * o.payments.filter(p => p.method === 'credit').reduce((n, p) => n + p.amount, 0));
  take(o.items.map(i => [i.id, i.qty]), -sign);
}

/** Put stock back on the shelf when it runs low. Receiving is a movement like any other. */
function restock(p) {
  const target = Math.max(40, (p.reorderPoint || 10) * 6);
  const before = till.onHand(p.id);
  if (target <= before) return;
  till.setStock(p.id, target, { reason: 'receiving', note: 'Delivery received' });
  move(p.id, round(target - before));
  restocks++;
}

const done = [];                                  // completed sales still eligible to reverse
// How long a month of trading takes to ring, as the history behind it grows. Every sale
// re-serialises the whole order list into storage, so this curve is the shape of the
// localStorage ceiling -- it is evidence, not decoration.
const pace = [];
const startedAt = process.hrtime.bigint();
let lastAt = startedAt;

for (let d = 0; d < DAYS; d++) {
  const dayStart = START + d * DAY;
  const weekday = new Date(dayStart).getDay();
  if (weekday === 0) continue;                    // closed Sundays
  // Busier towards payday and at the weekend, the way a hardware store actually is.
  const dom = new Date(dayStart).getDate();
  const busy = (dom === 15 || dom >= 29 || weekday === 6) ? 1.8 : 1;
  const receipts = Math.max(1, Math.round((6 + rnd() * 8) * busy));

  for (let n = 0; n < receipts; n++) {
    till.clock(dayStart + 8 * 3600000 + Math.floor(rnd() * 10 * 3600000));

    const items = [];
    for (let k = 0, lines = 1 + Math.floor(rnd() * 4); k < lines; k++) {
      const p = till.bySku(pick(sellable));
      if (items.some(i => i[0] === p.id)) continue;
      const qty = p.soldBy === 'measure'
        ? round(0.5 + rnd() * 20)
        : 1 + Math.floor(rnd() * (p.price > 300 ? 2 : 8));
      if (qty > p.stock) restock(p);
      items.push([p.id, qty]);
    }
    if (!items.length) continue;

    const method = pick(METHODS);
    const onAccount = method === 'credit' || method === 'split';
    const total = items.reduce((n, [id, q]) => n + till.bySku(id).price * q, 0);
    const o = till.ring({
      items,
      method,
      customer: onAccount ? pick(accounts) : (chance(0.15) ? pick(accounts) : null),
      otherName: method === 'other' ? pick(['Maya', 'PayMaya', 'Bank transfer']) : '',
      tendered: method === 'split' ? Math.max(1, Math.floor(total * 0.4))
              : (method === 'credit' ? null : Math.ceil(total / 100) * 100),
      discount: chance(0.08) ? { type: 'percent', value: pick([5, 10, 15]) } : null,
      fulfilment: chance(0.12) ? 'delivery' : 'pickup',
      address: 'Blk 7 Lot 12, San Pedro, Laguna',
      // A cashier cannot wave a sale past the credit limit or an empty shelf; only the
      // over-limit prompt gets a yes here, and only sometimes.
      approve: chance(0.3),
    });
    if (!o) { refused++; continue; }

    rung++;
    book(o, 1);
    done.push(o);

    // Receipts come back a few days later, not the same minute.
    if (done.length > 40 && chance(0.06)) {
      till.clock(dayStart + 12 * 3600000);
      const old = done.splice(Math.floor(rnd() * (done.length - 20)), 1)[0];
      const how = pick(['void', 'refund', 'return', 'exchange']);
      if (how === 'exchange') {
        const swap = till.bySku(pick(sellable));
        if (swap.stock < 5) restock(swap);
        const res = till.exchange(old.number, [[swap.id, 1]]);
        if (!res) continue;
        book(old, -1);
        book(res.exchangeSale, 1);
        done.push(res.exchangeSale);
        exchanged++;
      } else {
        if (!till[how](old.number)) continue;
        book(old, -1);
        if (how === 'void') voided++; else if (how === 'refund') refunded++; else returned++;
      }
    }
  }

  if ((d + 1) % 30 === 0) {
    const at = process.hrtime.bigint();
    pace.push({ day: d + 1, receipts: till.run('state.orders.length'),
                ms: Number(at - lastAt) / 1e6, bytes: (till.run('localStorage.getItem("hwpos.orders.v1")') || '').length });
    lastAt = at;
  }

  // Somebody pays down their account most weeks.
  if (weekday === 5 && credited > 0) {
    const name = pick(accounts);
    const owed = till.run('allCustomerRecords()').find(c => c.name === name).currentBalance;
    if (owed > 500) till.payCredit(name, Math.floor(owed / 2), 'Payment on account');
  }
}

// ---- Reconciliation ----------------------------------------------------------
const orders = till.orders();
const SALE_SIGN = { completed: 1, return: -1, refunded: 0, voided: 0, saved: 0 };
const signOf = (o) => SALE_SIGN[o.status || 'completed'] ?? 0;

// 1. Stock: the cached number, the movement log, and what the harness knows it sold.
for (const [id, moved] of shelf) {
  const s = till.stock(id);
  near(s.cached, s.expected, `${s.product.name}: cached stock vs the movement log`);
  near(s.cached, round(s.opening + moved), `${s.product.name}: stock left vs what was rung and received`);
}

// 2. Revenue: the till's signed ledger vs the harness's running total.
const booked = round(orders.reduce((n, o) => n + signOf(o) * o.total, 0));
near(booked, liveRevenue, 'revenue: the signed ledger vs what the harness rang', 0.02);

// 3. The drawer.
const drawer = round(orders.reduce((n, o) =>
  n + signOf(o) * o.payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0), 0));
near(drawer, cashIn, 'drawer: cash taken vs cash booked', 0.02);

// 4. Receivables: every account's stored balance is explained by its ledger, to the centavo.
let owedTotal = 0;
for (const c of till.run('allCustomerRecords()')) {
  const moved = round(till.ledger(c.id).reduce((n, e) => n + (e.type === 'payment' ? -e.amount : e.amount), 0));
  const opening = { 'c-001': 8450, 'c-003': 1280.5, 'c-004': 22450 }[c.id] || 0;
  // `adjustCustomerBalance` floors an account at zero, so a paid-down account can hold less
  // than its ledger says. It can never hold MORE -- that would be money nobody owes.
  assert.ok(c.currentBalance <= round(opening + moved) + 0.005,
    `${c.name}: the stored balance claims more than the ledger explains (${c.currentBalance} vs ${round(opening + moved)})`);
  owedTotal = round(owedTotal + c.currentBalance);
}

// 5. Nothing sold off a shelf that was not there, unless a manager said so.
const negatives = till.products().filter(p => p.stock < 0 && !p.sellOutOfStock);
assert.equal(negatives.length, 0,
  `stock went negative without an override: ${negatives.map(p => `${p.name} ${p.stock}`).join(', ')}`);

// 6. Every movement points at a real receipt, and reversals cancel their own.
const orderById = new Map(orders.map(o => [o.id, o]));
const byRef = new Map();
for (const m of till.movements()) {
  if (!m.refId) continue;
  assert.ok(orderById.has(m.refId), `a stock movement points at receipt ${m.refId}, which does not exist`);
  byRef.set(m.refId, round((byRef.get(m.refId) || 0) + m.qty));
}
for (const o of orders) {
  if (o.status === 'voided' || o.status === 'refunded') {
    near(byRef.get(o.id) || 0, 0, `${o.number} is ${o.status} -- its stock movements must cancel`);
  }
}

// ---- The Back Office aggregator, on the same year ----------------------------
// This is the code the Sales page renders from. Running it here is the end-to-end margin
// check: it derives cost per line itself, so a percent-margin product and a flat-margin one
// have to come out of it with the profit the shelf implies.
const byId = new Map(till.products().map(p => [p.id, p]));
const agCtx = {
  window: {}, document: { addEventListener() {} },
  productFor: (i) => byId.get(i.id) || null,
  costOf: (i) => (byId.get(i.id)?.cost || 0),
  itemNet: (i) => (i.lineTotal != null ? i.lineTotal : i.price * i.qty),
  folderName: (id) => id || 'Uncategorized',
  orderPaymentLabel: (o) => o.paymentMethodLabel || 'Cash',
  saleSign: signOf,
};
vm.createContext(agCtx);
vm.runInContext(readFileSync(new URL('../bo-sales.js', import.meta.url), 'utf8'), agCtx);
const a = agCtx.window.renderSales.agg(orders);

const sum = (rows, key) => round(rows.reduce((n, r) => n + r[key], 0));
near(a.totals.revenue, booked, 'Sales summary vs the ledger', 0.02);
near(sum(a.items, 'revenue'), a.totals.revenue, 'sales by item sums to the summary', 0.05);
near(sum(a.cats, 'revenue'), a.totals.revenue, 'sales by category sums to the summary', 0.05);
near(sum(a.staff, 'revenue'), a.totals.revenue, 'sales by employee sums to the summary', 0.05);
near(sum(a.pays, 'revenue'), a.totals.revenue, 'sales by payment type sums to the summary', 0.05);
near(sum(a.items, 'profit'), a.totals.profit, 'profit by item sums to the summary', 0.05);
near(sum(a.cats, 'profit'), a.totals.profit, 'profit by category sums to the summary', 0.05);

// The margin, end to end, on its own clean set of receipts. Mixed into a year of discounts
// and reversals the arithmetic is only checkable against the aggregator's own formula, which
// proves nothing. Three plain cash sales at the end are exact and can be done by hand.
till.clock(START + DAYS * DAY);
const proof = [
  till.ring({ items: [['pt001', 4]], method: 'cash', tendered: 2000 }),
  till.ring({ items: [['pt002', 4]], method: 'cash', tendered: 2000 }),
];
assert.ok(proof.every(Boolean), 'the margin proof sales must go through');
const pa = agCtx.window.renderSales.agg(proof);
const VAT = 0.12;
for (const [id, label] of [['pt001', 'percent 25% on ₱200'], ['pt002', 'flat +₱50 on ₱200']]) {
  const row = pa.items.find(r => r.key === id);
  const p = byId.get(id);
  near(p.price, 250, `${label}: the shelf price`);
  near(row.qty, 4, `${label}: quantity`);
  near(row.revenue, 1000, `${label}: revenue is price x qty`);
  near(row.net, round(1000 / (1 + VAT)), `${label}: revenue ex-VAT`, 0.02);
  near(row.cost, 800, `${label}: cost is the stamped cost x qty`);
  near(row.profit, round(1000 / (1 + VAT) - 800), `${label}: gross profit`, 0.02);
}
const pc = pa.items.find(r => r.key === 'pt001'), fl = pa.items.find(r => r.key === 'pt002');
near(pc.profit, fl.profit,
  'a 25% margin and a flat +₱50 on the same cost earn the same profit -- the mode is how it is typed, not what it is worth');
near(pc.margin, fl.margin, 'and the same margin percentage');

// And at year scale, the per-line cost the report uses is the cost on the product, signed the
// same way the revenue is -- so a reversal takes its cost back out too.
const yearCost = round(orders.reduce((n, o) =>
  n + signOf(o) * o.items.reduce((s, i) => s + (byId.get(i.id)?.cost || 0) * i.qty, 0), 0));
near(a.totals.cost, yearCost, 'the year cost the report uses vs the cost on the products', 0.05);
near(a.totals.profit, round(a.totals.net - yearCost), 'gross profit is revenue ex-VAT minus that cost', 0.05);

// ---- Report ------------------------------------------------------------------
const days = new Set(orders.map(o => new Date(o.ts).toDateString())).size;
const bytes = JSON.stringify(orders).length;
console.log(`\nA year on the till — ${DAYS} days, ${days} trading days`);
console.log(`  receipts       ${String(orders.length).padStart(12)}   (${rung} sales, ${refused} refused at checkout)`);
console.log(`  reversals      ${String(voided + refunded + returned + exchanged).padStart(12)}   (${voided} void, ${refunded} refund, ${returned} return, ${exchanged} exchange)`);
console.log(`  deliveries in  ${String(restocks).padStart(12)}`);
console.log(`  revenue        ${money(a.totals.revenue).padStart(12)}`);
console.log(`  gross profit   ${money(a.totals.profit).padStart(12)}   ${round(a.totals.margin * 100)}%`);
console.log(`  drawer         ${money(drawer).padStart(12)}`);
console.log(`  receivables    ${money(owedTotal).padStart(12)}`);
console.log(`  orders on disk ${String(Math.round(bytes / 1024)).padStart(12)} KB   (${round(bytes / orders.length)} bytes a receipt)`);

console.log('\n  What a month costs as the history grows');
console.log('    day    receipts     orders on disk    time to ring the month');
for (const r of pace) {
  console.log(`    ${String(r.day).padStart(3)}  ${String(r.receipts).padStart(10)}  ${(Math.round(r.bytes / 1024) + ' KB').padStart(16)}  ${(Math.round(r.ms) + ' ms').padStart(22)}`);
}

const top = (rows, key, label, n = 5) => {
  console.log(`\n  ${label}`);
  for (const r of rows.slice().sort((x, y) => y[key] - x[key]).slice(0, n)) {
    console.log(`    ${String(r.name).slice(0, 30).padEnd(32)} ${money(r[key]).padStart(13)}`);
  }
};
top(a.items, 'revenue', 'Top items by revenue');
top(a.items, 'profit', 'Top items by profit');
top(a.cats, 'revenue', 'By category');
top(a.pays, 'revenue', 'By payment type');
top(a.staff, 'revenue', 'By employee');

console.log('\n  Margin modes, end to end (4 units each, no discount)');
for (const [id, label] of [['pt001', 'percent 25%'], ['pt002', 'flat +₱50']]) {
  const p = byId.get(id), r = pa.items.find(x => x.key === id);
  console.log(`    ${p.name.slice(0, 24).padEnd(26)} ${label.padEnd(12)} cost ${money(p.cost)}  price ${money(p.price)}  profit ${money(r.profit).padStart(10)}  ${round(r.margin * 100)}% margin`);
}

if (verbose) {
  console.log('\n  Needs buying');
  for (const p of till.products().filter(p => p.stock <= p.reorderPoint).slice(0, 12)) {
    console.log(`    ${p.name.slice(0, 30).padEnd(32)} ${String(p.stock).padStart(8)} / ${String(p.reorderPoint).padEnd(6)} ${p.unit}`);
  }
}

// ---- Buying it back in -------------------------------------------------------
// The end of the flow the shop actually walks: a year of selling leaves a list of what is
// below its danger level; that list becomes a purchase order; the delivery arrives short on
// one line and the PO stays open. Driven through the real bo-model functions the Suppliers
// page calls, so the shelf, the movement log and the PO status have to end up agreeing.
const lowBefore = till.products().filter(p => !p.archived && p.stock <= p.reorderPoint);
assert.ok(lowBefore.length, 'a year of trading should leave something below its danger level');

const buy = lowBefore.slice(0, 6).map(p => ({
  id: p.id, name: p.name, was: p.stock, order: round(Math.max(p.reorderPoint * 3 - p.stock, 1)),
}));
const receiveNow = Object.fromEntries(buy.map((b, i) => [b.id, i === 0 ? round(b.order / 2) : b.order]));

const po = till.run(`(() => {
  const buy = ${JSON.stringify(buy)}, take = ${JSON.stringify(receiveNow)};
  // state.products is the live list app.js writes back; saveProducts() takes no argument.
  const byId = new Map(state.products.map(p => [p.id, p]));
  const po = { ...PO_DEFAULTS, id: newId('po'), number: 'PO-YEAR-1', status: 'ordered',
    supplierId: (loadSuppliers()[0] || {}).id || '', orderedAt: new Date().toISOString(),
    items: buy.map(b => poLine(b.id, b.order, byId.get(b.id).cost)) };
  savePurchaseOrders(loadPurchaseOrders().concat([po]));
  const ordered = poTotal(po);
  // Receiving is the only thing on that page that moves stock, and it moves it the same way
  // a sale does -- a movement with a reason, not an assignment to product.stock.
  const map = Object.fromEntries(po.items.map(l => [l.id, take[l.productId]]));
  const movements = receivePo(po, map);
  movements.forEach(m => applyMovement(byId.get(m.productId), m));
  appendMovements(movements);
  saveProducts();
  savePurchaseOrders(loadPurchaseOrders().map(x => x.id === po.id ? po : x));
  return { id: po.id, number: po.number, status: po.status, ordered,
           outstanding: poOutstanding(po), movements: movements.length };
})()`);

assert.equal(po.movements, buy.length, 'every ordered line that arrived wrote a movement');
assert.equal(po.status, 'partial', 'one line came up short, so the PO stays open');
near(po.outstanding, round(buy[0].order - receiveNow[buy[0].id]), 'and it is short by exactly that much');
for (const b of buy) {
  const s = till.stock(b.id);
  near(s.cached, round(b.was + receiveNow[b.id]), `${b.name}: the delivery landed on the shelf`);
  near(s.cached, round(s.opening + s.logged), `${b.name}: and the log still explains the shelf`);
}
assert.equal(till.movements().filter(m => m.refId === po.id).length, buy.length,
  'the delivery movements point back at the purchase order that caused them');

console.log(`\n  Purchase order ${po.number}: ${money(po.ordered)} ordered from ${buy.length} lines, ${po.status}, ${po.outstanding} units still to come`);
for (const b of buy) {
  console.log(`    ${b.name.slice(0, 30).padEnd(32)} ${String(b.was).padStart(7)} + ${String(receiveNow[b.id]).padStart(6)} of ${String(b.order).padEnd(6)} -> ${String(till.stock(b.id).cached).padStart(7)}`);
}

console.log('\ntill-year: the year reconciles.');
